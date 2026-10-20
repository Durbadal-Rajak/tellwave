// Turns a script into one voiceover track using any Kokoro-like engine.
// Used by the browser worker and by the server (MCP renders).

import { parseScript, chunkText, speakersUsed } from "./script.js";
import { resolveVoice, getVoice, DEFAULT_VOICE } from "./voices.js";

export const VOICE_SAMPLE_RATE = 24000;

/** Pick voices for speakers 1-4: the chosen voice first, then contrasting ones. */
export function speakerVoices(primary, overrides = {}) {
  const p = resolveVoice(primary) ?? DEFAULT_VOICE;
  const female = getVoice(p)?.gender !== "male";
  const pool = female ? ["am_michael", "af_bella", "bm_george"] : ["af_heart", "am_fenrir", "bf_emma"];
  const auto = [p, ...pool.filter((v) => v !== p)].slice(0, 4);
  while (auto.length < 4) auto.push(DEFAULT_VOICE);
  const out = {};
  for (let s = 1; s <= 4; s++) out[s] = resolveVoice(overrides[s] ?? overrides[String(s)]) ?? auto[s - 1];
  return out;
}

/** The list of chunks that will be spoken, without synthesising anything. */
export function planVoiceover(text, { voice, speakers } = {}) {
  const segments = parseScript(text);
  const voices = speakerVoices(voice, speakers ?? {});
  const chunks = [];
  segments.forEach((seg, si) => {
    const pieces = chunkText(seg.text);
    pieces.forEach((c, ci) => {
      const lastOfSeg = ci === pieces.length - 1;
      const nextSeg = segments[si + 1];
      let pause = c.pause;
      if (lastOfSeg && nextSeg) pause = Math.max(pause, nextSeg.speaker !== seg.speaker ? 0.42 : 0.3);
      chunks.push({ text: c.text, voice: voices[seg.speaker], speaker: seg.speaker, pause });
    });
  });
  return { chunks, speakers: speakersUsed(segments), voices };
}

/** Trim leading/trailing near-silence, keeping a short margin. */
export function trimSilence(pcm, sr = VOICE_SAMPLE_RATE, threshold = 0.004) {
  let a = 0, b = pcm.length - 1;
  while (a < pcm.length && Math.abs(pcm[a]) < threshold) a++;
  while (b > a && Math.abs(pcm[b]) < threshold) b--;
  if (a >= b) return new Float32Array(0);
  const margin = Math.round(0.03 * sr);
  return pcm.subarray(Math.max(0, a - margin), Math.min(pcm.length, b + margin));
}

/**
 * engine(text, voiceId, speed) -> Promise<{ audio: Float32Array, sampling_rate: number }>
 * onChunk({ index, total, pcm, sampleRate }) is called after each chunk.
 * Returns { pcm, sampleRate, seconds, chunks }.
 */
export async function renderVoiceover(engine, text, { voice, speed = 1, speakers, deadline } = {}, onChunk) {
  const { chunks } = planVoiceover(text, { voice, speakers });
  if (!chunks.length) throw new Error("The script is empty.");
  const sp = Math.max(0.5, Math.min(2, Number(speed) || 1));
  const parts = [];
  let sr = VOICE_SAMPLE_RATE, length = 0;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    if (deadline && Date.now() > deadline) throw new Error("This voiceover is taking too long for one request. Split the script into shorter parts.");
    const raw = await engine(c.text, c.voice, sp);
    sr = raw.sampling_rate || raw.sampleRate || sr;
    const pcm = trimSilence(raw.audio ?? raw.data ?? new Float32Array(0), sr);
    const pause = i === chunks.length - 1 ? 0 : Math.round((c.pause / sp) * sr);
    parts.push({ pcm, pause });
    length += pcm.length + pause;
    onChunk?.({ index: i, total: chunks.length, pcm, sampleRate: sr });
  }
  const outPcm = new Float32Array(length);
  const fade = Math.round(0.004 * sr);
  let pos = 0, peak = 0;
  for (const { pcm, pause } of parts) {
    for (let i = 0; i < pcm.length; i++) {
      let x = pcm[i];
      if (i < fade) x *= i / fade;
      else if (i > pcm.length - fade) x *= (pcm.length - i) / fade;
      outPcm[pos + i] = x;
      const a = Math.abs(x);
      if (a > peak) peak = a;
    }
    pos += pcm.length + pause;
  }
  if (peak > 0) {
    const k = Math.min(4, 0.89 / peak); // about -1 dBFS
    for (let i = 0; i < outPcm.length; i++) outPcm[i] *= k;
  }
  return { pcm: outPcm, sampleRate: sr, seconds: outPcm.length / sr, chunks: chunks.length };
}
