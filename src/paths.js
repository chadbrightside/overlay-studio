import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = process.env.OVERLAY_STUDIO_DATA || path.join(ROOT, "data");
export const PROJECTS_DIR = path.join(DATA_DIR, "projects");
export const INBOX_DIR = path.join(ROOT, "inbox");
export const TEMPLATES_DIR = path.join(ROOT, "templates");
export const UI_DIR = path.join(ROOT, "ui");
export const PYTHON_DIR = path.join(ROOT, "python");
export const NODE_MODULES = path.join(ROOT, "node_modules");

for (const d of [DATA_DIR, PROJECTS_DIR, INBOX_DIR]) fs.mkdirSync(d, { recursive: true });
