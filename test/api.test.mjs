// End-to-end tests of the server: the router, MCP protocol, signed renders and the
// Openverse proxy, through the local Vercel stand-in. Voice uses the fake engine.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startMockOpenverse, rpc } from "./helpers.mjs";

const SECRET = "test-secret-0123456789";
let base, server, mock;

before(async () => {
  mock = await startMockOpenverse();
  process.env.MCP_SECRET = SECRET;
  process.env.TELLWAVE_FAKE_TTS = "1";
  process.env.OPENVERSE_API_BASE = mock.base;
  const { startServer } = await import("../dev/server.mjs");
  server = await startServer(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); mock?.server.close(); });

const MCP = `/mcp/${SECRET}`;
const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } };
const call = (id, name, args) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

test("static site is served with isolation headers", async () => {
  const res = await fetch(base + "/");
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Tellwave/);
  assert.equal(res.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(res.headers.get("cross-origin-embedder-policy"), "credentialless");
  const js = await fetch(base + "/js/shared/music.js");
  assert.match(js.headers.get("content-type"), /javascript/);
});

test("status and voices", async () => {
  const s = await (await fetch(base + "/api/status")).json();
  assert.equal(s.mcp, true);
  assert.equal(s.voices, 28);
  const v = await (await fetch(base + "/api/voices")).json();
  assert.equal(v.voices.length, 28);
  assert.equal((await fetch(base + "/api/nope")).status, 404);
});

test("MCP: wrong key is a 404, initialize negotiates the version", async () => {
  assert.equal((await rpc(base, "/mcp/wrong-key-wrong-key", init)).status, 404);
  assert.equal((await rpc(base, "/mcp", init)).status, 404);
  const r = await rpc(base, MCP, init);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /application\/json/);
  assert.equal(r.json.result.protocolVersion, "2025-06-18");
  assert.equal(r.json.result.serverInfo.name, "tellwave");
  assert.ok(r.json.result.capabilities.tools);
  assert.match(r.json.result.instructions, /download link/);
  const future = await rpc(base, MCP, { ...init, params: { ...init.params, protocolVersion: "2099-01-01" } });
  assert.equal(future.json.result.protocolVersion, "2025-11-25");
});

test("MCP: the secret also works as a bearer header on /mcp", async () => {
  const ok = await rpc(base, "/mcp", init, { authorization: `Bearer ${SECRET}` });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.result.serverInfo.name, "tellwave");
  assert.equal((await rpc(base, "/mcp", init, { authorization: "Bearer nope-nope-nope-nope" })).status, 404);
});

test("MCP: notifications get 202, GET gets 405, bad JSON gets 400, ping works", async () => {
  const n = await rpc(base, MCP, { jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(n.status, 202);
  assert.equal(n.text, "");
  const g = await fetch(base + MCP, { headers: { accept: "text/event-stream" } });
  assert.equal(g.status, 405);
  const gh = await fetch(base + MCP, { headers: { accept: "text/html" } });
  assert.equal(gh.status, 405);
  assert.match(await gh.text(), /connector link/);
  assert.equal((await rpc(base, MCP, "{not json")).status, 400);
  assert.deepEqual((await rpc(base, MCP, { jsonrpc: "2.0", id: 9, method: "ping" })).json, { jsonrpc: "2.0", id: 9, result: {} });
  assert.equal((await rpc(base, MCP, { jsonrpc: "2.0", id: 10, method: "nope/nope" })).json.error.code, -32601);
  assert.equal((await rpc(base, MCP, init, { "mcp-protocol-version": "garbage" })).status, 400);
  assert.equal((await rpc(base, MCP, { jsonrpc: "2.0", id: 3, method: "ping" }, { "mcp-protocol-version": "2025-06-18" })).status, 200);
});

test("MCP: origin check allows Claude and blocks strangers", async () => {
  assert.equal((await rpc(base, MCP, init, { origin: "https://claude.ai" })).status, 200);
  assert.equal((await rpc(base, MCP, init, { origin: "https://evil.example" })).status, 403);
});

test("MCP: batch requests return an array", async () => {
  const r = await rpc(base, MCP, [init, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 2, method: "tools/list" }]);
  assert.equal(r.status, 200);
  assert.equal(r.json.length, 2);
});

test("MCP: tools/list has four tools with schemas", async () => {
  const r = await rpc(base, MCP, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const names = r.json.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["compose_music", "generate_voiceover", "list_voices", "search_music"]);
  for (const t of r.json.result.tools) {
    assert.equal(t.inputSchema.type, "object");
    assert.ok(t.description.length > 30);
  }
});

test("MCP: list_voices filters", async () => {
  const r = await rpc(base, MCP, call(3, "list_voices", { accent: "british", gender: "male" }));
  const text = r.json.result.content[0].text;
  assert.match(text, /^4 voices/);
  assert.match(text, /bm_george/);
  assert.doesNotMatch(text, /af_heart/);
});

test("MCP: compose_music returns a signed link that renders a real WAV", async () => {
  const r = await rpc(base, MCP, call(4, "compose_music", { mood: "suspense", seconds: 8, seed: 21 }));
  assert.equal(r.json.result.isError, undefined);
  const text = r.json.result.content[0].text;
  const url = /(http\S+\/api\/render\?\S+)/.exec(text)[1];
  assert.ok(url.startsWith(base));
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "audio/wav");
  assert.match(res.headers.get("cache-control"), /immutable/);
  const buf = new Uint8Array(await res.arrayBuffer());
  assert.equal(String.fromCharCode(...buf.slice(0, 4)), "RIFF");
  assert.equal(buf.length, 44 + 8 * 44100 * 4);
  // same link, same bytes
  const again = new Uint8Array(await (await fetch(url)).arrayBuffer());
  assert.deepEqual(again.slice(0, 5000), buf.slice(0, 5000));
  // HEAD does not render
  assert.equal((await fetch(url, { method: "HEAD" })).status, 200);
  // tampered link is refused
  assert.equal((await fetch(url.replace(/s=[^&]+/, "s=AAAAAAAAAAAAAAAAAAAAAA"))).status, 403);
});

