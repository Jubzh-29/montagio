/**
 * Download the weights of registry/models.lock.yaml from Hugging Face into a
 * ComfyUI models/ folder, compute their sha256 and propose a lock patch.
 *
 * Run from the repository root, on the pod:
 *   npm run weights -w @montagio/infra-runpod -- --dry-run                       # resolve exact URLs, download nothing
 *   npm run weights -w @montagio/infra-runpod -- --lock-from-hf                  # lock patch from Hugging Face metadata, download nothing
 *   npm run weights -w @montagio/infra-runpod -- --models-dir /workspace/ComfyUI/models
 *   npm run weights -w @montagio/infra-runpod -- --models-dir … --only wan21-vae,wan22-vae
 *   npm run weights -w @montagio/infra-runpod -- --models-dir … --extra loras=https://huggingface.co/<repo>/resolve/main/<file>
 *
 * For each lock entry it finds the exact file (resolve/main/…) in the entry's
 * repository or in a Comfy-Org repackaged mirror, checks the bytes against the
 * sha256 Hugging Face publishes, and writes to <out>/:
 *   weights-report.json         what was resolved, downloaded and hashed, with the declared licenses
 *   models.lock.proposed.yaml   the lock with exact url + sha256 (licenses untouched)
 *   models.lock.patch           the same change as a patch: review it, then `git apply` it locally
 *
 * Licenses are never changed here: the report shows what each model card
 * declares so a human can re-read the license at the source.
 * `--extra` files (evaluation only, e.g. an accelerator LoRA whose license is
 * still being checked) are downloaded and hashed but never added to the patch.
 *
 * `--lock-from-hf` writes the same patch without downloading: url, size and the
 * sha256 Hugging Face stores for the LFS object (`lfs.oid`). A lock entry whose
 * pinned sha256 or size no longer matches what Hugging Face serves fails before
 * anything is downloaded, in every mode.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadLibrary } from '@montagio/presets';
import { enabledExtensions, parseLock, type LockEntry } from '@montagio/registry';
import {
  downloadFile,
  folderFor,
  forExtensions,
  gib,
  listRepo,
  lockDrift,
  lockFromHf,
  lockPatch,
  parseHfUrl,
  pickCandidate,
  proposeLock,
  repoInfo,
  resolveUrl,
  sha256File,
  weightFolders,
  writeText,
  type RepoInfo,
  type RepoListing,
} from './lib/weights';
import { readSafetensorsHeader, summarizeHeader } from './lib/safetensors';

/** Comfy-Org single-file repackagings, tried after the entry's own repository. */
const MIRRORS = ['Comfy-Org/Wan_2.2_ComfyUI_Repackaged', 'Comfy-Org/Wan_2.1_ComfyUI_repackaged', 'Comfy-Org/z_image_turbo'];
const ATTEMPTS = 3;

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const callerDir = process.env.INIT_CWD ?? process.cwd();
const fromCaller = (path: string) => (isAbsolute(path) ? path : resolve(callerDir, path));

const { values: args } = parseArgs({
  options: {
    'models-dir': { type: 'string' },
    only: { type: 'string' },
    extra: { type: 'string', multiple: true, default: [] },
    out: { type: 'string' },
    concurrency: { type: 'string', default: '2' },
    'dry-run': { type: 'boolean', default: false },
    'lock-from-hf': { type: 'boolean', default: false },
    extensions: { type: 'string', default: 'all' },
    inspect: { type: 'string', multiple: true, default: [] },
    help: { type: 'boolean', default: false },
  },
});

if (args.help) {
  console.log(`Usage: npm run weights -w @montagio/infra-runpod -- [options]
  --models-dir DIR        ComfyUI models/ folder (required unless --dry-run)
  --only ID[,ID]          only these lock entries
  --extensions LIST       the weights of which extensions: all (default, the GPU sessions), none, validated
                          (those dated in registry/extensions.yaml) or a list such as music,edit
  --extra FOLDER=URL      also fetch an evaluation-only file (repeatable); never added to the lock patch
  --out DIR               results folder (default s1-results)
  --concurrency N         parallel downloads (default 2)
  --dry-run               resolve exact URLs and sizes, download nothing
  --lock-from-hf          write the lock patch (url, size, sha256) from Hugging Face metadata, download nothing
  --inspect URL           read only the header of a .safetensors file (two Range requests) and write it to
                          <out>/inspect-<file>.json (repeatable); nothing else runs
Environment: HF_TOKEN (optional) lets gated repositories be used.`);
  process.exit(0);
}

