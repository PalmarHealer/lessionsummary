"""WhisperX transcription with alignment and pyannote speaker diarization.

Heavy imports (torch, whisperx) live inside functions so an extract-only
worker on a small CPU box never has to install or load them.
"""
from __future__ import annotations

import dataclasses
import gc
import logging
import subprocess
import threading
from pathlib import Path
from typing import Any

from .config import Config
from .errors import JobError

log = logging.getLogger(__name__)

SAMPLE_RATE = 16_000
# Consecutive segments of one speaker closer than this are one turn. Whisper
# cuts at every pause, which turns a single explanation into twenty lines.
MERGE_GAP_S = 1.0
# ...but a teacher talking for 20 minutes should still produce timestamps the
# reader can jump between, so turns are split again past this length.
MAX_TURN_S = 90.0


def to_wav(src: Path, dest: Path) -> Path:
    # Normalising to 16 kHz mono up front means every container the browser
    # recorder or a phone produces (webm/opus, m4a, mp4 video) takes the same
    # path, and a broken file fails here with a readable message.
    cmd = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
           "-i", str(src), "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "wav", str(dest)]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60 * 60)
    except FileNotFoundError as exc:
        raise JobError("ffmpeg is not installed on the worker", retryable=True) from exc
    except subprocess.TimeoutExpired as exc:
        raise JobError("ffmpeg conversion timed out", retryable=True) from exc
    if proc.returncode != 0 or not dest.exists() or dest.stat().st_size <= 44:
        raise JobError(f"could not decode audio: {proc.stderr.strip()[-500:] or 'no audio stream'}")
    return dest


