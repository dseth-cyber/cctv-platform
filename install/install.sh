#!/usr/bin/env bash
# CCTV Platform — first installation on Linux (Ubuntu/Debian with Docker Engine).
#
#   cd cctv-platform && bash install/install.sh            # asks a few questions
#   bash install/install.sh --yes                          # no questions: values from the environment (see below)
#
# What it does, in order (it stops at the first problem and says what to do):
#   1  checks the machine (Docker, Compose, disk, the folder it runs from)
#   2  asks: the server's LAN address, recording and backup folders, time zone, NTP for recorders, admin password
#   3  writes .env.production (mode 600) with new random secrets; makes a TLS certificate if there is none
#   4  runs the preflight check, builds the images, prepares the database (first time: with starter data)
#   5  starts everything, sets the admin password, switches off the sample accounts, prints the address
#
# Run again later: it keeps .env.production and the database; to change answers, edit .env.production or use
# --reconfigure (secrets are kept). Updates: bash install/update.sh
#
# --yes reads: CCTV_LAN_IP, CCTV_RECORDINGS_DIR, CCTV_BACKUP_DIR, CCTV_TZ, CCTV_NTP (yes|no), CCTV_NTP_ALLOW,
#              CCTV_RETENTION_DAYS, CCTV_ADMIN_PASSWORD (empty = make one and print it once)
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
ENV_FILE=.env.production
YES=0; RECONFIGURE=0
for a in "$@"; do
  case "$a" in
    --yes|-y) YES=1 ;;
    --reconfigure) RECONFIGURE=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown option: $a (use --help)"; exit 2 ;;
  esac
done

c_ok=$'\e[32m'; c_warn=$'\e[33m'; c_err=$'\e[31m'; c_b=$'\e[1m'; c_0=$'\e[0m'
step() { printf '\n%s== %s ==%s\n' "$c_b" "$1" "$c_0"; }
ok()   { printf '  %sok%s    %s\n' "$c_ok" "$c_0" "$1"; }
warn() { printf '  %sWARN%s  %s\n' "$c_warn" "$c_0" "$1"; }
die()  { printf '\n%sSTOP%s  %s\n' "$c_err" "$c_0" "$1"; exit 1; }
ask()  { # ask VAR "question" "default"
  local __v=$1 q=$2 d=${3:-} a
  if [ "$YES" = 1 ]; then printf -v "$__v" '%s' "$d"; return; fi
  read -r -p "  $q${d:+ [$d]}: " a || true
  printf -v "$__v" '%s' "${a:-$d}"
}
yesno() { # yesno "question" default(y|n) -> 0 for yes
  local q=$1 d=${2:-n} a
  if [ "$YES" = 1 ]; then [ "$d" = y ]; return; fi
  read -r -p "  $q [$([ "$d" = y ] && echo Y/n || echo y/N)]: " a || true
  a=${a:-$d}; [[ "$a" =~ ^[YyTt] ]]
}
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
DCP=(docker compose --env-file "$ENV_FILE" -f docker-compose.yml -f docker-compose.prod.yml)

# Set KEY=VALUE in the env file (replaces the line, or adds it). Values are taken literally.
setv() {
  local k=$1 v=$2 tmp
  tmp=$(mktemp)
  K="$k" V="$v" awk 'BEGIN{k=ENVIRON["K"]; v=ENVIRON["V"]; done=0}
    $0 ~ "^"k"=" { print k"="v; done=1; next } { print }
    END { if (!done) print k"="v }' "$ENV_FILE" > "$tmp"
  cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"
}
getv() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1; }
secret() { if command -v openssl >/dev/null; then openssl rand -hex 32; else head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; fi; }

# ── 1 the machine ─────────────────────────────────────────────────────────────
step "1/5 Checking this machine"
[ -f docker-compose.yml ] && [ -f docker-compose.prod.yml ] || die "Run this from the CCTV Platform folder (docker-compose.yml not found)."
command -v docker >/dev/null || {
  warn "Docker is not installed."
  if yesno "Install Docker Engine now with the official script (get.docker.com)?" n; then
    curl -fsSL https://get.docker.com | $SUDO sh
    $SUDO usermod -aG docker "$(id -un)" || true
    echo "  Docker installed. Log out and in again (so your user can use docker), then run this installer again."
    exit 0
  fi
  die "Install Docker Engine first: https://docs.docker.com/engine/install/"
}
docker info >/dev/null 2>&1 || die "Docker is installed but this user cannot use it. Run: sudo usermod -aG docker $(id -un)  then log out and in again (or run the installer with sudo)."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is missing (the 'docker compose' command). Install the docker-compose-plugin package."
ok "Docker $(docker version --format '{{.Server.Version}}'), $(docker compose version --short 2>/dev/null || echo compose)"
FREE_GB=$(df -Pk . | awk 'NR==2 {print int($4/1024/1024)}')
[ "${FREE_GB:-0}" -ge 15 ] && ok "free space here: ${FREE_GB} GB" || warn "only ${FREE_GB} GB free here; the images need about 10 GB"
if docker ps -a --format '{{.Names}}' | grep -qx cctv-api && [ ! -f "$ENV_FILE" ]; then
  die "A CCTV Platform is already running on this machine (container cctv-api) but this folder has no $ENV_FILE. Use the folder it was installed from, or bash install/update.sh there."
