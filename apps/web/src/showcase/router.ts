import { validatePreset } from '@montagio/presets/browser';
import type { ShowcaseData } from '@montagio/showcase/data';
import { galleryOrder } from '@/lib/gallery-order';
import { MAX_PRESET_YAML_BYTES } from '@/lib/limits';
import type { ExtensionsInfo, GenerationRecord, HistoryItem, PresetSummary, SequenceSummary, ShowcaseInfo } from '@/lib/api-types';
import { filmTags } from './montage-args';
import { MontageError, type Montage, type MontageStage } from './types';
import { BASE_PATH, urlsFor } from './urls';

/** The showcase's stand-in for the server: same routes, same JSON shapes, same error codes. */
export type ShowcaseRouter = (path: string, init?: RequestInit) => Promise<Response>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const refuse = (error: string, status: number) => json({ error }, status);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

type Clip = ShowcaseData['clips'][number];

const PROGRESS: Record<MontageStage | 'running', number> = { running: 0.1, 'loading-ffmpeg': 0.3, joining: 0.7 };
const MIN_SHOTS = 2;
const MAX_SHOTS = 3;

/**
 * Answer the Studio's /api calls in the page, from the showcase's data.json:
 * clips are pre-generated, so a generation succeeds at once; a sequence is
 * joined in the browser by `montage`, one film at a time; uploads and remix
 * renders are refused with codes the Studio explains.
 */
