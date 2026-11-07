import fs from "node:fs";
import path from "node:path";
import { runFfmpeg, availableEncoders } from "./ffmpeg.js";

/**
 * Composite rendered overlay sequences onto the video (or onto a transparent canvas).
 * items: [{ framesDir, count, fps, start, end, x, y }]  (x, y in output pixels)
 * mode: "burn" | "alpha" | "proxy"
 */
export async function composite({ video, videoPath, items, mode, codec = "h264", crf = 15, preset = "medium", outPath, clip = null, onProgress, onLog, signal }) {
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
    args.push("-framerate", String(it.fps), "-start_number", "0", "-thread_queue_size", "128", "-i", path.join(it.framesDir, "%05d.png"));
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
  if (mode === "alpha") args.push("-an");
  else if (mode === "proxy") args.push("-map", "0:a?", "-c:a", "aac", "-b:a", "160k");
  else {
    const ac = video.audio?.codec;
    if (["aac", "mp3", "ac3", "eac3", "alac"].includes(ac) || (codec === "prores" && ["pcm_s16le", "pcm_s24le", "aac"].includes(ac))) args.push("-map", "0:a?", "-c:a", "copy");
    else if (codec === "prores") args.push("-map", "0:a?", "-c:a", "pcm_s24le");
    else args.push("-map", "0:a?", "-c:a", "aac", "-b:a", "320k");
  }

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
      case "h264_vt": if (!enc.h264_videotoolbox) throw new Error("h264_videotoolbox is not available in this ffmpeg build");
        args.push("-c:v", "h264_videotoolbox", "-b:v", String(Math.round(targetBps)), "-maxrate", String(Math.round(targetBps * 1.3)), "-bufsize", String(Math.round(targetBps * 2)), "-profile:v", "high", ...color); break;
      case "hevc_vt": if (!enc.hevc_videotoolbox) throw new Error("hevc_videotoolbox is not available in this ffmpeg build");
        args.push("-c:v", "hevc_videotoolbox", "-b:v", String(Math.round(targetBps * 0.75)), "-maxrate", String(Math.round(targetBps)), "-bufsize", String(Math.round(targetBps * 2)), "-tag:v", "hvc1", ...color); break;
      default: args.push("-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-profile:v", "high", ...color);
    }
    args.push("-movflags", "+faststart");
  }
  args.push(outPath);
  if (onLog) onLog(`ffmpeg ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
  await runFfmpeg(args, { onProgress: (sec) => onProgress && onProgress(Math.min(1, sec / duration)), onLog, signal });
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
