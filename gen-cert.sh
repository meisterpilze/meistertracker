#!/bin/bash
# Generate a self-signed TLS certificate for local/LAN HTTPS.
# Required for camera access (getUserMedia) on iOS Safari.
#
# Usage: bash gen-cert.sh
#
# The certificate is valid for 365 days and covers localhost + LAN IPs.

set -e

CERT_DIR="certs"
mkdir -p "$CERT_DIR"

# Detect LAN IP
LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0 2>/dev/null || echo "192.168.1.100")

echo "Generating self-signed certificate..."
echo "  LAN IP: $LAN_IP"

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$CERT_DIR/server.key" \
  -out "$CERT_DIR/server.crt" \
  -days 365 \
  -subj "/CN=Meisterpilze Lab Tracker" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:$LAN_IP"

echo ""
echo "Certificate generated in $CERT_DIR/"
echo "  $CERT_DIR/server.key"
echo "  $CERT_DIR/server.crt"
echo ""
echo "On iOS Safari, open https://$LAN_IP:3443 and accept the certificate warning."
echo "Restart the server for HTTPS to take effect."
