import fs from "node:fs";
import path from "node:path";
import { PROJECTS_DIR } from "./paths.js";
import { probe } from "./probe.js";

function slugify(name) {
  const base = name.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "project";
  let slug = base, i = 2;
  while (fs.existsSync(path.join(PROJECTS_DIR, slug))) slug = `${base}-${i++}`;
  return slug;
}

export function projectDir(id) { return path.join(PROJECTS_DIR, id); }
function file(id, name) { return path.join(projectDir(id), name); }

export function listProjects() {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  return fs.readdirSync(PROJECTS_DIR)
    .filter((d) => fs.existsSync(file(d, "project.json")))
    .map((d) => readJson(file(d, "project.json")))
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export function readJson(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}
export function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

export async function createProject(videoPath) {
  const abs = path.resolve(videoPath);
  if (!fs.existsSync(abs)) throw new Error(`Video not found: ${abs}`);
  const info = await probe(abs);
  const id = slugify(path.basename(abs));
  const project = {
    id,
    name: path.basename(abs),
    videoPath: abs,
    createdAt: new Date().toISOString(),
    video: info,
    status: { transcript: false, plan: false }
  };
  fs.mkdirSync(projectDir(id), { recursive: true });
  writeJson(file(id, "project.json"), project);
  return project;
}

export function getProject(id) {
  const p = readJson(file(id, "project.json"));
  if (!p) throw new Error(`Project not found: ${id}`);
  p.status = {
    transcript: fs.existsSync(file(id, "transcript.json")),
    plan: fs.existsSync(file(id, "plan.json")),
    script: fs.existsSync(file(id, "script.txt")),
    video: !!p.video
  };
  p.renders = fs.existsSync(file(id, "renders")) ? fs.readdirSync(file(id, "renders")).filter((f) => !f.startsWith(".")).map((f) => {
    const st = fs.statSync(file(id, path.join("renders", f)));
    return { name: f, size: st.size, mtime: st.mtime.toISOString(), path: file(id, path.join("renders", f)) };
  }).sort((a, b) => b.mtime.localeCompare(a.mtime)) : [];
  return p;
}

export function saveProject(p) { writeJson(file(p.id, "project.json"), p); return p; }
export function getTranscript(id) { return readJson(file(id, "transcript.json")); }
export function saveTranscript(id, t) { writeJson(file(id, "transcript.json"), t); }
export function getPlan(id) { return readJson(file(id, "plan.json")); }
export function savePlan(id, plan) {
  plan.updatedAt = new Date().toISOString();
  writeJson(file(id, "plan.json"), plan);
  return plan;
}
export function deleteProject(id) { fs.rmSync(projectDir(id), { recursive: true, force: true }); }
export function projectFile(id, name) { return file(id, name); }

/* ---- script-first projects: the script arrives before the video ---- */
export function createScriptProject(name, script) {
  const clean = String(name || "").trim() || "episode";
  const id = slugify(clean);
  const project = { id, name: clean, videoPath: null, video: null, createdAt: new Date().toISOString(), status: { transcript: false, plan: false } };
  fs.mkdirSync(projectDir(id), { recursive: true });
  fs.writeFileSync(file(id, "script.txt"), String(script || ""));
  writeJson(file(id, "project.json"), project);
  return getProject(id);
}
export function getScript(id) { try { return fs.readFileSync(file(id, "script.txt"), "utf8"); } catch { return null; } }
export function saveScript(id, text) { fs.writeFileSync(file(id, "script.txt"), String(text || "")); }
/** Attach (or replace) the video of a project. A transcript from an earlier video is discarded. */
export async function attachVideo(id, videoPath) {
  const abs = path.resolve(videoPath);
  if (!fs.existsSync(abs)) throw new Error(`Video not found: ${abs}`);
  const info = await probe(abs);
  const p = readJson(file(id, "project.json"));
  if (!p) throw new Error(`Project not found: ${id}`);
  p.videoPath = abs; p.video = info; p.videoName = path.basename(abs);
  writeJson(file(id, "project.json"), p);
  if (fs.existsSync(file(id, "transcript.json"))) fs.rmSync(file(id, "transcript.json"));
  return getProject(id);
}
