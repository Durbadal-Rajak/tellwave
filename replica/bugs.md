# Bugs found while testing Tellwave

| ID | sev | title | status |
| --- | --- | --- | --- |
| B01 | S1 | App did not start: waveform drew on a hidden canvas and threw | fixed |
| B02 | S2 | "Save to library" stayed enabled after saving (event target lost after await) | fixed |
| B03 | S3 | Desktop voice list spilled outside its card | fixed |
| B04 | S3 | Phone: 28 voice cards pushed Make voiceover far down the page | fixed |
| B05 | S4 | Voice gender shown in title case ("American Female") | fixed |
| B06 | S3 | Mixes were bass-heavy (up to 93% of energy below 120 Hz), quiet on phone speakers | fixed |

### B01 App did not start
- Steps: open `/` with a fresh browser.
- Expected: voices listed, page usable.
- Actual: `RangeError: Failed to execute 'roundRect': Radius value -0.47 is negative`; no voices rendered.
- Cause: the output card is hidden on load, so the canvas measured 0 px wide.
- Fix: skip drawing until the canvas is laid out; clamp the bar radius at 0. Covered by every e2e run.

### B02 Save button stayed enabled
- Steps: make a voiceover, press Save to library.
- Expected: button disables after saving.
- Actual: `e.currentTarget` is null after `await`, so the button never disabled.
- Fix: capture the button before awaiting. Covered by e2e (badge count).

### B03 Voice list spilled outside its card (desktop)
- Cause: flex child without `min-height: 0`. Fix: added it; the list scrolls inside the card.

### B04 Long voice list on phones
- Fix: below 1000 px the voices scroll sideways with snap points, and the picked voice is scrolled into view.

### B05 Title case
- Fix: removed `text-transform: capitalize`.

### B06 Bass-heavy music
- Evidence: spectral balance per mood (Welch PSD) before and after.
- Fix: rebalanced kick, toms, bass, drones and sub levels; brighter plucks and pads. Now 18-50% below 120 Hz for most moods.

## To check (not reproduced, can't be in this workspace)
- Kokoro in the browser via jsDelivr's `+esm` build (fallback: esm.sh).
- Kokoro on Vercel: onnxruntime-node binary included by `includeFiles`; transformers.js cache in `/tmp`.
- Openverse's real response shape matches the mock (duration in milliseconds, `attribution` field).
