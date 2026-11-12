import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import express from "express";
import { ROOT, UI_DIR, INBOX_DIR } from "./paths.js";
import { loadSettings, saveSettings, publicSettings } from "./config.js";
import { listProjects, createProject, getProject, deleteProject, getTranscript, saveTranscript, getPlan, savePlan, projectDir, saveProject, createScriptProject, getScript, saveScript, attachVideo } from "./projects.js";
import { alignOverlays } from "./align.js";
import { searchImages, resolvePlanImages, setOverlayImage, detectFocus } from "./images.js";
import { createJob, getJob, cancelJob, listJobs, activeJob } from "./jobs.js";
import { transcribeProject, importSubtitles, pythonStatus } from "./transcribe.js";
import { planOverlays, normalizePlan, OVERLAY_TYPES } from "./planner.js";
import { renderExport, previewClip, previewStill } from "./pipeline.js";
import { ffmpegAvailable, availableEncoders, BIN } from "./ffmpeg.js";
import { createAssetApp } from "./renderer.js";
import { checkForUpdate, applyUpdate } from "./update.js";
import { installConsoleLog } from "./log.js";
import { writeSupportReport } from "./support.js";
import { runRequests } from "./requests.js";

installConsoleLog();

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
const pyCache = { key: null, at: 0, value: null };
function cachedPythonStatus(p) {
  // importing faster-whisper takes seconds on a slower Mac; remember the answer for five minutes
  if (pyCache.key === p && Date.now() - pyCache.at < 5 * 60 * 1000) return pyCache.value;
  pyCache.key = p; pyCache.value = pythonStatus(p); pyCache.at = Date.now();
  return pyCache.value;
}
async function healthInfo() {
  const s = loadSettings();
  let chromium = false;
  try { const { chromium: c } = await import("playwright"); chromium = fs.existsSync(c.executablePath()); } catch {}
  return { ffmpeg: ffmpegAvailable(), ffmpegPath: BIN.ffmpeg, python: cachedPythonStatus(s.pythonPath), chromium, apiKey: Boolean(s.apiKey), encoders: ffmpegAvailable() ? availableEncoders() : {}, platform: process.platform, node: process.version, version: JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version };
}
app.get("/api/health", wrap(async (req, res) => res.json(await healthInfo())));
// Support report: a zip on the Desktop with logs and project state (no videos, no transcripts, no key). He sends it by WhatsApp.
app.post("/api/support/report", wrap(async (req, res) => {
  const r = await writeSupportReport({ health: await healthInfo() });
  console.log(`support report written to ${r.path}`);
  if (req.body?.reveal !== false) {
    const cmd = process.platform === "darwin" ? ["open", ["-R", r.path]] : process.platform === "win32" ? ["explorer", [path.dirname(r.path)]] : ["xdg-open", [path.dirname(r.path)]];
    try { spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore" }).unref(); } catch {}
  }
  res.json(r);
}));
app.get("/api/settings", (req, res) => res.json(publicSettings(loadSettings())));
app.put("/api/settings", wrap((req, res) => {
  const patch = { ...req.body };
  if (patch.apiKey !== undefined && (patch.apiKey === "" || patch.apiKey.includes("…"))) delete patch.apiKey; // masked value sent back unchanged
  if (patch.pythonPath !== undefined) pyCache.key = null;
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
// ---- script-first projects ----
app.post("/api/projects/script", wrap((req, res) => {
  const { name = "", script = "" } = req.body || {};
  if (!String(script).trim()) throw new Error("Paste the script first.");
  res.json(createScriptProject(name, script));
}));
app.get("/api/projects/:id/script", wrap((req, res) => res.json({ text: getScript(req.params.id) })));
app.put("/api/projects/:id/script", wrap((req, res) => { saveScript(req.params.id, req.body?.text ?? ""); res.json({ ok: true }); }));
/** Attach the recording to a script project: transcribe it, then time every planned overlay by its anchor words. */
app.post("/api/projects/:id/video", wrap(async (req, res) => {
  const id = req.params.id;
  const videoPath = req.body?.videoPath;
  if (!videoPath) throw new Error("No video path given.");
  await attachVideo(id, videoPath);
  res.json(jobFor("attach", id, async (ctx) => {
    const sub = { ...ctx, progress: (p, m) => ctx.progress(p === undefined ? undefined : p * 0.9, m) };
    await transcribeProject(id, ctx.settings, sub);
    const transcript = getTranscript(id);
    const plan = getPlan(id);
    if (!plan) return { transcribed: true, matched: 0, unmatched: 0 };
    ctx.progress(0.92, "Placing the overlays on the recording");
    const r = alignOverlays(plan.overlays, transcript);
    const project = getProject(id);
    const placed = normalizePlan({ ...plan, overlays: r.overlays.filter((o) => Number.isFinite(o.start)) }, project, ctx.settings).overlays;
    const unplaced = r.overlays.filter((o) => !Number.isFinite(o.start));
    savePlan(id, { ...plan, overlays: [...placed, ...unplaced], scriptMode: false, aligned: { at: new Date().toISOString(), matched: r.matched, unmatched: r.unmatched } });
    ctx.log(`Placed ${r.matched} overlay(s); ${r.unmatched} not found in the recording.`);
    return { transcribed: true, matched: r.matched, unmatched: r.unmatched };
  }));
}));
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
  const isImage = req.body?.kind === "image";
  let cmd, args;
  if (process.platform === "darwin") {
    cmd = "osascript";
    args = ["-e", `tell application "System Events"`, "-e", "activate", "-e", `POSIX path of (choose file of type {${isImage ? '"public.image"' : '"public.movie"'}} with prompt ${JSON.stringify(prompt)})`, "-e", "end tell"];
  } else if (process.platform === "win32") {
    cmd = "powershell";
    args = ["-NoProfile", "-STA", "-Command", `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Filter = '${isImage ? "Images|*.jpg;*.jpeg;*.png;*.webp" : "Video files|*.mp4;*.mov;*.mkv;*.m4v;*.avi"}|All files|*.*'; $d.Title = ${JSON.stringify(prompt)}; if ($d.ShowDialog() -eq 'OK') { Write-Output $d.FileName }`];
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
  const script = transcript ? null : getScript(id);
  if (!transcript && script == null) throw new Error("Transcribe the video first.");
  const previousPlan = revise ? getPlan(id) : null;
  res.json(jobFor("plan", id, async (ctx) => {
    ctx.progress(0.1, script != null ? "Claude is reading the script and planning overlays" : "Claude is reading the transcript and planning overlays");
    const plan = await planOverlays({ project, transcript, script, settings: ctx.settings, notes, previousPlan, log: ctx.log });
    // A revise must not lose pictures the host chose: carry them over by id when Claude returns the card without one.
    if (previousPlan) for (const o of plan.overlays) { const old = previousPlan.overlays.find((x) => x.id === o.id); if (old && old.type === "image" && o.type === "image" && !o.image && old.image) Object.assign(o, { image: old.image, imageUrl: old.imageUrl, credit: old.credit || o.credit, imagePage: old.imagePage, candidates: old.candidates }); }
    if (previousPlan?.history) plan.history = previousPlan.history;
    plan.history = [...(plan.history || []), { at: plan.meta.createdAt, notes, count: plan.overlays.length }].slice(-20);
    savePlan(id, plan);
    if (plan.overlays.some((o) => o.type === "image" && !o.image)) { ctx.progress(0.9, "Looking for pictures"); await resolvePlanImages(id, plan, ctx.log); savePlan(id, plan); }
    return { overlays: plan.overlays.length, cost: plan.meta.estimatedCostUsd };
  }));
}));
// One click: transcribe (if needed) then plan with Claude. Without a key it stops after the transcript.
app.post("/api/projects/:id/auto", wrap((req, res) => {
  const id = req.params.id;
  needVideo(id);
  const { notes = "" } = req.body || {};
  const project = getProject(id);
  res.json(jobFor("auto", id, async (ctx) => {
    let transcript = getTranscript(id);
    if (!transcript) {
      const sub = { ...ctx, progress: (p, m) => ctx.progress(p === undefined ? undefined : p * 0.7, m) };
      await transcribeProject(id, ctx.settings, sub);
      transcript = getTranscript(id);
    } else ctx.log("Transcript already exists, skipping transcription");
    if (!ctx.settings.apiKey) { ctx.progress(1, "Transcript ready. Connect Claude in Settings to plan the overlays."); return { transcribed: true, planned: false }; }
    ctx.progress(0.72, "Claude is reading the transcript and planning overlays");
    const plan = await planOverlays({ project, transcript, settings: ctx.settings, notes, previousPlan: null, log: ctx.log });
    plan.history = [{ at: plan.meta.createdAt, notes, count: plan.overlays.length }];
    savePlan(id, plan);
    if (plan.overlays.some((o) => o.type === "image" && !o.image)) { ctx.progress(0.95, "Looking for pictures"); await resolvePlanImages(id, plan, ctx.log); savePlan(id, plan); }
    return { transcribed: true, planned: true, overlays: plan.overlays.length, cost: plan.meta.estimatedCostUsd };
  }));
}));
// "Ask for cards": plain requests, one per line, carried out on the current plan.
app.post("/api/projects/:id/requests", wrap((req, res) => {
  const id = req.params.id;
  needVideo(id);
  const text = String(req.body?.text || "");
  const project = getProject(id);
  const transcript = getTranscript(id);
  if (!transcript) throw new Error("Transcribe the video first.");
  const plan = getPlan(id) || { episodeTitle: project.name, summary: "", overlays: [] };
  res.json(jobFor("requests", id, async (ctx) => {
    ctx.progress(0.15, "Claude is reading your requests");
    const { plan: next, result } = await runRequests({ project, transcript, plan, settings: ctx.settings, text, log: ctx.log });
    savePlan(id, next);
    if (next.overlays.some((o) => o.type === "image" && !o.image)) { ctx.progress(0.85, "Looking for pictures"); await resolvePlanImages(id, next, ctx.log); savePlan(id, next); }
    return result;
  }));
}));
app.put("/api/projects/:id/plan", wrap((req, res) => {
  const id = req.params.id;
  const existing = getPlan(id) || { overlays: [] };
  const project = getProject(id);
  const incoming = req.body;
  // keep edits exactly as the editor typed them; only sort and sanitise numbers
  const dur = project.video?.duration;
  const overlays = (incoming.overlays || []).map((o, i) => ({ ...o, start: o.start == null || o.start === "" ? null : Number(o.start), end: o.end == null || o.end === "" ? null : Number(o.end), id: o.id || `ov-${String(i + 1).padStart(3, "0")}` }))
    .filter((o) => OVERLAY_TYPES.includes(o.type) && (o.start == null || (Number.isFinite(o.start) && Number.isFinite(o.end) && o.end > o.start)))
    .map((o) => (o.start == null ? { ...o, start: null, end: null } : { ...o, start: Math.max(0, o.start), end: dur ? Math.min(dur, o.end) : o.end }))
    .sort((a, b) => a.start - b.start);
  res.json(savePlan(id, { ...existing, ...incoming, overlays }));
}));

// ---- previews ----
// ---- pictures for image overlays ----
app.post("/api/projects/:id/overlays/:oid/images/search", wrap(async (req, res) => {
  const plan = getPlan(req.params.id);
  const o = plan?.overlays.find((x) => x.id === req.params.oid);
  if (!o) throw new Error("Overlay not found");
  const query = String(req.body?.query ?? o.query ?? o.title ?? "").trim();
  if (!query) throw new Error("Type what to search for first.");
  o.query = query; o.candidates = await searchImages(query);
  savePlan(req.params.id, plan);
  res.json({ candidates: o.candidates });
}));
app.post("/api/projects/:id/overlays/:oid/images/select", wrap(async (req, res) => {
  const { url, credit, page } = req.body || {};
  if (!url) throw new Error("No image address given.");
  res.json(await setOverlayImage(req.params.id, req.params.oid, { url, credit, page }));
}));
app.post("/api/projects/:id/overlays/:oid/images/focus", wrap((req, res) => {
  const plan = getPlan(req.params.id);
  const o = plan?.overlays.find((x) => x.id === req.params.oid);
  if (!o || !o.image) throw new Error("No picture on this card yet.");
  const { x, y } = req.body || {};
  o.focus = Number.isFinite(x) && Number.isFinite(y) ? { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)), faces: 0, w: 0, h: 0, auto: false } : detectFocus(req.params.id, o.image);
  savePlan(req.params.id, plan);
  res.json(o);
}));
app.post("/api/projects/:id/overlays/:oid/images/file", wrap(async (req, res) => {
  const { filePath, credit = "" } = req.body || {};
  if (!filePath) throw new Error("No file given.");
  res.json(await setOverlayImage(req.params.id, req.params.oid, { filePath, credit }));
}));
function needVideo(id) { if (!getProject(id).video) throw new Error("Add the video first."); }
app.post("/api/projects/:id/overlays/:oid/still", wrap(async (req, res) => { needVideo(req.params.id); res.json(await previewStill(req.params.id, req.params.oid, loadSettings())); }));
app.post("/api/projects/:id/overlays/:oid/clip", wrap((req, res) => {
  const { id, oid } = req.params;
  needVideo(id);
  res.json(jobFor("clip", id, (ctx) => previewClip(id, oid, ctx)));
}));

// ---- export ----
app.post("/api/projects/:id/export", wrap((req, res) => {
  const id = req.params.id;
  needVideo(id);
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
app.use("/", express.static(UI_DIR, { etag: true, setHeaders: (res) => res.setHeader("Cache-Control", "no-cache, must-revalidate") }));

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
