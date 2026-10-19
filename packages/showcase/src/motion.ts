import type { Preset } from '@montagio/presets';
import type { ZoompanExpr } from '@montagio/sequence';

/**
 * The camera move a placeholder clip fakes until the GPU session renders the
 * real one: a window moving over the sample photo. `t` runs from 0 to 1 over
 * the clip; `cx`/`cy` place the window's centre as a fraction of the photo.
 */
export type Keyframe = { t: number; zoom: number; cx: number; cy: number };
type State = Omit<Keyframe, 't'>;
type Camera = Preset['camera'];
type Pose = Camera['poses'][number];

/** Zoom gained per unit of preset speed, and the tightest framing. */
const ZOOM_PER_SPEED = 0.3;
const MAX_ZOOM = 2;
/** A pan needs room around the window: it starts slightly zoomed in. */
const PAN_BASE_ZOOM = 1.25;
/** Share of the free margin a pan crosses per unit of speed. */
const PAN_PER_SPEED = 0.6;
const PANS: Partial<Record<Pose, { dx: number; dy: number }>> = {
  pan_left: { dx: -1, dy: 0 },
  pan_right: { dx: 1, dy: 0 },
  pan_up: { dx: 0, dy: -1 },
  pan_down: { dx: 0, dy: 1 },
};

const round = (value: number) => Math.round(value * 1e6) / 1e6;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Where `poses` (moving together) take the window from `from`. */
function move(from: State, poses: Pose[], speed: number, baseZoom: number): State {
  const factor = 1 + ZOOM_PER_SPEED * speed;
  let zoom = from.zoom;
  if (poses.includes('zoom_in')) zoom = Math.min(zoom * factor, MAX_ZOOM);
  if (poses.includes('zoom_out')) zoom = Math.max(zoom / factor, baseZoom);
  // The window covers 1/zoom of the photo: its centre stays within the free margin
  // at the widest framing of the segment, so it never leaves the photo on the way.
  const halfWindow = 1 / (2 * Math.min(zoom, from.zoom));
  const margin = 0.5 - halfWindow;
  let { cx, cy } = from;
  for (const pose of poses) {
    const pan = PANS[pose];
    if (!pan) continue;
    const step = Math.min(PAN_PER_SPEED * speed * margin, margin);
    cx = clamp(cx + pan.dx * step, halfWindow, 1 - halfWindow);
    cy = clamp(cy + pan.dy * step, halfWindow, 1 - halfWindow);
  }
  return { zoom: round(zoom), cx: round(cx), cy: round(cy) };
}

export function motionKeyframes(camera: Pick<Camera, 'poses' | 'speed' | 'combine'>): Keyframe[] {
  const { poses, speed } = camera;
  const baseZoom = poses.some((pose) => PANS[pose]) ? PAN_BASE_ZOOM : 1;
  const segments = camera.combine === 'then' && poses.length > 1 ? poses.map((pose) => [pose]) : [poses];
  // A clip that opens on a pull-back starts framed as tight as a push would end.
  const opensOnZoomOut = segments[0]!.includes('zoom_out');
  const start: State = {
    zoom: round(opensOnZoomOut ? Math.min(baseZoom * (1 + ZOOM_PER_SPEED * speed), MAX_ZOOM) : baseZoom),
    cx: 0.5,
    cy: 0.5,
  };
  const keyframes: Keyframe[] = [{ t: 0, ...start }];
  let state = start;
  segments.forEach((segment, index) => {
    state = move(state, segment, speed, baseZoom);
    keyframes.push({ t: round((index + 1) / segments.length), ...state });
  });
  return keyframes;
}

const num = (value: number) => String(Math.round(value * 1e4) / 1e4);

/** A piecewise-linear expression of `on` (the output frame) through the keyframes' values. */
function piecewise(keyframes: Keyframe[], value: (keyframe: Keyframe) => number, frames: number): string {
  const at = keyframes.map((keyframe) => Math.round(keyframe.t * (frames - 1)));
  let expr = num(value(keyframes[keyframes.length - 1]!));
  for (let i = keyframes.length - 2; i >= 0; i--) {
    const from = value(keyframes[i]!);
    const span = Math.max(1, at[i + 1]! - at[i]!);
    expr = `if(lt(on,${at[i + 1]}),${num(from)}+(${num(value(keyframes[i + 1]!) - from)})*(on-${at[i]})/${span},${expr})`;
  }
  return expr;
}

/** zoompan expressions that follow the keyframes over `frames` output frames. */
export function toZoompan(keyframes: Keyframe[], frames: number): ZoompanExpr {
  return {
    z: piecewise(keyframes, (k) => k.zoom, frames),
    x: `iw*(${piecewise(keyframes, (k) => k.cx, frames)})-iw/zoom/2`,
    y: `ih*(${piecewise(keyframes, (k) => k.cy, frames)})-ih/zoom/2`,
  };
}
