import { messageFor } from '../src/errors';

test('a blocked term gets a specific refusal instead of the generic app error', () => {
  const message = messageFor('blocked-term');
  expect(message).toMatch(/explicit sexual content/);
  expect(message).toMatch(/refuses/);
  expect(message).not.toBe('The app refused the request (blocked-term).');
});
