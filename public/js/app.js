import { hydrateIcons, icon, setIcon } from "./icons.js";
import { VOICES, DEFAULT_VOICE, RECOMMENDED, getVoice } from "./shared/voices.js";
import { MOOD_LIST } from "./shared/music.js";
import { MAX_SCRIPT_CHARS, cleanText, estimateSeconds, wordCount, parseScript, speakersUsed, formatDuration } from "./shared/script.js";
import { speakerVoices } from "./shared/voiceover.js";
import { decodeWav, peaks as wavPeaks } from "./shared/wav.js";
import { Waveform } from "./waveform.js";
import * as library from "./library.js";

// ------------------------------------------------------------ small helpers
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem("tellwave-" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("tellwave-" + k, JSON.stringify(v)); } catch { /* storage off */ } },
};
const FAKE_TTS = ["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).has("fake-tts");
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "audio";

function toast(message, kind = "success") {
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.setAttribute("role", kind === "error" ? "alert" : "status");
  el.innerHTML = `${icon(kind === "error" ? "x" : "check")}<span></span>`;
  el.querySelector("span").textContent = message;
  $("#toasts").append(el);
  setTimeout(() => { el.classList.add("leaving"); setTimeout(() => el.remove(), 260); }, kind === "error" ? 6000 : 3800);
}

function setBusy(btn, busy, label) {
  btn.disabled = busy;
  btn.setAttribute("aria-busy", String(busy));
  const l = btn.querySelector(".btn-label");
  if (!btn.dataset.idle) btn.dataset.idle = l.textContent;
  l.textContent = busy ? label : btn.dataset.idle;
}

function setProgress(el, fraction) {
  el.hidden = fraction == null;
  if (fraction == null) return;
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  el.setAttribute("aria-valuenow", String(pct));
  el.firstElementChild.style.width = pct + "%";
}

async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }
  if (btn) {
    const old = btn.innerHTML;
    btn.innerHTML = `${icon("check")}Copied`;
    setTimeout(() => { btn.innerHTML = old; }, 1600);
  }
  toast("Copied");
}

function chipGroup(container, onChange) {
  const items = $$('[role="radio"]', container);
  const select = (el, focus = false, silent = false) => {
    items.forEach((i) => { const on = i === el; i.setAttribute("aria-checked", String(on)); i.tabIndex = on ? 0 : -1; });
    if (focus) el.focus();
    if (!silent) onChange?.(el);
  };
  items.forEach((el, idx) => {
    if (el.tagName === "BUTTON") el.type = "button";
    el.addEventListener("click", () => select(el));
    el.addEventListener("keydown", (e) => {
      const fwd = e.key === "ArrowRight" || e.key === "ArrowDown", back = e.key === "ArrowLeft" || e.key === "ArrowUp";
      if (!fwd && !back) return;
      e.preventDefault();
      select(items[(idx + (fwd ? 1 : -1) + items.length) % items.length], true);
    });
  });
  const cur = items.find((i) => i.getAttribute("aria-checked") === "true") || items[0];
  select(cur, false, true);
  return {
    get: () => items.find((i) => i.getAttribute("aria-checked") === "true"),
    set: (pred) => { const el = items.find(pred); if (el) select(el, false, true); },
  };
}

// ------------------------------------------------------------ theme
function currentTheme() {
  return document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}
const waves = [];
function syncTheme() {
  const t = currentTheme(), btn = $("#theme-toggle");
  setIcon(btn, t === "dark" ? "sun" : "moon");
  btn.setAttribute("aria-label", t === "dark" ? "Switch to light theme" : "Switch to dark theme");
  $('meta[name="theme-color"]').content = t === "dark" ? "#121c22" : "#eef3f3";
  waves.forEach((w) => w.draw());
}
$("#theme-toggle").addEventListener("click", () => {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("tellwave-theme", next); } catch { /* ignore */ }
  syncTheme();
});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", syncTheme);

