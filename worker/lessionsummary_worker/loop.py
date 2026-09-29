from __future__ import annotations

import logging
import shutil
import signal
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

import requests

from .client import ApiClient, Job, LeaseLost
from .config import Config
from .errors import JobError

log = logging.getLogger(__name__)

HEARTBEAT_EVERY_S = 60
MAX_BACKOFF_S = 300


class Heartbeat:
    """Keeps the job lease alive while a long transcription runs.

    Whisper cannot be interrupted mid-call, so a lost lease only sets a flag;
    the loop checks it afterwards and drops the result instead of racing the
    worker that now owns the job.
    """

    def __init__(self, api: ApiClient, job: Job) -> None:
        self.api = api
        self.job = job
        self.lost = threading.Event()
        self._stop = threading.Event()
        interval = min(HEARTBEAT_EVERY_S, max(10, job.lease_seconds // 3))
        self._thread = threading.Thread(target=self._run, args=(interval,), name=f"hb-{job.id}", daemon=True)

    def __enter__(self) -> "Heartbeat":
        self._thread.start()
        return self

    def __exit__(self, *exc: Any) -> None:
        self._stop.set()
        self._thread.join(timeout=5)

    def _run(self, interval: float) -> None:
        while not self._stop.wait(interval):
            try:
                lease = self.api.heartbeat(self.job.id)
                interval = min(HEARTBEAT_EVERY_S, max(10, lease // 3))
            except LeaseLost:
                log.warning("job %s: lease lost, result will be discarded", self.job.id)
                self.lost.set()
                return
            except requests.RequestException as exc:
                # A missed beat is fine as long as the next one lands before
                # the lease runs out; keep trying.
                log.warning("job %s: heartbeat failed: %s", self.job.id, exc)


class Worker:
    def __init__(self, cfg: Config, drain: bool = False) -> None:
        self.cfg = cfg
        self.drain = drain
        self.api = ApiClient(cfg)
        self._transcriber = None
        self._stopping = threading.Event()
        self._current: Job | None = None
        self._seen: set[str] = set()
        self.done = 0
        self.failed = 0

    # ── signals ──────────────────────────────────────────────────────────

    def install_signal_handlers(self) -> None:
        def handler(signum, _frame):
            if self._stopping.is_set():
                # Second signal: the user does not want to wait for the
                # current job. Hand it back so another run picks it up.
                job = self._current
                if job is not None:
                    log.warning("forced stop — returning job %s to the queue", job.id)
                    self.api.fail(job.id, "worker stopped", retryable=True)
                raise SystemExit(130)
            log.info("stop requested — finishing current job, signal again to abort it")
            self._stopping.set()

        signal.signal(signal.SIGINT, handler)
        if hasattr(signal, "SIGTERM"):
            signal.signal(signal.SIGTERM, handler)

    # ── main loop ────────────────────────────────────────────────────────

    def transcriber(self):
        if self._transcriber is None:
            from .transcribe import Transcriber

            self._transcriber = Transcriber(self.cfg)
        return self._transcriber

    def run(self) -> int:
        mode = "drain" if self.drain else "loop"
        log.info("worker %s started (%s mode, kinds=%s, url=%s)", self.cfg.worker_id, mode, ",".join(self.cfg.kinds), self.cfg.ls_url)
        backoff = self.cfg.poll_interval
        while not self._stopping.is_set():
            try:
                job = self.api.claim()
            except requests.HTTPError as exc:
                status = exc.response.status_code if exc.response is not None else 0
                if status in (401, 403):
                    log.error("server rejected the worker token (HTTP %s)", status)
                    return 2
                job, backoff = None, self._backoff(backoff, exc)
                if self.drain and backoff >= MAX_BACKOFF_S:
                    return 1
                continue
            except requests.RequestException as exc:
                job, backoff = None, self._backoff(backoff, exc)
                if self.drain and backoff >= MAX_BACKOFF_S:
                    log.error("server unreachable, giving up")
                    return 1
                continue

            backoff = self.cfg.poll_interval
            if job is None:
                if self.drain:
                    break
                self._stopping.wait(self.cfg.poll_interval)
                continue
            if self.drain and job.id in self._seen:
                # A retryable failure went straight back into the queue and
                # we got it again. Draining would never end; leave it for the
                # next run instead.
                log.warning("job %s came back after failing in this run — stopping drain", job.id)
                self.api.fail(job.id, "retry deferred to next run", retryable=True)
                break
            self._seen.add(job.id)
            self._process(job)

        log.info("worker finished: %d done, %d failed", self.done, self.failed)
        return 1 if self.failed else 0

    def _backoff(self, current: float, exc: Exception) -> float:
        log.warning("server not reachable (%s), retrying in %.0fs", exc, current)
        self._stopping.wait(current)
        return min(current * 2, MAX_BACKOFF_S)

    def _process(self, job: Job) -> None:
        name = job.file.get("name") or job.file.get("id") or "file"
        log.info("job %s: %s %s (%s bytes)", job.id, job.kind, name, job.file.get("size", "?"))
        started = time.monotonic()
        self._current = job
        tmp = Path(tempfile.mkdtemp(prefix=f"ls-{job.id}-"))
        try:
            with Heartbeat(self.api, job) as hb:
                result = self._execute(job, tmp)
                if hb.lost.is_set():
                    return
            self.api.complete(job.id, result)
            self.done += 1
            log.info("job %s: done in %.0fs", job.id, time.monotonic() - started)
        except LeaseLost:
            log.warning("job %s: lease lost, dropping", job.id)
        except JobError as exc:
            self.failed += 1
            log.error("job %s: failed (%s): %s", job.id, "retryable" if exc.retryable else "permanent", exc)
            self.api.fail(job.id, str(exc), exc.retryable)
        except requests.RequestException as exc:
            self.failed += 1
            log.error("job %s: network error: %s", job.id, exc)
            self.api.fail(job.id, f"network error: {exc}", retryable=True)
        except Exception as exc:  # never let one bad file kill the worker
            self.failed += 1
            log.exception("job %s: unexpected error", job.id)
            self.api.fail(job.id, f"{type(exc).__name__}: {exc}", retryable=False)
        finally:
            self._current = None
            shutil.rmtree(tmp, ignore_errors=True)

    def _execute(self, job: Job, tmp: Path) -> dict[str, Any]:
        suffix = Path(job.file.get("name") or "").suffix[:10]
        src = self.api.download(job, tmp / f"input{suffix}")
        if job.kind == "extract":
            from .extract import extract

            return extract(src, job.file.get("name") or "", job.file.get("mime"))
        if job.kind == "transcribe":
            from .transcribe import to_wav

            wav = to_wav(src, tmp / "audio.wav")
            return self.transcriber().run(wav, job.options)
        raise JobError(f"unknown job kind {job.kind!r}")
