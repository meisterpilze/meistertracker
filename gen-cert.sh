#!/bin/bash
# Generate a self-signed TLS certificate for local/LAN HTTPS.
# Required for camera access (getUserMedia) on iOS Safari.
#
# Usage: bash gen-cert.sh [domain]
#   domain  Optional domain name to include in the certificate (e.g. myhost.duckdns.org)
#           Can also be set via CERT_DOMAIN environment variable.
#
# The certificate is valid for 365 days and covers localhost + LAN IPs + optional domain.
# Compatible with both OpenSSL and LibreSSL (macOS).

set -e

CERT_DIR="certs"
mkdir -p "$CERT_DIR"

# Domain from first argument or CERT_DOMAIN env var.
# Audit S-10: validate against a strict whitelist before interpolating
# into the OpenSSL config heredoc — newlines or `=` characters in DOMAIN
# would otherwise let a hostile env file inject extra cert extensions.
DOMAIN="${1:-${CERT_DOMAIN:-}}"
if [ -n "$DOMAIN" ] && ! [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "ERROR: DOMAIN must contain only A-Za-z0-9.-" >&2
  exit 1
fi

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
if [ -n "$DOMAIN" ]; then
  echo "  Domain: $DOMAIN"
fi

# Build SAN list: domain first (if provided), then localhost + LAN IP
SAN="DNS:localhost,IP:127.0.0.1,IP:$LAN_IP"
if [ -n "$DOMAIN" ]; then
  SAN="DNS:$DOMAIN,$SAN"
fi

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
subjectAltName = $SAN
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
if [ -n "$DOMAIN" ]; then
  echo "  SAN: $SAN"
fi
echo ""
echo "On iOS Safari, open https://$LAN_IP:3000 and accept the certificate warning."
if [ -n "$DOMAIN" ]; then
  echo "Or use https://$DOMAIN:3000 (certificate covers this domain)."
fi
echo "Restart the server for HTTPS to take effect."