type Plan = {
  id: string;
  file: string;
  folder: string;
  dest: string;
  url: string;
  repo: string;
  path: string;
  revision: string | null;
  size: number;
  hf_sha256: string | null;
  lock_sha256: string | null;
  license_lock: string | null;
  license_source_card: string | null;
  license_mirror_card: string | null;
  source: string | null;
  notes: string[];
  extra: boolean;
};

type Outcome = Plan & { status: 'downloaded' | 'present' | 'planned' | 'failed'; sha256: string | null; seconds: number | null; error: string | null };

function licenseCheck(plan: Plan): string {
  if (plan.extra) return `card says ${plan.license_mirror_card ?? '?'}: read the license before any use`;
  const lock = plan.license_lock?.toLowerCase();
  const card = plan.license_source_card?.toLowerCase();
  if (!card) return 'source card declares no license: read it at the source';
  return lock === card ? 'card matches the lock (still re-read the license text)' : `MISMATCH: lock ${plan.license_lock}, source card ${plan.license_source_card}`;
}

async function inspect(urls: string[], outDir: string, headers: Record<string, string>): Promise<number> {
  let failures = 0;
  for (const url of urls) {
    // <repo>__<file> for a Hugging Face URL (…/<owner>/<repo>/resolve/<rev>/<path>), else the file name
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    const name = parts[2] === 'resolve' ? `${parts[1]}__${parts.at(-1)}` : parts.at(-1)!;
    try {
      // Only huggingface.co gets the token: fetch drops Authorization on the cross-origin CDN redirect.
      const header = await readSafetensorsHeader(url, { headers: new URL(url).origin === 'https://huggingface.co' ? headers : {} });
      const out = join(outDir, `inspect-${name}.json`);
      await writeText(out, `${JSON.stringify({ url, at: new Date().toISOString(), ...header }, null, 2)}\n`);
      console.log(`${url}\n  ${summarizeHeader(header).join('\n  ')}\n  header: ${relative(callerDir, out)}`);
    } catch (error) {
      failures++;
      console.error(`✗ ${url}: ${(error as Error).message}`);
    }
  }
  return failures > 0 ? 1 : 0;
}

