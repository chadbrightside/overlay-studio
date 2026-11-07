import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import express from "express";
import { ROOT, UI_DIR, INBOX_DIR } from "./paths.js";
import { loadSettings, saveSettings, publicSettings } from "./config.js";
import { listProjects, createProject, getProject, deleteProject, getTranscript, saveTranscript, getPlan, savePlan, projectDir, saveProject } from "./projects.js";
import { createJob, getJob, cancelJob, listJobs, activeJob } from "./jobs.js";
import { transcribeProject, importSubtitles, pythonStatus } from "./transcribe.js";
import { planOverlays, normalizePlan, OVERLAY_TYPES } from "./planner.js";
import { renderExport, previewClip, previewStill } from "./pipeline.js";
import { ffmpegAvailable, availableEncoders, BIN } from "./ffmpeg.js";
import { createAssetApp } from "./renderer.js";
import { checkForUpdate, applyUpdate } from "./update.js";

const PORT = Number(process.env.PORT || 3777);
const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(express.text({ limit: "20mb", type: ["text/plain", "application/x-subrip", "text/vtt"] }));

const VIDEO_EXT = /\.(mp4|mov|mkv|m4v|mxf|avi|webm|ts)$/i;
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => { console.error(e); res.status(400).json({ error: e.message || String(e) }); });
function jobFor(kind, projectId, run) {
  if (activeJob(projectId)) throw new Error("Another job is already running for this project. Wait for it or cancel it.");
  const settings = loadSettings();
  return createJob(kind, projectId, (ctx) => { ctx.settings = settings; return run(ctx); });
}

// ---- health & settings ----
app.get("/api/health", wrap(async (req, res) => {
  const s = loadSettings();
  let chromium = false;
  try { const { chromium: c } = await import("playwright"); chromium = fs.existsSync(c.executablePath()); } catch {}
  res.json({ ffmpeg: ffmpegAvailable(), ffmpegPath: BIN.ffmpeg, python: pythonStatus(s.pythonPath), chromium, apiKey: Boolean(s.apiKey), encoders: ffmpegAvailable() ? availableEncoders() : {}, platform: process.platform, node: process.version, version: JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version });
}));
app.get("/api/settings", (req, res) => res.json(publicSettings(loadSettings())));
app.put("/api/settings", wrap((req, res) => {
  const patch = { ...req.body };
  if (patch.apiKey !== undefined && (patch.apiKey === "" || patch.apiKey.includes("…"))) delete patch.apiKey; // masked value sent back unchanged
  res.json(publicSettings(saveSettings(patch)));
}));
app.post("/api/settings/test-key", wrap(async (req, res) => {
  const key = (req.body?.apiKey || "").trim() || loadSettings().apiKey;
  if (!key) throw new Error("No API key to test");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 20000 });
  try {
    const page = await client.models.list({ limit: 5 });
    res.json({ ok: true, models: page.data.map((m) => m.id) });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error("The key was rejected. Copy it again from console.anthropic.com.");
    if (err instanceof Anthropic.APIConnectionError) throw new Error("Could not reach api.anthropic.com. Check the internet connection.");
    throw new Error(`Claude API error: ${err.message}`);
  }
}));
app.get("/api/inbox", (req, res) => {
  const files = fs.readdirSync(INBOX_DIR).filter((f) => VIDEO_EXT.test(f)).map((f) => ({ name: f, path: path.join(INBOX_DIR, f), size: fs.statSync(path.join(INBOX_DIR, f)).size }));
  res.json({ dir: INBOX_DIR, files });
});
app.get("/api/overlay-types", (req, res) => res.json(OVERLAY_TYPES));

// ---- projects ----
app.get("/api/projects", (req, res) => res.json(listProjects()));
app.post("/api/projects", wrap(async (req, res) => res.json(await createProject(req.body.videoPath))));
app.get("/api/projects/:id", wrap((req, res) => res.json({ ...getProject(req.params.id), activeJob: activeJob(req.params.id) })));
app.delete("/api/projects/:id", wrap((req, res) => { deleteProject(req.params.id); res.json({ ok: true }); }));
app.post("/api/projects/:id/reveal", wrap((req, res) => {
  const target = req.body?.path && fs.existsSync(req.body.path) ? req.body.path : projectDir(req.params.id);
  const cmd = process.platform === "darwin" ? ["open", ["-R", target]] : process.platform === "win32" ? ["explorer", [fs.statSync(target).isDirectory() ? target : path.dirname(target)]] : ["xdg-open", [path.dirname(target)]];
  spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore" }).unref();
  res.json({ ok: true });
}));
// Native file picker (macOS and Windows). The browser cannot read a chosen file's path, so the server opens the system dialog.
app.post("/api/pick-file", wrap(async (req, res) => {
  const prompt = String(req.body?.prompt || "Choose a video").slice(0, 120);
  let cmd, args;
  if (process.platform === "darwin") {
    cmd = "osascript";
    args = ["-e", `tell application "System Events"`, "-e", "activate", "-e", `POSIX path of (choose file of type {"public.movie"} with prompt ${JSON.stringify(prompt)})`, "-e", "end tell"];
  } else if (process.platform === "win32") {
    cmd = "powershell";
    args = ["-NoProfile", "-STA", "-Command", `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Filter = 'Video files|*.mp4;*.mov;*.mkv;*.m4v;*.avi|All files|*.*'; $d.Title = ${JSON.stringify(prompt)}; if ($d.ShowDialog() -eq 'OK') { Write-Output $d.FileName }`];
  } else return res.json({ cancelled: true, unsupported: true });
  const out = await new Promise((resolve) => {
    const p = spawn(cmd, args); let s = "";
    p.stdout.on("data", (d) => { s += d; }); p.on("close", () => resolve(s.trim())); p.on("error", () => resolve(""));
  });
  res.json(out && fs.existsSync(out) ? { path: out } : { cancelled: true });
}));
app.use("/api/projects/:id/files", (req, res, next) => express.static(projectDir(req.params.id))(req, res, next));

