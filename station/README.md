# Summary-Station

Der Nachtlauf auf dem Heim-PC, in zwei Schritten:

1. **Worker im Drain-Modus** (`../worker`): transkribiert und extrahiert alles,
   was offen ist, und beendet sich.
2. **Claude Code headless** in diesem Ordner: liest `CLAUDE.md`, holt über den
   MCP-Server der Web-App (`{LS_URL}/mcp`) alle Einheiten mit fehlender oder
   veralteter Summary, schreibt die Summaries und lädt sie hoch.

Claude darf dabei nur die Tools des `lessionsummary`-MCP-Servers benutzen —
keine Shell, kein Dateisystem.

## Einrichtung

1. Worker einrichten (siehe `../worker/README.md`).
2. Claude Code installieren und einmal interaktiv anmelden (`claude`).
3. `.env.example` → `.env`, `LS_URL` und `LS_API_TOKEN` eintragen.
   Die Skripte laden `.env` in die Umgebung; `.mcp.json` liest daraus
   `${LS_URL}` und `${LS_API_TOKEN}`.
4. Testen:
   ```powershell
   .\run.ps1
   ```
   Linux: `./run.sh`

Logs liegen unter `logs/run-<Datum>.log`.

## Zeitplan

**Windows (Aufgabenplanung)**, z. B. täglich um 02:00. Im Ordner `station` ausführen:

```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$PWD\run.ps1`"" -WorkingDirectory $PWD
$trigger = New-ScheduledTaskTrigger -Daily -At 2am
$settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 6)
Register-ScheduledTask -TaskName "LessionSummary" -Action $action -Trigger $trigger -Settings $settings
```

`-WakeToRun` weckt den PC aus dem Standby. Dafür müssen in den Energieoptionen
Reaktivierungszeitgeber erlaubt sein. `-StartWhenAvailable` holt einen
verpassten Lauf nach, wenn der PC um 02:00 aus war. Die Aufgabe läuft als
angemeldeter Benutzer, damit Claude Code dessen Login findet.

**Linux (cron)**:

```cron
0 2 * * * /pfad/zu/LessionSummary/station/run.sh >/dev/null 2>&1
```

## Exit-Codes

| Code | Bedeutung |
|---|---|
| 0 | alles erledigt |
| 1 | mindestens ein Worker-Job ist fehlgeschlagen (Summaries wurden trotzdem geschrieben) |
| 2 | `.env` unvollständig oder Worker-Token abgelehnt, Lauf abgebrochen |
| sonst | Exit-Code von `claude` |

## Claude Desktop – Geplante Aufgaben

Statt Claude Code kann auch Claude Desktop die Summaries schreiben. Die
Transkription übernimmt weiterhin der Worker (Dauerbetrieb oder eigene
geplante Aufgabe mit `--drain`).

**1. MCP-Server eintragen** in `claude_desktop_config.json`
(Windows: `%APPDATA%\Claude\claude_desktop_config.json`,
macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "lessionsummary": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote", "https://summary.example.com/mcp",
        "--header", "Authorization:${AUTH_HEADER}"
      ],
      "env": { "AUTH_HEADER": "Bearer <dein API-Token>" }
    }
  }
}
```

Das Leerzeichen zwischen `Bearer` und Token steht bewusst im `env`-Block und
nicht im Argument: Auf Windows zerlegt `npx` Argumente mit Leerzeichen.
LessionSummary zeigt diese Konfiguration unter **Einstellungen** fertig
ausgefüllt an. Danach Claude Desktop neu starten.

**2. Geplante Aufgabe anlegen:** Häufigkeit *täglich* (z. B. 03:00, nach dem
Worker-Lauf), Berechtigungen *automatisch genehmigen*. Als Anweisungen:

```text
Schreibe die fehlenden Main Summaries in LessionSummary über den MCP-Server „lessionsummary".

1. list_pending_units aufrufen. Einheiten mit processing_jobs > 0 überspringen.
2. Für jede übrige Einheit: get_unit_context vollständig lesen, Bilder mit get_file ansehen (andere Dateien nur, wenn ihr Text fehlt oder dünn ist), dann submit_summary mit der material_rev aus Schritt 1. Bei einem Konflikt überspringen, bei anderen Fehlern einmal wiederholen.
3. Am Ende kurz auflisten: erledigt / übersprungen (mit Grund).

Summary auf Deutsch in Markdown, für Schüler, die die Stunde verpasst haben:
## Überblick (2–3 Sätze), ## Kernaussagen (Stichpunkte), ## Zusammenfassung (### je Thema, in der Reihenfolge der Stunde, mit Beispielen/Rechenwegen aus dem Material), ## Wichtige Begriffe, ## Aufgaben & Termine, ## Offene Fragen. Die letzten drei nur, wenn es Inhalt dafür gibt.

Regeln: Nichts erfinden, Ergänzungen aus eigenem Wissen als „*Ergänzung:*" kennzeichnen. SPEAKER_xx aus dem Inhalt als „Lehrkraft" bzw. „Schüler" zuordnen, keine Schülernamen nennen. Prüfungsrelevante Hinweise der Lehrkraft hervorheben. Offensichtliche Whisper-Hörfehler anhand der Folien/Dokumente korrigieren. Small Talk weglassen. Formeln in LaTeX ($…$). Typisch 300–900 Wörter pro 45 Minuten, bei wenig Material entsprechend kürzer, und im Überblick sagen, worauf die Summary beruht.
```
