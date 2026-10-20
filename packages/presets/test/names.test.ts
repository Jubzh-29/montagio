import { fileURLToPath } from 'node:url';
import { loadLibrary } from '../src/index';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

// The project's rule: no effect, hook or preset name taken from a commercial competitor.
test('no effect or hook carries a name taken from the competitor', async () => {
  const lib = await loadLibrary(repoRoot);
  const takenNames = ['eyes in', 'outfit morph', 'bullet time', 'crash zoom', '360 orbit'];
  const takenIds = ['eyes-in', 'outfit-morph', 'bullet-time', 'crash-zoom-in', 'orbit-360'];
  for (const preset of [...lib.effects.values(), ...lib.hooks.values()]) {
    expect(takenNames).not.toContain(preset.name.toLowerCase());
    expect(takenIds).not.toContain(preset.id);
  }
  expect([...lib.effects.keys()].sort()).toEqual(['cakeify', 'explode', 'frozen-moment', 'full-circle', 'snap-zoom', 'squish']);
  expect([...lib.hooks.keys()].sort()).toEqual(['figurine', 'ignite', 'iris-dive', 'wardrobe-swap']);
});
