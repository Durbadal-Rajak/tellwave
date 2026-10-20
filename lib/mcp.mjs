// Minimal stateless MCP server (Streamable HTTP, JSON responses, no SSE).
// Tools: list_voices, generate_voiceover, compose_music, search_music.

import { VOICES, RECOMMENDED, resolveVoice, getVoice, DEFAULT_VOICE } from "../public/js/shared/voices.js";
import { MOOD_LIST, normalizeMusicOptions, planTrack, MUSIC_LIMITS } from "../public/js/shared/music.js";
import { estimateSeconds, parseScript, speakersUsed, formatDuration } from "../public/js/shared/script.js";
import { speakerVoices } from "../public/js/shared/voiceover.js";
import { signJob } from "./token.mjs";
import { searchAudio } from "./openverse.mjs";
import { saveShortJob } from "./shortlinks.mjs";

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const SERVER_INFO = { name: "tellwave", title: "Tellwave", version: "1.0.0" };
// Server renders run on one vCPU with a 300 s limit, so Claude's voiceovers are capped
// lower than the website's (which renders on the visitor's device).
export const MCP_MAX_CHARS = 2500;
const MAX_SCRIPT_CHARS = MCP_MAX_CHARS;

const INSTRUCTIONS = [
  "Tellwave makes voiceovers (Kokoro text-to-speech, 28 English voices) and royalty-free background music for videos.",
  "generate_voiceover and compose_music return a download link right away. The audio is made the first time the link is opened (usually 5-60 seconds), then cached. Give the user the link, or download it if you are assembling a video.",
  `Voiceovers: up to ${MAX_SCRIPT_CHARS} characters per call (about 3 minutes of speech); split longer scripts into parts at paragraph breaks and keep the same voice. Use "Speaker 1:" / "Speaker 2:" lines for dialogue.`,
  "Composed music is an original track generated for this request: no licence fee and no credit needed.",
  "search_music finds real recordings under CC0 (no credit needed) or CC BY (the user must include the credit line, for example in the video description).",
].join("\n");

const MOOD_IDS = MOOD_LIST.map((m) => m.id);

