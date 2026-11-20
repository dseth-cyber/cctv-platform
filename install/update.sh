#!/usr/bin/env bash
# CCTV Platform — update to a newer release on Linux. The running version keeps working until the new one is ready.
#
#   bash install/update.sh              # git checkout: the latest release tag
#   bash install/update.sh v1.0.0-rc14  # git checkout: that release
#   bash install/update.sh              # downloaded package: the version in this folder (see README, "Update")
#
# Order: database backup → switch release → preflight → build → database changes (alone; stops here on error, the
# old version still runs) → start the new version → health check. Never seeds, never allows data loss.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE=.env.production
DCP=(docker compose --env-file "$ENV_FILE" -f docker-compose.yml -f docker-compose.prod.yml)
step() { printf '\n\e[1m== %s ==\e[0m\n' "$1"; }
ok()   { printf '  \e[32mok\e[0m    %s\n' "$1"; }
die()  { printf '\n\e[31mSTOP\e[0m  %s\n' "$1"; exit 1; }
getv() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n1; }
setv() { local tmp; tmp=$(mktemp); K="$1" V="$2" awk 'BEGIN{k=ENVIRON["K"];v=ENVIRON["V"];d=0} $0~"^"k"="{print k"="v;d=1;next}{print} END{if(!d)print k"="v}' "$ENV_FILE" > "$tmp"; cat "$tmp" > "$ENV_FILE"; rm -f "$tmp"; }

[ -f "$ENV_FILE" ] || die "$ENV_FILE not found. First installation: bash install/install.sh"
docker info >/dev/null 2>&1 || die "Docker is not running or this user cannot use it"
OLD=$(getv CCTV_VERSION)

step "1/5 Database backup"
BAK=$(getv BACKUP_HOST_DIR); BAK=${BAK:-.}
F="$BAK/cctv-$(date +%F-%H%M)-before-update.dump"
( umask 077; docker exec cctv-postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$F" ) || die "Backup failed; nothing was changed"
ok "$F ($(du -h "$F" | cut -f1))"

step "2/5 Release"
if git rev-parse --git-dir >/dev/null 2>&1; then
  git fetch -q --tags origin || die "git fetch failed (network or access to the repository)"
  NEW=${1:-$(git tag --list 'v*' --sort=-v:refname | head -n1)}
  [ -n "$NEW" ] || die "No release tag found"
  [ -z "$(git status --porcelain --untracked-files=no)" ] || die "This folder has local changes to tracked files; an update would mix them in. Undo them first (git status)."
  git checkout -q "$NEW" || die "Cannot check out $NEW"
  chmod 644 mediamtx/mediamtx.yml 2>/dev/null || true
  NEW=${NEW#v}
elif [ -f VERSION ]; then NEW=$(tr -d ' \r\n' < VERSION); NEW=${NEW#v}
else die "Not a git checkout and no VERSION file"; fi
setv CCTV_VERSION "$NEW"
ok "$OLD → $NEW"

step "3/5 Check and build"
sh scripts/prod-preflight.sh "$ENV_FILE" | sed 's/^/  /' || die "Preflight found problems (FAIL lines). The old version is still running. To go back: set CCTV_VERSION=$OLD in $ENV_FILE (and git checkout v$OLD)."
mkdir -p install/logs; LOG=install/logs/update-$(date +%Y%m%d-%H%M).log
"${DCP[@]}" build image-api web-app >"$LOG" 2>&1 || die "Build failed (old version still running); see $LOG"
ok "images built"

step "4/5 Database changes"
env -u RUN_SEED "${DCP[@]}" run --rm image-api-migrate >>"$LOG" 2>&1 || die "Database changes failed; the old version is still running. See the end of $LOG; backup: $F"
ok "database up to date"

step "5/5 Start"
"${DCP[@]}" up -d >>"$LOG" 2>&1 || die "Start failed; see $LOG"
for i in $(seq 1 45); do s=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' cctv-api 2>/dev/null || true); [ "$s" = healthy ] && break; sleep 4; done
[ "$s" = healthy ] || die "API not healthy; see: docker logs cctv-api. Roll back: CCTV_VERSION=$OLD in $ENV_FILE, git checkout v$OLD, then: ${DCP[*]} up -d"
ok "CCTV Platform $NEW is running (backup before the update: $F)"
