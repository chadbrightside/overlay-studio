/* Finds and stores pictures for image overlays.
   Sources: the lead image of the matching Wikipedia article (English, then Arabic) and Wikimedia Commons search.
   Both carry a licence and an author, which become the credit line on the card. Non-free files are skipped. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { projectFile, getPlan, savePlan } from "./projects.js";

const UA = "SardiyeStudio/0.6 (https://github.com/chadbrightside/overlay-studio; one creator, a few requests per episode)";
const enc = encodeURIComponent;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
/** Polite client: one call at a time with a short gap, and a pause-and-retry when Wikimedia answers 429. */
async function getJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = 250 - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (r.status === 429) { await sleep(1500 * (attempt + 1)); continue; }
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
  }
  throw new Error("Wikipedia is rate-limiting requests; try again in a minute.");
}
const stripHtml = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

function creditOf(em, fallbackTitle) {
  const author = stripHtml(em?.Artist?.value).slice(0, 48);
  const lic = stripHtml(em?.LicenseShortName?.value);
  const parts = [];
  if (author) parts.push(author);
  if (lic && !/^(public domain|pd)/i.test(lic)) parts.push(lic); else if (lic) parts.push("Public domain");
  return parts.join(" · ") || fallbackTitle || "";
}
function isFree(em) {
  const lic = stripHtml(em?.LicenseShortName?.value).toLowerCase();
  if (!lic) return true; // Commons files are free by policy; missing metadata happens
  return !/fair|non-free|copyright/.test(lic);
}

/** Metadata and a 1600px rendition for one file name, from Commons (or a wiki that hosts it locally). */
async function fileInfo(fileName, host = "commons.wikimedia.org") {
  const q = await getJson(`https://${host}/w/api.php?action=query&titles=File:${enc(fileName)}&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1600&format=json`);
  const page = Object.values(q.query?.pages || {})[0];
  const ii = page?.imageinfo?.[0];
  if (!ii) return null;
  return { ...ii, fileName, title: String(page.title || "").replace(/^File:/, "") };
}
function candidate(ii, source, label) {
  const em = ii.extmetadata || {};
  return {
    url: ii.thumburl || ii.url, thumb: (ii.thumburl || ii.url).replace(/\/1600px-/, "/400px-"),
    width: ii.thumbwidth || ii.width, height: ii.thumbheight || ii.height,
    title: label || ii.title, source, page: ii.descriptionurl || "", credit: creditOf(em, ii.title), license: stripHtml(em.LicenseShortName?.value)
  };
}

export async function searchImages(query, { limit = 6 } = {}) {
  const out = []; const seen = new Set();
  const q = String(query || "").trim();
  if (!q) return out;
  // 1. The article's lead image, English then Arabic Wikipedia
  for (const lang of ["en", "ar"]) {
    try {
      const s = await getJson(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc(q)}&srlimit=1&format=json`);
      const title = s.query?.search?.[0]?.title;
      if (!title) continue;
      const sum = await getJson(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${enc(title.replace(/ /g, "_"))}`);
      const orig = sum.originalimage?.source;
      if (!orig) continue;
      const fileName = decodeURIComponent(orig.split("/").pop()).replace(/^\d+px-/, "");
      let ii = await fileInfo(fileName).catch(() => null);
      if (!ii) ii = await fileInfo(fileName, `${lang}.wikipedia.org`).catch(() => null);
      if (!ii || !/^image\/(jpeg|png|webp)$/.test(ii.mime) || !isFree(ii.extmetadata)) continue;
      const c = candidate(ii, `${lang}.wikipedia.org`, sum.title);
      if (seen.has(c.url)) continue;
      seen.add(c.url); out.push(c);
      break; // the English article had a picture; no need to try Arabic
    } catch { /* offline or no article: fall through to Commons */ }
  }
  // 2. Commons search
  try {
    const r = await getJson(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${enc(q)}&gsrnamespace=6&gsrlimit=${limit + 4}&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1600&format=json`);
    const pages = Object.values(r.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
    for (const p of pages) {
      const ii = p.imageinfo?.[0];
      if (!ii || !/^image\/(jpeg|png|webp)$/.test(ii.mime) || (ii.width || 0) < 600 || !isFree(ii.extmetadata)) continue;
      const c = candidate({ ...ii, title: String(p.title).replace(/^File:/, "") }, "commons.wikimedia.org");
      if (seen.has(c.url)) continue;
      seen.add(c.url); out.push(c);
      if (out.length >= limit + 2) break;
    }
  } catch { /* offline */ }
  return out.slice(0, limit + 2);
}

/** Download an image into the project's assets folder. Returns the project-relative path. */
export async function downloadImage(projectId, url) {
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Could not download the image (${r.status}).`);
  const type = r.headers.get("content-type") || "";
  const ext = /png/.test(type) ? ".png" : /webp/.test(type) ? ".webp" : /jpe?g/.test(type) ? ".jpg" : path.extname(new URL(url).pathname).toLowerCase() || ".jpg";
  if (!/^image\//.test(type)) throw new Error("That address is not an image.");
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 25e6) throw new Error("The image is larger than 25 MB.");
  const name = crypto.createHash("sha1").update(url).digest("hex").slice(0, 12) + ext;
  const dir = projectFile(projectId, "assets");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), buf);
  return "assets/" + name;
}

/** Copy a local image file into the project's assets folder. */
export function importImageFile(projectId, filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error("File not found.");
  const ext = path.extname(abs).toLowerCase();
  if (![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) throw new Error("Use a JPG, PNG or WebP image.");
  const name = crypto.createHash("sha1").update(abs + fs.statSync(abs).mtimeMs).digest("hex").slice(0, 12) + (ext === ".jpeg" ? ".jpg" : ext);
  const dir = projectFile(projectId, "assets");
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(abs, path.join(dir, name));
  return "assets/" + name;
}

/** After planning: find a picture for every image overlay that has none. Tolerates being offline. */
export async function resolvePlanImages(projectId, plan, log = () => {}) {
  let changed = false;
  for (const o of plan.overlays) {
    if (o.type !== "image" || o.image) continue;
    const query = o.query || o.title;
    try {
      const cands = await searchImages(query);
      o.candidates = cands;
      if (cands[0]) { o.image = await downloadImage(projectId, cands[0].url); o.imageUrl = cands[0].url; o.credit = cands[0].credit; o.imagePage = cands[0].page; changed = true; log(`Image for "${query}": ${cands[0].title} (${cands[0].source})`); }
      else log(`No free image found for "${query}"; choose one by hand.`);
    } catch (e) { log(`Image search failed for "${query}": ${e.message}`); }
  }
  return changed;
}

export async function setOverlayImage(projectId, overlayId, { url, filePath, credit, page }) {
  const plan = getPlan(projectId);
  const o = plan?.overlays.find((x) => x.id === overlayId);
  if (!o) throw new Error("Overlay not found");
  if (filePath) { o.image = importImageFile(projectId, filePath); o.imageUrl = ""; o.credit = credit ?? ""; o.imagePage = ""; }
  else if (url) { o.image = await downloadImage(projectId, url); o.imageUrl = url; o.credit = credit ?? (o.candidates || []).find((c) => c.url === url)?.credit ?? ""; o.imagePage = page || ""; }
  savePlan(projectId, plan);
  return o;
}