export function createShowcaseRouter(data: ShowcaseData, deps: { montage: Montage; newId?: () => string; base?: string }): ShowcaseRouter {
  const { showcaseUrl } = urlsFor(deps.base ?? BASE_PATH);
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const library = {
    models: new Map(data.library.models),
    templates: new Map(data.library.templates),
    lock: new Map(data.library.lock),
  };
  const presets = new Map(data.presets.map((preset) => [preset.id, preset]));
  const samples = new Map(data.samples.map((sample) => [sample.id, sample]));
  const clips = new Map(data.clips.map((clip) => [`${clip.preset}|${clip.sample}`, clip]));
  const generations = new Map<string, GenerationRecord>();
  const sequences = new Map<string, { record: SequenceSummary; controller: AbortController }>();
  // The history of this visit, newest first: nothing is kept once the page is gone.
  let visit: HistoryItem[] = [];
  const presetName = (id: string) => presets.get(id)?.name ?? id;
  let assembling: string | null = null;
  let filmUrls: string[] = [];

  /** The sample an imageRef names ("samples/<id>"), or undefined. */
  const sampleOf = (imageRef: unknown) =>
    typeof imageRef === 'string' && imageRef.startsWith('samples/') ? samples.get(imageRef.slice('samples/'.length)) : undefined;

  /** The clip of a shot, or the refusal the server would give. */
  function resolveShot(presetId: unknown, modelId: unknown, imageRef: unknown): { clip: Clip } | { refusal: string } {
    if (typeof presetId !== 'string' || !presets.has(presetId)) return { refusal: 'unknown-preset' };
    const sample = sampleOf(imageRef);
    if (!sample) return { refusal: 'unknown-image' };
    if (modelId !== undefined && modelId !== null && modelId !== '' && modelId !== data.model.id) return { refusal: 'model-not-in-showcase' };
    const clip = clips.get(`${presetId}|${sample.id}`);
    return clip ? { clip } : { refusal: 'not-in-showcase' };
  }

  async function body(init?: RequestInit): Promise<Record<string, unknown>> {
    if (typeof init?.body !== 'string') return {};
    try {
      const value = JSON.parse(init.body) as unknown;
      return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  /** The text-to-image estimate of the core model, as the server gives it. */
  function extensionsInfo(): ExtensionsInfo {
    const t2i = data.models.find((model) => model.id === 'z-image-turbo')?.estimate_s['720p'] ?? 12;
    return { extensions: [], effects: [], hooks: [], estimates: { t2i } };
  }

  function presetSummaries(): PresetSummary[] {
    const firstSample = data.samples[0]?.id;
    return galleryOrder(data.presets).map((preset) => ({
      id: preset.id,
      name: preset.name,
      description: preset.description,
      previewUrl: showcaseUrl(preset.preview),
      // The preview is the preset's clip on the first sample: it is a placeholder when that clip is.
      previewPlaceholder: clips.get(`${preset.id}|${firstSample}`)?.placeholder ?? true,
      poses: preset.poses,
      speed: preset.speed,
      defaultModel: preset.defaultModel,
    }));
  }

  function info(): ShowcaseInfo {
    return {
      samples: data.samples.map((sample) => ({
        id: sample.id,
        title: sample.title,
        aspect: sample.aspect,
        imageRef: `samples/${sample.id}`,
        url: showcaseUrl(sample.url),
        placeholder: sample.placeholder,
      })),
      model: data.model,
      capabilities: { uploads: false, remixRender: false },
      placeholders: data.clips.some((clip) => clip.placeholder),
      repoUrl: data.repoUrl,
    };
  }

  function validate(input: Record<string, unknown>): Response {
    if (typeof input.yaml !== 'string') return refuse('invalid-request', 400);
    if (new TextEncoder().encode(input.yaml).byteLength > MAX_PRESET_YAML_BYTES) return refuse('preset-too-large', 413);
    const modelId = typeof input.modelId === 'string' && input.modelId.length > 0 ? input.modelId : undefined;
    const result = validatePreset(input.yaml, 'remix.yaml', library, modelId ? { modelId } : undefined);
    if (!result.ok) return json({ error: 'invalid-preset', problems: result.problems }, 422);
    const { preset } = result;
    return json({ ok: true, preset: { id: preset.id, name: preset.name, poses: preset.camera.poses, speed: preset.camera.speed } });
  }

  function createGeneration(input: Record<string, unknown>): Response {
    if (typeof input.presetYaml === 'string') return refuse('showcase-remix', 403);
    if (typeof input.imageRef !== 'string' || typeof input.presetId !== 'string') return refuse('invalid-request', 400);
    const shot = resolveShot(input.presetId, input.modelId, input.imageRef);
    if ('refusal' in shot) return refuse(shot.refusal, 400);
    const record: GenerationRecord = {
      id: newId(),
      presetId: input.presetId,
      modelId: data.model.id,
      state: 'succeeded',
      progress: 1,
      outputUrl: showcaseUrl(shot.clip.url),
      workflowUrl: showcaseUrl(shot.clip.workflowUrl),
      placeholder: shot.clip.placeholder,
    };
    generations.set(record.id, record);
    visit = [
      {
        key: `generation:${record.id}`,
        source: 'generation',
        kind: 'clip',
        task: 'camera',
        name: presetName(input.presetId),
        modelName: data.model.name,
        createdAt: new Date().toISOString(),
        previewUrl: record.outputUrl!,
        downloadUrl: record.outputUrl!,
        reprise: { tab: 'camera', imageRef: input.imageRef, presetId: input.presetId, modelId: data.model.id },
      },
      ...visit,
    ];
    return json(record, 201);
  }

  function createSequence(input: Record<string, unknown>): Response {
    const shots = input.shots;
    if (!Array.isArray(shots) || !shots.every((shot) => typeof (shot as { presetId?: unknown })?.presetId === 'string')) {
      return refuse('invalid-shots', 400);
    }
    if (typeof input.imageRef !== 'string') return refuse('invalid-request', 400);
    if (shots.length < MIN_SHOTS || shots.length > MAX_SHOTS) return refuse('invalid-shots', 400);
    const resolved = [];
    for (const shot of shots as { presetId: string; modelId?: unknown }[]) {
      const result = resolveShot(shot.presetId, shot.modelId, input.imageRef);
      if ('refusal' in result) return refuse(result.refusal, 400);
      resolved.push(result.clip);
    }
    if (assembling !== null) return refuse('montage-busy', 409);

    const placeholder = resolved.some((clip) => clip.placeholder);
    const record: SequenceSummary = {
      id: newId(),
      state: 'running',
      shots: resolved.map((clip) => ({ presetId: clip.preset, state: 'succeeded' })),
      currentShot: resolved.length - 1,
      progress: PROGRESS.running,
      placeholder,
    };
    const controller = new AbortController();
    sequences.set(record.id, { record, controller });
    assembling = record.id;
    const answer = json(clone(record), 201);

    const stillOurs = () => record.state === 'running' || record.state === 'assembling';
    deps.montage
      .assemble(
        { clips: resolved.map((clip) => showcaseUrl(clip.url)), verticals: resolved.map((clip) => showcaseUrl(clip.verticalUrl)), tags: filmTags(placeholder) },
        controller.signal,
        (stage) => {
          if (!stillOurs()) return;
          record.state = 'assembling';
          record.stage = stage;
          record.progress = PROGRESS[stage];
        },
      )
      .then(({ film, vertical }) => {
        if (!stillOurs()) return;
        // The previous film is gone from the page: free its memory (ten trials in a row stay light).
        for (const url of filmUrls) URL.revokeObjectURL(url);
        filmUrls = [URL.createObjectURL(film), URL.createObjectURL(vertical)];
        record.outputUrl = filmUrls[0];
        record.verticalUrl = filmUrls[1];
        record.state = 'succeeded';
        record.progress = 1;
        delete record.stage;
        // Only the last film's blobs are alive: the older films leave the history with them.
        visit = [
          {
            key: `sequence:${record.id}`,
            source: 'sequence',
            kind: 'film',
            task: 'film',
            name: record.shots.map((shot) => presetName(shot.presetId)).join(' → '),
            modelName: data.model.name,
            createdAt: new Date().toISOString(),
            previewUrl: filmUrls[0]!,
            downloadUrl: filmUrls[0]!,
            reprise: { tab: 'film', imageRef: String(input.imageRef), shots: record.shots.map((shot) => ({ presetId: shot.presetId })) },
          },
          ...visit.filter((item) => item.kind !== 'film'),
        ];
      })
      .catch((error: unknown) => {
        if (!stillOurs()) return;
        const code = error instanceof MontageError ? error.code : 'ffmpeg-failed';
        record.state = code === 'canceled' ? 'canceled' : 'failed';
        if (code !== 'canceled') record.error = code;
        delete record.stage;
      })
      .finally(() => {
        if (assembling === record.id) assembling = null;
      });
    return answer;
  }

  function cancelSequence(id: string): Response {
    const entry = sequences.get(id);
    if (!entry) return refuse('not-found', 404);
    const { record, controller } = entry;
    if (record.state === 'running' || record.state === 'assembling') {
      record.state = 'canceled';
      delete record.stage;
      controller.abort();
      if (assembling === id) assembling = null;
    }
    return json(clone(record));
  }

  return async (path, init) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const { pathname } = new URL(path, 'http://showcase.invalid');
    const parts = pathname.split('/').filter(Boolean);
    if (parts[0] !== 'api') return refuse('not-found', 404);
    const [, resource, id, action] = parts;

    if (method === 'GET' && resource === 'presets' && !id) return json(presetSummaries());
    if (method === 'GET' && resource === 'presets' && id && action === 'yaml' && parts.length === 4) {
      const preset = presets.get(id);
      if (!preset) return refuse('not-found', 404);
      return new Response(preset.yaml, { headers: { 'content-type': 'application/yaml; charset=utf-8' } });
    }
    if (method === 'POST' && resource === 'presets' && id === 'validate') return validate(await body(init));
    if (method === 'GET' && resource === 'models') return json(data.models);
    if (method === 'GET' && resource === 'history' && !id) return json(visit);
    // No extension has a pre-generated example yet (they come with the GPU session S3): none is shown.
    if (method === 'GET' && resource === 'extensions' && !id) return json(extensionsInfo());
    if (method === 'GET' && resource === 'open-stack') return json(data.openStack);
    if (method === 'GET' && resource === 'showcase' && !id) return json(info());
    if (method === 'POST' && resource === 'showcase' && id === 'preload') {
      deps.montage.preload();
      return new Response(null, { status: 204 });
    }
    if (method === 'POST' && resource === 'uploads') return refuse('showcase-upload', 403);
    // Its sample photos were made from texts in advance: the showcase creates no image.
    if (method === 'POST' && resource === 'images' && !id) return refuse('showcase-t2i', 403);
    // No extension has an example in the showcase yet: their routes answer as the server answers a hidden one.
    if (method === 'POST' && !id && (resource === 'edits' || resource === 'effects' || resource === 'hooks' || resource === 'avatars')) {
      return refuse('extension-disabled', 404);
    }

    if (resource === 'generations') {
      if (method === 'POST' && !id) return createGeneration(await body(init));
      const record = id ? generations.get(id) : undefined;
      if (!record || (action !== undefined && action !== 'cancel')) return refuse('not-found', 404);
      if ((method === 'GET' && action === undefined) || (method === 'POST' && action === 'cancel')) return json(clone(record));
    }
    if (resource === 'sequences') {
      if (method === 'POST' && !id) return createSequence(await body(init));
      if (id && method === 'POST' && action === 'cancel') return cancelSequence(id);
      const entry = id ? sequences.get(id) : undefined;
      if (entry && method === 'GET' && action === undefined) return json(clone(entry.record));
    }
    return refuse('not-found', 404);
  };
}
