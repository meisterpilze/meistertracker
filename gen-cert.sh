#!/bin/bash
# Generate a self-signed TLS certificate for local/LAN HTTPS.
# Required for camera access (getUserMedia) on iOS Safari.
#
# Usage: bash gen-cert.sh
#
# The certificate is valid for 365 days and covers localhost + LAN IPs.
# Compatible with both OpenSSL and LibreSSL (macOS).

set -e

CERT_DIR="certs"
mkdir -p "$CERT_DIR"

# Detect LAN IP (Linux then macOS fallback)
LAN_IP=""
if command -v hostname &>/dev/null && hostname -I &>/dev/null; then
  LAN_IP=$(hostname -I | awk '{print $1}')
fi
if [ -z "$LAN_IP" ] && command -v ipconfig &>/dev/null; then
  LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
fi
if [ -z "$LAN_IP" ]; then
  LAN_IP="192.168.1.100"
fi

echo "Generating self-signed certificate..."
echo "  LAN IP: $LAN_IP"

# Use a config file for SAN (works with both OpenSSL and LibreSSL)
TMPCONF=$(mktemp)
cat > "$TMPCONF" <<CONF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_ext

[dn]
CN = Meisterpilze Lab Tracker

[v3_ext]
subjectAltName = DNS:localhost,IP:127.0.0.1,IP:$LAN_IP
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
CONF

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$CERT_DIR/server.key" \
  -out "$CERT_DIR/server.crt" \
  -days 365 \
  -config "$TMPCONF"

rm -f "$TMPCONF"

echo ""
echo "Certificate generated in $CERT_DIR/"
echo "  $CERT_DIR/server.key"
echo "  $CERT_DIR/server.crt"
echo ""
echo "On iOS Safari, open https://$LAN_IP:3000 and accept the certificate warning."
echo "Restart the server for HTTPS to take effect."
