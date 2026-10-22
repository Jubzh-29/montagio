import { drawInstruction } from '@/components/DrawAtelier';

test('a drawing becomes a photo of what the visitor says, keeping its layout and colours', () => {
  const instruction = drawInstruction('  a red car on a coastal road  ');
  expect(instruction).toBe(
    'Turn this rough drawing into a photorealistic photo of a red car on a coastal road. Keep the composition, the shapes and the colors of the drawing. Natural light, sharp focus, no drawing lines left.',
  );
  // the edit takes 500 characters: the longest description fits
  expect(drawInstruction('x'.repeat(300)).length).toBeLessThanOrEqual(500);
});
