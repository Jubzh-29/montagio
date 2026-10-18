# SPDX-License-Identifier: GPL-3.0-only
"""The camera path of the Montagio Camera Embedding node: one move, two at once, or one then the other.

ComfyUI's WanCameraEmbedding (comfy_extras/nodes_camera_trajectory.py, v0.41.0) moves the camera
along a single pose of its CAMERA_DICT: at frame i of n, the rotation angles and the translation
are (i / n) * speed times the pose's vectors (scaled by base_angle and base_T_norm), and the
rotation is Rz.Ry.Rx. This module builds the same path for two poses:

- "together" adds the two poses' vectors, so both moves happen at once over the whole clip
  (with "Static" as the second pose, the vector is the first pose's own and every product is
  the one get_camera_motion makes, in its order: the path of the core node, bit for bit);
- "then" runs the first move over the first half of the clip and the second over the second
  half, starting where the first one ended.

camera_rows lays the path out as the core does before process_pose_params, which turns it into
the Plücker embedding. Plain numpy: the parts that need torch and ComfyUI are in nodes.py.
"""
import numpy as np

COMBINE_MODES = ("together", "then")


def check_length(length):
    """The core reshapes the embedding by groups of 4 frames after doubling the first one: length must be 4n+1."""
    if length < 1 or (length - 1) % 4 != 0:
        raise ValueError(f"length must be 4n+1 (1, 5, ..., 81), not {length}")


def _rotation(angles):
    """Rz.(Ry.Rx), grouped and multiplied with np.dot as in the core."""
    x, y, z = angles
    rx = np.array([[1, 0, 0], [0, np.cos(x), -np.sin(x)], [0, np.sin(x), np.cos(x)]])
    ry = np.array([[np.cos(y), 0, np.sin(y)], [0, 1, 0], [-np.sin(y), 0, np.cos(y)]])
    rz = np.array([[np.cos(z), -np.sin(z), 0], [np.sin(z), np.cos(z), 0], [0, 0, 1]])
    return np.dot(rz, np.dot(ry, rx))


def _scaled(w, speed, base, v):
    """((w * speed) * base) * v: the scalars from the left, then the vector, as get_camera_motion does."""
    return w * speed * base * v


def _weights(combine, p):
    """How far each move has gone at the fraction p of the clip (0 <= p < 1)."""
    if combine == "together":
        return p, p
    if combine == "then":
        return min(1.0, 2 * p), max(0.0, 2 * p - 1)
    raise ValueError(f'combine "{combine}" is not one of {", ".join(COMBINE_MODES)}')


def trajectory(motion_a, motion_b, combine, speed, length, *, base_angle, base_t):
    """The [R|T] of every frame, an array of shape (length, 3, 4); a motion is (angle[3], T[3])."""
    (angle_a, t_a), (angle_b, t_b) = motion_a, motion_b
    angle_a, t_a, angle_b, t_b = (np.asarray(v, dtype=float) for v in (angle_a, t_a, angle_b, t_b))
    frames = []
    for i in range(length):
        w_a, w_b = _weights(combine, i / length)
        if combine == "together":
            # one move along the sum of the two vectors (w_a == w_b)
            angle = _scaled(w_a, speed, base_angle, angle_a + angle_b)
            t = _scaled(w_a, speed, base_t, t_a + t_b)
        else:
            angle = _scaled(w_a, speed, base_angle, angle_a) + _scaled(w_b, speed, base_angle, angle_b)
            t = _scaled(w_a, speed, base_t, t_a) + _scaled(w_b, speed, base_t, t_b)
        frames.append(np.concatenate([_rotation(angle), t.reshape(3, 1)], axis=1))
    return np.stack(frames)


def camera_rows(rt, fx, fy, cx, cy):
    """The rows process_pose_params reads: [0, fx, fy, cx, cy, 0, 0, the 4x4 camera matrix row by row]."""
    n = len(rt)
    bottom = np.tile([0.0, 0.0, 0.0, 1.0], (n, 1))
    matrices = np.concatenate([np.asarray(rt, dtype=float).reshape(n, 12), bottom], axis=1)
    head = np.tile([0.0, fx, fy, cx, cy, 0.0, 0.0], (n, 1))
    return np.concatenate([head, matrices], axis=1)

