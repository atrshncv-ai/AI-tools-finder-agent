#!/usr/bin/env python3
"""transcribe_local.py — offline speech-to-text with faster-whisper (CPU).

The pipeline calls this script when a video has no usable captions. It is the
free alternative to the HTTP Whisper API: a `small` model in int8 runs on a
2-core CPU, needs no key and no network after the model is cached.

Usage:
    /opt/whisper-venv/bin/python scripts/hermes/transcribe_local.py AUDIO [--model small]

Output contract:
    stdout — only the transcript (one line, whitespace-normalized);
    stderr — diagnostics and progress; a non-zero exit code means no text.

Exit codes:
    0  transcript printed
    1  transcription failed or produced no text
    2  invalid arguments (argparse)
    66 audio file not found
    69 faster-whisper is not installed in this interpreter

The model is cached in /opt/whisper-models when that directory exists (created
by scripts/deploy/install-whisper.sh); otherwise the Hugging Face default cache
of the current user is used. A first run without a cached model downloads it.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys

DEFAULT_MODEL = "small"
DEFAULT_DEVICE = "cpu"
DEFAULT_COMPUTE_TYPE = "int8"
SHARED_MODEL_CACHE = "/opt/whisper-models"


def log(message: str) -> None:
    print(f"[transcribe-local] {message}", file=sys.stderr, flush=True)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="transcribe_local.py",
        description="Transcribe an audio file with faster-whisper on CPU.",
    )
    parser.add_argument("audio", help="path to the audio file (mp3/m4a/wav/…)")
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"faster-whisper model name or local path (default: {DEFAULT_MODEL})",
    )
    parser.add_argument("--device", default=DEFAULT_DEVICE, help="ctranslate2 device (default: cpu)")
    parser.add_argument(
        "--compute-type",
        default=DEFAULT_COMPUTE_TYPE,
        help=f"ctranslate2 compute type (default: {DEFAULT_COMPUTE_TYPE})",
    )
    parser.add_argument(
        "--language",
        default=None,
        help="optional ISO language code; auto-detect when omitted",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)

    audio_path = os.path.abspath(args.audio)
    if not os.path.isfile(audio_path):
        log(f"audio file not found: {audio_path}")
        return 66

    # Keep the server offline-friendly and stdout clean: huggingface progress
    # goes to stderr, telemetry is disabled.
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    logging.basicConfig(
        stream=sys.stderr,
        level=logging.WARNING,
        format="[%(name)s] %(levelname)s: %(message)s",
    )

    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        log(f"faster-whisper is not installed in this interpreter: {exc}")
        log("run: sudo bash scripts/deploy/install-whisper.sh")
        return 69

    cache_dir = SHARED_MODEL_CACHE if os.path.isdir(SHARED_MODEL_CACHE) else None
    if cache_dir is None:
        log(f"shared model cache not found ({SHARED_MODEL_CACHE}); using the user cache")

    try:
        model = WhisperModel(
            args.model,
            device=args.device,
            compute_type=args.compute_type,
            download_root=cache_dir,
        )
        segments, info = model.transcribe(
            audio_path,
            beam_size=5,
            vad_filter=True,
            language=args.language,
        )
        text = " ".join(segment.text.strip() for segment in segments if segment.text.strip())
        text = " ".join(text.split())
    except Exception as exc:  # CLI boundary: any model/IO error becomes exit 1
        log(f"transcription failed: {type(exc).__name__}: {exc}")
        return 1

    if not text:
        log("model produced no text")
        return 1

    duration = getattr(info, "duration", None)
    language = getattr(info, "language", None)
    sys.stdout.write(text + "\n")
    sys.stdout.flush()
    log(
        f"done: {len(text)} chars, language={language}, audio={duration}s, "
        f"model={args.model} ({args.compute_type})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
