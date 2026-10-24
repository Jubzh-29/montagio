/** A point of the first frame, in fractions of its width and height (0 to 1, from the top left). */
export type FramePoint = { x: number; y: number };

/** The tracker takes 8 points at most; 3 per painted patch are enough to say which object it is. */
const MAX_POINTS = 8;
const PER_PATCH = 3;
/** The mask is read on a grid this many cells wide: a stroke is several cells thick. */
const GRID = 64;

/**
 * Where to tell the tracker the object is, from what was painted over the first frame (RGBA pixels,
 * white where painted, as MaskPainter exports it): in each painted patch, the points deepest inside
 * it, apart from one another, so that a stroke that spills over the background marks the object
 * and not its edge. Two patches (two gloves) each get their points; specks are left out.
 */
export function maskPoints(rgba: Uint8ClampedArray, width: number, height: number): FramePoint[] {
  if (width <= 0 || height <= 0) return [];
  const cell = Math.max(1, Math.ceil(width / GRID));
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  // A cell is painted when most of its pixels are.
  const painted = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let on = 0;
      let all = 0;
      for (let y = row * cell; y < Math.min(height, (row + 1) * cell); y++) {
        for (let x = col * cell; x < Math.min(width, (col + 1) * cell); x++) {
          all++;
          if (rgba[(y * width + x) * 4]! > 127) on++;
        }
      }
      painted[row * cols + col] = on * 2 > all ? 1 : 0;
    }
  }
  // Distance of each painted cell to the nearest unpainted one (or the frame's edge), city-block.
  const depth = new Int32Array(cols * rows);
  const far = cols + rows;
  for (let i = 0; i < depth.length; i++) depth[i] = painted[i] ? far : 0;
  const at = (col: number, row: number) => (col < 0 || row < 0 || col >= cols || row >= rows ? 0 : depth[row * cols + col]!);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      if (depth[i]) depth[i] = Math.min(depth[i]!, at(col - 1, row) + 1, at(col, row - 1) + 1);
    }
  }
  for (let row = rows - 1; row >= 0; row--) {
    for (let col = cols - 1; col >= 0; col--) {
      const i = row * cols + col;
      if (depth[i]) depth[i] = Math.min(depth[i]!, at(col + 1, row) + 1, at(col, row + 1) + 1);
    }
  }
  // The painted patches (4-connected), largest first.
  const patch = new Int32Array(cols * rows).fill(-1);
  const patches: number[][] = [];
  for (let start = 0; start < painted.length; start++) {
    if (!painted[start] || patch[start] !== -1) continue;
    const cells: number[] = [];
    const stack = [start];
    patch[start] = patches.length;
    while (stack.length > 0) {
      const i = stack.pop()!;
      cells.push(i);
      const col = i % cols;
      const row = (i - col) / cols;
      for (const [c, r] of [[col - 1, row], [col + 1, row], [col, row - 1], [col, row + 1]] as const) {
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const j = r * cols + c;
        if (painted[j] && patch[j] === -1) {
          patch[j] = patches.length;
          stack.push(j);
        }
      }
    }
    patches.push(cells);
  }
  patches.sort((a, b) => b.length - a.length);
  const largest = patches[0]?.length ?? 0;
  const points: FramePoint[] = [];
  for (const cells of patches) {
    // a speck next to a real patch is a slip of the brush
    if (cells.length < Math.max(2, largest * 0.02)) continue;
    const deepest = Math.max(...cells.map((i) => depth[i]!));
    const spacing = Math.max(2, deepest);
    // Of the cells as deep, the one nearest the patch's middle first.
    const middleCol = cells.reduce((sum, i) => sum + (i % cols), 0) / cells.length;
    const middleRow = cells.reduce((sum, i) => sum + Math.floor(i / cols), 0) / cells.length;
    const offMiddle = (i: number) => ((i % cols) - middleCol) ** 2 + (Math.floor(i / cols) - middleRow) ** 2;
    const chosen: [number, number][] = [];
    for (const i of [...cells].sort((a, b) => depth[b]! - depth[a]! || offMiddle(a) - offMiddle(b))) {
      if (chosen.length === PER_PATCH || points.length + chosen.length === MAX_POINTS) break;
      if (depth[i]! < Math.max(1, deepest / 2)) break;
      const col = i % cols;
      const row = (i - col) / cols;
      if (chosen.every(([c, r]) => Math.abs(c - col) + Math.abs(r - row) >= spacing)) chosen.push([col, row]);
    }
    for (const [col, row] of chosen) {
      points.push({ x: Math.min(1, ((col + 0.5) * cell) / width), y: Math.min(1, ((row + 0.5) * cell) / height) });
    }
    if (points.length === MAX_POINTS) break;
  }
  return points;
}
