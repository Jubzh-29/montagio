// Build the static showcase (the free demo link) into apps/web/out:
//
//   node scripts/showcase-build.mjs [--release] [--base-path montagio]
//
// 1. check-open-stack writes the report the Open Stack page reads;
// 2. `showcase prepare` writes public/showcase (clips, placeholders, 9:16 cuts,
//    workflows, data.json) — strict in a release;
// 3. ffmpeg.wasm is copied to public/ffmpeg (served from the showcase's own origin);
// 4. `next build` exports the pages (MONTAGIO_SHOWCASE_EXPORT=1); it builds in apps/web/.next,
//    so the script refuses to start over a production build there;
// 5. Next 16.4.2 export fixes (export-fixes.mjs), then the Hugging Face Space card is copied to out/README.md.
//
// A release needs MONTAGIO_REPO_URL, the public repository (source link, AGPL-3.0 §13).
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { nextBuildKind, normalizeBasePath, normalizeRepoUrl } from './build-options.mjs';
import { flattenSegmentPrefetches } from './export-fixes.mjs';
import { ffmpegLicenses } from './ffmpeg-licenses.mjs';

const web = fileURLToPath(new URL('..', import.meta.url));
const root = join(web, '..', '..');
const require = createRequire(import.meta.url);

const { values } = parseArgs({ options: { release: { type: 'boolean', default: false }, 'base-path': { type: 'string' } } });
let basePath;
let repoUrl;
try {
  basePath = normalizeBasePath(values['base-path']);
  repoUrl = normalizeRepoUrl(process.env.MONTAGIO_REPO_URL);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
if (values.release && !repoUrl) {
  console.error('a release build needs MONTAGIO_REPO_URL, the public repository URL (the showcase links to its source code)');
  process.exit(2);
}
// Next 16.4.2 builds a static export in .next as well (a distDir would only rename out/):
// never replace the production build that next start serves, e.g. the local installer's.
if (nextBuildKind(join(web, '.next')) === 'server') {
  console.error(
    'apps/web/.next holds a production build (next build, served by next start): the showcase build would replace it. ' +
      'Build the showcase from another checkout, or delete apps/web/.next first (then run next build again before next start).',
  );
  process.exit(2);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = (command, args, opts = {}) => {
  console.log(`\n> ${command} ${args.join(' ')}`);
  execFileSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
};

run(npm, ['run', 'check:open-stack'], { cwd: root });
run(npm, ['run', 'showcase', '--', 'prepare', ...(values.release ? ['--strict'] : []), ...(repoUrl ? ['--repo-url', repoUrl] : [])], { cwd: root });

// ffmpeg.wasm never goes through the bundler (Turbopack cannot resolve its worker URL):
// the page imports these files at run time from /ffmpeg/.
const ffmpegOut = join(web, 'public', 'ffmpeg');
rmSync(ffmpegOut, { recursive: true, force: true });
mkdirSync(ffmpegOut, { recursive: true });
/** The folder of an installed package (its exports may not include package.json). */
function packageDir(name) {
  for (let dir = dirname(require.resolve(name)); dir !== dirname(dir); dir = dirname(dir)) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === name) return dir;
  }
  throw new Error(`cannot find the folder of ${name}`);
}
const ffmpegPkg = packageDir('@ffmpeg/ffmpeg');
const corePkg = packageDir('@ffmpeg/core');
cpSync(join(ffmpegPkg, 'dist', 'esm'), join(ffmpegOut, 'esm'), { recursive: true, filter: (path) => !path.endsWith('.d.ts') && !path.endsWith('.d.mts') });
for (const file of ['ffmpeg-core.js', 'ffmpeg-core.wasm']) copyFileSync(join(corePkg, 'dist', 'esm', file), join(ffmpegOut, file));
writeFileSync(join(ffmpegOut, 'LICENSES.txt'), ffmpegLicenses(readFileSync(join(root, 'comfy-nodes', 'LICENSE'), 'utf8')));

rmSync(join(web, 'out'), { recursive: true, force: true });
run(npx, ['next', 'build'], {
  cwd: web,
  env: {
    ...process.env,
    MONTAGIO_SHOWCASE_EXPORT: '1',
    NEXT_PUBLIC_MONTAGIO_MODE: 'showcase',
    NEXT_PUBLIC_MONTAGIO_BASE_PATH: basePath,
    NEXT_TELEMETRY_DISABLED: '1',
  },
});

for (const file of flattenSegmentPrefetches(join(web, 'out'))) console.log(`export fix: ${file}`);
copyFileSync(join(web, 'showcase-space', 'README.md'), join(web, 'out', 'README.md'));
// GitHub Pages runs Jekyll unless told not to, and Jekyll drops the _next/ folder.
if (basePath) writeFileSync(join(web, 'out', '.nojekyll'), '');

const size = (path) => (statSync(path).isDirectory() ? readdirSync(path).reduce((sum, name) => sum + size(join(path, name)), 0) : statSync(path).size);
console.log(`\nshowcase: apps/web/out is ready (${(size(join(web, 'out')) / 1024 / 1024).toFixed(1)} MB)${basePath ? ` for ${basePath}/` : ''}`);
