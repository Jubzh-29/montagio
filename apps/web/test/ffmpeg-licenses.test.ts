import { readFileSync } from 'node:fs';
import { ffmpegLicenses } from '../scripts/ffmpeg-licenses.mjs';
import { repoRoot } from './helpers';

test('the copied ffmpeg.wasm files travel with their licenses and the way to their source', () => {
  const gpl = readFileSync(`${repoRoot}comfy-nodes/LICENSE`, 'utf8');
  const text = ffmpegLicenses(gpl);
  // @ffmpeg/ffmpeg (esm/): MIT, with its copyright notice and the permission text.
  expect(text).toContain('Copyright (c) 2019 Jerome Wu');
  expect(text).toContain('Permission is hereby granted, free of charge');
  // @ffmpeg/core (a binary of FFmpeg and x264): GPL-2.0-or-later, distributed under GPL-3.0 with its full text.
  expect(text).toMatch(/GPL-2\.0-or-later/);
  expect(text).toContain('GNU GENERAL PUBLIC LICENSE');
  expect(text).toContain('Version 3, 29 June 2007');
  expect(text).toContain('https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.10');
});
