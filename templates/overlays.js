/* Overlay templates + deterministic, time-driven animation.
   The renderer calls Overlay.mount(spec, theme) once, then Overlay.seek(t) per frame. */
(function () {
  const ease = {
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inCubic: (t) => t * t * t,
    outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
  };
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const RTL_RE = /[֐-׿؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
  const ENTER = 0.55, EXIT = 0.45;

  let state = null;
  let worldPromise = null;
  function world() {
    if (!worldPromise) worldPromise = fetch("/vendor/countries-50m.json").then((r) => r.json()).then((t) => topojson.feature(t, t.objects.countries));
    return worldPromise;
  }

  function h(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function anim(el, kind, delay = 0, dur = ENTER) { state.anims.push({ el, kind, delay, dur }); return el; }
  function isRtl(spec) {
    return RTL_RE.test([spec.title, spec.subtitle, spec.body, spec.value, spec.label, ...(spec.type === "map" ? [] : spec.items || []), ...(spec.pairs || []).flatMap((p) => [p.value, p.value2])].filter(Boolean).join(" "));
  }

  // ---------- count-up for stat values ----------
  const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
  function prepareCountup(value) {
    const m = value.match(/([\d٠-٩][\d٠-٩.,]*)/);
    if (!m) return null;
    const raw = m[1];
    const arabic = /[٠-٩]/.test(raw);
    const ascii = raw.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
    let decimals = 0, sep = "";
    const dm = ascii.match(/[.,](\d{1,2})$/);
    let intPart = ascii;
    if (dm) { decimals = dm[1].length; intPart = ascii.slice(0, -dm[0].length); }
    if (/[.,]/.test(intPart)) sep = intPart.match(/[.,]/)[0];
    const num = Number(intPart.replace(/[.,]/g, "")) + (dm ? Number("0." + dm[1]) : 0);
    if (!Number.isFinite(num)) return null;
    const decSep = dm ? dm[0][0] : "";
    return { prefix: value.slice(0, m.index), suffix: value.slice(m.index + raw.length), num, decimals, sep, decSep, arabic };
  }
  function formatCount(c, v) {
    let s = v.toFixed(c.decimals);
    let [i, d] = s.split(".");
    if (c.sep) i = i.replace(/\B(?=(\d{3})+(?!\d))/g, c.sep);
    s = d != null ? i + c.decSep + d : i;
    if (c.arabic) s = s.replace(/\d/g, (x) => AR_DIGITS[+x]);
    return c.prefix + s + c.suffix;
  }

  // ---------- builders ----------
  const builders = {
    lower_third(s, L) {
      const panel = h("div", "panel");
      const row = h("div", "row");
      const bar = anim(h("div", "bar"), "bar", 0.05, 0.4);
      const col = h("div", "col");
      col.appendChild(anim(h("div", "title", s.title), "reveal", 0.12));
      if (s.subtitle) col.appendChild(anim(h("div", "subtitle", s.subtitle), "reveal", 0.26));
      row.append(bar, col); panel.appendChild(row);
      return panel;
    },
    term(s, L) {
      const panel = h("div", "panel");
      panel.appendChild(anim(h("div", "kicker", L.term), "fade", 0.05, 0.4));
      panel.appendChild(anim(h("div", "title", s.title), "reveal", 0.12));
      panel.appendChild(anim(h("div", "divider"), "divider", 0.3, 0.5));
      panel.appendChild(anim(h("div", "body", s.body), "fade-up", 0.38, 0.5));
      return panel;
    },
    stat(s, L) {
      const panel = h("div", "panel");
      panel.appendChild(anim(h("div", "kicker", L.stat), "fade", 0.05, 0.4));
      const v = anim(h("div", "value", s.value), "pop", 0.1, 0.6);
      state.countup = prepareCountup(s.value || "");
      state.countupEl = v;
      panel.appendChild(v);
      if (s.label) panel.appendChild(anim(h("div", "label", s.label), "fade-up", 0.3, 0.5));
      if (s.source) panel.appendChild(anim(h("div", "source", (L.source ? L.source + " " : "") + s.source), "fade-up", 0.45, 0.5));
      return panel;
    },
    quote(s, L) {
      const panel = h("div", "panel");
      panel.appendChild(anim(h("div", "mark", "“"), "pop", 0.05, 0.5));
      panel.appendChild(anim(h("div", "body", s.body), "fade-up", 0.15, 0.6));
      if (s.title) panel.appendChild(anim(h("div", "who", s.title), "fade-up", 0.4, 0.5));
      return panel;
    },
    headline(s, L) {
      const panel = h("div", "panel");
      if (s.subtitle) panel.appendChild(anim(h("div", "kicker", s.subtitle), "fade", 0.25, 0.4));
      panel.appendChild(anim(h("div", "title", s.title), "reveal", 0.08));
      return panel;
    },
    list(s, L) {
      const panel = h("div", "panel");
      const row = h("div", "row");
      row.appendChild(anim(h("div", "bar"), "bar", 0.05, 0.4));
      const col = h("div", "col");
      col.appendChild(anim(h("div", "title", s.title), "reveal", 0.1));
      const ol = h("ol");
      (s.items || []).forEach((it, i) => {
        const li = h("li");
        li.appendChild(h("span", "num", String(i + 1).padStart(2, "0")));
        li.appendChild(h("span", "txt", it));
        ol.appendChild(anim(li, "fade-up", 0.35 + i * 0.16, 0.5));
      });
      col.appendChild(ol); row.append(col); panel.appendChild(row);
      return panel;
    },
    keyword(s, L) {
      const panel = h("div", "panel");
      const line = h("div", "words");
      const words = String(s.title || "").split(/\s+/).filter(Boolean);
      words.forEach((w, i) => line.appendChild(anim(h("span", "w", w), "pop-blur", 0.04 + i * 0.09, 0.5)));
      panel.appendChild(line);
      panel.appendChild(anim(h("div", "underline"), "grow-x", 0.15 + words.length * 0.07, 0.5));
      if (s.subtitle) panel.appendChild(anim(h("div", "subtitle", s.subtitle), "fade-up", 0.35 + words.length * 0.07, 0.45));
      return panel;
    },
    timeline(s, L) {
      const panel = h("div", "panel");
      panel.appendChild(anim(h("div", "kicker", L.timeline), "fade", 0.05, 0.4));
      if (s.title) panel.appendChild(anim(h("div", "title", s.title), "reveal", 0.1));
      const wrap = h("div", "tl");
      wrap.appendChild(anim(h("div", "rail"), "bar", 0.3, 0.8));
      (s.pairs || []).slice(0, 6).forEach((p, i) => {
        const row = h("div", "trow");
        row.appendChild(anim(h("div", "dot"), "pop", 0.4 + i * 0.18, 0.4));
        const col = h("div", "col");
        if (p.label) col.appendChild(h("div", "when", p.label));
        col.appendChild(h("div", "what", p.value));
        row.appendChild(anim(col, "fade-up", 0.45 + i * 0.18, 0.5));
        wrap.appendChild(row);
      });
      panel.appendChild(wrap);
      return panel;
    },
    compare(s, L) {
      const panel = h("div", "panel");
      panel.appendChild(anim(h("div", "kicker", L.compare), "fade", 0.05, 0.4));
      const head = h("div", "chead");
      head.appendChild(anim(h("div", "side a", s.title), "reveal", 0.1));
      head.appendChild(anim(h("div", "vs", L.vs || "vs"), "pop", 0.28, 0.4));
      head.appendChild(anim(h("div", "side b", s.subtitle), "reveal", 0.1));
      panel.appendChild(head);
      (s.pairs || []).slice(0, 5).forEach((p, i) => {
        const row = h("div", "crow");
        const a = prepareCountup(p.value || ""), b = prepareCountup(p.value2 || "");
        const max = Math.max(a ? a.num : 0, b ? b.num : 0) || 1;
        const cellA = h("div", "cell a"), cellB = h("div", "cell b");
        const va = h("div", "v", p.value || ""), vb = h("div", "v", p.value2 || "");
        const barA = h("div", "cbar"), barB = h("div", "cbar");
        barA.style.width = `${a ? Math.max(6, (a.num / max) * 100) : 0}%`;
        barB.style.width = `${b ? Math.max(6, (b.num / max) * 100) : 0}%`;
        cellA.append(va, anim(barA, "grow-x", 0.5 + i * 0.16, 0.6));
        cellB.append(vb, anim(barB, "grow-x-end", 0.5 + i * 0.16, 0.6));
        if (a) state.counters.push({ el: va, c: a, delay: 0.5 + i * 0.16, dur: 0.9 });
        if (b) state.counters.push({ el: vb, c: b, delay: 0.5 + i * 0.16, dur: 0.9 });
        row.append(cellA, h("div", "metric", p.label || ""), cellB);
        panel.appendChild(anim(row, "fade-up", 0.35 + i * 0.16, 0.5));
      });
      return panel;
    },
    chart(s, L) {
      const panel = h("div", "panel");
      panel.appendChild(anim(h("div", "kicker", L.chart), "fade", 0.05, 0.4));
      if (s.title) panel.appendChild(anim(h("div", "title", s.title), "reveal", 0.1));
      const rows = (s.pairs || []).slice(0, 8);
      const nums = rows.map((p) => prepareCountup(p.value || ""));
      const max = Math.max(0, ...nums.map((c) => (c ? c.num : 0))) || 1;
      const area = h("div", "bars");
      rows.forEach((p, i) => {
        const col = h("div", "bcol");
        const stem = h("div", "bstem");
        const v = h("div", "bval", p.value || "");
        const bar = h("div", "bbar");
        bar.style.height = `${nums[i] ? Math.max(3, (nums[i].num / max) * 100) : 2}%`;
        stem.append(anim(v, "fade-up", 0.55 + i * 0.1, 0.4), anim(bar, "grow-y", 0.3 + i * 0.1, 0.7));
        col.append(stem, anim(h("div", "bcat", p.label || ""), "fade", 0.3 + i * 0.1, 0.4));
        if (nums[i]) state.counters.push({ el: v, c: nums[i], delay: 0.3 + i * 0.1, dur: 0.9 });
        area.appendChild(col);
      });
      panel.appendChild(area);
      const foot = [];
      if (s.label) foot.push(s.label);
      if (s.source) foot.push((L.source ? L.source + " " : "") + s.source);
      if (foot.length) panel.appendChild(anim(h("div", "source", foot.join("   ·   ")), "fade", 0.9, 0.5));
      return panel;
    },
    image(s, L) {
      const panel = h("div", "panel");
      const photo = anim(h("div", "photo"), "fade-up", 0.05, 0.6);
      if (s.image) {
        const img = document.createElement("img");
        img.alt = ""; img.src = s.image;
        state.kenburns = img;
        state.pending.push(new Promise((res) => { img.onload = res; img.onerror = res; }).then(() => (img.decode ? img.decode().catch(() => {}) : null)));
        photo.appendChild(img);
      }
      panel.appendChild(photo);
      const cap = h("div", "caption");
      cap.appendChild(anim(h("div", "title", s.title), "reveal", 0.3));
      if (s.subtitle) cap.appendChild(anim(h("div", "subtitle", s.subtitle), "fade-up", 0.45, 0.5));
      panel.appendChild(cap);
      if (s.credit) panel.appendChild(anim(h("div", "credit", s.credit), "fade", 0.6, 0.5));
      return panel;
    },
    map(s, L) {
      const panel = h("div", "panel");
      const svgWrap = anim(h("div", "svgwrap"), "fade-up", 0.05, 0.6);
      panel.appendChild(svgWrap);
      const cap = h("div", "caption");
      cap.appendChild(anim(h("div", "title", s.title), "reveal", 0.3));
      if (s.subtitle) cap.appendChild(anim(h("div", "subtitle", s.subtitle), "fade-up", 0.45, 0.5));
      panel.appendChild(cap);
      state.pending.push(buildMap(svgWrap, s));
      return panel;
    }
  };

  const ALIASES = {
    "turkiye": "Turkey", "türkiye": "Turkey", "uae": "United Arab Emirates", "emirates": "United Arab Emirates", "usa": "United States of America",
    "united states": "United States of America", "us": "United States of America", "america": "United States of America", "uk": "United Kingdom",
    "britain": "United Kingdom", "great britain": "United Kingdom", "england": "United Kingdom", "western sahara": "W. Sahara", "sahrawi": "W. Sahara",
    "south sudan": "S. Sudan", "dr congo": "Dem. Rep. Congo", "drc": "Dem. Rep. Congo", "democratic republic of the congo": "Dem. Rep. Congo",
    "czech republic": "Czechia", "ivory coast": "Côte d'Ivoire", "bosnia": "Bosnia and Herz.", "bosnia and herzegovina": "Bosnia and Herz.",
    "central african republic": "Central African Rep.", "dominican republic": "Dominican Rep.", "equatorial guinea": "Eq. Guinea",
    "gaza": "Palestine", "west bank": "Palestine", "palestinian territories": "Palestine", "north macedonia": "Macedonia", "burma": "Myanmar",
    "holland": "Netherlands", "swaziland": "eSwatini", "russian federation": "Russia", "iran": "Iran", "syria": "Syria", "laos": "Laos",
    "vietnam": "Vietnam", "south korea": "South Korea", "north korea": "North Korea", "solomon islands": "Solomon Is.", "cape verde": "Cabo Verde",
    "sao tome and principe": "São Tomé and Principe", "brunei": "Brunei", "east timor": "Timor-Leste", "falkland islands": "Falkland Is.",
    "northern cyprus": "N. Cyprus", "somaliland": "Somaliland", "kosovo": "Kosovo", "vatican": "Vatican", "macedonia": "Macedonia"
  };
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/^the /, "").trim();
  function matchCountry(features, name) {
    const n = norm(name);
    const alias = ALIASES[n];
    const target = alias ? norm(alias) : n;
    let f = features.find((x) => norm(x.properties.name) === target);
    if (!f) f = features.find((x) => norm(x.properties.name).startsWith(target) || target.startsWith(norm(x.properties.name)));
    if (!f && target.length > 4) f = features.find((x) => norm(x.properties.name).includes(target));
    return f || null;
  }

  function resolvePoint(fc, name) {
    const m = String(name).match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) return [Number(m[2]), Number(m[1])]; // "lat,lon" -> [lon, lat]
    const part = String(name).includes(",") ? String(name).split(",").pop() : String(name);
    const f = matchCountry(fc.features, part.trim());
    return f ? d3.geoCentroid(f) : null;
  }

  async function buildMap(container, spec) {
    const W = 600, H = 360;
    const fc = await world();
    const names = spec.countries || [], related = spec.items || [], routeNames = spec.route || [];
    const labelFor = {}; for (const p of spec.pairs || []) if (p.label && p.value) labelFor[norm(p.label)] = p.value;
    const hi = names.map((n) => matchCountry(fc.features, n)).filter(Boolean);
    const hiIds = new Set(hi.map((f) => f.id));
    const rel = related.map((n) => matchCountry(fc.features, n)).filter((f) => f && !hiIds.has(f.id));
    const relIds = new Set(rel.map((f) => f.id));
    const routePts = routeNames.map((n) => resolvePoint(fc, n)).filter(Boolean);
    const focusFeatures = [...hi, ...rel, ...routePts.map((c) => ({ type: "Feature", geometry: { type: "Point", coordinates: c } }))];
    let projection;
    if (focusFeatures.length) {
      const b = d3.geoBounds({ type: "FeatureCollection", features: focusFeatures });
      let [[x0, y0], [x1, y1]] = b;
      if (x1 < x0) x1 += 360; // crosses the antimeridian
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const spanX = Math.max(x1 - x0, 12) * 1.22, spanY = Math.max(y1 - y0, 8) * 1.22;
      const aspect = W / H;
      let sx = spanX, sy = spanY;
      if (sx / sy < aspect) sx = sy * aspect; else sy = sx / aspect;
      const bx0 = cx - sx / 2, bx1 = cx + sx / 2, by0 = Math.max(-80, cy - sy / 2), by1 = Math.min(84, cy + sy / 2);
      // exterior ring must be clockwise for d3-geo (west -> north -> east -> south)
      const box = { type: "Polygon", coordinates: [[[bx0, by0], [bx0, by1], [bx1, by1], [bx1, by0], [bx0, by0]]] };
      projection = (sx > 150 ? d3.geoNaturalEarth1() : d3.geoMercator()).fitExtent([[6, 6], [W - 6, H - 6]], box);
    } else {
      projection = d3.geoNaturalEarth1().fitExtent([[6, 6], [W - 6, H - 6]], { type: "Sphere" });
    }
    const path = d3.geoPath(projection);
    const ns = "http://www.w3.org/2000/svg";
    const el = (tag, attrs = {}) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}` });
    const defs = el("defs");
    const clip = el("clipPath", { id: "mapclip" }); clip.appendChild(el("rect", { width: W, height: H })); defs.appendChild(clip);
    const marker = el("marker", { id: "arrow", viewBox: "0 0 10 10", refX: "8", refY: "5", markerWidth: "5", markerHeight: "5", orient: "auto-start-reverse" });
    marker.appendChild(el("path", { d: "M 0 0 L 10 5 L 0 10 z", class: "arrowhead" })); defs.appendChild(marker);
    svg.appendChild(defs);
    const g = el("g", { "clip-path": "url(#mapclip)" });
    g.appendChild(el("path", { class: "graticule", d: path(d3.geoGraticule10()) }));
    for (const f of fc.features) { if (hiIds.has(f.id) || relIds.has(f.id)) continue; g.appendChild(el("path", { class: "land", d: path(f) || "" })); }
    state.mapHi = [];
    for (const f of rel) g.appendChild(el("path", { class: "hi2", d: path(f) || "" }));
    for (const f of hi) { const p = el("path", { class: "hi", d: path(f) || "" }); g.appendChild(p); state.mapHi.push(p); }
    // names on the map
    for (const f of [...hi, ...rel]) {
      const c = projection(d3.geoCentroid(f));
      if (!c || c[0] < 10 || c[0] > W - 10 || c[1] < 10 || c[1] > H - 10) continue;
      const text = labelFor[norm(f.properties.name)] || f.properties.name;
      const tn = el("text", { class: "lbl", x: c[0], y: c[1] + 5 }); tn.textContent = text; g.appendChild(tn);
    }
    // route
    state.route = null; state.routeDots = []; state.routeArrowEl = null; state.routeLbl = null;
    if (routePts.length >= 2) {
      const d = path({ type: "LineString", coordinates: routePts }) || "";
      const line = el("path", { class: "route", d });
      g.appendChild(line);
      const len = line.getTotalLength ? line.getTotalLength() : 0;
      line.style.strokeDasharray = `${len}`; line.style.strokeDashoffset = `${len}`;
      state.route = { el: line, len };
      routePts.forEach((c) => { const q = projection(c); if (!q) return; const dot = el("circle", { class: "route-dot", cx: q[0], cy: q[1], r: 5 }); dot.style.opacity = "0"; g.appendChild(dot); state.routeDots.push(dot); });
      if (spec.label && len) {
        const mid = line.getPointAtLength(len * 0.62);
        const lab = el("text", { class: "route-lbl", x: mid.x, y: mid.y - 14 }); lab.textContent = spec.label; lab.style.opacity = "0"; g.appendChild(lab); state.routeLbl = lab;
      }
    }
    svg.appendChild(g);
    container.appendChild(svg);
    // legend under the map
    const leg = h("div", "legend");
    const nameOf = (f) => labelFor[norm(f.properties.name)] || f.properties.name;
    if (hi.length) { const s = h("span"); s.appendChild(h("i", "dot-hi")); s.appendChild(document.createTextNode(hi.map(nameOf).join("، "))); leg.appendChild(s); }
    if (rel.length) { const s = h("span"); s.appendChild(h("i", "dot-rel")); s.appendChild(document.createTextNode(rel.map(nameOf).join("، "))); leg.appendChild(s); }
    if (leg.childNodes.length) container.appendChild(leg);
  }

  // ---------- public API ----------
  async function mount(spec, theme) {
    const stage = document.getElementById("stage");
    stage.innerHTML = "";
    const root = document.documentElement;
    const b = theme.brand || {};
    root.style.setProperty("--accent", b.accent || "#E8B23A");
    root.style.setProperty("--accent2", b.accent2 || "#1F7AE0");
    root.style.setProperty("--panel", b.panel || "#0B0F1A");
    root.style.setProperty("--text", b.text || "#FFFFFF");
    root.style.setProperty("--font-latin", `"${b.fontLatin || "Inter"}"`);
    root.style.setProperty("--font-arabic", `"${b.fontArabic || "Cairo"}"`);
    root.style.setProperty("--scale", String(b.scale || 1));
    root.style.setProperty("--margin-x", `${Math.round((b.safeMargin ?? 0.05) * theme.designW)}px`);
    root.style.setProperty("--margin-y", `${Math.round((b.safeMargin ?? 0.05) * theme.designH)}px`);
    document.body.style.width = theme.designW + "px";
    document.body.style.height = theme.designH + "px";

    state = { spec, duration: spec.duration, anims: [], pending: [], countup: null, countupEl: null, counters: [], mapHi: [], kenburns: null, route: null, routeDots: [], routeLbl: null };
    const rtl = isRtl(spec);
    const pos = spec.position || "top-left";
    const anchor = h("div", `anchor ${pos}`);
    anchor.dir = rtl ? "rtl" : "ltr";
    const card = h("div", `card ${spec.type}`);
    state.card = card;
    state.slideDir = pos.endsWith("right") ? 1 : -1;
    const L = (rtl && theme.labelsRtl) ? theme.labelsRtl : (theme.labels || {});
    const builder = builders[spec.type] || builders.lower_third;
    card.appendChild(builder(spec, L));
    anchor.appendChild(card);
    stage.appendChild(anchor);
    await document.fonts.ready;
    await Promise.all(state.pending);
    seek(Math.min(1.5, spec.duration / 2));
    return rect();
  }

  function seek(t) {
    if (!state) return;
    const x = ease.inCubic(clamp01((t - (state.duration - EXIT)) / EXIT));
    state.card.style.opacity = String(1 - x);
    state.card.style.transform = `translateX(${state.slideDir * x * 50}px)`;
    const rtl = state.card.closest("[dir]").dir === "rtl";
    for (const a of state.anims) {
      const e = clamp01((t - a.delay) / a.dur);
      const st = a.el.style;
      switch (a.kind) {
        case "bar": st.transform = `scaleY(${ease.outCubic(e)})`; st.transformOrigin = "top"; st.opacity = e > 0 ? "1" : "0"; break;
        case "reveal": {
          const p = ease.outExpo(e);
          st.clipPath = rtl ? `inset(-10% 0 -10% ${(1 - p) * 100}%)` : `inset(-10% ${(1 - p) * 100}% -10% 0)`;
          st.transform = `translateY(${(1 - p) * 14}px)`; st.opacity = String(Math.min(1, e * 3)); break;
        }
        case "fade": st.opacity = String(ease.outCubic(e)); break;
        case "fade-up": st.opacity = String(ease.outCubic(e)); st.transform = `translateY(${(1 - ease.outCubic(e)) * 22}px)`; break;
        case "divider": st.transform = `scaleX(${ease.outCubic(e)})`; break;
        case "pop-blur": { const p = ease.outBack(e), q = ease.outCubic(e); st.opacity = String(Math.min(1, e * 2.5)); st.transform = `scale(${0.6 + 0.4 * p}) translateY(${(1 - q) * 10}px)`; st.filter = `blur(${(1 - q) * 10}px)`; break; }
        case "grow-x": st.transform = `scaleX(${ease.outCubic(e)})`; st.transformOrigin = rtl ? "right center" : "left center"; st.opacity = e > 0 ? "1" : "0"; break;
        case "grow-x-end": st.transform = `scaleX(${ease.outCubic(e)})`; st.transformOrigin = rtl ? "left center" : "right center"; st.opacity = e > 0 ? "1" : "0"; break;
        case "grow-y": st.transform = `scaleY(${ease.outCubic(e)})`; st.transformOrigin = "bottom center"; st.opacity = e > 0 ? "1" : "0"; break;
        case "pop": st.opacity = String(Math.min(1, e * 2)); st.transform = `scale(${0.7 + 0.3 * ease.outBack(e)})`; st.transformOrigin = rtl ? "right center" : "left center"; break;
      }
    }
    if (state.countup && state.countupEl) {
      const e = ease.outExpo(clamp01((t - 0.1) / 1.1));
      state.countupEl.textContent = formatCount(state.countup, state.countup.num * e);
    }
    for (const c of state.counters) { const e = ease.outExpo(clamp01((t - c.delay) / c.dur)); c.el.textContent = formatCount(c.c, c.c.num * e); }
    if (state.kenburns) state.kenburns.style.transform = `scale(${1 + 0.07 * clamp01(t / Math.max(1, state.duration))})`;
    for (const p of state.mapHi) p.style.fillOpacity = String(0.82 + 0.18 * Math.sin(t * 3.0));
    if (state.route) {
      const e = ease.inOut(clamp01((t - 0.6) / 1.6));
      state.route.el.style.strokeDashoffset = String(state.route.len * (1 - e));
      state.route.el.setAttribute("marker-end", e > 0.97 ? "url(#arrow)" : "none");
      state.routeDots.forEach((d, i) => { d.style.opacity = String(clamp01((e * state.routeDots.length - i) * 2)); });
      if (state.routeLbl) state.routeLbl.style.opacity = String(clamp01((t - 2.1) / 0.4));
    }
    // The slide-in of the whole card during the entry
    const en = ease.outExpo(clamp01(t / ENTER));
    if (x === 0) state.card.style.transform = `translateX(${state.slideDir * (1 - en) * 60}px)`;
  }

  function rect() {
    const nodes = [state.card, ...state.card.querySelectorAll("*")];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) {
      if (n instanceof SVGElement && n.tagName.toLowerCase() !== "svg") continue;
      const r = n.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
    }
    const m = 70;
    const W = document.body.clientWidth, H = document.body.clientHeight;
    x0 = Math.max(0, Math.floor(x0 - m)); y0 = Math.max(0, Math.floor(y0 - m));
    x1 = Math.min(W, Math.ceil(x1 + m)); y1 = Math.min(H, Math.ceil(y1 + m));
    let w = x1 - x0, hh = y1 - y0;
    if (w % 2) w += x0 + w < W ? 1 : -1;
    if (hh % 2) hh += y0 + hh < H ? 1 : -1;
    return { x: x0, y: y0, width: w, height: hh };
  }

  window.Overlay = { mount, seek, rect };
})();
