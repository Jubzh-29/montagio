import { motionKeyframes, toZoompan } from '../src/motion';
import { workflowSha256 } from '../src/workflow';

test('Crash Push zooms from 1 to 1.45', () => {
  expect(motionKeyframes({ poses: ['zoom_in'], speed: 1.5, combine: 'together' })).toEqual([
    { t: 0, zoom: 1, cx: 0.5, cy: 0.5 },
    { t: 1, zoom: 1.45, cx: 0.5, cy: 0.5 },
  ]);
});

test('Pan Left moves the centre left within the margin', () => {
  const [start, end] = motionKeyframes({ poses: ['pan_left'], speed: 1, combine: 'together' });
  expect(start).toEqual({ t: 0, zoom: 1.25, cx: 0.5, cy: 0.5 });
  expect(end!.t).toBe(1);
  expect(end!.zoom).toBe(1.25);
  expect(end!.cy).toBe(0.5);
  expect(end!.cx).toBeLessThan(0.5);
  // The window (1/zoom of the image) stays inside the image.
  expect(end!.cx).toBeGreaterThanOrEqual(1 / (2 * end!.zoom));
  expect(end!.cx).toBeCloseTo(0.44, 5);
});

test('a fast pan stops at the edge of the image', () => {
  const [, end] = motionKeyframes({ poses: ['pan_right'], speed: 3, combine: 'together' });
  expect(end!.cx).toBeCloseTo(1 - 1 / (2 * end!.zoom), 5);
});

test('then splits the clip in two halves', () => {
  // Push & Settle: push in, then hold.
  expect(motionKeyframes({ poses: ['zoom_in', 'static'], speed: 0.7, combine: 'then' })).toEqual([
    { t: 0, zoom: 1, cx: 0.5, cy: 0.5 },
    { t: 0.5, zoom: 1.21, cx: 0.5, cy: 0.5 },
    { t: 1, zoom: 1.21, cx: 0.5, cy: 0.5 },
  ]);
});

test('together moves both at once', () => {
  // Rise & Push: up and in over the whole clip.
  const frames = motionKeyframes({ poses: ['pan_up', 'zoom_in'], speed: 1, combine: 'together' });
  expect(frames).toHaveLength(2);
  expect(frames[1]!.zoom).toBeCloseTo(1.25 * 1.3, 5);
  expect(frames[1]!.cy).toBeLessThan(0.5);
  expect(frames[1]!.cx).toBe(0.5);
});

test('Breathing zooms in, then back out to where it started', () => {
  const frames = motionKeyframes({ poses: ['zoom_in', 'zoom_out'], speed: 0.2, combine: 'then' });
  expect(frames.map((frame) => frame.t)).toEqual([0, 0.5, 1]);
  expect(frames[1]!.zoom).toBeCloseTo(1.06, 5);
  expect(frames[2]!.zoom).toBeCloseTo(1, 5);
});

test('a still or rolling camera does not move', () => {
  for (const pose of ['static', 'roll_ccw', 'roll_cw'] as const) {
    const frames = motionKeyframes({ poses: [pose], speed: 2, combine: 'together' });
    expect(frames.every((frame) => frame.zoom === 1 && frame.cx === 0.5 && frame.cy === 0.5)).toBe(true);
  }
});

test('toZoompan gives piecewise expressions in on', () => {
  const expr = toZoompan(
    [
      { t: 0, zoom: 1, cx: 0.5, cy: 0.5 },
      { t: 0.5, zoom: 1.21, cx: 0.5, cy: 0.5 },
      { t: 1, zoom: 1.21, cx: 0.4, cy: 0.5 },
    ],
    81,
  );
  // 81 frames: keyframes on frames 0, 40 and 80.
  expect(expr.z).toBe('if(lt(on,40),1+(0.21)*(on-0)/40,if(lt(on,80),1.21+(0)*(on-40)/40,1.21))');
  expect(expr.x).toBe('iw*(if(lt(on,40),0.5+(0)*(on-0)/40,if(lt(on,80),0.5+(-0.1)*(on-40)/40,0.4)))-iw/zoom/2');
  expect(expr.y).toContain('ih*(');
  expect(expr.y).toContain('-ih/zoom/2');
});

test('workflowSha256 is stable across key order', () => {
  const a = { '3': { class_type: 'KSampler', inputs: { seed: 1, steps: 20 } } };
  const b = { '3': { inputs: { steps: 20, seed: 1 }, class_type: 'KSampler' } };
  expect(workflowSha256(a)).toBe(workflowSha256(b));
  expect(workflowSha256(a)).toMatch(/^[0-9a-f]{64}$/);
  expect(workflowSha256({ '3': { class_type: 'KSampler', inputs: { seed: 2, steps: 20 } } })).not.toBe(workflowSha256(a));
});
