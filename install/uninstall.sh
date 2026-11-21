#!/usr/bin/env bash
# CCTV Platform — remove from Linux.   bash install/uninstall.sh
#   1  remove the program, keep the data (install again and everything is back)
#   2  remove everything incl. the database (backup + settings copy first), and the CCTV images
# Never touched: recordings folder, backup folder, other Docker projects, daemon.json, sysctl.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE=.env.production; PROJECT=cctv-platform
ok() { printf '  \e[32mok\e[0m    %s\n' "$1"; }; die() { printf '\n\e[31mSTOP\e[0m  %s\n' "$1"; exit 1; }
getv() { [ -f "$ENV_FILE" ] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1 || true; }
REC=$(getv RECORDINGS_HOST_DIR)
docker info >/dev/null 2>&1 || die "Docker is not running or this user cannot use it"
C=$(docker ps -a -q --filter "label=com.docker.compose.project=$PROJECT" | wc -l)
V=$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" | wc -l)
echo "CCTV Platform here: $C container(s), $V data volume(s)"
[ "$C" -eq 0 ] && [ "$V" -eq 0 ] && { ok "nothing installed"; exit 0; }
printf '\n  1  Remove the program, KEEP the data\n  2  Remove EVERYTHING, including the database (backup first)\n  0  Cancel\n'
read -r -p "  Choose 1, 2 or 0: " CH
case "$CH" in 1|2) ;; *) echo "  Cancelled; nothing changed."; exit 0 ;; esac
if [ "$CH" = 2 ]; then
  read -r -p "  This deletes cameras, users, alerts, incidents and settings. Type DELETE to go on: " X
  [ "$X" = DELETE ] || { echo "  Cancelled; nothing changed."; exit 0; }
  if [ -n "$(docker ps -q --filter 'name=^cctv-postgres$' --filter status=running)" ]; then
    B=$(getv BACKUP_HOST_DIR); B=${B:-.}; S=$(date +%F-%H%M); F="$B/cctv-$S-before-uninstall.dump"
    ( umask 077; docker exec cctv-postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$F" ) && [ -s "$F" ] || die "Backup failed; nothing was deleted"
    ok "backup: $F"
    [ -f "$ENV_FILE" ] && ( umask 077; cp "$ENV_FILE" "$B/cctv-$S-env.production" ) && ok "settings copied beside it (keep both together, and private)"
  else
    read -r -p "  The database is not running, so there is no backup. Type DELETE again to go on: " X
    [ "$X" = DELETE ] || { echo "  Cancelled"; exit 0; }
  fi
  docker compose -p "$PROJECT" down -v --remove-orphans && ok "containers and data removed"
  for i in $(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^(cctv-(api|web-app):|cctv-platform-)' || true); do docker image rm "$i" >/dev/null 2>&1 || true; done
  [ -f "$ENV_FILE" ] && mv "$ENV_FILE" "$ENV_FILE.removed-$(date +%Y%m%d-%H%M)" && ok "settings file set aside"
  echo "  Kept: recordings ($REC) and backups. Delete them yourself if not needed."
else
  docker compose -p "$PROJECT" down --remove-orphans && ok "containers removed; the data stays"
fi
echo "  Install again: bash install/install.sh"
