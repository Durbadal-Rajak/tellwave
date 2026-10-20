# Test plan: Tellwave

Automated: `npm test` (28 unit + API cases) and `node test/e2e.mjs` (Playwright,
Chromium, phone 390×844 and desktop 1440×900, 34 checks each). Every browser run fails
on console errors and on any 5xx response. The voice engine is faked in tests (a tone
per sentence) because the Kokoro model can't be downloaded in this workspace; the
music composer, library, search UI, MCP server and render pipeline are the real code.

Legend: ✅ automated and passing · 🟡 manual, after deploy · ⛔ not possible here

## F01 Make a voiceover

| ID | case | how | result |
| --- | --- | --- | --- |
| F01-H1 | type a script, pick a voice, make it, play, download | e2e | ✅ |
| F01-H2 | Kokoro really speaks in the browser (WASM q8 download, then speech) | open the live site | 🟡 |
| F01-E1 | empty script | toast + focus back to the script | ✅ (code path) |
| F01-E2 | over 5,000 characters | inline error, button refuses | ✅ |
| F01-E3 | emoji and accents | e2e | ✅ |
| F01-E4 | double click on Make voiceover | button busy and disabled | ✅ |
| F01-E5 | refresh mid-render | worker restarts; draft script is kept | 🟡 |
| F01-E6 | offline / CDN blocked | readable error ("couldn't be downloaded…") | 🟡 |
| F01-E7 | phone width | no sideways page scroll; voices scroll sideways | ✅ |
| F01-E8 | keyboard only | tabs and voice radios move with arrow keys | ✅ |
| F01-E9 | WebGPU toggle on a GPU device, falls back to WASM on failure | live site, desktop Chrome | 🟡 |

## F04 Load a .txt script

| F04-H1 | choose a .txt file, it fills the script | manual | 🟡 |
| F04-E1 | file over 400 KB | toast | ✅ (code path) |

## F05 Two to four speakers

| F05-H1 | "Speaker 2:" lines show the per-speaker voice picker | e2e | ✅ |
| F05-H2 | each speaker uses its own voice | unit (voiceover plan) + API test | ✅ |
| F05-E1 | "Speaker 9:" is capped to speaker 4 | unit | ✅ |

## F06 Library

| F06-H1 | save voiceover and track, badge counts 2 | e2e | ✅ |
| F06-H2 | delete with confirmation | e2e | ✅ |
| F06-E1 | Escape closes the sheet, focus returns | e2e | ✅ |
| F06-E2 | private window without IndexedDB falls back to memory | code path | 🟡 |

## F07 Theme

| F07-H1 | toggle light/dark, remembered | e2e | ✅ |

## New: compose music

| M-H1 | every mood renders clean audio (no NaN, peak ≤ 0.98, not silent) | unit | ✅ |
| M-H2 | same settings + seed = same track; new seed = new track | unit | ✅ |
| M-H3 | compose in the browser, play, save | e2e | ✅ |
| M-E1 | length 5 s and 300 s | unit / bench (300 s ≈ 12 s render) | ✅ |
| M-E2 | listen to all 8 moods and judge them | by ear | 🟡 |

## New: find free tracks

| T-H1 | results show licence and credit line; NC results are dropped | API + e2e (mock) | ✅ |
| T-E1 | no results / busy (429) / empty query | API | ✅ |
| T-H2 | real Openverse results and previews play | live site | 🟡 |

## New: Claude (MCP)

| C-H1 | initialize, tools/list (4 tools), ping, notifications 202, GET 405 | API | ✅ |
| C-H2 | compose_music link renders a WAV, cached, HEAD doesn't render | API | ✅ |
| C-H3 | generate_voiceover link renders (fake engine) | API | ✅ |
| C-H4 | real Kokoro on Vercel (`/api/selftest?key=…`) | after deploy | 🟡 |
| C-H5 | add as a custom connector in Claude and run each tool | after deploy | 🟡 |
| C-N1 | wrong key, tampered link, unknown tool, bad args | API | ✅ |
| C-N2 | browser origin not allowed | API | ✅ |
| C-N3 | secret as `Authorization: Bearer` header on `/mcp` | API | ✅ |

Accessibility: semantic roles (tablist, radiogroup, dialog, progressbar), labels on
every input, visible focus, keyboard flows checked in e2e, reduced motion respected.
An automated axe scan was not run: `@axe-core/playwright` can't be installed here.