fi

# Docker's own networks must not land on the camera LAN (192.168.x). Our network is fixed (10.250.0.0/24);
# other Docker networks take addresses from daemon.json, so that should be a 10.x range too.
if [ ! -f /etc/docker/daemon.json ]; then
  warn "/etc/docker/daemon.json does not exist: new Docker networks may get 192.168.x addresses and clash with camera LANs"
  if yesno "Create it with 10.x ranges (bip 10.199.0.1/24, pools 10.200.0.0/16) and restart Docker?" y; then
    printf '{\n  "bip": "10.199.0.1/24",\n  "default-address-pools": [{ "base": "10.200.0.0/16", "size": 24 }]\n}\n' | $SUDO tee /etc/docker/daemon.json >/dev/null
    $SUDO systemctl restart docker && ok "daemon.json written, Docker restarted"
  fi
elif ! grep -q default-address-pools /etc/docker/daemon.json; then
  warn "/etc/docker/daemon.json has no default-address-pools; add a 10.x pool if your cameras are on 192.168.x (see README)"
else ok "Docker address pools set in daemon.json"; fi

# ── 2 questions ───────────────────────────────────────────────────────────────
step "2/5 Settings"
FRESH_ENV=1
if [ -f "$ENV_FILE" ] && [ "$RECONFIGURE" = 0 ]; then
  FRESH_ENV=0
  ok "$ENV_FILE exists: keeping it (use --reconfigure to answer the questions again; secrets are always kept)"
