"""The Motion library: reference motions made by Montagio itself, from fictional characters only.

Runs in a container of montagio_s2.py (`cmd`, ComfyUI and the proxy started), from the repository root:

  python3 infra/modal/motion_library.py --out /results/runs/<dir>

1. Z-Image-Turbo draws each fictional character full body on a plain backdrop (the smoke's --t2i);
2. Wan 2.1 I2V 480p 14B, with its 4-step lightx2v LoRA and no effect LoRA, animates it: 81 frames at
   16 fps, 480x832, a locked-off camera, so that the clip carries the body's motion only;
3. a long dance of 30 s is chained as Montagio chains a film: each 5 s segment starts on the last frame
   of the one before (481 frames once the repeated frames are dropped).

No third-party video and no real person: each clip is generated here, from a text. Writes results.jsonl
(time, peak VRAM), clips/<id>.mp4, long/<id>.mp4 and a sheet per clip.
"""

from __future__ import annotations

import argparse
import glob
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import spike_restyle as spike  # noqa: E402  (Comfy, VramPeak, run_prompt, output_files, sheet)

STYLE = "full body from head to feet, standing in the middle of a plain light grey photo studio, soft even light"
CAMERA = "static locked-off camera, the whole body stays in frame, plain light grey studio background"

# id, the character (Z-Image), what it does (Wan 2.1 I2V). Fictional people, plain clothes, no brand.
MOTIONS = [
    ("hip-hop", "a young woman with short black hair in a yellow hoodie, blue jeans and white sneakers", "she dances energetic hip-hop, bouncing on her knees, swinging her arms and stepping side to side"),
    ("wave-clap", "a smiling middle-aged man with a grey beard in a green jacket and dark trousers", "he waves both hands high above his head, then claps his hands several times"),
    ("jumping-jacks", "a fit young man in a red tracksuit and black running shoes", "he does fast jumping jacks, arms and legs opening and closing in rhythm"),
    ("ballet-spin", "a ballet dancer with her hair in a bun, in a white leotard and pale pink tights", "she rises on her toes and spins slowly with her arms opening gracefully"),
    ("shadow-boxing", "a boxer with a shaved head in a blue tank top, blue shorts and red gloves", "he throws quick punches into the air, jabs and hooks, bouncing on his feet"),
    ("robot-dance", "a teenage boy with curly hair in an orange t-shirt, cargo trousers and sneakers", "he does a robot dance with stiff mechanical arm moves and sharp head turns"),
]

# The long dance: the hip-hop dancer, then five more segments, each from the last frame of the one before.
LONG_ID = "hip-hop-30s"
LONG_SEGMENTS = [
    "she keeps dancing hip-hop, rolling her shoulders and stepping forward and back",
    "she spins around once and keeps dancing, arms swinging",
    "she dances in place with big arm waves and knee bounces",
    "she slides her feet side to side and pumps her arms to the beat",
    "she finishes with a few last bounces and strikes a pose with one arm raised",
]


def i2v_graph(repo: Path, image_name: str, prompt: str, negative: str, seed: int, prefix: str) -> dict:
    """The effect workflow of the repository without its effect LoRA: a plain image-to-video of 81 frames."""
    g = json.loads((repo / "workflows" / "wan21-i2v-effect.api.json").read_text(encoding="utf-8"))
    g["201"]["inputs"]["model"] = ["37", 0]  # the lightx2v LoRA reads the model directly
    del g["200"]
    g["52"]["inputs"]["image"] = image_name
    g["6"]["inputs"]["text"] = prompt
    g["7"]["inputs"]["text"] = negative
    g["50"]["inputs"].update({"width": 480, "height": 832, "length": 81})
    g["3"]["inputs"]["seed"] = seed
    g["56"]["inputs"]["filename_prefix"] = prefix
    return g