// ------------------------------------------------------------ tabs
const tabs = $$('[role="tab"]');
function selectTab(name, focus = false) {
  tabs.forEach((t) => {
    const on = t.dataset.tab === name;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    $("#" + t.getAttribute("aria-controls")).hidden = !on;
    if (on && focus) t.focus();
  });
  if (location.hash !== "#" + name) history.replaceState(null, "", "#" + name);
  if (name === "claude") loadStatus();
  requestAnimationFrame(() => waves.forEach((w) => w.resize()));
}
tabs.forEach((t, i) => {
  t.addEventListener("click", () => selectTab(t.dataset.tab));
  t.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    selectTab(tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length].dataset.tab, true);
  });
});

// ------------------------------------------------------------ audio players
let previewAudio = null; // one shared player for voice previews and track previews
function playPreview(src, btn) {
  if (previewAudio && previewAudio.dataset.src === src && !previewAudio.paused) { stopPreview(); return; }
  stopPreview();
  previewAudio = new Audio(src);
  previewAudio.dataset.src = src;
  previewAudio.addEventListener("ended", stopPreview);
  previewAudio.play().catch(() => toast("This file couldn't be played here. Try opening it instead.", "error"));
  if (btn) { setIcon(btn, "stop"); btn.classList.add("playing"); previewAudio._btn = btn; }
}
function stopPreview() {
  if (!previewAudio) return;
  previewAudio.pause();
  const b = previewAudio._btn;
  if (b) { setIcon(b, "play"); b.classList.remove("playing"); }
  previewAudio = null;
}

function bindPlayer(audio, wave) {
  let raf = 0;
  const tick = () => { if (audio.duration) wave.setPlayhead(audio.currentTime / audio.duration); if (!audio.paused) raf = requestAnimationFrame(tick); };
  audio.addEventListener("play", () => { stopPreview(); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); });
  audio.addEventListener("pause", () => cancelAnimationFrame(raf));
  audio.addEventListener("seeked", tick);
  audio.addEventListener("ended", () => wave.setPlayhead(1));
  wave.onSeek = (f) => { if (audio.duration) { audio.currentTime = f * audio.duration; tick(); } };
}

// ------------------------------------------------------------ voices
const voiceList = $("#voice-list");
let selectedVoice = getVoice(store.get("voice", DEFAULT_VOICE)) ? store.get("voice", DEFAULT_VOICE) : DEFAULT_VOICE;
let voiceFilter = "all";
const gradeRank = (g) => "ABCDF".indexOf(g[0]) * 3 + (g.endsWith("+") ? 0 : g.endsWith("-") ? 2 : 1);

function voiceLabel(v) { return `${v.name}, ${v.accent} ${v.gender}`; }

function renderVoices() {
  const q = $("#voice-search").value.trim().toLowerCase();
  const list = VOICES
    .filter((v) => voiceFilter === "all" || (voiceFilter === "british" ? v.accent === "British" : v.gender === voiceFilter))
    .filter((v) => !q || `${v.name} ${v.id} ${v.accent} ${v.gender} ${v.note}`.toLowerCase().includes(q))
    .sort((a, b) => (RECOMMENDED.includes(b.id) - RECOMMENDED.includes(a.id)) || gradeRank(a.grade) - gradeRank(b.grade));
  voiceList.innerHTML = list.map((v) => {
    const on = v.id === selectedVoice;
    return `<div class="voice-card${on ? " selected" : ""}" data-voice="${v.id}">
      <button class="voice-pick" type="button" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}">
        <span class="voice-name">${esc(v.name)}</span>
        <span class="voice-sub">${v.accent} ${v.gender}</span>
        ${v.note ? `<span class="voice-note">${esc(v.note)}</span>` : ""}
      </button>
      <span class="grade grade-${v.grade[0].toLowerCase()}" title="Kokoro quality grade ${v.grade}">${v.grade}</span>
      <button class="icon-btn icon-btn-sm preview-btn" type="button" aria-label="Preview ${esc(v.name)}">${icon("play")}</button>
    </div>`;
  }).join("");
  $("#voice-empty").hidden = list.length > 0;
  if (!list.some((v) => v.id === selectedVoice)) {
    const first = $(".voice-pick", voiceList);
    if (first) first.tabIndex = 0;
  }
  revealSelectedVoice();
}

