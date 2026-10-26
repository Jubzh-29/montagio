import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const app = join(import.meta.dirname, '..', 'src', 'app');

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? routeFiles(join(dir, entry.name)) : entry.name === 'route.ts' ? [join(dir, entry.name)] : [],
  );
}

/**
 * What keeps another site from driving a route that changes something: a render needs the Idempotency-Key
 * header (jobCreationRoute, or its own check), which a page cannot add without the browser asking first;
 * every other change checks Sec-Fetch-Site (namesThisSite) and, for JSON, the content type (fromThisSite).
 */
const GUARDS = [/jobCreationRoute\(/, /headers\.get\('idempotency-key'\)/, /fromThisSite\(request\)/, /namesThisSite\(request\)/];
/** Checks a preset text and saves nothing. */
const UNGUARDED = new Set(['api/presets/validate/route.ts']);

test('every route that changes something refuses another site, the newest ones included', () => {
  const files = routeFiles(app);
  expect(files.length).toBeGreaterThan(50);
  const open = files.filter((file) => {
    const source = readFileSync(file, 'utf8');
    const changes = /export (async function|const) (POST|PUT|PATCH|DELETE)\b/.test(source);
    const name = relative(app, file).split('\\').join('/');
    return changes && !UNGUARDED.has(name) && !GUARDS.some((guard) => guard.test(source));
  });
  expect(open.map((file) => relative(app, file))).toEqual([]);
});

test('/api and /media pass the host check of proxy.ts, and nothing else of the app holds data', () => {
  const proxy = readFileSync(join(app, '..', 'proxy.ts'), 'utf8');
  expect(proxy).toContain("matcher: ['/api/:path*', '/media/:path*']");
  const outside = routeFiles(app)
    .map((file) => relative(app, file).split('\\').join('/'))
    .filter((name) => !name.startsWith('api/') && !name.startsWith('media/'));
  expect(outside).toEqual([]);
});
