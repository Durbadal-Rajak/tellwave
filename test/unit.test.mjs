import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { encodeWav, decodeWav, peaks } from "../public/js/shared/wav.js";
import { parseScript, chunkText, estimateSeconds, cleanText, speakersUsed, MAX_SCRIPT_CHARS } from "../public/js/shared/script.js";
import { VOICES, resolveVoice, DEFAULT_VOICE } from "../public/js/shared/voices.js";
import { renderTrack, MOOD_LIST, normalizeMusicOptions, planTrack } from "../public/js/shared/music.js";
import { renderVoiceover, planVoiceover, speakerVoices, trimSilence } from "../public/js/shared/voiceover.js";
import { signJob, verifyJob, sameSecret } from "../lib/token.mjs";

const hash = (arr) => createHash("sha1").update(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)).digest("hex");

test("wav round trip keeps samples and format", () => {
  const n = 2400, l = new Float32Array(n), r = new Float32Array(n);
  for (let i = 0; i < n; i++) { l[i] = Math.sin(i / 10) * 0.5; r[i] = -l[i]; }
  const bytes = encodeWav([l, r], 24000);
  assert.equal(bytes.length, 44 + n * 4);
  const d = decodeWav(bytes);
  assert.equal(d.sampleRate, 24000);
  assert.equal(d.channels.length, 2);
  assert.ok(Math.abs(d.channels[0][100] - l[100]) < 2e-4);
  assert.ok(Math.abs(d.channels[1][100] - r[100]) < 2e-4);
  const p = peaks(d.channels, 10);
  assert.equal(p.length, 10);
  assert.ok(p[5] > 0.45 && p[5] <= 0.51);
});

test("wav clamps out-of-range and NaN samples", () => {
  const d = decodeWav(encodeWav([Float32Array.from([2, -2, NaN, 0.25])], 8000));
  assert.ok(d.channels[0][0] > 0.999 && d.channels[0][1] <= -0.999);
  assert.ok(Math.abs(d.channels[0][2]) < 1e-3);
});

test("script: speaker lines, continuation and default speaker", () => {
  const segs = parseScript("Intro line.\nspeaker 2 : Hi there!\nStill two.\n\nSpeaker 3: Third.\nSpeaker 1: Back.");
  assert.deepEqual(segs.map((s) => s.speaker), [1, 2, 3, 1]);
  assert.equal(segs[1].text, "Hi there! Still two.");
  assert.deepEqual(speakersUsed(segs), [1, 2, 3]);
  assert.equal(parseScript("   \n\n  ").length, 0);
  assert.equal(parseScript("Speaker 9: capped")[0].speaker, 4);
});

test("script: cleaning removes markdown and smart quotes", () => {
  assert.equal(cleanText("# Title\n**Bold** “quote” ‘single’ `code`\n- item"), 'Title\nBold "quote" \'single\' code\nitem');
});

test("script: chunks stay short and pauses follow punctuation", () => {
  const long = "word ".repeat(200).trim() + ".";
  const chunks = chunkText(`First sentence. Is this a question? Yes!\n\nNew paragraph here. ${long}`);
  assert.ok(chunks.every((c) => c.text.length <= 281), "chunk too long");
  assert.equal(chunks[0].text, "First sentence.");
  assert.equal(chunks[0].pause, 0.26);
  assert.equal(chunks[1].pause, 0.32);
  assert.equal(chunks[2].pause, 0.65); // end of paragraph
  assert.equal(chunks.at(-1).pause, 0);
  assert.ok(estimateSeconds("a".repeat(145)) > 9 && estimateSeconds("a".repeat(145)) < 11);
  assert.ok(estimateSeconds("a".repeat(145), 2) < 6);
});

test("voices: catalogue and lookup", () => {
  assert.equal(VOICES.length, 28);
  assert.equal(resolveVoice("Heart"), "af_heart");
  assert.equal(resolveVoice("george"), "bm_george");
  assert.equal(resolveVoice("AM_MICHAEL"), "am_michael");
  assert.equal(resolveVoice("nobody"), null);
  const sv = speakerVoices("am_michael", { 3: "bf_emma" });
  assert.equal(sv[1], "am_michael");
  assert.notEqual(sv[2], "am_michael");
  assert.equal(sv[3], "bf_emma");
});

