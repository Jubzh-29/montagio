import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DELETE as deleteCharacter } from '@/app/api/characters/[id]/route';
import { POST as postPhoto } from '@/app/api/characters/[id]/photos/route';
import { POST as postCharacter } from '@/app/api/characters/route';
import { POST as postUpload } from '@/app/api/uploads/route';
import { POST as postSampleUpload } from '@/app/api/uploads/sample/route';
import { POST as postSpeech } from '@/app/api/uploads/speech/route';
import { POST as postVideo } from '@/app/api/uploads/video/route';
import { POST as postSampleVideo } from '@/app/api/uploads/video/sample/route';
import { POST as postVoice } from '@/app/api/uploads/voice/route';
import { params, pngFile, setupTempData, uploadRequest } from './helpers';

// A form, a body-less POST or a DELETE another site sends to localhost: the browser names that site in Sec-Fetch-Site.
const dataDir = setupTempData();
let flag: string | undefined;
beforeEach(() => {
  flag = process.env.MONTAGIO_EXTENSIONS;
  process.env.MONTAGIO_EXTENSIONS = 'all';
});
afterEach(() => {
  if (flag === undefined) delete process.env.MONTAGIO_EXTENSIONS;
  else process.env.MONTAGIO_EXTENSIONS = flag;
});

const form = (field: string | null, site?: string) => {
  const body = new FormData();
  if (field) body.set(field, pngFile(1920, 1080));
  return new Request('http://localhost/api/x', { method: 'POST', headers: site ? { 'sec-fetch-site': site } : {}, body });
};
const bare = (method: string, site?: string) => new Request('http://localhost/api/x', { method, headers: site ? { 'sec-fetch-site': site } : {} });
const text = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/x', { method: 'POST', headers: { 'content-type': 'text/plain', ...headers }, body: JSON.stringify(body) });
const json = (body: unknown, site?: string) =>
  new Request('http://localhost/api/x', { method: 'POST', headers: { 'content-type': 'application/json', ...(site ? { 'sec-fetch-site': site } : {}) }, body: JSON.stringify(body) });

const refused = async (res: Response) => {
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: 'cross-site' });
};

test('another site cannot send a photo, a video or a voice, nor copy a sample', async () => {
  // same-site too: another port of localhost is the same site, not this app.
  for (const site of ['cross-site', 'same-site']) {
    await refused(await postUpload(form('image', site)));
    await refused(await postVideo(form('video', site)));
    await refused(await postVoice(form('audio', site)));
    await refused(await postSpeech(form('video', site)));
    await refused(await postSampleUpload(bare('POST', site)));
    await refused(await postSampleVideo(bare('POST', site)));
  }
  expect(existsSync(join(dataDir(), 'uploads'))).toBe(false);
});

test("the app's own pages, and a script that names no site, still send them", async () => {
  expect((await postUpload(form('image', 'same-origin'))).status).toBe(200);
  expect((await postUpload(uploadRequest(pngFile(1920, 1080)))).status).toBe(200);
  expect((await postSampleUpload(bare('POST', 'same-origin'))).status).toBe(201);
  // Past the guard, an empty form is the route's own refusal.
  for (const route of [postVideo, postVoice, postSpeech]) expect((await route(form(null, 'same-origin'))).status).toBe(400);
});

test('another site cannot save, add to or forget a character', async () => {
  const character = { name: 'Nova', type: 'bold', description: 'short silver hair', imageRef: 'generations/x/output.png' };
  // Plain text needs no permission from the browser; JSON from another site names that site.
  await refused(await postCharacter(text(character)));
  await refused(await postCharacter(json(character, 'cross-site')));
  await refused(await postPhoto(text({ imageRef: 'generations/x/output.png', scene: 'a beach' }), params({ id: 'x' })));
  await refused(await postPhoto(json({ imageRef: 'generations/x/output.png', scene: 'a beach' }, 'same-site'), params({ id: 'x' })));
  await refused(await deleteCharacter(bare('DELETE', 'cross-site'), params({ id: 'x' })));
});

test('the Characters page still reaches the routes: JSON from the same origin', async () => {
  expect((await postCharacter(json({}, 'same-origin'))).status).toBe(400);
  expect((await postPhoto(json({ imageRef: 'generations/x/output.png', scene: 'a beach' }, 'same-origin'), params({ id: 'missing' }))).status).toBe(404);
  expect((await deleteCharacter(bare('DELETE', 'same-origin'), params({ id: 'missing' }))).status).toBe(404);
});
