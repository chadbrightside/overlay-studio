// "Ask for cards": the host writes plain requests, one per line, in Arabic or English
// ("add a map of Lebanon and Syria at 2:00", "صورة ترامب عند الدقيقة 4", "define Hezbollah when I first say it"),
// and Claude turns each line into add / edit / remove actions on the current plan.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { OVERLAY_TYPES, POSITIONS, OverlaySchema, DURATIONS, transcriptToText, normalizePlan } from "./planner.js";

const ActionSchema = z.object({
  request: z.number(),                       // which numbered request this action answers
  action: z.enum(["add", "edit", "remove", "cannot"]),
  targetId: z.string(),                      // for edit / remove: the id of the existing card; otherwise ""
  overlay: OverlaySchema,                    // for add / edit: the full card; for remove / cannot: any placeholder
  note: z.string()                           // one short sentence to the host, in the language of the request
});
export const RequestsSchema = z.object({ actions: z.array(ActionSchema), reply: z.string() });

const SYSTEM_PROMPT = `You are the graphics editor of a political commentary YouTube channel. The host has already got a plan of on-screen cards for an episode, and now sends you short requests, one per line, in Arabic or English, sometimes both. You carry out each request precisely by returning actions on the plan. You never redo the rest of the plan: only what the host asked for changes.

Card types: ${OVERLAY_TYPES.join(", ")}. Positions: ${POSITIONS.join(", ")} ("bottom" = centred at the bottom like a classic lower third, "full" = fills the frame and covers the host, "split" = two sides with flags, only for versus).

Field meanings (same as the planner): lower_third title = name, subtitle = role. term title = the term, body = plain definition of at most 22 words. stat value = the number as shown, label = what it measures. quote body = the words, title = who said them. headline title (6 words), subtitle = kicker. list title + items. map countries = main countries in English as on a world map (gold), items = related countries (blue), pairs = label | on-screen name for countries whose names should be written, route = places in order for an arrow (country, "City, Country" or "lat,lon"), label = route name, title = caption. keyword title = the words. timeline title + pairs (date | event). compare title/subtitle = the two sides, pairs = row | first | second. image query = short English search words for a free photo on Wikipedia or Wikimedia Commons (a person's full name as on Wikipedia, a place, an event), title = caption in the on-screen language, subtitle = context. seats title = chamber, value = total seats, pairs = party | seats | colour. camps title/subtitle = two camps, pairs = group | what defines it | 1 or 2. share title + pairs (name | share). versus title/subtitle = the two sides, countries = their two English names, pairs = what | first | second. chart title, label = unit, pairs = category | figure.

How to read a request:
- Times: "at 2:00", "at the 2 minute mark", "2 min 30", "عند الدقيقة 2", "في الدقيقة 4 و30 ثانية", "at 1:05:10" are all absolute times in the episode; convert them to seconds for start. If no time is given but the request names a subject ("when I talk about the port", "عندما أذكر حفتر"), find the first moment in the transcript where the host says it and start 0.3 s before that word. If the host says "first time", "second time", "every time", obey. If nothing in the request or the transcript tells you where, choose the most relevant moment from the transcript and say so in the note.
- Duration: use the usual durations (lower_third 4-6 s, term 5-8 s, stat 4-6 s, quote 6-9 s, headline 4-5 s, list 7-12 s, map 6-10 s, keyword 2-3.5 s, timeline 8-14 s, compare 7-12 s, chart 7-12 s, image 5-8 s, seats 6-9 s, camps 8-12 s, share 5-8 s, versus 5-8 s) unless the host gives one ("for 10 seconds", "لمدة ١٠ ثوان", "until 2:30").
- Content: if the host gives the words (a definition, a caption, a number, the names), use exactly those words, in the language he wrote them, unless he asks for another language. If he asks for something without giving the content ("define Hezbollah", "عرّف حزب الله"), write it yourself: short, neutral, accurate, in the on-screen language given in the message, and set verify = true. Never invent a number, a quote or a source he did not give or say in the transcript.
- Pictures: when he describes the picture he wants ("Trump and Netanyahu shaking hands", "صورة لمرفأ بيروت بعد الانفجار"), put that description, in English, into query; the app searches free photo archives with it. A person's name alone works best as his full name as written on English Wikipedia. The caption (title) is in the on-screen language.
- Placement words: "on the left/right", "top", "bottom", "يسار", "يمين", "في الأسفل", "ملء الشاشة" / "full screen" map to the positions. Otherwise use the default corner given in the message.
- Edits: "change card 3", "the map at 2:10 should also show Jordan", "make the definition shorter", "delete the quote at 4:00", "move the Trump picture to 5:30" refer to existing cards: find the card by its number in the list, its id, its type, its time or its words, and return action = "edit" with targetId and the complete corrected card (all fields, keeping what should stay), or action = "remove" with targetId.
- If a request is impossible or unclear, return action = "cannot" with a one-sentence note saying why or what is missing; do not guess wildly.
- One request can produce several actions (for example "a name card and a picture of X at 3:00" → two adds). Several requests may refer to each other.
- ids for new cards: "req-1", "req-2", … in order. position for adds: a value from the list; "default" is allowed.
- reason: one short English sentence for the editor, starting with "Requested:".
- note: one short sentence to the host in the language he wrote that request, saying what was done ("Added a map of Lebanon and Syria at 2:00 for 8 seconds.").
- reply: two or three sentences to the host, in the language of the requests (Arabic if they are in Arabic), summarising what was done and what to check.
- Overlapping cards: the app shows one card at a time and will shorten a neighbouring card when a new one lands on top of it; if the host asks for a time where another card already sits, still add it where he asked.`;

