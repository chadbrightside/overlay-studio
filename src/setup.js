// One-time environment check. Run with: npm run setup
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { loadSettings } from "./config.js";
import { BIN, ffmpegAvailable } from "./ffmpeg.js";
import { pythonStatus, resolvePython } from "./transcribe.js";

const ok = (m) => console.log(`  ✔ ${m}`);
const bad = (m) => console.log(`  ✖ ${m}`);
console.log("\nSardiye Studio setup check\n");

const major = Number(process.version.slice(1).split(".")[0]);
major >= 20 ? ok(`Node ${process.version}`) : bad(`Node ${process.version} is too old. Install Node 20 or newer from nodejs.org`);

if (ffmpegAvailable()) ok(`ffmpeg: ${BIN.ffmpeg}`); else bad("ffmpeg/ffprobe not found. Run: npm install");

let chromiumPath = null;
try { const { chromium } = await import("playwright"); chromiumPath = chromium.executablePath(); } catch {}
if (chromiumPath && fs.existsSync(chromiumPath)) ok("Chromium (render engine) installed");
else {
  console.log("  … downloading Chromium for rendering (one time, ~150 MB)");
  const r = spawnSync("npx", ["playwright", "install", "chromium"], { stdio: "inherit", shell: process.platform === "win32" });
  r.status === 0 ? ok("Chromium installed") : bad("Chromium download failed. Run manually: npx playwright install chromium");
}

const s = loadSettings();
const py = pythonStatus(s.pythonPath);
if (py.ok) ok(`Python ${py.python} with faster-whisper ${py.fasterWhisper}`);
else if (py.python) {
  console.log(`  … ${py.python} found, installing faster-whisper`);
  const py = resolvePython(s.pythonPath);
  const r = spawnSync(py, ["-m", "pip", "install", ...(py.includes(".local/python") ? [] : ["--user"]), "faster-whisper", "av<16"], { stdio: "inherit" });
  const again = pythonStatus(s.pythonPath);
  again.ok ? ok(`faster-whisper ${again.fasterWhisper} installed`) : bad("faster-whisper could not be installed. See GUIDE.md, section Transcription.");
} else bad(`Python not found (${s.pythonPath}). Install Python 3.9+ from python.org, then run npm run setup again. You can also import SRT subtitles instead of transcribing.`);

s.apiKey ? ok("Claude API key is set") : console.log("  • No Claude API key yet. Start the app and paste it in Settings.");
console.log("\nStart the app with:  npm start\n");