async function main(): Promise<number> {
  if (args.inspect.length > 0) {
    const token = process.env.HF_TOKEN?.trim();
    return inspect(args.inspect, fromCaller(args.out ?? join(repoRoot, 's1-results')), token ? { authorization: `Bearer ${token}` } : {});
  }
  const lockOnly = args['lock-from-hf'];
  const dryRun = args['dry-run'] || lockOnly;
  if (!dryRun && !args['models-dir']) throw new Error('--models-dir is required (for example /workspace/ComfyUI/models), or pass --dry-run');
  const modelsDir = args['models-dir'] ? fromCaller(args['models-dir']) : '(dry run)';
  const outDir = fromCaller(args.out ?? join(repoRoot, 's1-results'));
  const token = process.env.HF_TOKEN?.trim() || undefined;
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};

  const lockText = await readFile(join(repoRoot, 'registry', 'models.lock.yaml'), 'utf8');
  const lock = parseLock(lockText, 'registry/models.lock.yaml');
  const only = args.only ? new Set(args.only.split(',').map((id) => id.trim())) : null;
  for (const id of only ?? []) if (!lock.some((entry) => entry.id === id)) throw new Error(`--only: unknown lock entry "${id}"`);
  const library = await loadLibrary(repoRoot);
  const enabled = enabledExtensions(library.extensions ?? [], args.extensions);
  const entries = forExtensions(lock, enabled).filter((entry) => !only || only.has(entry.id));
  const folders = weightFolders([...library.templates.values(), ...library.extensionTemplates.values()]);

  const listings = new Map<string, Promise<RepoListing>>();
  const listing = (repo: string) => {
    if (!listings.has(repo)) listings.set(repo, listRepo(repo, headers));
    return listings.get(repo)!;
  };
  const infos = new Map<string, Promise<RepoInfo>>();
  const info = (repo: string) => {
    if (!infos.has(repo)) infos.set(repo, repoInfo(repo, headers));
    return infos.get(repo)!;
  };

  const plans: Plan[] = [];
  const failures: Outcome[] = [];
  const planEntry = async (entry: LockEntry): Promise<void> => {
    const base: Omit<Plan, 'folder' | 'dest' | 'url' | 'repo' | 'path' | 'revision' | 'size' | 'hf_sha256' | 'license_mirror_card' | 'notes'> = {
      id: entry.id,
      file: entry.file,
      lock_sha256: entry.sha256 ?? null,
      license_lock: entry.license,
      license_source_card: (await info(parseHfUrl(entry.source).repo).catch(() => null))?.license ?? null,
      source: entry.source,
      extra: false,
    };
    const own = parseHfUrl(entry.url);
    let candidate: ReturnType<typeof pickCandidate>;
    if (own.path) {
      const repo = await listing(own.repo);
      const file = repo.files.find((f) => f.path === own.path);
      candidate = file
        ? { ok: true, skipped: [], ...repo, ...file }
        : { ok: false, reason: `${own.path} not found in ${own.repo}` };
    } else {
      const repos = [...new Set([own.repo, ...MIRRORS])];
      candidate = pickCandidate(entry.file, await Promise.all(repos.map(listing)), { allowGated: Boolean(token) });
    }
    if (!candidate.ok) throw new Error(candidate.reason);
    const drift = lockDrift(
      { sha256: entry.sha256, size: entry.size, git_sha1: entry.git_sha1 },
      { sha256: candidate.sha256, size: candidate.size, git_sha1: candidate.gitSha1 },
    );
    if (drift) throw new Error(`${drift} (${resolveUrl(candidate.repo, candidate.path)})`);
    const folder = folderFor(entry.file, candidate.path, folders, entry.folder);
    if (!folder) throw new Error(`cannot tell the ComfyUI folder of ${entry.file} (no loader names it, repository path ${candidate.path})`);
    plans.push({
      ...base,
      folder,
      dest: join(modelsDir, folder, entry.file),
      url: resolveUrl(candidate.repo, candidate.path),
      repo: candidate.repo,
      path: candidate.path,
      revision: candidate.revision,
      size: candidate.size,
      hf_sha256: candidate.sha256,
      license_mirror_card: candidate.license,
      notes: candidate.skipped.filter((note) => !note.endsWith('not found')),
    });
  };

  for (const entry of entries) {
    await planEntry(entry).catch((error: Error) => {
      failures.push({ ...emptyPlan(entry.id, entry.file), status: 'failed', sha256: null, seconds: null, error: error.message });
    });
  }
  for (const spec of args.extra) {
    const [folder, url] = [spec.slice(0, spec.indexOf('=')), spec.slice(spec.indexOf('=') + 1)];
    try {
      if (!folder || !url) throw new Error(`--extra must look like loras=https://huggingface.co/<repo>/resolve/main/<path>`);
      const target = parseHfUrl(url);
      if (!target.path) throw new Error(`--extra ${url}: give the file URL (…/resolve/main/<path>)`);
      const repo = await listing(target.repo);
      const file = repo.files.find((f) => f.path === target.path);
      if (!file) throw new Error(`${target.path} not found in ${target.repo}`);
      const name = target.path.split('/').at(-1)!;
      plans.push({
        id: `extra:${name}`,
        file: name,
        folder,
        dest: join(modelsDir, folder, name),
        url: resolveUrl(target.repo, target.path),
        repo: target.repo,
        path: target.path,
        revision: repo.revision,
        size: file.size,
        hf_sha256: file.sha256,
        lock_sha256: null,
        license_lock: null,
        license_source_card: null,
        license_mirror_card: repo.license,
        source: null,
        notes: ['evaluation only: not in the lock, not in the patch'],
        extra: true,
      });
    } catch (error) {
      failures.push({ ...emptyPlan(`extra:${spec}`, spec), status: 'failed', sha256: null, seconds: null, error: (error as Error).message });
    }
  }

  const total = plans.reduce((sum, plan) => sum + plan.size, 0);
  console.log(`${plans.length} file(s), ${gib(total)} → ${modelsDir}\n`);
  for (const plan of plans) {
    console.log(`${plan.id.padEnd(24)} ${gib(plan.size).padStart(10)}  ${plan.folder}/${plan.file}`);
    console.log(`${''.padEnd(24)} ${plan.url}`);
    console.log(`${''.padEnd(24)} license: ${licenseCheck(plan)}${plan.notes.length ? `; ${plan.notes.join('; ')}` : ''}`);
  }
  for (const failure of failures) console.error(`✗ ${failure.id}: ${failure.error}`);

  const outcomes: Outcome[] = [...failures];
  if (dryRun) {
    outcomes.push(...plans.map((plan) => ({ ...plan, status: 'planned' as const, sha256: null, seconds: null, error: null })));
  } else {
    const queue = [...plans];
    const workers = Array.from({ length: Math.max(1, Number(args.concurrency) || 1) }, async () => {
      for (let plan = queue.shift(); plan; plan = queue.shift()) outcomes.push(await fetchOne(plan, headers));
    });
    await Promise.all(workers);
  }

  const report = {
    at: new Date().toISOString(),
    dry_run: dryRun,
    models_dir: modelsDir,
    weights: outcomes.sort((a, b) => a.id.localeCompare(b.id)),
  };
  await writeText(join(outDir, 'weights-report.json'), `${JSON.stringify(report, null, 2)}\n`);

  const fromHf = lockOnly ? lockFromHf(plans) : null;
  for (const problem of fromHf?.problems ?? []) console.error(`✗ ${problem}`);
  const updates = fromHf
    ? fromHf.updates
    : new Map(
        outcomes
          .filter((o) => !o.extra && (o.status === 'downloaded' || o.status === 'present') && o.sha256)
          .map((o) => [o.id, { url: o.url, sha256: o.sha256!, size: o.size }]),
      );
  if (updates.size > 0) {
    const proposed = proposeLock(lockText, updates);
    const patch = lockPatch(lockText, proposed);
    await writeText(join(outDir, 'models.lock.proposed.yaml'), proposed);
    await writeText(join(outDir, 'models.lock.patch'), patch);
    console.log(`\nlock patch (${updates.size} entr${updates.size > 1 ? 'ies' : 'y'}): ${relative(callerDir, join(outDir, 'models.lock.patch'))}`);
    console.log('review it, then on your machine: git apply models.lock.patch');
  }
  console.log(`report: ${relative(callerDir, join(outDir, 'weights-report.json'))}`);
  const failed = outcomes.filter((o) => o.status === 'failed');
  if (failed.length > 0) console.error(`\n${failed.length} failure(s): ${failed.map((o) => o.id).join(', ')}`);
  return failed.length > 0 || (fromHf?.problems.length ?? 0) > 0 ? 1 : 0;
}

