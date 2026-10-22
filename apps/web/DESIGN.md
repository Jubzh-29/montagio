# Design

The visual system of the Montagio web app. Tokens live in `src/app/globals.css`; components in `src/components/*.module.css`. Strategy and audience: `PRODUCT.md`.

## Visual theme

A camera's viewfinder at night. Scene: a juror or a creator at a laptop, often in a dim room, judging short clips; the clips must be the brightest thing on screen. A near-black ground, quiet surfaces, one accent: the REC tally red. Viewfinder language everywhere a frame appears: crop marks in the corners, a dashed target frame for where a camera move ends, monospace for numbers and licences.

## Colour

Restrained: neutrals at chroma 0 and one accent used for the primary action, the current selection and live state only.

| Token | Value | Use |
|---|---|---|
| `--bg` | `oklch(0.11 0 0)` | page ground |
| `--surface` | `oklch(0.155 0 0)` | tiles, rows, inputs |
| `--surface-2` | `oklch(0.19 0 0)` | hover, pressed segment, glyph ground |
| `--line` / `--line-strong` | `oklch(0.27 0 0)` / `oklch(0.36 0 0)` | borders, rules |
| `--ink` / `--ink-muted` / `--ink-faint` | `oklch(0.96 / 0.74 / 0.6 0 0)` | text; faint still meets 4.5:1 on every surface |
| `--rec` / `--rec-hover` / `--rec-soft` | `oklch(0.55 0.19 22)` | Generate, selection border and tint, shot numbers, recording tally |
| `--ok` | `oklch(0.8 0.14 152)` | licences, the verified open stack |
| `--warn` | `oklch(0.82 0.13 80)` | placeholder badges, remix problems |
| `--error` | `oklch(0.7 0.17 25)` | failures: a mark and a tinted notice, never red body text alone |

## Typography

Geist and Geist Mono, one family, fixed rem scale (no fluid type): `--text-xs` 12 px, `--text-s` 13 px, `--text-m` 15 px (body), `--text-l` 18 px, `--text-xl` 22 px. Section titles are 13 px semibold in `--ink-muted`, sentence case, no uppercase eyebrows. Mono for durations, licences, YAML, model ids and render status.

## Spacing and shape

A 4 px scale (`--space-1` 4 … `--space-7` 48). Radii: 6 px (glyphs, badges), 10 px (tiles, rows, buttons), 14 px (the monitor). Layout: a promise and a line on the tab across the top, then the composer left (320–400 px, sticky on desktop, `--header-room` under the header, `--generate-room` above its foot) and the canvas right; under 960 px one column with the canvas first, under 640 px the wall and the gallery scroll sideways.

## Components

- **Monitor**: 16:9, crop marks inset 16 px. Empty, it plays the chosen move as a full-size viewfinder behind the call to drop a photo (on a phone only its grid drifts). Rendering: a bottom overlay with the REC tally, mono status, Cancel and a 3 px progress bar. Notices sit above the marks: error tone with a mark and a way out, neutral for a cancel.
- **Move glyph** (`MoveGlyph.tsx`, `lib/move-glyph.ts`): grid, horizon, subject, frame marks at 14 %, and a dashed target frame that lands on the marks at the end of the move. Chained moves (push then hold) are drawn one after the other.
- **Tile** (camera moves, effects, hooks: one primitive): the media framed at radius 10 (16:9 for a move, 4:5 for an effect), the glyph or the preview clip with its poster, the name in sentence case over a dark fade, the description as a two-line caption under it (the name labels the button, the caption describes it). Selected: red frame. In a sequence: shot numbers and a + chip; dimmed when three shots are set.
- **Shot list**: numbered rows with their own text field, free slots dashed.
- **Buttons**: one vocabulary. Primary (red, 48 px), one on screen at a time: Generate, or the result's Download once a result shows (Generate then steps back to an outline, as it does while the photo atelier is open); secondary (bordered), ghost (over pictures), tool (text-sized, in a section head or beside Change: Pause, Remix preset), link. On touch screens every control is 44 px high.
- **View tabs and pills**: the canvas's views (Gallery, Monitor, Photo atelier while one is open) are words underlined like the header's tabs; the pill (a rounded segmented box) is kept for options: filters, formats, looks, languages.
- **Open-stack badge**: pill with a tally mark; green when the check passed.

## Motion

- UI transitions: 180 ms, `--ease-out` (expo-like). Camera moves (glyphs): `--ease-camera`, ease in and out, a hold at both ends, ping-pong loop, 1.6 to 6 s from the preset's speed.
- Loops never run unasked under reduced motion: the Pause/Play toggle (WCAG 2.2.2) stops glyphs and preview clips, starts paused when the system asks for reduced motion, and an explicit Play wins.
- No page-load choreography; skeletons pulse while the catalogue loads.
