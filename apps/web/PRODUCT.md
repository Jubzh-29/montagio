# Product

## Register

product

## Platform

web

## Users

The primary audience is the jury of the Comfy open-source contest named in the README. A juror opens the free showcase link, or watches the demo video, with no install and no patience for setup: they decide in the first minute whether Montagio is a real product. The secondary audience is the creator who installs Montagio on their own GPU (or a rented one) to animate their photos with camera moves, chain two or three shots into a short film, and remix presets.

## Product Purpose

Montagio is a one-click camera-move studio on open weights (Wan 2.2 Fun Camera), built on ComfyUI. A photo plus a preset gives a 5 s clip with a controlled camera move; two or three presets give a 10 to 15 s film. Every preset is an open YAML file that opens in ComfyUI. Success: the jury understands the product in five seconds, gets a clip in a few clicks, and trusts that the whole stack is open.

## Positioning

Click like on a commercial camera-preset studio, open the hood like in ComfyUI: that immediacy, on a stack that is open from the weights to the workflow.

## Brand Personality

Spectacular, immediate, precise. The camera moves sell themselves, the way they do on the commercial studios: motion is the first thing a visitor sees. The rigour comes from the film set: a viewfinder, a REC tally, crisp numbers. Honest about what it is (pre-generated clips in the showcase, placeholders until the GPU session).

## Anti-references

- A generic SaaS: identical rounded cards, purple gradients, giant hero numbers.
- The raw node editor: the density of a ComfyUI graph. Montagio stays one click; the hood opens only when asked.
- Neon cyberpunk: glows, glitches, saturated colours everywhere.

The project spec also forbids the commercial competitor's name, logo, texts, outputs and preset names anywhere in the product (the README alone names it).

## Design Principles

- **Motion first.** The camera moves are the product: they move on screen before anything is read.
- **The clip is the brightest thing on screen.** The interface stays dark and quiet around the media.
- **One click, hood available.** One primary action per screen; ComfyUI, YAML and licences are one step away, never in the way.
- **Show the proof.** Open weights, licences and the open-stack check are visible, verifiable, never hidden.
- **Honest states.** Every placeholder, limit and failure says what it is and what to do next.

## Accessibility & Inclusion

WCAG 2.2 AA: AA contrast, visible focus everywhere, full keyboard use, the existing `aria-live` regions kept, and `prefers-reduced-motion` respected by every animation, looping previews included.
