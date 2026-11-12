import fs from "node:fs";
import path from "node:path";
import { runFfmpeg, availableEncoders } from "./ffmpeg.js";

/**
 * Composite rendered overlay sequences onto the video (or onto a transparent canvas).
 * items: [{ framesDir, count, fps, start, end, x, y }]  (x, y in output pixels)
 * mode: "burn" | "alpha" | "proxy"
 */
/** "auto" (and the old default "h264") means: the Mac's hardware encoder when there is one, otherwise software x264. */
export function resolveCodec(codec) {
  const enc = availableEncoders();
  if (!codec || codec === "auto" || codec === "h264") {
    if (process.platform === "darwin" && enc.h264_videotoolbox) return "h264_vt";
    return "h264_sw";
  }
  if (codec === "h264_vt" && !enc.h264_videotoolbox) return "h264_sw";
  if (codec === "hevc_vt" && !enc.hevc_videotoolbox) return "hevc";
  return codec;
}
export const CODEC_LABELS = { h264_vt: "H.264, Apple hardware", hevc_vt: "HEVC, Apple hardware", h264_sw: "H.264 software (x264)", hevc: "HEVC software (x265)", prores: "ProRes 422 HQ" };

const MAX_INPUTS = 8; // overlay sequences open at once; each 4K input costs ffmpeg ~100 MB, so 46 at once swamps a small Mac

/**
 * Composite the overlays onto the video. With many overlays the work is split into segments of at most MAX_INPUTS
 * overlays, each encoded with identical settings, joined without re-encoding, and the original audio muxed in last.
 */
export async function composite({ video, videoPath, items, mode, codec = "auto", crf = 15, preset = "medium", outPath, clip = null, onProgress, onLog, signal }) {
  codec = resolveCodec(codec);
  const used = items.filter((it) => it.count > 0 && (!clip || (it.end > clip.start && it.start < clip.end)));
  if (used.length <= MAX_INPUTS) return compositeOnce({ video, videoPath, items, mode, codec, crf, preset, outPath, clip, onProgress, onLog, signal });

  const fps = video.fps;
  const total = clip ? clip.end - clip.start : video.duration;
  const t0 = clip ? clip.start : 0;
  // segment boundaries fall in the gap between two groups of overlays, snapped to the frame grid
  const sorted = [...used].sort((a, b) => a.start - b.start);
  const bounds = [t0];
  for (let i = MAX_INPUTS; i < sorted.length; i += MAX_INPUTS) {
    const gapMid = (sorted[i - 1].end + sorted[i].start) / 2;
    bounds.push(Math.round(Math.max(sorted[i - 1].end, Math.min(sorted[i].start, gapMid)) * fps) / fps);
  }
  bounds.push(t0 + total);
  const segs = [];
  for (let i = 0; i < bounds.length - 1; i++) if (bounds[i + 1] > bounds[i]) segs.push({ start: bounds[i], end: bounds[i + 1] });
  if (onLog) onLog(`Encoding in ${segs.length} segments of up to ${MAX_INPUTS} overlays each, joined without re-encoding\n`);
  const ext = path.extname(outPath);
  const partPaths = [];
  try {
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const part = outPath.replace(ext, `.part${String(i).padStart(2, "0")}${ext}`);
      partPaths.push(part);
      await compositeOnce({ video, videoPath, items, mode, codec, crf, preset, outPath: part, clip: seg, audio: false, exactFrames: true, onLog, signal,
        onProgress: (f, st) => onProgress && onProgress(((seg.start - t0) + f * (seg.end - seg.start)) / total, { ...st, seconds: (seg.start - t0) + f * (seg.end - seg.start), duration: total }) });
    }
    const listPath = outPath + ".concat.txt";
    fs.writeFileSync(listPath, partPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
    const args = ["-f", "concat", "-safe", "0", "-i", listPath];
    if (mode !== "alpha") {
      if (clip) args.push("-ss", clip.start.toFixed(3), "-t", total.toFixed(3));
      args.push("-i", videoPath, "-map", "0:v", "-map", "1:a?", ...audioArgs(video, mode, codec));
    } else args.push("-map", "0:v", "-an");
    args.push("-c:v", "copy", "-movflags", "+faststart", outPath);
    await runFfmpeg(args, { onLog, signal });
    try { fs.unlinkSync(listPath); } catch {}
  } finally { for (const p of partPaths) { try { fs.unlinkSync(p); } catch {} } }
  return outPath;
}

function audioArgs(video, mode, codec) {
  if (mode === "alpha") return ["-an"];
  if (mode === "proxy") return ["-c:a", "aac", "-b:a", "160k"];
  const ac = video.audio?.codec;
  if (["aac", "mp3", "ac3", "eac3", "alac"].includes(ac) || (codec === "prores" && ["pcm_s16le", "pcm_s24le", "aac"].includes(ac))) return ["-c:a", "copy"];
  if (codec === "prores") return ["-c:a", "pcm_s24le"];
  return ["-c:a", "aac", "-b:a", "320k"];
}

