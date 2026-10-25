import { CAPTION_LANGUAGES } from '@montagio/captions';
import { canExport, CAPTION_LANGUAGE_CHOICES, languageLabel, STYLE_LABEL } from '@/lib/captions';

describe('the captions panel', () => {
  it('names a language in the language of the interface, and keeps an unknown code as it is', () => {
    expect(languageLabel('fr', 'en')).toBe('French');
    expect(languageLabel('fr', 'fr')).toBe('français');
    expect(languageLabel('xx', 'en')).toBe('xx');
  });

  it('offers automatic detection, then the 22 caption languages', () => {
    expect(CAPTION_LANGUAGE_CHOICES).toEqual(['auto', ...CAPTION_LANGUAGES]);
  });

  it('exports a text that is not blank, in a language captions are made in, once no export runs', () => {
    expect(canExport({ text: 'Hello', supported: true, busy: false })).toBe(true);
    expect(canExport({ text: '   ', supported: true, busy: false })).toBe(false);
    expect(canExport({ text: 'Hello', supported: false, busy: false })).toBe(false);
    expect(canExport({ text: 'Hello', supported: true, busy: true })).toBe(false);
    expect(canExport({ text: 'x'.repeat(2001), supported: true, busy: false })).toBe(false);
  });

  it('names each of the five styles', () => {
    expect(Object.keys(STYLE_LABEL)).toEqual(['karaoke', 'pop', 'word', 'classic', 'neon']);
  });
});
