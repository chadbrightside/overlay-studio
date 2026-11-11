/* Sardiye Studio UI: guided four-step flow over the local API. */
const $ = (id) => document.getElementById(id);
const t = (k, p) => window.i18n.t(k, p);
const S = { settings: null, health: null, projects: [], project: null, transcript: null, plan: null, job: null, jobTimer: null, saveTimer: null, step: 1, open: new Set(), update: null };

const TYPES = {
  lower_third: { label: "Name card", icon: "i-user", fields: [["title", "Name"], ["subtitle", "Role or description"]] },
  term: { label: "Definition", icon: "i-book", fields: [["title", "Term"], ["body", "Definition", "full"]] },
  stat: { label: "Number", icon: "i-hash", fields: [["value", "Number as shown (73%, 4.2 مليار دولار)"], ["label", "What it measures"], ["source", "Source (optional)", "full"]] },
  quote: { label: "Quote", icon: "i-quote", fields: [["body", "Quote", "full"], ["title", "Who said it"]] },
  headline: { label: "Headline", icon: "i-heading", fields: [["title", "Headline"], ["subtitle", "Small line above (optional)"]] },
  list: { label: "List", icon: "i-list", fields: [["title", "List title"], ["items", "Items, one per line", "full", "textarea"]] },
  map: { label: "Map", icon: "i-map", fields: [["countries", "Main countries, in gold (English names, comma separated)", "full"], ["items", "Related countries, in blue (English names, one per line)", "full", "textarea"], ["pairs", "Names written on the map, one per line: English name | name as shown", "full", "pairs"], ["route", "Route, one place per line: a country, \"City, Country\", or lat,lon", "full", "textarea"], ["label", "Route name (optional)"], ["title", "Label"], ["subtitle", "Context (optional)"]] },
  keyword: { label: "Keyword", icon: "i-zap", fields: [["title", "Word or phrase (exactly as spoken)"], ["subtitle", "Small context line (optional)"]] },
  timeline: { label: "Timeline", icon: "i-timeline", fields: [["title", "Timeline title"], ["pairs", "Entries, one per line: date | event", "full", "pairs"]] },
  compare: { label: "Comparison", icon: "i-columns", fields: [["title", "First side"], ["subtitle", "Second side"], ["pairs", "Rows, one per line: what is compared | first figure | second figure", "full", "pairs"]] },
  image: { label: "Image", icon: "i-image", fields: [["query", "Search words (English, for example a person's full name)"], ["title", "Caption"], ["subtitle", "Context (optional)"], ["credit", "Credit shown under the photo", "full"]] },
  seats: { label: "Seats", icon: "i-seats", fields: [["title", "Election or chamber"], ["value", "Total seats (number)"], ["pairs", "Parties, one per line: party | seats | colour (optional, e.g. #e8b23a)", "full", "pairs"], ["subtitle", "Context (optional)"], ["source", "Source (optional)", "full"]] },
  camps: { label: "Two camps", icon: "i-camps", fields: [["title", "First camp"], ["subtitle", "Second camp"], ["pairs", "Groups, one per line: group | what defines it | 1 or 2 (which camp)", "full", "pairs"], ["items", "Common ground, one per line (optional)", "full", "textarea"]] },
  share: { label: "Share", icon: "i-share", fields: [["title", "What the shares are"], ["pairs", "Segments, one per line: name | share (45% or a number)", "full", "pairs"], ["source", "Source (optional)", "full"]] },
  versus: { label: "Two sides", icon: "i-versus", fields: [["title", "First side"], ["subtitle", "Second side"], ["countries", "Two countries for the flags (English names, comma separated)", "full"], ["pairs", "Figures, one per line: what | first side | second side (optional)", "full", "pairs"]] },
  chart: { label: "Chart", icon: "i-chart", fields: [["title", "Chart title"], ["label", "Unit (optional)"], ["pairs", "Bars, one per line: label | figure", "full", "pairs"], ["source", "Source (optional)", "full"]] }
};
const DENSITY_HELP = { light: "About one overlay every two minutes. Calm.", normal: "About one per minute. Recommended.", rich: "About two per minute. Busy, for fast-paced episodes.", dense: "About three per minute. Something on screen most of the time." };
const JOB_NAMES = { attach: "Adding the video", auto: "Adding overlays", transcribe: "Transcribing", plan: "Claude is planning", clip: "Rendering preview clip", "export-burn": "Exporting finished video", "export-alpha": "Exporting overlay track", "export-proxy": "Exporting 1080p check", update: "Updating… the app restarts by itself when done." };
const LANGS = { ar: "Arabic", en: "English", tr: "Turkish", fr: "French", fa: "Persian", ur: "Urdu", de: "German", es: "Spanish" };

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) { if (typeof body === "string") { opts.headers["Content-Type"] = "text/plain"; opts.body = body; } else { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); } }
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
function toast(msg, kind = "") { const el = $("toast"); el.textContent = msg; el.className = "toast " + kind; clearTimeout(el._t); el._t = setTimeout(() => el.classList.add("hidden"), kind === "error" ? 9000 : 3500); }
const fmtClock = (s) => { s = Math.round(Number(s) || 0); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; return (h ? h + ":" : "") + String(m).padStart(h ? 2 : 1, "0") + ":" + String(r).padStart(2, "0"); };
const fmtSize = (b) => b > 1e9 ? (b / 1e9).toFixed(2) + " GB" : (b / 1e6).toFixed(1) + " MB";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = (id, cls = "ic") => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
const langName = (c) => t(LANGS[c] || c);
const hasVideo = () => !!S.project?.video;
const placed = (o) => Number.isFinite(o.start) && Number.isFinite(o.end);
function sortOverlays(list) { return list.sort((a, b) => (placed(a) && placed(b)) ? a.start - b.start : placed(a) ? -1 : placed(b) ? 1 : 0); }
const wordCount = (s) => String(s || "").split(/\s+/).filter(Boolean).length;

