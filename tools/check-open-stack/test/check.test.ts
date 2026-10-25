import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { checkOpenStack, loadedFile } from '../src/index';

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
  const wan21 = 'https://huggingface.co/Wan-AI/Wan2.1-I2V-14B-480P';
  const camera = 'https://huggingface.co/alibaba-pai/Wan2.2-Fun-A14B-Control-Camera';
  expect(r.models).toEqual([
    {
      id: 'wan22-i2v-a14b-fun-camera',
      name: 'Wan 2.2 Fun Camera',
      function: 'camera',
      license: 'Apache-2.0',
      weights: [
        { id: 'wan22-fun-camera-high', license: 'Apache-2.0', file: 'wan2.2_fun_camera_high_noise_14B_fp8_scaled.safetensors', source: camera },
        { id: 'wan22-fun-camera-low', license: 'Apache-2.0', file: 'wan2.2_fun_camera_low_noise_14B_fp8_scaled.safetensors', source: camera },
        { id: 'umt5-xxl-fp8', license: 'Apache-2.0', file: 'umt5_xxl_fp8_e4m3fn_scaled.safetensors', source: 'https://huggingface.co/google/umt5-xxl' },
        { id: 'wan21-vae', license: 'Apache-2.0', file: 'wan_2.1_vae.safetensors', source: wan21 },
      ],
    },
  ]);
});

