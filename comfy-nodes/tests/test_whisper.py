# SPDX-License-Identifier: GPL-3.0-only
"""The plain part of Montagio Transcribe Words: Whisper's pieces of words as the app reads them (montagio/words@1)."""
import numpy as np
import pytest

from montagio_nodes.whisper import (
    DEFAULT_MODEL,
    LANGUAGES,
    SAMPLE_RATE,
    WORDS_SCHEMA,
    chunk_rows,
    language_from_token,
    model_names,
    to_mono_16k,
    words_document,
)


def test_languages_start_with_auto_and_hold_whisper_s_codes():
    assert LANGUAGES[0] == "auto"
    assert {"en", "fr", "es", "ja", "yue"} <= set(LANGUAGES)
    assert len(LANGUAGES) == 101 and len(set(LANGUAGES)) == 101


def test_chunk_rows_keeps_the_leading_space_and_a_missing_end():
    rows = chunk_rows([{"text": " Hello,", "timestamp": (0.0, 0.68)}, {"text": "'s", "timestamp": (0.68, None)}])
    assert rows == [{"text": " Hello,", "start": 0.0, "end": 0.68}, {"text": "'s", "start": 0.68, "end": None}]


def test_chunk_rows_drops_a_piece_without_a_start():
    assert chunk_rows([{"text": " lost", "timestamp": (None, 1.0)}, {"text": " kept", "timestamp": (1.0, 1.2)}]) == [{"text": " kept", "start": 1.0, "end": 1.2}]


def test_words_document_is_what_the_app_reads():
    doc = words_document(
        [{"text": " Hello,", "start": 0.123456, "end": 0.6789}, {"text": " there", "start": 0.7, "end": None}],
        model="whisper-large-v3-turbo",
        language="en",
        detected=True,
        duration_s=2.9375,
        text=" Hello, there",
    )
    assert doc == {
        "schema": WORDS_SCHEMA,
        "model": "whisper-large-v3-turbo",
        "language": "en",
        "detected": True,
        "duration_s": 2.938,
        "text": " Hello, there",
        "chunks": [{"text": " Hello,", "start": 0.123, "end": 0.679}, {"text": " there", "start": 0.7, "end": None}],
    }
    assert WORDS_SCHEMA == "montagio/words@1"


def test_language_from_token():
    assert language_from_token("<|fr|>") == "fr"
    with pytest.raises(ValueError):
        language_from_token("<|nope|>")


def test_to_mono_16k_averages_the_channels_and_resamples():
    stereo = np.stack([np.ones(24000, dtype=np.float32), -np.ones(24000, dtype=np.float32) * 0.5])
    mono = to_mono_16k(stereo, 24000)
    assert mono.dtype == np.float32 and mono.shape == (SAMPLE_RATE,)
    assert np.allclose(mono, 0.25)
    same = to_mono_16k(np.zeros((1, 16000), dtype=np.float32), 16000)
    assert same.shape == (16000,)


def test_model_names_lists_the_folders_with_a_config(tmp_path):
    (tmp_path / "whisper-large-v3-turbo").mkdir()
    (tmp_path / "whisper-large-v3-turbo" / "config.json").write_text("{}")
    (tmp_path / "empty").mkdir()
    assert model_names([str(tmp_path), str(tmp_path / "missing")]) == ["whisper-large-v3-turbo"]
    assert model_names([]) == []
    assert DEFAULT_MODEL == "whisper-large-v3-turbo"