class Transcriber:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self._lock = threading.Lock()
        self._asr = None
        self._align: dict[str, tuple[Any, Any] | None] = {}
        self._diarizer = None
        self._diarizer_failed = False

    # ── model cache ──────────────────────────────────────────────────────

    def _asr_model(self):
        if self._asr is None:
            import whisperx

            log.info("loading whisper model %s on %s (%s)", self.cfg.whisper_model, self.cfg.device, self.cfg.compute_type)
            self._asr = whisperx.load_model(
                self.cfg.whisper_model,
                self.cfg.device,
                compute_type=self.cfg.compute_type,
                # Without this whisperx greedily decodes; beam search is worth
                # the cost on classroom audio with its reverb and cross-talk.
                asr_options={"beam_size": 5, "condition_on_previous_text": False},
            )
        return self._asr

    def _align_model(self, language: str):
        if language not in self._align:
            import whisperx

            try:
                self._align[language] = whisperx.load_align_model(language_code=language, device=self.cfg.device)
            except Exception as exc:  # whisperx raises ValueError for languages without a default model
                log.warning("no alignment model for %s, keeping segment-level timestamps: %s", language, exc)
                self._align[language] = None
        return self._align[language]

    def _diarize_model(self):
        if self._diarizer is not None or self._diarizer_failed:
            return self._diarizer
        if not self.cfg.diarize:
            return None
        if not self.cfg.hf_token:
            log.warning("HF_TOKEN not set — skipping speaker diarization")
            self._diarizer_failed = True
            return None

        # The pipeline moved from `whisperx.DiarizationPipeline` to
        # `whisperx.diarize.DiarizationPipeline`, and newer releases renamed
        # `use_auth_token` to `token`. Try the combinations instead of pinning
        # one whisperx version forever.
        cls = None
        try:
            from whisperx.diarize import DiarizationPipeline as cls  # type: ignore[no-redef]
        except ImportError:
            import whisperx

            cls = getattr(whisperx, "DiarizationPipeline", None)
        if cls is None:
            log.warning("installed whisperx has no DiarizationPipeline — skipping diarization")
            self._diarizer_failed = True
            return None

        for kwargs in ({"use_auth_token": self.cfg.hf_token}, {"token": self.cfg.hf_token}):
            try:
                self._diarizer = cls(device=self.cfg.device, **kwargs)
                return self._diarizer
            except TypeError:
                continue
            except Exception as exc:
                # Usually: model terms not accepted on HuggingFace, or bad token.
                log.error("could not load pyannote diarization: %s", exc)
                break
        self._diarizer_failed = True
        return None

    # ── pipeline ─────────────────────────────────────────────────────────

    def _set_initial_prompt(self, model, prompt: str | None) -> None:
        # asr_options are baked into the model at load time, but reloading
        # large-v3 per job would cost more than the job itself. The options
        # object is a namedtuple in older faster-whisper and a dataclass in
        # newer ones; both can be swapped out.
        opts = getattr(model, "options", None)
        if opts is None:
            return
        try:
            if hasattr(opts, "_replace"):
                model.options = opts._replace(initial_prompt=prompt)
            elif dataclasses.is_dataclass(opts):
                model.options = dataclasses.replace(opts, initial_prompt=prompt)
        except Exception as exc:
            log.warning("could not set initial_prompt: %s", exc)

    def run(self, wav: Path, options: dict[str, Any]) -> dict[str, Any]:
        # One GPU, one job — the lock matters only if someone ever runs the
        # loop multi-threaded, but it is cheap insurance against OOM.
        with self._lock:
            try:
                return self._run(wav, options)
            except JobError:
                raise
            except Exception as exc:
                oom = "out of memory" in str(exc).lower()
                raise JobError(f"transcription failed: {exc}", retryable=oom or isinstance(exc, (OSError, RuntimeError))) from exc
            finally:
                self._free_cuda_cache()

    def _run(self, wav: Path, options: dict[str, Any]) -> dict[str, Any]:
        import whisperx

        audio = whisperx.load_audio(str(wav))
        duration = float(len(audio)) / SAMPLE_RATE
        if duration < 0.5:
            raise JobError("recording is empty")

        language = options.get("language") or self.cfg.default_language or None
        model = self._asr_model()
        self._set_initial_prompt(model, options.get("initial_prompt") or None)

        log.info("transcribing %.0fs of audio (language=%s)", duration, language or "auto")
        result = model.transcribe(audio, batch_size=self.cfg.batch_size, language=language)
        language = result.get("language") or language or "unknown"

        if self.cfg.low_vram:
            self._asr = None
            self._free_cuda_cache()

        align = self._align_model(language)
        if align is not None and result.get("segments"):
            align_model, metadata = align
            result = whisperx.align(result["segments"], align_model, metadata, audio, self.cfg.device,
                                    return_char_alignments=False)
        if self.cfg.low_vram:
            self._align.pop(language, None)
            self._free_cuda_cache()

        diarized = False
        diarizer = self._diarize_model()
        if diarizer is not None and result.get("segments"):
            kw = {k: options.get(k) for k in ("min_speakers", "max_speakers") if options.get(k)}
            try:
                diarize_segments = diarizer(audio, **kw)
                assign = getattr(whisperx, "assign_word_speakers", None)
                if assign is None:
                    from whisperx.diarize import assign_word_speakers as assign
                result = assign(diarize_segments, result)
                diarized = True
            except Exception as exc:
                # A transcript without speakers is still worth far more than
                # no transcript — degrade rather than fail the job.
                log.error("diarization failed, returning transcript without speakers: %s", exc)

        if self.cfg.low_vram:
            self._diarizer = None
            self._free_cuda_cache()

        segments = merge_turns(result.get("segments") or [], diarized)
        speakers = sorted({s["speaker"] for s in segments if s["speaker"]})
        return {
            "language": language,
            "duration": round(duration, 2),
            "model": self.cfg.whisper_model,
            "diarized": diarized,
            "speakers": speakers,
            "segments": segments,
        }

    def _free_cuda_cache(self) -> None:
        gc.collect()
        if self.cfg.device != "cuda":
            return
        try:
            import torch

            torch.cuda.empty_cache()
        except Exception:
            pass


def _speaker_of(seg: dict[str, Any]) -> str | None:
    spk = seg.get("speaker")
    if spk:
        return str(spk)
    # assign_word_speakers leaves segment-level speaker unset when the
    # segment straddles a turn; fall back to the majority word speaker.
    counts: dict[str, int] = {}
    for w in seg.get("words") or []:
        if w.get("speaker"):
            counts[w["speaker"]] = counts.get(w["speaker"], 0) + 1
    return max(counts, key=counts.get) if counts else None


def merge_turns(raw: list[dict[str, Any]], diarized: bool) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for seg in raw:
        text = (seg.get("text") or "").strip()
        if not text or seg.get("start") is None or seg.get("end") is None:
            continue
        start, end = float(seg["start"]), float(seg["end"])
        speaker = _speaker_of(seg) if diarized else None
        prev = out[-1] if out else None
        if (
            prev is not None
            and prev["speaker"] == speaker
            and start - prev["end"] < MERGE_GAP_S
            and end - prev["start"] <= MAX_TURN_S
        ):
            prev["end"] = round(end, 2)
            prev["text"] = f"{prev['text']} {text}"
            continue
        out.append({"start": round(start, 2), "end": round(end, 2), "speaker": speaker, "text": text})
    return out
