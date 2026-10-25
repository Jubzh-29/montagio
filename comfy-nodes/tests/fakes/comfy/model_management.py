# SPDX-License-Identifier: GPL-3.0-only
"""A stand-in for ComfyUI's comfy.model_management: the three calls the transcription node makes, recorded in `calls`."""

calls = []


def get_torch_device():
    calls.append(("get_torch_device",))
    return "cpu"


def free_memory(memory_required, device, keep_loaded=[], for_dynamic=False, pins_required=0, ram_required=0):
    calls.append(("free_memory", memory_required, device))


def soft_empty_cache(force=False):
    calls.append(("soft_empty_cache",))
