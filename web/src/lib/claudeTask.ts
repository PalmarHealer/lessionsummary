/**
 * Instructions for the scheduled Claude task that writes the summaries.
 * Shown in Settings for copy & paste; station/CLAUDE.md carries the same rules
 * for the headless Claude Code run.
 */
export const CLAUDE_TASK_PROMPT = `Schreibe die fehlenden Zusammenfassungen in LessionSummary über den MCP-Server „lessionsummary".

1. list_pending_units aufrufen.
2. Für jede Einheit: get_unit_context vollständig lesen, Bilder (Tafelbilder, Folienfotos) mit get_file ansehen, dann submit_summary mit der material_rev aus dem Kontext. Bei „stale" den Kontext neu laden und neu schreiben, bei „manual" überspringen.
3. Am Ende kurz auflisten: erledigt / übersprungen (mit Grund).

Zusammenfassung auf Deutsch in Markdown, für Schüler, die die Stunde verpasst haben:
## Überblick (2–3 Sätze, worauf die Zusammenfassung beruht), ## Kernaussagen (Stichpunkte), ## Zusammenfassung (### je Thema, in der Reihenfolge der Stunde, mit Beispielen und Rechenwegen aus dem Material), ## Wichtige Begriffe, ## Aufgaben & Termine, ## Offene Fragen – die letzten drei nur, wenn es Inhalt dafür gibt.

Regeln: Nichts erfinden; Ergänzungen aus eigenem Wissen als „*Ergänzung:*" kennzeichnen. Sprecher, die nicht benannt sind, aus dem Inhalt als „Lehrkraft" bzw. „Schüler/in" zuordnen, keine Schülernamen nennen. Prüfungsrelevante Hinweise der Lehrkraft hervorheben. Offensichtliche Hörfehler der Transkription anhand von Folien und Dokumenten korrigieren. Small Talk weglassen. Formeln als LaTeX ($…$ bzw. $$…$$).`;
