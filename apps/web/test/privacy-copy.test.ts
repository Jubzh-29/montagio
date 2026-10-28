import en from '@/i18n/en.json';
import fr from '@/i18n/fr.json';

test('export and purge privacy notices exist in both languages', () => {
  expect(en.exportRecipeNotice).toBe('The file also carries its recipe: entered text and SHA-256 input hashes, never source media or local paths.');
  expect(fr.exportRecipeNotice).toBe('Le fichier contient aussi sa recette : les textes saisis et les empreintes SHA-256 des entrées, jamais les médias sources ni les chemins locaux.');
  for (const key of ['purgeConfirmationLabel', 'purgeRemoteIncomplete', 'purgeBusy', 'purgeConcurrent'] as const) {
    expect(en[key]).toBeTruthy();
    expect(fr[key]).toBeTruthy();
  }
});
