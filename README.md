# SAME X DELIVERY — CRM Prospection Expéditeurs

Application web de prospection et d'acquisition d'expéditeurs e-commerce en Algérie (58 wilayas, numéros +213, COD).
Interface en français (par défaut) et en arabe (RTL).

## Démarrage rapide

Prérequis : **Node.js 18 ou plus récent**. Aucune dépendance npm à installer.

```bash
node server.js            # http://localhost:3000
```

Au premier lancement, l'écran **Initialisation** permet de créer le superviseur national (et, en option, les agences Hub Biskra 07 et Hub Alger 16).

En local (http, sans HTTPS) : `COOKIE_SECURE=false node server.js`.

## Fonctionnalités

- **Connexion sécurisée côté serveur** : mots de passe hachés (scrypt + sel), sessions par cookie `HttpOnly` / `SameSite=Strict` (`Secure` en HTTPS), blocage après 5 échecs (15 min), protection CSRF, en-têtes de sécurité (CSP, X-Frame-Options…).
- **Rôles** : *Superviseur national* (toutes les agences, gestion, sauvegardes) et *Agent terrain* (uniquement ses propres prospects). Toutes les règles sont appliquées par le serveur, pas par le navigateur.
- **Agences & hubs** : création, modification, désactivation (les agents de l'agence sont déconnectés et ne peuvent plus se connecter ; les prospects sont conservés), wilayas couvertes.
- **Utilisateurs** : création d'agents rattachés à une agence, réinitialisation de mot de passe, désactivation immédiate, changement de mot de passe personnel.
- **Pipeline 8 étapes** (Post découvert → Enrichi → Contacté → En discussion → RDV/visite → Colis tests → Expéditeur gagné / Perdu) avec glisser-déposer, **Tableau liste** (tri, pagination, modification d'étape en ligne, actions groupées), **Grille posts** Instagram / TikTok / Facebook.
- **Fiche prospect** : coordonnées, wilaya d'expédition confirmée / *NON CONFIRMÉE*, besoins de livraison et points de blocage, contenu du post, **journal complet** (interactions + historique automatique des changements).
- **Relances** : en retard / aujourd'hui / 7 jours, rappel à la connexion, report en un clic, compteur dans la barre latérale.
- **Prospects prioritaires** : priorité haute, relance en retard, ou prospect chaud avec numéro.
- **Tableau de bord** : KPI, taux de conversion, nouveaux expéditeurs gagnés ce mois, entonnoir, activité 8 semaines, performance par agence et par agent.
- **Pitch WhatsApp** : 4 modèles FR/AR personnalisés, copie, ouverture wa.me, trace automatique dans le journal.
- **Export** CSV (UTF-8, compatible Excel) et **Excel .xlsx** (3 onglets : prospects, stats agents, stats agences), selon les filtres et le périmètre de l'utilisateur.
- **Import** CSV / JSON avec détection des doublons ; compatible avec l'export de l'ancien CRM (voir l'écran *Sauvegarde & données*).
- **Sauvegarde & restauration** : téléchargement complet, restauration (remplacer ou fusionner), instantané automatique quotidien (30 conservés), instantané de sécurité avant chaque restauration.
- **Journal d'audit** : connexions, échecs, créations, désactivations, exports, imports, restaurations.

## Configuration (variables d'environnement)

| Variable | Défaut | Rôle |
|---|---|---|
| `NODE_ENV` | — | `production` active le verrouillage de l'initialisation web |
| `SETUP_TOKEN` | — | Code secret exigé pour créer le premier superviseur depuis le navigateur (généré par `deploy/install.sh`) |
| `HOST` | `127.0.0.1` | Interface d'écoute (localhost : seul Nginx est exposé) |
| `PORT` | `3000` | Port HTTP |
| `DATA_DIR` | `./data` | Base (`samex-db.json`) et instantanés (`backups/`), fichiers en accès 600 |
| `COOKIE_SECURE` | auto | `true` en production HTTPS, `false` uniquement en local http |
| `TRUST_PROXY` | `false` | `true` derrière Nginx (IP réelle lue dans `X-Real-IP`) |
| `SESSION_TTL_HOURS` | `12` | Durée d'une session |
| `KEEP_SNAPSHOTS` | `30` | Nombre d'instantanés conservés |

## Mise en production

**Suivez `GUIDE-DEPLOIEMENT.md`** (pas à pas, depuis Windows). En résumé, sur un VPS Ubuntu 24.04 :

```bash
bash deploy/install.sh crm.votredomaine.com votre@email.com
```

Le script installe Node.js, un service systemd durci (redémarrage automatique), Nginx avec HTTPS Let's Encrypt,
le pare-feu, fail2ban, les mises à jour de sécurité, les sauvegardes nocturnes et les commandes
`samex-admin`, `samex-backup`, `samex-restore`, `samex-update`. Les données vivent dans `/var/lib/samex-crm`,
séparées du code (`/opt/samex-crm/releases/...`) : elles survivent aux redémarrages et aux mises à jour.

Docker : `docker run -p 127.0.0.1:3000:3000 -v samex-data:/app/data -e SETUP_TOKEN=$(openssl rand -hex 12) samex-crm` derrière un reverse proxy HTTPS.

### Vercel (Upstash Redis)

Vercel n'a pas de disque durable : dès que `KV_REST_API_URL` et `KV_REST_API_TOKEN` (ou `UPSTASH_REDIS_REST_URL` / `_TOKEN`) sont définis, la base, les instantanés et le blocage des connexions passent dans Redis. Sans ces variables, rien ne change (fichier JSON).

Variables de production : `SETUP_TOKEN`, `NODE_ENV=production`, `COOKIE_SECURE=true`, `TRUST_PROXY=true`, `NODEJS_HELPERS=0`. L'éviction Redis doit rester **désactivée**.

Point d'entrée Vercel : `api/index.js` (toutes les URL y sont routées par `vercel.json`, qui fournit aussi `public/` et `lib/` à la fonction).
Le dépôt GitHub doit contenir **tous** les dossiers : `api/`, `lib/`, `public/`, `scripts/` (et `deploy/`, `test/` pour le VPS).
Vérification avant envoi : `node test/vercel-check.js`. Sur Vercel sans Redis, les pages s'affichent mais l'API répond une erreur et le journal Vercel indique les variables manquantes.

Limites propres à Vercel : requêtes et réponses plafonnées à 4,5 Mo (imports, restaurations et téléchargements de sauvegarde volumineux). Pour un mot de passe oublié : `vercel env pull .env.prod --environment production`, charger ces variables dans le terminal, puis `node scripts/admin.js reset-password IDENTIFIANT`.

## Tests

```bash
npm test                  # 40 tests API : authentification, rôles, isolation des agences, pipeline, import/export, sauvegarde/restauration
node test/prod.test.js    # 11 tests en mode production : code d'initialisation, IP derrière Nginx, permissions, persistance, sauvegarde serveur
node test/redis.test.js   # 9 tests du mode Redis : deux instances, écritures simultanées, blocage partagé, instantanés, panne Redis, point d'entrée Vercel
node test/vercel-check.js # contrôle de déploiement Vercel : imports résolus, fichiers publiés, démarrage de la copie publiée
bash test/update.test.sh  # 8 tests de mise à jour avec retour arrière automatique (root, environnement jetable)
```

## Structure

```
api/index.js         point d'entrée Vercel (appelle server.js)
server.js            serveur HTTP + API (routes, contrôle d'accès)
lib/auth.js          hachage scrypt, sessions, anti-force brute
lib/db.js            base JSON (écriture atomique ou Redis), instantanés
lib/redis.js         client REST Upstash (mode Vercel)
lib/leads.js         logique prospects : périmètre, filtres, statistiques, import/export
lib/files.js         génération CSV / XLSX, lecture CSV
lib/constants.js     étapes, 58 wilayas, catégories, format +213 (partagé avec le navigateur)
scripts/admin.js     administration serveur (créer un superviseur, réinitialiser un mot de passe)
deploy/              installation VPS, sauvegarde, restauration, mise à jour
public/              interface (HTML, CSS, JS, traductions FR/AR, logo)
test/api.test.js     tests de bout en bout de l'API
```
