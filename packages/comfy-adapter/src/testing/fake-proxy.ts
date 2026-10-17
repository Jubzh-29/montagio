import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ApiWorkflow } from '@montagio/presets';

/**
 * A stand-in for comfy-api-proxy, for tests and for the "local" e2e: it serves the
 * Comfy API v2 routes that @comfyorg/sdk 0.5.0 calls (shapes from the SDK's
 * generated `types.gen.ts`), keeps everything in memory and renders nothing.
 * It listens on 127.0.0.1 only.
 */

export type FakeJobState = {
  status: string;
  progress: { value: number; nodes_done: number; nodes_total: number } | null;
  outputs: { node_id: string; name: string; type: string; content_type: string; assetId: string }[];
  error: { code: string; message: string } | null;
  workflow: ApiWorkflow;
  idempotencyKey?: string;
  /** Overrides the job's `urls.cancel` (to test a link that points elsewhere). */
  cancelUrl?: string;
};

export type FakeAsset = { bytes: Buffer; contentType: string; filePath: string; hash?: string };

export type FakeProxy = {
  url: string;
  requests: { method: string; path: string; headers: Record<string, string | undefined> }[];
  jobs: Map<string, FakeJobState>;
  assets: Map<string, FakeAsset>;
  setJob(id: string, patch: Partial<FakeJobState>): void;
  rejectNextSubmit(status: number, code: string): void;
  nextJobId(id: string): void;
  /** The next request (whose path starts with `pathPrefix`, if given) answers `status` to the same path on `origin`. */
  redirectNext(status: number, origin: string, pathPrefix?: string): void;
  close(): Promise<void>;
};

const TERMINAL = new Set(['succeeded', 'failed', 'canceled', 'expired']);
const CLIP_NAME = 'Montagio_00001.mp4';

const envelope = (code: string, message: string) => ({ error: { code, message } });

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body?: unknown, contentType = 'application/json'): void {
  if (body === undefined) {
    res.writeHead(status).end();
    return;
  }
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': contentType, 'content-length': payload.length }).end(payload);
}

/**
 * Start a fake proxy on 127.0.0.1 (`port` 0 picks a free one). With `autoRun`, every
 * GET of a job moves it one step: queued → running at 0.5 → succeeded, with one video
 * output whose bytes are those of `autoRun.clip`.
 */
