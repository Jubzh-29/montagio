import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { pickAspect, type Aspect } from '@montagio/presets';
import { imageSize } from 'image-size';
import { getEnv } from './env';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const EXTENSIONS: Record<string, 'png' | 'jpg' | 'webp'> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
const FILE_EXTENSIONS: Record<string, 'png' | 'jpg' | 'webp'> = { '.png': 'png', '.jpg': 'jpg', '.jpeg': 'jpg', '.webp': 'webp' };
const SNIFFED: Record<string, string> = { png: 'png', jpg: 'jpg', webp: 'webp' };

/** Where a photo comes from: what decides whether an effect on it asks for consent. */
export type PhotoOrigin = 'upload' | 'sample' | 't2i' | 'edit' | 'frame';
/** `personal`: the photo is, or derives from, a photo someone imported (it may show a real person). */
export type Provenance = { origin: PhotoOrigin; personal: boolean };

export type UploadMeta = { imageRef: string; width: number; height: number; aspect: Aspect } & Provenance;

export class UploadError extends Error {
  constructor(
    readonly status: 400 | 413 | 415,
    message: string,
  ) {
    super(message);
  }
}

export async function saveUpload(file: File): Promise<UploadMeta> {
  const ext = EXTENSIONS[file.type];
  if (!ext) throw new UploadError(415, 'only PNG, JPEG and WebP images are accepted');
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError(413, 'images are limited to 10 MB');
  return storeImage(new Uint8Array(await file.arrayBuffer()), ext, { origin: 'upload', personal: true });
}

/**
 * Store an image produced on the server as an ordinary upload: the last frame of a shot
 * (the default), the sample photo, or the output of a text-to-image or edit job.
 */
export async function saveUploadFromFile(path: string, provenance: Provenance = { origin: 'frame', personal: false }): Promise<UploadMeta> {
  const ext = FILE_EXTENSIONS[extname(path).toLowerCase()];
  if (!ext) throw new UploadError(415, `unsupported image file ${path}`);
  return storeImage(new Uint8Array(await readFile(path)), ext, provenance);
}

async function storeImage(bytes: Uint8Array, ext: 'png' | 'jpg' | 'webp', provenance: Provenance): Promise<UploadMeta> {
  let width: number | undefined;
  let height: number | undefined;
  let sniffed: string | undefined;
  let orientation: number | undefined;
  try {
    ({ width, height, type: sniffed, orientation } = imageSize(bytes));
  } catch {
    throw new UploadError(415, 'the file is not a readable image');
  }
  if (!width || !height || !sniffed || SNIFFED[sniffed] !== ext) {
    throw new UploadError(415, 'the file content does not match its image type');
  }
  // EXIF orientations 5-8 store the picture rotated by 90°: measure it upright.
  if (orientation !== undefined && orientation >= 5 && orientation <= 8) [width, height] = [height, width];

  const id = randomUUID();
  const dir = join(getEnv().data, 'uploads');
  await mkdir(dir, { recursive: true });
  const meta: UploadMeta = { imageRef: `uploads/${id}.${ext}`, width, height, aspect: pickAspect(width, height), ...provenance };
  await writeFile(join(dir, `${id}.${ext}`), bytes);
  await writeFile(join(dir, `${id}.json`), JSON.stringify(meta));
  return meta;
}

export async function readUploadMeta(imageRef: string): Promise<UploadMeta | null> {
  const match = /^uploads\/([0-9a-f-]{36})\.(png|jpg|webp)$/.exec(imageRef);
  if (!match) return null;
  try {
    const meta = JSON.parse(await readFile(join(getEnv().data, 'uploads', `${match[1]}.json`), 'utf8')) as Partial<UploadMeta>;
    // Written before photos kept their origin: the cautious reading is an imported photo.
    return { origin: 'upload', personal: true, ...meta } as UploadMeta;
  } catch {
    return null;
  }
}