else
  IPS=$(ip -o -4 addr show scope global 2>/dev/null | awk '{split($4,a,"/"); print a[1]}' | grep -v '^172\.\(1[7-9]\|2[0-9]\|3[01]\)\.' | grep -v '^10\.\(199\|200\|250\)\.' || true)
  # The address on the way to the default gateway is the LAN people use; `ip route get` only looks the route up,
  # it sends nothing. With no gateway (isolated LAN), the first address.
  GW_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") { print $(i + 1); exit }}')
  if [ -n "$GW_IP" ] && printf '%s\n' "$IPS" | grep -qx "$GW_IP"; then DEF_IP=$GW_IP; else DEF_IP=$(printf '%s\n' "$IPS" | head -n1); fi
  echo "  Addresses of this machine: $(printf '%s ' $IPS)"
  ask LAN_IP "LAN address people will open the system with" "${CCTV_LAN_IP:-$DEF_IP}"
  [[ "$LAN_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "'$LAN_IP' is not an IPv4 address"
  printf '%s\n' "$IPS" | grep -qx "$LAN_IP" || warn "$LAN_IP is not an address of this machine right now"
  ask REC_DIR "Folder for recordings (a big disk; not inside this folder)" "${CCTV_RECORDINGS_DIR:-/srv/cctv/recordings}"
  ask BAK_DIR "Folder for database backups (another disk if you can)" "${CCTV_BACKUP_DIR:-/srv/cctv-data/backup}"
  case "$REC_DIR$BAK_DIR" in *" "*) die "Folder names must not contain spaces";; esac
  case "$REC_DIR" in /*) ;; *) die "Recordings folder must be an absolute path";; esac
  case "$BAK_DIR" in /*) ;; *) die "Backup folder must be an absolute path";; esac
  ask TZ_NAME "Time zone" "${CCTV_TZ:-Asia/Bangkok}"
  ask KEEP_DAYS "Keep recordings for how many days" "${CCTV_RETENTION_DAYS:-30}"
  [[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] || die "Days must be a number"
  NTP_ON=n; [ "${CCTV_NTP:-no}" = yes ] && NTP_ON=y
  if yesno "Should DVR/NVRs take their clock from this server (NTP on UDP 123)?" "$NTP_ON"; then
    DEF_NET=$(echo "$LAN_IP" | awk -F. '{print $1"."$2"."$3".0/24"}')
    ask NTP_ALLOW "Camera network(s) allowed to ask for time (comma separated)" "${CCTV_NTP_ALLOW:-$DEF_NET}"
    NTP_BIND=$LAN_IP
  else NTP_BIND=127.0.0.1; NTP_ALLOW=127.0.0.1/32; fi
fi

# ── 3 settings file, folders, certificate ──────────────────────────────────────
step "3/5 Settings file, folders and certificate"
if [ "$FRESH_ENV" = 1 ]; then
  umask 077
  if [ ! -f "$ENV_FILE" ]; then cp .env.production.example "$ENV_FILE"; fi
  chmod 600 "$ENV_FILE"
  for k in POSTGRES_PASSWORD JWT_SECRET ENCRYPTION_KEY SERVICE_API_KEY MEDIA_WEBHOOK_SECRET; do
    [ -n "$(getv "$k")" ] || setv "$k" "$(secret)"
  done
  setv CCTV_ISOLATION_VERIFIED true    # the check is about one company's old system; nothing to isolate from here
  setv LEGACY_LAN_PREFIX ""            # no address range is off-limits on this site
  setv WEB_LAN_ADDRESS "$LAN_IP"; setv MEDIA_UDP_BIND "$LAN_IP"; setv MEDIA_WEBRTC_HOST "$LAN_IP"
  setv PUBLIC_BASE_URL "https://$LAN_IP"; setv CORS_ALLOWED_ORIGINS "https://$LAN_IP"
  setv NTP_BIND "$NTP_BIND"; setv NTP_ALLOW "$NTP_ALLOW"
  setv RECORDINGS_HOST_DIR "$REC_DIR"; setv BACKUP_HOST_DIR "$BAK_DIR"
  setv APP_TIME_ZONE "$TZ_NAME"; setv RECORDING_RETENTION_DAYS "$KEEP_DAYS"
  umask 022
  ok "$ENV_FILE written (mode 600, new secrets). Keep a copy in your password safe: without ENCRYPTION_KEY a restored backup cannot read recorder passwords."
fi
REC_DIR=$(getv RECORDINGS_HOST_DIR); BAK_DIR=$(getv BACKUP_HOST_DIR)
ADMIN_GROUP=$(id -gn)
$SUDO mkdir -p "$REC_DIR" "$BAK_DIR"
$SUDO chown 1001:1001 "$REC_DIR" && ok "recordings: $REC_DIR (owner uid 1001, the video service)"
$SUDO chown "1001:$ADMIN_GROUP" "$BAK_DIR" && $SUDO chmod 2770 "$BAK_DIR" && ok "backups: $BAK_DIR (uid 1001 + group $ADMIN_GROUP)"
chmod 644 mediamtx/mediamtx.yml 2>/dev/null || true

# The release: the git tag of this checkout, or VERSION in a downloaded package.
VER=""
if git rev-parse --git-dir >/dev/null 2>&1; then
  VER=$(git describe --tags --exact-match 2>/dev/null || true)
  if [ -z "$VER" ]; then
    LATEST=$(git tag --list 'v*' --sort=-v:refname | head -n1)
    warn "this checkout is not a release tag (installs use a tagged release)"
    if [ -n "$LATEST" ] && yesno "Switch to the latest release $LATEST?" y; then git checkout -q "$LATEST"; VER=$LATEST
    else die "git checkout <release tag>, then run again"; fi
  fi
elif [ -f VERSION ]; then VER=$(tr -d ' \r\n' < VERSION)
else
  # The "Source code" archive of a GitHub release unpacks to cctv-platform-<version>.
  case "$(basename "$ROOT")" in cctv-platform-[0-9]*|cctv-platform-v[0-9]*) VER=${ROOT##*/cctv-platform-} ;; esac
