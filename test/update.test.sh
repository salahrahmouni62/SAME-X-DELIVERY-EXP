#!/usr/bin/env bash
# Tests deploy/samex-update (valid update + automatic rollback of a broken one) without a real VPS.
# A small stand-in for systemctl behaves like systemd: "restart" waits for the old process to exit.
# Run as root in a disposable environment: bash test/update.test.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
S=$(mktemp -d); PASS=0; FAIL=0
check() { if eval "$2"; then echo "  ✔ $1"; PASS=$((PASS+1)); else echo "  ✘ $1"; FAIL=$((FAIL+1)); fi; }
mkdir -p "$S/bin" "$S/data" "$S/bk"
cat > "$S/bin/systemctl" <<EOF
#!/usr/bin/env bash
PIDF=$S/crm.pid
stopit() { if [ -f \$PIDF ]; then P=\$(cat \$PIDF); kill \$P 2>/dev/null; for i in \$(seq 1 200); do kill -0 \$P 2>/dev/null || break; sleep 0.1; done; rm -f \$PIDF; fi; }
case "\$1" in
  stop) stopit ;;
  start|restart) stopit; (cd /opt/samex-crm/current; NODE_ENV=production DATA_DIR=$S/data PORT=3000 SETUP_TOKEN=x exec node server.js >>$S/crm.log 2>&1) & echo \$! > \$PIDF ;;
esac
EOF
printf '#!/bin/sh\necho "(journal du service)"\n' > "$S/bin/journalctl"; chmod +x "$S"/bin/*
export PATH="$S/bin:/usr/local/bin:$PATH" DATA_DIR="$S/data" BACKUP_DIR="$S/bk"
cp_proj() { mkdir -p "$1" && cp -a "$ROOT/." "$1/" && rm -rf "$1/data"; }
leads() { curl -fsS -b "$S/c.txt" http://127.0.0.1:3000/api/leads | grep -o '"storeName":"[^"]*"' | head -1; }

cp_proj /opt/samex-crm/releases/v1 && ln -sfn /opt/samex-crm/releases/v1 /opt/samex-crm/current
install -m 755 "$ROOT/deploy/samex-backup" /usr/local/bin/samex-backup
systemctl start samex-crm; sleep 1.5
curl -fsS -X POST -H 'Content-Type: application/json' -H 'X-Samex: 1' -c "$S/c.txt" http://127.0.0.1:3000/api/setup -d '{"name":"Salah","username":"salah","password":"Samex2026!","setupToken":"x"}' >/dev/null
curl -fsS -X POST -H 'Content-Type: application/json' -H 'X-Samex: 1' -b "$S/c.txt" http://127.0.0.1:3000/api/leads -d '{"storeName":"Boutique Avant MAJ"}' >/dev/null
check "v1 en ligne avec un prospect" '[ "$(leads)" = "\"storeName\":\"Boutique Avant MAJ\"" ]'

cp_proj "$S/good/samex-delivery-crm"; cp_proj "$S/bad/samex-delivery-crm"
sed -i "1i require('module-qui-nexiste-pas');" "$S/bad/samex-delivery-crm/server.js"
(cd "$S/good" && python3 -m zipfile -c ../good.zip samex-delivery-crm); (cd "$S/bad" && python3 -m zipfile -c ../bad.zip samex-delivery-crm)

bash "$ROOT/deploy/samex-update" "$S/good.zip" > "$S/up1.log" 2>&1; RC1=$?
GOOD=$(readlink /opt/samex-crm/current)
check "mise à jour valide acceptée" '[ $RC1 = 0 ] && [ "$(basename "$GOOD")" != v1 ]'
check "la nouvelle version répond" 'curl -fsS http://127.0.0.1:3000/api/health | grep -q "\"release\":\"$(basename "$GOOD")\""'
check "données et session conservées après mise à jour" '[ "$(leads)" = "\"storeName\":\"Boutique Avant MAJ\"" ]'

sleep 1.1
bash "$ROOT/deploy/samex-update" "$S/bad.zip" > "$S/up2.log" 2>&1; RC2=$?
check "version cassée refusée" '[ $RC2 != 0 ] && grep -q "retour à la version précédente" "$S/up2.log"'
check "retour automatique à la version précédente" '[ "$(readlink /opt/samex-crm/current)" = "$GOOD" ]'
sleep 2
check "service en ligne après le retour arrière, données intactes" '[ "$(leads)" = "\"storeName\":\"Boutique Avant MAJ\"" ]'
check "une sauvegarde faite avant chaque mise à jour" '[ "$(ls "$S/bk" | wc -l)" = 2 ]'

systemctl stop samex-crm; rm -rf /opt/samex-crm /usr/local/bin/samex-backup "$S"
echo; echo "$PASS passed, $FAIL failed"; [ $FAIL = 0 ]
