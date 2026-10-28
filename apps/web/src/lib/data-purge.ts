export function canConfirmPurge(input: string, lang: 'en' | 'fr'): boolean {
  return input === (lang === 'fr' ? 'EFFACER' : 'DELETE');
}
