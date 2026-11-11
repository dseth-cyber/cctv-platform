#!/bin/sh
set -e

case "${1:-start}" in
  migrate)
    # The global prisma/tsx (pinned to package-lock in the Dockerfile) carry their engines; npx would pick the local
    # prisma, installed with --ignore-scripts and so without an engine, and download one: impossible offline.
    # Data migrations that db push cannot do safely (copy data, then drop columns). Each file is
    # idempotent and runs in name order before the schema push.
    for f in prisma/sql/*.sql; do
      [ -e "$f" ] || continue
      echo "=== Applying $f ==="
      prisma db execute --file "$f" --schema prisma/schema.prisma
    done
    echo "=== Running Prisma DB push ==="
    if [ "${ALLOW_DATA_LOSS:-false}" = "true" ]; then
      echo "[WARN] ALLOW_DATA_LOSS=true — running prisma db push with --accept-data-loss"
      prisma db push --skip-generate --accept-data-loss
    else
      prisma db push --skip-generate
    fi
    if [ "${RUN_SEED:-false}" = "true" ]; then
      echo "=== Running seed ==="
      tsx prisma/seed.ts
    fi
    echo "=== Migration complete ==="
    ;;
  seed)
    echo "=== Running seed ==="
    tsx prisma/seed.ts
    ;;
  start|*)
    echo "=== Starting cctv image-api ==="
    exec node dist/index.js
    ;;
esac
