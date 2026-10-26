import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLibrary } from '@montagio/presets';
import { afterEach, expect, test } from 'vitest';

const script = join(import.meta.dirname, '..', 'bootstrap.sh');
const hasBash = spawnSync('bash', ['--version'], { encoding: 'utf8' }).stdout?.startsWith('GNU bash') ?? false;
const posix = (path: string) => path.replaceAll('\\', '/');
let workspace: string | undefined;

afterEach(() => {
  if (workspace) rmSync(workspace, { recursive: true, force: true });
  workspace = undefined;
});

test.runIf(hasBash)('a voice node that cannot be installed warns, and the session goes on', () => {
  workspace = mkdtempSync(join(tmpdir(), 'montagio-bootstrap-'));
  const run = spawnSync(
    'bash',
    ['-c', 'source "$1"; CHATTERBOX_NODE_REPO="$2/no-such-repo.git"; install_voice_node; echo "the session goes on"', 'bootstrap-test', posix(script), posix(workspace)],
    { encoding: 'utf8', env: { ...process.env, MONTAGIO_WORKSPACE: posix(workspace) } },
  );
  expect(run.status).toBe(0);
  expect(run.stdout).toContain('the session goes on');
  expect(run.stderr).toMatch(/warning:.*voice node/);
  expect(existsSync(join(workspace, 'ComfyUI', 'custom_nodes', 'ComfyUI-Chatterbox', '.montagio-stamp'))).toBe(false);
});

test.runIf(hasBash)('a SAM 2 node that cannot be installed warns, and the session goes on', () => {
  workspace = mkdtempSync(join(tmpdir(), 'montagio-bootstrap-'));
  const run = spawnSync(
    'bash',
    ['-c', 'source "$1"; SAM2_NODE_REPO="$2/no-such-repo.git"; install_segment_node; echo "the session goes on"', 'bootstrap-test', posix(script), posix(workspace)],
    { encoding: 'utf8', env: { ...process.env, MONTAGIO_WORKSPACE: posix(workspace) } },
  );
  expect(run.status).toBe(0);
  expect(run.stdout).toContain('the session goes on');
  expect(run.stderr).toMatch(/warning:.*SAM 2 node/);
  expect(existsSync(join(workspace, 'ComfyUI', 'custom_nodes', 'ComfyUI-segment-anything-2', '.montagio-stamp'))).toBe(false);
});

// A clone that is not at the pinned commit: the checkout fails after the clone, and the pack would stay as cloned.
const otherRepo = 'git init -q "$2/repo" && git -C "$2/repo" -c user.name=t -c user.email=t@example.invalid commit -q --allow-empty -m other';

test.runIf(hasBash)('a voice node left half-made goes: unpatched, its /chatterbox/* routes read any absolute path', () => {
  workspace = mkdtempSync(join(tmpdir(), 'montagio-bootstrap-'));
  const run = spawnSync(
    'bash',
    ['-c', `source "$1"; ${otherRepo}; CHATTERBOX_NODE_REPO="$2/repo"; install_voice_node; echo "the session goes on"`, 'bootstrap-test', posix(script), posix(workspace)],
    { encoding: 'utf8', env: { ...process.env, MONTAGIO_WORKSPACE: posix(workspace) } },
  );
  expect(run.stdout).toContain('the session goes on');
  expect(run.stderr).toMatch(/warning:.*voice node/);
  expect(existsSync(join(workspace, 'ComfyUI', 'custom_nodes', 'ComfyUI-Chatterbox'))).toBe(false);
});

test.runIf(hasBash)('a SAM 2 node left half-made goes: ComfyUI never loads a commit that was not checked', () => {
  workspace = mkdtempSync(join(tmpdir(), 'montagio-bootstrap-'));
  const run = spawnSync(
    'bash',
    ['-c', `source "$1"; ${otherRepo}; SAM2_NODE_REPO="$2/repo"; install_segment_node; echo "the session goes on"`, 'bootstrap-test', posix(script), posix(workspace)],
    { encoding: 'utf8', env: { ...process.env, MONTAGIO_WORKSPACE: posix(workspace) } },
  );
  expect(run.stdout).toContain('the session goes on');
  expect(run.stderr).toMatch(/warning:.*SAM 2 node/);
  expect(existsSync(join(workspace, 'ComfyUI', 'custom_nodes', 'ComfyUI-segment-anything-2'))).toBe(false);
});

test("ComfyUI's frontend stays off the internet and Pillow is lifted past its known flaws, as in infra/local", () => {
  const text = readFileSync(script, 'utf8');
  expect(text).toContain('main.py --listen "$LISTEN" --port "$COMFY_PORT" --disable-partner-nodes --offline');
  // Montagio's host check on ComfyUI (comfy-nodes/montagio_nodes/host_guard.py), off by itself when --expose-ui listens on 0.0.0.0.
  expect(text).toContain('HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 MONTAGIO_HOST_GUARD=1 \\');
  expect(text).toContain(`'pillow>=%s; python_version >= "3.11"\\n' "$PILLOW_MIN"`);
});

test('the voice node is installed last, once the proxy, the npm dependencies and the env file are in place', () => {
  const text = readFileSync(script, 'utf8');
  expect(text.match(/install_npm; write_env; install_voice_node; install_segment_node/g)).toHaveLength(2);
  expect(text).not.toMatch(/install_comfyui; install_extension_nodes/);
});

test('the voice speaks Chinese offline: its table is pinned beside the grapheme table, where the patched tokenizer reads it', async () => {
  const library = await loadLibrary(join(import.meta.dirname, '..', '..', '..'), { presets: false });
  const lock = [...library.lock.values()];
  const table = lock.find((entry) => entry.file === 'Cangjie5_TC.json');
  // MTLTokenizer hands the converter the folder of its vocabulary file.
  expect(table?.folder).toBeDefined();
  expect(table?.folder).toBe(lock.find((entry) => entry.file === 'grapheme_mtl_merged_expanded_v1.json')?.folder);
  for (const id of ['chatterbox-mtl-voice', 'gemma4-translate']) expect(library.extensionModels.get(id)?.weights).toContain(table?.id);
  const patch = readFileSync(join(import.meta.dirname, '..', 'patches', 'comfyui-chatterbox-no-routes.patch'), 'utf8');
  expect(patch).toContain('+            local_file = Path(model_dir) / "Cangjie5_TC.json"');
  // Kept in LF (.gitattributes); the tokenizer is CRLF upstream, so the patch is applied whitespace-blind.
  expect(patch).not.toContain('\r');
  expect(readFileSync(script, 'utf8')).toContain('git -C "$dir" apply --check --ignore-whitespace "$patch"');
});