test("MCP: generate_voiceover returns a link that renders speech (fake engine)", async () => {
  const r = await rpc(base, MCP, call(5, "generate_voiceover", { text: "Speaker 1: The door creaked open.\nSpeaker 2: Who's there?", voice: "am_fenrir", speed: 0.9, speakers: { 2: "bf_emma" } }));
  const text = r.json.result.content[0].text;
  assert.match(text, /Voice: Fenrir/);
  assert.match(text, /Speakers: 1 = am_fenrir, 2 = bf_emma/);
  const url = /(http\S+\/api\/render\?\S+)/.exec(text)[1];
  const res = await fetch(url);
  assert.equal(res.status, 200);
  const buf = new Uint8Array(await res.arrayBuffer());
  assert.equal(String.fromCharCode(...buf.slice(8, 12)), "WAVE");
  assert.ok(buf.length > 44 + 24000 * 2, "audio too short");
});

test("MCP: with a Blob store, voiceover links are short and still signed", async () => {
  process.env.TELLWAVE_FAKE_BLOB = "1";
  try {
    const script = "This sentence is long enough to make a long link without storage. ".repeat(36);
    const r = await rpc(base, MCP, call(15, "generate_voiceover", { text: script, voice: "af_heart" }));
    const url = /(http\S+\/r\/\S+)/.exec(r.json.result.content[0].text)[1];
    assert.ok(url.length < 110, `short link is ${url.length} chars`);
    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "audio/wav");
    assert.equal(String.fromCharCode(...new Uint8Array(await res.arrayBuffer()).slice(0, 4)), "RIFF");
    assert.equal((await fetch(url.slice(0, -2) + "zz")).status, 403);
    assert.equal((await fetch(base + "/r/teststore/nothere123.json/AAAAAAAAAAAAAAAA")).status, 403);
  } finally {
    delete process.env.TELLWAVE_FAKE_BLOB;
  }
  // without Blob it falls back to the long signed link
  const r2 = await rpc(base, MCP, call(16, "generate_voiceover", { text: "Short one.", voice: "af_heart" }));
  assert.match(r2.json.result.content[0].text, /\/api\/render\?p=/);
});

test("MCP: tool errors come back as isError results", async () => {
  const long = await rpc(base, MCP, call(6, "generate_voiceover", { text: "x".repeat(2501) }));
  assert.equal(long.json.result.isError, true);
  assert.match(long.json.result.content[0].text, /2500/);
  const voice = await rpc(base, MCP, call(7, "generate_voiceover", { text: "Hi", voice: "darth" }));
  assert.match(voice.json.result.content[0].text, /Unknown voice/);
  const mood = await rpc(base, MCP, call(8, "compose_music", { mood: "polka" }));
  assert.match(mood.json.result.content[0].text, /Unknown mood/);
  const unknown = await rpc(base, MCP, call(9, "make_coffee", {}));
  assert.equal(unknown.json.error.code, -32602);
});

test("MCP: search_music filters licences and builds credit lines", async () => {
  const r = await rpc(base, MCP, call(10, "search_music", { query: "rain", max_results: 5 }));
  const text = r.json.result.content[0].text;
  assert.match(text, /Night Rain/);
  assert.match(text, /no credit needed/);
  assert.match(text, /credit: "Dark Hall" by Composer X/);
  assert.doesNotMatch(text, /Not Allowed/);
  const last = mock.calls.at(-1);
  assert.equal(last.searchParams.get("license"), "cc0,pdm,by");
  assert.equal(last.searchParams.get("category"), "music");
  await rpc(base, MCP, call(11, "search_music", { query: "rain", license: "no_credit", kind: "sound_effect" }));
  assert.equal(mock.calls.at(-1).searchParams.get("license"), "cc0,pdm");
  assert.equal(mock.calls.at(-1).searchParams.get("category"), "sound_effect");
  const none = await rpc(base, MCP, call(12, "search_music", { query: "nothing" }));
  assert.match(none.json.result.content[0].text, /No free-licence results/);
  const busy = await rpc(base, MCP, call(13, "search_music", { query: "busy" }));
  assert.equal(busy.json.result.isError, true);
});

test("website search proxy returns tidy results", async () => {
  const j = await (await fetch(base + "/api/music/search?q=rain&kind=music&license=any")).json();
  assert.equal(j.results.length, 2);
  assert.equal(j.results[0].seconds, 93);
  assert.equal(j.results[1].creditNeeded, true);
  assert.equal((await fetch(base + "/api/music/search?q=")).status, 400);
  assert.equal((await fetch(base + "/api/music/search?q=busy")).status, 429);
});

test("selftest needs the key", async () => {
  assert.equal((await fetch(base + "/api/selftest")).status, 403);
  const ok = await (await fetch(base + "/api/selftest?key=" + SECRET)).json();
  assert.equal(ok.ok, true);
});
