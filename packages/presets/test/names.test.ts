import { fileURLToPath } from 'node:url';
import { loadLibrary } from '../src/index';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

// The project's rule: every effect and hook carries a name of its own. The list is exact, so a
// renamed or added preset is a decision this test makes visible.
test('the effects and hooks carry the project names, ids and display names', async () => {
  const lib = await loadLibrary(repoRoot);
  const names = (presets: Iterable<{ id: string; name: string }>) =>
    Object.fromEntries([...presets].map((preset) => [preset.id, preset.name]).sort(([a], [b]) => a!.localeCompare(b!)));
  expect(names(lib.effects.values())).toEqual({
    cakeify: 'Cake-ify',
    explode: 'Explode',
    'frozen-moment': 'Frozen Moment',
    'full-circle': 'Full Circle',
    'snap-zoom': 'Snap Zoom',
    squish: 'Squish',
  });
  expect(names(lib.hooks.values())).toEqual({
    figurine: 'Figurine',
    ignite: 'Ignite',
    'iris-dive': 'Iris Dive',
    'wardrobe-swap': 'Wardrobe Swap',
  });
});
