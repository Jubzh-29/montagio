# Design

The visual system of the Montagio web app. Tokens live in `src/app/globals.css`; components in `src/components/*.module.css`. Strategy and audience: `PRODUCT.md`.

## Visual theme

A camera's viewfinder at night. Scene: a juror or a creator at a laptop, often in a dim room, judging short clips; the clips must be the brightest thing on screen. A graphite ground, cool like a monitor's black, quiet surfaces, one accent: the lime of a focus-peaking overlay, the colour a camera paints on what is sharp. Viewfinder language everywhere a frame appears: crop marks in the corners, a dashed target frame for where a camera move ends, monospace for numbers and licences.

## Colour

Restrained: graphite neutrals (chroma 0.003 to 0.008, hue 250) and one vivid accent used for the primary action, the current selection and live state only. One vivid colour on a dark ground, never a glow; red means a failure and nothing else.

| Token | Value | Hex | Use |
|---|---|---|---|
| `--bg` | `oklch(0.155 0.006 250)` | `#0A0C0F` | page ground |
| `--surface` | `oklch(0.2 0.006 250)` | `#141619` | tiles, rows, inputs |
| `--surface-2` | `oklch(0.24 0.007 250)` | `#1D2023` | hover, pressed segment, glyph ground |
| `--line` / `--line-strong` | `oklch(0.31 / 0.4 0.008 250)` | `#2D3134` / `#44484C` | borders, rules |
| `--line-input` | `oklch(0.53 0.008 250)` | `#686C70` | text field edges, 3:1 on every surface |
| `--ink` / `--ink-muted` / `--ink-faint` | `oklch(0.97 / 0.77 / 0.65, hue 250)` | `#F4F5F7` / `#B2B4B7` / `#8C8F93` | text; faint still meets 4.5:1 on every surface (5.0:1 on `--surface-2`) |
| `--rec` / `--rec-hover` / `--rec-soft` | `oklch(0.89 0.22 132)` / `oklch(0.93 0.16 132)` / 14 % | `#A2F745` | Generate, selection border and tint, shot numbers, the live tally; named for its role (rolling the take), not its hue |
| `--on-rec` | `oklch(0.2 0.04 132)` | `#0F1A06` | text and marks on the lime, never white (13.6:1) |
| `--ok` | `oklch(0.82 0.11 200)` | `#5DDAE0` | licences, the verified open stack: cyan, since the lime already means "act here" |
| `--warn` | `oklch(0.82 0.13 80)` | `#F0BA59` | placeholder badges, remix problems |
| `--error` | `oklch(0.7 0.17 25)` | `#F66D67` | failures: a mark and a tinted notice, never red body text alone |

## Typography

Geist and Geist Mono, one family, fixed rem scale (no fluid type): `--text-xs` 12 px, `--text-s` 13 px, `--text-m` 15 px (body), `--text-l` 18 px, `--text-xl` 22 px. Section titles are 13 px semibold in `--ink-muted`, sentence case, no uppercase eyebrows. Mono for durations, licences, YAML, model ids and render status.

## Spacing and shape

A 4 px scale (`--space-1` 4 … `--space-7` 48). Radii: 6 px (glyphs, badges), 10 px (tiles, rows, buttons), 14 px (the monitor). Layout: a promise and a line on the tab across the top, then the composer left (320–400 px, sticky on desktop, `--header-room` under the header, `--generate-room` above its foot) and the canvas right; under 960 px one column with the canvas first, under 640 px the wall and the gallery scroll sideways.

## Components

- **Monitor**: 16:9, crop marks inset 16 px. Empty, it plays the chosen move as a full-size viewfinder behind the call to drop a photo (on a phone only its grid drifts). Rendering: a bottom overlay with the REC tally, mono status, Cancel and a 3 px progress bar. Notices sit above the marks: error tone with a mark and a way out, neutral for a cancel.
- **Move glyph** (`MoveGlyph.tsx`, `lib/move-glyph.ts`): grid, horizon, subject, frame marks at 14 %, and a dashed target frame that lands on the marks at the end of the move. Chained moves (push then hold) are drawn one after the other.
- **Tile** (camera moves, effects, hooks: one primitive): the media framed at radius 10 (16:9 for a move, 4:5 for an effect), the glyph or the preview clip with its poster, the name in sentence case over a dark fade, the description as a two-line caption under it (the name labels the button, the caption describes it). Selected: lime frame. In a sequence: shot numbers and a + chip; dimmed when three shots are set.
- **Shot list**: numbered rows with their own text field, free slots dashed.
- **Buttons**: one vocabulary. Primary (lime with dark text, 48 px), one on screen at a time: Generate, or the result's Download once a result shows (Generate then steps back to an outline, as it does while the photo atelier is open); secondary (bordered), ghost (over pictures), tool (text-sized, in a section head or beside Change: Pause, Remix preset), link. On touch screens every control is 44 px high.
- **View tabs and pills**: the canvas's views (Gallery, Monitor, Photo atelier while one is open) are words underlined like the header's tabs; the pill (a rounded segmented box) is kept for options: filters, formats, looks, languages.
- **Open-stack badge**: pill with a tally mark; cyan when the check passed, red when it failed.

## Motion

- UI transitions: 180 ms, `--ease-out` (expo-like). Camera moves (glyphs): `--ease-camera`, ease in and out, a hold at both ends, ping-pong loop, 1.6 to 6 s from the preset's speed.
- Loops never run unasked under reduced motion: the Pause/Play toggle (WCAG 2.2.2) stops glyphs and preview clips, starts paused when the system asks for reduced motion, and an explicit Play wins.
- No page-load choreography; skeletons pulse while the catalogue loads.