function fmtTime(s) { const m = Math.floor(s / 60), r = Math.round(s - m * 60); return `${m}:${String(r).padStart(2, "0")}`; }
function langName(code) { return ({ ar: "Arabic", en: "English", tr: "Turkish", fr: "French", fa: "Persian", ur: "Urdu", de: "German", es: "Spanish" })[code] || code; }

export function requestLines(text) {
  return String(text || "").split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•·▪●◦]|\d+[.)]|[٠-٩]+[.)])\s*/, "").trim()).filter(Boolean);
}

function compactOverlay(o, i) {
  const keep = ["id", "type", "start", "end", "position", "title", "subtitle", "body", "value", "label", "source", "items", "countries", "route", "query", "credit", "pairs", "verify"];
  const out = { n: i + 1 };
  for (const k of keep) { const v = o[k]; if (v === undefined || v === "" || v === false || (Array.isArray(v) && !v.length)) continue; out[k] = v; }
  return out;
}

export function buildRequestMessage({ project, transcript, plan, settings, requests }) {
  const spoken = transcript.language && transcript.language !== "unknown" ? langName(transcript.language) : "the language of the transcript";
  const onScreen = !settings.overlayLanguage || settings.overlayLanguage === "same" ? spoken : langName(settings.overlayLanguage);
  const parts = [];
  parts.push(`Channel brief: ${settings.channelBrief || "Political commentary channel."}`);
  parts.push(`Episode length: ${fmtTime(project.video.duration)} (${Math.round(project.video.duration)} seconds). Spoken language: ${spoken}. On-screen text language: ${onScreen}. Default card corner: ${settings.brand?.position || "top-left"}. The channel logo sits in the ${settings.brand?.logoCorner || "top-right"} corner.`);
  parts.push(`Current cards, numbered (n), with times in seconds:\n${JSON.stringify((plan?.overlays || []).map(compactOverlay))}`);
  parts.push(`The host's requests:\n${requests.map((r, i) => `${i + 1}. ${r}`).join("\n")}`);
  parts.push(`Transcript with timestamps [mm:ss.s - mm:ss.s]:\n${transcriptToText(transcript)}`);
  return parts.join("\n\n");
}

