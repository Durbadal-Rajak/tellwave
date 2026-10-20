// Music worker: composes a track off the main thread.
import { renderTrack } from "./shared/music.js";
import { encodeWav, peaks } from "./shared/wav.js";

self.onmessage = (e) => {
  const { id, opts } = e.data;
  try {
    const t0 = performance.now();
    const track = renderTrack(opts, { onProgress: (p) => postMessage({ type: "progress", id, p }) });
    const wav = encodeWav([track.left, track.right], track.sampleRate);
    const pk = peaks([track.left, track.right], 900);
    postMessage({ type: "done", id, wav, peaks: pk, info: track.info, seconds: track.left.length / track.sampleRate, ms: Math.round(performance.now() - t0) }, [wav.buffer, pk.buffer]);
  } catch (err) {
    postMessage({ type: "error", id, message: err?.message || String(err) });
  }
};
