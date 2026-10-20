// One Vercel Function for every API route, so warm instances (with the voice model
// already in memory) get reused. vercel.json rewrites /api/* and /mcp/* here.

import { VOICES, RECOMMENDED } from "../public/js/shared/voices.js";
import { MOOD_LIST, renderTrack } from "../public/js/shared/music.js";
import { encodeWav } from "../public/js/shared/wav.js";
import { renderVoiceover } from "../public/js/shared/voiceover.js";
import { verifyJob, sameSecret } from "../lib/token.mjs";
import { handleMcpHttp, SERVER_INFO } from "../lib/mcp.mjs";
import { searchAudio } from "../lib/openverse.mjs";
import { getEngine } from "../lib/tts-node.mjs";
import { loadShortJob } from "../lib/shortlinks.mjs";

const MIN_SECRET = 16;
const secretFromEnv = () => {
  const s = (process.env.MCP_SECRET || "").trim();
  return s.length >= MIN_SECRET ? s : null;
};

const jsonRes = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

function baseUrlOf(request) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host;
  const proto = request.headers.get("x-forwarded-proto") || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

function allowedOrigins(baseUrl) {
  const extra = (process.env.MCP_ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return [new URL(baseUrl).origin, "https://claude.ai", "https://claude.com", "*.claude.ai", "*.claude.com", ...extra];
}

function streamBytes(bytes, headers) {
  let off = 0;
  const CHUNK = 64 * 1024;
  const body = new ReadableStream({
    pull(controller) {
      if (off >= bytes.length) { controller.close(); return; }
      controller.enqueue(bytes.subarray(off, Math.min(bytes.length, off + CHUNK)));
      off += CHUNK;
    },
  });
  return new Response(body, { status: 200, headers });
}

async function render(request, url, shortPath) {
  const secret = secretFromEnv();
  if (!secret) return new Response("Rendering is switched off until MCP_SECRET is set.", { status: 503 });
  const job = shortPath ? await loadShortJob(secret, shortPath).catch(() => null) : verifyJob(secret, url.searchParams.get("p"), url.searchParams.get("s"));
  if (!job) return new Response("This link is not valid. Ask Claude for a new one.", { status: 403 });
  const fallbackName = job.k === "v" ? "tellwave-voiceover.wav" : `tellwave-${job.mood || "music"}.wav`;
  const name = (url.searchParams.get("name") || fallbackName).replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80);
  const headers = {
    "content-type": "audio/wav",
    "content-disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${name}"`,
    "cache-control": "public, max-age=86400, s-maxage=31536000, immutable",
    "access-control-allow-origin": "*",
  };
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  const started = Date.now();
  try {
    if (job.k === "m") {
      const track = renderTrack({ mood: job.mood, seconds: job.seconds, intensity: job.intensity, seed: job.seed, bpm: job.bpm });
      return streamBytes(encodeWav([track.left, track.right], track.sampleRate), headers);
    }
    if (job.k === "v") {
      const engine = await getEngine();
      const out = await renderVoiceover(engine, job.text, { voice: job.voice, speed: job.speed, speakers: job.speakers, deadline: started + 270_000 });
      return streamBytes(encodeWav([out.pcm], out.sampleRate), headers);
    }
    return new Response("Unknown job type.", { status: 400 });
  } catch (err) {
    console.error("render failed", err);
    return new Response(`Rendering failed: ${err?.message || err}`, { status: 500, headers: { "cache-control": "no-store" } });
  }
}

async function selftest(url) {
  const secret = secretFromEnv();
  if (!secret || !sameSecret(url.searchParams.get("key") || "", secret)) return jsonRes({ error: "Add ?key=<your MCP_SECRET>" }, 403);
  const t0 = Date.now();
  try {
    const engine = await getEngine();
    const t1 = Date.now();
    const out = await renderVoiceover(engine, "Tellwave is ready. This is a short test.", { voice: "af_heart" });
    const t2 = Date.now();
    return jsonRes({ ok: true, loadMs: t1 - t0, speakMs: t2 - t1, seconds: +out.seconds.toFixed(2), sampleRate: out.sampleRate, node: process.version, memoryMb: Math.round(process.memoryUsage().rss / 1e6) }, 200, { "cache-control": "no-store" });
  } catch (err) {
    return jsonRes({ ok: false, error: String(err?.stack || err).slice(0, 4000), node: process.version }, 500, { "cache-control": "no-store" });
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = (url.searchParams.get("__p") || url.pathname).replace(/\/+$/, "") || "/";
    url.searchParams.delete("__p");

    try {
      const mcp = /^\/mcp(?:\/([^/]+))?$/.exec(path);
      if (mcp) {
        const secret = secretFromEnv();
        if (!secret) return jsonRes({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Tellwave's Claude connection is not set up yet: add an MCP_SECRET environment variable (16+ characters) in Vercel and redeploy." } }, 503);
        const bearer = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
        const given = mcp[1] ? decodeURIComponent(mcp[1]) : bearer;
        if (request.method !== "OPTIONS" && (!given || !sameSecret(given, secret))) return new Response("Not found", { status: 404 });
        const baseUrl = baseUrlOf(request);
        return await handleMcpHttp(request, { secret, baseUrl, allowedOrigins: allowedOrigins(baseUrl) });
      }

      if (path === "/api/render" && (request.method === "GET" || request.method === "HEAD")) return await render(request, url);
      if (path.startsWith("/r/") && (request.method === "GET" || request.method === "HEAD")) return await render(request, url, path);

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "content-type" } });
      }
      if (request.method !== "GET") return jsonRes({ error: "Method not allowed" }, 405, { allow: "GET" });

      if (path === "/api/status") {
        return jsonRes({ app: SERVER_INFO.title, version: SERVER_INFO.version, mcp: Boolean(secretFromEnv()), openverseToken: Boolean(process.env.OPENVERSE_CLIENT_ID && process.env.OPENVERSE_CLIENT_SECRET), voices: VOICES.length, moods: MOOD_LIST.length }, 200, { "cache-control": "no-store" });
      }
      if (path === "/api/voices") return jsonRes({ voices: VOICES, recommended: RECOMMENDED }, 200, { "cache-control": "public, s-maxage=86400" });
      if (path === "/api/moods") return jsonRes({ moods: MOOD_LIST }, 200, { "cache-control": "public, s-maxage=86400" });
      if (path === "/api/music/search") {
        try {
          const found = await searchAudio({
            q: url.searchParams.get("q"), kind: url.searchParams.get("kind") === "sfx" ? "sfx" : "music",
            license: url.searchParams.get("license") === "cc0" ? "cc0" : "any", length: url.searchParams.get("length") || undefined,
            page: url.searchParams.get("page") || 1, pageSize: 12,
          });
          return jsonRes(found, 200, { "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" });
        } catch (err) {
          return jsonRes({ error: err.message }, err.status || 502, { "cache-control": "no-store" });
        }
      }
      if (path === "/api/selftest") return await selftest(url);
      return jsonRes({ error: "Not found" }, 404);
    } catch (err) {
      console.error(err);
      return jsonRes({ error: "Something went wrong on the server." }, 500);
    }
  },
};
