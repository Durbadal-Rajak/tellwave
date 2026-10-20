// Script handling shared by the browser and the server:
// speaker lines, sentence-sized chunks for Kokoro, and duration estimates.

export const MAX_SCRIPT_CHARS = 5000;
export const MAX_SPEAKERS = 4;
const CHARS_PER_SECOND = 14.5; // typical narration pace at speed 1.0

const SPEAKER_LINE = /^\s*speaker\s*([1-9])\s*:\s*/i;

/** Remove things a voice shouldn't read: markdown marks, odd spacing, smart quotes. */
export function cleanText(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/\*\*|__|`+/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Split a script into speaker segments.
 * Lines starting with "Speaker N:" switch speaker; other lines continue the current one.
 * Returns [{ speaker, text }] with paragraph breaks kept as "\n\n".
 */
export function parseScript(text) {
  const lines = cleanText(text).split("\n");
  const segs = [];
  let cur = null;
  for (const line of lines) {
    const m = SPEAKER_LINE.exec(line);
    if (m) {
      const speaker = Math.min(MAX_SPEAKERS, Number(m[1]));
      cur = { speaker, text: line.slice(m[0].length).trim() };
      segs.push(cur);
    } else if (!line.trim()) {
      if (cur && cur.text && !cur.text.endsWith("\n\n")) cur.text += "\n\n";
    } else {
      if (!cur) { cur = { speaker: 1, text: "" }; segs.push(cur); }
      cur.text += (cur.text && !cur.text.endsWith("\n\n") ? " " : "") + line.trim();
    }
  }
  return segs.map((s) => ({ speaker: s.speaker, text: s.text.trim() })).filter((s) => s.text);
}

export function speakersUsed(segments) {
  return [...new Set(segments.map((s) => s.speaker))].sort((a, b) => a - b);
}

/**
 * Sentence-sized chunks (Kokoro reads about 510 phonemes per pass, so stay short).
 * Each chunk carries the pause to leave after it, in seconds.
 */
export function chunkText(text, maxLen = 280) {
  const out = [];
  const paragraphs = String(text).split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  paragraphs.forEach((para, pi) => {
    const sentences = para.match(/[^.!?…]+(?:[.!?…]+["')\]]*|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [para];
    sentences.forEach((sent, si) => {
      const lastInPara = si === sentences.length - 1;
      const pieces = splitLong(sent, maxLen);
      pieces.forEach((piece, k) => {
        const lastPiece = k === pieces.length - 1;
        let pause = 0.12;
        if (lastPiece) pause = lastInPara ? (pi === paragraphs.length - 1 ? 0 : 0.65) : /[?!]["')\]]*$/.test(piece) ? 0.32 : 0.26;
        out.push({ text: piece, pause });
      });
    });
  });
  return out;
}

function splitLong(sentence, maxLen) {
  if (sentence.length <= maxLen) return [sentence];
  const parts = [];
  let rest = sentence;
  while (rest.length > maxLen) {
    const window = rest.slice(0, maxLen);
    let cut = Math.max(window.lastIndexOf("; "), window.lastIndexOf(": "), window.lastIndexOf(" — "), window.lastIndexOf(", "));
    if (cut < maxLen * 0.4) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = maxLen;
    parts.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export function estimateSeconds(text, speed = 1) {
  const chars = cleanText(text).replace(/\s+/g, " ").length;
  return chars / (CHARS_PER_SECOND * Math.max(0.5, Math.min(2, speed || 1)));
}

export function wordCount(text) {
  const m = String(text ?? "").trim().match(/\S+/g);
  return m ? m.length : 0;
}

export function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.round(sec), m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
