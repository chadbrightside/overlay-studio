import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export const OVERLAY_TYPES = ["lower_third", "term", "stat", "quote", "headline", "list", "map", "keyword", "timeline", "compare", "chart"];
export const POSITIONS = ["default", "top-left", "top-right", "bottom-left", "bottom-right"];

export const OverlaySchema = z.object({
  id: z.string(),
  type: z.enum(OVERLAY_TYPES),
  start: z.number(),
  end: z.number(),
  position: z.enum(POSITIONS),
  title: z.string(),
  subtitle: z.string(),
  body: z.string(),
  value: z.string(),
  label: z.string(),
  source: z.string(),
  items: z.array(z.string()),
  countries: z.array(z.string()),
  anchor: z.string(),
  pairs: z.array(z.object({ label: z.string(), value: z.string(), value2: z.string() })),
  reason: z.string(),
  verify: z.boolean()
});

export const PlanSchema = z.object({
  episodeTitle: z.string(),
  summary: z.string(),
  overlays: z.array(OverlaySchema)
});

export const DURATIONS = { lower_third: [4, 6], term: [5, 8], stat: [4, 6], quote: [6, 9], headline: [4, 5], list: [7, 12], map: [6, 10], keyword: [2, 3.5], timeline: [8, 14], compare: [7, 12], chart: [7, 12] };
const PER_MINUTE = { light: 0.5, normal: 1.0, rich: 1.8 };

const SYSTEM_PROMPT = `You are the lead motion-graphics editor for a political commentary YouTube channel. You read the timed transcript of an episode and plan the on-screen graphics the way a broadcast news producer does: the viewer should understand who is being discussed, what a technical term means, which number was just cited, and where on the map the story takes place, without the graphics ever becoming noisy.

Overlay types you can place:
- lower_third: identify a person, organisation or institution the first time it matters. title = the name as the host says it (in the on-screen language), subtitle = role or one-line description, at most 8 words.
- term: explain a technical, legal, economic, military, religious or political term the host uses that a general viewer may not know. title = the term, body = a plain, neutral definition of at most 22 words.
- stat: a figure the host states out loud. value = the number with its unit or symbol exactly as a graphic would show it (for example "73%", "4.2 مليار دولار", "1.2 million"), label = what it measures in at most 8 words, source = the source only if the host names one, otherwise an empty string.
- quote: a short statement the host attributes to a named person or institution. body = the quote in at most 25 words, title = who said it.
- headline: a title card when the episode moves to a new topic or chapter. title = at most 6 words, subtitle = a kicker line of at most 10 words.
- list: two to four points the host enumerates (demands, reasons, steps, parties). title = what the list is, items = the points, each at most 7 words.
- map: when a country or region becomes the subject for a while. countries = the English names of the countries to highlight as written on a world map (for example "Algeria", "Morocco", "United Arab Emirates", "Israel", "Turkey", "W. Sahara", "Palestine"), title = the place name in the on-screen language, subtitle = short context, at most 8 words.
- keyword: one striking word or short phrase (at most 4 words) the host stresses, flashed on screen at the moment he says it, the way an editor would hit a sound effect. title = the words exactly as spoken, subtitle = empty or at most 5 words of context. Rare: at most one every two minutes, only for real emphasis.
- timeline: a sequence of dated events the host walks through. title = what the sequence is (at most 6 words), pairs = 2 to 5 entries in order, each with label = the date or year as the host gave it and value = the event in at most 7 words; value2 = empty.
- compare: the host sets two sides against each other on concrete figures. title = the first side's name, subtitle = the second side's name, pairs = 2 to 4 rows with label = what is compared (at most 4 words), value = the first side's figure, value2 = the second side's figure, each written as a graphic would show it ("45 مليون", "$12bn"). Only figures the host actually said.
- chart: three to eight figures over time or across categories that the host states (years, months, countries). title = what the chart shows (at most 6 words), label = the unit or an empty string, pairs = the bars in order with label = the category (a year, a country) and value = the figure starting with the number as the host said it; value2 = empty. source = the source only if the host names one. Only figures the host actually said.

Rules:
- Only one overlay on screen at a time. Leave at least 1.5 seconds between overlays. Never overlap.
- Start each overlay 0.2 to 0.5 seconds before the word that triggers it, so it lands with the speech. Durations: lower_third 4-6 s, term 5-8 s, stat 4-6 s, quote 6-9 s, headline 4-5 s, list 7-12 s (longer when it has more items), map 6-10 s, keyword 2-3.5 s, timeline 8-14 s, compare 7-12 s, chart 7-12 s. Nothing in the first 3 seconds or the last 5 seconds of the episode.
- Pick the moments that matter most. A name card for every passing mention is noise; a definition for a word the audience already knows is noise. Prefer the first substantive mention of a person, the first use of a difficult term, every concrete number, and every topic change.
- Spelling and wording: write on-screen text in the on-screen language requested, in short broadcast style. No trailing full stops on titles and labels. Keep names in the spelling the audience of that language expects.
- Accuracy: subtitles, definitions and map choices must be correct and neutral. Never invent a number, a source or a quote: stat and quote overlays may only contain what the host actually said. If you are not certain of a role, date or definition, still write your best version but set verify = true so the editor checks it before publishing.
- position: use "default" unless a specific corner is clearly better for that moment.
- reason: one short English sentence for the human editor explaining why this overlay is here.
- anchor: in script mode only (see below); otherwise an empty string.
- id: a short unique id like "ov-001", in order of start time.

Script mode: sometimes you receive the host's written script, with line numbers, instead of a timed transcript, because the episode is not recorded yet. Then plan exactly the same graphics, but: start = the line number where the overlay should appear, end = 0, and anchor = 6 to 12 consecutive words copied exactly from that line, at the point where the graphic should come up. The app later finds those words in the recording to time the overlay, so the anchor must be the host's own words, not a paraphrase. The duration and spacing rules do not apply in script mode; keep the density target.
- episodeTitle: a short title for the episode in the on-screen language. summary: two sentences in English describing the episode's structure, for the editor.`;

