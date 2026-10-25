"""Spike of the Restyle extension (video remix), outside the app: Wan 2.1 VACE 14B on a reference clip.

Runs in a container of montagio_s2.py (`cmd`, ComfyUI and the proxy started), from the repository root:

  python3 infra/modal/spike_restyle.py --jobs /workspace/restyle-jobs.json --out /results/runs/<dir>
  python3 infra/modal/spike_restyle.py --jobs jobs.json --out out --comfyui http://127.0.0.1:8288 --validate-only

Each job of the JSON list keeps the clip's motion, camera and timing and rebuilds the scene:
  {"name": "car-canny-ref", "clip": "/workspace/restyle-car.mp4", "control": "canny" | "depth",
   "ref": "edit" | "@<another job>" | "/workspace/x.png" | null, "ref_mode": "reference" | "first-frame",
   "edit": "the edit instruction for the clip's first frame (ref = edit)", "prompt": "the new scene",
   "steps": 4, "seed": 42, "strength": 1.0}

`ref: "edit"` makes the reference from the clip's first frame with the app's own edit job (npm run smoke
--extension edit, Qwen-Image-Edit-2511 and its 4-step LoRA), all edits first so each model loads once.
The ComfyUI core nodes only: LoadVideo, Canny, Depth Anything 3, WanVaceToVideo, TrimVideoLatent.
Writes results.jsonl (time, peak VRAM), the clips, and a sheet per job (source, control, result).
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import shutil
import subprocess
import threading
import time
import urllib.request
from pathlib import Path

VACE = "wan2.1_vace_14B_fp16.safetensors"
LORA = "Wan21_T2V_14B_lightx2v_cfg_step_distill_lora_rank64.safetensors"
TEXT_ENCODER = "umt5_xxl_fp8_e4m3fn_scaled.safetensors"
VAE = "wan_2.1_vae.safetensors"
DEPTH = "depth_anything_3_small.safetensors"
FPS = 16


def wan_negative(repo: Path) -> str:
    """The official Wan templates' default negative, as the effect workflow carries it."""
    effect = json.loads((repo / "workflows" / "wan21-i2v-effect.api.json").read_text(encoding="utf-8"))
    return effect["7"]["inputs"]["text"]


class Comfy:
    def __init__(self, url: str):
        self.url = url.rstrip("/")

    def post(self, path: str, body: dict) -> dict:
        req = urllib.request.Request(
            f"{self.url}{path}", data=json.dumps(body).encode("utf-8"), headers={"Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                text = resp.read().decode("utf-8")
        except urllib.error.HTTPError as error:  # /prompt answers 400 with node_errors
            text = error.read().decode("utf-8")
        return json.loads(text) if text.strip() else {}

    def get(self, path: str) -> dict:
        with urllib.request.urlopen(f"{self.url}{path}", timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))


class VramPeak:
    """nvidia-smi sampled every 0.5 s while a job runs: the peak memory used, in MiB."""

    def __init__(self):
        self.peak = 0
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        while not self._stop.is_set():
            try:
                out = subprocess.run(
                    ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
                    capture_output=True, text=True, timeout=10,
                ).stdout
                self.peak = max(self.peak, max(int(x) for x in out.split() if x.strip().isdigit()))
            except Exception:  # noqa: BLE001 (no GPU: no number)
                pass
            self._stop.wait(0.5)

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, *exc):
        self._stop.set()
        self._thread.join()


def probe(clip: str) -> tuple[int, int, int]:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries",
         "stream=width,height,nb_read_frames", "-of", "csv=p=0", clip],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    width, height, frames = (int(x) for x in out.split(","))
    return width, height, frames


