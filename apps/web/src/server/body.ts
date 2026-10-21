export type JsonBody = { ok: true; value: unknown } | { ok: false; reason: 'too-large' | 'invalid-json' };
export type FormBody = { ok: true; form: FormData } | { ok: false; reason: 'too-large' | 'invalid-form' };

/**
 * Read a request body, but never more than `maxBytes`: a body past the cap is refused (null)
 * as soon as it is known to be too large (declared length or bytes read), so a pasted
 * megabyte, or a phone's 2 GB video, costs the server nothing.
 */
export async function readBodyBytes(request: Request, maxBytes: number): Promise<Buffer | null> {
  if (Number(request.headers.get('content-length')) > maxBytes) return null;
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
        return null;
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks);
}

/** Read a JSON request body of `maxBytes` at most (see readBodyBytes). */
export async function readJsonBody(request: Request, maxBytes: number, opts: { allowEmpty?: boolean } = {}): Promise<JsonBody> {
  const bytes = await readBodyBytes(request, maxBytes);
  if (!bytes) return { ok: false, reason: 'too-large' };
  // A route whose resource is in the URL (HD of a clip) needs no body: empty reads as {}.
  if (opts.allowEmpty && bytes.byteLength === 0) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(bytes.toString('utf8')) };
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
}

/**
 * Read a form body (a multipart upload) of `maxBytes` at most (see readBodyBytes):
 * request.formData() would hold the whole body in memory before any size is checked.
 */
export async function readFormBody(request: Request, maxBytes: number): Promise<FormBody> {
  const bytes = await readBodyBytes(request, maxBytes);
  if (!bytes) return { ok: false, reason: 'too-large' };
  try {
    const headers = { 'content-type': request.headers.get('content-type') ?? '' };
    return { ok: true, form: await new Response(new Uint8Array(bytes), { headers }).formData() };
  } catch {
    return { ok: false, reason: 'invalid-form' };
  }
}
