/**
 * A fake comfy-api-proxy for the "local" e2e and for trying the local backend
 * without a GPU: every job ends with the given clip as its video output.
 *
 *   npx tsx packages/comfy-adapter/scripts/fake-proxy.ts --port 8190 --clip demo-assets/clips/_default.mp4
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { startFakeProxy } from '../src/testing/fake-proxy';

const { values } = parseArgs({ options: { port: { type: 'string', default: '8190' }, clip: { type: 'string' } } });
if (!values.clip) {
  console.error('usage: fake-proxy --port N --clip <mp4>');
  process.exit(2);
}
const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`invalid --port ${values.port}`);
  process.exit(2);
}

const proxy = await startFakeProxy({ port, autoRun: { clip: resolve(values.clip) } });
console.log(`fake comfy-api-proxy listening on ${proxy.url}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void proxy.close().then(() => process.exit(0)));
}
