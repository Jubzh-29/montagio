# @montagio/mcp

A local [Model Context Protocol](https://modelcontextprotocol.io) server for Montagio. Any MCP client (a desktop assistant, an IDE, an agent framework) can drive the Studio with it: "animate this photo with Crash Push", "make the dog squish", "generate an image, then apply Explode".

It talks to a running Montagio app over the app's HTTP API, the same one the Studio uses. It renders nothing itself, holds no key, and sends nothing anywhere but the app at `MONTAGIO_URL`.

## Start it

1. Start Montagio as usual, so the Studio answers at `http://127.0.0.1:3000`:

   ```bash
   ./montagio.sh start
   ```

   On Windows: `powershell -ExecutionPolicy Bypass -File .\montagio.ps1 start`.

   In demo mode (`install --app-only` without `--proxy-url`), no model runs: a way to try the tools without a GPU. A clip made from one of the bundled sample photos (`demo-assets/images`), for a preset or a feature a GPU session rendered on that photo (with the sample reference clip, for a motion transfer), is that render. Any other clip is the photo itself moved by FFmpeg along the camera move (a slow push-in for an effect, a hook, an avatar or a motion transfer). An image, a sound, captions and a clip without a photo are files of `demo-assets`.

2. Point your MCP client at the server. It speaks MCP over stdio, so the client starts it. A generic configuration:

   ```json
   {
     "mcpServers": {
       "montagio": {
         "command": "npx",
         "args": ["tsx", "<repo>/packages/mcp/src/server.ts"],
         "env": { "MONTAGIO_URL": "http://127.0.0.1:3000" }
       }
     }
   }
   ```

   Replace `<repo>` with the absolute path of your Montagio checkout. From the repository root, `npm run mcp` starts the same server by hand.

| Variable | Default | |
|---|---|---|
| `MONTAGIO_URL` | `http://127.0.0.1:3000` | the running app; any http(s) URL is accepted |
| `MONTAGIO_MCP_OUT` | unset | a folder where finished files are downloaded; unset, the tools return URLs only |

## Tools

| Tool | What it does |
|---|---|
| `list_camera_presets` | the camera presets and the video models that render them, with time estimates |
| `list_effects_and_hooks` | the effects, the hooks, the extensions switched on, and their time estimates |
| `list_motion_library` | the reference motions Montagio made from fictional characters, to pass as `libraryMotion` |
| `upload_photo` | a local PNG, JPEG or WebP file (10 MB at most) to an `imageRef` |
| `use_sample_photo` | the bundled sample photo's `imageRef`, to try everything without a photo |
| `text_to_image` | a start photo from a text; its `outputImageRef` feeds every other tool |
| `edit_photo` | an edit in plain words, or a look (`infl8`, `action`, `angles`) |
| `camera_move` | a photo and a camera preset give a 5 s clip; pass `description`, what the photo shows |
| `apply_effect` | a one-photo effect (Squish, Cake-ify, Explode…) |
| `apply_hook` | a keyframe hook (Wardrobe Swap takes a second photo, an outfit) |
| `talking_avatar` | a photo says a text, in English or French, for 1 to 15 s |
| `motion_transfer` | the character of a photo moves like the first 30 s of a reference video, or like a motion of the library |
| `restyle_video` | the whole scene of a clip (its first 5 s) rebuilt from a text, its motion and camera move kept; an optional image gives a look to follow |
| `swap_object` | one object of a clip (its first 5 s), marked by points on its first frame, replaced from a text and an optional photo of the new object; the rest stays as filmed |
| `upscale_to_1080p` | an HD 1080p copy of a finished clip, by default with smooth motion (twice the frame rate) |
| `get_job` | a render's state by id (a job or a camera clip, not a film); `wait: true` follows it to its end |
| `list_history` | what this Montagio has made, newest first |
| `get_workflow` | the ComfyUI workflow (API JSON) behind a clip or an image, returned, or saved as a new file in `MONTAGIO_MCP_OUT` |
| `get_recipe` | the recipe of a render: preset or remix, workflow and its sha256, weight files with their lock sha256 and licence, seed, texts, settings, the sha256 of each input (never the photo) and the versions of the stack |
| `reproduce` | a recipe rendered again with the same seed, on the photo the user gives: a `.json`, or the MP4 or PNG Montagio exported (it carries a compact recipe); says whether the inputs and the workflow have the recipe's sha256 |

### Parameters

A parameter in bold is required. "One clip" means exactly one of `videoPath` (a local MP4, WebM or MOV file, 50 MB at most, uploaded first), `videoRef` (a clip already uploaded) or `libraryMotion` (an id from `list_motion_library`).

| Tool | Parameters |
|---|---|
| `list_camera_presets`, `list_effects_and_hooks`, `list_motion_library`, `use_sample_photo` | none |
| `upload_photo` | **`path`** |
| `text_to_image` | **`prompt`** (1 to 500 characters), `aspect` (`16:9`, `9:16` or `1:1`, default `16:9`), `seed` (an integer, 0 or more), `timeoutMinutes` |
| `edit_photo` | the photo, **`instruction`** (1 to 500 characters), `look` (`infl8`, `action` or `angles`), `consent`, `timeoutMinutes` |
| `camera_move` | the photo, **`presetId`**, `description` (500 characters at most, sent to the app as `userPrompt`), `modelId` (default: the preset's own), `seed`, `timeoutMinutes` |
| `apply_effect` | the photo, **`effectId`**, `subject` (500 characters at most; the app refuses one longer than the effect's `subjectMax` from `list_effects_and_hooks`), `consent`, `timeoutMinutes` |
| `apply_hook` | the photo, **`hookId`**, the second photo as `image2Ref` or `image2Path` (for a hook with `references: 2`), `consent`, `timeoutMinutes` |
| `talking_avatar` | the photo, **`text`** (1 to 300 characters), `language` (`en` or `fr`, default `en`), `consent`, `timeoutMinutes` |
| `motion_transfer` | the photo, one clip, `character` and `motion` (500 characters at most each), `rights`, `timeoutMinutes` |
| `restyle_video` | **`prompt`** (1 to 500 characters), one clip, an optional look image (`imageRef` or `path`), `rights`, `timeoutMinutes` |
| `swap_object` | **`prompt`** (1 to 500 characters), **`points`** (1 to 8 points `{ "x", "y" }`, fractions of the first frame from 0 to 1, x from the left, y from the top), `exclude` (up to 8 points on what is not the object), one clip, an optional photo of the new object (`imageRef` or `path`), `rights`, `timeoutMinutes` |
| `upscale_to_1080p` | **`id`**, `kind` (`generation` for a camera clip, `job` for the others; found from the id when left out), `smooth` (default `true`: RIFE puts a frame between each two, so a 16 fps clip comes out at 32 fps, same length), `timeoutMinutes` |
| `get_job` | **`id`**, `wait` (default `false`), `timeoutMinutes` |
| `list_history` | `limit` (1 to 200, default 20), `kind` (`photo`, `clip` or `film`) |
| `get_workflow` | **`id`**, `save` |
| `get_recipe` | **`id`**, `kind` (`generation`, `job` or `sequence`; each is tried in turn when left out) |
| `reproduce` | **`recipe`** (a local `.json`, `.mp4` or `.png` path, or the recipe JSON itself), `photo` (a local image file or an `imageRef`), `inputs` (the other files the recipe names, by field: a local path or a ref the app holds), `consent`, `rights`, `voiceConsent`, `faceConsent`, `timeoutMinutes` |

"The photo" is `imageRef` (a photo the app already has) or `path` (a local image file, uploaded first), never both. The exceptions:

- `upload_photo` takes `path` only;
- `apply_hook`'s second photo is `image2Ref` or `image2Path`;
- in `restyle_video` and `swap_object`, the image is optional;
- `reproduce` takes `photo` instead, which is either a local file or an `imageRef`, and puts it where the recipe asks for its first photo.

A render blocks until it is done and returns the absolute URL of its file, its id, the time estimate the app gives, and, when `MONTAGIO_MCP_OUT` is set, the local path of the downloaded file. The download is saved as `montagio-<task>-<id>.<ext>` and overwrites a file of the same name in that folder. Only `get_workflow` with `save: true` never overwrites: it writes `<name>.json`, or `<name>-1.json` and so on when that name is taken.

The default wait is 30 minutes. `timeoutMinutes` changes it per call: more than 0, at most 1440 (24 hours). Past it, the render goes on in the app, and `get_job` with `wait: true` picks it up.

`camera_move` works much better with `description`: a sentence on what the photo shows (the subject, the setting, the light). Without it, the video model tends to invent the scene instead of following the photo.

The same replay runs from a terminal:

```bash
npm run reproduce -- <recipe.json|clip.mp4|image.png> --photo <file> [--input field=file]... [--consent] [--rights] [--voice-consent] [--face-consent] [--out folder]
```

Same recipe, same stack: identical result on the same setup, very close elsewhere (diffusion is not always bit-exact from one graphics card to another).

A refusal or a failed render comes back as a tool result with `isError: true`, the app's code (`consent-required`, `extension-disabled`, `speech-too-long`…) and a sentence that says what to do.

### What has no tool

These Studio features have no tool of their own: films of several shots, a film's music, ads, voice change, translation, captions, characters, the trend remix and the HD copy of a photo.

`reproduce` can still replay a recipe that the app made for some of them. A recipe may name a camera clip, a film, an image, a photo's HD copy, an edit, an effect, a hook, an avatar, a motion transfer, a restyle, an object swap, an ad or a trend remix, and then one follow-up at most: a clip's HD copy, a film's music or a clip's captions. A voice change and a translation cannot be replayed (`not-replayable`), nor captions made on one of them. A character is saved in the app, not rendered: its portrait (an image) and its photos (edits) can be replayed, not the character itself.

## Consent

Montagio does not make videos of real people without their consent, and the MCP server keeps the Studio's rule:

- `edit_photo`, `apply_effect`, `apply_hook` and `talking_avatar` take `consent`, which means "the person in the photo is you, or has agreed". It defaults to `false`. The app refuses an imported photo without it (`consent-required`), and the tool passes that refusal on; the sample photo and generated images do not need it.
- `motion_transfer`, `restyle_video` and `swap_object` take `rights` the same way: the user holds the rights on the photo and the video, and for `swap_object` the people filmed agree. Without it, nothing is uploaded. Never replace a real person in a real video without their consent.
- `reproduce` takes four flags, all `false` by default: `consent` (an imported photo, as above), `rights` (the replay of a motion transfer, a restyle, an object swap or a trend remix), `voiceConsent` (an avatar in someone's own voice, given as `inputs.voiceRef`: that person agreed) and `faceConsent` (a trend remix with a photo: its person is the user, agreed, or is fictional). A recipe never gives them: `reproduce` drops them from the recipe, with the remix's `keepSound` and `soundRights`, and sends only the flags of the call.
- A client must set any of these flags only when the user has said so. The server never sets one on anyone's behalf.

Texts naming a well-known person are refused by the app, as in the Studio.

## How it works

Each job request carries a fresh `Idempotency-Key`. The app moves a render forward when it is polled, so the server polls `GET /api/jobs/:id` (`GET /api/generations/:id` for a camera clip, `GET /api/sequences/:id` for a film) every 2 s until the render succeeds, fails or is canceled, and sends MCP progress notifications when the client asks for them. Four failed polls in a row (the app or ComfyUI out of reach) end the wait. Downloads come only from the origin of `MONTAGIO_URL`. The server logs only to stderr, and only the app's URL and the output folder.

## Development

```bash
npm test -w @montagio/mcp
npm run typecheck -w @montagio/mcp
```

The tests run on a fake `fetch`: no network and no app needed. Some of them call `ffmpeg` from the `PATH` to make their test files.
