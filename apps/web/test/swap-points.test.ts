import { maskPoints } from '@/lib/swap-points';

/** An RGBA mask, white inside the rectangles [x0, y0, x1, y1). */
function mask(width: number, height: number, boxes: [number, number, number, number][]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x0, y0, x1, y1] of boxes) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.fill(255, (y * width + x) * 4, (y * width + x) * 4 + 4);
  }
  return data;
}

const inside = (point: { x: number; y: number }, [x0, y0, x1, y1]: number[], width: number, height: number) =>
  point.x * width >= x0! && point.x * width < x1! && point.y * height >= y0! && point.y * height < y1!;

test('nothing painted, no point', () => {
  expect(maskPoints(mask(320, 180, []), 320, 180)).toEqual([]);
  expect(maskPoints(new Uint8ClampedArray(0), 0, 0)).toEqual([]);
});

test('one patch: up to three points, all deep inside it, apart from one another', () => {
  const box = [100, 40, 220, 140];
  const points = maskPoints(mask(320, 180, [box as [number, number, number, number]]), 320, 180);
  expect(points.length).toBeGreaterThanOrEqual(1);
  expect(points.length).toBeLessThanOrEqual(3);
  for (const point of points) {
    expect(inside(point, box, 320, 180)).toBe(true);
    // never on the edge of what was painted
    expect(point.x * 320).toBeGreaterThan(105);
    expect(point.x * 320).toBeLessThan(215);
  }
  // the first one is the deepest: the middle of the box
  expect(points[0]!.x * 320).toBeCloseTo(160, -1);
  expect(points[0]!.y * 180).toBeCloseTo(90, -1);
});

test('two patches (two gloves) each get their points; a speck does not', () => {
  const left = [40, 60, 120, 140];
  const right = [200, 60, 280, 140];
  const points = maskPoints(mask(320, 180, [left, right, [300, 10, 304, 14]] as [number, number, number, number][]), 320, 180);
  expect(points.some((point) => inside(point, left, 320, 180))).toBe(true);
  expect(points.some((point) => inside(point, right, 320, 180))).toBe(true);
  expect(points.every((point) => inside(point, left, 320, 180) || inside(point, right, 320, 180))).toBe(true);
});

test('never more than the 8 points the tracker takes', () => {
  const boxes = Array.from({ length: 6 }, (_, i) => [10 + i * 50, 20, 50 + i * 50, 160] as [number, number, number, number]);
  const points = maskPoints(mask(320, 180, boxes), 320, 180);
  expect(points.length).toBe(8);
  for (const point of points) {
    expect(point.x).toBeGreaterThanOrEqual(0);
    expect(point.x).toBeLessThanOrEqual(1);
  }
});

test('a portrait frame and a thin stroke still give a point on the stroke', () => {
  const stroke = [200, 300, 280, 316];
  const points = maskPoints(mask(480, 832, [stroke as [number, number, number, number]]), 480, 832);
  expect(points.length).toBeGreaterThanOrEqual(1);
  for (const point of points) expect(inside(point, stroke, 480, 832)).toBe(true);
});
