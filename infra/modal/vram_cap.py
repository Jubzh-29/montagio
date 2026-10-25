"""Holds GPU memory so that the next processes see the free VRAM of a smaller card.

GPU session tooling for the low-memory profile: on a 24 GB L4, `vram_cap.py 11.5 /tmp/vram-cap.ready` keeps
allocating until only 11.5 GiB stay free, writes how much it holds to the ready file, then waits to be killed.
ComfyUI v0.41.0 measures memory pressure on the whole device (NVML, "even counting VRAM from other apps"), and
an allocation past what is left fails as it would on a 12 GB card whose desktop keeps about half a gigabyte.

Run with the Python of ComfyUI's venv (it has torch). Stops by itself after `--hold-s` seconds (default 3 h),
so a container that loses its parent never keeps the GPU busy for nothing.
"""

from __future__ import annotations

import argparse
import json
import time

import torch

CHUNK_MIB = 256


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("free_gib", type=float, help="the VRAM left free, in GiB (11.5 for a 12 GB card)")
    parser.add_argument("ready_file", help="written once the memory is held: {held_mib, free_mib, total_mib}")
    parser.add_argument("--hold-s", type=float, default=3 * 3600)
    args = parser.parse_args()

    target = int(args.free_gib * 1024**3)
    held: list[torch.Tensor] = []
    free, total = torch.cuda.mem_get_info()
    if free <= target:
        raise SystemExit(f"only {free / 1024**2:.0f} MiB free, already under the {target / 1024**2:.0f} MiB asked")
    while True:
        free, total = torch.cuda.mem_get_info()
        step = min(CHUNK_MIB * 1024**2, free - target)
        if step < 1024**2:
            break
        held.append(torch.empty(step, dtype=torch.uint8, device="cuda"))
    free, total = torch.cuda.mem_get_info()
    report = {
        "held_mib": round(sum(t.numel() for t in held) / 1024**2),
        "free_mib": round(free / 1024**2),
        "total_mib": round(total / 1024**2),
    }
    with open(args.ready_file, "w", encoding="utf-8") as out:
        json.dump(report, out)
    print(f"[vram-cap] holding {report['held_mib']} MiB: {report['free_mib']} of {report['total_mib']} MiB left free", flush=True)
    time.sleep(args.hold_s)


if __name__ == "__main__":
    main()
