import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getProject, getPlan, getTranscript, projectFile } from "./projects.js";
import { Renderer, designFor, themeFor, overlaySpec } from "./renderer.js";
import { composite, extractFrame, outputExtension } from "./compose.js";
import { TEMPLATES_DIR } from "./paths.js";

const RENDER_WORKERS = Math.max(1, Math.min(4, Number(process.env.RENDER_WORKERS) || 3));

function hashOf(obj) { return crypto.createHash("sha1").update(JSON.stringify(obj)).digest("hex").slice(0, 12); }
let templatesHash = null;
function templatesVersion() {
  if (!templatesHash) templatesHash = hashOf(["index.html", "overlays.css", "overlays.js"].map((f) => fs.readFileSync(path.join(TEMPLATES_DIR, f), "utf8")));
  return templatesHash;
}

function frameSetDir(projectId, mode, overlayId) {
  return projectFile(projectId, path.join("frames", mode === "burn" ? "full" : "proxy", overlayId));
}

/** Render frames for each enabled overlay (cached by content hash). Returns compositor items. */
export async function renderOverlayFrames(projectId, { mode, overlayIds = null, ctx, progressRange = [0, 1] }) {
  const project = getProject(projectId);
  const plan = getPlan(projectId);
  const transcript = getTranscript(projectId);
  const settings = ctx.settings;
  if (!plan) throw new Error("No overlay plan yet. Run Plan first.");
  const design = designFor(project.video, { proxy: mode !== "burn" });
  const theme = themeFor(settings, transcript?.language || "en", design);
  const fps = project.video.fps;
  const overlays = plan.overlays.filter((o) => o.enabled !== false && (!overlayIds || overlayIds.includes(o.id)));
  const items = [];
  const todo = [];
  for (const o of overlays) {
    const spec = overlaySpec(o);
    const key = hashOf({ spec, brand: theme.brand, labels: theme.labels, dsf: design.dsf, fps, t: templatesVersion() });
    const dir = frameSetDir(projectId, mode, o.id);
    const metaPath = path.join(dir, "meta.json");
    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(metaPath, "utf8")); } catch {}
    if (meta && meta.key === key && fs.existsSync(path.join(dir, `${String(meta.count - 1).padStart(5, "0")}.png`))) {
      items.push({ ...meta, framesDir: dir, start: o.start, end: o.end, id: o.id });
    } else todo.push({ o, spec, key, dir });
  }
  const [p0, p1] = progressRange;
  if (todo.length) {
    ctx.log(`Rendering ${todo.length} overlay(s) at ${design.outW}x${design.outH} (${todo.length === overlays.length ? "all" : "changed only"}, ${overlays.length - todo.length} cached)`);
    const workers = Math.min(RENDER_WORKERS, todo.length);
    const r = new Renderer(design, theme);
    await r.open(workers);
    const totalFrames = todo.reduce((s, t) => s + Math.max(1, Math.round(t.spec.duration * fps)), 0);
    const doneFrames = new Map();
    const report = () => { const done = [...doneFrames.values()].reduce((a, b) => a + b, 0); ctx.progress(p0 + (p1 - p0) * (done / totalFrames)); };
    let next = 0, finished = 0;
    try {
      await Promise.all(r.pages.map(async (page) => {
        while (next < todo.length) {
          const { o, spec, key, dir } = todo[next++];
          const n = Math.max(1, Math.round(spec.duration * fps));
          ctx.progress(undefined, `Rendering ${o.id} (${o.type}), ${finished}/${todo.length} done`);
          const meta = await r.frames(spec, fps, dir, { signal: ctx.signal, page, onProgress: (f) => { doneFrames.set(o.id, f * n); report(); } });
          meta.key = key;
          fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta));
          items.push({ ...meta, framesDir: dir, start: o.start, end: o.end, id: o.id });
          finished++;
        }
      }));
    } finally { await r.close(); }
  }
  items.sort((a, b) => a.start - b.start);
  return { project, plan, items, design };
}

