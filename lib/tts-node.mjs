// Server-side Kokoro (onnxruntime on CPU). The model is loaded once per warm instance.

import { KOKORO_MODEL_ID } from "../public/js/shared/voices.js";

let ttsPromise = null;

async function loadKokoro() {
  // transformers.js writes its download cache next to the package by default, which is
  // read-only on Vercel. Point it at /tmp when the package can be reached.
  try {
    const { env } = await import("@huggingface/transformers");
    env.cacheDir = "/tmp/tellwave-hf-cache";
    env.allowLocalModels = false;
  } catch {
    // kokoro-js still works; it will just re-download on a cold start.
  }
  const mod = await import("kokoro-js");
  const KokoroTTS = mod.KokoroTTS ?? mod.default?.KokoroTTS;
  return KokoroTTS.from_pretrained(KOKORO_MODEL_ID, { dtype: "q8", device: "cpu" });
}

function fakeEngine() {
  // Deterministic stand-in used by the local tests (TELLWAVE_FAKE_TTS=1): a soft tone
  // whose length follows the text, so timing and plumbing can be checked without the model.
  return async (text, voice, speed) => {
    const sr = 24000, secs = Math.max(0.25, text.length / (14.5 * speed));
    const n = Math.round(secs * sr), audio = new Float32Array(n);
    const f = 180 + (voice.charCodeAt(3) % 12) * 15;
    for (let i = 0; i < n; i++) audio[i] = 0.3 * Math.sin((2 * Math.PI * f * i) / sr) * Math.min(1, i / 400, (n - i) / 400);
    return { audio, sampling_rate: sr };
  };
}

/** Returns engine(text, voice, speed) -> { audio, sampling_rate }. */
export async function getEngine() {
  if (process.env.TELLWAVE_FAKE_TTS === "1") return fakeEngine();
  ttsPromise ??= loadKokoro().catch((err) => { ttsPromise = null; throw err; });
  const tts = await ttsPromise;
  return async (text, voice, speed) => {
    const raw = await tts.generate(text, { voice, speed });
    return { audio: raw.audio ?? raw.data, sampling_rate: raw.sampling_rate ?? raw.sampleRate ?? 24000 };
  };
}
