# SPDX-License-Identifier: GPL-3.0-only
"""Smoke test of the Montagio nodes against a running ComfyUI (v0.41.0 or later).

It checks that the pack is loaded, then runs a prompt in which the outputs of MontagioPresetFromYAML
feed the core WanCameraEmbedding node: camera_pose is a COMBO output linked into a COMBO input, and
the nine pose strings must be exactly ComfyUI's, otherwise WanCameraEmbedding raises a KeyError.
A second branch does the same in camera_mode "combined" with a preset of two moves, whose
camera_pose_2 and combine outputs feed Montagio Camera Embedding. Both camera nodes only build a
tensor, so no GPU and no model file are needed.

    python comfy-nodes/scripts/smoke_comfyui.py [URL]      # URL defaults to http://127.0.0.1:8199

The pack must be installed in ComfyUI's custom_nodes folder (custom_nodes/montagio for a local install,
custom_nodes/montagio on the GPU pods of infra/) and ComfyUI must be running. Exit code 0 when the
run succeeds, 1 otherwise, with ComfyUI's own error shown.
Standard library only, so it runs anywhere Python does, a pod included.
"""
import json
import sys
import time
import urllib.error
import urllib.request

DEFAULT_URL = "http://127.0.0.1:8199"
TIMEOUT_S = 120.0  # how long to wait for the run to end
POLL_INTERVAL_S = 0.5
REQUEST_TIMEOUT_S = 30.0

# crash-push, 2 seconds long (33 frames at 16 fps) so that the run is short
YAML = """\
schema: montagio/preset@0.1
id: crash-push
name: Crash Push
description: Fast push toward the subject, ending tight.
preview: previews/crash-push.mp4
license: CC-BY-4.0
author: montagio-community
capability: i2v-camera
camera:
  poses: [zoom_in]
  speed: 1.5
prompt:
  suffix: "dynamic camera push-in, cinematic, sharp focus on subject"
  negative: "blurry, distorted, warped faces, extra limbs, flicker, low quality"
defaults:
  duration_s: 2
  resolution: 480p
  fps: 16
models:
  preferred: wan22-i2v-a14b-fun-camera
  fallback: wan22-ti2v-5b
"""

# breathing (zoom in, then zoom out), at speed 1.0 and 2 seconds long: two moves, one after the other
YAML_TWO_MOVES = """\
schema: montagio/preset@0.1
id: breathing
name: Breathing
description: A barely visible push in and out that keeps a still shot alive.
preview: previews/breathing.mp4
license: CC-BY-4.0
author: montagio-community
capability: i2v-camera
camera:
  poses: [zoom_in, zoom_out]
  combine: then
  speed: 1.0
prompt:
  suffix: "barely perceptible breathing camera, gentle micro push in and out, calm and steady"
  negative: "blurry, distorted, warped faces, extra limbs, flicker, low quality"
defaults:
  duration_s: 2
  resolution: 480p
  fps: 16
models:
  preferred: wan22-i2v-a14b-fun-camera
  fallback: wan22-ti2v-5b
"""


def build_prompt():
    """The prompt, in ComfyUI's API format ({node id: {"class_type", "inputs"}}); a new dict each call.

    Node "2" is the one under test: its outputs 0 to 4 (camera_pose, speed, width, height, length)
    go to WanCameraEmbedding ("3"). Node "6" is the same node in combined mode: those outputs and
    camera_pose_2 and combine (11 and 12) go to Montagio Camera Embedding ("7"). The PreviewAny
    nodes are the outputs ComfyUI needs to run something: "4" shows the info of the preset-file
    node ("1", output 10), "5" and "8" the length that each camera node sends back (its output 3).
    PreviewAny takes a single input, called source.
    """
    common = {"aspect": "16:9", "resolution": "preset", "camera_mode": "parametric"}
    return {
        "1": {"class_type": "MontagioLoadPreset", "inputs": {"preset": "crash-push.yaml", **common}},
        "2": {"class_type": "MontagioPresetFromYAML", "inputs": {"yaml": YAML, **common}},
        "3": {
            "class_type": "WanCameraEmbedding",
            "inputs": {
                "camera_pose": ["2", 0],
                "speed": ["2", 1],
                "width": ["2", 2],
                "height": ["2", 3],
                "length": ["2", 4],
            },
        },
        "4": {"class_type": "PreviewAny", "inputs": {"source": ["1", 10]}},
        "5": {"class_type": "PreviewAny", "inputs": {"source": ["3", 3]}},
        "6": {"class_type": "MontagioPresetFromYAML", "inputs": {"yaml": YAML_TWO_MOVES, **common, "camera_mode": "combined"}},
        "7": {
            "class_type": "MontagioCameraEmbedding",
            "inputs": {
                "camera_pose": ["6", 0],
                "camera_pose_2": ["6", 11],
                "combine": ["6", 12],
                "speed": ["6", 1],
                "width": ["6", 2],
                "height": ["6", 3],
                "length": ["6", 4],
            },
        },
        "8": {"class_type": "PreviewAny", "inputs": {"source": ["7", 3]}},
    }


