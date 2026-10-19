import { readFileSync } from 'node:fs';
import { AI_METADATA, metadataArgs, PLACEHOLDER_METADATA } from '../src/tags';

test('tags.ts imports nothing from node', () => {
  // The showcase builds its films in the browser with these tags: no Node module may come along.
  const source = readFileSync(new URL('../src/tags.ts', import.meta.url), 'utf8');
  expect(source).not.toMatch(/from ['"]node:/);
  expect(source).not.toMatch(/require\(/);
});

test('metadataArgs drops the source tags and writes each tag', () => {
  expect(metadataArgs(AI_METADATA)).toEqual([
    '-map_metadata', '-1',
    '-metadata', 'comment=AI-generated',
    '-metadata', `description=${AI_METADATA.description}`,
  ]);
});

test('a placeholder never says it is AI-generated', () => {
  expect(PLACEHOLDER_METADATA.comment).toBe('Montagio showcase placeholder');
  expect(JSON.stringify(PLACEHOLDER_METADATA)).not.toMatch(/AI-generated/);
});