function revealSelectedVoice() {
  const card = $(`.voice-card[data-voice="${selectedVoice}"]`, voiceList);
  if (card && voiceList.scrollWidth > voiceList.clientWidth) voiceList.scrollLeft = card.offsetLeft - voiceList.offsetLeft - 16;
}

function pickVoice(id, focus = false) {
  selectedVoice = id;
  store.set("voice", id);
  $$(".voice-card", voiceList).forEach((c) => {
    const on = c.dataset.voice === id;
    c.classList.toggle("selected", on);
    const b = $(".voice-pick", c);
    b.setAttribute("aria-checked", String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  });
  $("#voice-picked").textContent = voiceLabel(getVoice(id));
  renderSpeakers();
  revealSelectedVoice();
}

voiceList.addEventListener("click", (e) => {
  const card = e.target.closest(".voice-card");
  if (!card) return;
  if (e.target.closest(".preview-btn")) previewVoice(card.dataset.voice, e.target.closest(".preview-btn"));
  else pickVoice(card.dataset.voice);
});
voiceList.addEventListener("keydown", (e) => {
  if (!e.target.classList.contains("voice-pick")) return;
  const picks = $$(".voice-pick", voiceList), i = picks.indexOf(e.target);
  const fwd = e.key === "ArrowDown" || e.key === "ArrowRight", back = e.key === "ArrowUp" || e.key === "ArrowLeft";
  if (!fwd && !back) return;
  e.preventDefault();
  const next = picks[(i + (fwd ? 1 : -1) + picks.length) % picks.length];
  pickVoice(next.closest(".voice-card").dataset.voice, true);
});
$("#voice-search").addEventListener("input", renderVoices);
chipGroup($("#voice-filter"), (el) => { voiceFilter = el.dataset.filter; renderVoices(); });

// ------------------------------------------------------------ voice engine (worker)
let ttsWorker = null, jobSeq = 0;
const jobs = new Map();
function ttsJob(payload, onEvent) {
  if (!ttsWorker) {
    ttsWorker = new Worker(new URL("./tts-worker.js", import.meta.url), { type: "module" });
    ttsWorker.onmessage = (e) => {
      const m = e.data, job = jobs.get(m.id);
      if (!job) return;
      if (m.type === "done") { jobs.delete(m.id); job.resolve(m); }
      else if (m.type === "error") { jobs.delete(m.id); job.reject(new Error(m.message)); }
      else job.onEvent?.(m);
    };
    ttsWorker.onerror = (e) => {
      const err = new Error(e.message || "The voice engine stopped unexpectedly. Reload the page and try again.");
      jobs.forEach((j) => j.reject(err)); jobs.clear(); ttsWorker = null;
    };
  }
  const id = ++jobSeq;
  return new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject, onEvent });
    ttsWorker.postMessage({ type: "speak", id, fake: FAKE_TTS, gpu: $("#use-gpu").checked, ...payload });
  });
}

const previewCache = new Map();
async function previewVoice(id, btn) {
  const v = getVoice(id);
  if (previewCache.has(id)) { playPreview(previewCache.get(id), btn); return; }
  btn.disabled = true;
  btn.classList.add("loading");
  try {
    const done = await ttsJob({ text: `Hi, I'm ${v.name}. This is how I sound reading your script.`, voice: id, speed: 1 }, (m) => {
      if (m.type === "loading") btn.title = `Downloading the voice model, ${m.pct}%`;
    });
    const url = URL.createObjectURL(new Blob([done.wav], { type: "audio/wav" }));
    previewCache.set(id, url);
    markModelReady();
    playPreview(url, btn);
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.classList.remove("loading");
    btn.removeAttribute("title");
  }
}

function markModelReady() {
  store.set("model-ready", true);
  $("#model-notice").hidden = true;
}

// ------------------------------------------------------------ script
const scriptEl = $("#script");
const speedEl = $("#speed");
let speakerChoice = store.get("speakers", {});

function scriptState() {
  const text = scriptEl.value;
  const cleaned = cleanText(text);
  const segments = parseScript(text);
  return { text, cleaned, segments, speakers: speakersUsed(segments) };
}

