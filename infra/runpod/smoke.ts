/**
 * Montagio GPU smoke test (spec §9 and §10, GPU session S2).
 *
 * Compiles presets with @montagio/presets, sends each workflow through
 * @comfyorg/sdk to a self-hosted comfy-api-proxy, downloads the clip and records
 * wall time, execution time and peak VRAM in <out>/smoke.jsonl.
 *
 * Run from the repository root, on the pod:
 *   npm run smoke -w @montagio/infra-runpod                      # Crash Push on its preferred model
 *   npm run smoke -w @montagio/infra-runpod -- --runs 2          # 2nd run = warm timings
 *   npm run smoke -w @montagio/infra-runpod -- --preset all
 *   npm run smoke -w @montagio/infra-runpod -- --model wan22-ti2v-5b
 *   npm run smoke -w @montagio/infra-runpod -- --camera-pose all --camera-speed 1   # one clip per pose
 *   npm run smoke -w @montagio/infra-runpod -- --dry-run         # compile only, no network
 *   npm run smoke -w @montagio/infra-runpod -- --extension music --duration 12
 *   npm run smoke -w @montagio/infra-runpod -- --extension all --input photo.png --clip clip.mp4 --language fr
 *   npm run smoke -w @montagio/infra-runpod -- --extension effect,hook --input photo.png --hook wardrobe-swap --input2 outfit.png
 *
 * The SDK only ever talks to --base-url (default: the local proxy). Comfy Cloud
 * and the Router are refused, and no Router method is called.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Comfy, type Job, type WorkflowGraph } from '@comfyorg/sdk';
import {
  CAMERA_POSE_VALUES,
  compileImage,
  compileJob,
  loadLibrary,
  pickAspect,
  type ApiWorkflow,
  type Aspect,
  type Library,
  type Resolution,
} from '@montagio/presets';
import { extractFirstFrame, prepareMotionClip, probe, probeAudio } from '@montagio/sequence';
import { imageSize } from 'image-size';
import { EXTENSION_JOBS, extensionJobs, jobTexts, photoFile, type ExtensionJob, type ExtensionJobName } from './lib/extension-jobs';
import { imageFingerprint, imagePrompts } from './lib/image';
import { negativeOverride } from './lib/prompts';
import { assertLocalBaseUrl, cameraMove, checkWorkflow, comboOptions, guardFetch, VramSampler, type ObjectInfo, type VramStats } from './lib/comfy';

const DEFAULT_PROXY_URL = 'http://127.0.0.1:8189';
const DEFAULT_COMFYUI_URL = 'http://127.0.0.1:8188';
const SDK_VERSION = '0.5.0';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
// `npm run -w` changes directory; resolve user paths against where npm was called.
const callerDir = process.env.INIT_CWD ?? process.cwd();
const fromCaller = (path: string) => (isAbsolute(path) ? path : resolve(callerDir, path));

const { values: args } = parseArgs({
  options: {
    'base-url': { type: 'string', default: DEFAULT_PROXY_URL },
    comfyui: { type: 'string', default: DEFAULT_COMFYUI_URL },
    preset: { type: 'string', default: 'crash-push' },
    model: { type: 'string' },
    image: { type: 'string' },
    resolution: { type: 'string' },
    seed: { type: 'string', default: '42' },
    runs: { type: 'string', default: '1' },
    out: { type: 'string' },
    'camera-pose': { type: 'string' },
    'camera-speed': { type: 'string' },
    prompt: { type: 'string' },
    negative: { type: 'string' },
    vram: { type: 'string', default: 'auto' },
    'timeout-min': { type: 'string', default: '30' },
    'dry-run': { type: 'boolean', default: false },
    extension: { type: 'string' },
    input: { type: 'string' },
    input2: { type: 'string' },
    input3: { type: 'string' },
    outfit: { type: 'string' },
    mask: { type: 'string' },
    end: { type: 'string' },
    effect: { type: 'string', default: 'all' },
    hook: { type: 'string' },
    quality: { type: 'boolean', default: false },
    look: { type: 'string' },
    clip: { type: 'string' },
    smooth: { type: 'boolean', default: false },
    motion: { type: 'string' },
    audio: { type: 'string' },
    voice: { type: 'string' },
    text: { type: 'string', multiple: true, default: [] },
    language: { type: 'string', default: 'en' },
    duration: { type: 'string', default: '10' },
    t2i: { type: 'string', multiple: true, default: [] },
    help: { type: 'boolean', default: false },
  },
});

const vramMode = args.vram as 'auto' | 'comfyui' | 'none';

if (args.help) {
  console.log(`Usage: npm run smoke -w @montagio/infra-runpod -- [options]
  --base-url URL     comfy-api-proxy base URL (default ${DEFAULT_PROXY_URL}); Comfy-hosted URLs are refused
  --comfyui URL      ComfyUI URL for diagnostics: /object_info, /system_stats (default ${DEFAULT_COMFYUI_URL}; "none" to skip)
  --preset ID[,ID]   preset id(s), or "all" (default crash-push)
  --model ID         model id (default: each preset's preferred model)
  --image PATH       start image (default demo-assets/images/sample-16x9.png)
  --resolution R     480p or 720p (default: the preset's)
  --seed N           seed of the first run, +1 per run (default 42)
  --runs N           runs per preset; the first one includes model loading (default 1)
  --camera-pose P    override the pose: a value, a comma list, or "all" (every value ComfyUI accepts)
  --camera-speed S   override the speed: a number or a comma list, e.g. 0.5,1,2
  --prompt TEXT      what the photo shows, written before the preset's text (the Studio's description field)
  --negative TEXT    replace the preset's negative; "wan" = the official Wan templates' default negative
  --out DIR          results folder (default s1-results)
  --vram MODE        auto (nvidia-smi, else /system_stats), comfyui (/system_stats only: use it through an SSH tunnel), none
  --timeout-min N    give up on a job after N minutes (default 30)
  --dry-run          compile and write the workflows, contact nothing

Extensions (instead of presets):
  --extension LIST   edit, compose, effect, hook (= hook-edit then transition), voice, avatar, music, upscale, motion,
                     restyle (comma list) or "all"; restyle-edit,restyle restyles the clip's first frame, then keeps it
  --input PATH       the photo of edit, effect, hook and avatar (default demo-assets/images/sample-16x9.png); restyle
                     run alone: a look to follow (without --input, the text alone)
  --effect LIST      the effects to run, e.g. squish,explode, or "all" (default all)
  --hook ID          the hook of hook-edit and transition (default iris-dive)
  --input2 PATH      the second image of a two-reference hook (the outfit of wardrobe-swap), or compose's character
  --input3 PATH      compose: the product (--input is the place); with effect, the effects animate the composed photo
  --outfit PATH      compose: an outfit the character (--input2) wears, without a place; with motion, the composed
                     character, seen full body, performs the motion
  --mask PATH        edit: inpaint through this mask (white where the photo changes, the photo's size)
  --end PATH         the end frame of a transition run alone; without it, the hook's edit runs first and makes it
  --quality          the edit, the effects and the transition without their 4-step LoRAs (more steps, slower)
  --look LOOK        a look of the edit job: infl8, action or angles
  --clip PATH        the clip to upscale (required by upscale)
  --smooth           upscale: RIFE frames in between, twice the clip's frame rate (16 to 32 fps for Wan)
  --motion PATH      the reference video of the motion transfer, or the clip to restyle (required by motion and restyle):
                     its first 5 s are kept, at 16 fps, silent
  --audio PATH       the speech of avatar; without it, the voice job runs first and the avatar speaks its output
  --voice PATH       voice: speak with this sample (a consented recording, mono FLAC) instead of the built-in voice
  --text [JOB=]TEXT  the edit instruction, the effects' subject, the words to say, the music description or the
                     restyle's new look (each has a default), for the one job of the run that reads a text; when
                     several do, name it: --text edit=… --text effect=… --text voice=… --text music=… --text restyle=…
                     (repeatable)
  --language en|fr   the language of the voice (default en)
  --duration S       music: the length of the film it goes under (default 10)

Text to image (instead of presets), the app's t2i model (Z-Image-Turbo):
  --t2i NAME[@ASPECT]=TEXT   one image per --t2i (repeatable), 16:9 unless @9:16 or @1:1, at --resolution
                             (720p by default), seeds from --seed; saved as clips/<date>__t2i-NAME__<model>__r1.png`);
  process.exit(0);
}

type SmokeRecord = {
  at: string;
  preset: string;
  model: string;
  run: number;
  status: string;
  error: unknown;
  camera: { mode: string; pose: string | null; pose_2: string | null; combine: string | null; speed: number | null };
  /** The texts the model got: the preset's, after --prompt and --negative. */
  prompt: string;
  negative: string;
  width: number;
  height: number;
  frames: number;
  fps: number;
  duration_s: number;
  seed: number;
  /** The start image: its file name and sha256 (the showcase ingests only clips of its exact sample photo). */
  image: string;
  image_sha256: string;
  wall_s: number | null;
  exec_s: number | null;
  metrics: unknown;
  vram: VramStats | null;
  outputs: string[];
  comfyui_version: string | null;
  gpu: string | null;
  sdk: string;
  base_url: string;
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

