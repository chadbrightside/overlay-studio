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
    return RTL_RE.test([spec.title, spec.subtitle, spec.body, spec.value, spec.label, ...(spec.items || [])].filter(Boolean).join(" "));
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
    map(s, L) {
      const panel = h("div", "panel");
      const svgWrap = anim(h("div", "svgwrap"), "fade-up", 0.05, 0.6);
      panel.appendChild(svgWrap);
      const cap = h("div", "caption");
      cap.appendChild(anim(h("div", "title", s.title), "reveal", 0.3));
      if (s.subtitle) cap.appendChild(anim(h("div", "subtitle", s.subtitle), "fade-up", 0.45, 0.5));
      panel.appendChild(cap);
      state.pending.push(buildMap(svgWrap, s.countries || []));
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

  async function buildMap(container, names) {
    const W = 600, H = 360;
    const fc = await world();
    const hi = names.map((n) => matchCountry(fc.features, n)).filter(Boolean);
    const hiIds = new Set(hi.map((f) => f.id));
    let projection;
    if (hi.length) {
      const b = d3.geoBounds({ type: "FeatureCollection", features: hi });
      let [[x0, y0], [x1, y1]] = b;
      if (x1 < x0) x1 += 360; // crosses the antimeridian
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const spanX = Math.max(x1 - x0, 14) * 1.9, spanY = Math.max(y1 - y0, 9) * 1.9;
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
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const clip = document.createElementNS(ns, "clipPath"); clip.id = "mapclip";
    const cr = document.createElementNS(ns, "rect"); cr.setAttribute("width", W); cr.setAttribute("height", H); clip.appendChild(cr);
    svg.appendChild(clip);
    const g = document.createElementNS(ns, "g"); g.setAttribute("clip-path", "url(#mapclip)");
    const grat = document.createElementNS(ns, "path"); grat.setAttribute("class", "graticule"); grat.setAttribute("d", path(d3.geoGraticule10())); g.appendChild(grat);
    for (const f of fc.features) {
      if (hiIds.has(f.id)) continue;
      const p = document.createElementNS(ns, "path"); p.setAttribute("class", "land"); p.setAttribute("d", path(f) || ""); g.appendChild(p);
    }
    state.mapHi = [];
    for (const f of hi) {
      const p = document.createElementNS(ns, "path"); p.setAttribute("class", "hi"); p.setAttribute("d", path(f) || ""); g.appendChild(p); state.mapHi.push(p);
    }
    svg.appendChild(g);
    container.appendChild(svg);
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

    state = { spec, duration: spec.duration, anims: [], pending: [], countup: null, countupEl: null, mapHi: [] };
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
        case "pop": st.opacity = String(Math.min(1, e * 2)); st.transform = `scale(${0.7 + 0.3 * ease.outBack(e)})`; st.transformOrigin = rtl ? "right center" : "left center"; break;
      }
    }
    if (state.countup && state.countupEl) {
      const e = ease.outExpo(clamp01((t - 0.1) / 1.1));
      state.countupEl.textContent = formatCount(state.countup, state.countup.num * e);
    }
    for (const p of state.mapHi) p.style.fillOpacity = String(0.82 + 0.18 * Math.sin(t * 3.0));
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