test('the repository report lists every weight it ships, each under what it makes', async () => {
  const r = await checkOpenStack(repoRoot(), { configDir: toolDir });
  // Every function the Studio offers, in the order of the Open Stack page.
  expect([...new Set(r.models.map((model) => model.function))]).toEqual(['camera', 'effects', 'transitions', 'photo', 'avatar', 'music', 'hd', 'motion', 'restyle', 'swap']);
  expect(r.models.find((model) => model.id === 'wan-animate2-motion')).toMatchObject({ function: 'motion', extension: 'motion' });
  expect(r.models.find((model) => model.id === 'wan21-vace-restyle')).toMatchObject({ function: 'restyle', extension: 'restyle' });
  expect(r.models.find((model) => model.id === 'z-image-turbo')).toMatchObject({ function: 'photo' });
  expect(r.models.find((model) => model.id === 'z-image-turbo')).not.toHaveProperty('extension');
  // Nothing fetched goes unlisted: each lock weight is a weight of a listed model, with its size and source.
  const lock = (parseYaml(readFileSync(join(repoRoot(), 'registry', 'models.lock.yaml'), 'utf8')) as { weights: { id: string }[] }).weights;
  const listed = new Map(r.models.flatMap((model) => model.weights.map((weight) => [weight.id, weight] as const)));
  expect(lock.map((entry) => entry.id).filter((id) => !listed.has(id))).toEqual([]);
  for (const weight of listed.values()) expect(weight).toMatchObject({ bytes: expect.any(Number), source: expect.stringMatching(/^https:\/\//) });
}, 60_000);

test('a lock weight that no model declares is a violation: the page would not list it', async () => {
  const clean = (path: string) => readFileSync(join(fixture('clean'), path), 'utf8');
  const root = scratchRepo({
    'presets/crash-push.yaml': clean('presets/crash-push.yaml'),
    'registry/models/wan-fun-camera.yaml': clean('registry/models/wan-fun-camera.yaml'),
    'workflows/wan22-fun-camera.api.json': clean('workflows/wan22-fun-camera.api.json'),
    'registry/models.lock.yaml':
      clean('registry/models.lock.yaml') +
      '  - id: stray-upscaler\n    file: stray.safetensors\n    url: https://huggingface.co/Wan-AI/Wan2.1-I2V-14B-480P\n    license: Apache-2.0\n    source: https://huggingface.co/Wan-AI/Wan2.1-I2V-14B-480P\n',
  });
  const r = await checkOpenStack(root, { configDir: toolDir });
  expect(r.violations).toContainEqual(
    expect.objectContaining({ rule: 'weight-unlisted', file: join('registry', 'models.lock.yaml'), detail: expect.stringContaining('stray-upscaler') }),
  );
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

test('the SAM 2 loader reads a "-fp16" file in fp16 or bf16 for a SAM 2.1 model, the name as written otherwise', () => {
  const sam = (precision: string, model = 'sam2.1_hiera_base_plus.safetensors') => loadedFile('DownloadAndLoadSAM2Model', { model, precision }, model);
  expect(sam('fp16')).toBe('sam2.1_hiera_base_plus-fp16.safetensors');
  expect(sam('bf16')).toBe('sam2.1_hiera_base_plus-fp16.safetensors');
  expect(sam('fp32')).toBe('sam2.1_hiera_base_plus.safetensors');
  expect(sam('fp16', 'sam2_hiera_base_plus.safetensors')).toBe('sam2_hiera_base_plus.safetensors');
  expect(loadedFile('UNETLoader', { unet_name: 'x.safetensors' }, 'x.safetensors')).toBe('x.safetensors');
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
      '  - { id: music, priority: 5, gpu_validated: null }\n  - { id: upscale, priority: 6, gpu_validated: null }\n' +
      '  - { id: motion, priority: 7, gpu_validated: null }\n  - { id: restyle, priority: 8, gpu_validated: null }\n' +
      '  - { id: swap, priority: 9, requires: [restyle], gpu_validated: null }\n',
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
  // it reads every file of the repository: past 5 s on a laptop running the other suites
}, 30_000);

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

// Weight sources (allowed-sources.yaml): the repository a lock URL is fetched from, and the one its license is read from.

const withExtraWeight = (url: string, source: string, license = 'Apache-2.0') => {
  const clean = (path: string) => readFileSync(join(fixture('clean'), path), 'utf8');
  return scratchRepo({
    'presets/crash-push.yaml': clean('presets/crash-push.yaml'),
    'registry/models/wan-fun-camera.yaml': clean('registry/models/wan-fun-camera.yaml'),
    'workflows/wan22-fun-camera.api.json': clean('workflows/wan22-fun-camera.api.json'),
    'registry/models.lock.yaml':
      clean('registry/models.lock.yaml') +
      `  - id: extra-lora\n    file: extra_lora.safetensors\n    url: ${url}\n    license: ${license}\n    source: ${source}\n`,
  });
};
const sourceViolations = (r: Awaited<ReturnType<typeof checkOpenStack>>) => r.violations.filter((v) => v.rule === 'weight-source');

test('a weight fetched from a refused repository fails, with the reason', async () => {
  const r = await checkOpenStack(
    withExtraWeight(
      'https://huggingface.co/Kijai/WanVideo_comfy/resolve/main/Lightx2v/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors',
      'https://huggingface.co/lightx2v/Wan2.1-I2V-14B-480P-StepDistill-CfgDistill-Lightx2v',
    ),
  );
  expect(sourceViolations(r)).toEqual([
    expect.objectContaining({ file: join('registry', 'models.lock.yaml'), detail: expect.stringMatching(/extra-lora.*Kijai\/WanVideo_comfy.*CC BY-NC-SA/) }),
  ]);
});

test('a weight fetched from a repository the list does not know fails', async () => {
  const r = await checkOpenStack(withExtraWeight('https://huggingface.co/some-org/some-lora/resolve/main/x.safetensors', 'https://huggingface.co/some-org/some-lora'));
  expect(sourceViolations(r).map((v) => v.detail)).toEqual([
    expect.stringMatching(/extra-lora is fetched from some-org\/some-lora, an unknown source repo/),
    expect.stringMatching(/extra-lora names some-org\/some-lora as its source, an unknown source repo/),
  ]);
});

test('a lock license that differs from the license of its source fails', async () => {
  const r = await checkOpenStack(
    withExtraWeight('https://huggingface.co/ResembleAI/chatterbox/resolve/main/ve.safetensors', 'https://huggingface.co/ResembleAI/chatterbox', 'Apache-2.0'),
  );
  expect(sourceViolations(r).map((v) => v.detail)).toEqual([expect.stringMatching(/extra-lora: license Apache-2.0 differs from its source ResembleAI\/chatterbox \(MIT\)/)]);
});

test('a mirror named as the source fails', async () => {
  const r = await checkOpenStack(
    withExtraWeight(
      'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/x.safetensors',
      'https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged',
    ),
  );
  expect(sourceViolations(r).map((v) => v.detail)).toEqual([expect.stringMatching(/extra-lora names the mirror Comfy-Org\/Wan_2.2_ComfyUI_Repackaged as its source/)]);
});

test('a refused repository is refused whatever the case of its name', async () => {
  const r = await checkOpenStack(
    withExtraWeight(
      'https://huggingface.co/kijai/wanvideo_comfy/resolve/main/x.safetensors',
      'https://huggingface.co/lightx2v/Wan2.1-I2V-14B-480P-StepDistill-CfgDistill-Lightx2v',
    ),
  );
  expect(sourceViolations(r).map((v) => v.detail)).toEqual([expect.stringMatching(/extra-lora is fetched from kijai\/wanvideo_comfy, a refused repository: .*CC BY-NC-SA/)]);
});

test('a listed repository is found whatever the case of its name', async () => {
  const r = await checkOpenStack(withExtraWeight('https://huggingface.co/remade-ai/squish/resolve/main/squish_18.safetensors', 'https://huggingface.co/REMADE-AI/Squish'));
  expect(sourceViolations(r)).toEqual([]);
});

// allowed-sources.yaml itself: a broken list is reported like any other violation.

/** A copy of the tool's config files whose allowed-sources.yaml is `sources`. */
const configWith = (sources: string): string => {
  const dir = scratchRepo({ 'allowed-sources.yaml': sources });
  for (const name of ['allowed-nodes.yaml', 'forbidden-packages.yaml', 'forbidden-patterns.yaml', 'forbidden-python-packages.yaml']) {
    writeFileSync(join(dir, name), readFileSync(join(toolDir, name)));
  }
  return dir;
};
const realSources = () => readFileSync(join(toolDir, 'allowed-sources.yaml'), 'utf8');
/** `sources` with one more entry at the end of its `sources:` list. */
const withSource = (sources: string, repo: string) =>
  sources.replace('\n# Never a source', `  - repo: ${repo}\n    license: Apache-2.0\n    role: source\n    revision: 0123456789abcdef\n    license_file: false\n\n# Never a source`);

test.each<[string, (text: string) => string, RegExp]>([
  ['no denied list', (text) => text.replace(/\ndenied:[\s\S]*$/, '\n'), /^denied: /],
  ['a license other than Apache-2.0 or MIT', (text) => text.replace('license: MIT\n    role: source\n    revision: 19671f40', 'license: CC-BY-NC-4.0\n    role: source\n    revision: 19671f40'), /^sources\.\d+\.license: /],
  ['a role other than source or mirror', (text) => text.replace('role: mirror', 'role: copy'), /^sources\.0\.role: /],
  ['a revision that is a branch name', (text) => text.replace('revision: ee6f4a40737a995bf5818954cfce6d59443b0f04', 'revision: main'), /^sources\.0\.revision: /],
  ['a revision shorter than 8 hex digits', (text) => text.replace('revision: ee6f4a40737a995bf5818954cfce6d59443b0f04', 'revision: ee6f4a4'), /^sources\.0\.revision: /],
  ['a * in a listed repository', (text) => text.replace('repo: Remade-AI/Squish', 'repo: Remade-AI/*'), /^sources\.\d+\.repo: /],
  ['a repository listed twice', (text) => withSource(text, 'remade-ai/SQUISH'), /Remade-AI\/Squish.*twice/],
  ['a listed repository that is also refused', (text) => withSource(text, 'kijai/WanVideo_comfy'), /kijai\/WanVideo_comfy is both listed and refused/],
  ['a listed repository that a refused pattern matches', (text) => withSource(text, 'artificialguybr/Wan-Redmond-Squish'), /artificialguybr\/Wan-Redmond-Squish is both listed and refused \(artificialguybr\/\*-Redmond-\*\)/],
  ['YAML that does not parse', () => 'sources: [\n', /invalid YAML/],
])('%s in allowed-sources.yaml is a violation, not a crash', async (_case, edit, detail) => {
  const r = await checkOpenStack(fixture('clean'), { configDir: configWith(edit(realSources())) });
  expect(r.ok).toBe(false);
  expect(sourceViolations(r)).toEqual([expect.objectContaining({ file: expect.stringMatching(/allowed-sources\.yaml$/), detail: expect.stringMatching(detail) })]);
});

test('the refused repositories include the two license traps of the official templates', () => {
  const text = readFileSync(join(toolDir, 'allowed-sources.yaml'), 'utf8');
  expect(text).toMatch(/- repo: Kijai\/WanVideo_comfy\n\s+reason: .*CC BY-NC-SA/);
  expect(text).toMatch(/- repo: Comfy-Org\/HunyuanVideo_1\.5_repackaged\n\s+reason: .*Tencent/);
});

// A third-party node is allowed at the commit the GPU pod installs (infra/runpod/versions.env), not another one.
test('every third-party node is allowed at the commit that versions.env pins for its repository', () => {
  const env = Object.fromEntries(
    readFileSync(join(repoRoot(), 'infra', 'runpod', 'versions.env'), 'utf8')
      .split(/\r?\n/)
      .filter((line) => /^[A-Z0-9_]+=/.test(line))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]),
  );
  const pinned = new Map(
    Object.entries(env)
      .filter(([key]) => key.endsWith('_NODE_REPO'))
      .map(([key, url]) => [/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(url)?.[1], env[key.replace(/_REPO$/, '_COMMIT')]]),
  );
  const { nodes } = parseYaml(readFileSync(join(toolDir, 'allowed-nodes.yaml'), 'utf8')) as { nodes: { class_type: string; source: string }[] };
  const thirdParty = nodes.filter((node) => node.source.includes('@'));
  expect(thirdParty.map((node) => node.class_type)).toContain('ChatterboxMTLTTS');
  for (const node of thirdParty) {
    const [repo, commit] = node.source.split('@') as [string, string];
    expect(commit.length, node.class_type).toBeGreaterThanOrEqual(8);
    expect(pinned.get(repo), `${node.class_type} from ${repo}`).toMatch(new RegExp(`^${commit}`));
  }
});
