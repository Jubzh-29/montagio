import { glyphMotion, GLYPH_EXTENT, FRAME_HALF } from '@/lib/move-glyph';

/** The camera moves of the library presets (presets/*.yaml). */
const LIBRARY: [string, string[], number][] = [
  ['breathing', ['zoom_in', 'zoom_out'], 0.2],
  ['crash-push', ['zoom_in'], 1.5],
  ['drift-left-push', ['pan_left', 'zoom_in'], 0.8],
  ['pan-left', ['pan_left'], 1],
  ['pan-right', ['pan_right'], 1],
  ['pull-back-reveal', ['zoom_out'], 1],
  ['pull-back-tilt-up', ['zoom_out', 'pan_up'], 1],
  ['push-and-settle', ['zoom_in', 'static'], 0.7],
  ['rise-and-push', ['pan_up', 'zoom_in'], 1],
  ['slow-push', ['zoom_in'], 0.6],
  ['tilt-down', ['pan_down'], 0.8],
  ['tilt-up', ['pan_up'], 0.8],
];

const centerX = (m: ReturnType<typeof glyphMotion>) => m.target.left + m.target.width / 2;
const centerY = (m: ReturnType<typeof glyphMotion>) => m.target.top + m.target.height / 2;

test('a pan left drifts the scene right, and the target frame waits on the left', () => {
  const motion = glyphMotion(['pan_left'], 1);
  expect(motion.end.tx).toBeGreaterThan(0);
  expect(motion.end.scale).toBe(1);
  expect(centerX(motion)).toBeLessThan(50);
  expect(centerY(motion)).toBeCloseTo(50);
});

test('a tilt up drifts the scene down, and the target frame waits above', () => {
  const motion = glyphMotion(['pan_up'], 1);
  expect(motion.end.ty).toBeGreaterThan(0);
  expect(centerY(motion)).toBeLessThan(50);
});

test('a push in shows a smaller target frame at the centre, a pull back a larger one', () => {
  const push = glyphMotion(['zoom_in'], 1);
  const pull = glyphMotion(['zoom_out'], 1);
  expect(push.target.width).toBeLessThan(pull.target.width);
  expect(centerX(push)).toBeCloseTo(50);
  expect(centerX(pull)).toBeCloseTo(50);
});

test.each(LIBRARY)('%s: at the end of the move the target frame lands on the viewfinder frame', (_, poses, speed) => {
  const { end, target } = glyphMotion(poses, speed);
  // Scene point q (relative to the centre, in scene units) is drawn at scale * q + t.
  const toScreen = (percent: number, t: number) => end.scale * (percent / 100 - 0.5) + t;
  expect(toScreen(target.left, end.tx)).toBeCloseTo(-FRAME_HALF);
  expect(toScreen(target.left + target.width, end.tx)).toBeCloseTo(FRAME_HALF);
  expect(toScreen(target.top, end.ty)).toBeCloseTo(-FRAME_HALF);
  expect(toScreen(target.top + target.height, end.ty)).toBeCloseTo(FRAME_HALF);
});

test.each(LIBRARY)('%s: before the move starts, the target frame is centred inside the frame marks', (_, poses, speed) => {
  const motion = glyphMotion(poses, speed);
  const frame = { from: 50 - FRAME_HALF * 100, to: 50 + FRAME_HALF * 100 };
  expect(centerX(motion)).toBeGreaterThan(frame.from);
  expect(centerX(motion)).toBeLessThan(frame.to);
  expect(centerY(motion)).toBeGreaterThan(frame.from);
  expect(centerY(motion)).toBeLessThan(frame.to);
});

// A pull back combined with a tilt ends on a frame larger than the glyph: its far edge is cut, as in a storyboard.
test.each(LIBRARY.filter(([, poses]) => poses.length === 1))('%s: a single move shows its whole target frame', (_, poses, speed) => {
  const { target } = glyphMotion(poses, speed);
  expect(target.left).toBeGreaterThanOrEqual(GLYPH_EXTENT.from);
  expect(target.top).toBeGreaterThanOrEqual(GLYPH_EXTENT.from);
  expect(target.left + target.width).toBeLessThanOrEqual(GLYPH_EXTENT.to);
  expect(target.top + target.height).toBeLessThanOrEqual(GLYPH_EXTENT.to);
});

test('moves that only make sense one after the other are drawn one after the other', () => {
  const breathing = glyphMotion(['zoom_in', 'zoom_out'], 0.2);
  expect(breathing.mid?.scale).toBeGreaterThan(1);
  expect(breathing.end.scale).toBeLessThan(breathing.mid!.scale);

  const settle = glyphMotion(['zoom_in', 'static'], 0.7);
  expect(settle.mid).toEqual(settle.end);
  expect(settle.end.scale).toBeGreaterThan(1);
});

test('moves that combine run together', () => {
  const drift = glyphMotion(['pan_left', 'zoom_in'], 0.8);
  expect(drift.mid).toBeUndefined();
  expect(drift.end.tx).toBeGreaterThan(0);
  expect(drift.end.scale).toBeGreaterThan(1);
});

test('the speed sets the duration, within a range that stays readable', () => {
  expect(glyphMotion(['zoom_in'], 1).durationS).toBeCloseTo(2.6);
  expect(glyphMotion(['zoom_in'], 1.5).durationS).toBeLessThan(2.6);
  expect(glyphMotion(['zoom_in'], 0.2).durationS).toBe(6);
  expect(glyphMotion(['zoom_in'], 10).durationS).toBe(1.6);
});

test('an unknown pose is a static shot', () => {
  expect(glyphMotion(['orbit'], 1).end).toEqual({ tx: 0, ty: 0, scale: 1 });
});