function seconds(ms: number): number {
  return Math.round(ms / 100) / 10;
}

async function main(): Promise<number> {
  const target = assertLocalBaseUrl(args['base-url']);
  if (!target.loopback) console.warn(`warning: ${target.base} is not a loopback address; make sure it is your own proxy`);
  const comfyuiUrl = args.comfyui === 'none' ? null : args.comfyui.replace(/\/+$/, '');
  const outDir = fromCaller(args.out ?? join(repoRoot, 's1-results'));
  const imagePath = args.image ? fromCaller(args.image) : join(repoRoot, 'demo-assets', 'images', 'sample-16x9.png');
  const runs = Math.max(1, Number.parseInt(args.runs, 10) || 1);
  const firstSeed = Number.parseInt(args.seed, 10) || 0;
  const timeoutMs = Number(args['timeout-min']) * 60_000;
  const resolution = args.resolution as Resolution | undefined;
  if (!['auto', 'comfyui', 'none'].includes(vramMode)) throw new Error('--vram must be auto, comfyui or none');
  if (resolution && resolution !== '480p' && resolution !== '720p') throw new Error(`--resolution must be 480p or 720p`);

  const library = await loadLibrary(repoRoot);
  const negative = negativeOverride(args.negative);
  if ((args.prompt !== undefined || negative !== undefined) && (args.extension || args.t2i.length > 0)) {
    throw new Error('--prompt and --negative apply to the camera presets, not to --extension or --t2i (use --text)');
  }
  if (args.extension) return runExtensions(library, target, comfyuiUrl, outDir, timeoutMs);
  if (args.t2i.length > 0) return runImages(library, target, comfyuiUrl, outDir, timeoutMs, resolution);
  const presetIds = args.preset === 'all' ? [...library.presets.keys()] : args.preset.split(',').map((id) => id.trim());
  const { width: imageWidth, height: imageHeight } = imageSize(await readFile(imagePath));
  const aspect = pickAspect(imageWidth, imageHeight);
  const startImage = await imageFingerprint(imagePath);
  await mkdir(join(outDir, 'workflows'), { recursive: true });
  await mkdir(join(outDir, 'clips'), { recursive: true });

  // Compile everything first: a typo in a preset id fails before any GPU second is spent.
  const jobs = presetIds.map((presetId) => {
    const preset = library.presets.get(presetId);
    if (!preset) throw new Error(`unknown preset "${presetId}" (known: ${[...library.presets.keys()].join(', ')})`);
    const modelId = args.model ?? preset.models.preferred;
    const model = library.models.get(modelId);
    if (!model) throw new Error(`unknown model "${modelId}" (known: ${[...library.models.keys()].join(', ')})`);
    const template = library.templates.get(model.workflow)!;
    const imageBinding = model.bindings.image;
    if (!imageBinding) throw new Error(`model ${model.id} has no image binding`);
    if (negative !== undefined && !model.bindings.negative) throw new Error(`--negative: model ${model.id} has no negative prompt`);
    return { preset, model, template, imageBinding };
  });

  let client: Comfy | null = null;
  let objectInfo: ObjectInfo | null = null;
  let comfyuiVersion: string | null = null;
  let gpu: string | null = null;
  if (!args['dry-run']) {
    // The SDK takes no base URL argument and falls back to Comfy Cloud when
    // COMFY_BASE_URL is blank: set it explicitly, and never forward a cloud key.
    process.env.COMFY_BASE_URL = target.base;
    delete process.env.COMFY_API_KEY;
    const guarded = guardFetch(target.url);
    client = new Comfy({ fetch: guarded, clientInfo: 'montagio-smoke/0.1' });
    const health = await guarded(`${target.base}/api/v2/health`);
    if (!health.ok) throw new Error(`comfy-api-proxy health check failed: HTTP ${health.status}`);
    console.log(`proxy ${target.base}: healthy`);

    if (comfyuiUrl) {
      const stats = await getJson<{ system?: { comfyui_version?: string }; devices?: { name?: string }[] }>(`${comfyuiUrl}/system_stats`);
      comfyuiVersion = stats.system?.comfyui_version ?? null;
      gpu = stats.devices?.[0]?.name ?? null;
      objectInfo = await getJson<ObjectInfo>(`${comfyuiUrl}/object_info`);
      const cameraNodes = Object.fromEntries(Object.entries(objectInfo).filter(([name]) => /wan|camera/i.test(name)));
      await writeFile(join(outDir, 'object_info-wan-camera.json'), `${JSON.stringify(cameraNodes, null, 2)}\n`);
      const camera = objectInfo.WanCameraEmbedding?.input;
      const poses = comboOptions(camera?.required?.camera_pose ?? camera?.optional?.camera_pose);
      console.log(`ComfyUI ${comfyuiVersion ?? '?'} on ${gpu ?? '?'}`);
      console.log(poses ? `WanCameraEmbedding.camera_pose accepts: ${poses.join(', ')}` : 'WanCameraEmbedding is not installed');
    }
  }

  // Camera sweep (session question: which poses and speeds hold up): override
  // the compiled pose/speed with every value given, "all" = what ComfyUI accepts.
  const cameraInfo = objectInfo?.WanCameraEmbedding?.input;
  const knownPoses = comboOptions(cameraInfo?.required?.camera_pose ?? cameraInfo?.optional?.camera_pose)?.map(String) ?? Object.values(CAMERA_POSE_VALUES);
  const poses: (string | null)[] = !args['camera-pose'] ? [null] : args['camera-pose'] === 'all' ? knownPoses : args['camera-pose'].split(',').map((p) => p.trim());
  const speeds: (number | null)[] = args['camera-speed'] ? args['camera-speed'].split(',').map(Number) : [null];
  if (speeds.some((speed) => speed !== null && !Number.isFinite(speed))) throw new Error('--camera-speed takes numbers, e.g. 0.5,1,2');
  const variants = poses.flatMap((pose) => speeds.map((speed) => ({ pose, speed })));
  const sweeping = variants.some((v) => v.pose !== null || v.speed !== null);

  const records: SmokeRecord[] = [];
  for (const { preset, model, template, imageBinding } of jobs) {
    if (sweeping && (!model.bindings.camera_pose || !model.bindings.camera_speed)) {
      throw new Error(`--camera-pose/--camera-speed need a parametric camera model; ${model.id} has none`);
    }
    for (const variant of variants) for (let run = 1; run <= runs; run++) {
      const seed = firstSeed + run - 1;
      const { workflow, params } = compileJob(preset, model, template, {
        imageRef: basename(imagePath),
        ...(args.prompt ? { userPrompt: args.prompt } : {}),
        seed,
        aspect,
        resolution,
      });
      if (negative !== undefined) {
        workflow[model.bindings.negative!.node]!.inputs[model.bindings.negative!.field] = negative;
        params.negative = negative;
      }
      if (variant.pose !== null) {
        workflow[model.bindings.camera_pose!.node]!.inputs[model.bindings.camera_pose!.field] = variant.pose;
        params.cameraPose = variant.pose;
      }
      if (variant.speed !== null) {
        workflow[model.bindings.camera_speed!.node]!.inputs[model.bindings.camera_speed!.field] = variant.speed;
        params.cameraSpeed = variant.speed;
      }
      const slug = sweeping ? `__${String(params.cameraPose).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-x${params.cameraSpeed}` : '';
      const tag = `${preset.id}__${model.id}${slug}`;
      await writeFile(join(outDir, 'workflows', `${tag}.api.json`), `${JSON.stringify(workflow, null, 2)}\n`);
      const record: SmokeRecord = {
        at: new Date().toISOString(),
        preset: preset.id,
        model: model.id,
        run,
        status: 'compiled',
        error: null,
        camera: { mode: params.cameraMode, pose: params.cameraPose, pose_2: params.cameraPose2, combine: params.cameraCombine, speed: params.cameraSpeed },
        prompt: params.prompt,
        negative: params.negative,
        width: params.width,
        height: params.height,
        frames: params.frames,
        fps: params.fps,
        duration_s: params.duration_s,
        seed,
        ...startImage,
        wall_s: null,
        exec_s: null,
        metrics: null,
        vram: null,
        outputs: [],
        comfyui_version: comfyuiVersion,
        gpu,
        sdk: SDK_VERSION,
        base_url: target.base,
      };
      console.log(
        `\n▶ ${preset.id} on ${model.id} (run ${run}/${runs}): ${params.width}x${params.height}, ${params.frames} frames @ ${params.fps} fps, ` +
          `camera ${params.cameraMode}${params.cameraPose ? ` "${cameraMove(params)}" speed ${params.cameraSpeed}` : ''}`,
      );

      if (client) {
        const problems = objectInfo ? checkWorkflow(workflow, objectInfo, { skip: [`${imageBinding.node}.${imageBinding.field}`] }) : [];
        if (problems.length > 0) {
          record.status = 'preflight-failed';
          record.error = problems;
          for (const problem of problems) console.error(`  ✗ ${problem}`);
        } else {
          await runJob(client, workflow, [{ ...imageBinding, path: imagePath }], comfyuiUrl, timeoutMs, record, outDir, tag);
        }
        await appendFile(join(outDir, 'smoke.jsonl'), `${JSON.stringify(record)}\n`);
      }
      records.push(record);
    }
  }

  console.log('\npreset         model                       camera                  run  status            wall s  exec s  peak VRAM MiB');
  for (const r of records) {
    const move = cameraMove({ cameraPose: r.camera.pose, cameraPose2: r.camera.pose_2, cameraCombine: r.camera.combine as 'together' | 'then' | null });
    const camera = move ? `${move} x${r.camera.speed}` : r.camera.mode;
    console.log(
      `${r.preset.padEnd(14)} ${r.model.padEnd(27)} ${camera.padEnd(23)} ${String(r.run).padEnd(4)} ${r.status.padEnd(17)} ` +
        `${String(r.wall_s ?? '-').padStart(6)}  ${String(r.exec_s ?? '-').padStart(6)}  ${String(r.vram?.peakMiB ?? '-').padStart(13)}`,
    );
  }
  console.log(`\nresults: ${relative(callerDir, outDir) || '.'}${args['dry-run'] ? ' (dry run: workflows only)' : '/smoke.jsonl'}`);
  return records.every((r) => r.status === 'succeeded' || r.status === 'compiled') ? 0 : 1;
}