def vace_job(job: dict, clip_name: str, ref_name: str | None, size: tuple[int, int, int], negative: str) -> dict:
    """The API workflow of one restyle job, ComfyUI core nodes only."""
    width, height, frames = size
    width, height = width // 16 * 16, height // 16 * 16
    length = (frames - 1) // 4 * 4 + 1  # VACE takes 4n+1 frames: 81 for 5 s at 16 fps
    name = job["name"]
    g: dict[str, dict] = {
        "1": {"class_type": "LoadVideo", "inputs": {"file": clip_name}},
        "2": {"class_type": "GetVideoComponents", "inputs": {"video": ["1", 0]}},
        "3": {"class_type": "ImageScale", "inputs": {"image": ["2", 0], "upscale_method": "area", "width": width, "height": height, "crop": "center"}},
        "10": {"class_type": "UNETLoader", "inputs": {"unet_name": VACE, "weight_dtype": "fp8_e4m3fn"}},
        "11": {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["10", 0], "lora_name": LORA, "strength_model": 1.0}},
        "12": {"class_type": "ModelSamplingSD3", "inputs": {"model": ["11", 0], "shift": job.get("shift", 5.0)}},
        "13": {"class_type": "CLIPLoader", "inputs": {"clip_name": TEXT_ENCODER, "type": "wan", "device": "default"}},
        "14": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["13", 0], "text": job["prompt"]}},
        "15": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["13", 0], "text": negative}},
        "16": {"class_type": "VAELoader", "inputs": {"vae_name": VAE}},
    }
    if job["control"] == "canny":
        g["4"] = {"class_type": "Canny", "inputs": {"image": ["3", 0], "low_threshold": job.get("low", 0.4), "high_threshold": job.get("high", 0.8)}}
    elif job["control"] == "depth":
        g["5"] = {"class_type": "LoadDA3Model", "inputs": {"model_name": DEPTH, "weight_dtype": "default"}}
        g["6"] = {"class_type": "DA3Inference", "inputs": {"da3_model": ["5", 0], "image": ["3", 0], "resolution": 504, "resize_method": "upper_bound_resize", "mode": "mono"}}
        g["4"] = {"class_type": "DA3Render", "inputs": {"da3_geometry": ["6", 0], "output": "depth", "output.normalization": "v2_style", "output.apply_sky_clip": False}}
    else:
        raise ValueError(f"{name}: control must be canny or depth")
    control = ["4", 0]
    vace_inputs: dict = {
        "positive": ["14", 0], "negative": ["15", 0], "vae": ["16", 0], "width": width, "height": height,
        "length": length, "batch_size": 1, "strength": job.get("strength", 1.0), "control_video": control,
    }
    if ref_name:
        g["20"] = {"class_type": "LoadImage", "inputs": {"image": ref_name}}
        g["21"] = {"class_type": "ImageScale", "inputs": {"image": ["20", 0], "upscale_method": "lanczos", "width": width, "height": height, "crop": "center"}}
        vace_inputs["reference_image"] = ["21", 0]
        if job.get("ref_mode") == "first-frame":
            # The restyled first frame is kept as is (mask 0); the control drives the other frames (mask 1).
            g["22"] = {"class_type": "ImageFromBatch", "inputs": {"image": control, "batch_index": 1, "length": length - 1}}
            g["23"] = {"class_type": "ImageBatch", "inputs": {"image1": ["21", 0], "image2": ["22", 0]}}
            g["24"] = {"class_type": "EmptyImage", "inputs": {"width": width, "height": height, "batch_size": 1, "color": 0}}
            g["25"] = {"class_type": "EmptyImage", "inputs": {"width": width, "height": height, "batch_size": length - 1, "color": 0xFFFFFF}}
            g["26"] = {"class_type": "ImageBatch", "inputs": {"image1": ["24", 0], "image2": ["25", 0]}}
            g["27"] = {"class_type": "ImageToMask", "inputs": {"image": ["26", 0], "channel": "red"}}
            vace_inputs["control_video"] = ["23", 0]
            vace_inputs["control_masks"] = ["27", 0]
    g["30"] = {"class_type": "WanVaceToVideo", "inputs": vace_inputs}
    g["31"] = {"class_type": "KSampler", "inputs": {
        "model": ["12", 0], "positive": ["30", 0], "negative": ["30", 1], "latent_image": ["30", 2],
        "seed": job.get("seed", 42), "steps": job.get("steps", 4), "cfg": 1.0,
        "sampler_name": job.get("sampler", "euler"), "scheduler": "simple", "denoise": 1.0}}
    g["32"] = {"class_type": "TrimVideoLatent", "inputs": {"samples": ["31", 0], "trim_amount": ["30", 3]}}
    g["33"] = {"class_type": "VAEDecode", "inputs": {"samples": ["32", 0], "vae": ["16", 0]}}
    g["34"] = {"class_type": "CreateVideo", "inputs": {"images": ["33", 0], "fps": FPS}}
    g["35"] = {"class_type": "SaveVideo", "inputs": {"video": ["34", 0], "filename_prefix": f"restyle/{name}", "format": "mp4", "format.codec": "h264"}}
    g["36"] = {"class_type": "CreateVideo", "inputs": {"images": control, "fps": FPS}}
    g["37"] = {"class_type": "SaveVideo", "inputs": {"video": ["36", 0], "filename_prefix": f"restyle/{name}-control", "format": "mp4", "format.codec": "h264"}}
    return g