function updateScriptMeta() {
  const { cleaned } = scriptState();
  const chars = cleaned.length;
  $("#char-count").textContent = `${chars.toLocaleString()} character${chars === 1 ? "" : "s"}`;
  const words = wordCount(cleaned);
  $("#word-count").textContent = `${words.toLocaleString()} word${words === 1 ? "" : "s"}`;
  $("#est-length").textContent = `about ${formatDuration(estimateSeconds(cleaned, Number(speedEl.value)))}`;
  const over = chars > MAX_SCRIPT_CHARS;
  const err = $("#script-error");
  err.hidden = !over;
  if (over) err.textContent = `That's ${chars.toLocaleString()} characters. A voiceover can be up to ${MAX_SCRIPT_CHARS.toLocaleString()}, so split it into parts.`;
  scriptEl.setAttribute("aria-invalid", String(over));
  renderSpeakers();
}

function renderSpeakers() {
  const { speakers } = scriptState();
  const others = speakers.filter((s) => s > 1);
  const card = $("#speakers-card");
  card.hidden = others.length === 0;
  if (card.hidden) return;
  const auto = speakerVoices(selectedVoice, speakerChoice);
  const grid = $("#speaker-grid");
  const key = others.join(",") + "|" + selectedVoice;
  if (grid.dataset.key === key) return;
  grid.dataset.key = key;
  grid.innerHTML = others.map((s) => `<label class="speaker-field"><span>Speaker ${s}</span>
    <select data-speaker="${s}">${VOICES.map((v) => `<option value="${v.id}"${v.id === auto[s] ? " selected" : ""}>${esc(v.name)}, ${v.accent} ${v.gender} (${v.grade})</option>`).join("")}</select></label>`).join("");
}
$("#speaker-grid").addEventListener("change", (e) => {
  const s = e.target.dataset.speaker;
  if (!s) return;
  speakerChoice[s] = e.target.value;
  store.set("speakers", speakerChoice);
});

let draftTimer = 0;
scriptEl.addEventListener("input", () => {
  updateScriptMeta();
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => store.set("script", scriptEl.value), 400);
});
$("#script-file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 400_000) { toast("That file is too big for one voiceover. Use a shorter part.", "error"); return; }
  scriptEl.value = await file.text();
  scriptEl.dispatchEvent(new Event("input"));
  toast(`Loaded ${file.name}`);
  e.target.value = "";
});
speedEl.addEventListener("input", () => {
  $("#speed-out").textContent = `${Number(speedEl.value).toFixed(2).replace(/0$/, "")}×`;
  speedEl.setAttribute("aria-valuetext", `${speedEl.value} times speed`);
  store.set("speed", Number(speedEl.value));
  updateScriptMeta();
});
if ("gpu" in navigator) {
  $("#gpu-field").hidden = false;
  $("#use-gpu").checked = !!store.get("gpu", false);
  $("#use-gpu").addEventListener("change", (e) => store.set("gpu", e.target.checked));
}

// ------------------------------------------------------------ make a voiceover
const voiceWave = new Waveform($("#voice-wave"), { tone: "accent" });
waves.push(voiceWave);
bindPlayer($("#voice-audio"), voiceWave);
let lastVoice = null;

