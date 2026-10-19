// The license file published next to ffmpeg.wasm in the showcase (public/ffmpeg/LICENSES.txt).

const MIT = `MIT License

Copyright (c) 2019 Jerome Wu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

/**
 * The npm packages ship no license file. @ffmpeg/ffmpeg is MIT; @ffmpeg/core is
 * FFmpeg and libx264 compiled to WebAssembly, GPL-2.0-or-later: the showcase
 * distributes that binary unmodified, under GPL-3.0 (the "or later" option), with
 * the license text (`gplText`, the GPL-3.0 of comfy-nodes/LICENSE) and the place
 * of its corresponding source.
 */
export function ffmpegLicenses(gplText) {
  return [
    'ffmpeg.wasm, served unmodified from the npm packages below.',
    '',
    '1. @ffmpeg/ffmpeg 0.12.15 (esm/): MIT License, https://github.com/ffmpegwasm/ffmpeg.wasm',
    '',
    MIT,
    '2. @ffmpeg/core 0.12.10 (ffmpeg-core.js, ffmpeg-core.wasm): FFmpeg and libx264 compiled to',
    '   WebAssembly, licensed GPL-2.0-or-later and distributed here under the GNU General Public',
    '   License version 3, whose full text follows.',
    '   Corresponding source: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.10 (build',
    '   scripts and the exact FFmpeg and x264 revisions it compiles); FFmpeg: https://ffmpeg.org;',
    '   x264: https://code.videolan.org/videolan/x264.',
    '',
    gplText.trim(),
    '',
  ].join('\n');
}
