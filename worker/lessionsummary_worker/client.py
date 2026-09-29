from __future__ import annotations

import logging
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import requests

from .config import Config

log = logging.getLogger(__name__)


class LeaseLost(Exception):
    """The server handed the job to someone else (or it was cancelled)."""


@dataclass
class Job:
    id: str
    kind: str
    file: dict[str, Any]
    download_url: str
    options: dict[str, Any] = field(default_factory=dict)
    lease_seconds: int = 600


class ApiClient:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.http = requests.Session()
        self.http.headers["Authorization"] = f"Bearer {cfg.token}"
        self.http.headers["User-Agent"] = f"lessionsummary-worker/{cfg.worker_id}"

    def _url(self, path: str) -> str:
        return f"{self.cfg.ls_url}/{path.lstrip('/')}"

    def _post(self, path: str, body: dict[str, Any], timeout: float = 30) -> requests.Response:
        return self.http.post(self._url(path), json=body, timeout=timeout)

    def claim(self) -> Job | None:
        r = self._post("/api/worker/claim", {"worker_id": self.cfg.worker_id, "kinds": list(self.cfg.kinds)})
        if r.status_code == 204:
            return None
        r.raise_for_status()
        data = r.json()
        j = data["job"]
        return Job(
            id=str(j["id"]),
            kind=j["kind"],
            file=j.get("file") or {},
            download_url=j["download_url"],
            options=j.get("options") or {},
            lease_seconds=int(data.get("lease_seconds") or 600),
        )

    def download(self, job: Job, dest: Path) -> Path:
        # Recordings of a double lesson easily reach hundreds of MB — stream
        # to disk instead of holding the body in memory.
        with self.http.get(self._url(job.download_url), stream=True, timeout=(30, 300)) as r:
            if r.status_code == 409:
                raise LeaseLost(job.id)
            r.raise_for_status()
            with dest.open("wb") as fh:
                shutil.copyfileobj(r.raw, fh, length=1024 * 1024)
        return dest

    def heartbeat(self, job_id: str) -> int:
        r = self._post(f"/api/worker/jobs/{job_id}/heartbeat", {"worker_id": self.cfg.worker_id})
        if r.status_code == 409:
            raise LeaseLost(job_id)
        r.raise_for_status()
        try:
            return int(r.json().get("lease_seconds") or 600)
        except ValueError:
            return 600

    def complete(self, job_id: str, result: dict[str, Any]) -> None:
        r = self._post(
            f"/api/worker/jobs/{job_id}/complete",
            {"worker_id": self.cfg.worker_id, "result": result},
            timeout=120,
        )
        if r.status_code == 409:
            raise LeaseLost(job_id)
        r.raise_for_status()

    def fail(self, job_id: str, error: str, retryable: bool) -> None:
        try:
            r = self._post(
                f"/api/worker/jobs/{job_id}/fail",
                {"worker_id": self.cfg.worker_id, "error": error[:4000], "retryable": retryable},
            )
            if r.status_code not in (200, 204, 409):
                r.raise_for_status()
        except requests.RequestException as exc:
            # Nothing else to do — the lease will expire and the server
            # requeues the job on its own.
            log.warning("could not report failure for job %s: %s", job_id, exc)
