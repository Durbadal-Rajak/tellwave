# Architecture: Tellwave (a rebuild of VibeVoice Studio's core features)

Tellwave is a voiceover and royalty-free music studio that runs free on Vercel, with no
login, plus an MCP endpoint so Claude can make voiceovers and music for videos.

## Stack

| layer | choice | why |
| --- | --- | --- |
| web | Static HTML + vanilla JS modules in `public/` | No build step, nothing to compile on a phone-driven deploy, and every file is testable without a package registry. The original is also a plain HTML/JS page. |
| voice (website) | kokoro-js in a Web Worker, loaded from jsDelivr | Runs on the visitor's device, so the website has no usage limit and costs nothing. Apache-2.0 weights. |
| voice (Claude) | kokoro-js on Node (onnxruntime CPU) inside a Vercel Function | Claude can't run a browser; server-side is the only way to hand Claude a file. Fits 1 vCPU / 2 GB / 300 s. |
| music | Our own synth composer (pure JS), same module in browser and server | Original output, so it is royalty-free with no credit line. No GPU or model needed. |
| music search | Openverse API (CC0 + CC BY, music or sound effects), proxied by our function | Free, no key needed (optional token raises limits); proxy avoids CORS doubts and lets the CDN cache searches. |
| database | None on the server | No accounts. The library lives in each browser (IndexedDB). Claude's files are stateless signed URLs. |
| auth | None for people. MCP behind a secret path `/mcp/<MCP_SECRET>` | The user asked for no login or sign-up. The secret keeps strangers from spending Vercel's free CPU. |
| payments / email | None | Personal tool. |
| jobs | None | Rendering happens inside the request that asks for the file. |
| files | Not stored. Render URLs carry their own signed parameters and are cached by Vercel's CDN | No storage to set up or clean, nothing to expire. |
| hosting | Vercel (Hobby), one function `api/index.mjs` behind rewrites | Vercel's own advice: one shared function so Fluid compute reuses warm instances (warm = model already in memory). |

## Schema

Tables: 0 on the server. Access rules: data-layer checks (secret path + HMAC signature).

Browser storage (IndexedDB `tellwave`, version 1):

```
store "items" (keyPath "id")
  id          string   crypto.randomUUID()
  kind        string   "voice" | "music"
  title       string   first words of the script, or "<mood> · <seconds>s"
  createdAt   number   ms since epoch (UTC)
  duration    number   seconds
  size        number   bytes
  mime        string   "audio/wav"
  blob        Blob     the audio
  meta        object   { voice, speed, textPreview } | { mood, bpm, seed, intensity }
  index "createdAt"
```

Signed render token (`/api/render?p=<payload>&s=<sig>`):

```
payload = base64url( deflateRaw( JSON ) )
  voice: { k:"v", text, voice, speed, speakers? }   text <= 5000 chars
  music: { k:"m", mood, sec, bpm?, intensity?, seed }
sig     = base64url( HMAC-SHA256( key = HMAC(MCP_SECRET, "tellwave-render-v1"), "v1." + payload ) )[0..22]
```

Same parameters always give the same URL and the same audio, so the CDN can cache it
forever (`s-maxage=31536000, immutable`).

## API

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| GET /api/status | app version, whether MCP and Openverse token are configured | anyone | - | JSON | connect page |
| GET /api/voices | voice catalog | anyone | - | JSON | F01 |
| GET /api/music/search | Openverse search, CC0 + CC BY only | anyone (CDN-cached 1 h) | q, kind (music, sfx), license (cc0, any), length, page | JSON results with credit line | search tab |
| GET /api/render | renders a signed voice or music job, streams WAV | holder of a signed URL | p, s | audio/wav (streamed, so no 4.5 MB cap) | Claude flows |
| POST /mcp/:key | MCP JSON-RPC (stateless Streamable HTTP, JSON responses) | holder of the secret | JSON-RPC request or notification | JSON / 202 | Claude |
| GET /mcp/:key | no SSE stream offered | - | - | 405 (help page for browsers) | - |
| OPTIONS * | CORS preflight | anyone | - | 204 | - |

MCP tools: `list_voices`, `generate_voiceover`, `compose_music`, `search_music`.
`generate_voiceover` and `compose_music` return a signed URL immediately (no MCP timeout);
the audio is made when the URL is first opened, then cached.

Webhooks in: none. Webhooks out: none. Jobs: none.

## The parts that bite

- CPU quota: Hobby gives 4 active CPU-hours a month and pauses the project for 30 days if
  it runs out. The website renders on the visitor's device; only Claude's renders use
  Vercel CPU, and repeat downloads come from the CDN cache.
- Duration: 300 s per request on Hobby. Voice text capped at 5000 characters per call;
  Claude is told to split longer scripts.
- Response size: 4.5 MB unless streamed, so render responses are streamed.
- Read-only filesystem: transformers.js cache goes to `/tmp`.
- Native binaries: onnxruntime-node's `.node` file is loaded by a computed path, so it is
  listed in `includeFiles`.
- Cold start: first Claude render downloads the Kokoro model (about 90 MB) from Hugging
  Face; warm instances keep it in memory.
- Kokoro context: about 510 phoneme tokens per pass, so text is split into sentence-sized
  chunks (≤ 300 characters) and joined with controlled pauses.
- Browser model download: about 90 MB once (q8), cached by the browser. Multithreaded WASM
  needs cross-origin isolation: COOP `same-origin` + COEP `credentialless` (Safari falls
  back to one thread).
- Openverse limits: anonymous requests are throttled; searches are CDN-cached and an
  optional client token can be added.
- Licences: only CC0 / public domain and CC BY are returned (no NC, ND or SA), so tracks
  are safe in monetised videos; CC BY needs the credit line we return.
- Secret leakage: the secret is never sent to the browser by the server; render URLs are
  signed with a key derived from it, so sharing a render URL doesn't reveal the secret.

## Build order

1. Vertical slice: S01 studio shell, compose music in the browser, play and download
   (`public/`, composer, WAV encoder). Proves the no-build static stack.
2. Must-haves: Kokoro voice generation in the browser (S02, S05, S07, S08), phone layout,
   `/mcp/:key` with all four tools, `/api/render` for voice and music, server Kokoro.
3. Should-haves: voice search and preview, .txt upload, multi-speaker, speed, library
   (S09, S10), toasts, theme, music controls, Openverse search with credit lines, connect
   page.
4. Could-haves: REST voice list, status check.
5. Fixes from replica-entrepreneur: not run (personal tool, not a product for sale).
