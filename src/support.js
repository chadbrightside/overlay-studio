// Builds a support report: a zip on the Desktop with the app log, recent job logs, settings (key removed)
// and the state of every project. Nothing in it is a video, a transcript or the API key.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, DATA_DIR, PROJECTS_DIR } from "./paths.js";
import { loadSettings } from "./config.js";
import { listProjects, getProject, getPlan } from "./projects.js";
import { listJobs } from "./jobs.js";
import { LOG_DIR, JOB_LOG_DIR, APP_LOG, readAppLog } from "./log.js";
import { resolvePython } from "./transcribe.js";

function pkgVersion() { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version; } catch { return "?"; } }

function dirSize(dir) {
  let total = 0;
  try { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); total += f.isDirectory() ? dirSize(p) : fs.statSync(p).size; } } catch {}
  return total;
}

function projectSummary(p) {
  let plan = null;
  try { plan = getPlan(p.id); } catch {}
  const overlays = plan?.overlays || [];
  const byType = {};
  for (const o of overlays) byType[o.type] = (byType[o.type] || 0) + 1;
  let dir = null;
  try { dir = path.join(PROJECTS_DIR, p.id); } catch {}
  return {
    id: p.id, name: p.name, createdAt: p.createdAt,
    video: p.video ? { width: p.video.width, height: p.video.height, fps: p.video.fps, duration: p.video.duration, sizeBytes: p.video.sizeBytes, codec: p.video.codec, isHdr: p.video.isHdr, path: p.videoPath || p.video.path } : null,
    status: p.status,
    overlays: overlays.length, byType, unplaced: overlays.filter((o) => !Number.isFinite(o.start)).length,
    renders: (p.renders || []).map((r) => ({ name: r.name, size: r.size, mtime: r.mtime })),
    planMeta: plan?.meta || null,
    folderBytes: dir ? dirSize(dir) : null
  };
}

export async function buildSupportReport({ health } = {}) {
  const s = loadSettings();
  const settings = { ...s, apiKey: s.apiKey ? `set (${s.apiKey.length} chars, starts ${s.apiKey.slice(0, 7)})` : "not set" };
  const projects = [];
  for (const p of listProjects()) { try { projects.push(projectSummary(getProject(p.id))); } catch (e) { projects.push({ id: p.id, error: e.message }); } }
  const report = {
    createdAt: new Date().toISOString(),
    app: { version: pkgVersion(), root: ROOT, dataDir: DATA_DIR },
    system: { platform: process.platform, arch: process.arch, release: os.release(), node: process.version, cpus: os.cpus().length, cpu: os.cpus()[0]?.model, memoryGB: Math.round(os.totalmem() / 1e9), freeMemoryGB: Math.round(os.freemem() / 1e9 * 10) / 10, uptimeHours: Math.round(os.uptime() / 360) / 10, home: os.homedir(), user: os.userInfo().username, locale: Intl.DateTimeFormat().resolvedOptions().locale, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    health: health || null,
    settings,
    projects,
    jobsInMemory: listJobs().slice(0, 20),
    packages: (() => { try { const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8")); const want = ["@anthropic-ai/sdk", "playwright", "ffmpeg-static", "express", "flag-icons"]; return Object.fromEntries(want.map((n) => [n, lock.packages?.["node_modules/" + n]?.version || "?"])); } catch { return null; } })(),
    python: (() => { try { const out = spawnSync(resolvePython(s.pythonPath), ["-c", "import sys,faster_whisper;import cv2;print(sys.version.split()[0], faster_whisper.__version__, cv2.__version__)"], { encoding: "utf8", timeout: 20000 }); return { stdout: out.stdout?.trim(), stderr: out.stderr?.trim().slice(-800), status: out.status }; } catch (e) { return { error: e.message }; } })(),
    disk: (() => { try { const out = spawnSync("df", ["-h", ROOT], { encoding: "utf8" }); return out.stdout?.trim(); } catch { return null; } })()
  };
  return report;
}


export async function writeSupportReport(opts = {}) {
  const report = await buildSupportReport(opts);
  const d = new Date(), two = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}h${two(d.getMinutes())}`;
  const base = `Sardiye Studio report ${stamp}`;
  const desktop = path.join(os.homedir(), "Desktop");
  const outDir = fs.existsSync(desktop) ? desktop : os.homedir();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "sardiye-report-"));
  const folder = path.join(work, base);
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(folder, "app.log"), readAppLog());
  try { const prev = APP_LOG.replace(/\.log$/, ".previous.log"); if (fs.existsSync(prev)) fs.copyFileSync(prev, path.join(folder, "app.previous.log")); } catch {}
  try {
    fs.mkdirSync(path.join(folder, "jobs"));
    for (const f of fs.readdirSync(JOB_LOG_DIR).filter((f) => f.endsWith(".json")).sort().slice(-40)) fs.copyFileSync(path.join(JOB_LOG_DIR, f), path.join(folder, "jobs", f));
  } catch {}
  // plans are small text; include them so the cards can be reproduced here
  try {
    fs.mkdirSync(path.join(folder, "plans"));
    for (const p of listProjects()) { const src = path.join(PROJECTS_DIR, p.id, "plan.json"); if (fs.existsSync(src)) fs.copyFileSync(src, path.join(folder, "plans", `${p.id}.json`)); }
  } catch {}
  const zipPath = path.join(outDir, `${base}.zip`);
  try { fs.unlinkSync(zipPath); } catch {}
  let zipped = false;
  if (process.platform === "win32") {
    const r = spawnSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${folder.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`], { encoding: "utf8" });
    zipped = r.status === 0 && fs.existsSync(zipPath);
  } else {
    const r = spawnSync("zip", ["-r", "-q", zipPath, base], { cwd: work, encoding: "utf8" });
    zipped = r.status === 0 && fs.existsSync(zipPath);
  }
  let out = zipPath;
  if (!zipped) { out = path.join(outDir, base); fs.rmSync(out, { recursive: true, force: true }); fs.cpSync(folder, out, { recursive: true }); }
  fs.rmSync(work, { recursive: true, force: true });
  return { path: out, zipped, projects: report.projects.length, logDir: LOG_DIR };
}