function fmtTime(s) {
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${String(m).padStart(2, "0")}:${r.toFixed(1).padStart(4, "0")}`;
}

export function transcriptToText(transcript) {
  return transcript.segments.map((s) => `[${fmtTime(s.start)} - ${fmtTime(s.end)}] ${s.text}`).join("\n");
}

function langName(code) {
  const names = { ar: "Arabic", en: "English", tr: "Turkish", fr: "French", de: "German", es: "Spanish", fa: "Persian", ur: "Urdu", ru: "Russian", id: "Indonesian", ms: "Malay", ku: "Kurdish", it: "Italian" };
  return names[code] || code;
}

export function scriptLines(script) { return String(script || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean); }

export function buildUserMessage({ project, transcript, script, settings, notes, previousPlan }) {
  const scriptMode = !transcript && script != null;
  const lines = scriptMode ? scriptLines(script) : [];
  const words = scriptMode ? lines.join(" ").split(/\s+/).filter(Boolean).length : 0;
  const duration = scriptMode ? Math.max(60, words / 2.3) : project.video.duration; // about 140 words a minute when read aloud
  const spoken = scriptMode ? (settings.language && settings.language !== "auto" ? langName(settings.language) : "the language of the script") : transcript.language && transcript.language !== "unknown" ? langName(transcript.language) : "the language of the transcript";
  const onScreen = !settings.overlayLanguage || settings.overlayLanguage === "same" ? spoken : langName(settings.overlayLanguage);
  const density = settings.density || "normal";
  const target = Math.max(2, Math.round((duration / 60) * PER_MINUTE[density]));
  const parts = [];
  parts.push(`Channel brief: ${settings.channelBrief || "Political commentary channel."}`);
  if (scriptMode) parts.push(`Script mode: the episode is not recorded yet. ${lines.length} lines, about ${words} words (roughly ${fmtTime(duration)} when read). Spoken language: ${spoken}. On-screen text language: ${onScreen}.`);
  else parts.push(`Episode length: ${fmtTime(duration)} (${Math.round(duration)} seconds). Spoken language: ${spoken}. On-screen text language: ${onScreen}.`);
  parts.push(`Density setting: ${density}. Aim for roughly ${target} overlays in total (about ${PER_MINUTE[density]} per minute), fewer if the material does not justify them.`);
  if (previousPlan) {
    parts.push(`A previous plan exists. Revise it according to the editor's notes below; keep what works, keep ids stable for overlays you keep, and fix what the editor asks for.\n\nPrevious plan JSON:\n${JSON.stringify({ overlays: previousPlan.overlays }, null, 0)}`);
  }
  if (notes && notes.trim()) parts.push(`Editor's notes (follow these carefully):\n${notes.trim()}`);
  if (scriptMode) parts.push(`Script, one numbered line per paragraph:\n${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}`);
  else parts.push(`Transcript with timestamps [mm:ss.s - mm:ss.s]:\n${transcriptToText(transcript)}`);
  return parts.join("\n\n");
}

