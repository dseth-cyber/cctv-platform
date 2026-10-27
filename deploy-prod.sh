#!/usr/bin/env bash
#
# deploy-prod.sh — DISABLED FOR CCTV DEV ENVIRONMENT
#
# This repository is a DEV-ONLY environment for CCTV Platform development.
# Direct production deployments from this workspace are strictly prohibited.
# Image Service Production on the server is an entirely separate system.
#
# Rule reference: AGENTS.md § ขอบเขตที่ห้ามละเมิด & Roadmap.md Phase 0

set -euo pipefail

printf '\033[1;31m'
echo "======================================================================"
echo "[BLOCKED] deploy-prod.sh is DISABLED in CCTV Platform Dev Environment"
echo "Reason: Production deployment from this Dev workspace is strictly prohibited."
echo "        Image Service Production is an isolated, separate system."
echo "======================================================================"
printf '\033[0m'
exit 1
