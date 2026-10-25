# SPDX-License-Identifier: GPL-3.0-only
"""The plain part of Montagio Transcribe Words: what does not need torch, transformers or ComfyUI.

The node (nodes.py) runs Whisper with transformers' speech recognition pipeline and its word
timestamps (`return_timestamps="word"`), then writes what it heard as a montagio/words@1 document:
the pieces of words as Whisper cuts them, each with its moment in the clip. A piece that does not
start with a space continues the word before it ("J" + "'ai"): the app joins them, and aligns the
text the user corrects on these moments.
"""
import os

import numpy as np

WORDS_SCHEMA = "montagio/words@1"
WHISPER_FOLDER = "whisper"  # ComfyUI/models/whisper/<model>/: a Hugging Face folder (config.json, model.safetensors…)
DEFAULT_MODEL = "whisper-large-v3-turbo"
SAMPLE_RATE = 16000  # what Whisper hears

# Whisper's languages, in the order of its tokenizer (generation_config.json, lang_to_id), after "auto".
LANGUAGES = ("auto", *(
    "af am ar as az ba be bg bn bo br bs ca cs cy da de el en es et eu fa fi fo fr gl gu haw ha he hi hr ht hu hy id is it ja jw "
    "ka kk km kn ko la lb ln lo lt lv mg mi mk ml mn mr ms mt my ne nl nn no oc pa pl ps pt ro ru sa sd si sk sl sn so sq sr su "
    "sv sw ta te tg th tk tl tr tt uk ur uz vi yi yo yue zh"
).split())


def language_from_token(token):
    """The code of a language token of Whisper's tokenizer ("<|fr|>" → "fr")."""
    code = token.strip().removeprefix("<|").removesuffix("|>")
    if code not in LANGUAGES[1:]:
        raise ValueError(f"{token!r} is not a language of Whisper")
    return code


def to_mono_16k(waveform, sample_rate):
    """A [channels, samples] sound as mono float32 at 16 kHz: the channels averaged, then resampled linearly when needed.

    The app sends 16 kHz already (FFmpeg resamples it properly); the linear path is for a graph built by hand.
    """
    mono = np.asarray(waveform, dtype=np.float32).reshape(-1, np.shape(waveform)[-1]).mean(axis=0)
    if sample_rate == SAMPLE_RATE or mono.size == 0:
        return mono.astype(np.float32)
    length = int(round(mono.size * SAMPLE_RATE / sample_rate))
    positions = np.arange(length, dtype=np.float64) * sample_rate / SAMPLE_RATE
    return np.interp(positions, np.arange(mono.size), mono).astype(np.float32)


def chunk_rows(chunks):
    """The pipeline's chunks ({"text", "timestamp": (start, end)}) as rows {"text", "start", "end"}; a chunk without a start is dropped."""
    rows = []
    for chunk in chunks:
        start, end = (tuple(chunk.get("timestamp") or ()) + (None, None))[:2]
        if start is None:
            continue
        rows.append({"text": str(chunk.get("text", "")), "start": float(start), "end": None if end is None else float(end)})
    return rows


def _ms(value):
    return None if value is None else round(float(value), 3)


def words_document(rows, *, model, language, detected, duration_s, text):
    """What the node returns: montagio/words@1, times rounded to the millisecond, the last end possibly missing."""
    return {
        "schema": WORDS_SCHEMA,
        "model": model,
        "language": language,
        "detected": bool(detected),
        "duration_s": _ms(duration_s),
        "text": text,
        "chunks": [{"text": row["text"], "start": _ms(row["start"]), "end": _ms(row["end"])} for row in rows],
    }


def model_names(dirs):
    """The model folders of the whisper folders (those that hold a config.json), sorted, each name once."""
    names = set()
    for base in dirs:
        try:
            entries = os.listdir(base)
        except OSError:
            continue
        names |= {name for name in entries if os.path.isfile(os.path.join(base, name, "config.json"))}
    return sorted(names)