$("#make-voice").addEventListener("click", async () => {
  const st = scriptState();
  if (!st.cleaned) { toast("Write or paste a script first.", "error"); scriptEl.focus(); return; }
  if (st.cleaned.length > MAX_SCRIPT_CHARS) { toast("The script is too long for one voiceover. Split it into parts.", "error"); scriptEl.focus(); return; }
  const btn = $("#make-voice");
  setBusy(btn, true, "Making voiceover…");
  const out = $("#voice-output");
  out.hidden = false;
  $("#voice-output-title").textContent = "Making your voiceover";
  $("#voice-audio").hidden = true;
  $("#voice-actions").hidden = true;
  $("#voice-meta").textContent = "";
  const status = $("#voice-status");
  status.textContent = "Starting the voice engine";
  const speed = Number(speedEl.value);
  voiceWave.setRendering(estimateSeconds(st.cleaned, speed));
  setProgress($("#voice-progress"), 0);
  out.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
  try {
    const speakers = {};
    for (const s of st.speakers.filter((x) => x > 1)) speakers[s] = speakerVoices(selectedVoice, speakerChoice)[s];
    const done = await ttsJob({ text: st.text, voice: selectedVoice, speed, speakers }, (m) => {
      if (m.type === "loading") { status.textContent = `Downloading the voice model, ${m.pct}%${m.mb ? ` of ${m.mb} MB` : ""}`; setProgress($("#voice-progress"), m.pct / 100 * 0.3); }
      if (m.type === "started") status.textContent = "Speaking";
      if (m.type === "chunk") {
        status.textContent = `Speaking part ${m.index + 1} of ${m.total}`;
        voiceWave.pushLive(m.peaks, m.seconds);
        setProgress($("#voice-progress"), 0.3 + 0.7 * ((m.index + 1) / m.total));
      }
    });
    markModelReady();
    const blob = new Blob([done.wav], { type: "audio/wav" });
    if (lastVoice?.url) URL.revokeObjectURL(lastVoice.url);
    const url = URL.createObjectURL(blob);
    const title = st.cleaned.replace(/^speaker\s*\d\s*:\s*/i, "").split(/\s+/).slice(0, 7).join(" ");
    lastVoice = { url, blob, seconds: done.seconds, title, voice: selectedVoice, speed, preview: st.cleaned.slice(0, 160) };
    const audio = $("#voice-audio");
    audio.src = url;
    audio.hidden = false;
    const dec = decodeWav(done.wav);
    voiceWave.setPeaks(wavPeaks(dec.channels, 900));
    $("#voice-output-title").textContent = "Your voiceover";
    status.textContent = "";
    $("#voice-meta").innerHTML = `<span>${formatDuration(done.seconds)} long</span><span>${esc(voiceLabel(getVoice(selectedVoice)))}</span><span>Made in ${Math.max(1, Math.round(done.ms / 1000))} s</span>`;
    const dl = $("#voice-download");
    dl.href = url;
    dl.download = `tellwave-voiceover-${slug(title)}.wav`;
    $("#voice-actions").hidden = false;
    $("#voice-save").disabled = false;
    setProgress($("#voice-progress"), null);
  } catch (err) {
    status.textContent = "";
    $("#voice-output-title").textContent = "The voiceover didn't finish";
    $("#voice-meta").textContent = err.message;
    setProgress($("#voice-progress"), null);
    toast(err.message, "error");
  } finally {
    setBusy(btn, false);
  }
});

$("#voice-save").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  if (!lastVoice) return;
  const v = getVoice(lastVoice.voice);
  await library.addItem({ kind: "voice", title: lastVoice.title || "Voiceover", duration: lastVoice.seconds, size: lastVoice.blob.size, mime: "audio/wav", blob: lastVoice.blob, meta: { voice: lastVoice.voice, voiceName: v?.name, speed: lastVoice.speed, preview: lastVoice.preview } });
  btn.disabled = true;
  toast("Saved to library");
  refreshCount();
});

// ------------------------------------------------------------ music
const moodGrid = $("#mood-grid");
const savedMood = store.get("mood", "ambient");
moodGrid.innerHTML = MOOD_LIST.map((m) => `<button role="radio" class="mood" aria-checked="${m.id === savedMood}" data-value="${m.id}">
  <span class="mood-name">${esc(m.label)}</span><span class="mood-blurb">${esc(m.description)}</span></button>`).join("");
const moodGroup = chipGroup(moodGrid, (el) => store.set("mood", el.dataset.value));
const intensityGroup = chipGroup($("#intensity"), (el) => store.set("intensity", Number(el.dataset.value)));
intensityGroup.set((el) => Number(el.dataset.value) === store.get("intensity", 2));
const lenEl = $("#music-length"), seedEl = $("#music-seed");
lenEl.value = String(store.get("music-length", 60));
seedEl.value = String(store.get("music-seed", 1));
const syncLen = () => {
  $("#music-length-out").textContent = formatDuration(Number(lenEl.value));
  lenEl.setAttribute("aria-valuetext", `${lenEl.value} seconds`);
  store.set("music-length", Number(lenEl.value));
};
lenEl.addEventListener("input", syncLen);
syncLen();
seedEl.addEventListener("change", () => store.set("music-seed", Math.max(0, Math.floor(Number(seedEl.value) || 0))));
$("#music-shuffle").addEventListener("click", () => {
  seedEl.value = String(1 + Math.floor(Math.random() * 999998));
  store.set("music-seed", Number(seedEl.value));
});

