import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkOpenStack } from '../src/index';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

/** A throwaway repository holding only `files` (path relative to its root -> content). */
const scratchRepos: string[] = [];
const scratchRepo = (files: Record<string, string>): string => {
  const root = mkdtempSync(join(tmpdir(), 'montagio-scratch-'));
  scratchRepos.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
};
afterAll(() => {
  for (const root of scratchRepos) rmSync(root, { recursive: true, force: true });
});
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

test('a workflow of an extension may load only the weights of its own model', async () => {
  const clean = (path: string) => readFileSync(join(fixture('clean'), path), 'utf8');
  const root = scratchRepo({
    'presets/crash-push.yaml': clean('presets/crash-push.yaml'),
    'registry/models/wan-fun-camera.yaml': clean('registry/models/wan-fun-camera.yaml'),
    'workflows/wan22-fun-camera.api.json': clean('workflows/wan22-fun-camera.api.json'),
    'registry/models.lock.yaml':
      clean('registry/models.lock.yaml') +
      '  - id: ace-step15-vae\n    file: ace_1.5_vae.safetensors\n    url: https://huggingface.co/Comfy-Org/ace_step_1.5_ComfyUI_files\n' +
      '    license: MIT\n    source: https://huggingface.co/ACE-Step/Ace-Step1.5\n    extension: music\n',
    'registry/extensions.yaml':
      'schema: montagio/extensions@0.1\nextensions:\n  - { id: edit, priority: 1, gpu_validated: null }\n  - { id: effects, priority: 2, gpu_validated: null }\n' +
      '  - { id: transitions, priority: 3, requires: [edit], gpu_validated: null }\n  - { id: avatar, priority: 4, gpu_validated: null }\n' +
      '  - { id: music, priority: 5, gpu_validated: null }\n  - { id: upscale, priority: 6, gpu_validated: null }\n',
    'registry/extensions/ace-music.yaml': [
      'schema: montagio/extension-model@0.1',
      'id: ace-music',
      'name: ACE-Step music',
      'extension: music',
      'task: t2a',
      'license: MIT',
      'weights: [ace-step15-vae]',
      'workflow: workflows/ace-music.api.json',
      'bindings:',
      '  prompt: { node: "94", field: tags }',
      '  duration_s: { node: "98", field: seconds }',
      '  seed: { node: "3", field: seed }',
      '  bpm: { node: "94", field: bpm }',
      'output: { node: "107", kind: audio }',
      'estimate_s: 20',
      '',
    ].join('\n'),
    // loads its own VAE, and a Fun Camera file that is not one of its weights
    'workflows/ace-music.api.json': JSON.stringify({
      '106': { class_type: 'VAELoader', inputs: { vae_name: 'ace_1.5_vae.safetensors' } },
      '104': { class_type: 'UNETLoader', inputs: { unet_name: 'wan2.2_fun_camera_high_noise_14B_fp8_scaled.safetensors', weight_dtype: 'default' } },
    }),
  });
  const r = await checkOpenStack(root);
  expect(r.violations.filter((v) => v.rule === 'weight-file')).toEqual([
    expect.objectContaining({ detail: expect.stringMatching(/node 104 loads "wan2\.2_fun_camera_high_noise_14B_fp8_scaled\.safetensors", which is not one of the declared weights of ace-music/) }),
  ]);
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

test('the ComfyUI pack is scanned: closed Python packages and API hosts in .py files', async () => {
  const r = await checkOpenStack(fixture('dirty-comfy-nodes'));
  expect(r.violations).toContainEqual(
    expect.objectContaining({
      rule: 'closed-package',
      file: expect.stringMatching(/comfy-nodes[\\/]requirements\.txt$/),
      detail: expect.stringContaining('"openai"'),
    }),
  );
  expect(r.violations).toContainEqual(
    expect.objectContaining({ rule: 'forbidden-pattern', file: expect.stringMatching(/comfy-nodes[\\/]bad\.py$/) }),
  );
});

test('requirements.txt names follow PEP 503 and ignore versions, extras, markers, comments and options', async () => {
  const root = scratchRepo({
    'comfy-nodes/requirements.txt': [
      '# closed SDKs below must still be caught',
      '',
      '-r base.txt',
      '-e git+https://example.invalid/x.git#egg=replicate',
      '--index-url https://example.invalid/simple',
      'Google_GenerativeAI>=0.3 ; python_version >= "3.9"',
      '   Fal.Client==0.4   ',
      'runwayml[extra]~=1.0  # pinned',
      'mistralai @ https://example.invalid/mistralai.whl',
      'GOOGLE--CLOUD__aiplatform',
      'PyYAML>=6.0',
      'pytest',
    ].join('\n'),
  });
  const r = await checkOpenStack(root);
  const closed = r.violations.filter((v) => v.rule === 'closed-package');
  expect(closed.map((v) => v.detail)).toEqual([
    'requires "google-generativeai" (closed Google Gemini API)',
    'requires "fal-client" (closed fal.ai API)',
    'requires "runwayml" (closed Runway API)',
    'requires "mistralai" (closed Mistral API)',
    'requires "google-cloud-aiplatform" (closed Google Vertex AI API)',
  ]);
  expect(new Set(closed.map((v) => v.file))).toEqual(new Set([join('comfy-nodes', 'requirements.txt')]));
});

test('a byte-order mark and CRLF line endings in requirements.txt do not hide a requirement', async () => {
  const bom = String.fromCharCode(0xfeff);
  const r = await checkOpenStack(scratchRepo({ 'comfy-nodes/requirements.txt': `${bom}openai>=1.0\r\nPyYAML>=6.0\r\ngroq\r\n` }));
  expect(r.violations.filter((v) => v.rule === 'closed-package').map((v) => v.detail)).toEqual([
    'requires "openai" (closed OpenAI API)',
    'requires "groq" (closed Groq API)',
  ]);
});

test('boto3 is refused as the AWS SDK that carries Bedrock', async () => {
  const r = await checkOpenStack(scratchRepo({ 'comfy-nodes/requirements.txt': 'boto3==1.35\n' }));
  expect(r.violations).toContainEqual(
    expect.objectContaining({ rule: 'closed-package', detail: 'requires "boto3" (AWS SDK, carries Bedrock)' }),
  );
});

test('the npm and PyPI lists stay separate: a name closed on one registry is not closed on the other', async () => {
  const root = scratchRepo({
    // groq (npm) is an unrelated query language; boto3 and cohere only exist as PyPI SDK names
    'packages/x/package.json': JSON.stringify({ name: 'x', dependencies: { groq: '^3.0.0', boto3: '1.0.0', cohere: '1.0.0' } }),
    // groq-sdk and cohere-ai are the npm SDK names, not PyPI ones
    'comfy-nodes/requirements.txt': 'groq-sdk\ncohere-ai\n',
  });
  const r = await checkOpenStack(root);
  expect(r.violations.filter((v) => v.rule === 'closed-package')).toEqual([]);
});

test('the pack scan reads .ts files and skips virtualenvs and caches', async () => {
  const closedHost = 'export const URL = "https://api.openai.com/v1/x";\n';
  const root = scratchRepo({
    'comfy-nodes/tests/ts_bridge.ts': closedHost,
    'comfy-nodes/.venv/lib/site.py': closedHost,
    'comfy-nodes/venv/lib/site.py': closedHost,
    'comfy-nodes/__pycache__/x.py': closedHost,
    'comfy-nodes/.pytest_cache/x.py': closedHost,
  });
  const r = await checkOpenStack(root);
  const hits = r.violations.filter((v) => v.rule === 'forbidden-pattern');
  expect(hits.map((v) => v.file)).toEqual([join('comfy-nodes', 'tests', 'ts_bridge.ts')]);
});

test('JS import syntax is not read in Python files', async () => {
  const root = scratchRepo({ 'comfy-nodes/doc.py': '"""Port of: import x from \'openai\'; require("replicate")"""\n' });
  const r = await checkOpenStack(root);
  expect(r.violations.filter((v) => v.rule === 'closed-package')).toEqual([]);
});

const closedDetails = (r: Awaited<ReturnType<typeof checkOpenStack>>, file: string) =>
  r.violations.filter((v) => v.rule === 'closed-package' && v.file === join('comfy-nodes', file)).map((v) => v.detail);

test('a closed SDK declared only in pyproject.toml [project].dependencies fails', async () => {
  const root = scratchRepo({
    'comfy-nodes/pyproject.toml': [
      '[project]',
      'name = "montagio"',
      'description = "dependencies = [\\"groq\\"] is prose here, and so is # this"',
      'dependencies = [',
      '  "PyYAML>=6.0",  # kept',
      "  'Google_GenAI >= 1.0 ; python_version >= \"3.10\"',",
      '  # "replicate" is commented out',
      '  "openai[all]>=1.0",',
      ']',
      '',
      '[project.urls]',
      'Repository = "https://example.invalid/montagio"',
    ].join('\n'),
  });
  const r = await checkOpenStack(root);
  expect(closedDetails(r, 'pyproject.toml')).toEqual([
    'requires "google-genai" (closed Google Gemini API)',
    'requires "openai" (closed OpenAI API)',
  ]);
});

test('pyproject.toml: only [project].dependencies is read, never a same-named key of another table', async () => {
  const root = scratchRepo({
    'comfy-nodes/pyproject.toml': [
      '[tool.x]',
      'dependencies = ["openai"]',
      '',
      '[tool.y.dependencies]',
      'anthropic = "1.0"',
      '',
      '[project]',
      'dependencies = ["groq>=0.4"]',
      '',
      '[project.optional-dependencies]',
      'dependencies = ["mistralai"]',
    ].join('\r\n'),
  });
  const r = await checkOpenStack(root);
  expect(closedDetails(r, 'pyproject.toml')).toEqual(['requires "groq" (closed Groq API)']);
});

test('a closed SDK in requirements-dev.txt fails', async () => {
  const root = scratchRepo({
    'comfy-nodes/requirements.txt': 'PyYAML>=6.0\n',
    'comfy-nodes/requirements-dev.txt': 'pytest>=8\nReplicate==0.30  # eval helper\n',
  });
  const r = await checkOpenStack(root);
  expect(closedDetails(r, 'requirements-dev.txt')).toEqual(['requires "replicate" (closed Replicate API)']);
  expect(closedDetails(r, 'requirements.txt')).toEqual([]);
});

test('the Python manifests may be absent, but an unreadable one fails loudly', async () => {
  const none = await checkOpenStack(scratchRepo({ 'comfy-nodes/pack.py': 'x = 1\n' }));
  expect(none.violations.filter((v) => v.rule === 'closed-package')).toEqual([]);
  // a directory where pyproject.toml should be: EISDIR, not ENOENT
  const broken = scratchRepo({ 'comfy-nodes/pyproject.toml/keep': '' });
  await expect(checkOpenStack(broken)).rejects.toThrow();
});

test('importing a closed Python SDK fails, whatever the import form', async () => {
  const r = await checkOpenStack(fixture('dirty-comfy-imports'));
  const imports = r.violations.filter((v) => v.rule === 'closed-package' && /comfy-nodes[\\/]sdk\.py$/.test(v.file));
  expect(imports.map((v) => v.detail)).toEqual([
    'imports "openai" (closed OpenAI API)',
    'imports "google.genai" (closed Google Gemini API)',
    'imports "boto3" (AWS SDK, carries Bedrock)',
  ]);
});

test('Python imports are matched by module prefix on dot boundaries, from the explicit module map', async () => {
  const root = scratchRepo({
    'comfy-nodes/closed.py': [
      'from google import genai',
      'from google.cloud import aiplatform, storage as gcs',
      'from google import (',
      '    generativeai as old,  # legacy',
      ')',
      'import vertexai',
      'from botocore.exceptions import ClientError',
      'import fal_client as fal',
      'import os, cohere',
      'try:',
      '    import elevenlabs.client',
      'except ImportError:',
      '    pass',
    ].join('\n'),
    'comfy-nodes/open.py': [
      'import google',
      'import google.protobuf',
      'from google import protobuf',
      'from google.cloud import storage',
      'import google.genaix',
      'from google.genaix import y',
      'import openai_utils',
      'from . import openai',
      'from .openai import client',
      'import yaml',
      '# import anthropic',
      'x = "import mistralai"',
    ].join('\n'),
  });
  const r = await checkOpenStack(root);
  const flagged = (file: string) =>
    r.violations.filter((v) => v.rule === 'closed-package' && v.file === join('comfy-nodes', file)).map((v) => v.detail);
  expect(flagged('closed.py')).toEqual([
    'imports "google.genai" (closed Google Gemini API)',
    'imports "google.cloud.aiplatform" (closed Google Vertex AI API)',
    'imports "google.generativeai" (closed Google Gemini API)',
    'imports "vertexai" (closed Google Vertex AI API)',
    'imports "botocore" (AWS SDK, carries Bedrock)',
    'imports "fal_client" (closed fal.ai API)',
    'imports "cohere" (closed Cohere API)',
    'imports "elevenlabs" (closed ElevenLabs API)',
  ]);
  expect(flagged('open.py')).toEqual([]);
});

test('prose in a Python docstring or a comment does not count as an import', async () => {
  const root = scratchRepo({
    'comfy-nodes/doc.py': [
      '"""This node can not call a closed API:',
      'we do not import openai here, nor from anthropic import Client.',
      '"""',
      'name = "boto3"  # import boto3 would be a bug',
    ].join('\n'),
  });
  const r = await checkOpenStack(root);
  expect(r.violations.filter((v) => v.rule === 'closed-package')).toEqual([]);
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

test('the source scan skips the static export of the web app (out/), its own bundle output', async () => {
  // Next's minified router reads `x.router`; the showcase export holds it under apps/web/out.
  const routerLike = 'export const go = (x) => x.router.push("/");\n';
  const root = scratchRepo({
    'apps/web/out/_next/static/chunks/app.js': routerLike,
    'apps/web/src/lib/x.ts': routerLike,
  });
  const r = await checkOpenStack(root);
  const hits = r.violations.filter((v) => v.rule === 'forbidden-pattern');
  expect(hits.map((v) => v.file)).toEqual([join('apps', 'web', 'src', 'lib', 'x.ts')]);
});

test('a source folder that happens to be named out is still scanned', async () => {
  const routerLike = 'export const go = (x) => x.router.push("/");\n';
  const root = scratchRepo({
    'apps/web/src/out/x.ts': routerLike,
    'apps/other/out/y.ts': routerLike,
    'packages/p/src/out/z.ts': routerLike,
  });
  const r = await checkOpenStack(root);
  const hits = r.violations.filter((v) => v.rule === 'forbidden-pattern');
  expect(hits.map((v) => v.file).sort()).toEqual(
    [join('apps', 'other', 'out', 'y.ts'), join('apps', 'web', 'src', 'out', 'x.ts'), join('packages', 'p', 'src', 'out', 'z.ts')].sort(),
  );
});