def run_prompt(comfy: Comfy, graph: dict, timeout_s: int) -> tuple[dict, float, int]:
    start = time.time()
    with VramPeak() as vram:
        answer = comfy.post("/prompt", {"prompt": graph})
        if "prompt_id" not in answer:
            raise RuntimeError(f"refused: {json.dumps(answer)[:2000]}")
        prompt_id = answer["prompt_id"]
        while True:
            history = comfy.get(f"/history/{prompt_id}")
            if prompt_id in history:
                entry = history[prompt_id]
                status = entry.get("status", {})
                if status.get("completed") or status.get("status_str") in ("success", "error"):
                    break
            if time.time() - start > timeout_s:
                comfy.post("/interrupt", {})
                raise RuntimeError(f"timeout after {timeout_s} s")
            time.sleep(2)
    if status.get("status_str") != "success":
        raise RuntimeError(f"failed: {json.dumps(status)[:2000]}")
    return entry, time.time() - start, vram.peak


def output_files(entry: dict, comfy_dir: Path) -> list[Path]:
    files = []
    for node in entry.get("outputs", {}).values():
        for key in ("images", "videos", "gifs", "video"):
            for item in node.get(key, []) or []:
                if isinstance(item, dict) and item.get("filename"):
                    files.append(comfy_dir / item.get("type", "output") / item.get("subfolder", "") / item["filename"])
    return files


def sheet(out: Path, rows: list[str], name: str, frames: int) -> None:
    """Frames 0, middle and last of each video, one row per video, into <name>.png."""
    picks = [0, frames // 2, frames - 1]
    select = "+".join(f"eq(n\\,{n})" for n in picks)
    parts = []
    for i, video in enumerate(rows):
        part = out / f".{name}-row{i}.png"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", video, "-vf", f"select='{select}',scale=-2:240,tile=3x1",
                        "-frames:v", "1", str(part)], check=False)
        if part.exists():
            parts.append(part)
    if len(parts) == 1:
        parts[0].replace(out / f"{name}.png")
    elif parts:
        inputs = sum((["-i", str(p)] for p in parts), [])
        stack = "".join(f"[{i}]" for i in range(len(parts))) + f"vstack=inputs={len(parts)}"
        subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", stack, str(out / f"{name}.png")], check=False)
        for p in parts:
            p.unlink(missing_ok=True)


