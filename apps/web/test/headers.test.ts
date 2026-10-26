import config from '../next.config';

/** The headers next.config.ts sets on `path`, merged as Next merges them (a later rule wins). */
async function headersOn(path: string): Promise<Record<string, string>> {
  const rules = (await config.headers?.()) ?? [];
  const set: Record<string, string> = {};
  for (const rule of rules) {
    const prefix = rule.source.replace('/:path*', '');
    if (rule.source === '/:path*' || path === prefix || path.startsWith(`${prefix}/`)) {
      for (const { key, value } of rule.headers) set[key.toLowerCase()] = value;
    }
  }
  return set;
}

test('another site cannot show the app in a frame, so it cannot make the user click in it unseen', async () => {
  for (const path of ['/', '/history', '/api/history']) {
    const headers = await headersOn(path);
    expect(headers['x-frame-options'], path).toBe('DENY');
    expect(headers['content-security-policy'], path).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options'], path).toBe('nosniff');
    // A link followed to TikTok or Hugging Face does not say where it was clicked.
    expect(headers['referrer-policy'], path).toBe('no-referrer');
  }
});

test("another site cannot embed the app's files or answers, even without reading them", async () => {
  for (const path of ['/api/history', '/media/data/uploads/a.png']) expect((await headersOn(path))['cross-origin-resource-policy'], path).toBe('same-origin');
  expect((await headersOn('/'))['cross-origin-resource-policy']).toBeUndefined();
});

test("Next's image optimizer, which the app never uses, does not answer", () => {
  expect(config.images?.unoptimized).toBe(true);
});
