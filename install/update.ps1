<#
CCTV Platform - update on Windows (Docker Desktop). The running version keeps working until the new one is ready.
  powershell -ExecutionPolicy Bypass -File install\update.ps1            # git checkout: latest release tag
  powershell -ExecutionPolicy Bypass -File install\update.ps1 v1.0.0-rc14
  Downloaded package: unzip the new version into a new folder, copy .env.production and ssl\ from the old folder,
  then run this script in the new folder.
#>
param([string]$Tag = '')
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$Root = (Get-Location).Path
$EnvFile = '.env.production'
$Dcp = @('compose', '--env-file', $EnvFile, '-f', 'docker-compose.yml', '-f', 'docker-compose.prod.yml')
function Ok($t) { Write-Host "  ok    $t" -ForegroundColor Green }
function Stop-Update($t) { Write-Host "`nSTOP  $t" -ForegroundColor Red; exit 1 }
function Read-EnvLines { [IO.File]::ReadAllText((Join-Path $Root $EnvFile)) -split "`r?`n" }
function Get-V($k) { $l = Read-EnvLines | Where-Object { $_ -like "$k=*" } | Select-Object -Last 1; if ($l) { $l.Substring($k.Length + 1) } else { '' } }
function Set-V($k, $v) {
  $lines = Read-EnvLines | ForEach-Object { if ($_ -like "$k=*") { "$k=$v" } else { $_ } }
  [IO.File]::WriteAllText((Join-Path $Root $EnvFile), (($lines -join "`n").TrimEnd("`n") + "`n"), (New-Object Text.UTF8Encoding $false))
}

if (-not (Test-Path $EnvFile)) { Stop-Update "$EnvFile not found. First installation: install\install.ps1" }
& docker info *> $null; if ($LASTEXITCODE -ne 0) { Stop-Update 'Docker Desktop is not running' }
$old = Get-V CCTV_VERSION

Write-Host "`n== 1/5 Database backup =="
$bak = Get-V BACKUP_HOST_DIR; if (-not $bak) { $bak = '.' }
$file = Join-Path $bak "cctv-$(Get-Date -Format yyyy-MM-dd-HHmm)-before-update.dump"
& cmd /c "docker exec cctv-postgres sh -c ""pg_dump -U \""`$POSTGRES_USER\"" -d \""`$POSTGRES_DB\"" -Fc"" > ""$file"""
if ($LASTEXITCODE -ne 0 -or (Get-Item $file).Length -eq 0) { Stop-Update 'Backup failed; nothing was changed' }
Ok $file

Write-Host "`n== 2/5 Release =="
if ((Get-Command git -ErrorAction SilentlyContinue) -and (Test-Path .git)) {
  & git fetch -q --tags origin; if ($LASTEXITCODE -ne 0) { Stop-Update 'git fetch failed' }
  if (-not $Tag) { $Tag = (& git tag --list 'v*' --sort=-v:refname | Select-Object -First 1) }
  & git checkout -q $Tag; if ($LASTEXITCODE -ne 0) { Stop-Update "Cannot check out $Tag (local changes? see git status)" }
  $new = $Tag -replace '^v', ''
} elseif (Test-Path VERSION) { $new = (Get-Content VERSION -Raw).Trim() -replace '^v', '' }
elseif ((Split-Path -Leaf $Root) -match '^cctv-platform-v?(\d[\w.\-]*)$') { $new = $Matches[1] }
else { Stop-Update 'Not a git checkout and no VERSION file' }
Set-V CCTV_VERSION $new; Ok "$old -> $new"

Write-Host "`n== 3/5 Build =="
New-Item -ItemType Directory -Force -Path install\logs | Out-Null
$log = "install\logs\update-$(Get-Date -Format yyyyMMdd-HHmm).log"
& docker @Dcp config -q; if ($LASTEXITCODE -ne 0) { Stop-Update 'compose settings invalid (old version still running)' }
& docker @Dcp build image-api web-app *> $log; if ($LASTEXITCODE -ne 0) { Stop-Update "Build failed (old version still running); see $log" }
Ok 'images built'

Write-Host "`n== 4/5 Database changes =="
Remove-Item Env:RUN_SEED -ErrorAction SilentlyContinue
& docker @Dcp run --rm image-api-migrate *>> $log; if ($LASTEXITCODE -ne 0) { Stop-Update "Database changes failed; the old version is still running. See $log; backup: $file" }
Ok 'database up to date'

Write-Host "`n== 5/5 Start =="
& docker @Dcp up -d *>> $log; if ($LASTEXITCODE -ne 0) { Stop-Update "Start failed; see $log" }
$s = ''; for ($i = 0; $i -lt 45; $i++) { $s = (& docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' cctv-api); if ($s -eq 'healthy') { break }; Start-Sleep 4 }
if ($s -ne 'healthy') { Stop-Update "API not healthy (docker logs cctv-api). Roll back: CCTV_VERSION=$old in $EnvFile, then docker $($Dcp -join ' ') up -d" }
Ok "CCTV Platform $new is running (backup: $file)"