/* ---------- boot ---------- */
async function boot() {
  [S.settings, S.health, S.projects] = await Promise.all([api("GET", "/api/settings"), api("GET", "/api/health"), api("GET", "/api/projects")]);
  setLang(localStorage.getItem("uiLanguage") || S.settings.uiLanguage || "en", false);
  setTheme(localStorage.getItem("uiTheme") || S.settings.uiTheme || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"), false);
  renderHealth(); renderNav();
  const last = localStorage.getItem("lastProject");
  if (last && S.projects.some((p) => p.id === last)) await openProject(last);
  else if (S.projects.length) await openProject(S.projects[0].id);
  else await showWelcome();
  checkUpdates(true);
}
function setLang(l, save = true) {
  window.i18n.apply(l);
  localStorage.setItem("uiLanguage", l);
  $("langSeg").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.lang === l));
  if (save) { api("PUT", "/api/settings", { uiLanguage: l }).catch(() => {}); renderHealth(); renderNav(); if (S.project) renderAll(); else if ($("welcome") && !$("welcome").classList.contains("hidden")) showWelcome(); }
}
function setTheme(th, save = true) {
  th = th === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = th;
  localStorage.setItem("uiTheme", th);
  $("themeSeg").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.theme === th));
  if (save) api("PUT", "/api/settings", { uiTheme: th }).catch(() => {});
}
function renderHealth() {
  const h = S.health;
  const item = (ok, label) => `<span class="${ok ? "ok" : "bad"}"><i></i>${t(label)}</span>`;
  $("healthList").innerHTML = item(h.ffmpeg, "Video engine") + item(h.chromium, "Renderer") + item(h.python?.ok, "Whisper") + item(h.apiKey, "Claude");
  $("healthDetail").innerHTML = `${t("Video engine")}: ${h.ffmpeg ? "OK" : "missing, run npm install"}<br>${t("Renderer")}: ${h.chromium ? "OK" : "missing, run npm run setup"}<br>${t("Whisper")}: ${h.python?.ok ? `Python ${h.python.python}, faster-whisper ${h.python.fasterWhisper}` : "not available (" + esc(h.python?.error || "Python not found") + ")"}<br>Node ${h.node} · ${h.platform}`;
  $("versionLine").textContent = `Sardiye Studio ${h.version}`;
}
function renderNav() {
  $("projectNav").innerHTML = S.projects.map((p) => {
    const st = p.status || {};
    const cls = S.job && S.job.projectId === p.id && S.job.status === "running" ? "busy" : st.plan ? "ok" : st.transcript ? "half" : "";
    return `<button data-id="${esc(p.id)}" class="${S.project?.id === p.id ? "active" : ""}"><span class="dot ${cls}"></span><span class="name">${esc(p.name)}</span></button>`;
  }).join("") || `<p class="muted small" style="padding:8px">${t("No projects yet.")}</p>`;
  $("projectNav").querySelectorAll("button").forEach((b) => b.onclick = () => openProject(b.dataset.id));
}
async function showWelcome() {
  S.project = null; renderNav();
  $("welcome").classList.remove("hidden"); $("project").classList.add("hidden");
  const inbox = await api("GET", "/api/inbox");
  $("inboxList").innerHTML = inbox.files.map((f) => `<button data-path="${esc(f.path)}" role="listitem">${icon("i-film")}<span>${esc(f.name)}</span><span class="size">${fmtSize(f.size)}</span></button>`).join("") || `<p class="muted small">${t("The inbox folder is empty. Copy a video into it, or paste a path below.")}</p>`;
  $("inboxList").querySelectorAll("button").forEach((b) => b.onclick = () => createProject(b.dataset.path));
  $("revealInbox").onclick = () => api("POST", "/api/projects/_/reveal", { path: inbox.dir });
}
async function createProject(videoPath) {
  if (!videoPath) return toast(t("Enter the path of a video file"), "error");
  const btn = $("createProjectBtn"); btn.classList.add("loading");
  try { const p = await api("POST", "/api/projects", { videoPath }); S.projects = await api("GET", "/api/projects"); await openProject(p.id); toast(t("Project created"), "ok"); }
  catch (e) { toast(e.message, "error"); } finally { btn.classList.remove("loading"); }
}

