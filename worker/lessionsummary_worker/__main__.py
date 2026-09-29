from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path


def _load_dotenv(path: Path) -> None:
    # Native runs on the home PC have no compose file to inject env vars;
    # a .env next to the package is the least surprising place for them.
    # Real environment variables win.
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip().removeprefix("export ").strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="lessionsummary_worker")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--drain", action="store_true", help="process all open jobs, then exit (1 if any failed)")
    mode.add_argument("--loop", action="store_true", help="poll forever (default)")
    parser.add_argument("--env-file", default=None, help="path to .env (default: worker/.env)")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args(argv)

    _load_dotenv(Path(args.env_file) if args.env_file else Path(__file__).resolve().parent.parent / ".env")

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        stream=sys.stderr,
    )
    # Keep third-party chatter (urllib3, pyannote, lightning) from drowning
    # the per-job lines that actually tell you what happened.
    for noisy in ("urllib3", "speechbrain", "pytorch_lightning", "lightning", "pyannote", "faster_whisper"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    from .config import Config
    from .loop import Worker

    drain = args.drain or (not args.loop and os.environ.get("DRAIN", "").lower() in ("1", "true", "yes"))
    worker = Worker(Config.from_env(), drain=drain)
    worker.install_signal_handlers()
    return worker.run()


if __name__ == "__main__":
    sys.exit(main())
