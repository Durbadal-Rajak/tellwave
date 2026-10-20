// Tellwave composer: original, royalty-free music made from code.
// No samples, no AI model and no third-party recordings. Every sound is synthesised
// here, so a rendered track belongs to whoever rendered it and needs no credit line.
// Runs unchanged in the browser (Web Worker) and in Node (Vercel Function).

const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export const MUSIC_LIMITS = { minSeconds: 5, maxSeconds: 300, minBpm: 40, maxBpm: 180 };

// ---------------------------------------------------------------- randomness
export function makeRng(seed) {
  let a = (seed >>> 0) || 0x1f2e3d4c;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    noise: () => next() * 2 - 1,
  };
}

// ---------------------------------------------------------------- theory
const NOTE_NAMES = ["C", "C#", "D", "E♭", "E", "F", "F#", "G", "A♭", "A", "B♭", "B"];
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  majorPent: [0, 2, 4, 7, 9],
  minorPent: [0, 3, 5, 7, 10],
};
const SCALE_LABEL = {
  major: "major", minor: "minor", harmonicMinor: "harmonic minor", dorian: "Dorian",
  phrygian: "Phrygian", lydian: "Lydian", majorPent: "major pentatonic", minorPent: "minor pentatonic",
};
const NUMERALS = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 };