/* ---------- project ---------- */
async function openProject(id) {
  S.project = await api("GET", `/api/projects/${id}`);
  localStorage.setItem("lastProject", id);
  $("welcome").classList.add("hidden"); $("project").classList.remove("hidden");
  $("whisperModel").value = S.settings.whisperModel; $("spokenLang").value = S.settings.language;
  setSeg(S.settings.density); $("overlayLang").value = S.settings.overlayLanguage;
  $("burnCodec").value = S.settings.render.burnCodec; $("burnCrf").value = S.settings.render.burnCrf; $("burnPreset").value = S.settings.render.burnPreset;
  S.transcript = S.project.status.transcript ? await api("GET", `/api/projects/${id}/transcript`) : null;
  S.script = S.project.status.script ? (await api("GET", `/api/projects/${id}/script`)).text : null;
  S.plan = S.project.status.plan ? await api("GET", `/api/projects/${id}/plan`) : null;
  S.open = new Set();
  renderNav(); renderAll();
  const saved = Number(localStorage.getItem("step:" + id));
  goStep(saved && stepAllowed(saved) ? saved : firstOpenStep());
  if (S.project.activeJob) watchJob(S.project.activeJob.id);
}
function renderAll() {
  const v = S.project.video;
  $("projectTitle").textContent = S.project.name;
  $("videoInfo").innerHTML = v ? `${v.width}×${v.height} · ${v.fps.toFixed(2)} ${t("fps")} · ${fmtClock(v.duration)} · ${fmtSize(v.sizeBytes)}${v.isHdr ? ` · <span style="color:var(--warn)">${t("HDR source")}</span>` : ""}` : `${t("Script only")} · ${t("No video yet")} · ${t("{n} words", { n: wordCount(S.script) })}`;
  $("exportCard").classList.toggle("hidden", !hasVideo()); $("noVideoNotice").classList.toggle("hidden", hasVideo());
  renderTranscript(); renderPlanStep(); renderOverlays(); renderRenders(); renderStepper(); setSeg($("densitySeg").dataset.value || S.settings.density);
  $("autoCard").classList.toggle("hidden", !!S.plan || !hasVideo());
}
function firstOpenStep() { if (!S.transcript && !S.script) return 1; if (!S.plan) return 2; return S.project.renders?.length ? 4 : 3; }
function stepAllowed(n) { return n === 1 || (n === 2 && (S.transcript || S.script != null)) || (n === 3 && S.plan) || (n === 4 && S.plan && hasVideo()); }
function goStep(n) {
  if (!stepAllowed(n)) return;
  S.step = n; localStorage.setItem("step:" + S.project.id, n);
  document.querySelectorAll(".step-panel").forEach((p) => p.classList.toggle("active", p.id === "panel" + n));
  renderStepper();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function renderStepper() {
  const hints = {
    1: S.transcript ? `${t("{n} segments", { n: S.transcript.segments.length })} · ${langName(S.transcript.language)}` : !hasVideo() ? t("{n} words", { n: wordCount(S.script) }) : t("Not started"),
    2: S.plan ? t("{n} overlays", { n: S.plan.overlays.length }) : (S.transcript || S.script != null) ? t("Ready") : t("Needs a transcript"),
    3: S.plan ? t("{n} to check", { n: S.plan.overlays.filter((o) => o.verify).length }) : t("Needs a plan"),
    4: S.project.renders?.length ? t("{n} file(s)", { n: S.project.renders.length }) : !hasVideo() ? t("Needs the video") : S.plan ? t("Ready") : t("Needs a plan")
  };
  $("stepLabel1").textContent = t(hasVideo() ? "Transcript" : "Script");
  document.querySelectorAll(".step").forEach((b) => {
    const n = Number(b.dataset.step);
    b.disabled = !stepAllowed(n);
    b.classList.toggle("current", n === S.step);
    b.classList.toggle("done", (n === 1 && !!S.transcript) || (n === 2 && !!S.plan) || (n === 3 && !!S.plan && !S.plan.overlays.some((o) => o.verify)) || (n === 4 && !!S.project.renders?.length));
    $("stepHint" + n).textContent = hints[n];
  });
}
function renderTranscript() {
  const tr = S.transcript;
  const scriptOnly = !hasVideo();
  $("scriptPanel").classList.toggle("hidden", !scriptOnly);
  $("panel1Title").textContent = t(scriptOnly ? "Script" : "Transcript");
  if (scriptOnly) {
    $("transcriptEmpty").classList.add("hidden"); $("transcriptDone").classList.add("hidden");
    $("transcriptBadge").textContent = ""; $("transcriptStatus").textContent = t("Claude plans the graphics on this text. Add the video when it is filmed.");
    if (document.activeElement !== $("scriptEdit")) $("scriptEdit").value = S.script || "";
    $("scriptWords").textContent = t("{n} words", { n: wordCount(S.script) });
    return;
  }
  $("transcriptEmpty").classList.toggle("hidden", !!tr); $("transcriptDone").classList.toggle("hidden", !tr);
  $("transcriptBadge").textContent = tr ? t("Done") : t("Step 1"); $("transcriptBadge").className = "badge" + (tr ? " ok" : "");
  $("transcriptStatus").textContent = tr ? t("The transcript is ready. Read it if you like, then continue.") : t("The transcript tells Claude what is said and when.");
  if (!tr) return;
  $("tSegments").textContent = tr.segments.length; $("tLang").textContent = langName(tr.language); $("tModel").textContent = tr.model === "imported-subtitles" ? t("Subtitles") : "Whisper " + tr.model;
  $("transcriptBox").innerHTML = tr.segments.map((s) => `<div class="seg" data-start="${s.start}" data-end="${s.end}"><span class="t">${fmtClock(s.start)}</span><span class="x">${esc(s.text)}</span></div>`).join("");
  $("transcriptBox").querySelectorAll(".seg").forEach((el) => el.onclick = () => { addOverlay(Number(el.dataset.start), Number(el.dataset.end)); });
}
function renderPlanStep() {
  const p = S.plan;
  $("planIntro").textContent = t(hasVideo() ? "Claude reads the transcript and decides where a name card, definition, number, quote, map or list helps the viewer." : "Claude reads the script and decides where a name card, definition, number, quote, map or list helps the viewer. The cards get their timing when you add the video.");
  $("needKey").classList.toggle("hidden", !!S.health.apiKey);
  $("planBtn").disabled = !S.health.apiKey; $("reviseBtn").classList.toggle("hidden", !p); $("reviseBtn").disabled = !S.health.apiKey;
  $("planBtnText").textContent = t(p ? "Plan again from scratch" : "Plan with Claude");
  $("planBtn").classList.toggle("lg", !p); $("planBtn").classList.toggle("primary", !p); $("reviseBtn").classList.toggle("primary", !!p);
  $("planDone").classList.toggle("hidden", !p);
  if (!p) return;
  $("planTitle").textContent = p.episodeTitle || t("Plan ready");
  $("planSummary").textContent = `${t("{n} overlays", { n: p.overlays.length })}. ${p.summary || ""}`;
  $("planCost").textContent = p.meta?.estimatedCostUsd != null ? `~$${p.meta.estimatedCostUsd.toFixed(2)}` : (p.meta?.model || "");
}
function renderRenders() {
  const r = S.project.renders || [];
  $("renders").innerHTML = r.length ? r.map((f) => `<div class="render">${icon("i-check")}<span class="name">${esc(f.name)}</span><span class="size">${fmtSize(f.size)}</span><a class="btn small" href="/api/projects/${S.project.id}/files/renders/${encodeURIComponent(f.name)}" download>${icon("i-download")} ${t("Download")}</a><button class="btn small ghost" data-reveal="${esc(f.path)}">${icon("i-folder")} ${t("Show in folder")}</button></div>`).join("") : `<p class="muted">${t("Nothing exported yet.")}</p>`;
  $("renders").querySelectorAll("[data-reveal]").forEach((b) => b.onclick = () => api("POST", `/api/projects/${S.project.id}/reveal`, { path: b.dataset.reveal }));
}

/* ---------- overlays ---------- */
function renderOverlays() {
  const list = $("overlayList");
  const ovs = S.plan?.overlays || [];
  const toCheck = ovs.filter((o) => o.verify).length;
  $("verifyNotice").classList.toggle("hidden", !toCheck); $("verifyCount").textContent = t(toCheck === 1 ? "{n} fact to check." : "{n} facts to check.", { n: toCheck });
  renderTimeline(ovs);
  if (!ovs.length) { list.innerHTML = `<div class="empty">${t("No overlays yet. Plan with Claude in step 2, or add one by hand.")}</div>`; return; }
  const corners = ["top-left", "top-right", "bottom-left", "bottom-right", "split"];
  list.innerHTML = ovs.map((o, i) => {
    const T = TYPES[o.type] || TYPES.lower_third;
    const preview = o.title || o.value || o.body || (o.items || [])[0] || ((o.pairs || [])[0] || {}).value || t("(empty)");
    return `<div class="ov ${S.open.has(o.id) ? "open" : ""} ${o.enabled === false ? "off" : ""}" data-i="${i}" id="card-${esc(o.id)}">
      <div class="ov-head" role="button" tabindex="0" aria-expanded="${S.open.has(o.id)}">
        <span class="type-chip" style="--c:var(--c-${o.type})">${icon(T.icon)}${t(T.label)}</span>
        <span class="ov-time ${placed(o) ? "" : "unplaced"}">${placed(o) ? `${fmtClock(o.start)} – ${fmtClock(o.end)}` : t("Not placed yet")}</span>
        <span class="ov-preview">${esc(preview)}</span>
        ${o.verify ? `<span class="check-badge">${icon("i-alert")}${t("check")}</span>` : ""}
        ${o.enabled === false ? `<span class="badge">${t("off")}</span>` : ""}
        ${icon("i-chevron", "ic chev")}
      </div>
      <div class="ov-body">
        <div>
          <div class="ov-fields">
            <label>${t("Type")}<select data-f="type">${Object.entries(TYPES).map(([k, ty]) => `<option value="${k}" ${k === o.type ? "selected" : ""}>${t(ty.label)}</option>`).join("")}</select></label>
            <label>${t("Corner")}<select data-f="position">${corners.map((p) => `<option value="${p}" ${o.position === p ? "selected" : ""}>${t(p.replace("-", " "))}</option>`).join("")}</select></label>
            ${hasVideo() ? `<label>${t("Starts at (seconds)")}<input type="number" step="0.1" min="0" data-f="start" value="${placed(o) ? o.start : ""}"></label>
            <label>${t("Ends at (seconds)")}<input type="number" step="0.1" min="0" data-f="end" value="${placed(o) ? o.end : ""}"></label>` : ""}
            ${(!hasVideo() || o.anchor || !placed(o)) ? `<label class="full">${t("Where in the script")}<input type="text" data-f="anchor" value="${esc(o.anchor || "")}" placeholder="${esc(t("The words you say when it should appear"))}"></label>` : ""}
            ${T.fields.map(([k, label, span, kind]) => `<label class="${span || ""}">${t(label)}${kind === "textarea" || kind === "pairs" ? `<textarea rows="${kind === "pairs" ? 4 : 3}" data-f="${k}">${esc(kind === "pairs" ? pairsText(o.pairs) : (o[k] || []).join("\n"))}</textarea>` : `<input type="text" data-f="${k}" value="${esc(k === "countries" ? (o.countries || []).join(", ") : o[k])}">`}</label>`).join("")}
          </div>
          ${o.type === "image" ? imageBlock(o) : ""}
          ${o.reason ? `<p class="ov-reason" style="margin-top:10px">${icon("i-sparkles")} ${esc(o.reason === "Added by hand" ? t("Added by hand") : o.reason.includes("Not found in the recording") ? t("Not found in the recording. Place it by hand.") : o.reason)}</p>` : ""}
          ${hasVideo() && S.transcript ? `<div class="row"><button class="btn small ${placed(o) ? "" : "primary"}" data-act="place">${icon("i-review")} ${t(placed(o) ? "Move to another moment…" : "Place in the video…")}</button></div>` : ""}
        </div>
        <div class="ov-side ${hasVideo() && placed(o) ? "" : "hidden"}">
          <div class="thumb" data-role="thumb"><div class="ph">${t("Rendering thumbnail…")}</div></div>
          <div class="ov-actions">
            <button class="btn small" data-act="clip">${icon("i-play")} ${t("Preview clip")}</button>
            <button class="btn small ghost" data-act="still">${icon("i-image")} ${t("Refresh thumbnail")}</button>
          </div>
          <div class="ov-actions">
            ${o.verify ? `<button class="btn small" data-act="verified">${icon("i-check")} ${t("Mark as checked")}</button>` : ""}
            <button class="btn small ghost" data-act="toggle">${t(o.enabled === false ? "Include in export" : "Leave out of export")}</button>
            <button class="btn small ghost danger" data-act="delete">${icon("i-trash")} ${t("Delete")}</button>
          </div>
          <span class="muted small" data-role="msg"></span>
        </div>
      </div>
    </div>`;
  }).join("");
  list.querySelectorAll(".ov").forEach((card) => {
    const i = Number(card.dataset.i); const o = S.plan.overlays[i];
    const head = card.querySelector(".ov-head");
    const toggleOpen = () => { if (S.open.has(o.id)) S.open.delete(o.id); else S.open.add(o.id); renderOverlays(); if (S.open.has(o.id)) loadStill(o.id); };
    head.onclick = toggleOpen; head.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleOpen(); } };
    card.querySelectorAll("[data-f]").forEach((input) => input.addEventListener("input", () => onEdit(i, input)));
    card.querySelector("[data-act=delete]").onclick = () => { if (!confirm(t("Delete this overlay?"))) return; S.plan.overlays.splice(i, 1); renderOverlays(); renderStepper(); savePlanSoon(); };
    card.querySelector("[data-act=toggle]").onclick = () => { o.enabled = o.enabled === false; renderOverlays(); savePlanSoon(); };
    card.querySelector("[data-act=still]").onclick = () => loadStill(o.id, true);
    card.querySelector("[data-act=clip]").onclick = () => loadClip(o.id);
    const v = card.querySelector("[data-act=verified]"); if (v) v.onclick = () => { o.verify = false; renderOverlays(); renderStepper(); savePlanSoon(); };
    const pl = card.querySelector("[data-act=place]"); if (pl) pl.onclick = () => openPicker(o.id);
    if (o.type === "image") {
      const upd = (res) => { Object.assign(o, { image: res.image, imageUrl: res.imageUrl, credit: res.credit, imagePage: res.imagePage, candidates: res.candidates ?? o.candidates }); renderOverlays(); renderStepper(); if (hasVideo() && placed(o)) loadStill(o.id, true); };
      const busy = async (btn, fn) => { btn.classList.add("loading"); try { await fn(); } catch (e) { toast(e.message, "error"); } finally { btn.classList.remove("loading"); } };
      card.querySelector("[data-act=imgsearch]").onclick = (e) => busy(e.currentTarget, async () => { await flushSave(); const r = await api("POST", `/api/projects/${S.project.id}/overlays/${o.id}/images/search`, { query: card.querySelector("[data-f=query]").value.trim() }); o.candidates = r.candidates; renderOverlays(); if (!r.candidates.length) toast(t("No free picture found. Try other words, or choose a file.")); });
      card.querySelectorAll("[data-cand]").forEach((el) => el.onclick = () => busy(el, async () => { await flushSave(); const c = o.candidates[Number(el.dataset.cand)]; upd(await api("POST", `/api/projects/${S.project.id}/overlays/${o.id}/images/select`, { url: c.url, credit: c.credit, page: c.page })); }));
      card.querySelector("[data-act=imgfile]").onclick = (e) => busy(e.currentTarget, async () => { const r = await api("POST", "/api/pick-file", { prompt: t("Choose a picture"), kind: "image" }); if (!r.path) return; await flushSave(); upd(await api("POST", `/api/projects/${S.project.id}/overlays/${o.id}/images/file`, { filePath: r.path, credit: o.credit || "" })); });
      const fc = card.querySelector("[data-act=imgfocus]"); if (fc) fc.onclick = (e) => busy(fc, async () => { const r = fc.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height; if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return; await flushSave(); const res = await api("POST", `/api/projects/${S.project.id}/overlays/${o.id}/images/focus`, { x, y }); o.focus = res.focus; renderOverlays(); if (hasVideo() && placed(o)) loadStill(o.id, true); });
      const ff = card.querySelector("[data-act=imgface]"); if (ff) ff.onclick = (e) => busy(e.currentTarget, async () => { await flushSave(); const res = await api("POST", `/api/projects/${S.project.id}/overlays/${o.id}/images/focus`, {}); o.focus = res.focus; renderOverlays(); if (hasVideo() && placed(o)) loadStill(o.id, true); toast(res.focus?.faces ? t("Face found.") : t("No face found; centred.")); });
      const rm = card.querySelector("[data-act=imgremove]"); if (rm) rm.onclick = () => { o.image = ""; o.imageUrl = ""; o.credit = ""; o.imagePage = ""; renderOverlays(); savePlanSoon(); };
      card.querySelector("[data-act=imgurl]").onclick = (e) => busy(e.currentTarget, async () => { const url = card.querySelector("[data-f=imageUrl]").value.trim(); if (!url) return; await flushSave(); upd(await api("POST", `/api/projects/${S.project.id}/overlays/${o.id}/images/select`, { url, credit: o.credit || "" })); });
    }
    if (S.open.has(o.id) && hasVideo() && placed(o) && !card.querySelector(".thumb img")) loadStill(o.id);
  });
}
function imageBlock(o) {
  const f = o.focus || { x: 0.5, y: 0.45 };
  const cur = o.image ? `<div class="img-focus" data-act="imgfocus" title="${esc(t("Click where the subject is"))}"><img class="img-current" src="/api/projects/${S.project.id}/files/${esc(o.image)}?v=${esc(o.image)}" alt=""><i class="focus-dot" style="left:${(f.x * 100).toFixed(1)}%;top:${(f.y * 100).toFixed(1)}%"></i></div>` : `<div class="img-current empty">${t("No picture yet")}</div>`;
  const cands = (o.candidates || []).map((c, i) => `<button type="button" class="cand ${o.image && c.url === o.imageUrl ? "sel" : ""}" data-cand="${i}" title="${esc(c.title)} · ${esc(c.credit)}"><img src="${esc(c.thumb)}" alt="${esc(c.title)}" loading="lazy"></button>`).join("");
  return `<div class="img-block">
    <div class="img-row">${cur}<div class="img-side">
      <div class="ov-actions"><button type="button" class="btn small" data-act="imgsearch">${icon("i-image")} ${t("Search free pictures")}</button><button type="button" class="btn small ghost" data-act="imgfile">${icon("i-folder")} ${t("Choose a file…")}</button>${o.image ? `<button type="button" class="btn small ghost" data-act="imgface">${icon("i-user")} ${t("Centre on the face")}</button><button type="button" class="btn small ghost danger" data-act="imgremove">${icon("i-trash")} ${t("Remove picture")}</button>` : ""}</div>
      ${o.image ? `<p class="muted small">${t(o.focus?.auto === false ? "Focus set by hand. Click the picture to move it." : o.focus?.faces ? "Centred on the face found in the picture. Click the picture to move the focus." : "No face found; centred. Click the picture where the subject is.")}</p>` : ""}
      <div class="row" style="margin-top:8px"><input type="text" data-f="imageUrl" placeholder="https://…" aria-label="${esc(t("Image address"))}"><button type="button" class="btn small ghost" data-act="imgurl">${t("Use this address")}</button></div>
      ${o.imagePage ? `<a class="muted small" href="${esc(o.imagePage)}" target="_blank" rel="noopener">${t("Source page")}</a>` : ""}
    </div></div>
    ${cands ? `<div class="cands">${cands}</div>` : ""}
    <p class="muted small">${t("Pictures come from Wikipedia and Wikimedia Commons with their licence, which is shown as the credit. For news photos, use a file you have the right to publish.")}</p>
  </div>`;
}
function pairsText(pairs) { return (pairs || []).map((p) => [p.label || "", p.value || "", p.value2 || ""].filter((x, i) => i < 2 || x).join(" | ")).join("\n"); }
function renderTimeline(ovs) {
  document.querySelector(".timeline-wrap").classList.toggle("hidden", !hasVideo());
  if (!hasVideo()) return;
  ovs = ovs.filter(placed);
  const svg = $("timeline"); const dur = S.project.video.duration || 1;
  const W = 1000, H = 56;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  let s = `<line x1="0" y1="${H - 14}" x2="${W}" y2="${H - 14}" stroke="var(--hair-3)" stroke-width="1"/>`;
  const ticks = dur > 600 ? 300 : dur > 180 ? 60 : 30;
  for (let x = 0; x <= dur; x += ticks) s += `<text x="${(x / dur) * W}" y="${H - 2}" font-size="9" fill="var(--text-3)" text-anchor="${x === 0 ? "start" : "middle"}" direction="ltr">${fmtClock(x)}</text>`;
  ovs.forEach((o) => { const x = (o.start / dur) * W, w = Math.max(3, ((o.end - o.start) / dur) * W); s += `<rect class="mark" data-id="${esc(o.id)}" x="${x}" y="12" width="${w}" height="24" rx="2" fill="var(--c-${o.type})" opacity="${o.enabled === false ? 0.3 : 1}"><title>${esc(t(TYPES[o.type]?.label))} ${fmtClock(o.start)}: ${esc(o.title || o.value || o.body)}</title></rect>`; });
  svg.innerHTML = s;
  svg.querySelectorAll(".mark").forEach((r) => r.onclick = () => { S.open.add(r.dataset.id); renderOverlays(); document.getElementById("card-" + r.dataset.id)?.scrollIntoView({ behavior: "smooth", block: "center" }); loadStill(r.dataset.id); });
  const used = [...new Set(ovs.map((o) => o.type))];
  $("timelineLegend").innerHTML = used.map((ty) => `<span><i style="background:var(--c-${ty})"></i>${t(TYPES[ty]?.label)}</span>`).join("");
}
function onEdit(i, input) {
  const o = S.plan.overlays[i]; const f = input.dataset.f;
  if (f === "start" || f === "end") o[f] = input.value === "" ? null : Number(input.value);
  else if (f === "items" || f === "route") o[f] = input.value.split("\n").map((s) => s.trim()).filter(Boolean);
  else if (f === "countries") o.countries = input.value.split(",").map((s) => s.trim()).filter(Boolean);
  else if (f === "pairs") o.pairs = input.value.split("\n").map((l) => l.split("|").map((s) => s.trim())).filter((a) => a.some(Boolean)).map(([label = "", value = "", value2 = ""]) => ({ label, value, value2 }));
  else if (f === "type") { o.type = input.value; renderOverlays(); }
  else o[f] = input.value;
  if (f === "type" || f === "position") loadStill(o.id, true);
  savePlanSoon();
}
function savePlanSoon() {
  $("saveStatus").textContent = t("Saving…");
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(async () => {
    S.saveTimer = null;
    try { const saved = await api("PUT", `/api/projects/${S.project.id}/plan`, S.plan); S.plan = { ...S.plan, ...saved }; $("saveStatus").textContent = t("Saved."); renderTimeline(S.plan.overlays); }
    catch (e) { $("saveStatus").textContent = t("Could not save: ") + e.message; }
  }, 700);
}
async function flushSave() { if (S.saveTimer) { clearTimeout(S.saveTimer); S.saveTimer = null; const saved = await api("PUT", `/api/projects/${S.project.id}/plan`, S.plan); S.plan = { ...S.plan, ...saved }; $("saveStatus").textContent = t("Saved."); } }
function placeOverlay(id, start, end) {
  const o = S.plan.overlays.find((x) => x.id === id); if (!o) return;
  const keep = placed(o) ? o.end - o.start : null;
  o.start = Math.max(0, Math.round((start - 0.3) * 10) / 10); o.end = keep ? Math.round((o.start + keep) * 10) / 10 : Math.round(Math.max(end, start + 5) * 10) / 10; if (!keep) o.verify = false;
  o.reason = (o.reason || "").replace(/\s*Not found in the recording\. Place it by hand\.$/, "");
  sortOverlays(S.plan.overlays); S.pickTarget = null; closePicker(); renderOverlays(); renderStepper(); savePlanSoon(); if (hasVideo()) loadStill(id, true);
  setTimeout(() => $("card-" + id)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
}
function addOverlay(start, end) {
  if (!S.plan) S.plan = { overlays: [], episodeTitle: "", summary: "" };
  const id = `ov-${Date.now().toString(36)}`;
  const type = S.addType || "lower_third"; S.addType = null;
  S.plan.overlays.push({ id, type, start: Math.max(0, Math.round((start - 0.3) * 10) / 10), end: Math.round(Math.max(end, start + 5) * 10) / 10, position: S.settings.brand.position, title: "", subtitle: "", body: "", value: "", label: "", source: "", items: [], countries: [], route: [], pairs: [], reason: "Added by hand", verify: false, enabled: true });
  sortOverlays(S.plan.overlays);
  S.open.add(id); closePicker(); goStep(3); renderOverlays(); renderStepper(); savePlanSoon();
  setTimeout(() => { const card = $("card-" + id); card?.scrollIntoView({ behavior: "smooth", block: "center" }); card?.querySelector("input[type=text]")?.focus(); }, 50);
}
async function loadStill(id, force = false) {
  const card = $("card-" + id); if (!card) return;
  const box = card.querySelector("[data-role=thumb]"); const msg = card.querySelector("[data-role=msg]");
  if (!force && box.querySelector("img")) return;
  box.innerHTML = `<div class="ph">${t("Rendering thumbnail…")}</div>`;
  await flushSave();
  try {
    const r = await api("POST", `/api/projects/${S.project.id}/overlays/${id}/still`);
    const pct = (v, base) => (v / base * 100).toFixed(3) + "%";
    box.innerHTML = `<img class="frame" src="${r.frame}?t=${Date.now()}" alt="${t("Video frame")}"><img class="ov-png" src="${r.png}?t=${Date.now()}" alt="${t("Overlay")}" style="left:${pct(r.rect.x, r.designW)};top:${pct(r.rect.y, r.designH)};width:${pct(r.rect.w, r.designW)}">`;
    msg.textContent = "";
  } catch (e) { box.innerHTML = `<div class="ph">${t("Could not render")}</div>`; msg.textContent = e.message; }
}
async function loadClip(id) {
  const card = $("card-" + id); const box = card.querySelector("[data-role=thumb]"); const msg = card.querySelector("[data-role=msg]");
  await flushSave();
  try {
    const job = await api("POST", `/api/projects/${S.project.id}/overlays/${id}/clip`);
    msg.textContent = t("Rendering a short clip…");
    const done = await watchJob(job.id);
    if (done.status === "done") { box.innerHTML = `<video controls autoplay muted playsinline src="${done.result.url}"></video>`; msg.textContent = ""; }
    else msg.textContent = done.error || done.status;
  } catch (e) { msg.textContent = e.message; }
}

/* ---------- jobs ---------- */
function watchJob(id) {
  return new Promise((resolve) => {
    clearInterval(S.jobTimer);
    const card = $("jobCard"); card.className = "job";
    const tick = async () => {
      let j; try { j = await api("GET", `/api/jobs/${id}`); } catch { return; }
      S.job = j; renderNav(); setBusy(j.status === "running");
      $("jobKind").textContent = t(JOB_NAMES[j.kind] || j.kind);
      $("jobMessage").textContent = j.message || "";
      $("jobPct").textContent = `${Math.round(j.progress * 100)}%`;
      $("jobProgress").style.width = `${j.progress * 100}%`;
      $("jobLog").textContent = j.log.join("\n"); if (!$("jobLog").classList.contains("hidden")) $("jobLog").scrollTop = 1e9;
      if (j.status !== "running") {
        clearInterval(S.jobTimer);
        card.classList.add(j.status === "done" ? "done" : "error");
        if (j.status === "error") { $("jobMessage").textContent = j.error; toast(j.error, "error"); $("jobLog").classList.remove("hidden"); }
        else if (j.status === "done") { $("jobMessage").textContent = t("Finished."); toast(t(JOB_NAMES[j.kind] || j.kind) + t(": done"), "ok"); setTimeout(() => { if (S.job?.id === id) card.classList.add("hidden"); }, 4000); }
        else { $("jobMessage").textContent = t("Cancelled."); setTimeout(() => card.classList.add("hidden"), 2000); }
        await afterJob(j); resolve(j);
      }
    };
    S.jobTimer = setInterval(tick, 1000); tick();
  });
}
function setBusy(b) { ["transcribeBtn", "planBtn", "reviseBtn", "exportBtn"].forEach((id) => { $(id).disabled = b || (id !== "transcribeBtn" && id !== "exportBtn" && !S.health.apiKey); }); $("autoBtn").disabled = b; $("autoBtn").classList.toggle("loading", b && S.job?.kind === "auto"); }
async function afterJob(j) {
  if (j.projectId !== S.project?.id) return;
  S.projects = await api("GET", "/api/projects");
  if (j.kind === "attach" && j.status === "done") {
    S.project = await api("GET", `/api/projects/${j.projectId}`);
    S.transcript = await api("GET", `/api/projects/${j.projectId}/transcript`);
    S.plan = S.project.status.plan ? await api("GET", `/api/projects/${j.projectId}/plan`) : null;
    S.open = new Set(); renderAll(); goStep(S.plan ? 3 : 2);
    if (j.result && S.plan) toast(t("{n} placed, {m} to place by hand", { n: j.result.matched, m: j.result.unmatched }), j.result.unmatched ? "" : "ok");
  }
  if (j.kind === "auto" && j.status === "done") {
    S.transcript = await api("GET", `/api/projects/${j.projectId}/transcript`);
    S.plan = await api("GET", `/api/projects/${j.projectId}/plan`);
    S.open = new Set(); $("planNotes").value = ""; renderAll(); goStep(S.plan ? 3 : 2);
    if (!S.plan) toast(t("Transcript ready. Connect Claude in Settings to plan the overlays."));
  }
  if (j.kind === "transcribe" && j.status === "done") { S.transcript = await api("GET", `/api/projects/${j.projectId}/transcript`); renderTranscript(); renderStepper(); }
  if (j.kind === "plan" && j.status === "done") { S.plan = await api("GET", `/api/projects/${j.projectId}/plan`); S.open = new Set(); $("planNotes").value = ""; renderPlanStep(); renderOverlays(); renderStepper(); goStep(3); }
  if (j.kind.startsWith("export")) { S.project = await api("GET", `/api/projects/${j.projectId}`); renderRenders(); renderStepper(); }
  renderNav();
}

/* ---------- settings ---------- */
function openSettings() {
  const s = S.settings;
  $("s_apiKey").value = ""; $("s_apiKey").placeholder = s.hasApiKey ? `${t("A key is saved.")} (${s.apiKey})` : "sk-ant-…";
  $("s_model").value = s.model; $("s_effort").value = s.effort; $("s_channelBrief").value = s.channelBrief;
  $("s_accent").value = s.brand.accent; $("s_panel").value = s.brand.panel; $("s_position").value = s.brand.position; $("s_logoCorner").value = s.brand.logoCorner || "top-right"; $("s_scale").value = s.brand.scale; $("s_safeMargin").value = s.brand.safeMargin;
  $("s_pythonPath").value = s.pythonPath; $("s_whisperDevice").value = s.whisperDevice;
  $("settingsMsg").textContent = ""; $("keyStatus").textContent = t(s.hasApiKey ? "A key is saved." : "No key yet."); $("keyStatus").style.color = "";
  renderUpdateStatus();
  $("settingsPanel").classList.remove("hidden"); $("scrim").classList.remove("hidden"); $("s_apiKey").focus();
}
function closeSettings() { $("settingsPanel").classList.add("hidden"); $("scrim").classList.add("hidden"); }
async function saveSettingsFromForm() {
  const patch = { model: $("s_model").value, effort: $("s_effort").value, channelBrief: $("s_channelBrief").value, pythonPath: $("s_pythonPath").value, whisperDevice: $("s_whisperDevice").value,
    brand: { accent: $("s_accent").value, panel: $("s_panel").value, position: $("s_position").value, logoCorner: $("s_logoCorner").value, scale: Number($("s_scale").value), safeMargin: Number($("s_safeMargin").value) } };
  const key = $("s_apiKey").value.trim(); if (key) patch.apiKey = key;
  const btn = $("saveSettings"); btn.classList.add("loading");
  try { S.settings = await api("PUT", "/api/settings", patch); S.health = await api("GET", "/api/health"); renderHealth(); if (S.project) { renderPlanStep(); setBusy(S.job?.status === "running"); } $("settingsMsg").textContent = t("Saved."); toast(t("Settings saved"), "ok"); $("s_apiKey").value = ""; $("keyStatus").textContent = t(S.settings.hasApiKey ? "A key is saved." : "No key yet."); }
  catch (e) { $("settingsMsg").textContent = e.message; } finally { btn.classList.remove("loading"); }
}
async function testKey() {
  const btn = $("testKeyBtn"); btn.classList.add("loading"); $("keyStatus").textContent = t("Checking…"); $("keyStatus").style.color = "";
  try { await api("POST", "/api/settings/test-key", { apiKey: $("s_apiKey").value.trim() }); $("keyStatus").textContent = t("Key works. Save settings to keep it."); $("keyStatus").style.color = "var(--ok)"; }
  catch (e) { $("keyStatus").textContent = e.message; $("keyStatus").style.color = "var(--danger)"; } finally { btn.classList.remove("loading"); }
}
async function saveQuick(patch) { S.settings = await api("PUT", "/api/settings", patch); }
function setSeg(v) { $("densitySeg").querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.v === v)); $("densityHelp").textContent = t(DENSITY_HELP[v] || ""); $("densitySeg").dataset.value = v; }

