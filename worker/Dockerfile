# cuDNN 9 matches what current ctranslate2 (faster-whisper) and torch wheels expect.
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/cache/huggingface

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip python3-venv ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

WORKDIR /app
# Torch first from the CUDA index; otherwise pip resolves whisperx's torch
# requirement against PyPI and may pick a CPU-only or mismatched build.
RUN pip install --index-url https://download.pytorch.org/whl/cu124 torch torchaudio
COPY pyproject.toml ./
COPY lessionsummary_worker ./lessionsummary_worker
RUN pip install ".[transcribe]"

VOLUME /cache
ENTRYPOINT ["python", "-m", "lessionsummary_worker"]