async function compositeOnce({ video, videoPath, items, mode, codec, crf, preset, outPath, clip, audio = true, exactFrames = false, onProgress, onLog, signal }) {
  const fpsStr = video.fpsStr || String(video.fps);
  const args = [];
  const scriptLines = [];
  const outW = mode === "proxy" ? 1920 : video.width;
  const outH = mode === "proxy" ? Math.round((1920 * video.height) / video.width / 2) * 2 : video.height;
  const clipStart = clip ? clip.start : 0;
  const duration = clip ? clip.end - clip.start : video.duration;

  if (mode === "alpha") {
    args.push("-f", "lavfi", "-i", `color=c=black@0.0:s=${outW}x${outH}:r=${fpsStr}:d=${duration.toFixed(3)},format=rgba`);
  } else {
    if (clip) args.push("-ss", clipStart.toFixed(3), "-t", duration.toFixed(3));
    args.push("-i", videoPath);
  }
  let base = "[0:v]";
  if (mode === "proxy") { scriptLines.push(`[0:v]scale=${outW}:${outH}:flags=bicubic[base0]`); base = "[base0]"; }
  else if (mode === "alpha") { scriptLines.push(`[0:v]format=rgba[base0]`); base = "[base0]"; }

  const used = items.filter((it) => it.count > 0 && it.end > clipStart && it.start < clipStart + duration);
  used.forEach((it, i) => {
    const idx = i + 1;
    args.push("-framerate", String(it.fps), "-start_number", "0", "-thread_queue_size", "8", "-i", path.join(it.framesDir, "%05d.png"));
    const s = Math.max(0, it.start - clipStart);
    const e = Math.max(0, it.end - clipStart);
    scriptLines.push(`[${idx}:v]format=rgba,setpts=PTS-STARTPTS+${s.toFixed(3)}/TB[ov${idx}]`);
    scriptLines.push(`${base}[ov${idx}]overlay=x=${it.x}:y=${it.y}:eof_action=pass:format=auto:enable='between(t,${s.toFixed(3)},${e.toFixed(3)})'[b${idx}]`);
    base = `[b${idx}]`;
  });
  const finalFmt = mode === "alpha" ? "yuva444p10le" : (codec === "prores" ? "yuv422p10le" : "yuv420p");
  scriptLines.push(`${base}format=${finalFmt}[out]`);
  const scriptPath = outPath + ".filter.txt";
  fs.writeFileSync(scriptPath, scriptLines.join(";\n"));
  args.push("-filter_complex_script", scriptPath, "-map", "[out]");

  // audio
  if (mode === "alpha" || !audio) args.push("-an");
  else args.push("-map", "0:a?", ...audioArgs(video, mode, codec));
  // segments must carry exactly their share of frames so the joined file keeps sync
  if (exactFrames && mode !== "alpha") args.push("-fps_mode", "cfr", "-r", fpsStr, "-frames:v", String(Math.round(duration * video.fps)));

  // video encoder
  const enc = availableEncoders();
  const color = [];
  if (video.colorPrimaries && video.colorPrimaries !== "unknown") color.push("-color_primaries", video.colorPrimaries);
  if (video.colorTrc && video.colorTrc !== "unknown") color.push("-color_trc", video.colorTrc);
  if (video.colorSpace && video.colorSpace !== "unknown") color.push("-colorspace", video.colorSpace);
  if (video.colorRange && video.colorRange !== "unknown") color.push("-color_range", video.colorRange);

  if (mode === "alpha") {
    args.push("-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le", "-vendor", "apl0", "-r", fpsStr, "-frames:v", String(Math.round(duration * video.fps)));
  } else if (mode === "proxy") {
    args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart");
  } else {
    const is4k = video.width >= 3000;
    const targetBps = Math.max(video.bitrate * 1.6, is4k ? 70e6 : 25e6);
    switch (codec) {
      case "hevc": args.push("-c:v", "libx265", "-preset", preset, "-crf", String(Math.max(0, crf + 2)), "-tag:v", "hvc1", ...color); break;
      case "prores": args.push("-c:v", "prores_ks", "-profile:v", "3", "-vendor", "apl0", ...color); break;
      case "h264_vt":
        args.push("-c:v", "h264_videotoolbox", "-b:v", String(Math.round(targetBps)), "-maxrate", String(Math.round(targetBps * 1.3)), "-bufsize", String(Math.round(targetBps * 2)), "-profile:v", "high", ...color); break;
      case "hevc_vt":
        args.push("-c:v", "hevc_videotoolbox", "-b:v", String(Math.round(targetBps * 0.75)), "-maxrate", String(Math.round(targetBps)), "-bufsize", String(Math.round(targetBps * 2)), "-tag:v", "hvc1", ...color); break;
      default: args.push("-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-profile:v", "high", ...color);
    }
    args.push("-movflags", "+faststart");
  }
  args.push(outPath);
  if (onLog) onLog(`ffmpeg ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
  await runFfmpeg(args, { onProgress: (sec, stats) => onProgress && onProgress(Math.min(1, sec / duration), { ...stats, seconds: sec, duration }), onLog, signal });
  try { fs.unlinkSync(scriptPath); } catch {}
  return outPath;
}

export async function extractFrame(videoPath, time, outPath, width = 960) {
  await runFfmpeg(["-ss", time.toFixed(3), "-i", videoPath, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "3", outPath]);
  return outPath;
}

export function outputExtension(mode, codec) {
  if (mode === "alpha") return ".mov";
  if (mode === "proxy") return ".mp4";
  return codec === "prores" ? ".mov" : ".mp4";
}