/** The sha256 of the photo an extension job reads, for the showcase's ingest. */
async function photoSha256(job: ExtensionJob): Promise<string | null> {
  const photo = photoFile(job);
  return photo ? (await imageFingerprint(photo)).image_sha256 : null;
}

/** What runJob fills in, for a preset clip as for an extension job. */
type RunRecord = Pick<SmokeRecord, 'at' | 'run' | 'status' | 'error' | 'metrics' | 'exec_s' | 'wall_s' | 'vram' | 'outputs'>;

async function runJob(
  client: Comfy,
  workflow: ApiWorkflow,
  files: { node: string; field: string; path: string }[],
  comfyuiUrl: string | null,
  timeoutMs: number,
  record: RunRecord,
  outDir: string,
  tag: string,
): Promise<void> {
  const wf = client.workflows.fromJson(structuredClone(workflow) as WorkflowGraph);
  for (const file of files) wf.setInput(file.node, file.field, client.assets.fromFile(file.path));

  const sampler = new VramSampler(comfyuiUrl, vramMode);
  const vramSource = await sampler.start();
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new Error(`timed out after ${timeoutMs / 60_000} min`)), timeoutMs);
  let job: Job | null = null;
  // Ctrl+C cancels the render on the GPU instead of leaving it running.
  const onSigint = () => {
    console.error('\ninterrupted: canceling the job');
    void job?.cancel().catch(() => undefined);
    controller.abort(new Error('interrupted'));
  };
  process.once('SIGINT', onSigint);
  const started = performance.now();
  try {
    job = await client.submit(wf, { signal: controller.signal });
    console.log(`  job ${job.id} submitted (VRAM sampled with ${vramSource})`);
    let lastPrint = 0;
    for await (const event of job.events(controller.signal)) {
      if (event.kind === 'progress' && performance.now() - lastPrint > 2000) {
        lastPrint = performance.now();
        const step = event.steps ? ` step ${event.step ?? '?'}/${event.steps}` : '';
        console.log(`  ${Math.round(event.value * 100)}% ${event.currentNodeClass ?? ''}${step}`);
      } else if (event.kind === 'statusChange') {
        console.log(`  status: ${event.status}`);
      }
    }
    await job.wait(undefined, controller.signal);
    record.status = job.status;
    record.error = job.error ?? null;
    record.metrics = job.metrics ?? null;
    if (job.startedAt && job.completedAt) record.exec_s = seconds(job.completedAt.getTime() - job.startedAt.getTime());
  } catch (error) {
    record.status = controller.signal.aborted ? 'aborted' : 'error';
    record.error = (error as Error).message;
    console.error(`  ✗ ${(error as Error).message}`);
  } finally {
    clearTimeout(deadline);
    process.off('SIGINT', onSigint);
    record.wall_s = seconds(performance.now() - started);
    record.vram = sampler.stop();
  }

  if (job && record.status === 'succeeded') {
    const stamp = record.at.replace(/[:.]/g, '-');
    for (const [index, output] of job.outputs.entries()) {
      const name = `${stamp}__${tag}__r${record.run}${index > 0 ? `-${index}` : ''}${extname(output.name) || '.bin'}`;
      await output.toFile(join(outDir, 'clips', name));
      record.outputs.push(`clips/${name}`);
    }
    console.log(`  ✓ ${record.wall_s}s wall, ${record.exec_s ?? '?'}s exec, peak ${record.vram.peakMiB ?? '?'} MiB → ${record.outputs.join(', ') || '(no output)'}`);
  } else if (record.status !== 'aborted' && record.status !== 'error') {
    console.error(`  ✗ job ended ${record.status}: ${JSON.stringify(record.error)}`);
  }
}

