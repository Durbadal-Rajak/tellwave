// WAV encode/decode for 16-bit PCM. Runs in the browser and in Node.

/**
 * Encode channels (Float32Array each, same length) to a 16-bit PCM WAV file.
 * Adds light TPDF dither so quiet fades don't get grainy.
 */
export function encodeWav(channels, sampleRate) {
  const numCh = channels.length;
  const frames = channels[0].length;
  const dataBytes = frames * numCh * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  writeHeader(view, numCh, sampleRate, dataBytes);
  let seed = 0x9e3779b9;
  const rand = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return ((seed >>> 0) / 4294967296);
  };
  let off = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      let x = channels[c][i];
      if (!(x === x)) x = 0; // NaN guard
      const dither = (rand() - rand()) / 32768;
      let s = Math.round((x + dither) * 32767);
      if (s > 32767) s = 32767; else if (s < -32768) s = -32768;
      view.setInt16(off, s, true);
      off += 2;
    }
  }
  return new Uint8Array(buf);
}

function writeHeader(view, numCh, sampleRate, dataBytes) {
  const str = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);       // fmt chunk size
  view.setUint16(20, 1, true);        // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, dataBytes, true);
}

/** Decode a 16-bit PCM WAV (used by tests and the library). */
export function decodeWav(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("Not a WAV file");
  let off = 12, fmt = null, data = null;
  while (off + 8 <= u8.length) {
    const id = tag(off), size = view.getUint32(off + 4, true);
    if (id === "fmt ") fmt = { ch: view.getUint16(off + 10, true), sr: view.getUint32(off + 12, true), bits: view.getUint16(off + 22, true) };
    if (id === "data") { data = { start: off + 8, size: Math.min(size, u8.length - off - 8) }; break; }
    off += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error("WAV is missing fmt or data");
  if (fmt.bits !== 16) throw new Error("Only 16-bit WAV is supported");
  const frames = Math.floor(data.size / (2 * fmt.ch));
  const channels = Array.from({ length: fmt.ch }, () => new Float32Array(frames));
  let p = data.start;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.ch; c++) { channels[c][i] = view.getInt16(p, true) / 32768; p += 2; }
  }
  return { sampleRate: fmt.sr, channels };
}

/** Peak values per bucket, for drawing waveforms. */
export function peaks(channels, buckets) {
  const n = channels[0].length;
  const out = new Float32Array(buckets);
  const step = Math.max(1, Math.floor(n / buckets));
  for (let b = 0; b < buckets; b++) {
    let m = 0;
    const s = b * step, e = Math.min(n, s + step);
    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c];
      for (let i = s; i < e; i += 4) { const v = Math.abs(ch[i]); if (v > m) m = v; }
    }
    out[b] = m;
  }
  return out;
}
