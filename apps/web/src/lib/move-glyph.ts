/**
 * The viewfinder glyph of a camera move: a scene (grid, horizon, subject) drifts
 * behind fixed frame marks the way the camera moves, and a target frame drawn in
 * the scene shows where the shot ends. At the end of the move the target lands
 * exactly on the frame marks; paused, the glyph is a storyboard: the frame where
 * the shot starts, the target where it ends.
 *
 * Units: the scene overflows the glyph by 20% per side, so it is 1.4 glyphs wide.
 * Translations are fractions of the scene (CSS translate(%) on the scene itself),
 * target positions are percentages of the scene.
 */

/** The frame marks sit 14% inside the glyph: their half-size, in scene units. */
export const FRAME_HALF = (0.5 - 0.14) / 1.4;
/** Where the glyph lies inside the scene, in percent of the scene. */
export const GLYPH_EXTENT = { from: (0.2 / 1.4) * 100, to: (1.2 / 1.4) * 100 };

export type Pose = { tx: number; ty: number; scale: number };

const PAN = 0.09;
const POSES: Record<string, Pose> = {
  static: { tx: 0, ty: 0, scale: 1 },
  pan_left: { tx: PAN, ty: 0, scale: 1 },
  pan_right: { tx: -PAN, ty: 0, scale: 1 },
  pan_up: { tx: 0, ty: PAN, scale: 1 },
  pan_down: { tx: 0, ty: -PAN, scale: 1 },
  zoom_in: { tx: 0, ty: 0, scale: 1.55 },
  zoom_out: { tx: 0, ty: 0, scale: 0.75 },
};

const IDENTITY: Pose = { tx: 0, ty: 0, scale: 1 };
const compose = (a: Pose, b: Pose): Pose => ({ tx: a.tx + b.tx, ty: a.ty + b.ty, scale: a.scale * b.scale });

/**
 * Two moves run one after the other when together they would cancel out or
 * stand still (push in then out, push then hold). The summary the gallery
 * receives has no `combine` field; for the library presets this rule matches
 * their `combine: then` exactly.
 */
function chained(poses: string[]): boolean {
  if (poses.length < 2) return false;
  const has = (pose: string) => poses.includes(pose);
  return has('static') || (has('zoom_in') && has('zoom_out')) || (has('pan_left') && has('pan_right')) || (has('pan_up') && has('pan_down'));
}

export type GlyphMotion = {
  /** Where the camera stands between two chained moves; absent when the moves run together. */
  mid?: Pose;
  end: Pose;
  durationS: number;
  /** The target frame, in percent of the scene: where the shot ends. */
  target: { left: number; top: number; width: number; height: number };
};

export function glyphMotion(poses: string[], speed: number): GlyphMotion {
  const steps = poses.map((pose) => POSES[pose] ?? IDENTITY);
  const end = steps.reduce(compose, IDENTITY);
  const mid = chained(poses) ? steps[0] : undefined;
  // A point q of the scene (from its centre) is drawn at scale * q + t: the target
  // is the frame mapped back through the end pose.
  const half = FRAME_HALF / end.scale;
  const cx = 0.5 - end.tx / end.scale;
  const cy = 0.5 - end.ty / end.scale;
  return {
    mid,
    end,
    durationS: Math.min(6, Math.max(1.6, 2.6 / Math.max(speed, 0.01))),
    target: { left: (cx - half) * 100, top: (cy - half) * 100, width: half * 200, height: half * 200 },
  };
}