const RUNTIME_FIELDS = ["image", "imageUrl", "imagePage", "focus", "candidates", "enabled", "line", "alignScore"];

/** Apply Claude's actions to the plan. Pure: returns a new plan plus counts, so it can be tested without the API. */
export function applyActions(plan, actions, project, settings, requests = []) {
  const overlays = (plan?.overlays || []).map((o) => ({ ...o }));
  const byId = new Map(overlays.map((o) => [o.id, o]));
  const result = { added: 0, edited: 0, removed: 0, failed: 0, notes: [], newIds: [], changedIds: [] };
  const used = new Set(overlays.map((o) => o.id));
  for (const a of actions) {
    const line = requests[a.request - 1] || "";
    const note = a.note || "";
    if (a.action === "cannot") { result.failed++; result.notes.push({ request: a.request, ok: false, text: note, line }); continue; }
    if (a.action === "remove") {
      const i = overlays.findIndex((o) => o.id === a.targetId);
      if (i < 0) { result.failed++; result.notes.push({ request: a.request, ok: false, text: `Card ${a.targetId} not found`, line }); continue; }
      overlays.splice(i, 1); byId.delete(a.targetId); result.removed++; result.notes.push({ request: a.request, ok: true, text: note, line }); continue;
    }
    const incoming = { ...a.overlay };
    if (!OVERLAY_TYPES.includes(incoming.type)) { result.failed++; result.notes.push({ request: a.request, ok: false, text: `Unknown card type ${incoming.type}`, line }); continue; }
    if (!POSITIONS.includes(incoming.position)) incoming.position = "default";
    if (a.action === "edit") {
      const cur = byId.get(a.targetId);
      if (!cur) { result.failed++; result.notes.push({ request: a.request, ok: false, text: `Card ${a.targetId} not found`, line }); continue; }
      const next = { ...cur, ...incoming, id: cur.id };
      for (const k of RUNTIME_FIELDS) if (cur[k] !== undefined) next[k] = cur[k];
      if (cur.type === "image" && incoming.type === "image" && incoming.query && incoming.query !== cur.query) { delete next.image; delete next.imageUrl; delete next.imagePage; delete next.focus; delete next.candidates; }
      if (incoming.type !== "image") { delete next.image; delete next.imageUrl; delete next.imagePage; delete next.focus; delete next.candidates; }
      if (!next.reason || !String(next.reason).startsWith("Requested")) next.reason = `Requested: ${line}`.slice(0, 200);
      Object.assign(cur, next);
      result.edited++; result.changedIds.push(cur.id); result.notes.push({ request: a.request, ok: true, text: note, line });
      continue;
    }
    // add
    let id = incoming.id && !used.has(incoming.id) ? incoming.id : null;
    if (!id) { let n = 1; while (used.has(`req-${n}`)) n++; id = `req-${n}`; }
    used.add(id);
    const fresh = { ...incoming, id, reason: incoming.reason && incoming.reason.startsWith("Requested") ? incoming.reason : `Requested: ${line}`.slice(0, 200), enabled: true };
    if (!Number.isFinite(fresh.end) || fresh.end <= fresh.start) fresh.end = fresh.start + DURATIONS[fresh.type][0];
    overlays.push(fresh); byId.set(id, fresh);
    result.added++; result.newIds.push(id); result.notes.push({ request: a.request, ok: true, text: note, line });
  }
  // The host asked for these cards at these moments: make room for them by trimming the planner's neighbours, not the other way round.
  const GAP = 1.0, MIN = 2.5;
  const wanted = new Set([...result.newIds, ...result.changedIds]);
  for (const w of overlays) {
    if (!wanted.has(w.id) || !Number.isFinite(w.start) || !Number.isFinite(w.end)) continue;
    for (const o of overlays) {
      if (o === w || wanted.has(o.id) || !Number.isFinite(o.start) || !Number.isFinite(o.end)) continue;
      const overlaps = o.start < w.end + GAP && o.end > w.start - GAP;
      if (!overlaps) continue;
      if (o.start < w.start) o.end = Math.min(o.end, w.start - GAP);
      else o.start = Math.max(o.start, w.end + GAP);
      if (o.end - o.start < MIN) o._drop = true;
    }
  }
  const trimmed = overlays.filter((o) => o._drop);
  if (trimmed.length) result.displaced = trimmed.map((o) => o.id);
  const normalized = normalizePlan({ ...plan, overlays: overlays.filter((o) => !o._drop) }, project, settings);
  // normalizePlan may renumber ids when duplicates exist; it keeps unique ids, so the new ones survive. Report any card it had to drop for lack of room.
  const keptIds = new Set(normalized.overlays.map((o) => o.id));
  result.dropped = [...result.newIds, ...result.changedIds].filter((id) => !keptIds.has(id));
  result.newIds = result.newIds.filter((id) => keptIds.has(id));
  return { plan: normalized, result };
}