function emptyPlan(id: string, file: string): Plan {
  return {
    id, file, folder: '', dest: '', url: '', repo: '', path: '', revision: null, size: 0, hf_sha256: null, lock_sha256: null,
    license_lock: null, license_source_card: null, license_mirror_card: null, source: null, notes: [], extra: false,
  };
}

async function fetchOne(plan: Plan, headers: Record<string, string>): Promise<Outcome> {
  const started = performance.now();
  const done = (status: Outcome['status'], sha256: string | null, error: string | null = null): Outcome => ({
    ...plan,
    status,
    sha256,
    seconds: Math.round((performance.now() - started) / 100) / 10,
    error,
  });
  const expected = plan.hf_sha256 ?? plan.lock_sha256;
  try {
    let sha256: string;
    let status: 'downloaded' | 'present';
    if (existsSync(plan.dest)) {
      console.log(`… ${plan.file}: already present, hashing`);
      sha256 = await sha256File(plan.dest);
      status = 'present';
    } else {
      let lastPrint = 0;
      let result: Awaited<ReturnType<typeof downloadFile>> | null = null;
      for (let attempt = 1; attempt <= ATTEMPTS && !result; attempt++) {
        try {
          result = await downloadFile(plan.url, plan.dest, {
            expectedSha256: expected,
            // Only huggingface.co gets the token: fetch drops Authorization on the cross-origin CDN redirect.
            headers,
            onProgress: (bytes, total) => {
              if (performance.now() - lastPrint < 15_000) return;
              lastPrint = performance.now();
              const rate = bytes / 1024 ** 2 / ((performance.now() - started) / 1000);
              console.log(`… ${plan.file}: ${gib(bytes)}${total ? ` / ${gib(total)}` : ''} (${rate.toFixed(0)} MiB/s)`);
            },
          });
        } catch (error) {
          if (attempt === ATTEMPTS || /sha256 mismatch/.test((error as Error).message)) throw error;
          console.warn(`… ${plan.file}: attempt ${attempt} failed (${(error as Error).message}), resuming`);
        }
      }
      sha256 = result!.sha256;
      status = 'downloaded';
    }
    if (expected && sha256 !== expected) throw new Error(`sha256 mismatch: file ${sha256}, expected ${expected}`);
    if (plan.lock_sha256 && sha256 !== plan.lock_sha256) throw new Error(`sha256 differs from the lock (${plan.lock_sha256})`);
    console.log(`✓ ${plan.file}: ${status}, sha256 ${sha256}${expected ? ' (matches Hugging Face)' : ' (Hugging Face publishes none)'}`);
    return done(status, sha256);
  } catch (error) {
    console.error(`✗ ${plan.file}: ${(error as Error).message}`);
    return done('failed', null, (error as Error).message);
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`weights: ${(error as Error).message}`);
    process.exitCode = 1;
  },
);