/* ---------- updates ---------- */
async function checkUpdates(quiet = false) {
  try { S.update = await api("GET", "/api/update/check"); } catch (e) { S.update = { error: e.message }; }
  renderUpdateStatus();
  $("updateBanner").classList.toggle("hidden", !S.update?.available);
  if (S.update?.available) $("updateBannerVersion").textContent = `${S.update.current} → ${S.update.latest}`;
  if (!quiet && S.update?.error) toast(S.update.error, "error");
}
function renderUpdateStatus() {
  const u = S.update; const el = $("updateStatus"); const btn = $("applyUpdateBtn");
  if (!u) { el.textContent = ""; btn.classList.add("hidden"); return; }
  if (u.error) el.textContent = u.error;
  else if (!u.configured) el.textContent = t("Update source is not configured.");
  else el.textContent = u.available ? `${t("A new version is available.")} (${u.current} → ${u.latest})` : `${t("You have the latest version.")} (${u.current})`;
  btn.classList.toggle("hidden", !u.available);
}
async function applyUpdate() {
  closeSettings();
  try {
    const j = await api("POST", "/api/update/apply");
    const done = await watchJob(j.id);
    if (done.status !== "done") return;
    toast(t("Updating… the app restarts by itself when done."));
    // the server exits and the launcher restarts it; wait for it to come back
    for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 1500)); try { await fetch("/api/health", { cache: "no-store" }); if (i > 1) { location.reload(); return; } } catch {} }
    toast("Start the app again to finish the update.", "error");
  } catch (e) { toast(e.message, "error"); }
}

