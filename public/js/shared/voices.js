// Kokoro 82M v1.0 voices available through kokoro-js (English).
// Grades are Kokoro's own quality ratings from the model card (A best, F worst).

export const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
export const DEFAULT_VOICE = "af_heart";

const raw = [
  // id, name, accent, gender, grade, note
  ["af_heart", "Heart", "American", "female", "A", "Warmest and most natural"],
  ["af_bella", "Bella", "American", "female", "A-", "Lively and expressive"],
  ["af_nicole", "Nicole", "American", "female", "B-", "Soft, close-up delivery"],
  ["af_aoede", "Aoede", "American", "female", "C+", ""],
  ["af_kore", "Kore", "American", "female", "C+", ""],
  ["af_sarah", "Sarah", "American", "female", "C+", ""],
  ["af_alloy", "Alloy", "American", "female", "C", ""],
  ["af_nova", "Nova", "American", "female", "C", ""],
  ["af_sky", "Sky", "American", "female", "C-", ""],
  ["af_jessica", "Jessica", "American", "female", "D", ""],
  ["af_river", "River", "American", "female", "D", ""],
  ["am_michael", "Michael", "American", "male", "C+", "Steady male narrator"],
  ["am_fenrir", "Fenrir", "American", "male", "C+", "Deeper male narrator"],
  ["am_puck", "Puck", "American", "male", "C+", "Upbeat male voice"],
  ["am_echo", "Echo", "American", "male", "D", ""],
  ["am_eric", "Eric", "American", "male", "D", ""],
  ["am_liam", "Liam", "American", "male", "D", ""],
  ["am_onyx", "Onyx", "American", "male", "D", ""],
  ["am_santa", "Santa", "American", "male", "D-", ""],
  ["am_adam", "Adam", "American", "male", "F+", ""],
  ["bf_emma", "Emma", "British", "female", "B-", "Clear British narrator"],
  ["bf_isabella", "Isabella", "British", "female", "C", ""],
  ["bf_alice", "Alice", "British", "female", "D", ""],
  ["bf_lily", "Lily", "British", "female", "D", ""],
  ["bm_george", "George", "British", "male", "C", "Classic British storyteller"],
  ["bm_fable", "Fable", "British", "male", "C", "Gentle British narrator"],
  ["bm_lewis", "Lewis", "British", "male", "D+", ""],
  ["bm_daniel", "Daniel", "British", "male", "D", ""],
];

export const VOICES = raw.map(([id, name, accent, gender, grade, note]) => ({ id, name, accent, gender, grade, note }));
const byId = new Map(VOICES.map((v) => [v.id, v]));

export const isVoice = (id) => byId.has(id);
export const getVoice = (id) => byId.get(id) ?? null;

/** Resolve "heart", "af_heart", "Heart" or "george" to a voice id, or null. */
export function resolveVoice(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase().replace(/\s+/g, "_");
  if (byId.has(s)) return s;
  const hit = VOICES.find((v) => v.name.toLowerCase() === s || v.id.endsWith("_" + s));
  return hit ? hit.id : null;
}

/** Voices worth suggesting first. */
export const RECOMMENDED = ["af_heart", "af_bella", "am_michael", "am_fenrir", "bf_emma", "bm_george"];
