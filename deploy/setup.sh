#!/usr/bin/env bash
# One-time server setup for Ubuntu on Oracle Cloud (1 GB RAM friendly).
# Run from the project folder:  bash deploy/setup.sh
set -e
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "✖ Create .env first:  cp .env.example .env  && nano .env"; exit 1; }

echo "→ Swap (2 GB) so 1 GB RAM never runs out"
if ! swapon --show | grep -q .; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo "→ Node.js 20"
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "→ Dependencies"
npm install --omit=dev

echo "→ Caddy"
if ! command -v caddy >/dev/null; then
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update && sudo apt-get install -y caddy
fi

echo "→ Open ports 80/443 in the VM firewall"
sudo iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo apt-get install -y iptables-persistent >/dev/null 2>&1 || true
sudo netfilter-persistent save 2>/dev/null || true

echo "→ systemd service"
sudo tee /etc/systemd/system/biswa-artifacts.service >/dev/null <<UNIT
[Unit]
Description=Biswa Artifacts
After=network-online.target

[Service]
WorkingDirectory=$(pwd)
ExecStart=$(command -v node) server/index.js
Restart=always
RestartSec=3
User=$USER
Environment=NODE_ENV=production
Environment=NODE_OPTIONS=--max-old-space-size=300

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now biswa-artifacts

echo "→ Caddy config"
if [ -f /etc/ssl/cloudflare/origin.pem ] && [ -f /etc/ssl/cloudflare/origin.key ]; then
  sudo chown root:caddy /etc/ssl/cloudflare/origin.* && sudo chmod 640 /etc/ssl/cloudflare/origin.*
  sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
  sudo systemctl restart caddy
  echo "✔ Done. Open https://biswa.io"
else
  echo "⚠ Origin certificate not found in /etc/ssl/cloudflare/ — see README step 4, then run:"
  echo "   sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl restart caddy"
fi
echo "Logs:  journalctl -u biswa-artifacts -f"
