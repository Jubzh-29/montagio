import type { JobSummary } from '@/lib/api-types';
import { needsConsent } from '@/lib/consent';
import { MAX_POLL_FAILURES, pollDelay, pollStep, type JobPoll } from '@/lib/use-job';

const running: JobSummary = { id: 'j1', task: 't2i', state: 'running', progress: 0.4, label: {}, modelId: 'z-image-turbo', createdAt: '2026-10-20T08:00:00.000Z' };
const start: JobPoll = { job: running, failures: 0, error: null };

test('404 is lost', () => {
  expect(pollStep(start, { status: 404 })).toEqual({ job: { ...running, state: 'failed', error: 'lost' }, failures: 0, error: null });
});

test('four failures in a row end in an error', () => {
  let state = start;
  for (let i = 1; i < MAX_POLL_FAILURES; i++) {
    state = pollStep(state, i % 2 ? 'network-error' : { status: 502 });
    expect(state).toMatchObject({ failures: i, error: null });
  }
  expect(MAX_POLL_FAILURES).toBe(4);
  expect(pollStep(state, 'network-error')).toEqual({ job: running, failures: 0, error: 'errorGeneric' });
});

test('a success resets the failures and takes the new state', () => {
  const failing = pollStep(start, 'network-error');
  const next = pollStep(failing, { status: 200, body: { ...running, state: 'succeeded', progress: 1 } });
  expect(next).toEqual({ job: { ...running, state: 'succeeded', progress: 1 }, failures: 0, error: null });
});

test('the delay grows with the failures', () => {
  expect(pollDelay(start)).toBe(1000);
  expect(pollDelay({ ...start, failures: 2 })).toBe(3000);
});

const ready = (personal: boolean) => ({ status: 'ready' as const, localUrl: '/x.png', imageRef: 'uploads/x.png', personal });

test('an imported photo needs consent for an edit, an effect, a hook or an avatar', () => {
  for (const action of ['edit', 'effect', 'hook', 'avatar'] as const) expect(needsConsent(ready(true), action)).toBe(true);
});

test('a sample or a text-made photo does not, nor a photo still uploading', () => {
  expect(needsConsent(ready(false), 'edit')).toBe(false);
  expect(needsConsent({ status: 'uploading', localUrl: '/x.png' }, 'effect')).toBe(false);
});

test('camera moves never ask', () => {
  expect(needsConsent(ready(true), 'camera')).toBe(false);
});
