// Keeps a copy of everything the app prints in data/logs/app.log, so a support report can include it.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths.js";

export const LOG_DIR = path.join(DATA_DIR, "logs");
export const JOB_LOG_DIR = path.join(LOG_DIR, "jobs");
export const APP_LOG = path.join(LOG_DIR, "app.log");
const MAX_BYTES = 2 * 1024 * 1024;

fs.mkdirSync(JOB_LOG_DIR, { recursive: true });

function rotate() {
  try { if (fs.statSync(APP_LOG).size > MAX_BYTES) fs.renameSync(APP_LOG, APP_LOG.replace(/\.log$/, ".previous.log")); } catch {}
}

export function appendLog(level, parts) {
  const text = parts.map((p) => (p instanceof Error ? (p.stack || p.message) : typeof p === "string" ? p : JSON.stringify(p))).join(" ");
  try { rotate(); fs.appendFileSync(APP_LOG, `${new Date().toISOString()} ${level} ${text}\n`); } catch {}
}

export function installConsoleLog() {
  for (const level of ["log", "info", "warn", "error"]) {
    const orig = console[level].bind(console);
    console[level] = (...args) => { orig(...args); appendLog(level.toUpperCase(), args); };
  }
  process.on("uncaughtException", (e) => { appendLog("FATAL", [e]); console.error(e); });
  process.on("unhandledRejection", (e) => appendLog("REJECTION", [e instanceof Error ? e : String(e)]));
  appendLog("INFO", [`---- app started, pid ${process.pid}, node ${process.version}, ${process.platform} ${process.arch}`]);
}

// Saves a finished job (its log included) so problems can be looked at after the app restarts. Keeps the last 40.
export function persistJob(job) {
  try {
    const name = `${job.startedAt.replace(/[:.]/g, "-")}-${job.kind}-${job.id}.json`;
    fs.writeFileSync(path.join(JOB_LOG_DIR, name), JSON.stringify(job, null, 2));
    const files = fs.readdirSync(JOB_LOG_DIR).filter((f) => f.endsWith(".json")).sort();
    for (const f of files.slice(0, Math.max(0, files.length - 40))) fs.unlinkSync(path.join(JOB_LOG_DIR, f));
  } catch (e) { appendLog("WARN", [`could not persist job ${job.id}: ${e.message}`]); }
}

export function readAppLog(maxBytes = 400_000) {
  try {
    const size = fs.statSync(APP_LOG).size;
    const fd = fs.openSync(APP_LOG, "r");
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    return buf.toString("utf8");
  } catch { return ""; }
}