// ---- transcript ----
app.get("/api/projects/:id/transcript", wrap((req, res) => res.json(getTranscript(req.params.id))));
app.post("/api/projects/:id/transcribe", wrap((req, res) => {
  const id = req.params.id;
  res.json(jobFor("transcribe", id, async (ctx) => { const t = await transcribeProject(id, ctx.settings, ctx); return { segments: t.segments.length, language: t.language }; }));
}));
app.post("/api/projects/:id/transcript/import", wrap((req, res) => {
  const p = getProject(req.params.id);
  const text = typeof req.body === "string" ? req.body : req.body.text;
  const t = importSubtitles(req.params.id, text, p.video.duration);
  res.json({ segments: t.segments.length });
}));
app.put("/api/projects/:id/transcript", wrap((req, res) => { saveTranscript(req.params.id, req.body); res.json({ ok: true }); }));

// ---- plan ----
app.get("/api/projects/:id/plan", wrap((req, res) => res.json(getPlan(req.params.id))));
app.post("/api/projects/:id/plan", wrap((req, res) => {
  const id = req.params.id;
  const { notes = "", revise = false } = req.body || {};
  const project = getProject(id);
  const transcript = getTranscript(id);
  if (!transcript) throw new Error("Transcribe the video first.");
  const previousPlan = revise ? getPlan(id) : null;
  res.json(jobFor("plan", id, async (ctx) => {
    ctx.progress(0.1, "Claude is reading the transcript and planning overlays");
    const plan = await planOverlays({ project, transcript, settings: ctx.settings, notes, previousPlan, log: ctx.log });
    if (previousPlan?.history) plan.history = previousPlan.history;
    plan.history = [...(plan.history || []), { at: plan.meta.createdAt, notes, count: plan.overlays.length }].slice(-20);
    savePlan(id, plan);
    return { overlays: plan.overlays.length, cost: plan.meta.estimatedCostUsd };
  }));
}));
app.put("/api/projects/:id/plan", wrap((req, res) => {
  const id = req.params.id;
  const existing = getPlan(id) || { overlays: [] };
  const project = getProject(id);
  const incoming = req.body;
  // keep edits exactly as the editor typed them; only sort and sanitise numbers
  const overlays = (incoming.overlays || []).map((o, i) => ({ ...o, start: Number(o.start), end: Number(o.end), id: o.id || `ov-${String(i + 1).padStart(3, "0")}` }))
    .filter((o) => Number.isFinite(o.start) && Number.isFinite(o.end) && o.end > o.start && OVERLAY_TYPES.includes(o.type))
    .map((o) => ({ ...o, start: Math.max(0, o.start), end: Math.min(project.video.duration, o.end) }))
    .sort((a, b) => a.start - b.start);
  res.json(savePlan(id, { ...existing, ...incoming, overlays }));
}));

// ---- previews ----
app.post("/api/projects/:id/overlays/:oid/still", wrap(async (req, res) => res.json(await previewStill(req.params.id, req.params.oid, loadSettings()))));
app.post("/api/projects/:id/overlays/:oid/clip", wrap((req, res) => {
  const { id, oid } = req.params;
  res.json(jobFor("clip", id, (ctx) => previewClip(id, oid, ctx)));
}));

// ---- export ----
app.post("/api/projects/:id/export", wrap((req, res) => {
  const id = req.params.id;
  const { mode = "burn", codec, crf, preset } = req.body || {};
  res.json(jobFor(`export-${mode}`, id, (ctx) => renderExport(id, { mode, codec, crf, preset }, ctx)));
}));

// ---- updates ----
app.get("/api/update/check", wrap(async (req, res) => res.json(await checkForUpdate())));
app.post("/api/update/apply", wrap((req, res) => {
  const job = jobFor("update", "_system", async (ctx) => {
    const r = await applyUpdate(ctx);
    // exit code 75 tells the launcher script to start the server again with the new code
    setTimeout(() => process.exit(75), 1500);
    return r;
  });
  res.json(job);
}));

// ---- jobs ----
app.get("/api/jobs/:id", (req, res) => res.json(getJob(req.params.id)));
app.post("/api/jobs/:id/cancel", (req, res) => res.json(cancelJob(req.params.id)));
app.get("/api/projects/:id/jobs", (req, res) => res.json(listJobs(req.params.id)));

// ---- static: UI + render surface (handy for debugging templates in a browser) ----
app.use("/render", createAssetApp());
app.use("/", express.static(UI_DIR));

app.listen(PORT, "127.0.0.1", () => {
  console.log(`\nSardiye Studio is running.\nOpen  http://localhost:${PORT}  in your browser.\n`);
  const s = loadSettings();
  if (!s.apiKey) console.log("No Claude API key yet: open Settings in the app and paste one from console.anthropic.com\n");
  if (process.env.OPEN_BROWSER) {
    const url = `http://localhost:${PORT}`;
    const cmd = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
    try { spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore" }).unref(); } catch {}
  }
});
