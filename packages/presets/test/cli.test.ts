import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from '../src/cli';

const repoRoot = () => fileURLToPath(new URL('../../../', import.meta.url));

let lines: string[];
let io: Parameters<typeof runCli>[1];
let good: string;
let bad: string;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'montagio-cli-'));
  good = join(repoRoot(), 'presets', 'crash-push.yaml');
  bad = join(dir, 'bad.yaml');
  writeFileSync(bad, readFileSync(good, 'utf8').replace('speed: 1.5', 'sped: 1.5'));
});

beforeEach(() => {
  lines = [];
  io = { cwd: repoRoot(), root: repoRoot(), out: (line) => lines.push(line), err: (line) => lines.push(line) };
});

test('valid and invalid files: exit 1 and one line per file', async () => {
  expect(await runCli(['preset', 'validate', good, bad], io)).toBe(1);
  expect(lines).toEqual([`✓ ${good}`, `✗ ${bad}`, expect.stringMatching(/^ {2}- camera.*sped/)]);
});

test('a relative path is resolved from the working directory', async () => {
  expect(await runCli(['preset', 'validate', join('presets', 'crash-push.yaml')], io)).toBe(0);
  expect(lines).toEqual([`✓ ${join('presets', 'crash-push.yaml')}`]);
});

test('a folder validates every preset in it', async () => {
  expect(await runCli(['preset', 'validate', join(repoRoot(), 'presets')], io)).toBe(0);
  expect(lines.length).toBeGreaterThanOrEqual(3);
  expect(lines.every((line) => line.startsWith('✓ '))).toBe(true);
});

test('a broken preset inside the repository folder is reported, not a library failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'montagio-cli-repo-'));
  cpSync(fileURLToPath(new URL('./fixtures/repo-ok', import.meta.url)), root, { recursive: true });
  const crash = join(root, 'presets', 'crash-push.yaml');
  const broken = join(root, 'presets', 'broken.yaml');
  writeFileSync(broken, readFileSync(crash, 'utf8').replace('id: crash-push', 'id: broken').replace(/speed: [\d.]+/, 'sped: 1'));
  expect(await runCli(['preset', 'validate', join(root, 'presets')], { ...io, root })).toBe(1);
  expect(lines).toEqual([`✗ ${broken}`, expect.stringMatching(/^ {2}- camera.*sped/), `✓ ${crash}`]);
});

test.each([[[]], [['preset']], [['preset', 'validate']], [['nope']], [['preset', 'validate', 'missing.yaml']]])(
  'usage error %j -> exit 2',
  async (argv) => {
    expect(await runCli(argv, io)).toBe(2);
    expect(lines.length).toBeGreaterThan(0);
  },
);

test('the npm script runs end to end', () => {
  const res = spawnSync('npm', ['run', '--silent', 'montagio', '--', 'preset', 'validate', 'presets'], {
    cwd: repoRoot(),
    shell: true,
    encoding: 'utf8',
  });
  expect(res.status, res.stderr).toBe(0);
  expect(res.stdout).toContain('✓');
}, 60_000);

test('the npm script entry runs when the repository is reached through a junction or symlink', () => {
  // Node resolves the main module's import.meta.url through realpath but keeps argv[1] as given,
  // so an "am I the entry point?" guard silently skips main() behind a link.
  const script = (JSON.parse(readFileSync(join(repoRoot(), 'package.json'), 'utf8')) as { scripts: Record<string, string> })
    .scripts.montagio!;
  const entry = script.replace(/^tsx\s+/, '');
  const link = join(mkdtempSync(join(tmpdir(), 'montagio-link-')), 'repo');
  symlinkSync(repoRoot(), link, 'junction');
  const res = spawnSync(process.execPath, ['--import', 'tsx', join(link, entry), 'preset', 'validate', bad], {
    cwd: link,
    encoding: 'utf8',
  });
  expect(res.status, res.stderr).toBe(1);
  expect(res.stdout).toContain(`✗ ${bad}`);
}, 60_000);

test('two files with the same preset id fail, as the app library would', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'montagio-cli-dup-'));
  const first = join(dir, 'crash-push.yaml');
  const second = join(dir, 'my-push.yaml');
  writeFileSync(first, readFileSync(good, 'utf8'));
  writeFileSync(second, readFileSync(good, 'utf8').replace('name: Crash Push', 'name: My Push'));
  expect(await runCli(['preset', 'validate', dir], io)).toBe(1);
  expect(lines).toEqual([`✓ ${first}`, `✗ ${second}`, `  - id: duplicate preset id "crash-push" (also in ${first})`]);
});

test('a file named twice is validated once', async () => {
  expect(await runCli(['preset', 'validate', good, good], io)).toBe(0);
  expect(lines).toEqual([`✓ ${good}`]);
});

describe('file encoding (the ComfyUI node pack reads presets as strict UTF-8)', () => {
  const text = () => readFileSync(good, 'utf8').replace(/^description: .*$/m, 'description: Révèle la scène.');
  const write = (name: string, bytes: Buffer) => {
    const path = join(mkdtempSync(join(tmpdir(), 'montagio-cli-enc-')), name);
    writeFileSync(path, bytes);
    return path;
  };

  test('a Windows-1252 file is refused instead of read with replacement characters', async () => {
    const path = write('latin.yaml', Buffer.from(text(), 'latin1'));
    expect(await runCli(['preset', 'validate', path], io)).toBe(1);
    expect(lines).toEqual([`✗ ${path}`, '  - file is not UTF-8 text: save it as UTF-8']);
  });

  test('a UTF-16 file is refused with the same advice', async () => {
    const path = write('utf16.yaml', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text(), 'utf16le')]));
    expect(await runCli(['preset', 'validate', path], io)).toBe(1);
    expect(lines).toEqual([`✗ ${path}`, '  - file is UTF-16 text: save it as UTF-8']);
  });

  test('a UTF-8 file with a byte order mark is valid', async () => {
    const path = write('bom.yaml', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text(), 'utf8')]));
    expect(await runCli(['preset', 'validate', path], io)).toBe(0);
  });
});
