#!/usr/bin/env node
// Command line use:  node src/cli.js <video> [--plan] [--export burn|alpha|proxy] [--notes "..."]
import { createProject, getProject, getTranscript, getPlan, savePlan, listProjects } from "./projects.js";
import { loadSettings } from "./config.js";
import { transcribeProject } from "./transcribe.js";
import { planOverlays } from "./planner.js";
import { renderExport } from "./pipeline.js";

const args = process.argv.slice(2);
if (!args.length || args.includes("--help")) {
  console.log(`Usage: node src/cli.js <video or project id> [--transcribe] [--plan] [--notes "text"] [--export burn|alpha|proxy]\n       node src/cli.js --list`);
  process.exit(0);
}
if (args[0] === "--list") { for (const p of listProjects()) console.log(p.id, "-", p.videoPath); process.exit(0); }
const settings = loadSettings();
const ctx = { settings, signal: new AbortController().signal, progress: (p, m) => m && process.stdout.write(`\r${Math.round(p * 100)}% ${m}        `), log: (l) => console.log(`\n${l}`) };
let project;
try { project = getProject(args[0]); } catch { project = await createProject(args[0]); console.log("Created project", project.id); }
const id = project.id;
if (args.includes("--transcribe") || !getTranscript(id)) await transcribeProject(id, settings, ctx);
if (args.includes("--plan") || !getPlan(id)) {
  const notes = args.includes("--notes") ? args[args.indexOf("--notes") + 1] : "";
  const plan = await planOverlays({ project: getProject(id), transcript: getTranscript(id), settings, notes, previousPlan: args.includes("--plan") ? getPlan(id) : null, log: ctx.log });
  savePlan(id, plan);
  for (const o of plan.overlays) console.log(`${o.id} ${o.start}-${o.end} ${o.type}: ${o.title || o.value || o.body}`);
}
if (args.includes("--export")) {
  const mode = args[args.indexOf("--export") + 1] || "burn";
  const out = await renderExport(id, { mode }, ctx);
  console.log("\nWrote", out.path);
}
