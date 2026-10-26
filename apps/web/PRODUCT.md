# Product

## Register

product

## Platform

web

## Users

The primary audience is the jury of the Comfy open-source contest named in the README. A juror opens the free showcase link, or, once published, watches the demo video, with no install and no patience for setup: they decide in the first minute whether Montagio is a real product. The secondary audience is the creator who installs Montagio on their own GPU (or a rented one) to turn their photos into effects, camera moves, short films, talking avatars and motion clips, remix a trend, and remix presets. A 24 GB card runs every tool; a 12 GB card runs the Turbo camera model, the 5B model, text to image and the effects.

## Product Purpose

Montagio turns one photo into a few seconds of viral video effect, on 100 % open weights, built on ComfyUI. The logo opens Explore: clips made with Montagio, then a card for every tool. The Studio opens on the Effects wall: a photo plus an effect (Squish, Explode…) or a hook (an edit, then a transition to it) gives a short clip, and two or three photos can first be composed into one scene. The other tabs are the tools around it:

- **Camera**: a controlled camera move (Wan 2.2 Fun Camera) for a 5 s clip, in three tiers: Quality (20 steps), Turbo (the same moves in 4 steps, the default of 7 of the 11 presets) and Fast (Wan 2.2 5B).
- **Film**: two or three moves chained into a film, with music made for it if wanted.
- **Avatar**: a portrait speaks a text, in English or French. Its result leads on to karaoke captions in a 9:16 export, a voice change, and a translation into another language with the lips following the new words.
- **Motion**: a character, from a photo or composed from two or three, moves like a reference video of up to 30 s, the user's own or a clip of the Motion library. The same tab restyles a clip (its first 5 s rebuilt, motion and camera kept) or swaps one object in it.

Around the Studio:

- **Characters**: fictional characters from a text, among 12 kinds, 6 styles and optional traits, or from a bank of 28 ready-made faces; a photodump puts one in new scenes.
- **Ads**: a product photo becomes a 9:16 clip with an effect, music and an optional tagline.
- **Trend remix**: a short trend (a file, a link fetched on this machine, or the example) is cut into shots, and each shot is redone by the user's character or has one object replaced; Gemma can write the post.
- **Community gallery**: creations published from History, the examples, and share files that hold settings only, never a photo.
- **Recipe and Reproduce**: every result carries its recipe (model, seed, workflow and inputs by sha256), and Reproduce renders most of them again with the same settings and seed.

The photo atelier writes, edits, draws or upscales a start photo, and a finished clip can go to 1080p with smooth motion. Every preset is an open YAML file, and the exact workflow behind a clip downloads for ComfyUI. Success: the jury understands the product in five seconds, gets a clip in a few clicks, and trusts that the whole stack is open.

## Positioning

One photo, one viral effect, in a few clicks, like on the commercial effect studios; open the hood like in ComfyUI. That immediacy, on a stack that is open from the weights to the workflow, and that proves it: every result's caption leads to its model's weights and licences, and its recipe replays it. The camera moves stay the signature: the dashed frame that shows where the camera ends, before REC.

## Brand Personality

Spectacular, immediate, precise. The camera moves sell themselves, the way they do on the commercial studios: motion is the first thing a visitor sees. The rigour comes from the film set: a viewfinder, a REC tally, crisp numbers. Honest about what it is: the showcase plays real clips, pre-generated on a GPU and passed to 1080p, and says so; the demo mode says no model ran; what did not hold up on a GPU stays hidden (two hooks, the moodboard, the palette from a photo).

## Anti-references

- A generic SaaS: identical rounded cards, purple gradients, giant hero numbers.
- The raw node editor: the density of a ComfyUI graph. Montagio stays one click; the hood opens only when asked.
- Neon cyberpunk: glows, glitches, saturated colours everywhere.

The project spec also forbids the commercial competitor's name, logo, texts, outputs and preset names anywhere in the product (only the README, the repository's description and topics and the Space card's description name it, for search).

## Design Principles

- **Motion first.** The effects and the camera moves are the product: they move on screen before anything is read.
- **The clip is the brightest thing on screen.** The interface stays dark and quiet around the media.
- **One click, hood available.** One primary action per screen; ComfyUI, YAML, recipes and licences are one step away, never in the way.
- **Show the proof.** Open weights, licences and the open-stack check are visible, verifiable, never hidden.
- **Honest states.** Every placeholder, limit and failure says what it is and what to do next.

## Accessibility & Inclusion

WCAG 2.2 AA: AA contrast, visible focus everywhere, full keyboard use, the existing `aria-live` regions kept, and `prefers-reduced-motion` respected by every animation, looping previews included.
