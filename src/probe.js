import { spawn } from "node:child_process";
import { BIN } from "./ffmpeg.js";

function parseRate(s) {
  if (!s) return 30;
  const [n, d] = s.split("/").map(Number);
  return d ? n / d : n;
}

export function probe(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(BIN.ffprobe, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe failed: ${err}`));
      const j = JSON.parse(out);
      const v = j.streams.find((s) => s.codec_type === "video");
      const a = j.streams.find((s) => s.codec_type === "audio");
      if (!v) return reject(new Error("No video stream found"));
      const fpsStr = v.avg_frame_rate && v.avg_frame_rate !== "0/0" ? v.avg_frame_rate : v.r_frame_rate;
      resolve({
        width: v.width,
        height: v.height,
        fps: parseRate(fpsStr),
        fpsStr,
        duration: Number(j.format.duration || v.duration || 0),
        codec: v.codec_name,
        pixFmt: v.pix_fmt,
        bitrate: Number(j.format.bit_rate || 0),
        colorPrimaries: v.color_primaries || null,
        colorTrc: v.color_transfer || null,
        colorSpace: v.color_space || null,
        colorRange: v.color_range || null,
        isHdr: /smpte2084|arib-std-b67/.test(v.color_transfer || ""),
        audio: a ? { codec: a.codec_name, channels: a.channels, sampleRate: Number(a.sample_rate) } : null,
        sizeBytes: Number(j.format.size || 0)
      });
    });
  });
}
