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
 *
 * The SDK only ever talks to --base-url (default: the local proxy). Comfy Cloud
 * and the Router are refused, and no Router method is called.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Comfy, type Job, type WorkflowGraph } from '@comfyorg/sdk';
import { CAMERA_POSE_VALUES, compileJob, loadLibrary, pickAspect, type ApiWorkflow, type Resolution } from '@montagio/presets';
import { imageSize } from 'image-size';
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
    vram: { type: 'string', default: 'auto' },
    'timeout-min': { type: 'string', default: '30' },
    'dry-run': { type: 'boolean', default: false },
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
  --out DIR          results folder (default s1-results)
  --vram MODE        auto (nvidia-smi, else /system_stats), comfyui (/system_stats only: use it through an SSH tunnel), none
  --timeout-min N    give up on a job after N minutes (default 30)
  --dry-run          compile and write the workflows, contact nothing`);
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
  width: number;
  height: number;
  frames: number;
  fps: number;
  duration_s: number;
  seed: number;
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
  const presetIds = args.preset === 'all' ? [...library.presets.keys()] : args.preset.split(',').map((id) => id.trim());
  const { width: imageWidth, height: imageHeight } = imageSize(await readFile(imagePath));
  const aspect = pickAspect(imageWidth, imageHeight);
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
        seed,
        aspect,
        resolution,
      });
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
        width: params.width,
        height: params.height,
        frames: params.frames,
        fps: params.fps,
        duration_s: params.duration_s,
        seed,
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
          await runJob(client, workflow, imageBinding, imagePath, comfyuiUrl, timeoutMs, record, outDir, tag);
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

async function runJob(
  client: Comfy,
  workflow: ApiWorkflow,
  imageBinding: { node: string; field: string },
  imagePath: string,
  comfyuiUrl: string | null,
  timeoutMs: number,
  record: SmokeRecord,
  outDir: string,
  tag: string,
): Promise<void> {
  const wf = client.workflows.fromJson(structuredClone(workflow) as WorkflowGraph);
  wf.setInput(imageBinding.node, imageBinding.field, client.assets.fromFile(imagePath));

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

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`smoke: ${(error as Error).message}`);
    process.exitCode = 1;
  },
);