/** Roman numeral relative to the key root: "i", "bVI", "V7", "IVmaj7", "ii7", "vii°", "Isus2". */
function parseChord(sym) {
  const m = /^(b|#)?(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(°|\+)?(maj7|maj9|add9|sus2|sus4|7|9|6)?$/.exec(sym);
  if (!m) throw new Error("Unknown chord symbol " + sym);
  const [, acc, num, qual, ext] = m;
  const root = NUMERALS[num.toUpperCase()] + (acc === "b" ? -1 : acc === "#" ? 1 : 0);
  const minor = num === num.toLowerCase();
  let iv = qual === "°" ? [0, 3, 6] : qual === "+" ? [0, 4, 8] : minor ? [0, 3, 7] : [0, 4, 7];
  if (ext === "sus2") iv = [0, 2, 7];
  else if (ext === "sus4") iv = [0, 5, 7];
  else if (ext === "7") iv = iv.concat(qual === "°" ? 9 : 10);
  else if (ext === "maj7") iv = iv.concat(11);
  else if (ext === "maj9") iv = iv.concat(11, 14);
  else if (ext === "9") iv = iv.concat(10, 14);
  else if (ext === "add9") iv = iv.concat(14);
  else if (ext === "6") iv = iv.concat(9);
  return { sym, root: ((root % 12) + 12) % 12, iv };
}

/** Chord tones placed between low and high, choosing the inversion closest to prev. */
function voiceChord(ch, key, low, high, prev, maxNotes = 4) {
  const base = ch.iv.slice(0, maxNotes).map((i) => key + ch.root + i);
  const cands = [];
  for (let inv = 0; inv < base.length; inv++) {
    let notes = base.map((n, k) => (k < inv ? n + 12 : n)).sort((a, b) => a - b);
    while (notes[0] < low) notes = notes.map((n) => n + 12);
    while (notes[0] - 12 >= low) notes = notes.map((n) => n - 12);
    for (const shift of [0, 12, -12]) {
      const c = notes.map((n) => n + shift);
      if (c[0] >= low && c[c.length - 1] <= high + 2) cands.push(c);
    }
  }
  if (!cands.length) return base;
  const center = (low + high) / 2;
  let best = cands[0], bestScore = Infinity;
  for (const c of cands) {
    let score = 0;
    if (prev && prev.length) {
      for (let k = 0; k < c.length; k++) score += Math.abs(c[k] - prev[Math.min(k, prev.length - 1)]);
    } else {
      for (const n of c) score += Math.abs(n - center);
    }
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best;
}

const bassNote = (ch, key, low) => { let n = key + ch.root; while (n < low) n += 12; while (n >= low + 12) n -= 12; return n; };

function scaleNotesIn(key, scale, low, high) {
  const out = [];
  for (let m = low; m <= high; m++) if (scale.includes((((m - key) % 12) + 12) % 12)) out.push(m);
  return out;
}

/** A phrase: [{t, d, m, v}] in beats from the phrase start, following the chords. */
function makePhrase(rng, { key, scale, low, high, rhythms, chordAtBeat, beats, prevEnd }) {
  const rhythm = rng.pick(rhythms).filter(([t]) => t < beats);
  const pool = scaleNotesIn(key, scale, low, high);
  const center = (low + high) / 2;
  const arch = rng.range(3, 7) * (rng.chance(0.75) ? 1 : -1);
  let cur = prevEnd ?? pool[Math.floor(pool.length / 2)];
  const out = [];
  rhythm.forEach(([t, d], idx) => {
    const ch = chordAtBeat(t);
    const tones = ch.iv.map((i) => (key + ch.root + i) % 12);
    const strong = t % 2 === 0 || d >= 2 || idx === rhythm.length - 1;
    const cands = strong ? pool.filter((n) => tones.includes(n % 12)) : pool;
    const target = center + arch * Math.sin((Math.PI * t) / beats);
    let total = 0;
    const w = cands.map((n) => {
      const step = Math.abs(n - cur);
      const x = Math.exp(-step / 2.6) * Math.exp(-Math.abs(n - target) / 7) * (step === 0 ? 0.35 : 1);
      total += x;
      return x;
    });
    let r = rng.next() * total, pick = cands[0];
    for (let k = 0; k < cands.length; k++) { r -= w[k]; if (r <= 0) { pick = cands[k]; break; } }
    out.push({ t, d, m: pick, v: strong ? rng.range(0.72, 0.86) : rng.range(0.55, 0.7) });
    cur = pick;
  });
  return out;
}

// ---------------------------------------------------------------- DSP helpers
function polyBlep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
const panGains = (p) => { const a = ((clamp(p, -1, 1) + 1) * Math.PI) / 4; return [Math.cos(a), Math.sin(a)]; };

function makeCtx(n, sr, rng) {
  return {
    n, sr, rng,
    L: new Float32Array(n), R: new Float32Array(n),
    V: new Float32Array(n), // reverb send (mono)
    D: new Float32Array(n), // delay send (mono)
  };
}

function out(ctx, i, l, r, send, dsend) {
  ctx.L[i] += l; ctx.R[i] += r;
  const m = (l + r) * 0.5;
  if (send) ctx.V[i] += m * send;
  if (dsend) ctx.D[i] += m * dsend;
}

// ---------------------------------------------------------------- instruments
const WAVES = { saw: 0, tri: 1, sine: 2, square: 3 };

/** Subtractive voice: pads, drones, strings, brass, bass. */
function synthNote(ctx, t0, dur, midi, o = {}) {
  const sr = ctx.sr;
  const start = Math.max(0, Math.round(t0 * sr));
  if (start >= ctx.n || dur <= 0) return;
  const attS = Math.max(1, Math.round((o.attack ?? 0.01) * sr));
  const holdS = Math.max(attS, Math.round(dur * sr));
  const relS = Math.max(1, Math.round((o.release ?? 0.3) * sr));
  const end = Math.min(ctx.n, start + holdS + relS);
  const V = o.voices ?? 1, det = o.detune ?? 0, spread = o.spread ?? 0.5, pan0 = o.pan ?? 0;
  const f0 = midiToHz(midi + (o.cents ?? 0) / 100);
  const ph = new Float64Array(V), inc = new Float64Array(V), gl = new Float64Array(V), gr = new Float64Array(V);
  for (let v = 0; v < V; v++) {
    const u = V === 1 ? 0 : (v / (V - 1)) * 2 - 1;
    inc[v] = (f0 * Math.pow(2, (u * det) / 1200)) / sr;
    ph[v] = ctx.rng.next();
    [gl[v], gr[v]] = panGains(pan0 + u * spread);
  }
  const wave = WAVES[o.wave ?? "saw"], sineMix = o.sine ?? 0;
  const gain = (o.gain ?? 0.1) / Math.sqrt(V);
  const send = o.send ?? 0.2, dsend = o.delay ?? 0;
  const cut0 = o.cutoff ?? 2000, envAmt = o.cutoffEnv ?? 0, envTau = o.cutoffEnvTime ?? 0.25, open = o.cutoffOpen ?? 0;
  const lfoRate = o.lfo ?? 0, lfoDepth = o.lfoDepth ?? 0, lfoPh = ctx.rng.next() * TAU;
  const vibRate = o.vibrato ?? 0, vibCents = o.vibratoCents ?? 0, vibDelay = o.vibratoDelay ?? 0.25;
  const tremRate = o.tremolo ?? 0, tremDepth = o.tremoloDepth ?? 0;
  const glide = o.glideCents ?? 0, glideTime = o.glideTime ?? 1; // pitch bend over the note
  const relK = 6.9 / relS;
  let fa = 0, l1 = 0, l2 = 0, r1 = 0, r2 = 0, vib = 1, trem = 1;
  for (let i = start, k = 0; i < end; i++, k++) {
    if ((k & 15) === 0) {
      const t = k / sr;
      const lfo = lfoRate ? Math.sin(lfoPh + TAU * lfoRate * t) : 0;
      let ce = envAmt ? 1 + envAmt * Math.exp(-t / envTau) : 1;
      if (open) ce *= 0.22 + 0.78 * (1 - Math.exp(-t / open));
      const fc = clamp(cut0 * ce * (1 + lfoDepth * lfo), 25, sr * 0.45);
      fa = 1 - Math.exp((-TAU * fc) / sr);
      let cents = 0;
      if (vibRate) cents += vibCents * Math.min(1, t / vibDelay) * Math.sin(TAU * vibRate * t + lfoPh);
      if (glide) cents += glide * Math.min(1, t / glideTime);
      vib = cents ? Math.pow(2, cents / 1200) : 1;
      trem = tremRate ? 1 - tremDepth * (0.5 + 0.5 * Math.sin(TAU * tremRate * t + lfoPh)) : 1;
    }
    let env = k < attS ? k / attS : 1;
    if (k >= holdS) env *= Math.exp(-(k - holdS) * relK);
    let sl = 0, sr2 = 0;
    for (let v = 0; v < V; v++) {
      const dt = inc[v] * vib;
      let p = ph[v] + dt;
      if (p >= 1) p -= 1;
      ph[v] = p;
      let x;
      if (wave === 0) x = 2 * p - 1 - polyBlep(p, dt);
      else if (wave === 1) x = 4 * Math.abs(p - 0.5) - 1;
      else if (wave === 2) x = Math.sin(TAU * p);
      else { const q = p + 0.5 >= 1 ? p - 0.5 : p + 0.5; x = (p < 0.5 ? 1 : -1) + polyBlep(p, dt) - polyBlep(q, dt); }
      if (sineMix) x = x * (1 - sineMix) + Math.sin(TAU * p) * sineMix;
      sl += x * gl[v]; sr2 += x * gr[v];
    }
    l1 += fa * (sl - l1); l2 += fa * (l1 - l2);
    r1 += fa * (sr2 - r1); r2 += fa * (r1 - r2);
    const g = gain * env * trem;
    out(ctx, i, l2 * g, r2 * g, send, dsend);
  }
}

/** Choir-like pad: detuned saws through three vowel formants. */
function choirNote(ctx, t0, dur, midi, o = {}) {
  const sr = ctx.sr;
  const start = Math.max(0, Math.round(t0 * sr));
  if (start >= ctx.n) return;
  const vowel = o.vowel === "oo" ? [[320, 7, 1], [800, 9, 0.45], [2400, 12, 0.12]] : [[760, 7, 1], [1180, 9, 0.55], [2700, 12, 0.18]];
  const attS = Math.round((o.attack ?? 1.2) * sr), holdS = Math.max(attS, Math.round(dur * sr));
  const relS = Math.round((o.release ?? 1.5) * sr), end = Math.min(ctx.n, start + holdS + relS);
  const V = 4, f0 = midiToHz(midi), det = o.detune ?? 14;
  const ph = new Float64Array(V), inc = new Float64Array(V);
  for (let v = 0; v < V; v++) { inc[v] = (f0 * Math.pow(2, (((v / (V - 1)) * 2 - 1) * det) / 1200)) / sr; ph[v] = ctx.rng.next(); }
  const F = vowel.map(([fc, q, g]) => ({ f: 2 * Math.sin((Math.PI * fc) / sr), q: 1 / q, g, lo: 0, bp: 0 }));
  const [gl, gr] = panGains(o.pan ?? 0);
  const gain = o.gain ?? 0.06, send = o.send ?? 0.5, relK = 6.9 / Math.max(1, relS);
  const vibPh = ctx.rng.next() * TAU;
  for (let i = start, k = 0; i < end; i++, k++) {
    let env = k < attS ? k / attS : 1;
    if (k >= holdS) env *= Math.exp(-(k - holdS) * relK);
    const vib = 1 + 0.0025 * Math.sin(vibPh + (TAU * 5.1 * k) / sr);
    let x = 0;
    for (let v = 0; v < V; v++) {
      const dt = inc[v] * vib;
      let p = ph[v] + dt; if (p >= 1) p -= 1; ph[v] = p;
      x += 2 * p - 1 - polyBlep(p, dt);
    }
    x *= 0.25;
    let y = 0;
    for (let j = 0; j < 3; j++) {
      const s = F[j];
      s.lo += s.f * s.bp;
      const hi = x - s.lo - s.q * s.bp;
      s.bp += s.f * hi;
      y += s.bp * s.g;
    }
    y *= gain * env;
    out(ctx, i, y * gl, y * gr, send, 0);
  }
}

/** Additive piano-like tone with inharmonic partials and two-stage decay. */
function pianoNote(ctx, t0, midi, vel, o = {}) {
  const sr = ctx.sr, f0 = midiToHz(midi);
  const start = Math.max(0, Math.round(t0 * sr));
  if (start >= ctx.n) return;
  const held = o.dur ?? 1, pedal = !!o.pedal;
  const tau = clamp(3.3 * Math.pow(261.6 / f0, 0.6), 0.45, 8) * (o.sustain ?? 1);
  const life = pedal ? Math.min(tau * 1.7, o.maxDur ?? 7) : Math.min(held + 0.8, tau * 1.7);
  const end = Math.min(ctx.n, start + Math.round(life * sr));
  const P = Math.max(1, Math.min(midi < 60 ? 9 : 7, Math.floor((sr * 0.4) / f0)));
  const B = 0.00011 * Math.sqrt(f0 / 261.6);
  const c = new Float64Array(P), s = new Float64Array(P), cw = new Float64Array(P), sw = new Float64Array(P);
  const aF = new Float64Array(P), aS = new Float64Array(P), dF = new Float64Array(P), dS = new Float64Array(P);
  const bright = clamp(vel, 0.1, 1);
  for (let p = 0; p < P; p++) {
    const n = p + 1, fn = n * f0 * Math.sqrt(1 + B * n * n), w = (TAU * fn) / sr;
    cw[p] = Math.cos(w); sw[p] = Math.sin(w);
    const ph = ctx.rng.next() * 0.3;
    c[p] = Math.cos(ph); s[p] = Math.sin(ph);
    const an = Math.pow(bright, 0.6 + 0.32 * p) / Math.pow(n, 1.1) * (n === 2 ? 0.8 : 1);
    const tn = tau / (1 + 0.42 * p);
    aF[p] = an * 0.55; aS[p] = an * 0.45;
    dF[p] = Math.exp(-1 / (tn * 0.2 * sr)); dS[p] = Math.exp(-1 / (tn * sr));
  }
  const [gl, gr] = panGains(clamp((midi - 62) / 32, -0.65, 0.65) * (o.width ?? 0.7) + (o.pan ?? 0));
  const gain = (o.gain ?? 0.16) * vel, send = o.send ?? 0.25, dsend = o.delay ?? 0;
  const attS = Math.round(0.002 * sr), hamS = Math.round(0.014 * sr), heldS = Math.round(held * sr);
  const damp = Math.exp(-1 / (0.09 * sr));
  const ha = 1 - Math.exp((-TAU * Math.min(5000, f0 * 9)) / sr);
  let active = P, dampEnv = 1, hl = 0;
  for (let i = start, k = 0; i < end; i++, k++) {
    let y = 0;
    for (let p = 0; p < active; p++) {
      const cn = c[p] * cw[p] - s[p] * sw[p];
      s[p] = s[p] * cw[p] + c[p] * sw[p];
      c[p] = cn;
      aF[p] *= dF[p]; aS[p] *= dS[p];
      y += s[p] * (aF[p] + aS[p]);
    }
    if ((k & 2047) === 2047) {
      for (let p = 0; p < active; p++) { const m = Math.hypot(c[p], s[p]); c[p] /= m; s[p] /= m; }
      while (active > 1 && aF[active - 1] + aS[active - 1] < 2e-5) active--;
    }
    if (k < hamS) { hl += ha * (ctx.rng.noise() - hl); y += hl * 0.22 * bright * Math.exp(-k / (0.004 * sr)); }
    if (k < attS) y *= k / attS;
    if (!pedal && k > heldS) { dampEnv *= damp; y *= dampEnv; }
    y *= gain;
    out(ctx, i, y * gl, y * gr, send, dsend);
  }
}

/** Karplus-Strong plucked string: harp, guitar, pizzicato. */
function pluckNote(ctx, t0, midi, vel, o = {}) {
  const sr = ctx.sr, f0 = midiToHz(midi);
  const start = Math.max(0, Math.round(t0 * sr));
  if (start >= ctx.n) return;
  const N = Math.max(2, Math.round(sr / f0 - 0.5));
  const buf = new Float32Array(N);
  const a = 0.08 + 0.88 * clamp(o.bright ?? 0.5, 0, 1);
  let lp = 0, mean = 0;
  for (let i = 0; i < N; i++) { lp += a * (ctx.rng.noise() - lp); buf[i] = lp; mean += lp; }
  mean /= N;
  for (let i = 0; i < N; i++) buf[i] -= mean;
  const fb = o.feedback ?? 0.996, held = o.dur ?? 0.8, rel = o.release ?? 0.06;
  const life = Math.min(held + rel * 7, o.maxDur ?? 4);
  const end = Math.min(ctx.n, start + Math.round(life * sr));
  const heldS = Math.round(held * sr), relK = 6.9 / Math.max(1, rel * sr);
  const [gl, gr] = panGains(o.pan ?? 0);
  const gain = (o.gain ?? 0.22) * vel, send = o.send ?? 0.2, dsend = o.delay ?? 0;
  let idx = 0, env = 1;
  for (let i = start, k = 0; i < end; i++, k++) {
    const y0 = buf[idx];
    const nx = idx + 1 === N ? 0 : idx + 1;
    buf[idx] = fb * 0.5 * (y0 + buf[nx]);
    idx = nx;
    if (k > heldS) env = Math.exp(-(k - heldS) * relK);
    const y = y0 * gain * env;
    out(ctx, i, y * gl, y * gr, send, dsend);
  }
}

/** FM bell / celesta / music box. */
function bellNote(ctx, t0, midi, vel, o = {}) {
  const sr = ctx.sr, f = midiToHz(midi) * (1 + (o.detune ?? 0) / 1731);
  const start = Math.max(0, Math.round(t0 * sr));
  if (start >= ctx.n) return;
  const decay = o.decay ?? 2.2, ratio = o.ratio ?? 3.5, index0 = o.index ?? 2;
  const end = Math.min(ctx.n, start + Math.round(Math.min(decay * 4.5, 9) * sr));
  const [gl, gr] = panGains(o.pan ?? 0);
  const gain = (o.gain ?? 0.08) * vel, send = o.send ?? 0.45, dsend = o.delay ?? 0;
  const ic = (TAU * f) / sr, im = (TAU * f * ratio) / sr;
  const kAmp = Math.exp(-1 / (decay * sr)), kIdx = Math.exp(-1 / (decay * 0.3 * sr));
  let pc = 0, pm = 0, amp = 1, idx = index0;
  const attS = Math.round(0.0015 * sr);
  for (let i = start, k = 0; i < end; i++, k++) {
    pc += ic; pm += im;
    if (pc > TAU) pc -= TAU;
    if (pm > TAU) pm -= TAU;
    amp *= kAmp; idx = (idx - 0.15) * kIdx + 0.15;
    let y = Math.sin(pc + idx * Math.sin(pm)) * amp * gain;
    if (k < attS) y *= k / attS;
    out(ctx, i, y * gl, y * gr, send, dsend);
  }
}

/** Electric piano (tine-style FM) with autopan. */
function epNote(ctx, t0, dur, midi, vel, o = {}) {
  const sr = ctx.sr, f = midiToHz(midi);
  const start = Math.max(0, Math.round(t0 * sr));
  if (start >= ctx.n) return;
  const heldS = Math.round(dur * sr), end = Math.min(ctx.n, start + heldS + Math.round(0.6 * sr));
  const gain = (o.gain ?? 0.07) * vel, send = o.send ?? 0.2, dsend = o.delay ?? 0;
  const ic = (TAU * f) / sr, it = (TAU * f * 14) / sr;
  const kAmp = Math.exp(-1 / (1.9 * sr)), kIdx = Math.exp(-1 / (0.5 * sr)), kT = Math.exp(-1 / (0.045 * sr));
  const kRel = Math.exp(-1 / (0.12 * sr));
  const panRate = (TAU * (o.autopan ?? 4.2)) / sr, panPh = ctx.rng.next() * TAU;
  let pc = 0, pt = 0, amp = 1, idx = 1.1 * vel + 0.3, tine = 0.6 * vel, rel = 1;
  const attS = Math.round(0.002 * sr);
  for (let i = start, k = 0; i < end; i++, k++) {
    pc += ic; pt += it;
    if (pc > TAU) pc -= TAU;
    if (pt > TAU) pt -= TAU;
    amp *= kAmp; idx = (idx - 0.25) * kIdx + 0.25; tine *= kT;
    if (k > heldS) rel *= kRel;
    let y = (Math.sin(pc + idx * Math.sin(pc)) + tine * Math.sin(pt)) * amp * rel * gain;
    if (k < attS) y *= k / attS;
    const p = 0.35 * Math.sin(panPh + panRate * k);
    out(ctx, i, y * (0.5 - p * 0.5) * 1.41, y * (0.5 + p * 0.5) * 1.41, send, dsend);
  }
}

// ---------------------------------------------------------------- drums
function kick(ctx, t0, vel, o = {}) {
  const sr = ctx.sr, start = Math.round(t0 * sr);
  if (start < 0 || start >= ctx.n) return;
  const decay = o.decay ?? 0.3, f1 = o.f1 ?? 48, f0 = o.f0 ?? 150;
  const end = Math.min(ctx.n, start + Math.round(decay * 4 * sr));
  let ph = 0;
  const gain = (o.gain ?? 0.3) * vel;
  for (let i = start, k = 0; i < end; i++, k++) {
    const t = k / sr;
    ph += (TAU * (f1 + (f0 - f1) * Math.exp(-t / 0.032))) / sr;
    let y = Math.sin(ph) * Math.exp(-t / decay);
    if (k < 90) y += ctx.rng.noise() * 0.25 * (1 - k / 90);
    y = Math.tanh(y * 1.4) * gain;
    out(ctx, i, y, y, o.send ?? 0.05, 0);
  }
}

function noiseHit(ctx, t0, vel, o) {
  // filtered noise burst: snare / hat / shaker / clap tail
  const sr = ctx.sr, start = Math.round(t0 * sr);
  if (start < 0 || start >= ctx.n) return;
  const decay = o.decay ?? 0.1, end = Math.min(ctx.n, start + Math.round(decay * 5 * sr));
  const f = 2 * Math.sin((Math.PI * Math.min(o.freq ?? 2000, sr * 0.2)) / sr), q = 1 / (o.q ?? 1);
  const hp = o.highpass ?? 0, hpa = Math.exp((-TAU * hp) / sr);
  const tone = o.tone ?? 0, toneHz = o.toneHz ?? 190, attS = Math.round((o.attack ?? 0.0005) * sr);
  const useHigh = o.mode === "hp";
  const [gl, gr] = panGains(o.pan ?? 0);
  const gain = (o.gain ?? 0.2) * vel;
  let lo = 0, bp = 0, hpPrevX = 0, hpY = 0, ph = 0;
  for (let i = start, k = 0; i < end; i++, k++) {
    const t = k / sr;
    let x = ctx.rng.noise();
    if (hp) { hpY = hpa * (hpY + x - hpPrevX); hpPrevX = x; x = hpY; }
    lo += f * bp;
    const hi = x - lo - q * bp;
    bp += f * hi;
    let y = (useHigh ? hi : bp) * Math.exp(-t / decay);
    if (tone) { ph += (TAU * toneHz) / sr; y += tone * Math.sin(ph) * Math.exp(-t / 0.06); }
    if (k < attS) y *= k / attS;
    y *= gain;
    out(ctx, i, y * gl, y * gr, o.send ?? 0.12, 0);
  }
}
const snare = (ctx, t, v, o = {}) => noiseHit(ctx, t, v, { freq: 1900, q: 0.8, decay: 0.13, tone: 0.55, toneHz: 185, gain: 0.32, send: 0.14, ...o });
const hat = (ctx, t, v, o = {}) => noiseHit(ctx, t, v, { freq: 9000, q: 0.9, decay: 0.035, highpass: 6000, gain: 0.12, mode: "hp", ...o });
const shaker = (ctx, t, v, o = {}) => noiseHit(ctx, t, v, { freq: 6500, q: 1.2, decay: 0.045, highpass: 4000, gain: 0.07, attack: 0.012, ...o });
function clap(ctx, t, v, o = {}) {
  for (let j = 0; j < 3; j++) noiseHit(ctx, t + j * 0.011, v * (j === 2 ? 1 : 0.6), { freq: 1300, q: 1.1, decay: j === 2 ? 0.14 : 0.012, gain: 0.25, send: 0.2, ...o });
}
function tick(ctx, t0, vel, o = {}) {
  const sr = ctx.sr, start = Math.round(t0 * sr);
  if (start < 0 || start >= ctx.n) return;
  const end = Math.min(ctx.n, start + Math.round(0.06 * sr));
  const f = o.freq ?? 1750, [gl, gr] = panGains(o.pan ?? 0.25), gain = (o.gain ?? 0.09) * vel;
  for (let i = start, k = 0; i < end; i++, k++) {
    const t = k / sr;
    const y = (Math.sin((TAU * f * k) / sr) * 0.7 + Math.sin((TAU * f * 2.63 * k) / sr) * 0.3) * Math.exp(-t / 0.012) * gain;
    out(ctx, i, y * gl, y * gr, o.send ?? 0.2, 0);
  }
}
function tom(ctx, t0, midi, vel, o = {}) {
  const sr = ctx.sr, start = Math.round(t0 * sr);
  if (start < 0 || start >= ctx.n) return;
  const f = midiToHz(midi), decay = o.decay ?? 0.45;
  const end = Math.min(ctx.n, start + Math.round(decay * 4 * sr));
  const [gl, gr] = panGains(o.pan ?? 0), gain = (o.gain ?? 0.26) * vel;
  let ph = 0, lp = 0;
  for (let i = start, k = 0; i < end; i++, k++) {
    const t = k / sr;
    ph += (TAU * f * (1 + 0.6 * Math.exp(-t / 0.05))) / sr;
    lp += 0.12 * (ctx.rng.noise() - lp);
    let y = Math.sin(ph) * Math.exp(-t / decay) + lp * 0.5 * Math.exp(-t / 0.04);
    y = Math.tanh(y * 1.2) * gain;
    out(ctx, i, y * gl, y * gr, o.send ?? 0.35, 0);
  }
}

// ---------------------------------------------------------------- effects & textures
function riser(ctx, t0, dur, o = {}) {
  const sr = ctx.sr, start = Math.max(0, Math.round(t0 * sr));
  const end = Math.min(ctx.n, start + Math.round(dur * sr));
  const gain = o.gain ?? 0.07, [gl, gr] = panGains(0);
  let lo = 0, bp = 0, ph = 0;
  for (let i = start, k = 0; i < end; i++, k++) {
    const x = k / (end - start || 1);
    const fc = 250 * Math.pow(24, x);
    const f = 2 * Math.sin((Math.PI * Math.min(fc, sr * 0.2)) / sr);
    lo += f * bp; const hi = ctx.rng.noise() - lo - 0.45 * bp; bp += f * hi;
    ph += (TAU * (180 + 900 * x * x)) / sr;
    const y = (bp * 0.8 + Math.sin(ph) * 0.25) * gain * x * x;
    out(ctx, i, y * gl, y * gr, o.send ?? 0.4, 0);
  }
}
function impact(ctx, t0, vel, o = {}) {
  const sr = ctx.sr, start = Math.round(t0 * sr);
  if (start < 0 || start >= ctx.n) return;
  const end = Math.min(ctx.n, start + Math.round(2.8 * sr)), gain = (o.gain ?? 0.32) * vel;
  let ph = 0, lp = 0, hpY = 0, hpX = 0;
  const hpa = Math.exp((-TAU * 3000) / sr);
  for (let i = start, k = 0; i < end; i++, k++) {
    const t = k / sr;
    ph += (TAU * (38 + 90 * Math.exp(-t / 0.08))) / sr;
    const n = ctx.rng.noise();
    lp += 0.05 * (n - lp);
    hpY = hpa * (hpY + n - hpX); hpX = n;
    const y = (Math.sin(ph) * Math.exp(-t / 0.9) + lp * 1.6 * Math.exp(-t / 0.25) + hpY * 0.15 * Math.exp(-t / 0.9)) * gain;
    out(ctx, i, Math.tanh(y), Math.tanh(y), o.send ?? 0.55, 0);
  }
}
function whisper(ctx, t0, dur, o = {}) {
  const sr = ctx.sr, start = Math.max(0, Math.round(t0 * sr)), end = Math.min(ctx.n, start + Math.round(dur * sr));
  const [gl, gr] = panGains(o.pan ?? ctx.rng.range(-0.8, 0.8)), gain = o.gain ?? 0.05;
  const fA = [ctx.rng.range(500, 900), ctx.rng.range(1200, 2400)], fB = [ctx.rng.range(300, 700), ctx.rng.range(900, 2900)];
  const S = [{ lo: 0, bp: 0 }, { lo: 0, bp: 0 }];
  const puffs = ctx.rng.range(1.5, 3.5);
  for (let i = start, k = 0; i < end; i++, k++) {
    const x = k / (end - start || 1);
    const n = ctx.rng.noise();
    let y = 0;
    for (let j = 0; j < 2; j++) {
      const fc = fA[j] + (fB[j] - fA[j]) * x, f = 2 * Math.sin((Math.PI * fc) / sr);
      const s = S[j]; s.lo += f * s.bp; const hi = n - s.lo - 0.12 * s.bp; s.bp += f * hi;
      y += s.bp * (j ? 0.5 : 1);
    }
    const env = Math.pow(Math.sin(Math.PI * x), 2) * (0.55 + 0.45 * Math.sin(TAU * puffs * x));
    y *= gain * env * 0.3;
    out(ctx, i, y * gl, y * gr, o.send ?? 0.7, 0);
  }
}
function creak(ctx, t0, dur, o = {}) {
  const sr = ctx.sr, start = Math.max(0, Math.round(t0 * sr)), end = Math.min(ctx.n, start + Math.round(dur * sr));
  const fc = o.freq ?? ctx.rng.range(500, 900), f = 2 * Math.sin((Math.PI * fc) / sr), q = 1 / 14;
  const [gl, gr] = panGains(o.pan ?? ctx.rng.range(-0.7, 0.7)), gain = o.gain ?? 0.12;
  let lo = 0, bp = 0, phase = 0;
  const r0 = ctx.rng.range(14, 30), r1 = ctx.rng.range(35, 70);
  for (let i = start, k = 0; i < end; i++, k++) {
    const x = k / (end - start || 1);
    const rate = r0 + (r1 - r0) * Math.sin(Math.PI * x) * (1 + 0.3 * Math.sin(TAU * 3 * x));
    phase += rate / sr;
    let imp = 0;
    if (phase >= 1) { phase -= 1; imp = 1; }
    lo += f * bp; const hi = imp - lo - q * bp; bp += f * hi;
    const y = bp * gain * Math.sin(Math.PI * x);
    out(ctx, i, y * gl, y * gr, o.send ?? 0.45, 0);
  }
}
function scrape(ctx, t0, dur, midi, o = {}) {
  const sr = ctx.sr, start = Math.max(0, Math.round(t0 * sr)), end = Math.min(ctx.n, start + Math.round(dur * sr));
  const f = midiToHz(midi), [gl, gr] = panGains(o.pan ?? ctx.rng.range(-0.6, 0.6)), gain = o.gain ?? 0.035;
  let pc = 0, pm = 0;
  for (let i = start, k = 0; i < end; i++, k++) {
    const x = k / (end - start || 1);
    const bend = Math.pow(2, (-3.5 * x) / 12);
    pc += (TAU * f * bend) / sr; pm += (TAU * f * 2.76 * bend) / sr;
    if (pc > TAU) pc -= TAU;
    if (pm > TAU) pm -= TAU;
    const idx = 1.2 + 1.8 * Math.sin(Math.PI * x);
    const y = Math.sin(pc + idx * Math.sin(pm)) * gain * Math.pow(Math.sin(Math.PI * x), 1.5);
    out(ctx, i, y * gl, y * gr, o.send ?? 0.75, 0);
  }
}
function heartbeat(ctx, t0, vel) {
  kick(ctx, t0, vel * 0.8, { f0: 95, f1: 48, decay: 0.16, gain: 0.3, send: 0.15 });
  kick(ctx, t0 + 0.24, vel * 0.55, { f0: 85, f1: 46, decay: 0.14, gain: 0.3, send: 0.15 });
}
function crackle(ctx, t0, t1, o = {}) {
  const sr = ctx.sr, start = Math.max(0, Math.round(t0 * sr)), end = Math.min(ctx.n, Math.round(t1 * sr));
  const rate = (o.rate ?? 7) / sr, gain = o.gain ?? 0.03;
  let lp = 0, pop = 0;
  for (let i = start; i < end; i++) {
    lp += 0.04 * (ctx.rng.noise() - lp);
    if (ctx.rng.next() < rate) pop = ctx.rng.range(0.4, 1) * (ctx.rng.chance(0.5) ? 1 : -1);
    const y = (lp * 0.12 + pop) * gain;
    pop *= 0.55;
    ctx.L[i] += y; ctx.R[i] += y * 0.9;
  }
}

function reverb(ctx, { room = 0.84, damp = 0.4, wet = 0.3, width = 1 }) {
  const sr = ctx.sr, sc = sr / 44100;
  const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((x) => Math.round(x * sc));
  const apT = [556, 441, 341, 225].map((x) => Math.round(x * sc));
  const spread = Math.round(23 * sc);
  const mk = (len) => ({ b: new Float32Array(len), i: 0, s: 0 });
  const cL = combT.map((t) => mk(t)), cR = combT.map((t) => mk(t + spread));
  const aL = apT.map((t) => mk(t)), aR = apT.map((t) => mk(t + spread));
  const fb = room * 0.28 + 0.7, d1 = damp * 0.4, d2 = 1 - d1;
  const w1 = wet * 3 * (width / 2 + 0.5), w2 = wet * 3 * ((1 - width) / 2);
  const { V, L, R, n } = ctx;
  for (let i = 0; i < n; i++) {
    const x = V[i] * 0.015;
    let oL = 0, oR = 0;
    for (let c = 0; c < 8; c++) {
      let f = cL[c], y = f.b[f.i];
      f.s = y * d2 + f.s * d1; f.b[f.i] = x + f.s * fb; if (++f.i >= f.b.length) f.i = 0; oL += y;
      f = cR[c]; y = f.b[f.i];
      f.s = y * d2 + f.s * d1; f.b[f.i] = x + f.s * fb; if (++f.i >= f.b.length) f.i = 0; oR += y;
    }
    for (let a = 0; a < 4; a++) {
      let f = aL[a], y = f.b[f.i];
      f.b[f.i] = oL + y * 0.5; if (++f.i >= f.b.length) f.i = 0; oL = y - oL;
      f = aR[a]; y = f.b[f.i];
      f.b[f.i] = oR + y * 0.5; if (++f.i >= f.b.length) f.i = 0; oR = y - oR;
    }
    L[i] += oL * w1 + oR * w2;
    R[i] += oR * w1 + oL * w2;
  }
}

function pingPong(ctx, { time = 0.375, feedback = 0.35, mix = 0.25, tone = 3500 }) {
  const sr = ctx.sr, D = Math.max(1, Math.round(time * sr));
  const bl = new Float32Array(D), br = new Float32Array(D);
  const a = 1 - Math.exp((-TAU * tone) / sr);
  let idx = 0, lpL = 0, lpR = 0;
  const { L, R, V, n } = ctx, Din = ctx.D;
  for (let i = 0; i < n; i++) {
    const dl = bl[idx], dr = br[idx];
    lpL += a * (dr - lpL); lpR += a * (dl - lpR);
    bl[idx] = Din[i] + lpL * feedback;
    br[idx] = lpR * feedback;
    if (++idx >= D) idx = 0;
    L[i] += dl * mix; R[i] += dr * mix;
    V[i] += (dl + dr) * 0.25 * mix;
  }
}

// ---------------------------------------------------------------- arrangement helpers
const RHYTHMS = {
  slow: [
    [[0, 2], [2, 1], [3, 1], [4, 3], [7, 1]],
    [[0, 1.5], [1.5, 0.5], [2, 2], [4, 1], [5, 1], [6, 2]],
    [[0, 3], [3, 1], [4, 4]],
    [[1, 1], [2, 1], [3, 1], [4, 2], [6, 2]],
    [[0, 1], [1, 1], [2, 2], [4, 1], [5, 1], [6, 2]],
  ],
  medium: [
    [[0, 0.5], [0.5, 0.5], [1, 1], [2, 0.5], [2.5, 0.5], [3, 1], [4, 1], [5, 1], [6, 2]],
    [[0, 1], [1, 0.5], [1.5, 0.5], [2, 1], [3, 1], [4, 0.5], [4.5, 0.5], [5, 1], [6, 2]],
    [[0, 0.75], [0.75, 0.75], [1.5, 0.5], [2, 2], [4, 0.75], [4.75, 0.75], [5.5, 0.5], [6, 2]],
    [[0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 1.5], [4, 0.5], [4.5, 0.5], [5, 1], [6, 1.5]],
  ],
};

function buildSections(bars, rng) {
  if (bars <= 4) return [{ start: 0, bars, kind: "A", energy: 0.65 }];
  const intro = clamp(Math.round(bars * 0.12), 1, 4), outro = clamp(Math.round(bars * 0.1), 1, 4);
  const secs = [{ start: 0, bars: intro, kind: "intro", energy: 0.3 }];
  let pos = intro, idx = 0;
  const midEnd = bars - outro, chunk = midEnd - intro >= 16 ? 8 : 4;
  while (pos < midEnd) {
    let len = Math.min(chunk, midEnd - pos);
    if (midEnd - (pos + len) < 2) len = midEnd - pos;
    const kind = idx % 2 === 0 ? "A" : "B";
    const isLast = pos + len >= midEnd;
    const energy = kind === "A" ? (idx === 0 ? 0.58 : 0.7) : isLast ? 0.95 : 0.86;
    secs.push({ start: pos, bars: len, kind, energy: clamp(energy + rng.range(-0.04, 0.04), 0, 1) });
    pos += len; idx++;
  }
  secs.push({ start: midEnd, bars: outro, kind: "outro", energy: 0.32 });
  return secs;
}

// ---------------------------------------------------------------- moods
// Each mood: label, description, tempo range, keys (pitch class), scale, progressions,
// mix settings and an arrange() that writes the parts.
const MOODS = {
  horror: {
    label: "Horror",
    blurb: "Dark drones, dissonance, whispers and a creeping music box",
    bpm: [56, 66], keys: [1, 2, 3, 4, 5], scale: "phrygian", barsPerChord: 4,
    progressions: [["i", "bII", "i", "bVII"], ["i", "i", "bII", "i"], ["i", "bVI", "bII", "i"]],
    verb: { room: 0.95, damp: 0.25, wet: 0.42 }, delay: { feedback: 0.45, mix: 0.18 },
    rms: 0.095, fadeIn: 2.5, arrange: arrangeHorror,
  },
  suspense: {
    label: "Suspense",
    blurb: "Ticking pulse, string ostinato, risers and hits",
    bpm: [92, 108], keys: [2, 4, 7, 9, 11], scale: "harmonicMinor", barsPerChord: 2,
    progressions: [["i", "i", "bVI", "V"], ["i", "bII", "i", "bII"], ["i", "bVI", "bII", "V"]],
    verb: { room: 0.84, damp: 0.35, wet: 0.3 }, delay: { feedback: 0.3, mix: 0.12 },
    rms: 0.125, fadeIn: 0.8, arrange: arrangeSuspense,
  },
  ambient: {
    label: "Ambient",
    blurb: "Warm evolving pads, soft piano and shimmer",
    bpm: [64, 76], keys: [2, 4, 5, 7, 9], scale: "lydian", barsPerChord: 2,
    progressions: [["Imaj7", "vi9", "IVmaj7", "Vsus2"], ["Imaj7", "IVmaj7", "vi9", "IVmaj7"], ["vi9", "IVmaj7", "Imaj7", "Vsus2"], ["Imaj7", "iii7", "IVmaj7", "IVmaj7"]],
    verb: { room: 0.93, damp: 0.35, wet: 0.44 }, delay: { feedback: 0.42, mix: 0.22 },
    rms: 0.1, fadeIn: 2.5, arrange: arrangeAmbient,
  },
  sad: {
    label: "Sad piano",
    blurb: "Emotional piano with strings underneath",
    bpm: [64, 76], keys: [9, 2, 4, 11, 1], scale: "minor", barsPerChord: 1,
    progressions: [["i", "bVI", "bIII", "bVII"], ["i", "iv", "bVI", "V"], ["bVI", "bVII", "i", "i"], ["i", "bVII", "bVI", "bVII"]],
    verb: { room: 0.86, damp: 0.45, wet: 0.32 }, delay: { feedback: 0.25, mix: 0.08 },
    rms: 0.1, fadeIn: 0.4, arrange: arrangeSad,
  },
  lofi: {
    label: "Lo-fi",
    blurb: "Dusty beat, electric piano and vinyl crackle",
    bpm: [72, 86], keys: [0, 2, 5, 7, 10], scale: "major", barsPerChord: 1,
    progressions: [["ii7", "V7", "Imaj7", "vi7"], ["IVmaj7", "iii7", "ii7", "Imaj7"], ["Imaj7", "vi7", "ii7", "V7"], ["vi7", "ii7", "V7", "Imaj7"]],
    verb: { room: 0.62, damp: 0.5, wet: 0.16 }, delay: { feedback: 0.3, mix: 0.12 },
    rms: 0.13, fadeIn: 0.3, lowpass: 6800, swing: 0.6, arrange: arrangeLofi,
  },
  cinematic: {
    label: "Cinematic",
    blurb: "Epic drums, low strings, brass swells and choir",
    bpm: [84, 98], keys: [2, 4, 0, 7, 9], scale: "minor", barsPerChord: 1,
    progressions: [["i", "bVI", "bIII", "bVII"], ["i", "bVI", "iv", "V"], ["i", "bVII", "bVI", "bVII"], ["i", "iv", "bVI", "bVII"]],
    verb: { room: 0.9, damp: 0.3, wet: 0.36 }, delay: { feedback: 0.25, mix: 0.08 },
    rms: 0.14, fadeIn: 1.2, arrange: arrangeCinematic,
  },
  upbeat: {
    label: "Upbeat",
    blurb: "Bright plucks, bouncy bass and a clap beat",
    bpm: [112, 124], keys: [0, 2, 4, 5, 7, 9], scale: "major", barsPerChord: 1,
    progressions: [["I", "V", "vi", "IV"], ["vi", "IV", "I", "V"], ["I", "IV", "vi", "V"], ["IV", "I", "V", "vi"]],
    verb: { room: 0.7, damp: 0.4, wet: 0.18 }, delay: { feedback: 0.34, mix: 0.16 },
    rms: 0.155, fadeIn: 0.2, arrange: arrangeUpbeat,
  },
  mystery: {
    label: "Mystery",
    blurb: "Sneaky pizzicato, celesta and soft brushes",
    bpm: [88, 100], keys: [2, 4, 7, 9, 0], scale: "harmonicMinor", barsPerChord: 1,
    progressions: [["i", "iv", "V", "i"], ["i", "bVI", "iv", "V"], ["i", "bII", "V", "i"], ["iv", "i", "V", "i"]],
    verb: { room: 0.76, damp: 0.4, wet: 0.26 }, delay: { feedback: 0.3, mix: 0.12 },
    rms: 0.12, fadeIn: 0.3, arrange: arrangeMystery,
  },
};

/** Public list for menus and the MCP tool. */
export const MOOD_LIST = Object.entries(MOODS).map(([id, m]) => ({
  id, label: m.label, description: m.blurb, bpm: Math.round((m.bpm[0] + m.bpm[1]) / 2),
}));

function forEachBar(plan, fn) {
  for (let b = 0; b < plan.bars; b++) fn(b, b * plan.bar, plan.sectionAt(b), plan.chordAt(b));
}

function arrangeHorror(ctx, plan, rng) {
  const { key, bar, beat, bars } = plan;
  const total = bars * bar;
  const root = 36 + key; // drone root, C2..F2
  // drone: whole track, changing colour with the chord
  for (let b = 0; b < bars; b += plan.barsPerChord) {
    const ch = plan.chordAt(b), len = Math.min(plan.barsPerChord, bars - b) * bar;
    const n = root + ch.root;
    synthNote(ctx, b * bar, len, n, { wave: "saw", sine: 0.45, voices: 3, detune: 14, gain: 0.12, cutoff: 420, lfo: 0.07, lfoDepth: 0.55, attack: 3, release: 4, send: 0.35, tremolo: 0.18, tremoloDepth: 0.35 });
    synthNote(ctx, b * bar, len, n - 12, { wave: "sine", gain: 0.06, cutoff: 160, attack: 2.5, release: 3, send: 0.1 });
    if (plan.sectionAt(b).energy > 0.35) {
      // dissonant cluster: minor second + tritone, very slow
      const top = 60 + key + ch.root;
      for (const iv of [0, 1, 6]) synthNote(ctx, b * bar + rng.range(0, 1), len, top + iv, { wave: "saw", voices: 2, detune: 18, gain: 0.045, cutoff: 1300, lfo: 0.11, lfoDepth: 0.5, attack: 5, release: 4, send: 0.7, vibrato: 0.2, vibratoCents: 22 });
    }
  }
  // choir in the darker, louder parts
  forEachBar(plan, (b, t, sec) => {
    if (sec.energy > 0.62 && b % 4 === 0) {
      choirNote(ctx, t, Math.min(4, bars - b) * bar - 0.5, 48 + key + plan.chordAt(b).root, { vowel: "oo", gain: 0.07, attack: 2.5, release: 2.5, pan: -0.25 });
      choirNote(ctx, t + 0.4, Math.min(4, bars - b) * bar - 0.8, 48 + key + plan.chordAt(b).root + 1, { vowel: "oo", gain: 0.05, attack: 3, release: 2.5, pan: 0.3 });
    }
  });
  // music box motif, descending, slightly out of tune
  const motifs = [[12, 10, 8, 7, 8, 5, 3, 1], [7, 8, 7, 5, 3, 1, 0, -1], [15, 13, 12, 8, 7, 5, 8, 7]];
  const motif = rng.pick(motifs);
  forEachBar(plan, (b, t, sec) => {
    if (sec.kind === "A" && sec.energy > 0.45 && b % 2 === 0) {
      for (let j = 0; j < 8; j++) {
        const m = 84 + key + motif[j];
        const when = t + j * beat + rng.range(-0.02, 0.05);
        bellNote(ctx, when, m, rng.range(0.6, 0.85), { ratio: 5.2, index: 0.9, decay: 1.6, gain: 0.065, send: 0.7, delay: 0.25, pan: 0.35, detune: 9 });
        bellNote(ctx, when + 0.012, m, rng.range(0.4, 0.6), { ratio: 5.2, index: 0.7, decay: 1.4, gain: 0.03, send: 0.7, pan: -0.35, detune: -11 });
      }
    }
  });
  // textures
  const count = Math.max(2, Math.round(total / 9));
  for (let j = 0; j < count; j++) {
    const t = rng.range(2, Math.max(3, total - 4)), kind = rng.next();
    if (kind < 0.35) whisper(ctx, t, rng.range(1.6, 3.2), { gain: 0.07 });
    else if (kind < 0.65) creak(ctx, t, rng.range(1.2, 2.6), { gain: 0.1 });
    else scrape(ctx, t, rng.range(3, 6), 76 + key + rng.int(0, 6), { gain: 0.03 });
  }
  // heartbeat during the most intense section
  plan.sections.forEach((sec) => {
    if (sec.energy > 0.8) {
      const hb = 60 / rng.range(62, 72);
      for (let t = sec.start * bar; t < (sec.start + sec.bars) * bar - 0.5; t += hb) heartbeat(ctx, t, 0.9);
    }
    if (sec.kind === "B" || (sec.kind === "A" && sec.start > 0 && sec.energy > 0.6)) {
      riser(ctx, Math.max(0, sec.start * bar - 3.2), 3.2, { gain: 0.06, send: 0.6 });
      impact(ctx, sec.start * bar, 0.8, { gain: 0.3 });
    }
  });
}

function arrangeSuspense(ctx, plan, rng) {
  const { key, bar, beat, bars } = plan;
  let prev = null;
  forEachBar(plan, (b, t, sec, ch) => {
    const e = sec.energy;
    const rootLow = bassNote(ch, key, 33);
    // dark pad
    if (b % plan.barsPerChord === 0) {
      const v = voiceChord(ch, key, 50, 64, prev, 3); prev = v;
      for (const n of v) synthNote(ctx, t, plan.barsPerChord * bar, n, { wave: "saw", voices: 2, detune: 10, gain: 0.045, cutoff: 1000, lfo: 0.1, lfoDepth: 0.3, attack: 1.2, release: 1.5, send: 0.45 });
    }
    // pulse bass: 8ths, 16ths when hot
    if (e > 0.25) {
      const step = e > 0.8 ? beat / 4 : beat / 2;
      for (let x = 0; x < bar - 1e-6; x += step) {
        synthNote(ctx, t + x, step * 0.7, rootLow, { wave: "saw", sine: 0.4, gain: 0.08 * (x % beat === 0 ? 1 : 0.75), cutoff: 420, cutoffEnv: 2.2, cutoffEnvTime: 0.06, attack: 0.004, release: 0.05, send: 0.06 });
      }
    }
    // ticking clock
    if (e > 0.35) for (let q = 0; q < 4; q++) tick(ctx, t + q * beat, q === 0 ? 1 : 0.7, { gain: 0.08 + 0.05 * e });
    // string ostinato
    if (e > 0.45) {
      const pat = [0, 0, 7, 0, 8, 0, 7, 3];
      for (let j = 0; j < 8; j++) {
        const n = 45 + key + ch.root + pat[j] + (pat[j] === 8 && ch.root ? -1 : 0);
        synthNote(ctx, t + (j * beat) / 2, beat * 0.32, n, { wave: "saw", voices: 2, detune: 8, gain: 0.075, cutoff: 2200, cutoffEnv: 1.2, cutoffEnvTime: 0.05, attack: 0.006, release: 0.07, send: 0.25, pan: -0.25 });
      }
    }
    // high tension note
    if (e > 0.75 && b % 2 === 0) synthNote(ctx, t, bar * 2 - 0.2, 81 + key + ch.root + rng.pick([1, 7]), { wave: "saw", voices: 2, detune: 7, gain: 0.03, cutoff: 3200, attack: 1.4, release: 1, vibrato: 5.5, vibratoCents: 9, send: 0.5, pan: 0.3 });
    // taiko hits in hot sections
    if (e > 0.8) { tom(ctx, t, 38 + key, 0.9, { decay: 0.6, gain: 0.3 }); if (rng.chance(0.6)) tom(ctx, t + beat * 2.5, 41 + key, 0.6, { decay: 0.5 }); }
  });
  plan.sections.forEach((sec) => {
    if (sec.start > 0 && sec.kind !== "outro") { riser(ctx, Math.max(0, sec.start * bar - bar), bar, { gain: 0.07 }); impact(ctx, sec.start * bar, 0.75); }
  });
}

function arrangeAmbient(ctx, plan, rng) {
  const { key, bar, beat, bars } = plan;
  let prev = null, phraseEnd = null;
  forEachBar(plan, (b, t, sec, ch) => {
    const e = sec.energy;
    if (b % plan.barsPerChord === 0) {
      const len = Math.min(plan.barsPerChord, bars - b) * bar;
      const v = voiceChord(ch, key, 52, 69, prev, 4); prev = v;
      v.forEach((n, j) => synthNote(ctx, t + j * 0.05, len + 0.3, n, { wave: "saw", voices: 3, detune: 11, gain: 0.05, cutoff: 1300 + 1000 * e, lfo: 0.06, lfoDepth: 0.35, attack: 2.2, release: 3, send: 0.6, spread: 0.7 }));
      if (e > 0.4) synthNote(ctx, t, len, bassNote(ch, key, 36), { wave: "sine", gain: 0.07, cutoff: 300, attack: 1.2, release: 2, send: 0.15 });
      // shimmer
      if (e > 0.6) for (let j = 0; j < 3; j++) {
        const tones = ch.iv.map((i) => 84 + key + ch.root + i);
        bellNote(ctx, t + rng.range(0, len - 1), rng.pick(tones), rng.range(0.5, 0.8), { ratio: 2, index: 0.6, decay: 2.8, gain: 0.045, send: 0.8, delay: 0.4, pan: rng.range(-0.7, 0.7) });
      }
    }
    // soft piano melody, two-bar phrases
    if (e > 0.35 && b % 2 === 0 && b + 1 < bars) {
      const notes = makePhrase(rng, { key, scale: SCALES.majorPent.map((x) => x), low: 64 + key % 12, high: 81, rhythms: RHYTHMS.slow, beats: 8, chordAtBeat: (bt) => plan.chordAt(b + Math.floor(bt / 4)), prevEnd: phraseEnd });
      for (const nt of notes) pianoNote(ctx, t + nt.t * beat + rng.range(0, 0.02), nt.m, nt.v * 0.75, { dur: nt.d * beat, pedal: true, gain: 0.15, send: 0.5, delay: 0.25, maxDur: 5 });
      phraseEnd = notes.length ? notes[notes.length - 1].m : phraseEnd;
    }
    // gentle arpeggio in the fullest parts
    if (e > 0.78) {
      const tones = voiceChord(ch, key, 60, 76, null, 4);
      const seq = [0, 1, 2, 3, 2, 1, 0, 2];
      seq.forEach((s, j) => pluckNote(ctx, t + (j * beat) / 2, tones[s % tones.length] + 12, 0.45, { bright: 0.25, feedback: 0.997, dur: beat, gain: 0.12, send: 0.4, delay: 0.35, pan: j % 2 ? 0.4 : -0.4 }));
    }
  });
}

function arrangeSad(ctx, plan, rng) {
  const { key, bar, beat, bars } = plan;
  let prev = null, phraseEnd = null;
  forEachBar(plan, (b, t, sec, ch) => {
    const e = sec.energy;
    // left hand broken chords, pedalled per bar
    const r = bassNote(ch, key, 38);
    const third = ch.iv[1], fifth = ch.iv[2];
    const lh = [r, r + fifth, r + 12, r + 12 + third, r + 24, r + 12 + third, r + 12, r + fifth];
    lh.forEach((n, j) => pianoNote(ctx, t + (j * beat) / 2 + rng.range(0, 0.012), n, (j === 0 ? 0.62 : 0.45) * (0.85 + 0.3 * e), { dur: bar - (j * beat) / 2, pedal: false, gain: 0.15, send: 0.3 }));
    // melody
    if (e > 0.25 && b % 2 === 0 && b + 1 < bars) {
      const notes = makePhrase(rng, { key, scale: SCALES.minor, low: 67, high: 86, rhythms: RHYTHMS.slow, beats: 8, chordAtBeat: (bt) => plan.chordAt(b + Math.floor(bt / 4)), prevEnd: phraseEnd });
      for (const nt of notes) pianoNote(ctx, t + nt.t * beat + rng.range(0, 0.015), nt.m, nt.v * (0.8 + 0.2 * e), { dur: nt.d * beat, gain: 0.16, send: 0.32 });
      phraseEnd = notes.length ? notes[notes.length - 1].m : phraseEnd;
    }
    // strings underneath
    if (e > 0.55) {
      const v = voiceChord(ch, key, 55, 70, prev, 3); prev = v;
      for (const n of v) synthNote(ctx, t, bar + 0.1, n, { wave: "saw", voices: 3, detune: 9, gain: 0.03 + 0.02 * e, cutoff: 1500, attack: 0.9, release: 1.2, vibrato: 5.2, vibratoCents: 7, send: 0.5, spread: 0.8 });
    }
    if (e > 0.7) synthNote(ctx, t, bar, r - 12, { wave: "saw", voices: 2, detune: 6, gain: 0.05, cutoff: 650, attack: 0.5, release: 0.9, vibrato: 4.8, vibratoCents: 6, send: 0.35 });
  });
}

function arrangeLofi(ctx, plan, rng) {
  const { key, bar, beat, bars } = plan;
  const sw = plan.swing; // position of the off-beat within a beat (0.5 = straight)
  // x in beats; only the exact off-beat 8th gets pushed late (swing)
  const off = (x) => { const f = x % 1; return (Math.floor(x) + (Math.abs(f - 0.5) < 1e-6 ? sw : f)) * beat; };
  let prev = null, phraseEnd = null;
  crackle(ctx, 0, bars * bar + 2, { gain: 0.035, rate: 6 });
  const kickPat = rng.pick([[0, 1.5, 2.5], [0, 2, 2.5], [0, 1.5, 3.5]]);
  forEachBar(plan, (b, t, sec, ch) => {
    const e = sec.energy;
    // electric piano chords
    const v = voiceChord(ch, key, 53, 69, prev, 4); prev = v;
    const hits = rng.chance(0.4) ? [[0, 2.5], [3.5, 0.5]] : [[0, 3.6]];
    for (const [x, d] of hits) v.forEach((n, j) => epNote(ctx, t + off(x) + j * 0.008, d * beat, n, x === 0 ? 0.7 : 0.5, { gain: 0.1, send: 0.22, delay: 0.1 }));
    // bass
    if (e > 0.3) {
      const r = bassNote(ch, key, 36);
      synthNote(ctx, t, beat * 1.6, r, { wave: "sine", sine: 0, gain: 0.08, cutoff: 600, attack: 0.008, release: 0.12, send: 0.03 });
      synthNote(ctx, t + off(2.5), beat * 0.9, r + (rng.chance(0.5) ? 7 : 12), { wave: "sine", gain: 0.06, cutoff: 600, attack: 0.008, release: 0.1, send: 0.03 });
    }
    // drums
    if (e > 0.35) {
      for (const x of kickPat) kick(ctx, t + off(x) + rng.range(0, 0.008), x === 0 ? 0.9 : 0.7, { decay: 0.22, gain: 0.22 });
      snare(ctx, t + beat + rng.range(0, 0.01), 0.75, { decay: 0.16, freq: 1500, gain: 0.22 });
      snare(ctx, t + 3 * beat + rng.range(0, 0.01), 0.8, { decay: 0.16, freq: 1500, gain: 0.22 });
      for (let x = 0; x < 4; x += 0.5) hat(ctx, t + off(x) + rng.range(0, 0.006), (x % 1 ? 0.45 : 0.7) * rng.range(0.8, 1), { gain: 0.12, decay: 0.03 });
      if (rng.chance(0.3)) snare(ctx, t + off(3.5), 0.25, { decay: 0.08, freq: 1500, gain: 0.18 });
    }
    // little melody
    if (e > 0.62 && b % 2 === 0 && b + 1 < bars) {
      const notes = makePhrase(rng, { key, scale: SCALES.majorPent, low: 69, high: 86, rhythms: RHYTHMS.medium, beats: 8, chordAtBeat: (bt) => plan.chordAt(b + Math.floor(bt / 4)), prevEnd: phraseEnd });
      for (const nt of notes) bellNote(ctx, t + off(nt.t), nt.m, nt.v * 0.7, { ratio: 1, index: 1.2, decay: 0.9, gain: 0.08, send: 0.25, delay: 0.25, pan: 0.2 });
      phraseEnd = notes.length ? notes[notes.length - 1].m : phraseEnd;
    }
  });
}

function arrangeCinematic(ctx, plan, rng) {
  const { key, bar, beat, bars } = plan;
  let prev = null;
  forEachBar(plan, (b, t, sec, ch) => {
    const e = sec.energy;
    const r = bassNote(ch, key, 36);
    // legato strings
    const v = voiceChord(ch, key, 50, 67, prev, 3); prev = v;
    for (const n of v) synthNote(ctx, t, bar + 0.15, n, { wave: "saw", voices: 3, detune: 10, gain: 0.04 + 0.035 * e, cutoff: 1600 + 1200 * e, attack: 0.6, release: 0.9, vibrato: 5, vibratoCents: 6, send: 0.45, spread: 0.8 });
    // low ostinato
    if (e > 0.3) {
      const step = e > 0.82 ? beat / 4 : beat / 2, pat = [0, 0, 12, 0, 7, 0, 12, 7];
      let j = 0;
      for (let x = 0; x < bar - 1e-6; x += step, j++) synthNote(ctx, t + x, step * 0.55, r + 12 + pat[j % 8], { wave: "saw", voices: 2, detune: 7, gain: 0.045, cutoff: 1500, cutoffEnv: 1.6, cutoffEnvTime: 0.05, attack: 0.005, release: 0.06, send: 0.2 });
    }
    // brass swell on chord changes
    if (e > 0.6) for (const iv of [0, 7, 12]) synthNote(ctx, t, bar * 0.95, r + 12 + iv, { wave: "saw", voices: 3, detune: 8, gain: 0.05 * e, cutoff: 2200, cutoffOpen: 0.7, attack: 0.5, release: 0.5, vibrato: 4.5, vibratoCents: 5, send: 0.4 });
    // choir
    if (e > 0.75) for (const n of v) choirNote(ctx, t, bar, n + 12, { vowel: "ah", gain: 0.045, attack: 0.8, release: 1, pan: rng.range(-0.4, 0.4) });
    // drums
    if (e > 0.45) {
      tom(ctx, t, 31 + key, 1, { decay: 0.9, gain: 0.24, send: 0.4 });
      tom(ctx, t + beat * 1.5, 38 + key, 0.55, { decay: 0.5 });
      tom(ctx, t + beat * 2, 31 + key, 0.75, { decay: 0.8, gain: 0.2 });
      if (e > 0.8) { tom(ctx, t + beat * 3, 43 + key, 0.6); tom(ctx, t + beat * 3.5, 41 + key, 0.65); snare(ctx, t + beat * 3.75, 0.5, { decay: 0.1 }); }
    }
    // a lonely high piano in quiet parts
    if (e < 0.4 && b % 2 === 0) {
      const tones = ch.iv.map((i) => 72 + key + ch.root + i);
      [0, 1.5, 3].forEach((x, j) => pianoNote(ctx, t + x * beat, tones[j % tones.length], 0.5, { dur: beat * 1.5, pedal: true, gain: 0.12, send: 0.55, maxDur: 4 }));
    }
  });
  plan.sections.forEach((sec) => {
    if (sec.start > 0 && sec.kind !== "outro") { riser(ctx, Math.max(0, sec.start * bar - bar), bar, { gain: 0.06 }); impact(ctx, sec.start * bar, 0.9); }
  });
}

function arrangeUpbeat(ctx, plan, rng) {
  const { key, bar, beat, bars } = plan;
  let phraseEnd = null;
  const arp = rng.pick([[0, 1, 2, 3, 2, 1, 0, 1], [0, 2, 1, 3, 0, 2, 1, 3], [0, 1, 2, 1, 3, 2, 1, 2]]);
  forEachBar(plan, (b, t, sec, ch) => {
    const e = sec.energy;
    const tones = voiceChord(ch, key, 60, 76, null, 4);
    // soft pad holds the harmony in the intro and outro
    tones.slice(0, 3).forEach((n) => synthNote(ctx, t, bar, n, { wave: "saw", voices: 3, detune: 12, gain: e <= 0.45 ? 0.045 : 0.04, cutoff: 2600, attack: 0.25, release: 0.5, send: 0.3, spread: 0.8 }));
    // plucky arpeggio
    if (e > 0.2) arp.forEach((s, j) => pluckNote(ctx, t + (j * beat) / 2, tones[s % tones.length], j % 2 ? 0.6 : 0.8, { bright: 0.85, feedback: 0.994, dur: beat * 0.45, gain: 0.26, send: 0.15, delay: 0.3, pan: j % 2 ? 0.35 : -0.35 }));
    // off-beat chord stabs
    if (e > 0.45) for (let q = 0; q < 4; q++) tones.slice(0, 3).forEach((n) => pluckNote(ctx, t + q * beat + beat / 2, n - 12, 0.55, { bright: 0.6, feedback: 0.99, dur: beat * 0.25, gain: 0.11, send: 0.12 }));
    // bass
    if (e > 0.35) {
      const r = bassNote(ch, key, 36);
      for (let j = 0; j < 8; j++) synthNote(ctx, t + (j * beat) / 2, beat * 0.4, r + (j % 2 ? 12 : 0), { wave: "saw", sine: 0.5, gain: 0.05, cutoff: 1000, cutoffEnv: 2, cutoffEnvTime: 0.05, attack: 0.004, release: 0.05, send: 0.03 });
    }
    // drums
    if (e > 0.4) {
      for (let q = 0; q < 4; q++) kick(ctx, t + q * beat, 0.9, { decay: 0.17, gain: 0.15 });
      clap(ctx, t + beat, 0.8); clap(ctx, t + 3 * beat, 0.85);
      for (let q = 0; q < 4; q++) hat(ctx, t + q * beat + beat / 2, 0.8, { decay: 0.07, gain: 0.12 });
      if (e > 0.7) for (let x = 0; x < 4; x += 0.25) shaker(ctx, t + x * beat, x % 0.5 ? 0.6 : 0.9);
    }
    // lead in the chorus
    if (e > 0.72 && b % 2 === 0 && b + 1 < bars) {
      const notes = makePhrase(rng, { key, scale: SCALES.majorPent, low: 72, high: 88, rhythms: RHYTHMS.medium, beats: 8, chordAtBeat: (bt) => plan.chordAt(b + Math.floor(bt / 4)), prevEnd: phraseEnd });
      for (const nt of notes) bellNote(ctx, t + nt.t * beat, nt.m, nt.v, { ratio: 2, index: 1.5, decay: 0.7, gain: 0.085, send: 0.2, delay: 0.2 });
      phraseEnd = notes.length ? notes[notes.length - 1].m : phraseEnd;
    }
  });
  plan.sections.forEach((sec) => { if (sec.kind === "B") riser(ctx, Math.max(0, sec.start * bar - bar), bar, { gain: 0.05 }); });
}

function arrangeMystery(ctx, plan, rng) {
  const { key, bar, beat, bars } = plan;
  let prev = null, phraseEnd = null;
  forEachBar(plan, (b, t, sec, ch) => {
    const e = sec.energy;
    const r = bassNote(ch, key, 38);
    // walking pizzicato
    if (e > 0.2) {
      const walk = [r, r + 7, r + 12, r + 7 + (rng.chance(0.5) ? 1 : -1)];
      walk.forEach((n, q) => pluckNote(ctx, t + q * beat, n, q === 0 ? 0.85 : 0.65, { bright: 0.45, feedback: 0.985, dur: beat * 0.5, gain: 0.24, send: 0.2, pan: -0.2 }));
    }
    // soft chords
    if (e > 0.45) {
      const v = voiceChord(ch, key, 55, 70, prev, 3); prev = v;
      for (const n of v) synthNote(ctx, t, bar, n, { wave: "tri", voices: 2, detune: 6, gain: 0.04, cutoff: 1200, attack: 0.3, release: 0.6, send: 0.35 });
    }
    // celesta melody
    if (e > 0.35 && b % 2 === 0 && b + 1 < bars) {
      const notes = makePhrase(rng, { key, scale: SCALES.harmonicMinor, low: 72, high: 91, rhythms: RHYTHMS.medium, beats: 8, chordAtBeat: (bt) => plan.chordAt(b + Math.floor(bt / 4)), prevEnd: phraseEnd });
      for (const nt of notes) bellNote(ctx, t + nt.t * beat, nt.m, nt.v, { ratio: 3.5, index: 1.1, decay: 1.1, gain: 0.06, send: 0.35, delay: 0.2, pan: 0.25 });
      phraseEnd = notes.length ? notes[notes.length - 1].m : phraseEnd;
    }
    // brushes
    if (e > 0.55) {
      for (let x = 0; x < 4; x += 0.5) shaker(ctx, t + x * beat, x % 1 ? 0.5 : 0.8, { gain: 0.05 });
      tick(ctx, t + beat, 0.6, { freq: 1100, gain: 0.05 }); tick(ctx, t + 3 * beat, 0.6, { freq: 1100, gain: 0.05 });
    }
  });
}

// ---------------------------------------------------------------- planning & rendering

/** Validate and fill in options. Throws on an unknown mood. */
export function normalizeMusicOptions(input = {}) {
  const mood = String(input.mood ?? "ambient").toLowerCase().trim();
  if (!MOODS[mood]) throw new Error(`Unknown mood "${input.mood}". Choose one of: ${Object.keys(MOODS).join(", ")}`);
  const seconds = clamp(Math.round(Number(input.seconds ?? input.duration ?? 60) || 60), MUSIC_LIMITS.minSeconds, MUSIC_LIMITS.maxSeconds);
  const intensity = clamp(Math.round(Number(input.intensity ?? 2) || 2), 1, 3);
  const seed = (Number.isFinite(Number(input.seed)) ? Math.abs(Math.floor(Number(input.seed))) : Math.floor(Math.random() * 1e9)) % 2147483647;
  const bpmIn = Number(input.bpm);
  const bpm = Number.isFinite(bpmIn) && bpmIn > 0 ? clamp(Math.round(bpmIn), MUSIC_LIMITS.minBpm, MUSIC_LIMITS.maxBpm) : null;
  return { mood, seconds, intensity, seed, bpm };
}

export function planTrack(opts) {
  const o = normalizeMusicOptions(opts);
  const M = MOODS[o.mood];
  const rng = makeRng(o.seed * 7919 + 17);
  const scale = SCALES[M.scale];
  const key = rng.pick(M.keys);
  const prog = rng.pick(M.progressions).map(parseChord);
  let bpm = o.bpm ?? Math.round(rng.range(M.bpm[0], M.bpm[1]));
  const tail = clamp(o.seconds * 0.08, 1.5, 4);
  const content = o.seconds - tail;
  let bars = Math.max(1, Math.round((content * bpm) / 240));
  const fitted = (bars * 240) / content;
  if (!o.bpm && bars >= 2 && Math.abs(fitted - bpm) / bpm < 0.12) bpm = fitted;
  const beat = 60 / bpm, bar = beat * 4;
  bars = Math.max(1, Math.floor((content + 0.25 * bar) / bar));
  const sections = buildSections(bars, rng);
  const scaleE = [0.72, 1, 1.22][o.intensity - 1], addE = [-0.06, 0, 0.07][o.intensity - 1];
  for (const s of sections) s.energy = clamp(s.energy * scaleE + addE, 0.05, 1);
  const sectionOf = new Array(bars);
  for (const s of sections) for (let b = s.start; b < s.start + s.bars; b++) sectionOf[b] = s;
  const bpc = M.barsPerChord;
  return {
    ...o, bpm, beat, bar, bars, tail, key, scaleName: M.scale, scale, prog, sections,
    barsPerChord: bpc, swing: M.swing ?? 0.5,
    sectionAt: (b) => sectionOf[clamp(Math.floor(b), 0, bars - 1)],
    chordAt: (b) => prog[Math.floor(Math.max(0, b) / bpc) % prog.length],
    title: `${M.label} in ${NOTE_NAMES[key]} ${SCALE_LABEL[M.scale]}`,
    rngSeed: o.seed,
  };
}

/**
 * Render a track. Returns { left, right, sampleRate, info }.
 * onProgress(fraction) is called a few times while rendering.
 */
export function renderTrack(opts, { sampleRate = 44100, onProgress } = {}) {
  const plan = planTrack(opts);
  const M = MOODS[plan.mood];
  const n = Math.round(plan.seconds * sampleRate);
  const rng = makeRng(plan.seed + 1);
  const ctx = makeCtx(n, sampleRate, rng);
  onProgress?.(0.05);
  M.arrange(ctx, plan, rng);
  onProgress?.(0.7);
  pingPong(ctx, { time: plan.beat * 0.75, ...M.delay });
  reverb(ctx, M.verb);
  onProgress?.(0.9);
  master(ctx, plan, M);
  onProgress?.(1);
  return {
    left: ctx.L, right: ctx.R, sampleRate,
    info: {
      mood: plan.mood, label: M.label, title: plan.title, seconds: plan.seconds,
      bpm: Math.round(plan.bpm), key: NOTE_NAMES[plan.key], scale: SCALE_LABEL[plan.scaleName],
      intensity: plan.intensity, seed: plan.seed,
      chords: plan.prog.map((c) => c.sym), sections: plan.sections.map((s) => s.kind),
    },
  };
}

function master(ctx, plan, M) {
  const { L, R, n, sr } = ctx;
  // high-pass at 28 Hz (and optional low-pass for warmth)
  const hpA = Math.exp((-TAU * 28) / sr);
  const lpA = M.lowpass ? 1 - Math.exp((-TAU * M.lowpass) / sr) : 0;
  let hxL = 0, hyL = 0, hxR = 0, hyR = 0, lpL = 0, lpR = 0;
  let sum = 0, peak = 0;
  for (let i = 0; i < n; i++) {
    let l = L[i], r = R[i];
    if (!(l === l)) l = 0;
    if (!(r === r)) r = 0;
    hyL = hpA * (hyL + l - hxL); hxL = l; l = hyL;
    hyR = hpA * (hyR + r - hxR); hxR = r; r = hyR;
    if (lpA) { lpL += lpA * (l - lpL); lpR += lpA * (r - lpR); l = lpL; r = lpR; }
    L[i] = l; R[i] = r;
    sum += l * l + r * r;
  }
  const rms = Math.sqrt(sum / (2 * n)) || 1e-9;
  const gain = Math.min(30, M.rms / rms);
  const T = 0.72;
  const fadeIn = Math.max(0.01, Math.min(M.fadeIn, plan.seconds * 0.2)) * sr;
  const fadeOut = Math.min(plan.tail + 0.5, plan.seconds * 0.3) * sr;
  for (let i = 0; i < n; i++) {
    let g = gain;
    if (i < fadeIn) g *= Math.sin(((i / fadeIn) * Math.PI) / 2) ** 2;
    const toEnd = n - 1 - i;
    if (toEnd < fadeOut) g *= Math.sin(((toEnd / fadeOut) * Math.PI) / 2) ** 2;
    let l = L[i] * g, r = R[i] * g;
    const al = Math.abs(l), ar = Math.abs(r);
    if (al > T) l = Math.sign(l) * (T + (1 - T) * Math.tanh((al - T) / (1 - T)));
    if (ar > T) r = Math.sign(r) * (T + (1 - T) * Math.tanh((ar - T) / (1 - T)));
    L[i] = l; R[i] = r;
    const p = Math.max(Math.abs(l), Math.abs(r));
    if (p > peak) peak = p;
  }
  if (peak > 0.97) {
    const k = 0.97 / peak;
    for (let i = 0; i < n; i++) { L[i] *= k; R[i] *= k; }
  }
}