def _request(method, url, body=None):
    """(HTTP status, parsed JSON) of a call. Raises an OSError (URLError, timeout) when nothing answers."""
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {} if data is None else {"Content-Type": "application/json"}
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_S) as response:
            status, raw = response.status, response.read()
    except urllib.error.HTTPError as error:  # ComfyUI explains a refusal in the body
        status, raw = error.code, error.read()
    try:
        return status, json.loads(raw.decode("utf-8"))
    except ValueError:
        return status, {"unreadable_body": raw.decode("utf-8", errors="replace")}


def _show_run_error(entry):
    """Print what ComfyUI says went wrong in a history entry."""
    status = entry.get("status", {})
    errors = [data for kind, data in status.get("messages", []) if kind == "execution_error"]
    for error in errors:
        print(f"node {error.get('node_id')} ({error.get('node_type')}) failed: "
              f"{error.get('exception_type')}: {error.get('exception_message')}")
        for line in error.get("traceback", []):
            print("   ", line.rstrip())
    if not errors:
        print("the run did not succeed, status:", json.dumps(status))


def _show_outputs(entry):
    """Print the texts the PreviewAny nodes displayed."""
    for node_id, output in sorted(entry.get("outputs", {}).items()):
        for key, values in output.items():
            for value in values if isinstance(values, list) else [values]:
                print(f"node {node_id} shows {key}:", value)


def main(url=DEFAULT_URL, *, timeout=TIMEOUT_S, poll_interval=POLL_INTERVAL_S):
    """Run the smoke test against the ComfyUI at `url`. Returns 0 when it succeeds, 1 otherwise."""
    url = url.rstrip("/")
    prompt = build_prompt()
    try:
        # 1. the pack is loaded, and so are the core nodes the prompt uses (ComfyUI answers {} for an unknown node)
        for class_type in dict.fromkeys(node["class_type"] for node in prompt.values()):
            _, info = _request("GET", f"{url}/object_info/{class_type}")
            if class_type not in info:
                hint = "is the pack in ComfyUI's custom_nodes folder (custom_nodes/montagio)? see ComfyUI's log" if class_type.startswith("Montagio") else "does this ComfyUI have it?"
                print(f"{class_type} is not in {url}/object_info ({hint})")
                return 1
            print(f"{class_type}: in /object_info")

        # 2. send the prompt
        status, answer = _request("POST", f"{url}/prompt", {"prompt": prompt})
        prompt_id = answer.get("prompt_id")
        # ComfyUI also answers 200 when it accepts only the branches of the prompt that passed validation
        # and leaves the others out: node_errors tells which, and a smoke test must not let that go by
        if status != 200 or not prompt_id or answer.get("node_errors"):
            print(f"ComfyUI refused the prompt, or part of it (HTTP {status}):")
            print(json.dumps(answer, indent=2))
            return 1
        print(f"prompt sent, id {prompt_id}")

        # 3. wait for the history entry, which ComfyUI adds when the run has ended
        started = time.monotonic()
        while True:
            _, history = _request("GET", f"{url}/history/{prompt_id}")
            if prompt_id in history:
                break
            if time.monotonic() - started > timeout:
                print(f"prompt {prompt_id} did not end within {timeout:g} s")
                return 1
            time.sleep(poll_interval)
    except OSError as error:  # URLError (nothing listens there) and timeouts alike
        print(f"cannot reach ComfyUI at {url}: {getattr(error, 'reason', error)}")
        return 1

    entry = history[prompt_id]
    outcome = entry.get("status", {}).get("status_str")
    print(f"run ended with status {outcome} after {time.monotonic() - started:.1f} s")
    if outcome != "success":
        _show_run_error(entry)
        return 1
    _show_outputs(entry)
    shown = entry.get("outputs", {})
    silent = [node_id for node_id, node in prompt.items() if node["class_type"] == "PreviewAny" and node_id not in shown]
    for node_id in silent:
        print(f"node {node_id} (PreviewAny) shows nothing: ComfyUI did not run it")
    return 1 if silent else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(errors="replace")  # a Windows console may not know a character of ComfyUI's text
    sys.exit(main(*sys.argv[1:2]))
