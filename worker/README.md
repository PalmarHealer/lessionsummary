# LessionSummary Worker

Holt Jobs von der Web-App ab und schickt Ergebnisse zurück:

| Job | Was passiert |
|---|---|
| `transcribe` | ffmpeg → 16 kHz mono → **WhisperX** (large-v3, VAD, Batch) → wav2vec2-Alignment → **pyannote**-Sprechererkennung → Segmente pro Sprecher zu Redebeiträgen zusammengefasst |
| `extract` | Text aus PDF (je Seite), DOCX (inkl. Tabellen), PPTX (je Folie + Notizen), XLSX/CSV (als Markdown-Tabellen), ODT/ODP/ODS, TXT/MD |

Der Worker braucht **keinen offenen Port** — er fragt nur ausgehend bei
`LS_URL` nach. Er kann also auf dem Heim-PC hinter NAT laufen.

## Betriebsarten

```bash
python -m lessionsummary_worker --drain   # alles Offene abarbeiten, dann beenden
python -m lessionsummary_worker           # Dauerbetrieb, pollt alle POLL_INTERVAL s
```

`--drain` (oder `DRAIN=1`) endet mit Exit-Code `0`, wenn alles geklappt hat,
`1`, wenn mindestens ein Job fehlgeschlagen ist, `2` bei abgelehntem Token.
Das nutzt `station/run.ps1` bzw. `run.sh` für den Nachtlauf.

Strg+C einmal: aktueller Job wird fertig gemacht, dann Ende. Zweimal: Job wird
an die Warteschlange zurückgegeben.

## Konfiguration

`.env.example` nach `.env` kopieren (liegt neben diesem README und wird beim
Start automatisch gelesen; echte Umgebungsvariablen haben Vorrang).
Mindestens `LS_URL`, `LS_WORKER_TOKEN` und `HF_TOKEN` setzen.

### HuggingFace-Token für die Sprechererkennung

pyannote-Modelle sind „gated": Einmal mit einem HF-Account die Bedingungen
akzeptieren, sonst schlägt das Laden mit 401/403 fehl.

1. <https://huggingface.co/pyannote/speaker-diarization-3.1> → *Agree and access*
2. <https://huggingface.co/pyannote/segmentation-3.0> → *Agree and access*
3. Neuere whisperx-Versionen nutzen <https://huggingface.co/pyannote/speaker-diarization-community-1> — dort ebenfalls zustimmen.
4. <https://huggingface.co/settings/tokens> → Token mit *Read*-Recht → `HF_TOKEN`

Ohne `HF_TOKEN` (oder mit `DIARIZE=false`) läuft alles, nur ohne Sprecher.

## Nativ unter Windows (empfohlen für den Heim-PC)

Voraussetzungen: NVIDIA-GPU mit aktuellem Treiber, **Python 3.10–3.12**
(3.13+ hat noch keine Wheels für alle Abhängigkeiten).

```powershell
winget install Python.Python.3.12
winget install Gyan.FFmpeg          # danach neues Terminal, damit ffmpeg im PATH ist

cd worker
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
# Torch zuerst aus dem CUDA-Index — sonst landet die CPU-Version im venv.
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
pip install -e ".[transcribe]"

python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
copy .env.example .env               # und ausfüllen
python -m lessionsummary_worker --drain
```

Gibt der Check `False` aus, hat whisperx beim Installieren eine CPU-Torch
nachgezogen. Dann Torch erneut aus dem CUDA-Index installieren:
`pip install --force-reinstall torch torchaudio --index-url https://download.pytorch.org/whl/cu124`.

Fehlermeldung `Could not locate cudnn_ops64_9.dll` o. ä.: Die cuDNN-DLLs
liegen im Torch-Paket; `.venv\Lib\site-packages\torch\lib` zum `PATH`
hinzufügen.

## Nativ unter Linux

```bash
sudo apt install ffmpeg python3.12-venv      # bzw. Äquivalent der Distribution
cd worker
python3.12 -m venv .venv && . .venv/bin/activate
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
pip install -e ".[transcribe]"
cp .env.example .env && $EDITOR .env
python -m lessionsummary_worker --drain
```

## Docker

Braucht das NVIDIA Container Toolkit (unter Windows: Docker Desktop mit WSL2-
Backend, GPU-Support ist dort eingebaut).

```bash
cp .env.example .env
docker compose up -d --build                         # Dauerbetrieb
docker compose run --rm worker --drain               # einmal alles abarbeiten
```

Modelle (~4 GB) landen im Volume `hf-cache` und werden nur einmal geladen.

## GPU, VRAM, Geschwindigkeit

| VRAM | Einstellung |
|---|---|
| ≥ 10 GB | Standard: `large-v3`, `float16`, Batch 16 |
| 8 GB | `WHISPER_BATCH_SIZE=8` |
| 6 GB (z. B. RTX 3050) | `WHISPER_COMPUTE_TYPE=int8_float16`, `WHISPER_BATCH_SIZE=4`, `LOW_VRAM=1` |
| < 6 GB | `WHISPER_MODEL=medium` oder `large-v3-turbo`, `int8_float16` |

Richtwert: Eine 90-Minuten-Doppelstunde braucht auf einer RTX 3080/4070
etwa 3–6 Minuten inklusive Sprechererkennung. Modelle bleiben zwischen den
Jobs im Speicher; der erste Job eines Laufs dauert wegen des Ladens länger.

`LOW_VRAM=1` hält immer nur ein Modell auf der GPU (Whisper → Alignment →
Sprechererkennung) und lädt es pro Job neu. Das kostet pro Job einige
Sekunden, macht aber `large-v3` samt pyannote auf 6 GB erst möglich. Auf
einer RTX 3050 ist grob mit 10–20 Minuten pro Doppelstunde zu rechnen;
`large-v3-turbo` ist etwa dreimal so schnell und für Deutsch kaum schlechter.

Bei `CUDA out of memory` wird der Job als wiederholbar zurückgegeben —
Batch-Größe senken und neu starten.

## CPU-Betrieb

```
WHISPER_DEVICE=cpu
WHISPER_MODEL=medium          # large-v3 auf CPU: etwa Echtzeit oder langsamer
```

`WHISPER_COMPUTE_TYPE` wird dann automatisch `int8`. Die Sprechererkennung
funktioniert auch auf CPU, braucht aber für eine Stunde Audio grob 10–20 Min.

## Nur Dokumente extrahieren (kleiner Server, ohne GPU)

Textextraktion braucht weder Torch noch whisperx. Auf dem Server neben der
Web-App kann ein schlanker Worker laufen, damit PDFs & Co. sofort durch sind
und der Heim-PC nur noch Audio macht:

```bash
pip install -e .                       # ohne [transcribe]
WORKER_KINDS=extract python -m lessionsummary_worker
```

Auf dem Heim-PC dann `WORKER_KINDS=transcribe` setzen — oder beides lassen,
dann nimmt er, was da ist.