/**
 * The SDK client on the proxy, and what ComfyUI says about itself; nothing in a dry run. The SDK
 * takes no base URL argument and falls back to Comfy Cloud when COMFY_BASE_URL is blank: set it
 * explicitly, and never forward a cloud key.
 */
async function connect(
  target: { base: string; url: URL },
  comfyuiUrl: string | null,
): Promise<{ client: Comfy | null; objectInfo: ObjectInfo | null; comfyuiVersion: string | null; gpu: string | null }> {
  if (args['dry-run']) return { client: null, objectInfo: null, comfyuiVersion: null, gpu: null };
  process.env.COMFY_BASE_URL = target.base;
  delete process.env.COMFY_API_KEY;
  const guarded = guardFetch(target.url);
  const client = new Comfy({ fetch: guarded, clientInfo: 'montagio-smoke/0.1' });
  const health = await guarded(`${target.base}/api/v2/health`);
  if (!health.ok) throw new Error(`comfy-api-proxy health check failed: HTTP ${health.status}`);
  if (!comfyuiUrl) return { client, objectInfo: null, comfyuiVersion: null, gpu: null };
  const stats = await getJson<{ system?: { comfyui_version?: string }; devices?: { name?: string }[] }>(`${comfyuiUrl}/system_stats`);
  return {
    client,
    objectInfo: await getJson<ObjectInfo>(`${comfyuiUrl}/object_info`),
    comfyuiVersion: stats.system?.comfyui_version ?? null,
    gpu: stats.devices?.[0]?.name ?? null,
  };
}