export async function renderExport(projectId, { mode = "burn", codec, crf, preset }, ctx) {
  const settings = ctx.settings;
  codec = codec || settings.render?.burnCodec || "h264";
  crf = crf ?? settings.render?.burnCrf ?? 15;
  preset = preset || settings.render?.burnPreset || "medium";
  const { project, items } = await renderOverlayFrames(projectId, { mode, ctx, progressRange: [0, mode === "burn" ? 0.25 : 0.4] });
  if (project.video.isHdr && mode === "burn") ctx.log("WARNING: the source looks like HDR (PQ/HLG). Overlays are composited in SDR; check the result or export the alpha overlay track instead.");
  const outDir = projectFile(projectId, "renders");
  fs.mkdirSync(outDir, { recursive: true });
  const d = new Date();
  const stamp = [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()].map((n, i) => String(n).padStart(i ? 2 : 4, "0")).join("-");
  const label = mode === "alpha" ? "overlays-alpha" : mode === "proxy" ? "preview-1080p" : `final-${codec}`;
  const outPath = path.join(outDir, `${project.id}-${label}-${stamp}${outputExtension(mode, codec)}`);
  const p0 = mode === "burn" ? 0.25 : 0.4;
  ctx.progress(p0, mode === "alpha" ? "Encoding alpha overlay track (ProRes 4444)" : mode === "proxy" ? "Encoding 1080p preview" : `Encoding final video (${codec})`);
  await composite({ video: project.video, videoPath: project.videoPath, items, mode, codec, crf, preset, outPath,
    onProgress: (f) => ctx.progress(p0 + (1 - p0) * f), onLog: (s) => { if (/error|invalid|failed/i.test(s)) ctx.log(s.trim()); }, signal: ctx.signal });
  ctx.log(`Done: ${outPath}`);
  return { path: outPath, name: path.basename(outPath), size: fs.statSync(outPath).size };
}

/** Quick 1080p clip of a single overlay, with 1.5 s of context on each side. */
export async function previewClip(projectId, overlayId, ctx) {
  const { project, plan, items } = await renderOverlayFrames(projectId, { mode: "proxy", overlayIds: [overlayId], ctx, progressRange: [0, 0.6] });
  const o = plan.overlays.find((x) => x.id === overlayId);
  if (!o) throw new Error("Overlay not found");
  const clip = { start: Math.max(0, o.start - 1.5), end: Math.min(project.video.duration, o.end + 1.5) };
  const outDir = projectFile(projectId, "previews");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${overlayId}-${items[0]?.key || "x"}.mp4`);
  if (!fs.existsSync(outPath)) {
    ctx.progress(0.6, "Encoding preview clip");
    await composite({ video: project.video, videoPath: project.videoPath, items, mode: "proxy", outPath, clip, onProgress: (f) => ctx.progress(0.6 + 0.4 * f), signal: ctx.signal });
  }
  return { url: `/api/projects/${projectId}/files/previews/${path.basename(outPath)}`, start: clip.start };
}

/** Still thumbnail: overlay PNG at its mid-point plus the matching video frame, composed in the browser. */
export async function previewStill(projectId, overlayId, settings) {
  const project = getProject(projectId);
  const plan = getPlan(projectId);
  const transcript = getTranscript(projectId);
  const o = plan?.overlays.find((x) => x.id === overlayId);
  if (!o) throw new Error("Overlay not found");
  const design = designFor(project.video, { proxy: true });
  const theme = themeFor(settings, transcript?.language || "en", design);
  const spec = overlaySpec(o);
  const key = hashOf({ spec, brand: theme.brand, labels: theme.labels, t: templatesVersion() });
  const outDir = projectFile(projectId, "previews");
  fs.mkdirSync(outDir, { recursive: true });
  const png = path.join(outDir, `${overlayId}-${key}.png`);
  const metaPath = png + ".json";
  const frameTime = Math.min(project.video.duration - 0.1, o.start + Math.min(1.5, spec.duration / 2));
  const jpg = path.join(outDir, `${overlayId}-frame-${Math.round(frameTime * 10)}.jpg`);
  let rect;
  if (fs.existsSync(png) && fs.existsSync(metaPath)) rect = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  else {
    const r = new Renderer(design, theme);
    await r.open();
    try { rect = await r.still(spec, Math.min(1.5, spec.duration / 2), png); } finally { await r.close(); }
    fs.writeFileSync(metaPath, JSON.stringify(rect));
  }
  if (!fs.existsSync(jpg)) await extractFrame(project.videoPath, frameTime, jpg, 960);
  return { png: `/api/projects/${projectId}/files/previews/${path.basename(png)}`, frame: `/api/projects/${projectId}/files/previews/${path.basename(jpg)}`, rect, designW: design.designW, designH: design.designH };
}
