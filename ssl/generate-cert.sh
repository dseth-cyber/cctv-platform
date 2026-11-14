#!/bin/bash
# Usage: ./generate-cert.sh [IP_OR_DOMAIN]
# Examples:
#   ./generate-cert.sh 192.168.x.y
#   ./generate-cert.sh images.example.com
#   ./generate-cert.sh 192.168.x.y images.example.com

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CERT_DIR="$SCRIPT_DIR"

if [ $# -eq 0 ]; then
  echo "Usage: $0 <IP_OR_DOMAIN> [additional names...]"
  echo "Examples:"
  echo "  $0 192.168.x.y"
  echo "  $0 images.example.com"
  echo "  $0 192.168.x.y images.example.com"
  exit 1
fi

SAN_ENTRIES="DNS:localhost"
CN="$1"

for arg in "$@"; do
  if [[ "$arg" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    SAN_ENTRIES="$SAN_ENTRIES,IP:$arg"
  else
    SAN_ENTRIES="$SAN_ENTRIES,DNS:$arg"
  fi
done

echo "Generating self-signed certificate..."
echo "  CN: $CN"
echo "  SAN: $SAN_ENTRIES"
echo "  Output: $CERT_DIR/"

openssl req -x509 -nodes -days 3650 \
  -newkey rsa:2048 \
  -keyout "$CERT_DIR/server.key" \
  -out "$CERT_DIR/server.crt" \
  -subj "/C=TH/ST=Bangkok/O=ImageService/CN=$CN" \
  -addext "subjectAltName=$SAN_ENTRIES"

chmod 644 "$CERT_DIR/server.crt"
chmod 600 "$CERT_DIR/server.key"

echo ""
echo "Certificate generated successfully!"
echo "  $CERT_DIR/server.crt"
echo "  $CERT_DIR/server.key"
echo "  Valid for 10 years"
echo ""
echo "Restart web-app: docker compose restart web-app"
