#!/bin/sh
# Checks the production server is ready BEFORE `docker compose up`. Read only: it changes nothing.
#   sh scripts/prod-preflight.sh [.env.production]
# Exit 0 = ready; 1 = at least one FAIL. It never prints a secret value, only the variable's name.
# Runbook: docs/ops/DEPLOY_PRODUCTION.md

ENV_FILE="${1:-.env.production}"
FAILS=0
WARNS=0
ok()   { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }
warn() { printf '  WARN  %s\n' "$1"; WARNS=$((WARNS + 1)); }

# Read KEY's value from the env file without running the file (it is data, not a script).
val() { sed -n "s/^[[:space:]]*$1=//p" "$ENV_FILE" | tail -n 1 | sed 's/^"\(.*\)"$/\1/; s/^'"'"'\(.*\)'"'"'$/\1/'; }

cd "$(dirname "$0")/.." || exit 1
echo "CCTV production preflight ($(date '+%Y-%m-%d %H:%M'), $(hostname))"

echo "[1] settings file"
if [ ! -f "$ENV_FILE" ]; then fail "$ENV_FILE not found (copy .env.production.example and fill it)"; echo "1+ FAIL"; exit 1; fi
ok "$ENV_FILE found"
PERM=$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo "")
case "$PERM" in 600|400) ok "$ENV_FILE readable by its owner only ($PERM)";; "") warn "could not read permissions of $ENV_FILE";; *) fail "$ENV_FILE permissions are $PERM; run: chmod 600 $ENV_FILE";; esac
if git ls-files --error-unmatch "$ENV_FILE" >/dev/null 2>&1; then fail "$ENV_FILE is tracked by git; remove it from git"; else ok "$ENV_FILE is not in git"; fi

echo "[2] required values"
for k in CCTV_VERSION WEB_LAN_ADDRESS PUBLIC_BASE_URL MEDIA_UDP_BIND MEDIA_WEBRTC_HOST NTP_BIND NTP_ALLOW RECORDINGS_HOST_DIR POSTGRES_USER POSTGRES_DB; do
  [ -n "$(val "$k")" ] && ok "$k set" || fail "$k is empty"
done

echo "[3] secrets (names only)"
SEEN=""
for k in POSTGRES_PASSWORD JWT_SECRET ENCRYPTION_KEY SERVICE_API_KEY MEDIA_WEBHOOK_SECRET; do
  v=$(val "$k")
  if [ -z "$v" ]; then fail "$k is empty"; continue; fi
  if printf '%s' "$v" | grep -Eiq 'change-?me|change-in-production|^dev-|-dev$|example|placeholder|^minioadmin$|^image_pass$'; then fail "$k is a placeholder or Dev default"; continue; fi
  if [ "${#v}" -lt 32 ]; then fail "$k is shorter than 32 characters"; continue; fi
  h=$(printf '%s' "$v" | sha256sum | cut -c1-16)
  case " $SEEN " in *" $h "*) fail "$k is the same as another secret";; *) SEEN="$SEEN $h"; ok "$k looks like a real secret";; esac
done

echo "[4] safety flags"
[ "$(val CCTV_ISOLATION_VERIFIED)" = "true" ] && ok "CCTV_ISOLATION_VERIFIED=true" || fail "CCTV_ISOLATION_VERIFIED is not true (do the isolation check in the runbook first)"
[ "$(val ALLOW_DATA_LOSS)" = "true" ] && fail "ALLOW_DATA_LOSS=true is never allowed" || ok "ALLOW_DATA_LOSS is not true"
[ "$(val RUN_SEED)" = "true" ] && warn "RUN_SEED=true: only for the first migrate on an empty database; set it back to false after" || ok "RUN_SEED is not true"
v=$(val DEPLOY_ENV); [ -z "$v" ] || [ "$v" = "production" ] && ok "DEPLOY_ENV is production (fixed in docker-compose.prod.yml)" || fail "DEPLOY_ENV=$v in $ENV_FILE; remove it (the prod override sets production)"

echo "[5] addresses (never 0.0.0.0, never the legacy production LAN 192.168.60.x)"
for k in WEB_LAN_ADDRESS MEDIA_UDP_BIND MEDIA_WEBRTC_HOST NTP_BIND; do
  v=$(val "$k")
  case "$v" in
    "") ;;
    0.0.0.0|::|"*") fail "$k=$v exposes the service on every interface" ;;
    192.168.60.*) fail "$k=$v is on the legacy production LAN" ;;
    127.*) warn "$k=$v is localhost only; LAN users will not reach it" ;;
    *) if command -v ip >/dev/null 2>&1 && ! ip -o addr show 2>/dev/null | grep -q " $v/"; then fail "$k=$v is not an address of this server"; else ok "$k=$v"; fi ;;
  esac