const musicWave = new Waveform($("#music-wave"), { tone: "accent2" });
waves.push(musicWave);
bindPlayer($("#music-audio"), musicWave);
let musicWorker = null, lastMusic = null;

$("#make-music").addEventListener("click", () => {
  const btn = $("#make-music");
  const opts = {
    mood: moodGroup.get().dataset.value,
    seconds: Number(lenEl.value),
    intensity: Number(intensityGroup.get().dataset.value),
    seed: Math.max(0, Math.floor(Number(seedEl.value) || 0)),
  };
  setBusy(btn, true, "Composing…");
  const out = $("#music-output");
  out.hidden = false;
  $("#music-output-title").textContent = "Composing your track";
  $("#music-audio").hidden = true;
  $("#music-actions").hidden = true;
  $("#music-meta").textContent = "";
  musicWave.setRendering(opts.seconds);
  setProgress($("#music-progress"), 0.02);
  musicWorker ??= new Worker(new URL("./music-worker.js", import.meta.url), { type: "module" });
  const id = Date.now();
  musicWorker.onmessage = (e) => {
    const m = e.data;
    if (m.id !== id) return;
    if (m.type === "progress") { setProgress($("#music-progress"), m.p); return; }
    setBusy(btn, false);
    setProgress($("#music-progress"), null);
    if (m.type === "error") {
      $("#music-output-title").textContent = "The track didn't finish";
      $("#music-meta").textContent = m.message;
      toast(m.message, "error");
      return;
    }
    const blob = new Blob([m.wav], { type: "audio/wav" });
    if (lastMusic?.url) URL.revokeObjectURL(lastMusic.url);
    const url = URL.createObjectURL(blob);
    lastMusic = { url, blob, info: m.info, seconds: m.seconds };
    const audio = $("#music-audio");
    audio.src = url;
    audio.hidden = false;
    musicWave.setPeaks(m.peaks);
    $("#music-output-title").textContent = m.info.title;
    $("#music-meta").innerHTML = `<span>${formatDuration(m.seconds)} long</span><span>${m.info.bpm} BPM</span><span>Variation ${m.info.seed}</span>`;
    const dl = $("#music-download");
    dl.href = url;
    dl.download = `tellwave-${m.info.mood}-${opts.seconds}s-v${m.info.seed}.wav`;
    $("#music-actions").hidden = false;
    $("#music-save").disabled = false;
  };
  musicWorker.onerror = (e) => {
    setBusy(btn, false);
    setProgress($("#music-progress"), null);
    toast(e.message || "The composer stopped unexpectedly.", "error");
    musicWorker = null;
  };
  musicWorker.postMessage({ id, opts });
});

$("#music-save").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  if (!lastMusic) return;
  const i = lastMusic.info;
  await library.addItem({ kind: "music", title: i.title, duration: lastMusic.seconds, size: lastMusic.blob.size, mime: "audio/wav", blob: lastMusic.blob, meta: { mood: i.mood, bpm: i.bpm, seed: i.seed, intensity: i.intensity } });
  btn.disabled = true;
  toast("Saved to library");
  refreshCount();
});

// ------------------------------------------------------------ free tracks (Openverse)
const kindGroup = chipGroup($("#track-kind"), () => { if ($("#track-q").value.trim()) searchTracks(1); });
const licGroup = chipGroup($("#track-license"), () => { if ($("#track-q").value.trim()) searchTracks(1); });
const results = $("#track-results");
let trackPage = 1;