export async function startFakeProxy(opts: { autoRun?: { clip: string }; port?: number } = {}): Promise<FakeProxy> {
  const jobs = new Map<string, FakeJobState>();
  const assets = new Map<string, FakeAsset>();
  const requests: FakeProxy['requests'] = [];
  const createdAt = new Map<string, string>();
  const clip = opts.autoRun ? readFileSync(opts.autoRun.clip) : null;
  let rejection: { status: number; code: string } | null = null;
  let forcedId: string | null = null;
  let redirect: { status: number; origin: string; pathPrefix: string } | null = null;
  let base = '';

  const assetJson = (id: string, asset: FakeAsset, createdNew: boolean) => ({
    id,
    hash: asset.hash ?? null,
    size_bytes: asset.bytes.length,
    content_type: asset.contentType,
    file_path: asset.filePath,
    created_new: createdNew,
    created_at: new Date().toISOString(),
    url: `${base}/api/v2/assets/${encodeURIComponent(id)}/content`,
    url_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  });

  const jobJson = (id: string, job: FakeJobState) => {
    const self = `${base}/api/v2/jobs/${encodeURIComponent(id)}`;
    const created = createdAt.get(id) ?? new Date().toISOString();
    return {
      id,
      status: job.status,
      created_at: created,
      started_at: job.status === 'queued' ? null : created,
      completed_at: TERMINAL.has(job.status) ? new Date().toISOString() : null,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      queue_position: job.status === 'queued' ? 0 : null,
      progress: job.progress,
      outputs: job.outputs.map((output) => {
        const asset = assets.get(output.assetId);
        return {
          node_id: output.node_id,
          name: output.name,
          type: output.type,
          content_type: output.content_type,
          size_bytes: asset?.bytes.length ?? 0,
          id: output.assetId,
          hash: asset?.hash ?? null,
          url: `${base}/api/v2/assets/${encodeURIComponent(output.assetId)}/content`,
          url_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        };
      }),
      error: job.error,
      urls: { self, events: `${self}/events`, cancel: job.cancelUrl ?? `${self}/cancel` },
    };
  };

  /** autoRun: one step per GET, like a render seen by successive polls. */
  const advance = (id: string, job: FakeJobState) => {
    if (!clip) return;
    if (job.status === 'queued') {
      job.status = 'running';
      job.progress = { value: 0.5, nodes_done: 1, nodes_total: 2 };
    } else if (job.status === 'running') {
      const assetId = `out-${id}`;
      assets.set(assetId, { bytes: clip, contentType: 'video/mp4', filePath: CLIP_NAME });
      const saveNode = Object.entries(job.workflow).find(([, node]) => node.class_type.startsWith('Save'))?.[0] ?? '0';
      job.status = 'succeeded';
      job.progress = { value: 1, nodes_done: 2, nodes_total: 2 };
      job.outputs = [{ node_id: saveNode, name: CLIP_NAME, type: 'video', content_type: 'video/mp4', assetId }];
    }
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const path = new URL(req.url ?? '/', 'http://fake').pathname;
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value]),
    );
    requests.push({ method, path, headers });
    const body = await readBody(req);
    let match: RegExpExecArray | null;

    if (redirect && path.startsWith(redirect.pathPrefix)) {
      const { status, origin } = redirect;
      redirect = null;
      res.writeHead(status, { location: `${origin}${req.url ?? '/'}`, 'content-length': 0 }).end();
      return;
    }

    if (method === 'GET' && path === '/api/v2/health') return send(res, 200, { status: 'ok' });

    if (method === 'HEAD' && (match = /^\/api\/v2\/assets\/by-hash\/([^/]+)$/.exec(path))) {
      const hash = decodeURIComponent(match[1]!);
      return send(res, [...assets.values()].some((asset) => asset.hash === hash) ? 200 : 404);
    }

    if (method === 'POST' && path === '/api/v2/assets') {
      const form = await new Response(new Uint8Array(body), { headers: { 'content-type': req.headers['content-type'] ?? '' } }).formData();
      const file = form.get('file');
      if (!(file instanceof Blob)) return send(res, 422, envelope('invalid_request', 'file is required'));
      const bytes = Buffer.from(await file.arrayBuffer());
      const asset: FakeAsset = {
        bytes,
        contentType: String(form.get('content_type') ?? 'application/octet-stream'),
        filePath: String(form.get('file_path') ?? 'upload.bin'),
        hash: String(form.get('expected_hash') ?? `sha256:${createHash('sha256').update(bytes).digest('hex')}`),
      };
      const id = `asset-${randomUUID()}`;
      assets.set(id, asset);
      return send(res, 201, assetJson(id, asset, true));
    }

    if (method === 'POST' && path === '/api/v2/assets/from-hash') {
      const { hash } = JSON.parse(body.toString('utf8') || '{}') as { hash?: string };
      const found = [...assets.entries()].find(([, asset]) => asset.hash === hash);
      if (!found) return send(res, 404, envelope('blob_not_found', 'no blob with this hash'));
      return send(res, 200, assetJson(found[0], found[1], false));
    }

    if (method === 'GET' && (match = /^\/api\/v2\/assets\/([^/]+)\/content$/.exec(path))) {
      const asset = assets.get(decodeURIComponent(match[1]!));
      if (!asset) return send(res, 404, envelope('asset_not_found', 'no such asset'));
      return send(res, 200, asset.bytes, asset.contentType);
    }

    if (method === 'POST' && path === '/api/v2/jobs') {
      if (rejection) {
        const { status, code } = rejection;
        rejection = null;
        return send(res, status, envelope(code, `fake proxy rejected the workflow (${code})`));
      }
      const { workflow } = JSON.parse(body.toString('utf8')) as { workflow: ApiWorkflow };
      const id = forcedId ?? `job-${randomUUID()}`;
      forcedId = null;
      const job: FakeJobState = { status: 'queued', progress: null, outputs: [], error: null, workflow };
      const key = req.headers['idempotency-key'];
      if (typeof key === 'string') job.idempotencyKey = key;
      jobs.set(id, job);
      createdAt.set(id, new Date().toISOString());
      return send(res, 201, jobJson(id, job));
    }

    if ((match = /^\/api\/v2\/jobs\/([^/]+)(\/cancel)?$/.exec(path))) {
      const id = decodeURIComponent(match[1]!);
      const job = jobs.get(id);
      if (!job) return send(res, 404, envelope('job_not_found', 'no such job'));
      if (method === 'GET' && !match[2]) {
        advance(id, job);
        return send(res, 200, jobJson(id, job));
      }
      if (method === 'POST' && match[2]) {
        if (!TERMINAL.has(job.status)) job.status = 'canceled';
        return send(res, 200, jobJson(id, job));
      }
    }

    return send(res, 404, envelope('not_found', `${method} ${path} is not served by the fake proxy`));
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => send(res, 500, envelope('internal', String(error))));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    url: base,
    requests,
    jobs,
    assets,
    setJob(id, patch) {
      const job = jobs.get(id);
      if (!job) throw new Error(`fake proxy: no job ${id}`);
      Object.assign(job, patch);
    },
    rejectNextSubmit(status, code) {
      rejection = { status, code };
    },
    nextJobId(id) {
      forcedId = id;
    },
    redirectNext(status, origin, pathPrefix = '') {
      redirect = { status, origin, pathPrefix };
    },
    close() {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
