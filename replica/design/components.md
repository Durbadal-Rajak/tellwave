# Tellwave components

Tokens: `replica/design/tokens.json` → `public/css/tokens.css` (custom properties, no
Tailwind: the stack has no build step). Icons are Tellwave's own inline SVGs (24px grid,
1.75px stroke, round caps). No Font Awesome, no copied artwork.

Design plan: a studio console for narrators. Cool mist (light) or studio slate (dark)
grounds; signal teal marks voice work, VU amber marks music. One memorable element: the
waveform strip, drawn from the real audio, filling in sentence by sentence while it
renders and tracking the playhead after. Everything else stays quiet: borders and surface
tiers instead of shadows, sentence-case labels, no eyebrows, no gradients.

```
Button
  variants  primary (accent), music (accent2), secondary (surface2 + border), ghost, danger
  sizes     sm 36px, md 44px, lg 52px (main actions; 44px+ touch target everywhere)
  states    default, hover (darken 6%), active (translateY 1px), focus-visible (2px ring accent, 2px offset),
            disabled (55% opacity, no pointer), loading (spinner replaces icon, label stays)
  tokens    bg accent, text on-accent, radius control, font body 600
  a11y      real <button>, aria-busy while loading, icon-only buttons have aria-label
  used on   all

Mode switch (Voiceover / Music / Claude)
  variants  3 segments, full width on phone
  states    selected (surface + text, accent underline 3px for voice, accent2 for music), unselected (text-muted), focus-visible
  a11y      role=tablist, arrow keys move, aria-selected, panels role=tabpanel
  used on   header area

Card (section)
  variants  plain (surface + border), inset (surface2, no border)
  tokens    radius card, padding 16 (phone) / 24 (desktop)
  used on   S01, music, connect

Voice card (radio card)
  content   name, accent + gender, quality grade, preview button
  states    default, hover (border-input), selected (2px accent border, check), previewing (button shows stop), focus-visible
  a11y      role=radio inside role=radiogroup, preview is a separate <button> with aria-label "Preview <name>"
  used on   voice picker

Search field
  states    empty (placeholder), typing, has-clear-button
  a11y      <input type=search> with visible label (visually hidden on phone)
  used on   voice picker, track search, library

Chip group (mood, kind, licence)
  variants  single-select
  states    default, selected (accent2 bg / on-accent2), focus-visible
  a11y      role=radiogroup of <button role=radio aria-checked>
  used on   music compose, track search

Script editor
  content   textarea, character count, word count, estimated length, speaker hint
  states    empty (placeholder shows an example), filled, over limit (danger text + disabled generate)
  a11y      label "Script", counts in aria-live=polite region
  used on   voiceover

Slider with value
  variants  speed (0.5-2.0×), length (5-300 s), intensity (1-3)
  states    default, focus-visible, disabled
  a11y      <input type=range> with <output> and aria-valuetext ("1.2 times speed")
  used on   voiceover, music

Select
  used on   per-speaker voice pickers (multi-speaker scripts)

File button
  states    idle, file chosen (name shown)
  a11y      real <input type=file> behind a <label> button
  used on   voiceover (load .txt)

Progress bar
  variants  determinate (model download %, sentence n of m), indeterminate
  a11y      role=progressbar with aria-valuenow / aria-valuetext
  used on   output card, model loader

Waveform strip (signature)
  content   canvas bars from the audio peaks, playhead, time
  states    rendering (bars grow in as chunks finish), ready, playing (playhead moves), seeking (tap/drag)
  motion    one reveal on render; none under prefers-reduced-motion
  a11y      canvas aria-hidden; native <audio controls> remains the accessible control
  used on   voice output, music output

Output card
  content   title, waveform, audio player, duration, render time, Download WAV, Save to library
  states    hidden, rendering, ready, error (message + retry)
  used on   voiceover, music

Result row (track / library item)
  content   play button, title, creator or voice, duration, licence badge, actions
  states    default, playing, loading, error
  used on   track search, library

Licence badge
  variants  CC0 (success), CC BY (warning tone, "credit needed"), Original (accent2)
  used on   track search, library, music output

Sheet (modal)
  variants  bottom sheet on phone (full width, radius sheet on top corners), centred dialog ≥720px
  states    open, closing
  a11y      <dialog> with showModal(), focus trapped, Esc closes, returns focus to opener
  used on   library, confirm delete

Toast
  variants  success, warning, error, info
  states    entering, visible (4 s), leaving
  a11y      container aria-live=polite (error uses role=alert)
  used on   all

Notice (inline)
  variants  info, warning
  used on   model download hint, MCP not set up, Openverse busy

Copy field
  content   read-only text + Copy button
  states    default, copied (button label "Copied")
  used on   connect, credit lines

Empty state
  content   one sentence that says what to do next + action button
  used on   library, track search, voice search

Badge (count)
  used on   library button
```
