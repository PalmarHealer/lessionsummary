# Deployment

Zwei Maschinen:

| Wo | Was | Erreichbarkeit |
|---|---|---|
| Server mit OpenSax (Portainer) | `lessionsummary` (Web-App, SQLite, Uploads) | öffentlich über den Reverse Proxy |
| Whisper-Rechner (Linux, RTX 3050) | `worker` (WhisperX + pyannote) | **nur ausgehend** – kein Port, kein Tunnel |

Der Worker fragt die App über HTTPS nach Arbeit. Er kann also zu Hause hinter
NAT stehen, und die App merkt nichts davon, wenn er aus ist: Jobs warten dann
einfach in der Queue.

Die Images baut die CI bei jedem Push auf `main` und legt sie auf GHCR ab:

- `ghcr.io/palmarhealer/lessionsummary-web` (bei Änderungen unter `web/`)
- `ghcr.io/palmarhealer/lessionsummary-worker` (bei Änderungen unter `worker/`)

Tags: `latest` und `sha-<commit>`. `LS_TAG` pinnt eine Version. Das Repo ist
privat, also auch die Pakete: Jeder Host braucht einmal
`docker login ghcr.io` mit einem PAT (Scope `read:packages`), in Portainer
unter *Registries* als GHCR-Registry.

## 0. Secrets erzeugen

```bash
openssl rand -hex 32   # OPENSAX_CLIENT_SECRET
openssl rand -hex 32   # LS_WORKER_TOKEN
openssl rand -hex 32   # LS_ADMIN_TOKEN (optional, siehe unten)
```

## 1. OpenSax

`main` enthält den userinfo-Endpoint; nach dem CI-Lauf den Stack neu ziehen.
In die Env-Variablen des OpenSax-Stacks:

```env
OPENSAX_OAUTH_CLIENTS=[{"client_id":"lessionsummary","client_secret":"<OPENSAX_CLIENT_SECRET>","client_name":"LessionSummary","redirect_uris":["https://summary.example.com/auth/callback"],"scopes":["openid","profile","school"],"trusted":true}]
```

Prüfen: `https://opensax.example.com/.well-known/oauth-authorization-server`
listet `userinfo_endpoint`.

## 2. App (Portainer)

1. DNS: `summary.example.com` auf den Server.
2. Portainer → *Stacks* → *Add stack* → *Repository*:
   Repo `https://github.com/PalmarHealer/lessionsummary`, Compose-Pfad
   `docker-compose.yml`, Authentifizierung mit einem PAT (Repo privat).
   Oder den Inhalt von `docker-compose.yml` in den Web-Editor kopieren.
3. Env-Variablen:

   ```env
   ORIGIN=https://summary.example.com
   OPENSAX_URL=https://opensax.example.com
   OPENSAX_CLIENT_ID=lessionsummary
   OPENSAX_CLIENT_SECRET=<wie in OpenSax>
   LS_WORKER_TOKEN=<secret>
   LS_ADMIN_TOKEN=<secret oder leer>
   LS_MAX_UPLOAD_MB=2048
   BIND_HOST=127.0.0.1        # bzw. die IP, über die der Proxy den Host erreicht
   ```

4. Optional *Webhook* für den Stack aktivieren und die URL als Repo-Secret
   `PORTAINER_WEBHOOK_URL` hinterlegen – dann deployt jeder Push auf `main`
   von selbst.

Daten liegen im Volume `lessionsummary-data` (`lessionsummary.db` +
`files/`). Das Volume ins Backup aufnehmen; die SQLite-Datei läuft im
WAL-Modus, also entweder den Container kurz stoppen oder
`sqlite3 lessionsummary.db ".backup backup.db"` verwenden.

### Reverse Proxy

Proxy-Host `summary.example.com` → `<docker-host>:3002` (oder
`lessionsummary:3000`, wenn der Proxy im selben Docker-Netz hängt – dann mit
Resolver, siehe OpenSax `DEPLOY.md`). Wichtig sind die großen Uploads:

