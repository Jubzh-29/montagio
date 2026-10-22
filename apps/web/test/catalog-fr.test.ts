import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { CATALOG_FR } from '@/i18n/catalog-fr';
import { catalogText } from '@/i18n';

const root = join(__dirname, '..', '..', '..');
const ids = ['presets', 'presets/effects', 'presets/transitions'].flatMap((folder) =>
  readdirSync(join(root, folder))
    .filter((file) => file.endsWith('.yaml'))
    .map((file) => (parse(readFileSync(join(root, folder, file), 'utf8')) as { id: string }).id),
);

test('every camera move, effect and hook has its French name and description', () => {
  expect(ids.length).toBeGreaterThan(20);
  for (const id of ids) {
    expect(CATALOG_FR[id], id).toMatchObject({ name: expect.stringMatching(/\S/), description: expect.stringMatching(/\S/) });
  }
});

test('the catalogue text follows the language, English from the YAML file', () => {
  const squish = { id: 'squish', name: 'Squish', description: 'Hands press the subject flat like soft clay.' };
  expect(catalogText('fr', squish)).toEqual({ name: 'Écrasé', description: 'Des mains aplatissent le sujet comme de la pâte à modeler.' });
  expect(catalogText('en', squish)).toEqual({ name: 'Squish', description: squish.description });
  expect(catalogText('fr', { id: 'not-translated', name: 'New move' })).toEqual({ name: 'New move', description: '' });
});