fi
VER=${VER#v}; [ -n "$VER" ] || VER=local
setv CCTV_VERSION "$VER"; ok "release $VER"

if [ ! -f ssl/server.crt ] || [ ! -f ssl/server.key ]; then
  LAN_IP=$(getv WEB_LAN_ADDRESS)
  if command -v openssl >/dev/null; then bash ssl/generate-cert.sh "$LAN_IP" >/dev/null
  else docker run --rm -v "$ROOT/ssl:/ssl" alpine:3.20 sh -c "apk add -q --no-cache openssl bash >/dev/null && bash /ssl/generate-cert.sh $LAN_IP" >/dev/null; fi
  ok "self-signed certificate for $LAN_IP made (browsers warn once; put the company certificate in ssl/ later)"
else ok "TLS certificate present"; fi

# Starting at boot before the LAN address is up: allow binding an address that is not there yet.
if [ "$(cat /proc/sys/net/ipv4/ip_nonlocal_bind 2>/dev/null)" != 1 ]; then
  if yesno "Allow services to start at boot before the network is up (sysctl ip_nonlocal_bind=1)?" y; then
    echo 'net.ipv4.ip_nonlocal_bind = 1' | $SUDO tee /etc/sysctl.d/60-cctv-nonlocal-bind.conf >/dev/null
    $SUDO sysctl -q -p /etc/sysctl.d/60-cctv-nonlocal-bind.conf && ok "ip_nonlocal_bind=1"
  fi
fi

# ── 4 check, build, database ──────────────────────────────────────────────────
step "4/5 Check, build and database"
sh scripts/prod-preflight.sh "$ENV_FILE" | sed 's/^/  /' || die "The preflight check found problems (FAIL lines above). Fix them and run again."
mkdir -p install/logs
LOG=install/logs/build-$(date +%Y%m%d-%H%M).log
echo "  building the images (5–15 minutes the first time; log: $LOG)"
"${DCP[@]}" build image-api web-app >"$LOG" 2>&1 || die "Build failed; see the end of $LOG"
ok "images built"
"${DCP[@]}" up -d postgres redis >/dev/null 2>&1
for i in $(seq 1 60); do docker exec cctv-postgres pg_isready -q >/dev/null 2>&1 && break; sleep 2; done
EMPTY=$(docker exec cctv-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select to_regclass('"'"'public.users'"'"') is null"' 2>/dev/null | tr -d ' \r\n' || true)
case "$EMPTY" in t|f) ;; *) die "The database volume is from an earlier installation with other credentials (Docker volume cctv-platform_postgres-data). Keep it: put that installation's .env.production here and run again. Not needed any more: ${DCP[*]} down -v  (deletes that data), then run again." ;; esac
if [ "$EMPTY" = t ]; then
  echo "  new database: creating tables and starter data (roles, lists, admin account)"
  RUN_SEED=true "${DCP[@]}" run --rm image-api-migrate >>"$LOG" 2>&1 || die "Database setup failed; see the end of $LOG"
else
  env -u RUN_SEED "${DCP[@]}" run --rm image-api-migrate >>"$LOG" 2>&1 || die "Database update failed; nothing was started. See the end of $LOG"
fi
ok "database ready"

# ── 5 start ───────────────────────────────────────────────────────────────────
step "5/5 Starting"
"${DCP[@]}" up -d >>"$LOG" 2>&1 || die "Starting failed; see the end of $LOG"
for i in $(seq 1 45); do
  s=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' cctv-api 2>/dev/null || true)
  [ "$s" = healthy ] && break; sleep 4
done
[ "$s" = healthy ] && ok "API healthy" || die "The API did not become healthy; see: docker logs cctv-api"

if [ "$EMPTY" = t ]; then
  PW=${CCTV_ADMIN_PASSWORD:-}
  if [ -z "$PW" ] && [ "$YES" = 0 ]; then
    while :; do
      read -r -s -p "  New password for 'admin' (10+ characters, not a common word): " PW; echo
      read -r -s -p "  Again: " PW2; echo
      [ "$PW" = "$PW2" ] && [ ${#PW} -ge 10 ] && break; echo "  They differ or are shorter than 10 characters; try again."
    done
  fi
  SHOW=0; if [ -z "$PW" ]; then PW=$(secret | cut -c1-20); SHOW=1; fi
  docker exec -i -e ADMIN_NEW_PASSWORD="$PW" cctv-api node --input-type=module - < install/first-admin.mjs | sed 's/^/  /' \
    || die "Could not set the admin password; sign in as admin / admin123 and change it at once"
  [ "$SHOW" = 1 ] && printf '  %sadmin password (shown once, store it now): %s%s\n' "$c_b" "$PW" "$c_0"
fi

if command -v ufw >/dev/null && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
  warn "ufw is on: allow 80,443/tcp and 8189/udp (and 123/udp for NTP) from your LAN, e.g. sudo ufw allow from <LAN>/24 to any port 443 proto tcp"
fi

LAN_IP=$(getv WEB_LAN_ADDRESS)
printf '\n%sCCTV Platform %s is running.%s\n' "$c_ok" "$VER" "$c_0"
cat <<EOF
  Open:        https://$LAN_IP   (accept the certificate warning once, or install the company certificate)
  Sign in:     admin  with the password you just set
  Next:        Devices → Add recorder (DVR/NVR), then Live view. Settings → Telegram for alerts.
  Update:      bash install/update.sh
  Settings:    $ENV_FILE  (keep a copy in your password safe)
EOF