```nginx
client_max_body_size 2g;          # = LS_MAX_UPLOAD_MB
proxy_request_buffering off;      # Upload direkt durchreichen statt erst puffern
proxy_read_timeout 600s;
proxy_send_timeout 600s;
```

In Nginx Proxy Manager gehört das unter *Advanced → Custom Nginx
Configuration* des Proxy-Hosts. Ohne `client_max_body_size` bricht jede
Aufnahme über 1 MB mit *413* ab.

Prüfen: `https://summary.example.com/login` zeigt „Mit OpenSax anmelden";
nach dem Login stehen Schule und Klassen unter *Einstellungen*.

## 3. Whisper-Rechner

### Einmalig: Treiber und Container-Toolkit (Ubuntu 22.04/24.04)

```bash
sudo ubuntu-drivers install            # NVIDIA-Treiber, danach neu starten
nvidia-smi                             # zeigt die RTX 3050

# Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER          # neu einloggen

# NVIDIA Container Toolkit
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker

docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi   # GPU im Container sichtbar?
```

### HuggingFace (für die Sprechererkennung)

1. Konto auf huggingface.co, *Settings → Access Tokens* → Read-Token.
2. Die Nutzungsbedingungen **beider** Modelle akzeptieren (sonst lädt pyannote
   nicht und der Worker transkribiert ohne Sprecher):
   - https://huggingface.co/pyannote/speaker-diarization-3.1
   - https://huggingface.co/pyannote/segmentation-3.0

### Worker starten

```bash
docker login ghcr.io                   # PAT mit read:packages
mkdir -p ~/lessionsummary-worker && cd ~/lessionsummary-worker
# docker-compose.yml aus worker/ hierher kopieren, dann .env anlegen:
cat > .env <<'ENV'
LS_URL=https://summary.example.com
LS_WORKER_TOKEN=<wie in der App>
WORKER_ID=whisper-3050

WHISPER_MODEL=large-v3
WHISPER_DEVICE=cuda
WHISPER_COMPUTE_TYPE=int8_float16
WHISPER_BATCH_SIZE=4
LOW_VRAM=1

HF_TOKEN=<huggingface read token>
DIARIZE=true
DEFAULT_LANGUAGE=de
ENV
docker compose pull && docker compose up -d
docker compose logs -f
```

Beim ersten Job lädt der Worker rund 4 GB Modelle ins Volume `hf-cache`; das
passiert nur einmal. `restart: unless-stopped` startet ihn nach einem Reboot
wieder.

Prüfen: In einer Einheit eine kurze Aufnahme hochladen → das Badge wechselt
von „Transkription wartet" auf „läuft", im Log erscheint `transcribing …`,
nach Abschluss steht das Transkript mit Sprechern in der Einheit.

Läuft der Speicher trotzdem voll (`CUDA out of memory`), zuerst
`WHISPER_BATCH_SIZE=2`, dann `WHISPER_MODEL=large-v3-turbo`.

## 4. Zusammenfassungen

In der App unter *Einstellungen → API-Tokens* ein Token anlegen; dieselbe Seite
zeigt die fertige Konfiguration für Claude Desktop (geplante Aufgabe) und
Claude Code. Ein Nutzer-Token sieht nur die eigenen Einheiten – soll eine
Aufgabe für alle Nutzer der Instanz schreiben, stattdessen `LS_ADMIN_TOKEN`
verwenden.

Die geplante Aufgabe in Claude Desktop läuft nur, solange Claude Desktop auf
einem Rechner offen ist. Alternativ kann der Whisper-Rechner selbst mit
`station/run.sh` per cron zusammenfassen (braucht dort ein angemeldetes Claude
Code), siehe [`station/README.md`](station/README.md).

## Update & Rollback

- App: Push auf `main` → CI → Portainer-Webhook (oder *Pull and redeploy*).
- Worker: `docker compose pull && docker compose up -d` auf dem Whisper-Rechner.
- Rollback: `LS_TAG=sha-<commit>` setzen und neu deployen.

Schema-Änderungen laufen beim Start automatisch (`PRAGMA user_version`); vor
einem Update mit Migration das Volume sichern.