/* ---------- picker ---------- */
function openPicker(targetId = null) {
  S.pickTarget = targetId;
  if (!S.transcript) { if (!targetId) addOverlay(10, 15); return; }
  $("pickerModal").classList.remove("hidden"); $("pickerSearch").value = ""; fillPicker(""); $("pickerSearch").focus();
}
function closePicker() { $("pickerModal").classList.add("hidden"); }
function fillPicker(q) {
  const segs = S.transcript.segments.filter((s) => !q || s.text.includes(q));
  $("pickerList").innerHTML = segs.map((s) => `<div class="seg" data-start="${s.start}" data-end="${s.end}" role="button" tabindex="0"><span class="t">${fmtClock(s.start)}</span><span class="x">${esc(s.text)}</span></div>`).join("") || `<p class="muted" style="padding:12px">${t("No lines match.")}</p>`;
  $("pickerList").querySelectorAll(".seg").forEach((el) => { const go = () => S.pickTarget ? placeOverlay(S.pickTarget, Number(el.dataset.start), Number(el.dataset.end)) : addOverlay(Number(el.dataset.start), Number(el.dataset.end)); el.onclick = go; el.onkeydown = (e) => { if (e.key === "Enter") go(); }; });
}

/* ---------- wiring ---------- */
$("langSeg").querySelectorAll("button").forEach((b) => b.onclick = () => setLang(b.dataset.lang));
$("newProjectBtn").onclick = showWelcome;
$("createProjectBtn").onclick = () => createProject($("videoPathInput").value.trim());
$("videoPathInput").addEventListener("keydown", (e) => { if (e.key === "Enter") createProject(e.target.value.trim()); });
$("settingsBtn").onclick = openSettings; $("closeSettings").onclick = closeSettings; $("scrim").onclick = closeSettings; $("saveSettings").onclick = saveSettingsFromForm; $("testKeyBtn").onclick = testKey;
$("toggleKey").onclick = () => { const i = $("s_apiKey"); i.type = i.type === "password" ? "text" : "password"; };
$("needKeyBtn").onclick = openSettings;
$("checkUpdateBtn").onclick = () => checkUpdates(false); $("applyUpdateBtn").onclick = applyUpdate; $("updateBannerBtn").onclick = applyUpdate;
document.querySelectorAll(".step").forEach((b) => b.onclick = () => goStep(Number(b.dataset.step)));
$("toStep2").onclick = () => goStep(2); $("toStep3").onclick = () => goStep(3); $("toStep4").onclick = () => goStep(4);
$("revealBtn").onclick = () => api("POST", `/api/projects/${S.project.id}/reveal`, {});
$("deleteProjectBtn").onclick = async () => { if (!confirm(t("Delete the project \"{name}\"? Exports and the transcript are removed. The original video stays where it is.", { name: S.project.name }))) return; await api("DELETE", `/api/projects/${S.project.id}`); S.projects = await api("GET", "/api/projects"); S.project = null; S.projects.length ? openProject(S.projects[0].id) : showWelcome(); };
async function startTranscribe() {
  await saveQuick({ whisperModel: $("whisperModel").value, language: $("spokenLang").value });
  try { const j = await api("POST", `/api/projects/${S.project.id}/transcribe`); watchJob(j.id); } catch (e) { toast(e.message, "error"); }
}
$("transcribeBtn").onclick = startTranscribe;
$("createScriptBtn").onclick = async () => {
  const b = $("createScriptBtn"); b.classList.add("loading");
  try { const p = await api("POST", "/api/projects/script", { name: $("scriptName").value.trim(), script: $("scriptText").value }); S.projects = await api("GET", "/api/projects"); $("scriptText").value = ""; $("scriptName").value = ""; await openProject(p.id); }
  catch (e) { toast(e.message, "error"); } finally { b.classList.remove("loading"); }
};
$("saveScriptBtn").onclick = async () => { S.script = $("scriptEdit").value; try { await api("PUT", `/api/projects/${S.project.id}/script`, { text: S.script }); toast(t("Script saved."), "ok"); renderStepper(); $("scriptWords").textContent = t("{n} words", { n: wordCount(S.script) }); } catch (e) { toast(e.message, "error"); } };
$("toStep2b").onclick = () => goStep(2);
$("attachVideoBtn").onclick = async () => {
  const b = $("attachVideoBtn"); b.classList.add("loading");
  try {
    const r = await api("POST", "/api/pick-file", { prompt: t("Choose the episode video") });
    if (!r.path) return;
    await saveQuick({ whisperModel: $("whisperModel").value, language: $("spokenLang").value });
    const j = await api("POST", `/api/projects/${S.project.id}/video`, { videoPath: r.path });
    S.project = await api("GET", `/api/projects/${S.project.id}`); renderAll(); watchJob(j.id);
  } catch (e) { toast(e.message, "error"); } finally { b.classList.remove("loading"); }
};
$("autoBtn").onclick = async () => {
  if (!S.health.apiKey) { toast(t("Connect Claude first.")); openSettings(); return; }
  await saveQuick({ whisperModel: $("whisperModel").value, language: $("spokenLang").value, density: $("densitySeg").dataset.value || "normal", overlayLanguage: $("overlayLang").value });
  try { const j = await api("POST", `/api/projects/${S.project.id}/auto`, { notes: $("planNotes").value }); watchJob(j.id); } catch (e) { toast(e.message, "error"); }
};
$("themeSeg").querySelectorAll("button").forEach((b) => b.onclick = () => setTheme(b.dataset.theme));
$("retranscribeBtn").onclick = () => { if (confirm(t("Transcribe again and replace the current transcript?"))) { S.transcript = null; renderTranscript(); startTranscribe(); } };
$("showTranscriptBtn").onclick = () => $("transcriptBox").classList.toggle("hidden");
$("pickFileBtn").onclick = async () => {
  const b = $("pickFileBtn"); b.classList.add("loading");
  try {
    const r = await api("POST", "/api/pick-file", { prompt: t("Choose the episode video") });
    if (r.path) await createProject(r.path);
    else if (r.unsupported) toast(t("Pick the file from the list or paste its path."));
  } catch (e) { toast(e.message, "error"); } finally { b.classList.remove("loading"); }
};
for (const id of ["srtInput", "srtInput2"]) $(id).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { const r = await api("POST", `/api/projects/${S.project.id}/transcript/import`, await f.text()); toast(t("Imported {n} subtitle lines", { n: r.segments }), "ok"); S.transcript = await api("GET", `/api/projects/${S.project.id}/transcript`); S.projects = await api("GET", "/api/projects"); renderTranscript(); renderStepper(); renderNav(); } catch (err) { toast(err.message, "error"); } e.target.value = ""; };
$("densitySeg").querySelectorAll("button").forEach((b) => b.onclick = () => setSeg(b.dataset.v));
async function runPlan(revise) {
  if (!S.transcript) return toast(t("Transcribe first"), "error");
  if (!S.health.apiKey) return openSettings();
  if (!revise && S.plan && !confirm(t("Start a new plan from scratch? Your edits to the current plan will be replaced. Use Revise to keep them."))) return;
  await saveQuick({ density: $("densitySeg").dataset.value || "normal", overlayLanguage: $("overlayLang").value });
  try { const j = await api("POST", `/api/projects/${S.project.id}/plan`, { notes: $("planNotes").value, revise }); watchJob(j.id); } catch (e) { toast(e.message, "error"); }
}
$("planBtn").onclick = () => runPlan(false); $("reviseBtn").onclick = () => runPlan(true);
$("addOverlayBtn").onclick = () => { S.addType = null; openPicker(); };
$("addImageBtn").onclick = () => { S.addType = "image"; openPicker(); }; $("closePicker").onclick = closePicker; $("pickerSearch").oninput = (e) => fillPicker(e.target.value.trim());
$("pickerModal").addEventListener("click", (e) => { if (e.target === $("pickerModal")) closePicker(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closePicker(); closeSettings(); } });
document.querySelectorAll("input[name=mode]").forEach((r) => r.onchange = () => $("burnOptions").classList.toggle("hidden", document.querySelector("input[name=mode]:checked").value !== "burn"));
$("exportBtn").onclick = async () => {
  if (!S.plan?.overlays?.some((o) => o.enabled !== false)) return toast(t("There are no overlays to export"), "error");
  await flushSave();
  const mode = document.querySelector("input[name=mode]:checked").value;
  const codec = $("burnCodec").value, crf = Number($("burnCrf").value), preset = $("burnPreset").value;
  await saveQuick({ render: { burnCodec: codec, burnCrf: crf, burnPreset: preset } });
  try { const j = await api("POST", `/api/projects/${S.project.id}/export`, { mode, codec, crf, preset }); watchJob(j.id); } catch (e) { toast(e.message, "error"); }
};
$("jobLogBtn").onclick = () => $("jobLog").classList.toggle("hidden");
$("jobCancelBtn").onclick = () => S.job && api("POST", `/api/jobs/${S.job.id}/cancel`);
boot().catch((e) => toast(e.message, "error"));
