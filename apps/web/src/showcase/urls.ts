// Every URL of the static showcase is built here, so a GitHub Pages project
// site (served under /<repo>/) only has to set NEXT_PUBLIC_MONTAGIO_BASE_PATH.

/** The path prefix the showcase is served under ('' at the root of a host). */
export const BASE_PATH = process.env.NEXT_PUBLIC_MONTAGIO_BASE_PATH ?? '';

export function urlsFor(base: string) {
  return {
    /** A file of public/showcase (clips, samples, workflows, data.json). */
    showcaseUrl: (rel: string) => `${base}/showcase/${rel}`,
    /** A file of public/ffmpeg (ffmpeg.wasm, served from the showcase's own origin). */
    ffmpegUrl: (file: string) => `${base}/ffmpeg/${file}`,
  };
}

export const { showcaseUrl, ffmpegUrl } = urlsFor(BASE_PATH);
