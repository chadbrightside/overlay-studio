// Self-update from a public GitHub repository: downloads the main-branch zip, replaces the code, reinstalls dependencies.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { ROOT } from "./paths.js";

const pkg = () => JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const UPDATED_PATHS = ["src", "ui", "templates", "python", "package.json", "package-lock.json", "GUIDE.md", "README.md", "start-mac.command", "start-windows.bat", "install-mac.sh"];

/** "owner/repo" from package.json overlayStudio.repo or OVERLAY_STUDIO_REPO. */
export function updateRepo() {
  const r = process.env.OVERLAY_STUDIO_REPO || pkg().overlayStudio?.repo || "";
  return /^[\w.-]+\/[\w.-]+$/.test(r) && !r.startsWith("OWNER/") ? r : null;
}
function branch() { return process.env.OVERLAY_STUDIO_BRANCH || pkg().overlayStudio?.branch || "main"; }
function cmpVersion(a, b) { const pa = a.split(".").map(Number), pb = b.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); } return 0; }

export async function checkForUpdate() {
  const repo = updateRepo();
  const current = pkg().version;
  if (!repo) return { configured: false, current, latest: null, available: false };
  const res = await fetch(`https://raw.githubusercontent.com/${repo}/${branch()}/package.json?t=${Date.now()}`, { signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!res.ok) throw new Error(`Could not reach GitHub (${res.status})`);
  const latest = (await res.json()).version;
  return { configured: true, repo, current, latest, available: cmpVersion(latest, current) > 0 };
}

function run(cmd, args, log, cwd = ROOT) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
    const onData = (d) => log(d.toString().trim());
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited with ${code}`)));
  });
}
function npmCli() {
  const dir = path.dirname(process.execPath);
  for (const c of [path.join(dir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"), path.join(dir, "node_modules", "npm", "bin", "npm-cli.js")]) if (fs.existsSync(c)) return c;
  return null;
}

export async function applyUpdate(ctx) {
  const repo = updateRepo();
  if (!repo) throw new Error("Update source is not configured.");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-studio-update-"));
  const zip = path.join(tmp, "app.zip");
  ctx.progress(0.05, "Downloading the new version");
  const res = await fetch(`https://github.com/${repo}/archive/refs/heads/${branch()}.zip`, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  ctx.progress(0.25, "Unpacking");
  await run("tar", ["-xf", zip, "-C", tmp], ctx.log);
  const src = fs.readdirSync(tmp).map((f) => path.join(tmp, f)).find((p) => fs.statSync(p).isDirectory());
  if (!src || !fs.existsSync(path.join(src, "package.json"))) throw new Error("The downloaded archive does not look like Overlay Studio.");
  const newVersion = JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8")).version;
  ctx.progress(0.35, `Installing version ${newVersion}`);
  for (const item of UPDATED_PATHS) {
    const from = path.join(src, item), to = path.join(ROOT, item);
    if (!fs.existsSync(from)) continue;
    fs.rmSync(to, { recursive: true, force: true });
    fs.cpSync(from, to, { recursive: true });
  }
  for (const f of ["start-mac.command", "install-mac.sh"]) { try { fs.chmodSync(path.join(ROOT, f), 0o755); } catch {} }
  ctx.progress(0.5, "Updating dependencies");
  const cli = npmCli();
  if (cli) await run(process.execPath, [cli, "install", "--no-audit", "--no-fund"], ctx.log);
  else await run("npm", ["install", "--no-audit", "--no-fund"], ctx.log);
  ctx.progress(0.85, "Checking the renderer");
  try { await run(process.execPath, [path.join(ROOT, "node_modules", "playwright", "cli.js"), "install", "chromium"], ctx.log); } catch (e) { ctx.log(`Renderer check skipped: ${e.message}`); }
  fs.rmSync(tmp, { recursive: true, force: true });
  ctx.progress(1, `Updated to ${newVersion}. Restarting`);
  return { version: newVersion };
}
