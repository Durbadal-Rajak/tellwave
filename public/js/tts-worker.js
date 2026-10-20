// Voice worker: runs Kokoro on this device (WebAssembly, or WebGPU when chosen),
// so the website itself never touches a server for voiceovers.

import { renderVoiceover } from "./shared/voiceover.js";
import { encodeWav } from "./shared/wav.js";
import { KOKORO_MODEL_ID } from "./shared/voices.js";

// kokoro-js ships a ready-to-use browser bundle for CDNs (dist/kokoro.web.js);
// the other two are fallbacks that resolve its dependencies on the fly.
const SOURCES = [
  "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js",
  "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm",
  "https://esm.sh/kokoro-js@1.2.1",
];

let loaded = null; // { gpu, promise }
const files = new Map(); // download progress per file

function report(id) {
  return (p) => {
    if (!p || !p.file) return;
    if (p.status === "progress" || p.status === "download" || p.status === "initiate") {
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? files.get(p.file)?.total ?? 0 });
    } else if (p.status === "done") {
      const f = files.get(p.file);
      if (f) f.loaded = f.total;
    }
    let loadedBytes = 0, totalBytes = 0;
    for (const f of files.values()) { loadedBytes += f.loaded; totalBytes += f.total; }
    postMessage({ type: "loading", id, pct: totalBytes ? Math.round((loadedBytes / totalBytes) * 100) : 0, mb: Math.round(totalBytes / 1e6) });
  };
}

async function importKokoro() {
  let lastErr;
  for (const src of SOURCES) {
    try {
      const mod = await import(src);
      const KokoroTTS = mod.KokoroTTS ?? mod.default?.KokoroTTS;
      if (KokoroTTS) return { KokoroTTS };
      lastErr = new Error(`no KokoroTTS export in ${src}`);
    } catch (e) { lastErr = e; }
  }
  throw new Error(`The voice engine couldn't be downloaded (${lastErr?.message || "network error"}). Check your connection and try again.`);
}

async function getTts(gpu, id) {
  if (loaded && loaded.gpu === gpu) return loaded.promise;
  const promise = (async () => {
    const mod = await importKokoro();
    const useGpu = gpu && "gpu" in navigator;
    try {
      return await mod.KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
        dtype: useGpu ? "fp32" : "q8", device: useGpu ? "webgpu" : "wasm", progress_callback: report(id),
      });
    } catch (e) {
      if (!useGpu) throw e;
      return mod.KokoroTTS.from_pretrained(KOKORO_MODEL_ID, { dtype: "q8", device: "wasm", progress_callback: report(id) });
    }
  })();
  loaded = { gpu, promise };
  promise.catch(() => { loaded = null; });
  return promise;
}

function fakeEngine() {
  return async (text, voice, speed) => {
    const sr = 24000, secs = Math.max(0.25, text.length / (14.5 * speed));
    const n = Math.round(secs * sr), audio = new Float32Array(n);
    const f = 180 + (voice.charCodeAt(3) % 12) * 15;
    for (let i = 0; i < n; i++) audio[i] = 0.3 * Math.sin((2 * Math.PI * f * i) / sr) * Math.min(1, i / 400, (n - i) / 400);
    await new Promise((r) => setTimeout(r, 30));
    return { audio, sampling_rate: sr };
  };
}

let queue = Promise.resolve();

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type !== "speak") return;
  queue = queue.then(() => speak(msg)).catch(() => {});
};

async function speak({ id, text, voice, speed, speakers, gpu, fake }) {
  try {
    let engine;
    if (fake) engine = fakeEngine();
    else {
      const tts = await getTts(!!gpu, id);
      engine = async (t, v, s) => {
        const raw = await tts.generate(t, { voice: v, speed: s });
        return { audio: raw.audio ?? raw.data, sampling_rate: raw.sampling_rate ?? 24000 };
      };
    }
    postMessage({ type: "started", id });
    const t0 = performance.now();
    const out = await renderVoiceover(engine, text, { voice, speed, speakers }, ({ index, total, pcm, sampleRate }) => {
      const step = Math.round(sampleRate * 0.05), peaks = [];
      for (let s = 0; s < pcm.length; s += step) {
        let m = 0;
        for (let i = s; i < Math.min(pcm.length, s + step); i += 2) { const a = Math.abs(pcm[i]); if (a > m) m = a; }
        peaks.push(m);
      }
      postMessage({ type: "chunk", id, index, total, peaks, seconds: pcm.length / sampleRate });
    });
    const wav = encodeWav([out.pcm], out.sampleRate);
    postMessage({ type: "done", id, wav, seconds: out.seconds, sampleRate: out.sampleRate, ms: Math.round(performance.now() - t0) }, [wav.buffer]);
  } catch (err) {
    postMessage({ type: "error", id, message: err?.message || String(err) });
  }
}