/** Script mode: keep the script order, no times yet. */
export function normalizeScriptPlan(plan, settings, script) {
  const defaultPos = settings.brand?.position || "top-left";
  const lines = scriptLines(script);
  const overlays = (plan.overlays || []).filter((o) => OVERLAY_TYPES.includes(o.type))
    .map((o) => ({ ...o, line: Math.max(1, Math.min(lines.length, Math.round(Number(o.start) || 1))) }))
    .sort((a, b) => a.line - b.line)
    .map((o) => ({
      ...o, start: null, end: null, anchor: String(o.anchor || "").trim() || (lines[o.line - 1] || "").split(/\s+/).slice(0, 10).join(" "),
      position: !o.position || o.position === "default" ? defaultPos : o.position,
      items: (o.items || []).filter(Boolean).slice(0, 5), countries: (o.countries || []).filter(Boolean),
      pairs: (o.pairs || []).filter((p) => p && (p.label || p.value)).slice(0, 8).map((p) => ({ label: String(p.label || ""), value: String(p.value || ""), value2: String(p.value2 || "") })),
      enabled: o.enabled !== false
    }));
  overlays.forEach((o, i) => { if (!o.id || overlays.findIndex((x) => x.id === o.id) !== i) o.id = `ov-${String(i + 1).padStart(3, "0")}`; });
  return { ...plan, overlays, scriptMode: true };
}

/** Clean, sort, de-overlap and clamp the overlays Claude returned. */
export function normalizePlan(plan, project, settings) {
  const duration = project.video.duration;
  const defaultPos = settings.brand?.position || "top-left";
  let overlays = (plan.overlays || []).map((o) => ({ ...o, start: Number(o.start), end: Number(o.end) }))
    .filter((o) => Number.isFinite(o.start) && Number.isFinite(o.end) && OVERLAY_TYPES.includes(o.type));
  overlays.sort((a, b) => a.start - b.start);
  const out = [];
  for (let i = 0; i < overlays.length; i++) {
    const o = overlays[i];
    const [minD, maxD] = DURATIONS[o.type];
    const minLen = Math.min(2.5, minD);
    let start = Math.max(2.5, o.start);
    let end = Math.min(duration - 3, Math.max(o.end, start + minD));
    if (end - start > maxD + 3) end = start + maxD;
    const next = overlays[i + 1];
    if (next && end > next.start - 1.5) end = Math.max(start + 2.5, next.start - 1.5); // make room for the next one
    const prev = out[out.length - 1];
    if (prev && start < prev.end + 1.5) {
      // shorten the previous one, or drop this one if there is no room
      const room = start - 1.5 - prev.start;
      if (room >= 2.5) prev.end = Math.min(prev.end, start - 1.5);
      else continue;
    }
    if (end - start < minLen) continue;
    out.push({
      ...o,
      start: round2(start), end: round2(end),
      position: !o.position || o.position === "default" ? defaultPos : o.position,
      items: (o.items || []).filter(Boolean).slice(0, 5),
      countries: (o.countries || []).filter(Boolean),
      pairs: (o.pairs || []).filter((p) => p && (p.label || p.value)).slice(0, 8).map((p) => ({ label: String(p.label || ""), value: String(p.value || ""), value2: String(p.value2 || "") })),
      anchor: String(o.anchor || ""),
      enabled: o.enabled !== false
    });
  }
  out.forEach((o, i) => { if (!o.id || out.findIndex((x) => x.id === o.id) !== i) o.id = `ov-${String(i + 1).padStart(3, "0")}`; });
  return { ...plan, overlays: out };
}
function round2(n) { return Math.round(n * 100) / 100; }

