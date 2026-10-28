import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { withDataWrite } from './data-purge';
import { getEnv } from './env';
import { REMIX_MAX_S, saveRemixSource, type RemixSound, type RemixSourceMeta } from './remix';

/**
 * Import by link, on this machine only: yt-dlp (Unlicense) fetches a trend from the few platforms
 * listed here, and nothing else. The URL is checked before any process starts, so a link can never
 * make the server read its own network: http(s) only, no user, no port, one of these host names.
 */
export const LINK_HOSTS: Record<string, LinkPlatform> = {
  'tiktok.com': 'tiktok',
  'www.tiktok.com': 'tiktok',
  'm.tiktok.com': 'tiktok',
  'vm.tiktok.com': 'tiktok',
  'vt.tiktok.com': 'tiktok',
  'instagram.com': 'instagram',
  'www.instagram.com': 'instagram',
  'youtube.com': 'youtube',
  'www.youtube.com': 'youtube',
  'm.youtube.com': 'youtube',
  'youtu.be': 'youtube',
};
export type LinkPlatform = 'tiktok' | 'instagram' | 'youtube';
export type LinkRefusal = 'link-invalid' | 'link-host' | 'link-path';

/** The longest link taken. */
const LINK_MAX = 500;
/** The heaviest file yt-dlp may write: the app's limit on a video sent. */
const LINK_MAX_BYTES = '50M';
/** A download that has not ended by then is stopped. */
const LINK_TIMEOUT_MS = 180_000;

/**
 * A TikTok video's own paths, those yt-dlp's TikTok extractors take: /@user/video/<id>, /embed/<id> and
 * a short link (/t/<code>, vm. or vt.<code>). Any other page of the site (its /link/v2 redirect page among
 * them) is not a video, and could send yt-dlp on to an address of the local network.
 */
function tiktokVideoPath(host: string, path: string): boolean {
  if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') return /^\/\w+\/?$/.test(path);
  return /^\/(@[\w.-]+\/video\/\d+|embed\/\d+|t\/\w+)\/?$/.test(path);
}

/**
 * A link checked: an http(s) URL without user nor port on a listed host; on YouTube, a Short
 * (youtube.com/shorts/…, or youtu.be/…); on Instagram, a reel or a post; on TikTok, a video. Returns
 * it without its fragment, or why it is refused.
 */
export function checkImportLink(raw: unknown): { ok: true; url: string; host: string; platform: LinkPlatform } | { ok: false; reason: LinkRefusal } {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > LINK_MAX) return { ok: false, reason: 'link-invalid' };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'link-invalid' };
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.port) return { ok: false, reason: 'link-invalid' };
  const host = url.hostname.toLowerCase();
  const platform = LINK_HOSTS[host];
  // Anything else, an IP address and "localhost" among them, is refused by name.
  if (!platform) return { ok: false, reason: 'link-host' };
  const path = url.pathname;
  if (platform === 'youtube' && host !== 'youtu.be' && !/^\/shorts\/[\w-]+\/?$/.test(path)) return { ok: false, reason: 'link-path' };
  if (host === 'youtu.be' && !/^\/[\w-]+\/?$/.test(path)) return { ok: false, reason: 'link-path' };
  if (platform === 'instagram' && !/^\/(reel|reels|p|tv)\/[\w-]+\/?$/.test(path)) return { ok: false, reason: 'link-path' };
  if (platform === 'tiktok' && !tiktokVideoPath(host, path)) return { ok: false, reason: 'link-path' };
  url.hash = '';
  // The same pages on www., the only host the TikTok extractor of a video takes.
  if (host === 'tiktok.com' || host === 'm.tiktok.com') url.hostname = 'www.tiktok.com';
  return { ok: true, url: url.href, host: url.hostname, platform };
}

/** What yt-dlp's info file says that the remix keeps: the length, the sound. */
export type LinkInfo = { duration?: number; track?: string; artist?: string; artists?: string[] };

/** Where to search for a trend's sound on its own platform. */
export function soundSearchUrl(platform: LinkPlatform, query: string): string {
  const q = encodeURIComponent(query);
  if (platform === 'tiktok') return `https://www.tiktok.com/search?q=${q}`;
  if (platform === 'instagram') return `https://www.instagram.com/explore/search/keyword/?q=${q}`;
  return `https://www.youtube.com/results?search_query=${q}`;
}

/** The sound of a trend from yt-dlp's info, when its platform names it: its title, its artists, a search for it. */
export function soundOf(info: LinkInfo, platform: LinkPlatform): RemixSound | undefined {
  const title = typeof info.track === 'string' ? info.track.trim().slice(0, 200) : '';
  if (!title) return undefined;
  const artists = (Array.isArray(info.artists) ? info.artists : typeof info.artist === 'string' ? info.artist.split(/, | & /) : [])
    .filter((artist): artist is string => typeof artist === 'string' && artist.trim().length > 0)
    .map((artist) => artist.trim().slice(0, 100))
    .slice(0, 5);
  return { title, artists, searchUrl: soundSearchUrl(platform, [title, ...artists].join(' ')) };
}

/** The yt-dlp this app runs: the one the installer pinned (MONTAGIO_YTDLP), else the one on the PATH. */
export function ytDlpBin(): string {
  return process.env.MONTAGIO_YTDLP?.trim() || 'yt-dlp';
}

