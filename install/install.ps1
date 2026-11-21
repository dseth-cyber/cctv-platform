<#
CCTV Platform - first installation on Windows 10/11 or Windows Server with Docker Desktop (WSL 2).

  Open PowerShell in the CCTV Platform folder, then:
    powershell -ExecutionPolicy Bypass -File install\install.ps1

  Run it "as administrator" if you want it to add the Windows Firewall rules for you.

What it does: checks Docker Desktop, asks a few questions (LAN address, folders, admin password), writes
.env.production with new random secrets, makes a TLS certificate, builds, prepares the database, starts everything,
sets the admin password and switches off the sample accounts. Updates: install\update.ps1

Linux is the recommended server for many cameras or around-the-clock recording; Windows suits small sites and trials.
#>
param([switch]$Reconfigure)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$Root = (Get-Location).Path
$EnvFile = '.env.production'
$Dcp = @('compose', '--env-file', $EnvFile, '-f', 'docker-compose.yml', '-f', 'docker-compose.prod.yml')

function Step($t) { Write-Host "`n== $t ==" -ForegroundColor White }
function Ok($t)   { Write-Host "  ok    $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  WARN  $t" -ForegroundColor Yellow }
function Stop-Install($t) { Write-Host "`nSTOP  $t" -ForegroundColor Red; exit 1 }
function Ask($q, $d) { $a = Read-Host "  $q [$d]"; if ([string]::IsNullOrWhiteSpace($a)) { $d } else { $a.Trim() } }
function YesNo($q, $d) { $a = Read-Host "  $q [$(if ($d) {'Y/n'} else {'y/N'})]"; if ([string]::IsNullOrWhiteSpace($a)) { $d } else { $a -match '^[YyTt]' } }
function Secret { $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') }) }
# Windows PowerShell 5.1 (what install-windows.bat starts) turns anything a program writes to stderr into an error
# once it is redirected, and stops the script under 'Stop' (docker build writes its progress there); it also mangles
# quotes inside arguments. So programs whose output goes to a log or nowhere run through cmd.exe, which redirects
# plainly; the exit code is what counts.
function Run([string]$line) { & cmd /c $line | Out-Host; return $LASTEXITCODE }
$DcpLine = 'docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml'
function Invoke-DockerChecked { & docker @args; if ($LASTEXITCODE -ne 0) { throw "docker $($args -join ' ') failed ($LASTEXITCODE)" } }

# The settings file is read as KEY=VALUE lines; written back without a BOM and with LF line ends.
function Read-EnvLines { [IO.File]::ReadAllText((Join-Path $Root $EnvFile)) -split "`r?`n" }
function Write-EnvLines($lines) { [IO.File]::WriteAllText((Join-Path $Root $EnvFile), (($lines -join "`n").TrimEnd("`n") + "`n"), (New-Object Text.UTF8Encoding $false)) }
function Get-V($k) { $l = Read-EnvLines | Where-Object { $_ -like "$k=*" } | Select-Object -Last 1; if ($l) { $l.Substring($k.Length + 1) } else { '' } }
function Set-V($k, $v) {
  $lines = Read-EnvLines; $done = $false
  $lines = $lines | ForEach-Object { if ($_ -like "$k=*") { $done = $true; "$k=$v" } else { $_ } }
  if (-not $done) { $lines += "$k=$v" }
  Write-EnvLines $lines
}

# Docker Compose takes a variable from this Windows session before the settings file. A JWT_SECRET (or any other
# name in the file) set for another project on this PC would win and the API refuses to start (seen 2026-11-21).
# So every name in the settings file is cleared for this run only; nothing changes outside this window.
function Clear-SettingsFromSession {
  if (-not (Test-Path (Join-Path $Root $EnvFile))) { return }
  foreach ($l in (Read-EnvLines)) { if ($l -match '^([A-Z_][A-Z0-9_]*)=') { Remove-Item "Env:$($Matches[1])" -ErrorAction SilentlyContinue } }
}

# 1 the machine
Step '1/5 Checking this machine'
if (-not (Test-Path docker-compose.yml)) { Stop-Install 'Run this from the CCTV Platform folder (docker-compose.yml not found).' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Warn 'Docker Desktop is not installed.'
  if ((Get-Command winget -ErrorAction SilentlyContinue) -and (YesNo 'Install Docker Desktop now (winget, about 600 MB)?' $true)) {
    & winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
    Stop-Install 'Docker Desktop installed. Restart Windows, open Docker Desktop once (accept its terms, wait for "Engine running"), then double-click install-windows.bat again.'
  }
  Stop-Install 'Install Docker Desktop (https://www.docker.com/products/docker-desktop/, choose WSL 2), start it, then run this again.'
}
if ((Run 'docker info >nul 2>&1') -ne 0) { Stop-Install 'Docker Desktop is not running. Start it (whale icon in the tray says "running"), then run this again.' }
if ((Run 'docker compose version >nul 2>&1') -ne 0) { Stop-Install 'docker compose is missing; update Docker Desktop.' }
$os = (& docker info --format '{{.OSType}}'); if ($os -ne 'linux') { Stop-Install 'Docker Desktop is in Windows-containers mode. Right-click the tray icon > "Switch to Linux containers".' }
Ok "Docker $(& docker version --format '{{.Server.Version}}')"
# A clone with Windows line ends breaks the scripts that run inside the containers.
if ((Get-Content -Raw image-api\docker-entrypoint.sh) -match "`r") {
  Stop-Install 'Files have Windows line ends (git autocrlf). Clone again with:  git clone -c core.autocrlf=false <url>  or use the release .zip.'
}
Ok 'line ends are LF'
if ((& docker ps -a --format '{{.Names}}') -contains 'cctv-api' -and -not (Test-Path $EnvFile)) {
  Stop-Install "A CCTV Platform is already installed in Docker but this folder has no $EnvFile. Use the folder it was installed from."
}

# 2 questions
Step '2/5 Settings'
$fresh = (-not (Test-Path $EnvFile)) -or $Reconfigure
if (-not $fresh) {
  Ok "$EnvFile exists: keeping it (-Reconfigure to answer again; secrets are kept)"
} else {
  $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.InterfaceAlias -notmatch 'vEthernet|WSL|Docker|Loopback' } |
    Select-Object -ExpandProperty IPAddress
  Write-Host "  Addresses of this PC: $($ips -join ' ')"
  # The address of the network card with the default gateway is the LAN people use; else the first address.
  $gwIp = Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
    ForEach-Object { $_.IPv4Address.IPAddress } | Where-Object { $ips -contains $_ } | Select-Object -First 1
  $defIp = if ($gwIp) { $gwIp } else { $ips | Select-Object -First 1 }
  $lan = Ask 'LAN address people will open the system with' $defIp
  if ($lan -notmatch '^\d+\.\d+\.\d+\.\d+$') { Stop-Install "'$lan' is not an IPv4 address" }
  $drive = if (Test-Path 'D:\') { 'D:' } else { 'C:' }
  $rec = Ask 'Folder for recordings (a big disk)' "$drive\cctv\recordings"
  $bak = Ask 'Folder for database backups (another disk if you can)' "$drive\cctv\backup"
  $tz = Ask 'Time zone' 'Asia/Bangkok'
  $days = Ask 'Keep recordings for how many days' '30'
  if ($days -notmatch '^\d+$') { Stop-Install 'Days must be a number' }
  $ntp = YesNo 'Should DVR/NVRs take their clock from this PC (NTP)? Needs the Windows time service off UDP 123' $false
}

# 3 settings file, folders, certificate
Step '3/5 Settings file, folders and certificate'
if ($fresh) {
  if (-not (Test-Path $EnvFile)) { Copy-Item .env.production.example $EnvFile }
  # Only this Windows account (and SYSTEM/Administrators) may read the secrets.
  Run "icacls $EnvFile /inheritance:r /grant:r ""$($env:USERNAME):(R,W)"" /grant:r SYSTEM:(F) /grant:r Administrators:(F) >nul 2>&1" | Out-Null
  foreach ($k in 'POSTGRES_PASSWORD', 'JWT_SECRET', 'ENCRYPTION_KEY', 'SERVICE_API_KEY', 'MEDIA_WEBHOOK_SECRET') { if (-not (Get-V $k)) { Set-V $k (Secret) } }
  Set-V CCTV_ISOLATION_VERIFIED 'true'; Set-V LEGACY_LAN_PREFIX ''
  foreach ($k in 'WEB_LAN_ADDRESS', 'MEDIA_UDP_BIND', 'MEDIA_WEBRTC_HOST') { Set-V $k $lan }
  Set-V PUBLIC_BASE_URL "https://$lan"; Set-V CORS_ALLOWED_ORIGINS "https://$lan"
  if ($ntp) { Set-V NTP_BIND $lan; Set-V NTP_HOST_PORT '123'; Set-V NTP_ALLOW (($lan -replace '\.\d+$', '.0') + '/24') }
  else { Set-V NTP_BIND '127.0.0.1'; Set-V NTP_HOST_PORT '1123'; Set-V NTP_ALLOW '127.0.0.1/32' }
  Set-V RECORDINGS_HOST_DIR ($rec -replace '\\', '/'); Set-V BACKUP_HOST_DIR ($bak -replace '\\', '/')
  Set-V APP_TIME_ZONE $tz; Set-V RECORDING_RETENTION_DAYS $days
  Ok "$EnvFile written with new secrets. Keep a copy in your password safe (ENCRYPTION_KEY is needed to restore backups)."
}
foreach ($d in (Get-V RECORDINGS_HOST_DIR), (Get-V BACKUP_HOST_DIR)) { New-Item -ItemType Directory -Force -Path $d | Out-Null; Ok "folder $d" }

$ver = ''
if ((Get-Command git -ErrorAction SilentlyContinue) -and (Test-Path .git)) { $ver = (& cmd /c 'git describe --tags --exact-match 2>nul') }
if (-not $ver -and (Test-Path VERSION)) { $ver = (Get-Content VERSION -Raw).Trim() }
# The "Source code (zip)" of a GitHub release unpacks to cctv-platform-<version>.
if (-not $ver -and ((Split-Path -Leaf $Root) -match '^cctv-platform-v?(\d[\w.\-]*)$')) { $ver = $Matches[1] }
if (-not $ver) { Warn 'not a release (no git tag, no VERSION file); using "local"'; $ver = 'local' }
$ver = $ver -replace '^v', ''; Set-V CCTV_VERSION $ver; Ok "release $ver"

if (-not ((Test-Path ssl\server.crt) -and (Test-Path ssl\server.key))) {
  $ip = Get-V WEB_LAN_ADDRESS
  Invoke-DockerChecked run --rm -v "${Root}\ssl:/ssl" alpine:3.20 sh -c "apk add -q --no-cache openssl >/dev/null && openssl req -x509 -nodes -days 3650 -newkey rsa:2048 -keyout /ssl/server.key -out /ssl/server.crt -subj /CN=$ip -addext subjectAltName=IP:$ip,DNS:localhost 2>/dev/null"
  Ok "self-signed certificate for $ip (browsers warn once; put the company certificate in ssl\ later)"
} else { Ok 'TLS certificate present' }

# 4 check, build, database
Step '4/5 Check, build and database'
Clear-SettingsFromSession
& docker @Dcp config -q; if ($LASTEXITCODE -ne 0) { Stop-Install "The settings do not work with the compose files; run: docker $($Dcp -join ' ') config" }
Ok 'compose settings valid'
New-Item -ItemType Directory -Force -Path install\logs | Out-Null
$log = "install\logs\build-$(Get-Date -Format yyyyMMdd-HHmm).log"
Write-Host "  building the images (5-20 minutes the first time; log: $log)"
if ((Run "$DcpLine build image-api web-app > ""$log"" 2>&1") -ne 0) { Stop-Install "Build failed; see the end of $log" }
Ok 'images built'
Run "$DcpLine up -d postgres redis >> ""$log"" 2>&1" | Out-Null
for ($i = 0; $i -lt 60; $i++) { if ((Run 'docker exec cctv-postgres pg_isready -q >nul 2>&1') -eq 0) { break }; Start-Sleep 2 }
# The SQL goes in on stdin: no quotes inside the arguments.
$empty = "$('select to_regclass(''public.users'') is null' | & docker exec -i cctv-postgres sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -tA')".Trim()
if ($LASTEXITCODE -ne 0 -or ($empty -ne 't' -and $empty -ne 'f')) {
  Stop-Install "The database volume is from an earlier installation with other credentials (Docker volume cctv-platform_postgres-data). Keep it: put that installation's .env.production in this folder and run again. Not needed any more: docker $($Dcp -join ' ') down -v  (deletes that data), then run this again."
}
if ($empty -eq 't') {
  Write-Host '  new database: creating tables and starter data'
  $env:RUN_SEED = 'true'; $rc = Run "$DcpLine run --rm image-api-migrate >> ""$log"" 2>&1"; Remove-Item Env:RUN_SEED
} else {
  Remove-Item Env:RUN_SEED -ErrorAction SilentlyContinue; $rc = Run "$DcpLine run --rm image-api-migrate >> ""$log"" 2>&1"
}
if ($rc -ne 0) { Stop-Install "Database setup failed; see the end of $log" }
Ok 'database ready'

# 5 start
Step '5/5 Starting'
$rc = Run "$DcpLine up -d >> ""$log"" 2>&1"
if ($rc -ne 0) { Stop-Install "Starting failed; see $log. If it says 'cannot assign requested address', see README > Windows > troubleshooting." }
$s = ''
for ($i = 0; $i -lt 45; $i++) { $s = (& docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' cctv-api); if ($s -eq 'healthy') { break }; Start-Sleep 4 }
if ($s -ne 'healthy') { Stop-Install 'The API did not become healthy; see: docker logs cctv-api' }
Ok 'API healthy'

if ($empty -eq 't') {
  while ($true) {
    $p1 = Read-Host '  New password for admin (10+ characters, not a common word)' -AsSecureString
    $p2 = Read-Host '  Again' -AsSecureString
    $a = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p1))
    $b = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($p2))
    if ($a -eq $b -and $a.Length -ge 10) { break }; Write-Host '  They differ or are shorter than 10 characters; try again.'
  }
  $env:ADMIN_NEW_PASSWORD = $a
  & cmd /c "docker exec -i -e ADMIN_NEW_PASSWORD cctv-api node --input-type=module - < install\first-admin.mjs"
  $rc = $LASTEXITCODE; Remove-Item Env:ADMIN_NEW_PASSWORD
  if ($rc -ne 0) { Warn 'Could not set the admin password: sign in as admin / admin123 and change it at once' }
}

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($admin) {
  if (-not (Get-NetFirewallRule -DisplayName 'CCTV Platform web' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'CCTV Platform web' -Direction Inbound -Protocol TCP -LocalPort 80, 443 -Profile Domain, Private -Action Allow | Out-Null
    New-NetFirewallRule -DisplayName 'CCTV Platform live video' -Direction Inbound -Protocol UDP -LocalPort 8189 -Profile Domain, Private -Action Allow | Out-Null
    Ok 'Windows Firewall: 80/443 TCP and 8189 UDP allowed on Domain/Private networks'
  }
} else { Warn 'Not run as administrator: allow TCP 80, 443 and UDP 8189 in Windows Firewall yourself (README > Windows)' }

$ip = Get-V WEB_LAN_ADDRESS
Write-Host "`nCCTV Platform $ver is running." -ForegroundColor Green
Write-Host "  Open:      https://$ip   (accept the certificate warning once)"
Write-Host '  Sign in:   admin with the password you just set'
Write-Host '  Keep it running: Docker Desktop > Settings > General > "Start Docker Desktop when you sign in"'
Write-Host '  Update:    powershell -ExecutionPolicy Bypass -File install\update.ps1'