const TOOLS = [
  {
    name: "list_voices",
    title: "List voices",
    description: "List the available Kokoro voices with accent, gender and quality grade (A is best). af_heart is the most natural; am_michael and am_fenrir are good male narrators; bm_george and bf_emma are British.",
    inputSchema: {
      type: "object",
      properties: {
        accent: { type: "string", enum: ["american", "british"], description: "Only voices with this accent." },
        gender: { type: "string", enum: ["female", "male"], description: "Only voices of this gender." },
      },
      additionalProperties: false,
    },
    annotations: { title: "List voices", readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "generate_voiceover",
    title: "Generate voiceover",
    description: `Turn a script into a spoken voiceover (WAV, 24 kHz mono). Returns a download link. Max ${MAX_SCRIPT_CHARS} characters per call. For dialogue, start lines with "Speaker 1:", "Speaker 2:" (up to 4) and optionally set voices per speaker.`,
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The words to speak. Plain sentences work best; punctuation controls the pauses." },
        voice: { type: "string", description: `Voice id from list_voices (default ${DEFAULT_VOICE}). Also used for Speaker 1.` },
        speed: { type: "number", minimum: 0.5, maximum: 2, description: "Speaking speed, 1 is normal. 0.9 suits calm narration." },
        speakers: {
          type: "object",
          description: 'Voices for multi-speaker scripts, for example {"2": "bm_george", "3": "af_bella"}.',
          additionalProperties: { type: "string" },
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
    annotations: { title: "Generate voiceover", readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "compose_music",
    title: "Compose music",
    description: `Compose an original royalty-free background track (WAV, 44.1 kHz stereo) in a mood. Returns a download link. No credit needed. Moods: ${MOOD_LIST.map((m) => `${m.id} (${m.description.toLowerCase()})`).join("; ")}.`,
    inputSchema: {
      type: "object",
      properties: {
        mood: { type: "string", enum: MOOD_IDS, description: "Musical mood." },
        seconds: { type: "integer", minimum: MUSIC_LIMITS.minSeconds, maximum: MUSIC_LIMITS.maxSeconds, description: "Length in seconds (default 60). Match the video length." },
        intensity: { type: "integer", minimum: 1, maximum: 3, description: "1 calm, 2 balanced (default), 3 intense." },
        bpm: { type: "integer", minimum: MUSIC_LIMITS.minBpm, maximum: MUSIC_LIMITS.maxBpm, description: "Tempo. Leave out to use the mood's natural tempo." },
        seed: { type: "integer", minimum: 0, description: "Variation number. The same settings and seed always give the same track; change it for a different take." },
      },
      required: ["mood"],
      additionalProperties: false,
    },
    annotations: { title: "Compose music", readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "search_music",
    title: "Search free-licence music",
    description: "Search real music recordings or sound effects that are free to use (CC0 / public domain, or CC BY which needs a credit line). Returns titles, lengths, licences, direct audio links and the credit text.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: 'What to look for, e.g. "dark ambient", "rain thunder", "happy ukulele".' },
        kind: { type: "string", enum: ["music", "sound_effect"], description: "Music (default) or sound effects." },
        license: { type: "string", enum: ["no_credit", "credit_ok"], description: "no_credit = CC0/public domain only. credit_ok (default) also allows CC BY." },
        length: { type: "string", enum: ["short", "medium", "long"], description: "Rough length filter." },
        max_results: { type: "integer", minimum: 1, maximum: 20, description: "How many results (default 8)." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { title: "Search free-licence music", readOnlyHint: true, openWorldHint: true },
  },
];

class ToolError extends Error {}

const text = (s) => ({ content: [{ type: "text", text: s }] });
const json = (o) => JSON.stringify(o);

function renderUrl(baseUrl, secret, job, filename) {
  const { p, s } = signJob(secret, job);
  const q = new URLSearchParams({ p, s });
  if (filename) q.set("name", filename);
  return `${baseUrl}/api/render?${q}`;
}

const slug = (str, max = 40) => String(str).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max) || "audio";

async function callTool(name, args, env) {
  args = args && typeof args === "object" ? args : {};
  if (name === "list_voices") {
    const list = VOICES.filter((v) => (!args.accent || v.accent.toLowerCase() === args.accent) && (!args.gender || v.gender === args.gender));
    const lines = list.map((v) => `${v.id}: ${v.name}, ${v.accent} ${v.gender}, grade ${v.grade}${v.note ? `, ${v.note.toLowerCase()}` : ""}${RECOMMENDED.includes(v.id) ? " (recommended)" : ""}`);
    return text(`${list.length} voices:\n${lines.join("\n")}\n\n${json({ voices: list.map(({ id, accent, gender, grade }) => ({ id, accent, gender, grade })) })}`);
  }

  if (name === "generate_voiceover") {
    const script = String(args.text ?? "").trim();
    if (!script) throw new ToolError("text is empty. Pass the words to speak.");
    if (script.length > MAX_SCRIPT_CHARS) throw new ToolError(`text is ${script.length} characters; the limit is ${MAX_SCRIPT_CHARS} per call. Split it into parts at paragraph breaks and call generate_voiceover for each part with the same voice.`);
    const voice = resolveVoice(args.voice ?? DEFAULT_VOICE);
    if (!voice) throw new ToolError(`Unknown voice "${args.voice}". Call list_voices, or use ${RECOMMENDED.join(", ")}.`);
    const speed = Math.max(0.5, Math.min(2, Number(args.speed ?? 1) || 1));
    const speakers = {};
    for (const [k, v] of Object.entries(args.speakers ?? {})) {
      const id = resolveVoice(v);
      if (!/^[1-4]$/.test(k)) throw new ToolError(`speakers keys must be 1-4, got "${k}".`);
      if (!id) throw new ToolError(`Unknown voice "${v}" for speaker ${k}. Call list_voices.`);
      speakers[k] = id;
    }
    const used = speakersUsed(parseScript(script));
    const voices = speakerVoices(voice, speakers);
    const job = { k: "v", text: script, voice, speed, ...(Object.keys(speakers).length ? { speakers } : {}) };
    let url = null;
    try {
      const short = await saveShortJob(env.secret, job);
      if (short) url = `${env.baseUrl}${short}`;
    } catch (e) {
      console.error("short link failed, using a signed long link", e);
    }
    url ??= renderUrl(env.baseUrl, env.secret, job, `voiceover-${slug(script.slice(0, 40))}.wav`);
    const est = estimateSeconds(script, speed);
    const v = getVoice(voice);
    const cast = used.length > 1 ? `\nSpeakers: ${used.map((s) => `${s} = ${voices[s]}`).join(", ")}` : "";
    return text(
      `Voiceover link (WAV, 24 kHz mono). Give it to the user exactly as written, it is signed:\n${url}\n\n` +
      `Voice: ${v.name} (${voice}, ${v.accent} ${v.gender}), speed ${speed}${cast}\n` +
      `Length: about ${formatDuration(est)} from ${script.length} characters.\n` +
      `The audio is made when the link is first opened (allow up to a minute), then it is cached.\n\n` +
      json({ audio_url: url, format: "wav", sample_rate: 24000, channels: 1, estimated_seconds: Math.round(est), voice, speed, speakers: used.length > 1 ? Object.fromEntries(used.map((s) => [s, voices[s]])) : undefined })
    );
  }

  if (name === "compose_music") {
    let o;
    try {
      o = normalizeMusicOptions({ mood: args.mood, seconds: args.seconds ?? 60, intensity: args.intensity ?? 2, bpm: args.bpm, seed: args.seed ?? Math.floor(Math.random() * 1e6) });
    } catch (e) {
      throw new ToolError(e.message);
    }
    const plan = planTrack(o);
    const job = { k: "m", mood: o.mood, seconds: o.seconds, intensity: o.intensity, seed: o.seed, ...(o.bpm ? { bpm: o.bpm } : {}) };
    const url = renderUrl(env.baseUrl, env.secret, job, `music-${o.mood}-${o.seconds}s-${o.seed}.wav`);
    return text(
      `Music link (WAV, 44.1 kHz stereo):\n${url}\n\n` +
      `${plan.title}, ${Math.round(plan.bpm)} BPM, ${o.seconds} s, intensity ${o.intensity}, variation ${o.seed}.\n` +
      `Licence: original composition made for this request. Free to use in any video, no credit needed.\n` +
      `The audio is made when the link is first opened (usually a few seconds), then cached. For a different take, call again with another seed.\n\n` +
      json({ audio_url: url, format: "wav", sample_rate: 44100, channels: 2, seconds: o.seconds, mood: o.mood, bpm: Math.round(plan.bpm), seed: o.seed, license: "original, no attribution required" })
    );
  }

  if (name === "search_music") {
    const max = Math.max(1, Math.min(20, Number(args.max_results ?? 8) || 8));
    let found;
    try {
      found = await searchAudio({ q: args.query, kind: args.kind === "sound_effect" ? "sfx" : "music", license: args.license === "no_credit" ? "cc0" : "any", length: args.length, pageSize: max });
    } catch (e) {
      throw new ToolError(e.message);
    }
    if (!found.results.length) return text(`No free-licence results for "${args.query}". Try broader words, or use compose_music for an original track.`);
    const lines = found.results.map((r, i) => `${i + 1}. ${r.title}${r.creator ? ` by ${r.creator}` : ""} (${r.seconds ? formatDuration(r.seconds) : "length unknown"}, ${r.license}${r.creditNeeded ? ", credit needed" : ", no credit needed"})\n   audio: ${r.audioUrl}\n   page: ${r.pageUrl ?? "-"}${r.creditNeeded ? `\n   credit: ${r.credit}` : ""}`);
    return text(`${found.results.length} of ${found.total} results for "${args.query}":\n\n${lines.join("\n")}\n\n${json({ results: found.results })}`);
  }

  throw Object.assign(new Error(`Unknown tool: ${name}`), { rpcCode: -32602 });
}

async function handleMessage(msg, env) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") {
    return { jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32600, message: "Invalid Request" } };
  }
  const isRequest = typeof msg.method === "string" && msg.id !== undefined && msg.id !== null;
  if (!isRequest) return null; // notifications and client responses get no reply
  const reply = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: "2.0", id: msg.id, error: { code, message } });
  const params = msg.params ?? {};
  switch (msg.method) {
    case "initialize": {
      const asked = params.protocolVersion;
      const protocolVersion = PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
      return reply({ protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case "ping": return reply({});
    case "tools/list": return reply({ tools: TOOLS });
    case "tools/call": {
      try {
        return reply(await callTool(params.name, params.arguments, env));
      } catch (e) {
        if (e instanceof ToolError) return reply({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
        if (e.rpcCode) return fail(e.rpcCode, e.message);
        return reply({ content: [{ type: "text", text: `Error: ${e.message || "something went wrong"}` }], isError: true });
      }
    }
    case "resources/list": return reply({ resources: [] });
    case "resources/templates/list": return reply({ resourceTemplates: [] });
    case "prompts/list": return reply({ prompts: [] });
    case "logging/setLevel": return reply({});
    case "completion/complete": return reply({ completion: { values: [] } });
    default: return fail(-32601, `Method not found: ${msg.method}`);
  }
}

const VERSION_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Handle one HTTP request to the MCP endpoint. env = { secret, baseUrl, allowedOrigins } */
export async function handleMcpHttp(request, env) {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    "access-control-allow-headers": "content-type, accept, authorization, mcp-protocol-version, mcp-session-id, last-event-id",
    "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const origin = request.headers.get("origin");
  if (origin && !env.allowedOrigins.some((o) => o === origin || (o.startsWith("*.") && new URL(origin).hostname.endsWith(o.slice(1))))) {
    return new Response(json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Origin not allowed" } }), { status: 403, headers: { "content-type": "application/json", ...cors } });
  }

  if (request.method !== "POST") {
    const accept = request.headers.get("accept") || "";
    if (request.method === "GET" && accept.includes("text/html")) {
      return new Response(helpPage(env.baseUrl), { status: 405, headers: { "content-type": "text/html; charset=utf-8", allow: "POST", ...cors } });
    }
    return new Response(null, { status: 405, headers: { allow: "POST", ...cors } });
  }

  const pv = request.headers.get("mcp-protocol-version");
  if (pv && !VERSION_RE.test(pv)) {
    return new Response(json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Bad MCP-Protocol-Version header" } }), { status: 400, headers: { "content-type": "application/json", ...cors } });
  }

  let body;
  try {
    const raw = await request.text();
    if (raw.length > 1_000_000) throw new Error("too large");
    body = JSON.parse(raw);
  } catch {
    return new Response(json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }), { status: 400, headers: { "content-type": "application/json", ...cors } });
  }

  const batch = Array.isArray(body);
  const msgs = batch ? body : [body];
  if (!msgs.length) return new Response(json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Empty batch" } }), { status: 400, headers: { "content-type": "application/json", ...cors } });
  const replies = (await Promise.all(msgs.map((m) => handleMessage(m, env)))).filter(Boolean);
  if (!replies.length) return new Response(null, { status: 202, headers: cors });
  return new Response(json(batch ? replies : replies[0]), { status: 200, headers: { "content-type": "application/json", ...cors } });
}

function helpPage(baseUrl) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tellwave connector</title>
<body style="font-family:system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem;line-height:1.5">
<h1>This is your Tellwave connector link</h1>
<p>It works, but it is meant for Claude, not for a browser. On claude.ai, open Customize, then Connectors. Choose Add, then Add custom connector, paste this page's address, and pick No sign in.</p>
<p><a href="${baseUrl}/#claude">Back to Tellwave</a></p></body>`;
}