export async function runRequests({ project, transcript, plan, settings, text, log = () => {} }) {
  const requests = requestLines(text);
  if (!requests.length) throw new Error("Write at least one request, one per line.");
  if (!settings.apiKey) throw new Error("No Claude API key configured. Open Settings and paste your key from console.anthropic.com.");
  const client = new Anthropic({ apiKey: settings.apiKey, timeout: 10 * 60 * 1000, maxRetries: 3 });
  const model = settings.model || "claude-opus-5-5";
  const request = {
    model,
    max_tokens: 16000,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: buildRequestMessage({ project, transcript, plan, settings, requests }) }],
    output_config: { effort: settings.effort || "high", format: zodOutputFormat(RequestsSchema) }
  };
  log(`Asking ${model} to carry out ${requests.length} request${requests.length === 1 ? "" : "s"}`);
  let response;
  try {
    response = await client.beta.messages.create({ ...request, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  } catch (err) {
    if (err instanceof Anthropic.BadRequestError) { log(`Fallback option not accepted (${err.message.slice(0, 120)}); retrying without it`); response = await client.messages.create(request); }
    else throw describe(err);
  }
  if (response.stop_reason === "refusal") throw new Error(`Claude declined these requests (${response.stop_details?.category || "policy"}). ${response.stop_details?.explanation || ""}`);
  if (response.stop_reason === "max_tokens") throw new Error("The answer was cut off. Send fewer requests at a time.");
  const textOut = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  let raw;
  try { raw = JSON.parse(textOut); } catch { throw new Error("Claude returned an answer that was not valid JSON. Please try again."); }
  const parsed = RequestsSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Answer did not match the expected format: ${parsed.error.issues.slice(0, 3).map((i) => i.path.join(".") + " " + i.message).join("; ")}`);
  const { plan: next, result } = applyActions(plan, parsed.data.actions, project, settings, requests);
  const u = response.usage || {};
  log(`Done: ${result.added} added, ${result.edited} changed, ${result.removed} removed, ${result.failed} not possible. Tokens in/out: ${u.input_tokens}/${u.output_tokens}`);
  next.history = [...(plan?.history || []), { at: new Date().toISOString(), requests, added: result.added, edited: result.edited, removed: result.removed }];
  return { plan: next, result: { ...result, reply: parsed.data.reply, usage: u } };
}

function describe(err) {
  if (err instanceof Anthropic.AuthenticationError) return new Error("Claude rejected the API key. Check it in Settings.");
  if (err instanceof Anthropic.RateLimitError) return new Error("Claude rate limit reached. Wait a minute and try again.");
  if (err instanceof Anthropic.APIConnectionError) return new Error("Could not reach the Claude API. Check the internet connection.");
  if (err instanceof Anthropic.APIError) return new Error(`Claude API error ${err.status}: ${err.message}`);
  return err;
}
