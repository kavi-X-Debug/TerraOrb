#!/usr/bin/env bash
# Set up the TerraOrb farm planner backend on a fresh EC2 server (Ubuntu 22.04/24.04 or Amazon Linux 2023), with free automatic HTTPS.
#
#   git clone https://<your-github-user>:<read-only token>@github.com/kavi-X-Debug/TerraOrb.git
#   sudo bash TerraOrb/deploy/ec2/setup.sh
#
# What it does: installs Python 3.12 and Caddy, copies the backend and its data to /opt/terraorb, runs it as a service on 127.0.0.1:8000, and puts
# Caddy in front of it. Caddy gets a real HTTPS certificate for <your-ip>.sslip.io (a free name that points at your IP), so the website on
# Cloudflare (HTTPS) can call it. The Elastic IP must already be attached to this server and ports 80 and 443 open in its security group.
# The farm database lives in /var/lib/terraorb (keep it: it holds the farms people added). Sign-in codes are NOT sent (no SMS service yet):
# the development shortcut MC_DEV stays OFF. Update later with: sudo bash /opt/terraorb/deploy/ec2/update.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo."; exit 1; }
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
SITE="${MC_CORS:-https://terraorb.pages.dev}"

echo "== 1/6 packages"
if command -v apt-get >/dev/null; then
  apt-get update -y && apt-get install -y python3 python3-venv curl rsync
  PY=python3
else
  dnf install -y python3.12 python3.12-pip curl rsync
  PY=python3.12
fi
"$PY" -c 'import sys; assert sys.version_info >= (3, 11), "Python 3.11 or newer is needed (the backend uses tomllib)"'

echo "== 2/6 public address"
IP="$(curl -s --max-time 8 https://checkip.amazonaws.com || true)"
IP="$(echo "$IP" | tr -d '[:space:]')"
[ -n "$IP" ] || { echo "Could not find the public IP address."; exit 1; }
HOST="$(echo "$IP" | tr . -).sslip.io"
echo "   address: https://$HOST"

echo "== 3/6 Caddy (web server with automatic HTTPS)"
if ! command -v caddy >/dev/null; then
  ARCH=$(uname -m); case "$ARCH" in aarch64|arm64) A=arm64;; *) A=amd64;; esac
  curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=$A" -o /usr/local/bin/caddy
  chmod +x /usr/local/bin/caddy
fi
id caddy >/dev/null 2>&1 || useradd --system --home /var/lib/caddy --create-home --shell /usr/sbin/nologin caddy
mkdir -p /etc/caddy
printf '%s {\n  reverse_proxy 127.0.0.1:8000\n}\n' "$HOST" > /etc/caddy/Caddyfile
cat > /etc/systemd/system/caddy.service <<EOF
[Unit]
Description=Caddy web server for TerraOrb
After=network-online.target
Wants=network-online.target
[Service]
User=caddy
ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile
AmbientCapabilities=CAP_NET_BIND_SERVICE
Restart=always
[Install]
WantedBy=multi-user.target
EOF

echo "== 4/6 backend files"
id terraorb >/dev/null 2>&1 || useradd --system --home /opt/terraorb --shell /usr/sbin/nologin terraorb
mkdir -p /opt/terraorb /var/lib/terraorb
rsync -a --delete --exclude '.git' "$SRC/backend/" /opt/terraorb/backend/ --exclude 'tests' --exclude 'data'
mkdir -p /opt/terraorb/data /opt/terraorb/pipeline /opt/terraorb/deploy
rsync -a --delete "$SRC/data/farm/" /opt/terraorb/data/farm/
cp "$SRC/pipeline/config.toml" /opt/terraorb/pipeline/config.toml
rsync -a "$SRC/deploy/ec2/" /opt/terraorb/deploy/ec2/
mkdir -p /opt/terraorb/backend/data
"$PY" -m venv /opt/terraorb/venv
/opt/terraorb/venv/bin/pip install --quiet --upgrade pip
/opt/terraorb/venv/bin/pip install --quiet fastapi uvicorn pydantic httpx numpy
chown -R terraorb:terraorb /opt/terraorb /var/lib/terraorb

echo "== 5/6 backend service"
cat > /etc/systemd/system/terraorb.service <<EOF
[Unit]
Description=TerraOrb farm planner backend
After=network.target
[Service]
User=terraorb
WorkingDirectory=/opt/terraorb
Environment=MC_DB=/var/lib/terraorb/terraorb.db
Environment=MC_CORS=$SITE
Environment=PYTHONUNBUFFERED=1
ExecStart=/opt/terraorb/venv/bin/uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
Restart=always
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now terraorb caddy
systemctl restart terraorb caddy

echo "== 6/6 check"
sleep 8
curl -s --max-time 10 http://127.0.0.1:8000/api/health && echo
echo "Try in a browser: https://$HOST/api/health   (the first HTTPS certificate can take up to a minute)"
echo "Send this address to Claude: https://$HOST"
