import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function which(bin) {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [bin], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim().split(/\r?\n/)[0] : null;
}

function resolveBinaries() {
  const ffmpeg = process.env.FFMPEG_PATH || which("ffmpeg") || safe(() => require("ffmpeg-static"));
  const ffprobe = process.env.FFPROBE_PATH || which("ffprobe") || safe(() => require("@ffprobe-installer/ffprobe").path);
  return { ffmpeg, ffprobe };
}
function safe(fn) { try { return fn(); } catch { return null; } }

export const BIN = resolveBinaries();

export function ffmpegAvailable() {
  return Boolean(BIN.ffmpeg && fs.existsSync(BIN.ffmpeg) && BIN.ffprobe && fs.existsSync(BIN.ffprobe));
}

let encoderCache = null;
export function availableEncoders() {
  if (encoderCache) return encoderCache;
  const r = spawnSync(BIN.ffmpeg, ["-hide_banner", "-encoders"], { encoding: "utf8" });
  const text = r.stdout || "";
  encoderCache = {
    libx264: /\blibx264\b/.test(text),
    libx265: /\blibx265\b/.test(text),
    prores_ks: /\bprores_ks\b/.test(text),
    h264_videotoolbox: /\bh264_videotoolbox\b/.test(text),
    hevc_videotoolbox: /\bhevc_videotoolbox\b/.test(text),
    h264_nvenc: /\bh264_nvenc\b/.test(text),
    hevc_nvenc: /\bhevc_nvenc\b/.test(text)
  };
  return encoderCache;
}

/** Run ffmpeg with -progress on stdout; onProgress(seconds) is called as it encodes. */
export function runFfmpeg(args, { onProgress, onLog, signal } = {}) {
  return new Promise((resolve, reject) => {
    const full = ["-hide_banner", "-y", "-nostats", "-progress", "pipe:1", ...args];
    const child = spawn(BIN.ffmpeg, full, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    const stats = { fps: 0, speed: 0 };
    child.stdout.on("data", (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        let m;
        if ((m = line.match(/^fps=\s*([\d.]+)/))) stats.fps = Number(m[1]);
        else if ((m = line.match(/^speed=\s*([\d.]+)x/))) stats.speed = Number(m[1]);
        else if ((m = line.match(/^out_time_us=(\d+)/) || line.match(/^out_time_ms=(\d+)/)) && onProgress) onProgress(Number(m[1]) / 1e6, stats);
      }
    });
    child.stderr.on("data", (chunk) => {
      const s = chunk.toString();
      stderr += s;
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
      if (onLog) onLog(s);
    });
    if (signal) signal.addEventListener("abort", () => child.kill("SIGKILL"));
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}\n${stderr.slice(-3000)}`)));
  });
}
