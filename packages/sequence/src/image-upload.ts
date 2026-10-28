import { execFile } from 'node:child_process';
import { rename, rm, stat } from 'node:fs/promises';
import { SequenceToolError } from './ffmpeg';

export const MAX_IMAGE_PIXELS = 40_000_000;
export const MAX_NORMALIZED_IMAGE_BYTES = 25 * 1024 * 1024;

const IMAGE_INPUT = ['-protocol_whitelist', 'file', '-format_whitelist', 'image2,png_pipe,jpeg_pipe,webp_pipe', '-codec_whitelist', 'png,mjpeg,webp'];

function run(tool: 'ffmpeg' | 'ffprobe', args: string[]): Promise<string> {
  const envVar = tool === 'ffmpeg' ? 'MONTAGIO_FFMPEG' : 'MONTAGIO_FFPROBE';
  const bin = process.env[envVar] ?? tool;
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return reject(new SequenceToolError(`"${bin}" was not found: install FFmpeg or set ${envVar} to its full path`, 'tool-missing'));
      }
      const tail = String(stderr).trim().split('\n').slice(-3).join(' | ');
      reject(new SequenceToolError(`${bin} failed: ${tail || error.message}`));
    });
  });
}

async function dimensions(input: string): Promise<{ width: number; height: number }> {
  const out = await run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', ...IMAGE_INPUT, input,
  ]);
  const stream = (JSON.parse(out) as { streams?: { width?: number; height?: number }[] }).streams?.[0];
  if (!stream?.width || !stream.height) throw new SequenceToolError(`no image stream in ${input}`);
  return { width: stream.width, height: stream.height };
}

/** Keep only upright pixels of an uploaded image, in a bounded PNG without its source metadata. */
export async function normalizeUploadedImage(input: string, output: string): Promise<void> {
  const { width, height } = await dimensions(input);
  if (width * height > MAX_IMAGE_PIXELS) throw new SequenceToolError(`images are limited to ${MAX_IMAGE_PIXELS.toLocaleString('en-US')} pixels`);
  const tmp = `${output}.tmp`;
  try {
    await run('ffmpeg', [
      '-loglevel', 'error', '-y', ...IMAGE_INPUT, '-autorotate', '-i', input,
      '-map', '0:v:0', '-frames:v', '1', '-map_metadata', '-1', '-f', 'image2', '-c:v', 'png', tmp,
    ]);
    if ((await stat(tmp)).size > MAX_NORMALIZED_IMAGE_BYTES) throw new SequenceToolError('normalized images are limited to 25 MiB');
    await rename(tmp, output);
  } finally {
    await rm(tmp, { force: true });
  }
}
