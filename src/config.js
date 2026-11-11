import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./paths.js";

const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

export const DEFAULT_SETTINGS = {
  apiKey: "",
  uiLanguage: "en",
  uiTheme: "dark",         // light | dark
  model: "claude-opus-5-5",
  effort: "high",
  pythonPath: "python3",
  whisperModel: "large-v3",
  whisperDevice: "auto",
  language: "auto",          // spoken language code or "auto"
  overlayLanguage: "same",   // "same" as speech, or a language code (ar, en, tr, fr ...)
  density: "normal",         // light | normal | rich
  channelBrief: "Political commentary channel. The host analyses current events for a general audience.",
  brand: {
    accent: "#E8B23A",
    accent2: "#1F7AE0",
    panel: "#0B0F1A",
    text: "#FFFFFF",
    fontLatin: "Inter",
    fontArabic: "Cairo",
    position: "top-left",    // default corner for overlays
    logoCorner: "top-right",  // where the channel logo sits on the video; cards keep clear of it
    scale: 1.0,              // size multiplier
    safeMargin: 0.05,        // fraction of width/height kept clear at the edges
    channelName: "",
    showLogo: false
  },
  render: {
    burnCodec: "h264",       // h264 | hevc | prores | h264_vt | hevc_vt
    burnCrf: 15,
    burnPreset: "medium"
  }
};

function deepMerge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object") out[k] = deepMerge(base[k], v);
    else out[k] = v;
  }
  return out;
}

export function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); } catch {}
  const s = deepMerge(DEFAULT_SETTINGS, saved);
  if (!s.apiKey && process.env.ANTHROPIC_API_KEY) s.apiKey = process.env.ANTHROPIC_API_KEY;
  return s;
}

export function saveSettings(patch) {
  const current = loadSettings();
  const next = deepMerge(current, patch);
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return next;
}

export function publicSettings(s) {
  return { ...s, apiKey: s.apiKey ? `${s.apiKey.slice(0, 10)}…${s.apiKey.slice(-4)}` : "", hasApiKey: Boolean(s.apiKey) };
}