const PRICES = { "claude-opus-5-5": [4, 20], "claude-opus-5": [5, 25], "claude-sonnet-5-5": [2, 10], "claude-sonnet-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5], "claude-fable-5-1": [10, 50] };

export async function planOverlays({ project, transcript, script = null, settings, notes, previousPlan, log = () => {} }) {
  const scriptMode = !transcript && script != null;
  if (!settings.apiKey) throw new Error("No Claude API key configured. Open Settings and paste your key from console.anthropic.com.");
  const client = new Anthropic({ apiKey: settings.apiKey, timeout: 20 * 60 * 1000, maxRetries: 3 });
  const model = settings.model || "claude-opus-5-5";
  const userText = buildUserMessage({ project, transcript, script, settings, notes, previousPlan });
  const request = {
    model,
    max_tokens: 32000,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userText }],
    output_config: { effort: settings.effort || "high", format: zodOutputFormat(PlanSchema) }
  };
  log(`Asking ${model} to plan overlays (${scriptMode ? `script of ${scriptLines(script).length} lines` : `${transcript.segments.length} transcript segments`}, effort ${request.output_config.effort})`);
  let response;
  try {
    // Server-side fallback: if a safety classifier declines, the API re-runs the request on a fallback model.
    response = await client.beta.messages.create({ ...request, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  } catch (err) {
    if (err instanceof Anthropic.BadRequestError) {
      log(`Fallback option not accepted (${err.message.slice(0, 120)}); retrying without it`);
      response = await client.messages.create(request);
    } else throw describe(err);
  }
  if (response.stop_reason === "refusal") throw new Error(`Claude declined to plan this episode (${response.stop_details?.category || "policy"}). ${response.stop_details?.explanation || ""}`);
  if (response.stop_reason === "max_tokens") throw new Error("The plan was cut off (max_tokens). Try a lower density or a shorter episode.");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error("Claude returned a plan that was not valid JSON. Please try again."); }
  const parsed = PlanSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Plan did not match the expected format: ${parsed.error.issues.slice(0, 3).map((i) => i.path.join(".") + " " + i.message).join("; ")}`);
  const plan = scriptMode ? normalizeScriptPlan(parsed.data, settings, script) : normalizePlan(parsed.data, project, settings);
  const u = response.usage || {};
  const price = PRICES[response.model] || PRICES[model];
  const cost = price ? ((u.input_tokens || 0) * price[0] + (u.cache_creation_input_tokens || 0) * price[0] * 1.25 + (u.cache_read_input_tokens || 0) * price[0] * 0.1 + (u.output_tokens || 0) * price[1]) / 1e6 : null;
  plan.meta = { model: response.model || model, usage: u, estimatedCostUsd: cost == null ? null : Math.round(cost * 1000) / 1000, notes: notes || "", createdAt: new Date().toISOString() };
  log(`Plan ready: ${plan.overlays.length} overlays. Tokens in/out: ${u.input_tokens}/${u.output_tokens}${cost != null ? ` (~$${cost.toFixed(2)})` : ""}`);
  return plan;
}

function describe(err) {
  if (err instanceof Anthropic.AuthenticationError) return new Error("Claude rejected the API key. Check it in Settings.");
  if (err instanceof Anthropic.RateLimitError) return new Error("Claude rate limit reached. Wait a minute and try again.");
  if (err instanceof Anthropic.APIConnectionError) return new Error("Could not reach the Claude API. Check the internet connection.");
  if (err instanceof Anthropic.APIError) return new Error(`Claude API error ${err.status}: ${err.message}`);
  return err;
}
