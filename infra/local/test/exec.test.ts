import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { capture, npmInvocation, nextBin, stream, tsxCli } from '../src/exec.ts';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('capture reads the output and exit code of a program, without a shell', async () => {
  const result = await capture(process.execPath, ['-e', 'console.log("out"); console.error("err"); process.exit(3)']);
  expect(result).toEqual({ code: 3, stdout: 'out\n', stderr: 'err\n' });
});

test('capture of a program that does not exist gives a null code', async () => {
  expect((await capture('definitely-not-a-command-xyz', [])).code).toBeNull();
});

test('capture passes an argument with spaces as one argument', async () => {
  const result = await capture(process.execPath, ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', 'a b c']);
  expect(JSON.parse(result.stdout)).toEqual(['a b c']);
});

test('stream gives the exit code', async () => {
  expect(await stream(process.execPath, ['-e', 'process.exit(4)'])).toBe(4);
});

test('npmInvocation runs npm-cli.js with this node when it can find it', () => {
  const winCli = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js';
  expect(npmInvocation('C:\\Program Files\\nodejs\\node.exe', 'windows', {}, (p) => p === winCli)).toEqual({
    cmd: 'C:\\Program Files\\nodejs\\node.exe',
    args: [winCli],
    shell: false,
  });
  const linuxCli = '/opt/node/lib/node_modules/npm/bin/npm-cli.js';
  expect(npmInvocation('/opt/node/bin/node', 'linux', {}, (p) => p === linuxCli)).toEqual({ cmd: '/opt/node/bin/node', args: [linuxCli], shell: false });
});

test('npm_execpath comes first, and npm through a shell is the last resort', () => {
  const env = { npm_execpath: '/x/npm/bin/npm-cli.js' };
  expect(npmInvocation('/opt/node/bin/node', 'linux', env, () => true).args).toEqual(['/x/npm/bin/npm-cli.js']);
  expect(npmInvocation('/opt/node/bin/node', 'linux', { npm_execpath: '/x/yarn.js' }, () => false)).toEqual({ cmd: 'npm', args: [], shell: true });
});

test('tsx and next are found in the repository node_modules', () => {
  expect(existsSync(tsxCli(repoRoot))).toBe(true);
  expect(existsSync(nextBin(repoRoot))).toBe(true);
});
