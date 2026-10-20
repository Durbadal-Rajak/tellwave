# Parity report: Tellwave vs VibeVoice Studio

| score | value | notes |
| --- | --- | --- |
| Feature parity | **96.7 / 100** | 20 scored features; must-haves 7 of 8 done |
| Layout parity | 24.3 / 100 | different on purpose (see below) |
| Combined (tool) | 82.2 / 100 | `parity.py --visual` |

Raw tool output: `replica/parity-tool.md`. Diff images: `replica/diffs/`.

## The one must-have that is not "done"

- **Generate speech (Kokoro):** built, wired and tested end to end with a stand-in
  engine. The real model can't be downloaded in this build workspace, so it gets
  checked on the live site: one voiceover in the browser, and `/api/selftest?key=…`
  for the Claude side. Mark it `yes` once both work.

## Layout

The reference frames come from the original's demo video (a different window size,
dark theme, a screen-recorder toolbar), so they are not the same viewport or state,
and the clone changes the layout deliberately:

- desktop: two columns (script and output left, voices right) instead of one long column
- phone: voices scroll sideways so "Make voiceover" stays near the script
- new Music and Claude sections, so the top bar is a three-way switch

Per the Replica rules the look is not chased; the information and hierarchy match
(voice choice, script, settings, generate, output, library).

## Behaviour

| flow | original | clone | keep or fix |
| --- | --- | --- | --- |
| F01 voiceover | pick voice, type, Generate, Download: 3 clicks | voice preselected (last used); type, Make voiceover, Download: 2 clicks | keep |
| F01 waiting | full-screen spinner | inline live waveform, model download %, "part n of m" | keep |
| F02/F03 add a voice | upload or record to clone | not possible with Kokoro (fixed voices) | keep; GPU backend later |
| F06 library | on the server | in this browser only (no login) | keep |
| remembered | theme | theme, voice, speed, draft script, music settings | keep |
| errors | toasts | inline message + toast, readable causes | keep |

## Verdict

**Not shippable yet → shippable after the live voice check.** No open S1 or S2 bugs.
Feature score 96.7 with the one partial must-have pending a check that can only happen
on the deployed site.

## Next five

1. Live check: a voiceover in the browser and `/api/selftest` on Vercel.
2. Listen to all 8 moods and tune what sounds off.
3. MP3 download for smaller files (WAV only today).
4. Optional GPU backend (VibeVoice) for voice cloning, if you rent a GPU later.
5. Long scripts: automatic split and join beyond 5,000 characters.
