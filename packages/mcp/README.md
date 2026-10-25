# @montagio/mcp

A local [Model Context Protocol](https://modelcontextprotocol.io) server for Montagio. Any MCP client (a desktop assistant, an IDE, an agent framework) can drive the Studio with it: "animate this photo with Crash Push", "make the dog squish", "generate an image, then apply Explode".

It talks to a running Montagio app over the app's HTTP API, the same one the Studio uses. It renders nothing itself, holds no key, and sends nothing anywhere but the app at `MONTAGIO_URL`.

## Start it

1. Start Montagio as usual, so the Studio answers at `http://127.0.0.1:3000`:

   ```bash
   ./montagio.sh start
   ```

   On Windows: `powershell -ExecutionPolicy Bypass -File .\montagio.ps1 start`. In demo mode (`install --app-only`), the app answers with pre-rendered files: a way to try the tools without a GPU.

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
| `MONTAGIO_URL` | `http://127.0.0.1:3000` | the running app |
| `MONTAGIO_MCP_OUT` | unset | a folder where finished files are downloaded; unset, the tools return URLs only |

## Tools

| Tool | What it does |
|---|---|
| `list_camera_presets` | the camera presets and the video models that render them, with time estimates |
| `list_effects_and_hooks` | the effects, the hooks, the extensions switched on, and their time estimates |
| `upload_photo` | a local PNG, JPEG or WebP file (10 MB at most) to an `imageRef` |
| `use_sample_photo` | the bundled sample photo's `imageRef`, to try everything without a photo |
| `text_to_image` | a start photo from a text; its `outputImageRef` feeds every other tool |
| `edit_photo` | an edit in plain words, or a look (`infl8`, `action`, `angles`) |
| `camera_move` | a photo and a camera preset give a 5 s clip; pass `description`, what the photo shows |
| `apply_effect` | a one-photo effect (Squish, Cake-ify, Explode…) |
| `apply_hook` | a keyframe hook (Wardrobe Swap takes a second photo, an outfit) |
| `talking_avatar` | a photo says a text, in English or French, for 1 to 15 s |
| `motion_transfer` | the character of a photo moves like a reference video (its first 5 s) |
| `upscale_to_1080p` | an HD 1080p copy of a finished clip |
| `get_job` | a render's state by id; `wait: true` follows it to its end |
| `list_history` | what this Montagio has made, newest first |
| `get_workflow` | the ComfyUI workflow (API JSON) behind a clip or an image, returned, or saved as a new file in `MONTAGIO_MCP_OUT` |
| `get_recipe` | the recipe of a render: preset or remix, workflow and its sha256, weight files with their lock sha256 and licence, seed, texts, settings, the sha256 of each input (never the photo) and the versions of the stack |
| `reproduce` | a recipe rendered again with the same seed, on the photo the user gives: a `.json`, or the MP4 or PNG Montagio exported (it carries a compact recipe); says whether the inputs and the workflow have the recipe's sha256 |

Every tool that takes a photo accepts either `imageRef` or `path` (a local file, uploaded first). A render blocks until it is done and returns the absolute URL of its file, its id, the time estimate the app gives, and, when `MONTAGIO_MCP_OUT` is set, the local path of the downloaded file. The default wait is 30 minutes, `timeoutMinutes` changes it per call; past it, the render goes on in the app and `get_job` with `wait: true` picks it up.

`camera_move` works much better with `description`: a sentence on what the photo shows (the subject, the setting, the light). Without it, the video model tends to invent the scene instead of following the photo.

The same replay runs from a terminal: `npm run reproduce -- <recipe.json|clip.mp4|image.png> --photo <file>`. Same recipe, same stack: identical result on the same setup, very close elsewhere (diffusion is not always bit-exact from one graphics card to another).

A refusal or a failed render comes back as a tool result with `isError: true`, the app's code (`consent-required`, `extension-disabled`, `speech-too-long`…) and a sentence that says what to do.

## Consent

Montagio does not make videos of real people without their consent, and the MCP server keeps the Studio's rule:

- `edit_photo`, `apply_effect`, `apply_hook` and `talking_avatar` take `consent`, which means "the person in the photo is you, or has agreed". It defaults to `false`. The app refuses an imported photo without it (`consent-required`), and the tool passes that refusal on; the sample photo and generated images do not need it.
- `motion_transfer` takes `rights` the same way: the user holds the rights on the photo and the video. Without it, nothing is uploaded.
- A client must set either one only when the user has said so. The server never sets it on anyone's behalf.

Texts naming a well-known person are refused by the app, as in the Studio.

## How it works

Each job request carries a fresh `Idempotency-Key`. The app moves a render forward when it is polled, so the server polls `GET /api/jobs/:id` (or `GET /api/generations/:id` for a camera clip) every 2 s until the render succeeds, fails or is canceled, and sends MCP progress notifications when the client asks for them. Four failed polls in a row (the app or ComfyUI out of reach) end the wait. The server logs only to stderr, and only paths, ids and URLs.

## Development

```bash
npm test -w @montagio/mcp
npm run typecheck -w @montagio/mcp
```

The tests run on a fake `fetch`: no network and no app needed.
