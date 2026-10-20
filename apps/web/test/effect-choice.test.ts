import { defaultSubject, wallFilter } from '@/lib/effect-choice';

test('the subject takes the creation text, cut on a word', () => {
  expect(defaultSubject('a red fox in a snowy forest at dawn', 20)).toBe('a red fox in a snowy');
  expect(defaultSubject('  a red fox  ', 120)).toBe('a red fox');
  expect(defaultSubject('supercalifragilistic', 10)).toBe('supercalif');
});

test('no text, no subject', () => {
  expect(defaultSubject(undefined, 120)).toBe('');
  expect(defaultSubject('   ', 120)).toBe('');
});

const effects = [{ id: 'squish' }, { id: 'explode' }];
const hooks = [{ id: 'iris-dive' }];

test('the filter shows only effects, only hooks, or both', () => {
  expect(wallFilter(effects, hooks, 'all').map((item) => item.id)).toEqual(['squish', 'explode', 'iris-dive']);
  expect(wallFilter(effects, hooks, 'effects').map((item) => item.id)).toEqual(['squish', 'explode']);
  expect(wallFilter(effects, hooks, 'hooks').map((item) => item.id)).toEqual(['iris-dive']);
  expect(wallFilter(effects, hooks, 'all').map((item) => item.kind)).toEqual(['effect', 'effect', 'hook']);
});
