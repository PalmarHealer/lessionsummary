# Nightly batch on the home PC: transcribe/extract everything open, then let
# Claude Code write the summaries via the LessionSummary MCP server.
# Schedule with Task Scheduler (see README).
$ErrorActionPreference = "Continue"
$station = $PSScriptRoot
$worker = Join-Path (Split-Path $station -Parent) "worker"
$logs = Join-Path $station "logs"
New-Item -ItemType Directory -Force $logs | Out-Null
$log = Join-Path $logs ("run-{0}.log" -f (Get-Date -Format "yyyy-MM-dd_HHmm"))

function Write-Log($msg) { "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg | Tee-Object -FilePath $log -Append }

# .mcp.json references ${LS_URL} / ${LS_API_TOKEN}; Claude Code expands them
# from the process environment, so station/.env has to end up there.
$envFile = Join-Path $station ".env"
if (Test-Path $envFile) {
  foreach ($line in Get-Content $envFile -Encoding UTF8) {
    $t = $line.Trim()
    if ($t -eq "" -or $t.StartsWith("#") -or -not $t.Contains("=")) { continue }
    $i = $t.IndexOf("=")
    $k = $t.Substring(0, $i).Trim()
    $v = $t.Substring($i + 1).Trim().Trim('"').Trim("'")
    if (-not [Environment]::GetEnvironmentVariable($k)) { [Environment]::SetEnvironmentVariable($k, $v) }
  }
}
if (-not $env:LS_URL -or -not $env:LS_API_TOKEN) { Write-Log "LS_URL / LS_API_TOKEN missing (station/.env)"; exit 2 }
$env:LS_URL = $env:LS_URL.TrimEnd("/")

# Prefer the worker's venv; fall back to whatever python is on PATH.
$python = Join-Path $worker ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) { $python = "python" }

Write-Log "== 1/2 Worker (drain) =="
Push-Location $worker
# Stderr lines become ErrorRecords in PowerShell 5.1; stringify them so the
# log reads like plain text.
& $python -m lessionsummary_worker --drain 2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath $log -Append
$workerExit = $LASTEXITCODE
Pop-Location
Write-Log "worker exit code $workerExit"
# 2 = token rejected: summaries would be built on stale material, so stop.
# 1 = some jobs failed: the others are still worth summarising.
if ($workerExit -eq 2) { Write-Log "aborting: worker could not authenticate"; exit 2 }

Write-Log "== 2/2 Claude summaries =="
Set-Location $station
$prompt = "Arbeite alle offenen Einheiten gemaess CLAUDE.md ab: list_pending_units, fuer jede Einheit Kontext lesen, Summary schreiben, submit_summary. Am Ende kurze Liste erledigt/uebersprungen."
# --mcp-config instead of relying on the project .mcp.json: project servers
# need a one-time interactive approval that a scheduled run cannot give.
& claude -p $prompt --mcp-config .mcp.json --strict-mcp-config `
  --allowedTools "mcp__lessionsummary" `
  2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath $log -Append
$claudeExit = $LASTEXITCODE
Write-Log "claude exit code $claudeExit"

if ($claudeExit -ne 0) { exit $claudeExit }
exit $workerExit
