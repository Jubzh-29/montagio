import { execFile } from 'node:child_process';

export class SequenceToolError extends Error {
  override name = 'SequenceToolError';
}

type Tool = { bin: string; envVar: 'MONTAGIO_FFMPEG' | 'MONTAGIO_FFPROBE' };

const ffmpeg = (): Tool => ({ bin: process.env.MONTAGIO_FFMPEG ?? 'ffmpeg', envVar: 'MONTAGIO_FFMPEG' });
const ffprobe = (): Tool => ({ bin: process.env.MONTAGIO_FFPROBE ?? 'ffprobe', envVar: 'MONTAGIO_FFPROBE' });

/** Run a tool with an argument array (never a shell string) and return its stdout. */
function run(tool: Tool, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(tool.bin, args, { maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return reject(
          new SequenceToolError(`"${tool.bin}" was not found: install FFmpeg or set ${tool.envVar} to its full path`),
        );
      }
      const tail = String(stderr).trim().split('\n').slice(-3).join(' | ');
      reject(new SequenceToolError(`${tool.bin} failed: ${tail || error.message}`));
    });
  });
}

export async function probe(
  media: string,
): Promise<{ width: number; height: number; duration_s: number; fps: number }> {
  const out = await run(ffprobe(), [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate:format=duration',
    '-of', 'json',
    media,
  ]);
  const json = JSON.parse(out) as {
    streams?: { width?: number; height?: number; r_frame_rate?: string }[];
    format?: { duration?: string };
  };
  const stream = json.streams?.[0];
  if (!stream?.width || !stream.height) throw new SequenceToolError(`no video stream in ${media}`);
  const [num, den] = (stream.r_frame_rate ?? '0/1').split('/').map(Number);
  const fps = num && den ? num / den : 0;
  return { width: stream.width, height: stream.height, duration_s: Number(json.format?.duration ?? 0), fps };
}

/** Write the last frame of a clip as a PNG: seek near the end, keep overwriting until the final frame. */
export async function extractLastFrame(video: string, outPng: string): Promise<void> {
  await run(ffmpeg(), ['-loglevel', 'error', '-y', '-sseof', '-1', '-i', video, '-update', '1', '-q:v', '1', outPng]);
}

/** Join clips into one H.264 film; every clip is fitted (letterboxed) to `size` and `fps`. */
export async function concatClips(
  clips: string[],
  out: string,
  size: { width: number; height: number },
  fps: number,
): Promise<void> {
  if (clips.length === 0) throw new SequenceToolError('concatClips needs at least one clip');
  const { width: w, height: h } = size;
  const inputs = clips.flatMap((clip) => ['-i', clip]);
  const fitted = clips
    .map(
      (_, i) =>
        `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[v${i}]`,
    )
    .join(';');
  const joined = `${clips.map((_, i) => `[v${i}]`).join('')}concat=n=${clips.length}:v=1:a=0[out]`;
  await run(ffmpeg(), [
    '-loglevel', 'error', '-y',
    ...inputs,
    '-filter_complex', `${fitted};${joined}`,
    '-map', '[out]',
    '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    out,
  ]);
}

/** 9:16 cut for Reels/TikTok: the full frame centred over a blurred, cropped copy of itself. */
export async function exportVertical(input: string, out: string): Promise<void> {
  const filter = [
    '[0:v]split[bg][fg]',
    '[bg]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,boxblur=20:2[blurred]',
    '[fg]scale=720:-2[front]',
    '[blurred][front]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[out]',
  ].join(';');
  await run(ffmpeg(), [
    '-loglevel', 'error', '-y',
    '-i', input,
    '-filter_complex', filter,
    '-map', '[out]',
    '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    out,
  ]);
}
