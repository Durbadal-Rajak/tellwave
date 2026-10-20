// Browser end-to-end test (Playwright, Chromium) on a phone and a desktop viewport.
// Run: node test/e2e.mjs [screenshotDir]
// Uses the fake voice engine (?fake-tts) because the Kokoro model can't be downloaded here,
// and a mock Openverse. Everything else is the real app.
import { chromium, devices } from "/opt/npm-tools/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";
import { startMockOpenverse } from "./helpers.mjs";

const SECRET = "e2e-secret-0123456789abc";
const shotDir = process.argv[2] || "replica/clone-screens";
mkdirSync(shotDir, { recursive: true });

const mock = await startMockOpenverse();
process.env.MCP_SECRET = SECRET;
process.env.TELLWAVE_FAKE_TTS = "1";
process.env.OPENVERSE_API_BASE = mock.base;
const { startServer } = await import("../dev/server.mjs");
const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? "  ok  " : "  FAIL"} ${msg}`); if (!cond) failures++; };

async function run(label, contextOpts) {
  console.log(`\n== ${label}`);
  const ctx = await browser.newContext({ ...contextOpts, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (/fonts\.(googleapis|gstatic)|ERR_TUNNEL|ERR_CONNECTION|net::ERR_/.test(m.text())) return; // fonts can't load in this sandbox
    if (/\/mcp\/wrong-key/.test(m.location()?.url || "")) return; // the deliberate wrong-key check
    errors.push(`${m.text()} (${m.location()?.url || "?"})`);
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  const tag = label.split(" ")[0];

  await page.goto(`${base}/?fake-tts=1#voice`);
  await page.waitForSelector(".voice-card");
  check(await page.locator(".voice-card").count() === 28, "28 voice cards");
  check(await page.evaluate(() => crossOriginIsolated), "page is cross-origin isolated (multithreaded WASM)");
  await page.screenshot({ path: `${shotDir}/S01-studio-${tag}.png`, fullPage: false });

  // script + speakers
  await page.fill("#script", "Speaker 1: The lighthouse keeper heard three knocks. Then nothing.\nSpeaker 2: Did you open the door?\nSpeaker 1: I did. Nobody was there.");
  check((await page.textContent("#char-count")).includes("characters"), "character count updates");
  check(await page.isVisible("#speakers-card"), "speaker card appears for a two-voice script");
  await page.selectOption('#speaker-grid select[data-speaker="2"]', "bf_emma");

  // voice filter + pick
  await page.click('#voice-filter [data-filter="british"]');
  check(await page.locator(".voice-card").count() === 8, "British filter shows 8 voices");
  await page.click('.voice-card[data-voice="bm_george"] .voice-pick');
  check((await page.textContent("#voice-picked")).startsWith("George"), "picked George");
  await page.click('#voice-filter [data-filter="all"]');
  await page.fill("#voice-search", "zzz");
  check(await page.isVisible("#voice-empty"), "empty state for a voice search with no match");
  await page.fill("#voice-search", "");

  // preview a voice
  await page.click('.voice-card[data-voice="af_heart"] .preview-btn');
  await page.waitForFunction(() => document.querySelector('.voice-card[data-voice="af_heart"] .preview-btn')?.classList.contains("playing") || document.querySelector('.voice-card[data-voice="af_heart"] .preview-btn')?.disabled === false, null, { timeout: 15000 });
  check(true, "voice preview runs");

  // make the voiceover
  await page.fill("#speed", "1.1");
  await page.dispatchEvent("#speed", "input");
  await page.click("#make-voice");
  await page.waitForSelector("#voice-audio:not([hidden])", { timeout: 30000 });
  check(await page.isVisible("#voice-download"), "voiceover has a download link");
  check((await page.textContent("#voice-meta")).includes("long"), "voiceover meta shows the length");
  const dur = await page.evaluate(() => new Promise((r) => { const a = document.querySelector("#voice-audio"); if (a.duration) r(a.duration); else a.onloadedmetadata = () => r(a.duration); }));
  check(dur > 3 && dur < 20, `voiceover audio plays (${dur.toFixed(1)} s)`);
  await page.screenshot({ path: `${shotDir}/S08-output-${tag}.png`, fullPage: true });
  await page.click("#voice-save");
  await page.waitForSelector("#library-count:not([hidden])");
  check((await page.textContent("#library-count")) === "1", "saved voiceover counts in the library badge");

  // emoji and accents, and a double click only starts one job
  await page.fill("#script", "Café ☕ at midnight. The naïve façade cracked 🎃, and Zoë whispered: «not again».");
  await page.click("#make-voice");
  check(await page.getAttribute("#make-voice", "aria-busy") === "true" && await page.isDisabled("#make-voice"), "button is busy and disabled while working (no double start)");
  await page.waitForFunction(() => document.querySelector("#make-voice").getAttribute("aria-busy") === "false", null, { timeout: 30000 });
  check((await page.textContent("#voice-output-title")) === "Your voiceover", "emoji and accented script renders");

  // keyboard: arrow keys move the voice selection
  await page.focus('.voice-card.selected .voice-pick');
  const before = await page.getAttribute(".voice-card.selected", "data-voice");
  await page.keyboard.press("ArrowDown");
  const after = await page.getAttribute(".voice-card.selected", "data-voice");
  check(before !== after && await page.evaluate(() => document.activeElement.closest(".voice-card")?.classList.contains("selected")), "arrow keys move the voice selection and focus");

  // over-limit script
  await page.fill("#script", "a".repeat(5100));
  check(await page.isVisible("#script-error"), "over-limit script shows an error");
  await page.fill("#script", "");

  // music
  await page.click("#tab-music");
  check(await page.isVisible("#panel-music") && !(await page.isVisible("#panel-voice")), "music tab shows its panel");
  check(await page.locator(".mood").count() === 8, "eight moods");
  await page.click('.mood[data-value="horror"]');
  await page.fill("#music-length", "10");
  await page.dispatchEvent("#music-length", "input");
  check((await page.textContent("#music-length-out")) === "0:10", "length label follows the slider");
  await page.click('#intensity [data-value="3"]');
  await page.click("#make-music");
  await page.waitForSelector("#music-audio:not([hidden])", { timeout: 30000 });
  check((await page.textContent("#music-output-title")).startsWith("Horror in"), "composed a horror track");
  await page.click("#music-save");
  await page.waitForFunction(() => document.querySelector("#library-count").textContent === "2");
  check(true, "saved track counts in the library badge");

  // free tracks (mock Openverse)
  await page.fill("#track-q", "rain");
  await page.click('#track-form button[type="submit"]');
  await page.waitForSelector(".track-row");
  check(await page.locator(".track-row").count() === 2, "two free tracks listed (NC result filtered out)");
  check(await page.locator("[data-credit]").count() === 1, "credit button only on the CC BY track");
  await page.screenshot({ path: `${shotDir}/S12-music-${tag}.png`, fullPage: true });

  // library
  await page.click("#open-library");
  await page.waitForSelector("#library-dialog[open]");
  check(await page.locator(".lib-row").count() === 2, "library lists both items");
  await page.screenshot({ path: `${shotDir}/S09-library-${tag}.png` });
  await page.locator(".lib-row [data-delete]").first().click();
  await page.waitForSelector("#confirm-dialog[open]");
  await page.click("#confirm-yes");
  await page.waitForFunction(() => document.querySelectorAll(".lib-row").length === 1);
  check(true, "delete with confirmation removes an item");
  await page.keyboard.press("Escape");
  check(!(await page.isVisible("#library-dialog")), "Escape closes the library");

  // Claude tab
  await page.click("#tab-claude");
  await page.waitForFunction(() => document.querySelector("#mcp-status").textContent === "Connection ready");
  check(true, "status says the connection is ready");
  await page.click("#make-key");
  const key = await page.inputValue("#key-value");
  check(key.length >= 30 && (await page.inputValue("#mcp-url")).endsWith("/mcp/" + key), "key goes into the connector address");
  await page.fill("#check-key", "wrong-key-wrong-key");
  await page.click('#check-form button[type="submit"]');
  await page.waitForFunction(() => /doesn't match/.test(document.querySelector("#check-result").textContent));
  check(true, "wrong key is reported");
  await page.fill("#check-key", SECRET);
  await page.click('#check-form button[type="submit"]');
  await page.waitForFunction(() => /Connected/.test(document.querySelector("#check-result").textContent));
  check((await page.textContent("#check-result")).includes("4 tools"), "right key connects with 4 tools");
  await page.screenshot({ path: `${shotDir}/S13-claude-${tag}.png`, fullPage: true });

  // keyboard: arrow keys move between tabs
  await page.focus("#tab-claude");
  await page.keyboard.press("ArrowRight");
  check(await page.evaluate(() => document.activeElement.id) === "tab-voice", "arrow keys move between tabs");

  // theme
  await page.click("#theme-toggle");
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  check(theme === "dark" || theme === "light", `theme toggles (${theme})`);
  await page.screenshot({ path: `${shotDir}/S01-studio-${tag}-${theme}.png` });

  // no horizontal scroll on this viewport
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, `no horizontal scrolling (${overflow}px)`);

  check(errors.length === 0, `no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await ctx.close();
}

try {
  await run("phone (390x844)", { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } });
  await run("desktop (1440x900)", { viewport: { width: 1440, height: 900 } });
} finally {
  await browser.close();
  server.close();
  mock.server.close();
}
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
