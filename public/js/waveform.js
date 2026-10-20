// The waveform strip: bars drawn from the real audio, filling in while it renders
// and tracking the playhead after. Tap or click to seek.

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export class Waveform {
  constructor(canvas, { tone = "accent" } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.tone = tone;
    this.peaks = new Float32Array(0);
    this.expected = 0;   // number of bars the finished audio will fill (while rendering)
    this.playhead = 0;   // 0..1
    this.reveal = 1;     // 0..1 for the one-time grow-in
    this.onSeek = null;
    this.resize = this.resize.bind(this);
    new ResizeObserver(this.resize).observe(canvas);
    canvas.addEventListener("pointerdown", (e) => {
      if (!this.onSeek || !this.peaks.length || this.expected) return;
      const r = canvas.getBoundingClientRect();
      this.onSeek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
    });
    this.resize();
  }

  colors() {
    const cs = getComputedStyle(this.canvas);
    return {
      played: cs.getPropertyValue(this.tone === "accent2" ? "--accent2" : "--accent").trim() || "#3ccfc0",
      rest: cs.getPropertyValue("--border-input").trim() || "#6f8c96",
      pending: cs.getPropertyValue("--border").trim() || "#2e434d",
    };
  }

  resize() {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.draw();
  }

  /** Bars that fit the current width. */
  barCount() {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    return Math.max(16, Math.floor(this.canvas.width / (5 * dpr)));
  }

  setRendering(expectedSeconds) {
    this.peaks = new Float32Array(0);
    this.live = [];
    this.liveSeconds = 0;
    this.expectedSeconds = Math.max(1, expectedSeconds);
    this.expected = 1;
    this.playhead = 0;
    this.draw();
  }

  /** Add rendered audio peaks while a voiceover is being made (per-50 ms peaks). */
  pushLive(chunkPeaks, seconds) {
    this.live.push(...chunkPeaks);
    this.liveSeconds += seconds;
    this.draw();
  }

  setPeaks(peaks, { animate = true } = {}) {
    this.peaks = peaks;
    this.expected = 0;
    this.playhead = 0;
    if (animate && !reduceMotion()) {
      const t0 = performance.now();
      const step = (t) => {
        this.reveal = Math.min(1, (t - t0) / 650);
        this.draw();
        if (this.reveal < 1) requestAnimationFrame(step);
      };
      this.reveal = 0;
      requestAnimationFrame(step);
    } else {
      this.reveal = 1;
      this.draw();
    }
  }

  setPlayhead(f) { this.playhead = f; this.draw(); }

  draw() {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (W < 16 || H < 4 || !canvas.clientWidth) return; // hidden or not laid out yet
    const n = this.barCount();
    const barW = W / n;
    const gap = Math.max(1, barW * 0.38);
    const col = this.colors();
    const mid = H / 2;
    let values;
    let filled = n;
    if (this.expected) {
      // live: place what we have along the expected length
      const total = Math.max(this.expectedSeconds, this.liveSeconds);
      filled = Math.min(n, Math.round((this.liveSeconds / total) * n));
      values = resample(this.live, filled);
    } else {
      values = resample(this.peaks, n);
    }
    const playedBars = this.expected ? 0 : Math.round(this.playhead * n);
    for (let i = 0; i < n; i++) {
      const x = i * barW + gap / 2;
      let v;
      if (i < filled) {
        v = Math.sqrt(values[i] || 0) * (this.expected ? 1 : easeOut(Math.min(1, this.reveal * 1.6 - (i / n) * 0.6)));
        ctx.fillStyle = this.expected ? col.played : i < playedBars ? col.played : col.rest;
      } else {
        v = 0.04;
        ctx.fillStyle = col.pending;
      }
      const h = Math.max(2, v * (H * 0.92));
      const bw = Math.max(1, barW - gap);
      roundRect(ctx, x, mid - h / 2, bw, h, Math.max(0, Math.min(3, bw / 2)));
    }
  }
}

function resample(arr, n) {
  const out = new Float32Array(n);
  if (!arr.length || !n) return out;
  const step = arr.length / n;
  for (let i = 0; i < n; i++) {
    let m = 0;
    const s = Math.floor(i * step), e = Math.max(s + 1, Math.floor((i + 1) * step));
    for (let j = s; j < e && j < arr.length; j++) if (arr[j] > m) m = arr[j];
    out[i] = m;
  }
  return out;
}

function easeOut(t) { return t <= 0 ? 0 : 1 - Math.pow(1 - t, 3); }

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.fill();
}

/** Peaks every `ms` milliseconds for live drawing. */
export function livePeaks(pcm, sampleRate, ms = 50) {
  const step = Math.max(1, Math.round((sampleRate * ms) / 1000));
  const out = [];
  for (let s = 0; s < pcm.length; s += step) {
    let m = 0;
    for (let i = s; i < Math.min(pcm.length, s + step); i += 2) { const a = Math.abs(pcm[i]); if (a > m) m = a; }
    out.push(m);
  }
  return out;
}
