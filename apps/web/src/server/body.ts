export type JsonBody = { ok: true; value: unknown } | { ok: false; reason: 'too-large' | 'invalid-json' };

/**
 * Read a JSON request body, but never more than `maxBytes`: a body past the cap is
 * refused as soon as it is known to be too large (declared length or bytes read),
 * so a pasted megabyte costs the server nothing.
 */
export async function readJsonBody(request: Request, maxBytes: number, opts: { allowEmpty?: boolean } = {}): Promise<JsonBody> {
  if (Number(request.headers.get('content-length')) > maxBytes) return { ok: false, reason: 'too-large' };
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: 'too-large' };
      }
      chunks.push(value);
    }
  }
  // A route whose resource is in the URL (HD of a clip) needs no body: empty reads as {}.
  if (opts.allowEmpty && size === 0) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
}
