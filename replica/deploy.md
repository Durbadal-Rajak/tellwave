# Deploy checklist: Tellwave

Date: 2026-10-20  Commit: see `git log -1`  Go from user: the owner deploys it themselves on Vercel

## Preflight

- [x] e2e suite green: 34 / 34 checks on phone (390×844) and 34 / 34 on desktop (1440×900)
- [x] unit + API tests: 28 / 28
- [x] no open S1 or S2 bugs (B01-B06 fixed, see bugs.md)
- [~] parity: must-haves 7 / 8, feature score 96.7. The open one (Kokoro speaking for
      real) can only be checked on the deployed site; see "First run" below
- [x] rebrand sweep clean (`sweep.py . --config replica/brand.json`, exit 0)
- [x] store listing: not applicable (website only)
- [x] production build: no build step; every file passes `node --check`; `vercel.json` valid JSON
- [x] privacy: processors listed in README (no accounts, no tracking, so no policy page or cookie banner needed for a personal tool)
- [x] account deletion: not applicable (no accounts)
- [x] favicon and title are Tellwave's own; no OG image yet

## Production

- [ ] `MCP_SECRET` set in Vercel (Project → Settings → Environment Variables), 16+ characters
- [ ] optional: `OPENVERSE_CLIENT_ID`, `OPENVERSE_CLIENT_SECRET`, `PUBLIC_BASE_URL`
- [x] no database, payments, OAuth or email to configure

## Domain

- [x] `<project>.vercel.app` works out of the box with HTTPS
- [ ] optional custom domain: add it in Vercel → Domains and set the A / CNAME records Vercel shows

## First run (do these once it is live)

- [ ] website: make a 2-sentence voiceover (first run downloads ~90 MB), compose a track, search "rain"
- [ ] server voice: `/api/selftest?key=<MCP_SECRET>` returns `"ok": true`
- [ ] Claude: add the custom connector, run each of the four tools once
- [ ] then mark "Generate speech" and "MCP tool: generate voiceover" as `yes` in features.csv

## Watch

- Vercel → Usage: Active CPU (4 h / month on Hobby). Only Claude's renders count.
- Vercel → Logs: `api/index` errors (kept 1 hour on Hobby).
