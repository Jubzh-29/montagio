'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from './api';
import { TERMINAL_STATES, type JobSummary } from './api-types';
import { refreshExtensions } from './use-extensions';

export const POLL_MS = 1000;
export const MAX_POLL_FAILURES = 4;

/** A job followed by polling: the last state seen, the failures in a row, and a message key once polling gives up. */
export type JobPoll = { job: JobSummary | null; failures: number; error: string | null };

/**
 * One poll's answer, the Studio's rules: 404 means the server lost the job; server errors and
 * network failures are retried with a growing delay, and four in a row end in an error.
 */
export function pollStep(state: JobPoll, res: { status: number; body?: JobSummary } | 'network-error'): JobPoll {
  if (res !== 'network-error' && res.status === 404 && state.job) {
    return { job: { ...state.job, state: 'failed', error: 'lost' }, failures: 0, error: null };
  }
  if (res === 'network-error' || res.status >= 400 || !res.body) {
    const failures = state.failures + 1;
    return failures >= MAX_POLL_FAILURES ? { job: state.job, failures: 0, error: 'errorGeneric' } : { ...state, failures };
  }
  return { job: res.body, failures: 0, error: null };
}

export const pollDelay = (state: JobPoll) => POLL_MS * (state.failures + 1);

/**
 * Start a photo or effect job and follow it to its end. One request per click: a second
 * start while the first is on its way is ignored, and each start has its own idempotency key.
 * `refusal` is the server's code when it refused the request (see lib/refusals.ts).
 */
export function useJob(): {
  job: JobSummary | null;
  refusal: string | null;
  busy: boolean;
  start: (path: string, body: unknown) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
} {
  const [poll, setPoll] = useState<JobPoll>({ job: null, failures: 0, error: null });
  const [refusal, setRefusal] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const sending = useRef(false);
  const job = poll.job;
  const running = job !== null && !TERMINAL_STATES.has(job.state);

  useEffect(() => {
    if (!job || TERMINAL_STATES.has(job.state) || poll.error) return;
    const timer = setTimeout(async () => {
      let answer: { status: number; body?: JobSummary } | 'network-error';
      try {
        const res = await apiFetch(`/api/jobs/${job.id}`);
        answer = res.ok ? { status: res.status, body: (await res.json()) as JobSummary } : { status: res.status };
      } catch {
        answer = 'network-error';
      }
      setPoll((current) => (current.job?.id === job.id ? pollStep(current, answer) : current));
    }, pollDelay(poll));
    return () => clearTimeout(timer);
  }, [job, poll]);

  const start = async (path: string, body: unknown) => {
    if (sending.current || running) return;
    sending.current = true;
    setSubmitting(true);
    setRefusal(null);
    try {
      const res = await apiFetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const answer = (await res.json().catch(() => null)) as { error?: string } | null;
        // ComfyUI refused the workflow, or the server hides the extension: the button that led here goes too.
        if (answer?.error === 'workflow-rejected' || answer?.error === 'extension-disabled') refreshExtensions();
        setRefusal(answer?.error ?? 'error');
        return;
      }
      setPoll({ job: (await res.json()) as JobSummary, failures: 0, error: null });
    } catch {
      setRefusal('error');
    } finally {
      sending.current = false;
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (!job || !running) return;
    try {
      const res = await apiFetch(`/api/jobs/${job.id}/cancel`, { method: 'POST' });
      if (res.ok) setPoll({ job: (await res.json()) as JobSummary, failures: 0, error: null });
    } catch {
      // the next poll says what happened
    }
  };

  const reset = () => {
    setPoll({ job: null, failures: 0, error: null });
    setRefusal(null);
  };

  return { job, refusal: refusal ?? poll.error, busy: submitting || running, start, cancel, reset };
}
