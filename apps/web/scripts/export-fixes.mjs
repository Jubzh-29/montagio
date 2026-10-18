// Fixes applied to the static export after `next build` (see showcase-build.mjs).
import { copyFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Next 16.4.2 (output: export) writes the prefetch payload of a nested route's
 * segment as `<route>/__next.<segment>/__PAGE__.txt`, while its client asks for
 * `<route>/__next.<segment>.__PAGE__.txt` (the segment path with "/" turned into
 * "."): the prefetch answers 404 and a client navigation reloads the page.
 * Copy every such file to the flat name. Returns the files written, relative to `outDir`.
 */
export function flattenSegmentPrefetches(outDir) {
  const written = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === '_next') continue;
      const path = join(dir, entry.name);
      if (entry.name.startsWith('__next.')) {
        for (const file of readdirSync(path, { withFileTypes: true, recursive: true })) {
          if (!file.isFile()) continue;
          const inner = relative(path, join(file.parentPath, file.name)).split(sep).join('.');
          const flat = join(dir, `${entry.name}.${inner}`);
          copyFileSync(join(file.parentPath, file.name), flat);
          written.push(relative(outDir, flat).split(sep).join('/'));
        }
      } else {
        visit(path);
      }
    }
  };
  visit(outDir);
  return written.sort();
}