def last_frame(video: str, png: Path) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-sseof", "-1", "-i", video, "-update", "1", str(png)], check=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--comfyui", default="http://127.0.0.1:8188")
    parser.add_argument("--comfy-dir", default="/workspace/ComfyUI")
    parser.add_argument("--only", default="", help="comma list of motion ids (default: all, and the long dance)")
    parser.add_argument("--no-long", action="store_true")
    args = parser.parse_args()

    repo = Path(__file__).resolve().parents[2]
    out = Path(args.out)
    (out / "clips").mkdir(parents=True, exist_ok=True)
    comfy = spike.Comfy(args.comfyui)
    comfy_dir = Path(args.comfy_dir)
    negative = spike.wan_negative(repo)
    wanted = [m for m in MOTIONS if not args.only or m[0] in args.only.split(",")]
    log = (out / "results.jsonl").open("a", encoding="utf-8")

    def record(**fields):
        log.write(json.dumps(fields, ensure_ascii=False) + "\n")
        log.flush()
        print(json.dumps(fields, ensure_ascii=False), flush=True)

    # 1. The characters, all in one smoke run: Z-Image loads once.
    t2i = sum((["--t2i", f"{mid}@9:16={who}, {STYLE}"] for mid, who, _ in wanted), [])
    start = time.time()
    code = subprocess.run(["npm", "run", "smoke", "-w", "@montagio/infra-runpod", "--", *t2i, "--resolution", "480p", "--out", str(out / "photos")]).returncode
    record(step="photos", seconds=round(time.time() - start, 1), code=code)
    photos = {}
    for mid, _, _ in wanted:
        found = sorted(glob.glob(str(out / "photos" / "clips" / f"*__t2i-{mid}__*.png")))
        if found:
            photos[mid] = found[-1]
    comfy.post("/free", {"unload_models": True, "free_memory": True})

    def animate(name: str, photo: str, prompt: str, seed: int) -> str | None:
        input_name = f"library-{name}.png"
        shutil.copyfile(photo, comfy_dir / "input" / input_name)
        graph = i2v_graph(repo, input_name, prompt, negative, seed, f"library/{name}")
        try:
            entry, seconds, peak = spike.run_prompt(comfy, graph, timeout_s=30 * 60)
        except Exception as error:  # noqa: BLE001
            record(step="animate", clip=name, error=str(error))
            return None
        files = [f for f in spike.output_files(entry, comfy_dir) if f.suffix == ".mp4"]
        if not files:
            record(step="animate", clip=name, error="no output")
            return None
        dest = out / "clips" / f"{name}.mp4"
        shutil.copyfile(files[-1], dest)
        record(step="animate", clip=name, seconds=round(seconds, 1), vram_peak_mib=peak, prompt=prompt)
        return str(dest)

    # 2. One clip per character.
    clips = {}
    for index, (mid, who, does) in enumerate(wanted):
        if mid not in photos:
            record(step="animate", clip=mid, error="no photo")
            continue
        made = animate(mid, photos[mid], f"{who}, {does}. {CAMERA}.", 42 + index)
        if made:
            clips[mid] = made
            spike.sheet(out, [made], mid, 81)

    # 3. The long dance, chained from the hip-hop clip's last frame.
    if not args.no_long and "hip-hop" in clips:
        who = next(w for m, w, _ in MOTIONS if m == "hip-hop")
        segments = [clips["hip-hop"]]
        (out / "long").mkdir(exist_ok=True)
        for index, does in enumerate(LONG_SEGMENTS, 1):
            frame = out / "long" / f"start-{index}.png"
            last_frame(segments[-1], frame)
            made = animate(f"{LONG_ID}-{index}", str(frame), f"{who}, {does}. {CAMERA}.", 100 + index)
            if not made:
                break
            segments.append(made)
        if len(segments) == len(LONG_SEGMENTS) + 1:
            # Each segment after the first starts on the frame the one before ended on: drop it.
            parts = []
            for index, segment in enumerate(segments):
                part = out / "long" / f"part-{index}.mp4"
                trim = [] if index == 0 else ["-vf", "select='gte(n,1)',setpts=N/16/TB"]
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", segment, *trim, "-r", "16", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", str(part)], check=True)
                parts.append(part)
            listing = out / "long" / "parts.txt"
            listing.write_text("".join(f"file '{p.name}'\n" for p in parts), encoding="utf-8")
            long_clip = out / "long" / f"{LONG_ID}.mp4"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", str(long_clip)], check=True)
            frames = spike.probe(str(long_clip))[2]
            record(step="long", clip=LONG_ID, frames=frames, file=str(long_clip))
            spike.sheet(out, [str(long_clip)], LONG_ID, frames)
    record(step="end", clips=sorted(clips))
    return 0 if len(clips) == len(wanted) else 1


if __name__ == "__main__":
    raise SystemExit(main())
