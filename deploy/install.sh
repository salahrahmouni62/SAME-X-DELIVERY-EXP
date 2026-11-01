#!/usr/bin/env bash
# SAME X DELIVERY CRM — installation complète sur un VPS Ubuntu 24.04 neuf.
# Usage (en root) :  bash install.sh crm.samexdelivery.com votre@email.com
# Le script est ré-exécutable sans risque : il conserve les données et la configuration existantes.
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
APP_ROOT=/opt/samex-crm
DATA_DIR=/var/lib/samex-crm
ENV_DIR=/etc/samex-crm
ENV_FILE=$ENV_DIR/samex-crm.env
BACKUP_DIR=/var/backups/samex-crm
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say()  { printf '\n\033[1;33m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✔\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Lancez ce script en tant que root (ou avec sudo)."
[ -n "$DOMAIN" ] && [ -n "$EMAIL" ] || die "Usage : bash install.sh crm.votredomaine.com votre@email.com"
[[ "$DOMAIN" =~ ^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]] || die "Nom de domaine invalide : $DOMAIN"
[[ "$EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || die "Adresse email invalide : $EMAIL"
[ -f "$SRC_DIR/server.js" ] || die "Lancez ce script depuis le dossier décompressé samex-delivery-crm."
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || die "Ce script est prévu pour Ubuntu (détecté : ${PRETTY_NAME:-inconnu})."

export DEBIAN_FRONTEND=noninteractive

say "1/9 Mise à jour du système et installation des outils"
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg nginx certbot python3-certbot-nginx ufw fail2ban unattended-upgrades >/dev/null
ok "Nginx, Certbot, pare-feu, fail2ban et mises à jour de sécurité automatiques installés"

say "2/9 Node.js"
NODE_MAJOR=0
command -v node >/dev/null && NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt 20 ]; then
  if curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh && bash /tmp/nodesource_setup.sh >/dev/null 2>&1; then
    apt-get install -y -qq nodejs >/dev/null
  else
    echo "  (dépôt NodeSource indisponible, installation de la version Ubuntu)"
    apt-get install -y -qq nodejs >/dev/null
  fi
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 18 ] || die "Node.js 18 ou plus est requis (installé : $(node -v))."
ok "Node.js $(node -v)"

say "3/9 Compte de service et dossiers"
id samex >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin samex
install -d -o samex -g samex -m 700 "$DATA_DIR"
install -d -o root -g root -m 700 "$BACKUP_DIR"
install -d -o root -g samex -m 750 "$ENV_DIR"
install -d -o root -g root -m 755 "$APP_ROOT/releases"
ok "Données : $DATA_DIR (accès réservé au service)"

say "4/9 Installation de l'application"
RELEASE="$APP_ROOT/releases/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RELEASE" && cp -a "$SRC_DIR/." "$RELEASE/" && rm -rf "$RELEASE/data" "$RELEASE/test"
chown -R root:root "$RELEASE"; chmod -R go-w "$RELEASE"
ln -sfn "$RELEASE" "$APP_ROOT/current"
ls -1dt "$APP_ROOT"/releases/* | tail -n +4 | xargs -r rm -rf   # garde les 3 dernières versions
ok "Version installée : $(basename "$RELEASE")"

say "5/9 Configuration et secrets"
if [ ! -f "$ENV_FILE" ]; then
  NEW_TOKEN=$(openssl rand -hex 12)
  cat > "$ENV_FILE" <<EOF
# SAME X DELIVERY CRM — configuration de production (ne pas partager ce fichier)
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
DATA_DIR=$DATA_DIR
TRUST_PROXY=true
COOKIE_SECURE=true
SESSION_TTL_HOURS=12
KEEP_SNAPSHOTS=30
# Code à usage unique pour créer le premier superviseur depuis le navigateur (inutile ensuite)
SETUP_TOKEN=$NEW_TOKEN
EOF
  ok "Fichier de configuration créé"
else
  ok "Configuration existante conservée"
fi
chown root:samex "$ENV_FILE"; chmod 640 "$ENV_FILE"

say "6/9 Service système (démarrage et redémarrage automatiques)"
cat > /etc/systemd/system/samex-crm.service <<EOF
[Unit]
Description=SAME X DELIVERY CRM
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=samex
Group=samex
EnvironmentFile=$ENV_FILE
WorkingDirectory=$APP_ROOT/current
ExecStart=/usr/bin/env node $APP_ROOT/current/server.js
Restart=always
RestartSec=3
TimeoutStopSec=20
UMask=0077
# Durcissement
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
CapabilityBoundingSet=
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable samex-crm >/dev/null 2>&1
systemctl restart samex-crm
for i in $(seq 1 20); do curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://127.0.0.1:3000/api/health >/dev/null || { journalctl -u samex-crm -n 30 --no-pager; die "Le service CRM ne démarre pas (voir le journal ci-dessus)."; }
ok "Service samex-crm actif"

say "7/9 Outils d'administration et sauvegardes automatiques"
install -m 755 "$SRC_DIR/deploy/samex-admin" /usr/local/bin/samex-admin
install -m 755 "$SRC_DIR/deploy/samex-backup" /usr/local/bin/samex-backup
install -m 755 "$SRC_DIR/deploy/samex-restore" /usr/local/bin/samex-restore
install -m 755 "$SRC_DIR/deploy/samex-update" /usr/local/bin/samex-update
cat > /etc/systemd/system/samex-backup.service <<'EOF'
[Unit]
Description=Sauvegarde quotidienne SAME X DELIVERY CRM
[Service]
Type=oneshot
ExecStart=/usr/local/bin/samex-backup
EOF
cat > /etc/systemd/system/samex-backup.timer <<'EOF'
[Unit]
Description=Sauvegarde quotidienne SAME X DELIVERY CRM (02:30)
[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true
RandomizedDelaySec=300
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now samex-backup.timer >/dev/null 2>&1
ok "Sauvegarde chaque nuit à 02:30 dans $BACKUP_DIR (30 jours conservés)"

say "8/9 Nginx, pare-feu et certificat HTTPS"
cat > /etc/nginx/conf.d/samex-ratelimit.conf <<'EOF'
limit_req_zone $binary_remote_addr zone=samex_login:10m rate=10r/m;
limit_req_zone $binary_remote_addr zone=samex_api:10m rate=20r/s;
EOF
cat > /etc/nginx/sites-available/samex-crm <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    client_max_body_size 25m;
    server_tokens off;

    add_header Strict-Transport-Security "max-age=31536000" always;

    location ~ ^/api/(login|setup)\$ {
        limit_req zone=samex_login burst=5 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:3000;
        include /etc/nginx/snippets/samex-proxy.conf;
    }
    location /api/ {
        limit_req zone=samex_api burst=60 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:3000;
        include /etc/nginx/snippets/samex-proxy.conf;
    }
    location / {
        proxy_pass http://127.0.0.1:3000;
        include /etc/nginx/snippets/samex-proxy.conf;
    }
}
EOF
cat > /etc/nginx/snippets/samex-proxy.conf <<'EOF'
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_read_timeout 120s;
EOF
ln -sfn /etc/nginx/sites-available/samex-crm /etc/nginx/sites-enabled/samex-crm
rm -f /etc/nginx/sites-enabled/default
nginx -t >/dev/null 2>&1 || { nginx -t; die "Configuration Nginx invalide."; }
systemctl reload nginx

ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
ok "Pare-feu actif : seuls SSH (22), HTTP (80) et HTTPS (443) sont ouverts"

PUBLIC_IP=$(curl -4 -fsS --max-time 10 https://api.ipify.org || true)
DNS_IP=$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)
if [ -z "$DNS_IP" ] || [ "$DNS_IP" != "$PUBLIC_IP" ]; then
  echo
  echo "  ⚠ Le domaine $DOMAIN ne pointe pas encore vers ce serveur."
  echo "    IP de ce serveur : ${PUBLIC_IP:-inconnue}   |   IP actuelle du domaine : ${DNS_IP:-aucune}"
  echo "    Créez l'enregistrement DNS de type A : $DOMAIN → ${PUBLIC_IP:-IP_DU_SERVEUR}"
  echo "    Attendez 5 à 30 minutes, puis relancez exactement la même commande. Vos données seront conservées."
  die "Certificat HTTPS non demandé (DNS pas encore prêt)."
fi
certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos -n --redirect --keep-until-expiring >/dev/null 2>&1 \
  || { certbot --nginx -d "$DOMAIN" -m "$EMAIL" --agree-tos -n --redirect --keep-until-expiring; die "Échec du certificat HTTPS."; }
systemctl reload nginx
ok "HTTPS actif (certificat Let's Encrypt renouvelé automatiquement)"

say "9/9 Vérification finale"
sleep 2
curl -fsS "https://$DOMAIN/api/health" >/dev/null || die "L'application ne répond pas sur https://$DOMAIN"
ok "https://$DOMAIN répond correctement"
/usr/local/bin/samex-backup >/dev/null && ok "Première sauvegarde effectuée"

echo
echo "════════════════════════════════════════════════════════════════════"
echo "  SAME X DELIVERY CRM est en ligne : https://$DOMAIN"
echo "════════════════════════════════════════════════════════════════════"
NEEDS_SETUP=$(curl -fsS "https://$DOMAIN/api/setup-status" | grep -c '"needsSetup":true' || true)
if [ "$NEEDS_SETUP" = "1" ]; then
  TOKEN=$(grep '^SETUP_TOKEN=' "$ENV_FILE" | cut -d= -f2)
  echo
  echo "  Ouvrez https://$DOMAIN et créez votre compte superviseur."
  echo "  Code d'initialisation (à usage unique, ne le partagez pas) :"
  echo
  echo "        $TOKEN"
  echo
fi
echo "  Aide : sudo samex-admin list-users | reset-password <identifiant>"
echo