def make_reference(job: dict, out: Path) -> tuple[str, float]:
    """The clip's first frame edited by the app's edit job (smoke.ts, through the proxy)."""
    frame = out / "inputs" / f"{job['name']}-first.png"
    frame.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", job["clip"], "-frames:v", "1", str(frame)], check=True)
    edit_out = out / f"edit-{job['name']}"
    start = time.time()
    code = subprocess.run(["npm", "run", "smoke", "-w", "@montagio/infra-runpod", "--", "--extension", "edit",
                           "--input", str(frame), "--text", f"edit={job['edit']}", "--timeout-min", "20",
                           "--out", str(edit_out)]).returncode
    seconds = time.time() - start
    found = sorted(glob.glob(str(edit_out / "clips" / "*ext-edit*.png")))
    if code != 0 or not found:
        raise RuntimeError(f"edit of {job['name']} failed (code {code})")
    return found[-1], seconds


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--jobs", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--comfyui", default="http://127.0.0.1:8188")
    parser.add_argument("--comfy-dir", default="/workspace/ComfyUI")
    parser.add_argument("--budget-min", type=float, default=52, help="start no job after this many minutes")
    parser.add_argument("--validate-only", action="store_true", help="POST each workflow, then interrupt: node_errors only")
    args = parser.parse_args()

    repo = Path(__file__).resolve().parents[2]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    comfy = Comfy(args.comfyui)
    comfy_dir = Path(args.comfy_dir)
    jobs = json.loads(Path(args.jobs).read_text(encoding="utf-8"))
    negative = wan_negative(repo)
    t0 = time.time()
    log = (out / "results.jsonl").open("a", encoding="utf-8")

    def record(**fields):
        log.write(json.dumps(fields, ensure_ascii=False) + "\n")
        log.flush()
        print(json.dumps(fields, ensure_ascii=False), flush=True)

    # The references first: the edit model loads once, then leaves the GPU for VACE.
    refs: dict[str, str] = {}
    for job in jobs:
        if job.get("ref") == "edit" and not args.validate_only:
            try:
                refs[job["name"]], seconds = make_reference(job, out)
                record(job=job["name"], step="edit", seconds=round(seconds, 1), ref=refs[job["name"]])
            except Exception as error:  # noqa: BLE001
                record(job=job["name"], step="edit", error=str(error))
    for job in jobs:
        ref = job.get("ref")
        if ref and ref.startswith("@") and ref[1:] in refs:  # the reference another job made
            refs[job["name"]] = refs[ref[1:]]
        elif ref and ref != "edit" and not ref.startswith("@"):
            refs[job["name"]] = ref
    if not args.validate_only:
        comfy.post("/free", {"unload_models": True, "free_memory": True})

    failed = 0
    for job in jobs:
        name = job["name"]
        if (time.time() - t0) / 60 > args.budget_min:
            record(job=name, step="vace", skipped=f"budget of {args.budget_min} min spent")
            continue
        if job.get("ref") and name not in refs and not args.validate_only:
            record(job=name, step="vace", skipped="no reference")
            failed += 1
            continue
        input_dir = comfy_dir / "input"
        clip_name = f"restyle-{name}.mp4"
        shutil.copyfile(job["clip"], input_dir / clip_name)
        ref_name = None
        if job.get("ref"):
            ref_name = f"restyle-{name}-ref.png"
            ref_path = refs.get(name) or str(input_dir / "start.png")  # validate-only: any image
            shutil.copyfile(ref_path, input_dir / ref_name)
        size = probe(job["clip"])
        graph = vace_job(job, clip_name, ref_name, size, negative)
        (out / "workflows").mkdir(exist_ok=True)
        (out / "workflows" / f"{name}.api.json").write_text(json.dumps(graph, ensure_ascii=False, indent=1), encoding="utf-8")
        if args.validate_only:
            answer = comfy.post("/prompt", {"prompt": graph})
            comfy.post("/interrupt", {})
            comfy.post("/queue", {"clear": True})
            errors = answer.get("node_errors") or {}
            record(job=name, step="validate", ok="prompt_id" in answer and not errors, answer=answer if errors or "prompt_id" not in answer else None)
            failed += 0 if "prompt_id" in answer and not errors else 1
            continue
        try:
            entry, seconds, peak = run_prompt(comfy, graph, timeout_s=40 * 60)
            files = output_files(entry, comfy_dir)
            kept = []
            for f in files:
                dest = out / "clips" / f.name
                dest.parent.mkdir(exist_ok=True)
                shutil.copyfile(f, dest)
                kept.append(str(dest))
            # LoadVideo previews its input too (restyle-<name>.mp4): the outputs are <name>_… and <name>-control_…
            result = next((k for k in kept if Path(k).name.startswith(f"{name}_")), None)
            control = next((k for k in kept if Path(k).name.startswith(f"{name}-control_")), None)
            rows = [job["clip"]] + ([control] if control else []) + ([result] if result else [])
            sheet(out, rows, name, size[2])
            record(job=name, step="vace", seconds=round(seconds, 1), vram_peak_mib=peak, size=list(size),
                   control=job["control"], ref=bool(ref_name), ref_mode=job.get("ref_mode"), steps=job.get("steps", 4),
                   prompt=job["prompt"], files=kept)
        except Exception as error:  # noqa: BLE001
            failed += 1
            record(job=name, step="vace", error=str(error))
    record(step="end", minutes=round((time.time() - t0) / 60, 1), failed=failed)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