async function searchTracks(page = 1) {
  const q = $("#track-q").value.trim();
  if (!q) return;
  trackPage = page;
  if (page === 1) results.innerHTML = `<p class="muted small">Searching…</p>`;
  const params = new URLSearchParams({ q, kind: kindGroup.get().dataset.value, license: licGroup.get().dataset.value, page: String(page) });
  try {
    const res = await fetch(`/api/music/search?${params}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "The search didn't work. Try again.");
    const rows = data.results.map((r) => `<div class="track-row">
      <button class="icon-btn play-btn" type="button" data-src="${esc(r.audioUrl)}" aria-label="Play ${esc(r.title)}">${icon("play")}</button>
      <div class="track-info">
        <a class="track-title" href="${esc(r.pageUrl || r.audioUrl)}" target="_blank" rel="noopener">${esc(r.title)}</a>
        <span class="track-sub">${r.creator ? `<span>${esc(r.creator)}</span>` : ""}<span>${r.seconds ? formatDuration(r.seconds) : "length unknown"}</span></span>
        <span class="badge ${r.creditNeeded ? "badge-credit" : "badge-free"}">${r.creditNeeded ? "Credit needed" : "No credit needed"}</span>
      </div>
      <div class="track-actions">
        <a class="btn btn-ghost btn-sm" href="${esc(r.audioUrl)}" target="_blank" rel="noopener" download>${icon("download")}Get file</a>
        ${r.creditNeeded ? `<button class="btn btn-ghost btn-sm" type="button" data-credit="${esc(r.credit)}">${icon("copy")}Copy credit</button>` : ""}
      </div>
    </div>`).join("");
    const more = data.page < data.pages ? `<button class="btn btn-secondary btn-sm more-btn" type="button">More results</button>` : "";
    if (page === 1) results.innerHTML = rows ? `<p class="muted small">${data.total.toLocaleString()} free results</p>${rows}${more}` : `<p class="empty">No tracks matched. Try fewer or broader words, or compose one instead.</p>`;
    else { results.querySelector(".more-btn")?.remove(); results.insertAdjacentHTML("beforeend", rows + more); }
  } catch (err) {
    if (page === 1) results.innerHTML = `<p class="field-error">${esc(err.message)}</p>`;
    else toast(err.message, "error");
  }
}
$("#track-form").addEventListener("submit", (e) => { e.preventDefault(); searchTracks(1); });
results.addEventListener("click", (e) => {
  const play = e.target.closest(".play-btn");
  if (play) { playPreview(play.dataset.src, play); return; }
  const credit = e.target.closest("[data-credit]");
  if (credit) { copyText(credit.dataset.credit, credit); return; }
  if (e.target.closest(".more-btn")) searchTracks(trackPage + 1);
});

// ------------------------------------------------------------ library
const libDialog = $("#library-dialog"), confirmDialog = $("#confirm-dialog");
let libUrls = [];

async function refreshCount() {
  const n = await library.countItems();
  const badge = $("#library-count");
  badge.hidden = n === 0;
  badge.textContent = String(n);
  $("#open-library").setAttribute("aria-label", n ? `Library, ${n} saved` : "Library");
}

async function renderLibrary() {
  libUrls.forEach((u) => URL.revokeObjectURL(u));
  libUrls = [];
  const q = $("#library-search").value.trim().toLowerCase();
  const items = (await library.listItems()).filter((it) => !q || `${it.title} ${it.meta?.voiceName ?? ""} ${it.meta?.mood ?? ""} ${it.meta?.preview ?? ""}`.toLowerCase().includes(q));
  const list = $("#library-list");
  list.innerHTML = items.map((it) => {
    const url = URL.createObjectURL(it.blob);
    libUrls.push(url);
    const when = new Date(it.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" });
    const sub = it.kind === "voice" ? (it.meta?.voiceName ? `Voice ${it.meta.voiceName}` : "Voiceover") : `Music, ${it.meta?.bpm ?? "?"} BPM`;
    return `<div class="lib-row" data-id="${it.id}">
      <button class="icon-btn play-btn" type="button" data-src="${url}" aria-label="Play ${esc(it.title)}">${icon("play")}</button>
      <div class="lib-info"><span class="lib-title">${icon(it.kind === "voice" ? "mic" : "note", "icon icon-xs")}${esc(it.title)}</span>
        <span class="lib-sub"><span>${formatDuration(it.duration)}</span><span>${esc(sub)}</span><span>${when}</span></span></div>
      <a class="icon-btn" href="${url}" download="tellwave-${it.kind}-${slug(it.title)}.wav" aria-label="Download ${esc(it.title)}">${icon("download")}</a>
      <button class="icon-btn danger" type="button" data-delete="${it.id}" data-title="${esc(it.title)}" aria-label="Delete ${esc(it.title)}">${icon("trash")}</button>
    </div>`;
  }).join("");
  $("#library-empty").hidden = items.length > 0;
  if (!items.length && q) $("#library-empty").textContent = "Nothing in the library matches that search.";
  else $("#library-empty").textContent = "Nothing saved yet. Make a voiceover or a track, then choose Save to library.";
}

let libOpener = null;
$("#open-library").addEventListener("click", async (e) => {
  libOpener = e.currentTarget;
  await renderLibrary();
  libDialog.showModal();
});
$("#library-search").addEventListener("input", renderLibrary);
$("#library-list").addEventListener("click", (e) => {
  const play = e.target.closest(".play-btn");
  if (play) { playPreview(play.dataset.src, play); return; }
  const del = e.target.closest("[data-delete]");
  if (del) {
    $("#confirm-title").textContent = `Delete “${del.dataset.title}”?`;
    confirmDialog.dataset.id = del.dataset.delete;
    confirmDialog.showModal();
  }
});
$("#confirm-yes").addEventListener("click", async () => {
  await library.deleteItem(confirmDialog.dataset.id);
  confirmDialog.close();
  stopPreview();
  await renderLibrary();
  refreshCount();
  toast("Deleted");
});
$$("dialog [data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));
[libDialog, confirmDialog].forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));
libDialog.addEventListener("close", () => { stopPreview(); libOpener?.focus(); });
confirmDialog.addEventListener("close", () => $("#library-list [data-delete]")?.focus());

// ------------------------------------------------------------ Claude connection
let statusLoaded = false;
async function loadStatus() {
  if (statusLoaded) return;
  const pill = $("#mcp-status");
  try {
    const s = await (await fetch("/api/status")).json();
    statusLoaded = true;
    pill.textContent = s.mcp ? "Connection ready" : "Not set up yet";
    pill.className = `pill ${s.mcp ? "pill-ok" : "pill-warn"}`;
  } catch {
    pill.textContent = "Couldn't check";
    pill.className = "pill pill-warn";
  }
}
function setKey(key) {
  $("#mcp-url").value = `${location.origin}/mcp/${key || "your-secret-key"}`;
}
setKey("");
$("#make-key").addEventListener("click", () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const key = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  $("#key-value").value = key;
  $("#key-field").hidden = false;
  setKey(key);
});
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-copy]");
  if (b) copyText($("#" + b.dataset.copy).value, b);
});
$("#check-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const key = $("#check-key").value.trim();
  const out = $("#check-result");
  out.className = "small";
  out.textContent = "Checking…";
  try {
    const call = (body) => fetch(`/mcp/${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) });
    const res = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "tellwave-check", version: "1" } } });
    if (res.status === 404) throw new Error("That key doesn't match MCP_SECRET in Vercel. Check the value, then redeploy.");
    if (res.status === 503) throw new Error("MCP_SECRET isn't set in Vercel yet (it needs at least 16 characters). Add it and redeploy.");
    if (!res.ok) throw new Error(`The server answered with an error (${res.status}).`);
    const tools = await (await call({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
    out.className = "small ok-text";
    out.textContent = `Connected. Claude will see ${tools.result.tools.length} tools. The connector address in step 3 now uses this key.`;
    setKey(key);
  } catch (err) {
    out.className = "small field-error";
    out.textContent = err.message;
  }
});

// ------------------------------------------------------------ start
hydrateIcons();
syncTheme();
renderVoices();
pickVoice(selectedVoice);
scriptEl.value = store.get("script", "");
speedEl.value = String(store.get("speed", 1));
speedEl.dispatchEvent(new Event("input"));
updateScriptMeta();
if (store.get("model-ready", false)) $("#model-notice").hidden = true;
refreshCount();
selectTab(["voice", "music", "claude"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "voice");
