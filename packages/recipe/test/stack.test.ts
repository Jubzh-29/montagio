import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readStack } from '../src';

let root = '';
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'montagio-stack-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'montagio', version: '0.1.0' }));
  mkdirSync(join(root, 'infra', 'runpod'), { recursive: true });
  writeFileSync(
    join(root, 'infra', 'runpod', 'versions.env'),
    [
      '# pins',
      'COMFYUI_TAG=v0.41.0',
      'COMFYUI_COMMIT=98cc0bf84b7cb1383654c5b402e7612d875d6d22',
      'COMFY_API_PROXY_VERSION=0.1.6',
      'CHATTERBOX_NODE_REPO=https://github.com/wildminder/ComfyUI-Chatterbox.git',
      'CHATTERBOX_NODE_COMMIT=4597af8f59d4460d441e13533eae24b092e40952',
    ].join('\n'),
  );
  mkdirSync(join(root, 'comfy-nodes'));
  writeFileSync(join(root, 'comfy-nodes', 'pyproject.toml'), '[project]\nname = "montagio"\nversion = "0.1.2"\n');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test('the pinned stack: Montagio, ComfyUI, the proxy and every node pack', async () => {
  expect(await readStack(root, { MONTAGIO_COMMIT: 'abc1234' })).toEqual({
    montagio: { version: '0.1.0', commit: 'abc1234' },
    comfyui: { tag: 'v0.41.0', commit: '98cc0bf84b7cb1383654c5b402e7612d875d6d22' },
    proxy: '0.1.6',
    nodes: [
      { name: 'montagio', version: '0.1.2' },
      { name: 'ComfyUI-Chatterbox', repo: 'https://github.com/wildminder/ComfyUI-Chatterbox.git', commit: '4597af8f59d4460d441e13533eae24b092e40952' },
    ],
  });
});

test('outside a git checkout and without MONTAGIO_COMMIT, the commit is unknown', async () => {
  expect((await readStack(root, {})).montagio.commit).toBeNull();
});