type ExtensionRecord = RunRecord & {
  /** "image": a text-to-image job of --t2i, which the showcase's ingest leaves out. */
  kind: 'extension' | 'image';
  /** The job and the effect or hook it runs, e.g. "effect:squish". */
  job: string;
  model: string;
  params: Record<string, unknown>;
  inputs: string[];
  /** The sha256 of the photo the job read (the showcase ingests only examples of its exact sample photo); null without one. */
  image_sha256: string | null;
  comfyui_version: string | null;
  gpu: string | null;
  sdk: string;
  base_url: string;
};

/**
 * The extension jobs (edit, effects, hooks, voice, avatar, music, upscale): compiled first,
 * checked against the running ComfyUI's /object_info, run one after the other, timed, with
 * peak VRAM, their outputs downloaded into <out>/clips. Without --audio, the avatar speaks the
 * voice job's output; without --end, a hook's transition ends on its edit's output; with compose,
 * the effects animate the composed photo. The definitions of the nodes used are kept in
 * <out>/object_info-extensions.json, as this ComfyUI declares them.
 */
async function runExtensions(
  library: Library,
  target: { base: string; url: URL },
  comfyuiUrl: string | null,
  outDir: string,
  timeoutMs: number,
): Promise<number> {
  const asked =
    args.extension === 'all'
      ? [...EXTENSION_JOBS]
      : args.extension!.split(',').flatMap((name) => (name.trim() === 'hook' ? ['hook-edit', 'transition'] : [name.trim()]));
  for (const name of asked) {
    if (!(EXTENSION_JOBS as readonly string[]).includes(name)) throw new Error(`unknown extension job "${name}" (known: ${EXTENSION_JOBS.join(', ')})`);
  }
  if (args.language !== 'en' && args.language !== 'fr') throw new Error('--language must be en or fr');
  const duration_s = Number(args.duration);
  if (!(duration_s > 0)) throw new Error('--duration takes a number of seconds');
  const names = EXTENSION_JOBS.filter((name) => asked.includes(name));
  // Without a speech file, the avatar speaks the voice job's output: the voice runs first.
  const chained = names.includes('avatar') && !args.audio;
  if (chained && !names.includes('voice')) names.splice(names.indexOf('avatar'), 0, 'voice');
  // Without an end frame, the transition ends on the hook's edit: the edit runs first.
  const chainedHook = names.includes('transition') && !args.end;
  if (chainedHook && !names.includes('hook-edit')) names.splice(names.indexOf('transition'), 0, 'hook-edit');
  // With a composition, the effects animate the composed photo, or its character performs the motion: the composition runs first.
  const chainedCompose = names.includes('compose') && (names.includes('effect') || names.includes('motion'));
  // With restyle-edit, the restyle keeps the clip's first frame as the edit restyled it.
  const chainedRestyle = names.includes('restyle-edit') && names.includes('restyle');
  // Each text feeds one job (the voice, for an avatar that speaks its output).
  const text = jobTexts(args.text, names);

  let input = args.input ? fromCaller(args.input) : join(repoRoot, 'demo-assets', 'images', 'sample-16x9.png');
  const input2 = args.input2 ? fromCaller(args.input2) : undefined;
  const input3 = args.input3 ? fromCaller(args.input3) : undefined;
  const outfit = args.outfit ? fromCaller(args.outfit) : undefined;
  const mask = args.mask ? fromCaller(args.mask) : undefined;
  let end = args.end ? fromCaller(args.end) : undefined;
  const clip = args.clip ? fromCaller(args.clip) : undefined;
  // The photo sizes the jobs that read it; the clip to upscale is probed on its own, so that
  // "--extension all" never upscales it to the photo's aspect nor past the model's frame limit.
  let aspect: Aspect = '16:9';
  if (names.some((name) => name !== 'voice' && name !== 'music' && name !== 'upscale')) {
    const { width, height } = imageSize(await readFile(input));
    aspect = pickAspect(width, height);
  }
  let clipAspect: Aspect | undefined;
  let clipFrames: number | undefined;
  if (clip && names.includes('upscale')) {
    const { width, height, duration_s, fps } = await probe(clip);
    clipAspect = pickAspect(width, height);
    clipFrames = Math.round(duration_s * fps);
  }
  // The clip of the motion transfer or of the restyle is prepared first (5 s at 16 fps, silent), and sizes its own job.
  let motion: string | undefined;
  let motion_s: number | undefined;
  let motionAspect: Aspect | undefined;
  let restyleFrame: string | undefined;
  if (names.some((name) => name === 'motion' || name === 'restyle' || name === 'restyle-edit')) {
    if (args['dry-run']) {
      motion = args.motion ? fromCaller(args.motion) : 'motion.mp4';
      motion_s = 5;
      motionAspect = '9:16';
      restyleFrame = input;
    } else if (args.motion) {
      await mkdir(join(outDir, 'inputs'), { recursive: true });
      motion = join(outDir, 'inputs', 'motion.mp4');
      const prepared = await prepareMotionClip(fromCaller(args.motion), motion);
      motion_s = prepared.duration_s;
      motionAspect = pickAspect(prepared.width, prepared.height);
      if (names.includes('restyle-edit')) {
        restyleFrame = join(outDir, 'inputs', 'first-frame.png');
        await extractFirstFrame(motion, restyleFrame);
      }
    }
  }
  // The restyle's reference: the restyled first frame (set once restyle-edit has run), the photo given, or none.
  let restyleReference: { path: string; mode: 'first-frame' | 'look' } | undefined = chainedRestyle
    ? args['dry-run']
      ? { path: input, mode: 'first-frame' }
      : undefined
    : args.input
      ? { path: input, mode: 'look' }
      : undefined;
  let audio = args.audio ? fromCaller(args.audio) : undefined;
  let audio_s = audio ? (await probeAudio(audio))?.duration_s : undefined;
  if (audio && !audio_s) throw new Error(`no audio stream in ${audio}`);
  const options = (jobs: ExtensionJobName[]) => ({
    jobs,
    input,
    input2,
    input3,
    outfit,
    composeFullBody: names.includes('motion'),
    mask,
    ...(args.voice ? { voice: fromCaller(args.voice) } : {}),
    end: end ?? (args['dry-run'] ? 'end.png' : undefined),
    effects: args.effect === 'all' ? undefined : args.effect.split(',').map((id) => id.trim()),
    hook: args.hook,
    fast: !args.quality,
    look: args.look,
    clip,
    clipAspect,
    clipFrames,
    smooth: args.smooth,
    motion,
    motion_s,
    motionAspect,
    restyleFrame,
    restyleReference,
    audio: audio ?? (args['dry-run'] ? 'speech.flac' : undefined),
    audio_s: audio_s ?? (args['dry-run'] ? 5 : undefined),
    text,
    language: args.language as 'en' | 'fr',
    duration_s,
    seed: Number.parseInt(args.seed, 10) || 0,
    aspect,
  });
  // Compile what can be compiled now: a missing file fails before any GPU second is spent.
  const first = names.filter(
    (name) =>
      args['dry-run'] ||
      !((chained && name === 'avatar') || (chainedHook && name === 'transition') || (chainedCompose && (name === 'effect' || name === 'motion')) || (chainedRestyle && name === 'restyle')),
  );
  const jobs = extensionJobs(library, options(first));
  await mkdir(join(outDir, 'workflows'), { recursive: true });
  await mkdir(join(outDir, 'clips'), { recursive: true });

  const { client, objectInfo, comfyuiVersion, gpu } = await connect(target, comfyuiUrl);

  const records: ExtensionRecord[] = [];
  const classes = new Set<string>();
  const run = async (job: ExtensionJob): Promise<ExtensionRecord> => {
    for (const node of Object.values(job.workflow)) classes.add(node.class_type);
    const tag = `ext-${job.tag.replace(':', '-')}__${job.model.id}`;
    await writeFile(join(outDir, 'workflows', `${tag}.api.json`), `${JSON.stringify(job.workflow, null, 2)}\n`);
    const record: ExtensionRecord = {
      kind: 'extension',
      at: new Date().toISOString(),
      job: job.tag,
      model: job.model.id,
      run: 1,
      status: 'compiled',
      error: null,
      params: job.params,
      inputs: job.files.map((file) => basename(file.path)),
      image_sha256: await photoSha256(job),
      wall_s: null,
      exec_s: null,
      metrics: null,
      vram: null,
      outputs: [],
      comfyui_version: comfyuiVersion,
      gpu,
      sdk: SDK_VERSION,
      base_url: target.base,
    };
    console.log(`\n▶ ${job.tag} on ${job.model.id}: ${JSON.stringify(job.params)}`);
    if (client) {
      const skip = job.files.map((file) => `${file.node}.${file.field}`);
      const problems = objectInfo ? checkWorkflow(job.workflow, objectInfo, { skip }) : [];
      if (problems.length > 0) {
        record.status = 'preflight-failed';
        record.error = problems;
        for (const problem of problems) console.error(`  ✗ ${problem}`);
      } else {
        await runJob(client, job.workflow, job.files, comfyuiUrl, timeoutMs, record, outDir, tag);
      }
      await appendFile(join(outDir, 'smoke.jsonl'), `${JSON.stringify(record)}\n`);
    }
    records.push(record);
    return record;
  };

  for (const job of jobs) {
    const record = await run(job);
    if (chained && job.name === 'voice' && !args['dry-run']) {
      const speech = record.outputs[0];
      if (record.status !== 'succeeded' || !speech) {
        console.error('  ✗ no speech for the avatar: the avatar job is skipped');
        continue;
      }
      audio = join(outDir, speech);
      audio_s = (await probeAudio(audio))?.duration_s;
      const [avatar] = extensionJobs(library, options(['avatar']));
      await run(avatar!);
    }
    if (chainedHook && job.name === 'hook-edit' && !args['dry-run']) {
      const frame = record.outputs[0];
      if (record.status !== 'succeeded' || !frame) {
        console.error('  ✗ no end frame for the transition: the transition job is skipped');
        continue;
      }
      end = join(outDir, frame);
      const [transition] = extensionJobs(library, options(['transition']));
      await run(transition!);
    }
    if (chainedCompose && job.name === 'compose' && !args['dry-run']) {
      const photo = record.outputs[0];
      if (record.status !== 'succeeded' || !photo) {
        console.error('  ✗ no composed photo for the effects: the effect jobs are skipped');
        continue;
      }
      input = join(outDir, photo);
      const { width, height } = imageSize(await readFile(input));
      aspect = pickAspect(width, height);
      for (const next of extensionJobs(library, options(names.filter((name) => name === 'effect' || name === 'motion')))) await run(next);
    }
    if (chainedRestyle && job.name === 'restyle-edit' && !args['dry-run']) {
      const frame = record.outputs[0];
      if (record.status !== 'succeeded' || !frame) {
        console.error('  ✗ no restyled first frame: the restyle job is skipped');
        continue;
      }
      restyleReference = { path: join(outDir, frame), mode: 'first-frame' };
      const [restyle] = extensionJobs(library, options(['restyle']));
      await run(restyle!);
    }
  }

  // The nodes' definitions on this ComfyUI, merged across the runs of a series: the tests' fixture is checked against them.
  if (objectInfo) {
    const file = join(outDir, 'object_info-extensions.json');
    const kept = await readFile(file, 'utf8').then((text) => JSON.parse(text) as ObjectInfo, () => ({}) as ObjectInfo);
    for (const name of classes) if (objectInfo[name]) kept[name] = objectInfo[name];
    await writeFile(file, `${JSON.stringify(kept, null, 2)}\n`);
  }

  console.log('\njob                      model                       status            wall s  exec s  peak VRAM MiB');
  for (const r of records) {
    console.log(
      `${r.job.padEnd(24)} ${r.model.padEnd(27)} ${r.status.padEnd(17)} ` +
        `${String(r.wall_s ?? '-').padStart(6)}  ${String(r.exec_s ?? '-').padStart(6)}  ${String(r.vram?.peakMiB ?? '-').padStart(13)}`,
    );
  }
  console.log(`\nresults: ${relative(callerDir, outDir) || '.'}${args['dry-run'] ? ' (dry run: workflows only)' : '/smoke.jsonl'}`);
  return records.every((r) => r.status === 'succeeded' || r.status === 'compiled') ? 0 : 1;
}

