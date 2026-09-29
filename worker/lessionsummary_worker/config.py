from __future__ import annotations

import os
import socket
from dataclasses import dataclass


def _bool(value: str | None, default: bool) -> bool:
    if value is None or value.strip() == "":
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def _int(value: str | None, default: int) -> int:
    try:
        return int(value) if value not in (None, "") else default
    except ValueError:
        return default


def _float(value: str | None, default: float) -> float:
    try:
        return float(value) if value not in (None, "") else default
    except ValueError:
        return default


@dataclass(frozen=True)
class Config:
    ls_url: str
    token: str
    worker_id: str
    kinds: tuple[str, ...]
    whisper_model: str
    device: str
    compute_type: str
    batch_size: int
    hf_token: str | None
    diarize: bool
    poll_interval: float
    default_language: str | None
    # Hold only one model on the GPU at a time (Whisper → alignment →
    # diarization). Costs a few seconds of reloading per job; makes large-v3
    # plus pyannote fit on 6 GB cards.
    low_vram: bool

    @staticmethod
    def from_env() -> "Config":
        url = os.environ.get("LS_URL", "").rstrip("/")
        token = os.environ.get("LS_WORKER_TOKEN", "")
        if not url or not token:
            raise SystemExit("LS_URL and LS_WORKER_TOKEN must be set")

        device = os.environ.get("WHISPER_DEVICE", "cuda").strip().lower() or "cuda"
        # float16 is the fast path on GPUs; CTranslate2 on CPU only supports
        # int8/float32, and int8 is the only one that is usable speed-wise.
        compute = os.environ.get("WHISPER_COMPUTE_TYPE") or ("float16" if device == "cuda" else "int8")

        kinds = tuple(
            k.strip() for k in os.environ.get("WORKER_KINDS", "transcribe,extract").split(",") if k.strip()
        )
        unknown = set(kinds) - {"transcribe", "extract"}
        if unknown or not kinds:
            raise SystemExit(f"WORKER_KINDS must be a subset of transcribe,extract (got {','.join(kinds) or 'nothing'})")

        # An explicitly empty DEFAULT_LANGUAGE means "let Whisper detect it";
        # an unset one means German, since that is what the recordings are.
        lang_raw = os.environ.get("DEFAULT_LANGUAGE")
        default_language = "de" if lang_raw is None else (lang_raw.strip() or None)

        return Config(
            ls_url=url,
            token=token,
            worker_id=os.environ.get("WORKER_ID") or socket.gethostname(),
            kinds=kinds,
            whisper_model=os.environ.get("WHISPER_MODEL", "large-v3"),
            device=device,
            compute_type=compute,
            batch_size=_int(os.environ.get("WHISPER_BATCH_SIZE"), 16),
            hf_token=os.environ.get("HF_TOKEN") or None,
            diarize=_bool(os.environ.get("DIARIZE"), True),
            poll_interval=_float(os.environ.get("POLL_INTERVAL"), 5.0),
            default_language=default_language,
            low_vram=_bool(os.environ.get("LOW_VRAM"), False),
        )