test("signed render jobs verify, and tampering fails", () => {
  const secret = "s3cret-secret-secret";
  const job = { k: "v", text: "Hello there, this is a test of the signing.", voice: "af_heart", speed: 1 };
  const { p, s } = signJob(secret, job);
  assert.deepEqual(verifyJob(secret, p, s), job);
  assert.equal(verifyJob("another-secret-value", p, s), null);
  assert.equal(verifyJob(secret, p, s.slice(0, -1) + (s.at(-1) === "A" ? "B" : "A")), null);
  assert.equal(verifyJob(secret, p.slice(0, -2) + "xx", s), null);
  assert.equal(verifyJob(secret, null, s), null);
  assert.ok(sameSecret("abc", "abc") && !sameSecret("abc", "abd") && !sameSecret("abc", "abcd"));
  // a long script still fits in a URL
  const big = signJob(secret, { ...job, text: "This sentence repeats to fill the script. ".repeat(118) });
  assert.ok(big.p.length < 4000, `payload ${big.p.length} chars`);
});

test("music: every mood renders clean, bounded audio", () => {
  for (const { id } of MOOD_LIST) {
    const t = renderTrack({ mood: id, seconds: 12, seed: 3 }, { sampleRate: 22050 });
    assert.equal(t.left.length, 12 * 22050);
    let peak = 0, sum = 0, bad = 0;
    for (const ch of [t.left, t.right]) for (const x of ch) { if (!Number.isFinite(x)) bad++; peak = Math.max(peak, Math.abs(x)); sum += x * x; }
    assert.equal(bad, 0, `${id} has non-finite samples`);
    assert.ok(peak <= 0.98, `${id} peak ${peak}`);
    assert.ok(Math.sqrt(sum / (2 * t.left.length)) > 0.02, `${id} is too quiet`);
    assert.ok(t.info.title && t.info.bpm > 30);
  }
});

test("music: same seed is identical, another seed differs", () => {
  const a = renderTrack({ mood: "lofi", seconds: 8, seed: 11 }, { sampleRate: 22050 });
  const b = renderTrack({ mood: "lofi", seconds: 8, seed: 11 }, { sampleRate: 22050 });
  const c = renderTrack({ mood: "lofi", seconds: 8, seed: 12 }, { sampleRate: 22050 });
  assert.equal(hash(a.left), hash(b.left));
  assert.notEqual(hash(a.left), hash(c.left));
});

test("music: options are validated and clamped", () => {
  assert.throws(() => normalizeMusicOptions({ mood: "polka" }), /Unknown mood/);
  const o = normalizeMusicOptions({ mood: "Horror", seconds: 9999, intensity: 7, bpm: 500, seed: -5 });
  assert.equal(o.mood, "horror");
  assert.equal(o.seconds, 300);
  assert.equal(o.intensity, 3);
  assert.equal(o.bpm, 180);
  assert.equal(o.seed, 5);
  const plan = planTrack({ mood: "upbeat", seconds: 30, seed: 1 });
  assert.ok(plan.bars >= 4 && plan.sections.length >= 1);
});

test("voiceover: chunks, speaker voices, pauses and normalisation", async () => {
  const seen = [];
  const engine = async (text, voice, speed) => {
    seen.push({ text, voice, speed });
    const sr = 24000, n = Math.round(0.5 * sr), audio = new Float32Array(n + 2400);
    for (let i = 1200; i < n + 1200; i++) audio[i] = 0.2 * Math.sin(i / 7); // silence around speech
    return { audio, sampling_rate: sr };
  };
  const out = await renderVoiceover(engine, "Speaker 1: One. Two.\nSpeaker 2: Three.", { voice: "am_michael", speed: 1.25 });
  assert.equal(out.chunks, 3);
  assert.deepEqual(seen.map((s) => s.voice), ["am_michael", "am_michael", speakerVoices("am_michael")[2]]);
  assert.ok(seen.every((s) => s.speed === 1.25));
  let peak = 0;
  for (const x of out.pcm) peak = Math.max(peak, Math.abs(x));
  assert.ok(peak > 0.79 && peak < 0.9, `peak ${peak}`); // gain is capped at 4x (12 dB)
  // trimmed speech + pauses: 3 x (0.5 s + margins) + two pauses
  assert.ok(out.seconds > 1.6 && out.seconds < 2.3, `seconds ${out.seconds}`);
  await assert.rejects(renderVoiceover(engine, "   ", {}), /empty/);
  assert.equal(trimSilence(new Float32Array(1000)).length, 0);
  const plan = planVoiceover("Speaker 2: hi", { voice: DEFAULT_VOICE, speakers: { 2: "bm_george" } });
  assert.equal(plan.chunks[0].voice, "bm_george");
});

test("limits are what the docs say", () => {
  assert.equal(MAX_SCRIPT_CHARS, 5000);
  assert.equal(MOOD_LIST.length, 8);
});