export type YtDlpRun = (bin: string, args: string[], timeoutMs: number) => Promise<string>;

/** Runs yt-dlp with an argument array (never a shell), stopped after `timeoutMs`. */
export const runYtDlp: YtDlpRun = (bin, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (!error) return resolve(String(stdout));
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return reject(new LinkImportError('link-import-unavailable'));
      const tail = String(stderr).trim().split('\n').slice(-2).join(' | ');
      reject(new LinkImportError(/does not pass filter|duration/i.test(tail) ? 'link-too-long' : 'link-import-failed', tail));
    });
  });

export type LinkImportCode = LinkRefusal | 'link-import-unavailable' | 'link-import-failed' | 'link-too-long' | 'link-busy';

export class LinkImportError extends Error {
  override name = 'LinkImportError';
  constructor(
    readonly code: LinkImportCode,
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

/** The HTTP status of each refusal of an import. */
export const LINK_IMPORT_STATUS: Record<LinkImportCode, number> = {
  'link-invalid': 400,
  'link-host': 400,
  'link-path': 400,
  'link-too-long': 400,
  'link-busy': 429,
  'link-import-failed': 502,
  'link-import-unavailable': 503,
};

/**
 * Whether this app imports links: on a machine of its own only. The demo backend (the public demo, the
 * showcase's sibling) has neither the route nor the field.
 */
export const linkImportOffered = () => (process.env.MONTAGIO_BACKEND ?? 'demo') !== 'demo';

/** Whether yt-dlp answers here, and its version: the page shows the link field only then. */
export async function ytDlpVersion(run: YtDlpRun = runYtDlp): Promise<string | null> {
  try {
    return (await run(ytDlpBin(), ['--version'], 15_000)).trim().split('\n')[0] || null;
  } catch {
    return null;
  }
}

/**
 * Fetch a checked link into `dir` with yt-dlp: its own configuration and its generic extractor left out, one video, 60 s and
 * 50 MB at most, in MP4 when the platform has it; FFmpeg (MONTAGIO_FFMPEG when set) merges the
 * streams. Returns the video file and what its info says.
 */
export async function downloadLink(url: string, dir: string, run: YtDlpRun = runYtDlp): Promise<{ file: string; info: LinkInfo }> {
  const ffmpeg = process.env.MONTAGIO_FFMPEG?.trim();
  await run(
    ytDlpBin(),
    [
      '--ignore-config', '--no-playlist', '--no-progress', '--no-warnings', '--no-mtime',
      // The platforms' own extractors only: the generic one reads whatever page a link leads to, and follows it.
      '--use-extractors', 'default,-generic',
      '--max-filesize', LINK_MAX_BYTES,
      '--match-filters', `duration <= ${REMIX_MAX_S}`,
      '-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b',
      '--merge-output-format', 'mp4',
      '--write-info-json', '--no-write-comments',
      '--socket-timeout', '20', '--retries', '2',
      ...(ffmpeg ? ['--ffmpeg-location', ffmpeg] : []),
      '-o', join(dir, 'source.%(ext)s'),
      '--', url,
    ],
    LINK_TIMEOUT_MS,
  );
  const names = await readdir(dir);
  const video = names.find((name) => /^source\.(mp4|webm|mov|mkv)$/.test(name));
  // yt-dlp skips a video its filter refuses without failing: nothing written means too long.
  if (!video) throw new LinkImportError('link-too-long');
  const infoName = names.find((name) => name === 'source.info.json');
  const info = infoName ? (JSON.parse(await readFile(join(dir, infoName), 'utf8')) as LinkInfo) : {};
  if (typeof info.duration === 'number' && info.duration > REMIX_MAX_S + 1) throw new LinkImportError('link-too-long');
  return { file: join(dir, video), info };
}

// One import at a time on this machine, whoever asks: a second waits for the first to end.
const holder = globalThis as typeof globalThis & { __montagioLinkImport?: { busy: boolean } };
const importing = (holder.__montagioLinkImport ??= { busy: false });

export const linkImportBusy = (): boolean => importing.busy;

/**
 * A trend imported from a link: checked, fetched by yt-dlp into a folder of its own, prepared as a file
 * sent is, with the link and the sound its platform names kept beside it (shown to the user, never put
 * in a recipe). The folder is removed whatever happens.
 */
export async function importLink(raw: unknown, run: YtDlpRun = runYtDlp): Promise<RemixSourceMeta> {
  return withDataWrite(async () => {
    const checked = checkImportLink(raw);
    if (!checked.ok) throw new LinkImportError(checked.reason);
    if (importing.busy) throw new LinkImportError('link-busy');
    importing.busy = true;
    let dir: string | undefined;
    try {
      // A fresh install has no data folder yet.
      await mkdir(getEnv().data, { recursive: true });
      dir = await mkdtemp(join(getEnv().data, 'remix-link-'));
      const { file, info } = await downloadLink(checked.url, dir, run);
      const sound = soundOf(info, checked.platform);
      return await saveRemixSource(file, 'link', { link: { url: checked.url, host: checked.host }, ...(sound ? { sound } : {}) });
    } finally {
      importing.busy = false;
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });
}
