#!/bin/bash
# Generate a self-signed certificate so phones on the LAN can open
# https://<mac-ip>:5173/node (browsers only allow camera/mic over HTTPS).
# Includes subjectAltNames for localhost and every LAN IPv4 address —
# iOS Safari and Chrome reject certificates without SANs.
# Re-run after changing Wi-Fi networks:  ./scripts/make_https.sh --force

set -e
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CERTS_DIR="$(dirname "$DIR")/config/certs"
mkdir -p "$CERTS_DIR"

if [ -f "$CERTS_DIR/cert.pem" ] && [ "$1" != "--force" ]; then
    echo "Certificates already exist in $CERTS_DIR (use --force to regenerate)"
    exit 0
fi

SAN="DNS:localhost,IP:127.0.0.1"
for ip in $(ifconfig 2>/dev/null | awk '/inet / && $2 != "127.0.0.1" {print $2}'); do
    SAN="$SAN,IP:$ip"
done
echo "SANs: $SAN"

openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
    -keyout "$CERTS_DIR/key.pem" -out "$CERTS_DIR/cert.pem" \
    -subj "/O=Spectra/CN=spectra.local" \
    -addext "subjectAltName=$SAN" 2>/dev/null

echo "Certificates written to config/certs/. Restart 'npm run dev' — Vite picks them up automatically."
