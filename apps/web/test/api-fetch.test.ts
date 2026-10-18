import { jsonOrThrow } from '@/lib/api';

test('jsonOrThrow returns the body of a successful answer', async () => {
  await expect(jsonOrThrow<{ id: string }[]>(Response.json([{ id: 'crash-push' }]))).resolves.toEqual([{ id: 'crash-push' }]);
});

test('jsonOrThrow refuses an error answer instead of handing its body over as data', async () => {
  // The showcase answers 503 {"error":"showcase-unavailable"} when data.json is missing:
  // read as the preset list, that body crashed the whole Studio.
  const refused = Response.json({ error: 'showcase-unavailable' }, { status: 503 });
  await expect(jsonOrThrow(refused)).rejects.toThrow(/HTTP 503/);
});
