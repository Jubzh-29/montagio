import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as browser from '../src/browser';

const src = fileURLToPath(new URL('../src/', import.meta.url));
const registrySrc = fileURLToPath(new URL('../../registry/src/', import.meta.url));

/** The modules a file imports for their values (type-only imports are erased and do not count). */
function valueImports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?\sfrom\s+'([^']+)'/gm)].map((match) => match[1]!);
}

/** Every file the browser entry pulls in, following relative imports and @montagio/registry. */
function reachable(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const visit = (path: string) => {
    const file = path.replace(/\\/g, '/');
    if (seen.has(file)) return;
    const imports = valueImports(file);
    seen.set(file, imports);
    for (const spec of imports) {
      if (spec.startsWith('./')) visit(`${file.slice(0, file.lastIndexOf('/') + 1)}${spec.slice(2)}.ts`);
      else if (spec === '@montagio/registry') visit(`${registrySrc}index.ts`);
    }
  };
  visit(entry.replace(/\\/g, '/'));
  return seen;
}

test('the browser entry exports validatePreset and compileJob but not loadLibrary, and none of its modules imports node:', () => {
  expect(typeof browser.validatePreset).toBe('function');
  expect(typeof browser.compileJob).toBe('function');
  expect(typeof browser.parsePreset).toBe('function');
  expect('loadLibrary' in browser).toBe(false);
  const modules = reachable(`${src}browser.ts`.replace(/\\/g, '/'));
  expect([...modules.keys()].some((file) => file.endsWith('/library.ts'))).toBe(false);
  for (const [file, imports] of modules) {
    expect(imports.filter((spec) => spec.startsWith('node:')), file).toEqual([]);
  }
  expect(modules.size).toBeGreaterThan(4);
});
