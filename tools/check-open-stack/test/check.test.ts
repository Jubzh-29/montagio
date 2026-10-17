import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkOpenStack } from '../src/index';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const repoRoot = () => fileURLToPath(new URL('../../../', import.meta.url));
const toolDir = fileURLToPath(new URL('../', import.meta.url));
const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

test('clean repo passes', async () => {
  const r = await checkOpenStack(fixture('clean'));
  expect(r.violations).toEqual([]);
  expect(r.ok).toBe(true);
  expect(r.models).toEqual([
    {
      id: 'wan22-i2v-a14b-fun-camera',
      license: 'Apache-2.0',
      weights: [
        { id: 'wan22-fun-camera-high', license: 'Apache-2.0' },
        { id: 'wan22-fun-camera-low', license: 'Apache-2.0' },
        { id: 'umt5-xxl-fp8', license: 'Apache-2.0' },
        { id: 'wan21-vae', license: 'Apache-2.0' },
      ],
    },
  ]);
});

test('restrictive weight license fails', async () => {
  const r = await checkOpenStack(fixture('dirty-license'));
  expect(r.ok).toBe(false);
  expect(r.violations).toContainEqual(
    expect.objectContaining({
      rule: 'weight-license',
      file: expect.stringMatching(/models\.lock\.yaml$/),
      detail: expect.stringContaining('LTX-2 Community License'),
    }),
  );
});

test('partner node fails', async () => {
  const r = await checkOpenStack(fixture('dirty-node'));
  expect(r.violations).toContainEqual(
    expect.objectContaining({ rule: 'node-not-allowed', detail: expect.stringContaining('KlingImage2VideoNode') }),
  );
});

test('a workflow loading a file that is not a declared weight of its model fails', async () => {
  const r = await checkOpenStack(fixture('dirty-file'));
  expect(r.violations).toContainEqual(
    expect.objectContaining({ rule: 'weight-file', detail: expect.stringContaining('flux1-dev.safetensors') }),
  );
});

test('a preset LoRA missing from the lock fails', async () => {
  const r = await checkOpenStack(fixture('dirty-lora'));
  expect(r.violations).toContainEqual(
    expect.objectContaining({
      rule: 'weight-file',
      file: expect.stringMatching(/crash-push\.yaml$/),
      detail: expect.stringContaining('some-nc-lora.safetensors'),
    }),
  );
});

test('closed API host in source fails', async () => {
  const r = await checkOpenStack(fixture('dirty-code'));
  expect(r.violations).toContainEqual(
    expect.objectContaining({ rule: 'forbidden-pattern', file: expect.stringMatching(/src[\\/]call\.ts$/) }),
  );
});

test('a closed-API SDK declared as a dependency fails', async () => {
  const r = await checkOpenStack(fixture('dirty-package'));
  const closed = r.violations.filter((v) => v.rule === 'closed-package');
  expect(closed.map((v) => v.detail)).toEqual([
    expect.stringContaining('"openai"'),
    expect.stringContaining('"@fal-ai/client"'),
  ]);
  expect(closed[0]?.file).toMatch(/packages[\\/]x[\\/]package\.json$/);
});

test('importing a closed-API SDK or indexing the router fails', async () => {
  const r = await checkOpenStack(fixture('dirty-import'));
  expect(r.violations).toContainEqual(
    expect.objectContaining({ rule: 'closed-package', file: expect.stringMatching(/src[\\/]gen\.ts$/) }),
  );
  expect(r.violations).toContainEqual(
    expect.objectContaining({ rule: 'forbidden-pattern', file: expect.stringMatching(/src[\\/]route\.ts$/) }),
  );
});

test('infra scripts are scanned, and the SDK router namespace or route fails', async () => {
  const r = await checkOpenStack(fixture('dirty-infra'));
  expect(r.violations).toContainEqual(
    expect.objectContaining({
      rule: 'closed-package',
      file: expect.stringMatching(/infra[\\/]x[\\/]package\.json$/),
      detail: expect.stringContaining('"openai"'),
    }),
  );
  const smoke = r.violations.filter((v) => v.rule === 'forbidden-pattern' && /infra[\\/]x[\\/]smoke\.ts$/.test(v.file));
  expect(smoke.map((v) => v.detail)).toEqual([
    expect.stringContaining('comfy.models'),
    expect.stringContaining('REST route'),
  ]);
});

test('cli writes the report and exits 1 on violations', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'montagio-report-')), 'nested', 'r.json');
  const res = spawnSync(process.execPath, ['--import', 'tsx', cliPath, fixture('dirty-node'), '--out', out], {
    cwd: toolDir,
    encoding: 'utf8',
  });
  expect(res.status).toBe(1);
  expect(JSON.parse(readFileSync(out, 'utf8')).ok).toBe(false);
});

test('cli exits 0 on a clean repo', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'montagio-report-')), 'r.json');
  const res = spawnSync(process.execPath, ['--import', 'tsx', cliPath, fixture('clean'), '--out', out], {
    cwd: toolDir,
    encoding: 'utf8',
  });
  expect(res.status).toBe(0);
});

test('the real repository is clean', async () => {
  const r = await checkOpenStack(repoRoot());
  expect(r.violations).toEqual([]);
});
