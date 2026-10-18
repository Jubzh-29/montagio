import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { FullConfig } from '@playwright/test';

/**
 * Every page and route of src/app, with each dynamic segment filled by a
 * placeholder: the handler answers 404 (or 405 for a POST-only route), but
 * Next has compiled it.
 */
function appRoutes(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      const segment = entry.name.startsWith('[') ? 'warm-up' : entry.name;
      return appRoutes(join(dir, entry.name), `${prefix}/${segment}`);
    }
    return /^(page|route)\.tsx?$/.test(entry.name) ? [prefix || '/'] : [];
  });
}

/**
 * Next dev compiles a route on its first request. On a loaded machine that
 * takes 5 to 18 s, which the first test to reach the route would pay inside
 * its own timeouts while the other worker compiles too. Request every route
 * once, one at a time, before the first test.
 */
export default async function warmUp(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]!.use.baseURL!;
  for (const route of appRoutes(join(__dirname, '..', 'src', 'app'))) {
    await fetch(new URL(route, baseURL));
  }
}
