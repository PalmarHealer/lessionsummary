# LessionSummary

Zusammenfassungen von Unterrichtseinheiten. Zu einer Einheit gehören
Aufnahmen, Dokumente (PDF, Word, PowerPoint, Excel, OpenDocument) und Bilder;
daraus entsteht eine Haupt-Zusammenfassung, die man privat halten, mit der
eigenen Schule oder mit allen LernSax-Nutzern teilen kann. Angemeldet wird
über [OpenSax](../opensax).

```
web/       SvelteKit-App: Einheiten, Upload, Aufnahme im Browser, Freigaben,
           Summary-API (REST + MCP), Job-Queue für die Worker
worker/    Python-Worker: WhisperX (large-v3) + pyannote-Sprechererkennung,
           Textextraktion aus Dokumenten. Holt sich Jobs selbst ab.
station/   Ein Lauf auf dem eigenen PC: Worker leert die Queue, danach
           schreibt Claude Code die fälligen Zusammenfassungen.
```

## Wie es zusammenhängt

```
 Browser ──upload──▶  web  ◀──claim/complete──  worker (GPU, pull)
                       │
                       ├── /mcp, /api/v1  ◀── Claude (geplante Aufgabe / Claude Code)
                       │
                       └── Login ──▶ OpenSax (/oauth/authorize, /oauth/userinfo)
```

- **Kein eingehender Zugriff auf den GPU-Rechner nötig.** Der Worker fragt
  die Web-App nach Arbeit (`POST /api/worker/claim`), lädt die Datei, schickt
  Transkript bzw. Text zurück. Er kann dauerhaft laufen oder mit `--drain`
  alles Offene abarbeiten und sich beenden.
- **Die Web-App schreibt selbst keine Zusammenfassungen.** Jede Einheit hat
  eine `material_rev`, die bei neuem Material steigt; ist sie größer als die
  Revision der Summary, ist die Einheit fällig. Claude holt sich fällige
  Einheiten über MCP, liest den Kontext und reicht die Summary mit der
  `material_rev` ein, auf der sie beruht. Kam inzwischen Neues dazu, lehnt der
  Server ab (`stale`) und die Einheit bleibt fällig.
- **Von Hand bearbeitete Summaries** gelten als aktuell und werden erst
  wieder angefasst, wenn neues Material dazukommt.

## Einrichten

### 1. OpenSax

OpenSax braucht den Branch `feat/oidc-light` (userinfo-Endpoint, Scopes
`openid profile school`, vertrauliche Clients). In dessen `.env`:

```env
OPENSAX_OAUTH_CLIENTS=[{"client_id":"lessionsummary","client_secret":"<geheim>","client_name":"LessionSummary","redirect_uris":["https://summary.example.com/auth/callback"],"scopes":["openid","profile","school"],"trusted":true}]
```

`trusted` überspringt den Zustimmungsdialog. LessionSummary sieht nur Name,
Schulen (LernSax-Gruppentyp 16) und Klassen (19) — keine Mails, Dateien oder
Zugangsdaten; der Token taugt nicht für den OpenSax-MCP.

### 2. Web-App

```bash
cp .env.example .env      # ORIGIN, OPENSAX_*, LS_WORKER_TOKEN setzen
docker compose up -d --build
```

Hinter einen TLS-Reverse-Proxy stellen (Port 3002). Uploads werden gestreamt;
das Limit setzt `LS_MAX_UPLOAD_MB` (Standard 2 GB) — der Proxy muss große
Bodies durchlassen (nginx: `client_max_body_size 2g;`).

Daten (SQLite + Dateien) liegen im Volume `lessionsummary-data`.

### 3. Worker

Siehe [`worker/README.md`](worker/README.md). Für eine RTX 3050 (6 GB):

```env
WHISPER_MODEL=large-v3
WHISPER_COMPUTE_TYPE=int8_float16
WHISPER_BATCH_SIZE=4
LOW_VRAM=1
```

### 4. Zusammenfassungen mit Claude

In LessionSummary unter **Einstellungen → API-Tokens** ein Token erstellen.
Dieselbe Seite zeigt die fertige Konfiguration für

- **Claude Desktop → Geplante Aufgaben** (MCP über `mcp-remote`, Anweisungstext zum Kopieren),
- **Claude Code** (`claude mcp add --transport http …`),

und [`station/`](station/README.md) enthält einen kompletten unbeaufsichtigten Lauf
(Worker `--drain`, danach `claude -p`) für die Windows-Aufgabenplanung oder cron.

Ein Nutzer-Token sieht nur die eigenen Einheiten. Soll eine einzige geplante
Aufgabe für alle Nutzer der Instanz zusammenfassen, `LS_ADMIN_TOKEN` setzen
und dieses Token verwenden.

## API

Alle Endpunkte mit `Authorization: Bearer <token>`.

| | |
|---|---|
| `POST /mcp` | MCP (Streamable HTTP, zustandslos). Tools: `list_pending_units`, `list_units`, `get_unit_context`, `get_file`, `submit_summary` |
| `GET /api/v1/units?summary=pending` | fällige Einheiten (ohne solche, deren Material noch verarbeitet wird) |
| `GET /api/v1/units?q=…` | suchen |
| `GET /api/v1/units/:id/context` | gesamtes Material als Markdown (`?format=json` mit Metadaten) |
| `GET /api/v1/files/:id/content` | Originaldatei |
| `PUT /api/v1/units/:id/summary` | `{"markdown": "…", "material_rev": 4}` → 409 `stale` / `manual` |

Worker (Token `LS_WORKER_TOKEN`): `POST /api/worker/claim`,
`GET /api/worker/files/:id`, `POST /api/worker/jobs/:id/{heartbeat,complete,fail}`.
Ein Job gehört dem Worker für 10 Minuten und wird per Heartbeat verlängert;
meldet sich der Worker nicht mehr (PC aus), holt ihn der nächste ab. Nach drei
Versuchen bleibt er fehlgeschlagen, bis man ihn in der Einheit neu anstößt.

## Freigaben

| Freigabe | Wer sieht die Zusammenfassung |
|---|---|
| Privat | nur die Autorin / der Autor |
| Meine Schule | alle, die laut OpenSax Mitglied derselben LernSax-Schule sind |
| Alle | jede Person mit LernSax-Konto (= jeder, der sich über OpenSax anmelden kann) |

Dateien und Transkripte bleiben dabei privat, außer „Auch Dateien und
Transkripte freigeben" ist gesetzt. Die Schulzugehörigkeit wird bei jeder
Anmeldung neu von OpenSax übernommen — wer die Schule wechselt, verliert beim
nächsten Login den Zugriff auf deren Freigaben.

## Entwickeln

```bash
cd web
pnpm install
echo "LS_DEV_LOGIN=1" > .env    # Login ohne OpenSax, nur im Dev-Build
pnpm dev
```

## Datenschutz

Unterrichtsaufnahmen enthalten die Stimmen von Lehrkräften und Mitschülern.
Vor dem Aufnehmen das Einverständnis aller einholen; die Schule hat dazu in der
Regel eigene Vorgaben. Wer die Instanz für andere betreibt, ist
datenschutzrechtlich Verantwortlicher (Impressum, Datenschutzerklärung, AV-Vertrag
mit dem Hoster). Die Transkription läuft auf eigener Hardware; Claude bekommt
über MCP Transkripte, Dokumenttexte und Bilder zu sehen.
