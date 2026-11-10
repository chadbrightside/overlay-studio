import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import express from "express";
import { chromium } from "playwright";
import { TEMPLATES_DIR, NODE_MODULES , PROJECTS_DIR } from "./paths.js";

const LABELS = {
  en: { term: "Definition", stat: "By the numbers", source: "Source:", quote: "Quote", map: "On the map", timeline: "Timeline", compare: "Side by side", chart: "In figures", vs: "vs" },
  ar: { term: "تعريف", stat: "بالأرقام", source: "المصدر:", quote: "اقتباس", map: "على الخريطة", timeline: "تسلسل زمني", compare: "مقارنة", chart: "بالأرقام", vs: "مقابل" },
  tr: { term: "Tanım", stat: "Rakamlarla", source: "Kaynak:", quote: "Alıntı", map: "Haritada", timeline: "Zaman çizelgesi", compare: "Karşılaştırma", chart: "Grafik", vs: "vs" },
  fr: { term: "Définition", stat: "En chiffres", source: "Source :", quote: "Citation", map: "Sur la carte", timeline: "Chronologie", compare: "Comparaison", chart: "Graphique", vs: "vs" },
  fa: { term: "تعریف", stat: "به روایت اعداد", source: "منبع:", quote: "نقل قول", map: "روی نقشه", timeline: "خط زمانی", compare: "مقایسه", chart: "نمودار", vs: "در برابر" },
  ur: { term: "تعریف", stat: "اعداد و شمار", source: "ماخذ:", quote: "اقتباس", map: "نقشے پر", timeline: "ٹائم لائن", compare: "موازنہ", chart: "چارٹ", vs: "بمقابلہ" },
  de: { term: "Definition", stat: "In Zahlen", source: "Quelle:", quote: "Zitat", map: "Auf der Karte", timeline: "Zeitleiste", compare: "Vergleich", chart: "Diagramm", vs: "vs" },
  es: { term: "Definición", stat: "En cifras", source: "Fuente:", quote: "Cita", map: "En el mapa", timeline: "Cronología", compare: "Comparación", chart: "Gráfico", vs: "vs" }
};

export function createAssetApp() {
  const app = express();
  app.use("/fonts/inter", express.static(path.join(NODE_MODULES, "@fontsource/inter/files")));
  app.use("/fonts/cairo", express.static(path.join(NODE_MODULES, "@fontsource/cairo/files")));
  app.get("/vendor/d3-array.min.js", (req, res) => res.sendFile(path.join(NODE_MODULES, "d3-array/dist/d3-array.min.js")));
  app.get("/vendor/d3-geo.min.js", (req, res) => res.sendFile(path.join(NODE_MODULES, "d3-geo/dist/d3-geo.min.js")));
  app.get("/vendor/topojson-client.min.js", (req, res) => res.sendFile(path.join(NODE_MODULES, "topojson-client/dist/topojson-client.min.js")));
  app.get("/vendor/countries-50m.json", (req, res) => res.sendFile(path.join(NODE_MODULES, "world-atlas/countries-50m.json")));
  app.use("/projects", express.static(PROJECTS_DIR));
  app.use("/", express.static(TEMPLATES_DIR));
  return app;
}

function startAssetServer() {
  return new Promise((resolve) => {
    const server = http.createServer(createAssetApp());
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}

/** Design space is always 1920 wide; dsf scales it to the output resolution. */
export function designFor(video, { proxy = false } = {}) {
  const designW = 1920;
  const designH = Math.round((1920 * video.height) / video.width / 2) * 2;
  const dsf = proxy ? 1 : video.width / 1920;
  return { designW, designH, dsf, outW: proxy ? 1920 : video.width, outH: proxy ? designH : video.height };
}

export function themeFor(settings, language, design) {
  const lang = (settings.overlayLanguage && settings.overlayLanguage !== "same") ? settings.overlayLanguage : language;
  const RTL_LANGS = ["ar", "fa", "ur", "he"];
  // labelsRtl is used when the overlay text itself is right-to-left but the language is unknown (e.g. imported subtitles)
  return { brand: settings.brand, labels: LABELS[lang] || LABELS.en, labelsRtl: RTL_LANGS.includes(lang) ? LABELS[lang] : LABELS.ar, designW: design.designW, designH: design.designH };
}

export function overlaySpec(o, projectId = null) {
  return { type: o.type, image: o.image && projectId ? `/projects/${projectId}/${o.image}` : "", credit: o.credit || "", position: o.position, duration: Math.max(0.5, o.end - o.start), title: o.title || "", subtitle: o.subtitle || "", body: o.body || "",
    value: o.value || "", label: o.label || "", source: o.source || "", items: o.items || [], countries: o.countries || [], route: o.route || [], pairs: o.pairs || [] };
}

export class Renderer {
  constructor(design, theme) { this.design = design; this.theme = theme; }

  /** Open the browser with `pages` independent render surfaces (overlays can render in parallel). */
  async open(pages = 1) {
    this.server = await startAssetServer();
    this.browser = await chromium.launch({ headless: true });
    this.context = await this.browser.newContext({ viewport: { width: this.design.designW, height: this.design.designH }, deviceScaleFactor: this.design.dsf });
    this.pages = [];
    for (let i = 0; i < pages; i++) {
      const page = await this.context.newPage();
      page.on("pageerror", (e) => console.error("[render page]", e.message));
      await page.goto(`${this.server.url}/index.html`, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      this.pages.push(page);
    }
    this.page = this.pages[0];
    return this;
  }

  async close() {
    try { await this.browser?.close(); } catch {}
    this.server?.close();
  }

  async mount(spec, page = this.page) {
    return page.evaluate(([s, t]) => window.Overlay.mount(s, t), [spec, this.theme]);
  }

  /** Render one still frame at time t (seconds into the overlay). Returns rect in output pixels. */
  async still(spec, t, outPath) {
    const rect = await this.mount(spec);
    await this.page.evaluate((tt) => window.Overlay.seek(tt), t);
    await this.page.screenshot({ path: outPath, clip: rect, omitBackground: true, type: "png" });
    return this.toOutput(rect);
  }

  /** Render the whole overlay as a PNG sequence at fps into dir. */
  async frames(spec, fps, dir, { onProgress, signal, page = this.page } = {}) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const rect = await this.mount(spec, page);
    const count = Math.max(1, Math.round(spec.duration * fps));
    for (let i = 0; i < count; i++) {
      if (signal?.aborted) throw new Error("Cancelled");
      await page.evaluate((tt) => window.Overlay.seek(tt), i / fps);
      await page.screenshot({ path: path.join(dir, `${String(i).padStart(5, "0")}.png`), clip: rect, omitBackground: true, type: "png" });
      if (onProgress && (i % 5 === 0 || i === count - 1)) onProgress((i + 1) / count);
    }
    const out = { ...this.toOutput(rect), count, fps };
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(out));
    return out;
  }

  toOutput(rect) {
    const d = this.design.dsf;
    return { x: Math.round(rect.x * d), y: Math.round(rect.y * d), w: Math.round(rect.width * d), h: Math.round(rect.height * d) };
  }
}
