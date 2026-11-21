<#
CCTV Platform - remove from Windows (Docker Desktop). Double-click uninstall-windows.bat, or:
  powershell -ExecutionPolicy Bypass -File install\uninstall.ps1

Two ways:
  1  Remove the program, keep the data: containers go, the database stays in Docker. Installing again brings
     everything back as it was.
  2  Remove everything: also the database (after a backup copy into the backup folder, with the settings file
     next to it, which is needed to read that backup), the firewall rules and the CCTV images.
Never touched: the recordings folder, the backup folder, and every other Docker project on this PC.
#>
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$Root = (Get-Location).Path
$EnvFile = '.env.production'
$Project = 'cctv-platform'
function Ok($t) { Write-Host "  ok    $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  WARN  $t" -ForegroundColor Yellow }
function Stop-Uninstall($t) { Write-Host "`nSTOP  $t" -ForegroundColor Red; exit 1 }
# Programs whose output goes nowhere run through cmd.exe (Windows PowerShell 5.1 turns redirected stderr into errors).
function Run([string]$line) { & cmd /c $line | Out-Host; return $LASTEXITCODE }
function Get-V($k) {
  if (-not (Test-Path $EnvFile)) { return '' }
  $l = [IO.File]::ReadAllText((Join-Path $Root $EnvFile)) -split "`r?`n" | Where-Object { $_ -like "$k=*" } | Select-Object -Last 1
  if ($l) { $l.Substring($k.Length + 1) } else { '' }
}

$rec = Get-V RECORDINGS_HOST_DIR
if ((Run 'docker info >nul 2>&1') -ne 0) { Stop-Uninstall 'Docker Desktop is not running. Start it, then run this again.' }
$containers = @(& docker ps -a -q --filter "label=com.docker.compose.project=$Project")
$volumes = @(& docker volume ls -q --filter "label=com.docker.compose.project=$Project")
Write-Host "`nCCTV Platform on this PC: $($containers.Count) container(s), $($volumes.Count) data volume(s)"
if ($containers.Count -eq 0 -and $volumes.Count -eq 0) { Ok 'nothing installed; you can install again'; exit 0 }

Write-Host @"

  1  Remove the program, KEEP the data (install again later and everything is back)
  2  Remove EVERYTHING, including the database (a backup copy is made first)
  0  Cancel
"@
$choice = Read-Host '  Choose 1, 2 or 0'
if ($choice -ne '1' -and $choice -ne '2') { Write-Host '  Cancelled; nothing changed.'; exit 0 }

if ($choice -eq '2') {
  Write-Host "`n  This deletes the database: cameras, users, alerts, incidents, work orders, settings." -ForegroundColor Yellow
  $confirm = Read-Host '  Type DELETE to go on'
  if ($confirm -cne 'DELETE') { Write-Host '  Cancelled; nothing changed.'; exit 0 }

  # Backup first, with the settings file beside it (its ENCRYPTION_KEY is needed to read recorder passwords back).
  $running = [bool](& docker ps -q --filter 'name=^cctv-postgres$' --filter status=running)
  if ($running) {
    $bak = Get-V BACKUP_HOST_DIR; if (-not $bak) { $bak = $Root }
    New-Item -ItemType Directory -Force -Path $bak | Out-Null
    $stamp = Get-Date -Format yyyy-MM-dd-HHmm
    $file = Join-Path $bak "cctv-$stamp-before-uninstall.dump"
    $rc = Run ('docker exec cctv-postgres sh -c "pg_dump -U $POSTGRES_USER -d $POSTGRES_DB -Fc" > "' + $file + '"')
    if ($rc -ne 0 -or -not (Test-Path $file) -or (Get-Item $file).Length -eq 0) { Stop-Uninstall 'The backup failed, so nothing was deleted. Run option 1, or fix Docker and try again.' }
    Ok "backup: $file"
    if (Test-Path $EnvFile) { Copy-Item $EnvFile (Join-Path $bak "cctv-$stamp-env.production") -Force; Ok "settings copied beside it (keep both together, and private)" }
  } else {
    Warn 'the database is not running, so no backup was made'
    $again = Read-Host '  Delete without a backup? Type DELETE again to go on'
    if ($again -cne 'DELETE') { Write-Host '  Cancelled; nothing changed.'; exit 0 }
  }
}

# Containers (and with option 2 the data volumes) of this one project, found by its name: works even without the
# settings file, and never reaches another project.
$flags = if ($choice -eq '2') { '-v' } else { '' }
if ((Run "docker compose -p $Project down $flags --remove-orphans") -ne 0) { Stop-Uninstall 'docker compose down failed; see the messages above.' }
Ok $(if ($choice -eq '2') { 'containers and data removed' } else { 'containers removed; the data stays' })

if ($choice -eq '2') {
  $images = @(& docker images --format '{{.Repository}}:{{.Tag}}' | Where-Object { $_ -like 'cctv-api:*' -or $_ -like 'cctv-web-app:*' -or $_ -like 'cctv-platform-*' })
  foreach ($i in $images) { Run "docker image rm $i >nul 2>&1" | Out-Null }
  if ($images.Count) { Ok "removed $($images.Count) CCTV image(s)" }
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($isAdmin) {
    Get-NetFirewallRule -DisplayName 'CCTV Platform*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Ok 'firewall rules removed'
  } else { Warn 'not run as administrator: remove the firewall rules "CCTV Platform web" and "CCTV Platform live video" yourself' }
  # The settings belong to the deleted database; the next install makes new ones.
  if (Test-Path $EnvFile) { Rename-Item $EnvFile ".env.production.removed-$(Get-Date -Format yyyyMMdd-HHmm)"; Ok 'settings file set aside (.env.production.removed-...)' }
}

Write-Host "`nDone." -ForegroundColor Green
if ($choice -eq '2') { Write-Host "  Kept: recordings ($rec) and the backup folder. Delete them yourself if they are not needed." }
Write-Host '  Install again: double-click install-windows.bat'
