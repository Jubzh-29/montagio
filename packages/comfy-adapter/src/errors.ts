export type BackendErrorCode = 'backend-unavailable' | 'workflow-rejected' | 'backend-error';

/**
 * A backend failure the app can act on without reading the message:
 * "backend-unavailable" (proxy or pod unreachable, retry later), "workflow-rejected"
 * (ComfyUI refused the graph, details in the server log) and "backend-error"
 * (the proxy answered something unusable). The message never reaches a client.
 */
export class BackendError extends Error {
  override name = 'BackendError';

  constructor(
    readonly code: BackendErrorCode,
    readonly retryable: boolean,
    message?: string,
  ) {
    super(message ?? code);
  }
}