/**
 * Text to image (--t2i): the test photos of a GPU session, made by the app's t2i model through
 * the same compiler as the Studio, each timed with its peak VRAM (checklist part 5.4).
 */
async function runImages(
  library: Library,
  target: { base: string; url: URL },
  comfyuiUrl: string | null,
  outDir: string,
  timeoutMs: number,
  resolution: Resolution | undefined,
): Promise<number> {
  const prompts = imagePrompts(args.t2i);
  const model = args.model ? library.models.get(args.model) : [...library.models.values()].find((m) => m.capabilities.includes('t2i'));
  if (!model || !model.capabilities.includes('t2i')) throw new Error(`no text-to-image model${args.model ? ` "${args.model}"` : ''} in the registry`);
  const template = library.templates.get(model.workflow)!;
  const firstSeed = Number.parseInt(args.seed, 10) || 0;
  // Compile everything first: a text too long fails before any GPU second is spent.
  const jobs = prompts.map((prompt, index) => ({
    prompt,
    ...compileImage(model, template, { prompt: prompt.text, seed: firstSeed + index, aspect: prompt.aspect, ...(resolution ? { resolution } : {}) }),
  }));
  await mkdir(join(outDir, 'workflows'), { recursive: true });
  await mkdir(join(outDir, 'clips'), { recursive: true });
  const { client, objectInfo, comfyuiVersion, gpu } = await connect(target, comfyuiUrl);

  const records: ExtensionRecord[] = [];
  for (const { prompt, workflow, params } of jobs) {
    const tag = `t2i-${prompt.name}__${model.id}`;
    await writeFile(join(outDir, 'workflows', `${tag}.api.json`), `${JSON.stringify(workflow, null, 2)}\n`);
    const record: ExtensionRecord = {
      kind: 'image',
      at: new Date().toISOString(),
      job: `t2i:${prompt.name}`,
      model: model.id,
      run: 1,
      status: 'compiled',
      error: null,
      params,
      inputs: [],
      image_sha256: null,
      wall_s: null,
      exec_s: null,
      metrics: null,
      vram: null,
      outputs: [],
      comfyui_version: comfyuiVersion,
      gpu,
      sdk: SDK_VERSION,
      base_url: target.base,
    };
    console.log(`\n▶ t2i:${prompt.name} on ${model.id}: ${params.width}x${params.height}, seed ${params.seed}`);
    if (client) {
      const problems = objectInfo ? checkWorkflow(workflow, objectInfo) : [];
      if (problems.length > 0) {
        record.status = 'preflight-failed';
        record.error = problems;
        for (const problem of problems) console.error(`  ✗ ${problem}`);
      } else {
        await runJob(client, workflow, [], comfyuiUrl, timeoutMs, record, outDir, tag);
      }
      await appendFile(join(outDir, 'smoke.jsonl'), `${JSON.stringify(record)}\n`);
    }
    records.push(record);
  }

  console.log('\nimage                    model                       status            wall s  exec s  peak VRAM MiB');
  for (const r of records) {
    console.log(
      `${r.job.padEnd(24)} ${r.model.padEnd(27)} ${r.status.padEnd(17)} ` +
        `${String(r.wall_s ?? '-').padStart(6)}  ${String(r.exec_s ?? '-').padStart(6)}  ${String(r.vram?.peakMiB ?? '-').padStart(13)}`,
    );
  }
  console.log(`\nresults: ${relative(callerDir, outDir) || '.'}${args['dry-run'] ? ' (dry run: workflows only)' : '/smoke.jsonl'}`);
  return records.every((r) => r.status === 'succeeded' || r.status === 'compiled') ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`smoke: ${(error as Error).message}`);
    process.exitCode = 1;
  },
);
