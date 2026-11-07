import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { BIN } from "./ffmpeg.js";
import { PYTHON_DIR } from "./paths.js";
import { getProject, saveTranscript, projectFile } from "./projects.js";

/** The default "python3" prefers the private copy the Mac installer puts in ~/.local/python. An explicit path in Settings wins. */
export function resolvePython(pythonPath) {
  const p = (pythonPath || "python3").trim();
  if (p === "python3" || p === "python") {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    for (const c of [path.join(home, ".local", "python", "bin", "python3"), path.join(home, ".local", "python", "python.exe")]) if (fs.existsSync(c)) return c;
  }
  return p;
}

export function pythonStatus(pythonPath = "python3") {
  pythonPath = resolvePython(pythonPath);
  const r = spawnSync(pythonPath, ["-c", "import faster_whisper, sys; print(sys.version.split()[0], faster_whisper.__version__)"], { encoding: "utf8" });
  if (r.status === 0) { const [py, fw] = r.stdout.trim().split(" "); return { ok: true, python: py, fasterWhisper: fw }; }
  const r2 = spawnSync(pythonPath, ["--version"], { encoding: "utf8" });
  return { ok: false, python: r2.status === 0 ? (r2.stdout || r2.stderr).trim() : null, fasterWhisper: null, error: (r.stderr || "").trim().split("\n").pop() };
}

export async function transcribeProject(projectId, settings, ctx) {
  const project = getProject(projectId);
  const out = projectFile(projectId, "transcript.json");
  const args = [path.join(PYTHON_DIR, "transcribe.py"), "--input", project.videoPath, "--output", out,
    "--model", settings.whisperModel, "--language", settings.language, "--ffmpeg", BIN.ffmpeg, "--device", settings.whisperDevice || "auto"];
  ctx.log(`Transcribing with faster-whisper (${settings.whisperModel}, language=${settings.language})`);
  ctx.progress(0.01, "Starting transcription");
  await new Promise((resolve, reject) => {
    const child = spawn(resolvePython(settings.pythonPath), args, { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" } });
    let err = "";
    child.stdout.on("data", (d) => {
      for (const line of d.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        const m = line.match(/^PROGRESS ([\d.]+) ([\d.]+)/);
        if (m) { const total = Number(m[2]) || project.video.duration || 1; ctx.progress(0.05 + 0.95 * Math.min(1, Number(m[1]) / total), `Transcribed ${fmt(Number(m[1]))} of ${fmt(total)}`); }
        else ctx.log(line);
      }
    });
    child.stderr.on("data", (d) => { const s = d.toString(); err += s; if (!/it\/s|%\|/.test(s)) ctx.log(s.trim()); });
    ctx.signal?.addEventListener("abort", () => child.kill("SIGKILL"));
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Transcription failed (exit ${code}). ${err.trim().split("\n").slice(-3).join(" ")}`)));
  });
  const t = JSON.parse(fs.readFileSync(out, "utf8"));
  ctx.log(`Transcript: ${t.segments.length} segments, language ${t.language}`);
  return t;
}

/** Import an existing SRT or VTT subtitle file as the transcript. */
export function importSubtitles(projectId, text, duration) {
  const segments = [];
  const blocks = text.replace(/\r/g, "").split(/\n\n+/);
  const ts = (s) => { const m = s.trim().match(/(\d+):(\d+):(\d+)[.,](\d+)/) || s.trim().match(/(\d+):(\d+)[.,](\d+)/); if (!m) return null;
    return m.length === 5 ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000 : (+m[1]) * 60 + (+m[2]) + (+m[3]) / 1000; };
  for (const b of blocks) {
    const lines = b.split("\n").filter((l) => l.trim() && !/^WEBVTT/.test(l));
    const ti = lines.findIndex((l) => l.includes("-->"));
    if (ti < 0) continue;
    const [a, c] = lines[ti].split("-->");
    const start = ts(a), end = ts(c);
    if (start == null || end == null) continue;
    const txt = lines.slice(ti + 1).join(" ").replace(/<[^>]+>/g, "").trim();
    if (txt) segments.push({ id: segments.length, start, end, text: txt, words: [] });
  }
  if (!segments.length) throw new Error("No subtitle cues found in the file");
  const t = { language: "unknown", duration, model: "imported-subtitles", segments, createdAt: new Date().toISOString() };
  saveTranscript(projectId, t);
  return t;
}

function fmt(s) { const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${m}:${String(r).padStart(2, "0")}`; }
