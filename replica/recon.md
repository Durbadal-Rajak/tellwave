# Recon map: VibeVoice Studio (web)

Scope: the single-page studio (voice picker, text input, generation settings, output
player, audio library), rebuilt to run free on Vercel with Kokoro voices, plus two
areas the original does not have: royalty-free music and a Claude connection (MCP).
For: the owner's own video production (voiceovers and background music). Personal use.
Date: 2026-10-20

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | README | https://github.com/shamspias/vibevoice-studio | features, endpoints, settings |
| 2 | Source (MIT) | https://github.com/shamspias/vibevoice-studio/tree/main/app | open source; read for screens, states and data shapes only. No code copied. |
| 3 | Demo video | repo `assets/demo/vibevoice-demo.mp4` | 19 frames saved in `replica/screens/` |
| 4 | Engine fork | https://github.com/shamspias/VibeVoice | what the original runs on (GPU only) |
| 5 | Replacement engine | https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX | Kokoro 82M, Apache-2.0 weights |
| 6 | kokoro-js README | https://cdn.jsdelivr.net/npm/kokoro-js@1.2.0/README.md | load, generate, stream, voice grades |
| 7 | Vercel limits | https://vercel.com/docs/functions/limitations | no GPU, 2 GB / 1 vCPU, 300 s, 4.5 MB unless streamed |
| 8 | Vercel Hobby plan | https://vercel.com/docs/plans/hobby | 4 CPU-hours/month, paused 30 days when exceeded, personal use only |
| 9 | MCP transport spec | https://modelcontextprotocol.io/specification/2025-06-18/basic/transports.md | stateless Streamable HTTP rules |
| 10 | Openverse docs | https://docs.openverse.org/api/reference/authentication_and_throttling.html | free CC audio search, optional token |

REA (reverse-engineer-anything) was not used: the original is open source, and REA is
for compiled or shipped artifacts.

## Core loop

Pick a voice, paste a script, generate speech, play and download it.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Studio | `/` | everything happens on one page | header, voice section, text section, settings, generate button | model-loading toast, filled |
| S02 | Voice: select tab | S01 › Select Voice | choose a voice | voice card grid, search, refresh, delete on card | empty ("No voices found"), filled, selected |
| S03 | Voice: upload tab | S01 › Upload Voice | add a voice from a file | drop zone, name input, upload button | idle, file chosen, uploading, error (>50 MB) |
| S04 | Voice: record tab | S01 › Record Voice | record a voice sample | record button, live waveform, name input, save | idle, recording, recorded, mic denied |
| S05 | Text: manual | S01 | type the script | textarea, character and word counts | empty, filled |
| S06 | Text: upload file | S01 › Upload File | load a .txt | choose-file button, file name | idle, loaded |
| S07 | Generating overlay | Generate | wait | full-screen dim, spinner, message | loading |
| S08 | Generated audio card | after generation | play, download, save | audio player, duration, generation time, download, save to library | hidden, filled |
| S09 | Audio library modal | header folder button | browse past outputs | search, refresh, rows with play / download / delete | empty, filled, refreshed toast |
| S10 | Confirm delete modal | delete on a voice or file | confirm | message, cancel, delete | open |
| S11 | Toasts | anywhere | feedback | success, warning, error | transient |

## Flows

```
F01 Make a voiceover with an existing voice
    S02 select card -> S05 type -> Generate -> S07 -> S08 -> Download
    happy path clicks: 3 (plus typing)
    edge: no voice selected, empty text, model still loading, generation fails, very long text

F02 Add a voice from a file
    S03 choose file -> name -> Upload -> S02 (new card selected)
    happy path clicks: 4
    edge: no name, file over 50 MB, unsupported format

F03 Record a voice
    S04 record -> stop -> name -> Save -> S02
    happy path clicks: 4
    edge: microphone denied

F04 Generate from a text file
    S06 choose file -> Generate -> S07 -> S08
    happy path clicks: 3

F05 Two to four speakers
    S05 lines "Speaker 1: ...", "Speaker 2: ..." -> number of speakers -> Generate
    edge: speaker numbers above the selected count

F06 Reuse an earlier result
    header -> S09 -> play / download / delete (S10)
    happy path clicks: 2

F07 Switch theme
    header moon / sun button
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Button | primary gradient, secondary, success, danger, icon, small | default, hover, disabled, loading | all |
| Card / section | with icon title | default | S01 |
| Tabs | voice tabs, text tabs | active, inactive | S02-S06 |
| Voice card | upload/record/preset type label | default, hover (delete shows), selected (gradient) | S02 |
| Search box | with icon | empty, typing | S02, S09 |
| Drop zone | file | idle, drag-over, file chosen | S03, S06 |
| Record button | round | idle, recording (pulse) | S04 |
| Waveform | live canvas | recording | S04 |
| Textarea + stats | counts | empty, filled | S05 |
| Range slider + value | voice strength | default | S01 |
| Select | number of speakers | default | S01 |
| Audio player | native | loaded | S08, S09 |
| Modal | large, small | open | S09, S10 |
| Loading overlay | spinner + text | visible | S07 |
| Toast | success, warning, error | entering, leaving | S11 |
| Badge | count on library button | hidden, count | header |
| Empty state | icon + sentence | visible | S02, S09 |

## Inferred data model

```
VoiceProfile  id, name, type (recorded | uploaded | preset), file_path, created_at, description
              evidence: S02 cards, app/models/voice_model.py
              confidence: high

AudioFile     filename, voice_name, duration, size, text_preview, created_at
              evidence: S09 rows (name, voice, duration, size, date, preview)
              confidence: high

GenerationRequest  text, voice_id, num_speakers (1-4), cfg_scale (1.0-2.0), output_format
              evidence: S05 + settings panel, POST /api/generate in README
              confidence: high
```

Relationships: VoiceProfile 1-n AudioFile (by voice name). No users or accounts.

## Feature matrix

See `features.csv`. Must: 14, should: 19, could: 3, skip: 4.

## Out of scope (cannot or should not be cloned)

- Voice cloning from an uploaded or recorded sample: it needs a VibeVoice-class model on
  a GPU. Vercel has no GPU and Kokoro has fixed voices. Kept as a future option (a GPU
  backend URL), not built now.
- The VibeVoice model itself: Microsoft's research weights, GPU only. Replaced by Kokoro.
- A server-side library shared across devices: with no login, the library lives in each
  browser (IndexedDB).
- "Voice strength" (CFG): a VibeVoice setting with no Kokoro equivalent. Replaced by speed.

## Size

Screens 11 in the original; the clone keeps 8 and adds 3 (music compose, music search,
connect Claude). Flows 7. Entities 3. Hard parts: Kokoro in the browser (model download,
worker, phone speed), music that sounds good without an AI model, and an MCP server plus
server-side Kokoro inside Vercel's 1 vCPU / 300 s / free CPU quota. Size: M.
