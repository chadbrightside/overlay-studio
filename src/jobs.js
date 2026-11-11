import { randomUUID } from "node:crypto";
import { persistJob } from "./log.js";

const jobs = new Map();

export function createJob(kind, projectId, run) {
  const id = randomUUID().slice(0, 8);
  const controller = new AbortController();
  const job = {
    id, kind, projectId, status: "running", progress: 0, message: "", log: [], result: null, error: null,
    startedAt: new Date().toISOString(), endedAt: null, signal: controller.signal, cancel: () => controller.abort()
  };
  jobs.set(id, job);
  const ctx = {
    signal: controller.signal,
    progress(p, message) { if (p !== undefined) job.progress = Math.max(0, Math.min(1, p)); if (message !== undefined) job.message = message; },
    log(line) { for (const l of String(line).split(/\r?\n/)) { if (l.trim()) job.log.push(l); } if (job.log.length > 400) job.log.splice(0, job.log.length - 400); }
  };
  run(ctx).then((result) => {
    job.status = "done"; job.progress = 1; job.result = result ?? null; job.endedAt = new Date().toISOString();
    persistJob(publicJob(job));
  }).catch((err) => {
    job.status = controller.signal.aborted ? "cancelled" : "error";
    job.error = err?.message || String(err); job.endedAt = new Date().toISOString();
    ctx.log(`ERROR: ${job.error}`);
    if (err?.stack) ctx.log(err.stack.split("\n").slice(1, 6).join("\n"));
    console.error(`[job ${id} ${kind}] ${job.error}`);
    persistJob(publicJob(job));
  });
  return publicJob(job);
}

export function publicJob(job) {
  if (!job) return null;
  const { signal, cancel, ...rest } = job;
  return rest;
}
export function getJob(id) { return publicJob(jobs.get(id)); }
export function cancelJob(id) { const j = jobs.get(id); if (j && j.status === "running") j.cancel(); return publicJob(j); }
export function listJobs(projectId) { return [...jobs.values()].filter((j) => !projectId || j.projectId === projectId).map(publicJob).reverse(); }
export function activeJob(projectId) { return [...jobs.values()].find((j) => j.projectId === projectId && j.status === "running") ? publicJob([...jobs.values()].find((j) => j.projectId === projectId && j.status === "running")) : null; }