done
SUB=$(val CCTV_DOCKER_SUBNET); SUB=${SUB:-10.250.0.0/24}
case "$SUB" in 192.168.*) fail "CCTV_DOCKER_SUBNET=$SUB is in 192.168.x, where the camera LANs and legacy production live";; *) ok "Docker network subnet $SUB";; esac
if command -v ip >/dev/null 2>&1 && ip route 2>/dev/null | grep -v docker | grep -v br- | grep -q "^${SUB%%/*}"; then fail "CCTV_DOCKER_SUBNET=$SUB is already a route on this server"; fi
for k in PUBLIC_BASE_URL CORS_ALLOWED_ORIGINS; do
  case "$(val "$k")" in *192.168.60.*) fail "$k points at the legacy production LAN";; *localhost*|*127.0.0.1*) warn "$k uses localhost; links in notifications will not open on other PCs";; *) ok "$k";; esac
done

echo "[6] disk and files"
R=$(val RECORDINGS_HOST_DIR)
if [ -n "$R" ]; then
  case "$R" in /*) ;; *) fail "RECORDINGS_HOST_DIR must be an absolute path";; esac
  if [ -d "$R" ]; then
    ok "RECORDINGS_HOST_DIR exists"
    OWNER=$(stat -c '%u' "$R" 2>/dev/null); [ "$OWNER" = "1001" ] && ok "recordings folder owned by uid 1001 (mediamtx/image-api)" || fail "recordings folder owner is uid $OWNER; run: chown -R 1001:1001 $R"
    FREE_GB=$(df -Pk "$R" | awk 'NR==2 {print int($4/1024/1024)}')
    [ "${FREE_GB:-0}" -ge 500 ] && ok "recording disk free: ${FREE_GB} GB" || warn "recording disk free only ${FREE_GB} GB"
    ROOT_DEV=$(df -P / | awk 'NR==2 {print $1}'); REC_DEV=$(df -P "$R" | awk 'NR==2 {print $1}')
    [ "$ROOT_DEV" != "$REC_DEV" ] && ok "recordings are on their own disk ($REC_DEV)" || warn "recordings share the system disk; a full disk would stop the database too"
  else fail "RECORDINGS_HOST_DIR $R does not exist"; fi
fi
[ -f ssl/server.crt ] && [ -f ssl/server.key ] && ok "TLS certificate present (ssl/)" || fail "ssl/server.crt or ssl/server.key missing (bash ssl/generate-cert.sh <server IP>, or the company certificate)"

echo "[7] docker"
if ! docker info >/dev/null 2>&1; then fail "docker is not running or this user cannot use it"; else
  ok "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null)"
  if docker compose --env-file "$ENV_FILE" -f docker-compose.yml -f docker-compose.prod.yml config -q 2>/dev/null; then ok "compose files + settings are valid"
  else fail "docker compose config fails; run it without -q to see why"; fi
  for svc in $(docker compose --env-file "$ENV_FILE" -f docker-compose.yml -f docker-compose.prod.yml config --services 2>/dev/null); do printf '%s ' "$svc"; done; echo "(services that will start)"
fi

echo "[8] git"
TAG=$(val CCTV_VERSION)
if git rev-parse --git-dir >/dev/null 2>&1; then
  [ -z "$(git status --porcelain --untracked-files=no)" ] && ok "working tree clean" || fail "working tree has local changes; deploy only a tagged, unchanged checkout"
  HEAD_TAG=$(git describe --tags --exact-match 2>/dev/null)
  [ "$HEAD_TAG" = "v$TAG" ] || [ "$HEAD_TAG" = "$TAG" ] && ok "checkout is tag $HEAD_TAG" || fail "checkout is not tag v$TAG (git checkout v$TAG)"
else warn "not a git checkout; cannot confirm the release"; fi

echo
if [ "$FAILS" -gt 0 ]; then echo "$FAILS FAIL, $WARNS WARN: NOT ready. Fix the FAIL lines and run again."; exit 1; fi
echo "0 FAIL, $WARNS WARN: ready to deploy (read the WARN lines)."
