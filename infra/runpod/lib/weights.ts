import { spawnSync } from 'node:child_process';
import { createHash, type Hash } from 'node:crypto';
import { createReadStream, createWriteStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, rename, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { ApiWorkflow } from '@montagio/presets';
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';

const HF = 'https://huggingface.co';

/** A size for the console, in GiB (1024³ bytes): the lock's 69.7 GB are 64.91 GiB. */
export function gib(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

export function parseHfUrl(url: string): { repo: string; revision: string | null; path: string | null } {
  const parsed = new URL(url);
  if (parsed.origin !== HF) throw new Error(`${url} is not a huggingface.co URL`);
  const parts = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length < 2) throw new Error(`${url} names no huggingface repository`);
  const repo = `${parts[0]}/${parts[1]}`;
  if ((parts[2] === 'resolve' || parts[2] === 'blob') && parts.length >= 5) {
    return { repo, revision: parts[3]!, path: parts.slice(4).join('/') };
  }
  return { repo, revision: null, path: null };
}

export function resolveUrl(repo: string, path: string, revision = 'main'): string {
  return `${HF}/${repo}/resolve/${revision}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** Loader inputs that name a weight file, and the ComfyUI models/ folder they read from. */
const LOADER_FOLDERS: Record<string, Record<string, string>> = {
  UNETLoader: { unet_name: 'diffusion_models' },
  CLIPLoader: { clip_name: 'text_encoders' },
  DualCLIPLoader: { clip_name1: 'text_encoders', clip_name2: 'text_encoders' },
  VAELoader: { vae_name: 'vae' },
  CheckpointLoaderSimple: { ckpt_name: 'checkpoints' },
  LoraLoader: { lora_name: 'loras' },
  LoraLoaderModelOnly: { lora_name: 'loras' },
  CLIPVisionLoader: { clip_name: 'clip_vision' },
  AudioEncoderLoader: { audio_encoder_name: 'audio_encoders' },
  FrameInterpolationModelLoader: { model_name: 'frame_interpolation' },
  LoadDA3Model: { model_name: 'geometry_estimation' },
  DownloadAndLoadSAM2Model: { model: 'sam2' },
};

/** ComfyUI models/ folders a weight may go to (the same set as infra/local/src/pins.ts); `tts` holds the voice packs, `whisper` the captions' Whisper, `sam2` the object swap's tracker. */
const COMFY_FOLDERS = new Set([
  'checkpoints',
  'diffusion_models',
  'text_encoders',
  'vae',
  'loras',
  'clip_vision',
  'controlnet',
  'upscale_models',
  'audio_encoders',
  'frame_interpolation',
  'geometry_estimation',
  'sam2',
  'tts',
  // the Hugging Face folders of the captions' Whisper (Montagio Transcribe Words)
  'whisper',
]);

export function weightFolders(workflows: ApiWorkflow[]): Map<string, string> {
  const folders = new Map<string, string>();
  for (const workflow of workflows) {
    for (const node of Object.values(workflow)) {
      for (const [field, folder] of Object.entries(LOADER_FOLDERS[node.class_type] ?? {})) {
        const file = node.inputs[field];
        if (typeof file === 'string') folders.set(file, folder);
      }
    }
  }
  return folders;
}

/**
 * The folder the lock names first (a voice pack under tts/), else the one of the
 * workflow loaders, else the repository layout (Comfy-Org's split_files/<folder>/).
 */
export function folderFor(file: string, repoPath: string, folders: Map<string, string>, lockFolder?: string | null): string | null {
  if (lockFolder) return lockFolder;
  const fromLoader = folders.get(file);
  if (fromLoader) return fromLoader;
  const parent = repoPath.split('/').at(-2);
  return parent && COMFY_FOLDERS.has(parent) ? parent : null;
}

/** The weights of the camera presets, plus those of the extensions in `enabled`. */
export function forExtensions<T extends { extension?: string | null }>(lock: T[], enabled: readonly string[]): T[] {
  return lock.filter((entry) => !entry.extension || enabled.includes(entry.extension));
}

/** `gitSha1` is the git blob id Hugging Face gives every file; `sha256` exists only for LFS files. */
export type RepoFile = { path: string; size: number; sha256: string | null; gitSha1?: string | null };
export type RepoListing = { repo: string; gated: boolean; revision: string | null; license: string | null; files: RepoFile[] };
export type RepoInfo = Omit<RepoListing, 'files'>;

async function getJson<T>(url: string, headers: Record<string, string>): Promise<{ body: T; link: string | null }> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return { body: (await res.json()) as T, link: res.headers.get('link') };
}

/** Model card metadata of a repository: gating, current revision, declared license. */
export async function repoInfo(repo: string, headers: Record<string, string> = {}): Promise<RepoInfo> {
  const { body } = await getJson<{ gated?: boolean | string; sha?: string; cardData?: { license?: string } }>(`${HF}/api/models/${repo}`, headers);
  return { repo, gated: body.gated !== undefined && body.gated !== false, revision: body.sha ?? null, license: body.cardData?.license ?? null };
}

/** Every file of a repository at main, with the sha256 Hugging Face stores for LFS files. */
export async function listRepo(repo: string, headers: Record<string, string> = {}): Promise<RepoListing> {
  const info = await repoInfo(repo, headers);
  const files: RepoFile[] = [];
  let next: string | null = `${HF}/api/models/${repo}/tree/main?recursive=true`;
  while (next) {
    const { body, link }: { body: { type: string; path: string; size: number; oid?: string; lfs?: { oid?: string } }[]; link: string | null } =
      await getJson(next, headers);
    for (const entry of body) {
      if (entry.type !== 'file') continue;
      const oid = entry.lfs?.oid;
      files.push({
        path: entry.path,
        size: entry.size,
        sha256: oid && /^[a-f0-9]{64}$/.test(oid) ? oid : null,
        gitSha1: entry.oid && /^[a-f0-9]{40}$/.test(entry.oid) ? entry.oid : null,
      });
    }
    next = /<([^>]+)>;\s*rel="next"/.exec(link ?? '')?.[1] ?? null;
  }
  return { ...info, files };
}

export type Candidate =
  | ({ ok: true; skipped: string[] } & RepoFile & RepoInfo)
  | { ok: false; reason: string };

/** The first usable repository that holds exactly one file with that name. */
export function pickCandidate(file: string, listings: RepoListing[], opts: { allowGated?: boolean } = {}): Candidate {
  const skipped: string[] = [];
  for (const listing of listings) {
    const matches = listing.files.filter((entry) => entry.path.split('/').at(-1) === file);
    if (matches.length === 0) {
      skipped.push(`${listing.repo}: not found`);
    } else if (matches.length > 1) {
      skipped.push(`${listing.repo}: ${matches.length} files named ${file} (${matches.map((m) => m.path).join(', ')})`);
    } else if (listing.gated && !opts.allowGated) {
      skipped.push(`${listing.repo}: gated (set HF_TOKEN to use it)`);
    } else {
      const { files: _files, ...info } = listing;
      return { ok: true, skipped, ...info, ...matches[0]! };
    }
  }
  return { ok: false, reason: `${file} not found in a usable repository: ${skipped.join('; ')}` };
}

export type LockUpdate = { url: string; sha256: string; size?: number };

/**
 * The lock with `url`, `sha256` and, when given, `size` set on the given
 * entries (`sha256` right after `url`, `size` right after `sha256`).
 * Comments, key order and every other field (licenses included) are kept.
 */
export function proposeLock(lockText: string, updates: Map<string, LockUpdate>): string {
  const doc = parseDocument(lockText);
  const weights = doc.get('weights');
  if (!isSeq(weights)) throw new Error('models.lock.yaml has no weights list');
  for (const item of weights.items) {
    if (!isMap(item)) continue;
    const update = updates.get(String(item.get('id')));
    if (!update) continue;
    const setAfter = (key: string, value: string | number, after: string) => {
      if (item.has(key)) return item.set(key, value);
      const index = item.items.findIndex((pair) => isScalar(pair.key) && pair.key.value === after);
      item.items.splice(index + 1, 0, doc.createPair(key, value));
    };
    item.set('url', update.url);
    setAfter('sha256', update.sha256, 'url');
    if (update.size !== undefined) setAfter('size', update.size, 'sha256');
  }
  return doc.toString({ lineWidth: 0 });
}

/**
 * Lock updates straight from Hugging Face's metadata (exact URL, size, and
 * the sha256 of the LFS object), without downloading anything. A file
 * Hugging Face publishes no sha256 for is reported and left out; `--extra`
 * files never enter the lock.
 */
export function lockFromHf(
  plans: { id: string; url: string; size: number; hf_sha256: string | null; lock_sha256: string | null; extra: boolean }[],
): { updates: Map<string, Required<LockUpdate>>; problems: string[] } {
  const updates = new Map<string, Required<LockUpdate>>();
  const problems: string[] = [];
  for (const plan of plans) {
    if (plan.extra) continue;
    // A small file Hugging Face keeps out of LFS publishes no sha256: a plan only exists once
    // lockDrift has matched its git blob id against the lock's, so the lock's sha256 stands.
    const sha256 = plan.hf_sha256 ?? plan.lock_sha256;
    if (!sha256) {
      problems.push(`${plan.id}: Hugging Face publishes no sha256 for ${plan.url}; download it to hash it`);
      continue;
    }
    updates.set(plan.id, { url: plan.url, sha256, size: plan.size });
  }
  return { updates, problems };
}

/** Why the file Hugging Face serves is not the one the lock pins, or null when it is (or the lock pins nothing). */
export function lockDrift(
  lock: { sha256?: string; size?: number; git_sha1?: string },
  remote: { sha256: string | null; size: number; git_sha1?: string | null },
): string | null {
  const problems: string[] = [];
  if (lock.sha256 && remote.sha256 === null) {
    // A small file kept out of LFS: its git blob id answers, the download checks the sha256.
    if (lock.git_sha1 && remote.git_sha1) {
      if (remote.git_sha1 !== lock.git_sha1) problems.push(`lock pins git blob ${lock.git_sha1}, Hugging Face serves ${remote.git_sha1}`);
    } else problems.push(`lock pins sha256 ${lock.sha256}, Hugging Face publishes no sha256`);
  } else if (lock.sha256 && remote.sha256 !== lock.sha256) problems.push(`lock pins sha256 ${lock.sha256}, Hugging Face serves ${remote.sha256}`);
  if (lock.size !== undefined && remote.size !== lock.size) problems.push(`lock pins ${lock.size} bytes, Hugging Face serves ${remote.size}`);
  return problems.length > 0 ? `the file changed upstream: ${problems.join('; ')}` : null;
}

/** A git-style patch of registry/models.lock.yaml, applicable with `git apply` at the repository root. */
export function lockPatch(oldText: string, newText: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'montagio-lock-'));
  try {
    // a/ and b/ trees + --no-prefix give the usual "a/registry/… b/registry/…" headers.
    for (const [side, text] of [['a', oldText], ['b', newText]] as const) {
      mkdirSync(join(dir, side, 'registry'), { recursive: true });
      writeFileSync(join(dir, side, 'registry', 'models.lock.yaml'), text);
    }
    const diff = spawnSync(
      'git',
      ['diff', '--no-index', '--no-color', '--no-prefix', '--', 'a/registry/models.lock.yaml', 'b/registry/models.lock.yaml'],
      { cwd: dir, encoding: 'utf8' },
    );
    if (diff.status === 0) return '';
    if (diff.status !== 1) throw new Error(`git diff failed: ${diff.stderr || diff.error?.message}`);
    return diff.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/**
 * Stream a file to `<dest>.part` while hashing it, resume a previous partial
 * download with a Range request, then move it into place. A sha256 that does
 * not match `expectedSha256` deletes the partial file and throws.
 */
export async function downloadFile(
  url: string,
  dest: string,
  opts: { expectedSha256?: string | null; headers?: Record<string, string>; onProgress?: (bytes: number, total: number | null) => void } = {},
): Promise<{ sha256: string; bytes: number; resumedFrom: number }> {
  const part = `${dest}.part`;
  await mkdir(dirname(dest), { recursive: true });
  let hash: Hash = createHash('sha256');
  let offset = 0;
  try {
    offset = (await stat(part)).size;
  } catch {
    offset = 0;
  }
  if (offset > 0) for await (const chunk of createReadStream(part)) hash.update(chunk as Buffer);

  const res = await fetch(url, { headers: { ...opts.headers, ...(offset > 0 ? { range: `bytes=${offset}-` } : {}) } });
  if (offset > 0 && res.status === 200) {
    // The server ignored the range: start again from zero.
    await truncate(part, 0);
    offset = 0;
    hash = createHash('sha256');
  } else if (offset > 0 && res.status !== 206) {
    throw new Error(`GET ${url} (resume at ${offset}) → HTTP ${res.status}`);
  }
  if (!res.ok || !res.body) throw new Error(`GET ${url} → HTTP ${res.status}`);
  const length = Number(res.headers.get('content-length'));
  const total = Number.isFinite(length) && length > 0 ? offset + length : null;

  const resumedFrom = offset;
  let bytes = offset;
  const hashing = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk);
      bytes += chunk.length;
      opts.onProgress?.(bytes, total);
      done(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body as unknown as NodeReadableStream), hashing, createWriteStream(part, { flags: offset > 0 ? 'a' : 'w' }));

  const sha256 = hash.digest('hex');
  if (total !== null && bytes !== total) throw new Error(`${url}: got ${bytes} bytes, expected ${total} (partial file kept for resume)`);
  if (opts.expectedSha256 && sha256 !== opts.expectedSha256) {
    await rm(part, { force: true });
    throw new Error(`sha256 mismatch for ${dest}: got ${sha256}, expected ${opts.expectedSha256}`);
  }
  await rename(part, dest);
  return { sha256, bytes, resumedFrom };
}

export async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}
