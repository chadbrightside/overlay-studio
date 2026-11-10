/* Places script-planned overlays on the recording.
   Each overlay carries an `anchor`: the words from the script where it should appear. We find the closest run of
   words in the transcript (Arabic-aware normalisation, longest common subsequence) and take its time. */
import { DURATIONS } from "./planner.js";

const AR_DIACRITICS = /[\u064B-\u065F\u0670\u0640]/g;
export function normalizeToken(w) {
  return String(w).toLowerCase()
    .replace(AR_DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}
export function tokenize(text) { return String(text || "").split(/\s+/).map(normalizeToken).filter((t) => t.length > 1); }

/** Transcript words with times. Falls back to spreading a segment's words evenly over its duration. */
export function transcriptTokens(transcript) {
  const out = [];
  for (const seg of transcript.segments || []) {
    const words = (seg.words || []).filter((w) => w && w.word);
    if (words.length) {
      for (const w of words) { const tok = normalizeToken(w.word); if (tok.length > 1) out.push({ tok, start: w.start, end: w.end }); }
    } else {
      const raw = String(seg.text || "").split(/\s+/).filter(Boolean);
      const step = (seg.end - seg.start) / Math.max(1, raw.length);
      raw.forEach((r, i) => { const tok = normalizeToken(r); if (tok.length > 1) out.push({ tok, start: seg.start + i * step, end: seg.start + (i + 1) * step }); });
    }
  }
  return out;
}

/** Longest common subsequence between a (anchor) and b (window). Returns the length and the window index of the first matched token. */
function lcs(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  // backtrack to find the first matched window index
  let i = n, j = m, first = -1;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { first = j - 1; i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--; else j--;
  }
  return { len: dp[n][m], first };
}

export function findAnchor(anchorTokens, T, fromPos = 0) {
  const n = anchorTokens.length;
  if (!n || !T.length) return null;
  const L = Math.min(T.length, Math.ceil(n * 1.6) + 2);
  let best = null;
  for (let i = 0; i <= T.length - Math.min(n, T.length); i++) {
    const win = T.slice(i, i + L).map((x) => x.tok);
    const { len, first } = lcs(anchorTokens, win);
    let score = len / n;
    if (i < fromPos) score *= 0.85; // prefer going forward through the episode
    if (!best || score > best.score) best = { score, pos: i + Math.max(0, first), len };
    if (score >= 0.999 && i >= fromPos) break;
  }
  return best;
}

/** Fill start/end on overlays that have an anchor but no time. Returns { overlays, matched, unmatched }. */
export function alignOverlays(overlays, transcript, { minScore = 0.5 } = {}) {
  const T = transcriptTokens(transcript);
  const duration = transcript.segments?.length ? transcript.segments[transcript.segments.length - 1].end : 0;
  let pos = 0, matched = 0, unmatched = 0;
  const out = overlays.map((o) => {
    if (Number.isFinite(o.start) && Number.isFinite(o.end) && o.end > o.start) return o; // already placed
    const anchorText = o.anchor || [o.title, o.body, o.value].filter(Boolean).join(" ");
    const a = tokenize(anchorText);
    const hit = findAnchor(a, T, pos);
    if (hit && hit.score >= minScore) {
      const [minD, maxD] = DURATIONS[o.type] || [4, 6];
      const start = Math.max(0, T[hit.pos].start - 0.3);
      const end = Math.min(duration || start + maxD, start + (minD + maxD) / 2);
      pos = hit.pos + a.length; matched++;
      return { ...o, start: round2(start), end: round2(end), alignScore: round2(hit.score) };
    }
    unmatched++;
    return { ...o, start: null, end: null, verify: true, alignScore: 0, reason: `${o.reason ? o.reason + " " : ""}Not found in the recording. Place it by hand.` };
  });
  return { overlays: out, matched, unmatched };
}
function round2(n) { return Math.round(n * 100) / 100; }
