#!/usr/bin/env bash
# Nightly batch on the home PC: transcribe/extract everything open, then let
# Claude Code write the summaries via the LessionSummary MCP server.
# Schedule with cron (see README).
set -uo pipefail
station="$(cd "$(dirname "$0")" && pwd)"
worker="$station/../worker"
mkdir -p "$station/logs"
log="$station/logs/run-$(date +%Y-%m-%d_%H%M).log"
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$log"; }

# .mcp.json references ${LS_URL} / ${LS_API_TOKEN}; Claude Code expands them
# from the environment. Already-exported variables win over the file.
if [ -f "$station/.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" == \#* || "$line" != *=* ]] && continue
    key="${line%%=*}"; key="${key// /}"; val="${line#*=}"
    val="${val%\"}"; val="${val#\"}"; val="${val%\'}"; val="${val#\'}"
    [ -z "${!key:-}" ] && export "$key=$val"
  done < "$station/.env"
fi
if [ -z "${LS_URL:-}" ] || [ -z "${LS_API_TOKEN:-}" ]; then say "LS_URL / LS_API_TOKEN missing (station/.env)"; exit 2; fi
export LS_URL="${LS_URL%/}"

python="$worker/.venv/bin/python"
[ -x "$python" ] || python="$(command -v python3 || command -v python)"

say "== 1/2 Worker (drain) =="
(cd "$worker" && "$python" -m lessionsummary_worker --drain) 2>&1 | tee -a "$log"
worker_exit=${PIPESTATUS[0]}
say "worker exit code $worker_exit"
# 2 = token rejected: summaries would be built on stale material, so stop.
if [ "$worker_exit" -eq 2 ]; then say "aborting: worker could not authenticate"; exit 2; fi

say "== 2/2 Claude summaries =="
cd "$station"
prompt="Arbeite alle offenen Einheiten gemäß CLAUDE.md ab: list_pending_units, für jede Einheit Kontext lesen, Summary schreiben, submit_summary. Am Ende kurze Liste erledigt/übersprungen."
# --mcp-config instead of relying on the project .mcp.json: project servers
# need a one-time interactive approval that a scheduled run cannot give.
claude -p "$prompt" --mcp-config .mcp.json --strict-mcp-config \
  --allowedTools "mcp__lessionsummary" \
  2>&1 | tee -a "$log"
claude_exit=${PIPESTATUS[0]}
say "claude exit code $claude_exit"

[ "$claude_exit" -ne 0 ] && exit "$claude_exit"
exit "$worker_exit"
