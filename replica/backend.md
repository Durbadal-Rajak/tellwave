# Backend: Tellwave

No accounts, no database, no payments, no email: the owner asked for no login and
no sign-up. The backend is one Vercel Function (`api/index.mjs`) with four jobs:

| piece | what it does | state |
| --- | --- | --- |
| MCP endpoint `/mcp/<MCP_SECRET>` (or `/mcp` + `Authorization: Bearer <MCP_SECRET>`) | JSON-RPC, stateless Streamable HTTP, JSON responses, 4 tools | done, tested |
| `/api/render` | renders a signed voice or music job, streams WAV, CDN-cacheable | done; voice path tested with a fake engine only |
| server Kokoro (`lib/tts-node.mjs`) | kokoro-js on onnxruntime CPU, model cached per warm instance | written, **not run here** (no package registry or Hugging Face access in this workspace); verify with `/api/selftest?key=<MCP_SECRET>` after deploy |
| `/api/music/search` | Openverse proxy, CC0/PDM/CC BY only, CDN-cached 1 h | done, tested against a mock |
| short links `/r/<store>/<file>/<sig>` | optional: voiceover jobs saved to Vercel Blob so Claude gets a ~90-character link | done; tested with an in-memory stand-in, the real `@vercel/blob` `put()` only runs on Vercel; falls back to the long signed link on any error |

Integrations (official public APIs only):

- Hugging Face Hub: downloads the Kokoro model (`onnx-community/Kokoro-82M-v1.0-ONNX`, Apache-2.0). No key.
- Openverse API: anonymous by default; optional client-credentials token via env vars.
- jsDelivr / esm.sh: serve kokoro-js to the browser. No key.

## Security checklist

- [x] secrets only in env vars (`MCP_SECRET`, optional Openverse keys); `.env*` in `.gitignore`; the server never sends the secret to the browser
- [x] input validated on the server: tool arguments checked (lengths, enums, ranges), search query trimmed to 120 chars, JSON bodies capped at 1 MB, render jobs only accepted with a valid HMAC
- [x] authorisation on every MCP call (constant-time secret compare) and every render (HMAC signature); wrong key and tampered links tested (404 / 403)
- [~] rate limits: none needed for login or email (there are none). The MCP and render routes are gated by the secret. The public search route is CDN-cached; if strangers abuse it, add a Vercel WAF rate-limit rule (Hobby includes 3 custom rules)
- [x] webhooks: none
- [x] uploads: none server-side (the .txt file is read in the browser)
- [~] user data in URLs: a voice render URL carries the script (compressed and signed) so nothing has to be stored. Vercel's request logs (kept 1 hour on Hobby) can therefore contain scripts. Acceptable for a personal tool; switch to Vercel Blob if that matters
- [ ] dependencies audited: run `npm audit` after the first install (not possible in this workspace: no package registry)
- [x] processors listed in README: Vercel (host), Hugging Face (model files), jsDelivr / esm.sh (engine code), Google Fonts, Openverse (search)
