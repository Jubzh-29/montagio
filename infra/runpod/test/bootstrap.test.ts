import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

test('the voice node is installed last, once the proxy, the npm dependencies and the env file are in place', () => {
  const text = readFileSync(script, 'utf8');
  expect(text.match(/install_npm; write_env; install_voice_node; install_segment_node/g)).toHaveLength(2);
  expect(text).not.toMatch(/install_comfyui; install_extension_nodes/);
});
