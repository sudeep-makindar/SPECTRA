#!/bin/bash
# Helper script to generate a self-signed cert for testing Browser Nodes over LAN.

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$DIR")"
CERTS_DIR="$PROJECT_ROOT/config/certs"

mkdir -p "$CERTS_DIR"

if [ -f "$CERTS_DIR/cert.pem" ]; then
    echo "Certificates already exist in $CERTS_DIR"
    echo "To regenerate, delete the folder and run again."
    exit 0
fi

echo "Generating self-signed certificate for local testing..."

# Generate private key
openssl genrsa -out "$CERTS_DIR/key.pem" 2048

# Generate certificate (valid for 365 days)
openssl req -new -x509 -key "$CERTS_DIR/key.pem" -out "$CERTS_DIR/cert.pem" -days 365 \
    -subj "/C=US/ST=State/L=City/O=Spectra/CN=localhost"

echo "--------------------------------------------------------"
echo "Certificates created in: config/certs/"
echo "key.pem and cert.pem"
echo ""
echo "To run Spectra with HTTPS enabled, use:"
echo "uvicorn app.main:app --host 0.0.0.0 --port 8000 --ssl-keyfile config/certs/key.pem --ssl-certfile config/certs/cert.pem"
echo "And configure Vite to use HTTPS for the frontend."
echo "See docs/REMOTE_NODES.md for detailed instructions."
echo "--------------------------------------------------------"
