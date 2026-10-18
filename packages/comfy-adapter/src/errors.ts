export type BackendErrorCode = 'backend-unavailable' | 'workflow-rejected' | 'backend-error';

const BRAND = Symbol.for('montagio.BackendError');

/**
 * A backend failure the app can act on without reading the message:
 * "backend-unavailable" (proxy or pod unreachable, retry later), "workflow-rejected"
 * (ComfyUI refused the graph, details in the server log) and "backend-error"
 * (the proxy answered something unusable). The message never reaches a client.
 */
export class BackendError extends Error {
  override name = 'BackendError';
  readonly [BRAND] = true;

  constructor(
    readonly code: BackendErrorCode,
    readonly retryable: boolean,
    message?: string,
  ) {
    super(message ?? code);
  }
}

/**
 * True for a BackendError from any copy of this package: Next.js bundles route handlers
 * separately, so the backend shared on globalThis may throw another copy's class.
 */
export function isBackendError(error: unknown): error is BackendError {
  return typeof error === 'object' && error !== null && (error as Record<symbol, unknown>)[BRAND] === true;
}
