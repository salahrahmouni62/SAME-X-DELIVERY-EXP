# Mettre SAME X DELIVERY CRM en ligne — guide pas à pas (Windows)

Durée : environ 45 minutes, dont 5 à 30 minutes d'attente pour le domaine.
Vous n'avez rien à programmer : vous copiez-collez des commandes.

---

## Ce qu'il vous faut

| Élément | Détail |
|---|---|
| **Un VPS** | Ubuntu **24.04**, 1 processeur, 2 Go de RAM, 20 Go de disque minimum. Fournisseurs possibles : Hetzner, OVH, Contabo, ou tout hébergeur qui propose Ubuntu 24.04. Notez son **adresse IP** et le **mot de passe root**. |
| **Un nom de domaine** | Par exemple `samexdelivery.com`, avec accès à sa zone DNS (chez le registrar où vous l'avez acheté). |
| **Une adresse email** | Pour le certificat HTTPS (avis d'expiration). |
| **Le fichier** | `samex-delivery-crm.zip`, enregistré dans votre dossier **Téléchargements**. |

> Conseil : chez votre hébergeur, activez aussi les **sauvegardes / snapshots automatiques du VPS** si l'option existe. C'est une sécurité supplémentaire.

---

## Étape 1 — Faire pointer le domaine vers le VPS

Dans l'espace client de votre registrar, ouvrez la **zone DNS** de votre domaine et ajoutez un enregistrement :

| Type | Nom / Hôte | Valeur | TTL |
|---|---|---|---|
| **A** | `crm` | l'adresse IP de votre VPS | 3600 (ou par défaut) |

L'adresse du CRM sera alors `https://crm.samexdelivery.com`. Le changement prend en général 5 à 30 minutes.

---

## Étape 2 — Envoyer l'application sur le VPS

Sur Windows, ouvrez **PowerShell** (touche Windows, tapez « PowerShell », Entrée).
Copiez-collez cette commande en remplaçant `IP_DU_VPS` par l'adresse IP de votre VPS :

```powershell
scp "$env:USERPROFILE\Downloads\samex-delivery-crm.zip" root@IP_DU_VPS:/root/
```

- À la première connexion, Windows demande « Are you sure you want to continue connecting? » : tapez `yes` puis Entrée.
- Tapez le mot de passe root (rien ne s'affiche quand vous tapez, c'est normal), puis Entrée.

---

## Étape 3 — Se connecter au VPS

Toujours dans PowerShell :

```powershell
ssh root@IP_DU_VPS
```

Tapez le mot de passe root. Vous êtes maintenant « dans » le serveur : la ligne commence par `root@...`.

---

## Étape 4 — Installer le CRM (une seule commande)

Remplacez le domaine et l'email par les vôtres, puis copiez-collez :

```bash
cd /root && python3 -m zipfile -e samex-delivery-crm.zip /root/ && bash /root/samex-delivery-crm/deploy/install.sh crm.samexdelivery.com votre@email.com
```

Le script fait tout automatiquement (9 étapes affichées en jaune) : Node.js, service avec redémarrage automatique, base de données persistante, sauvegardes de chaque nuit, Nginx, pare-feu, certificat HTTPS.

**À la fin**, il affiche :

```
SAME X DELIVERY CRM est en ligne : https://crm.samexdelivery.com
Code d'initialisation (à usage unique, ne le partagez pas) :
      3f9a1c...
```

> **Si le script indique « Le domaine ne pointe pas encore vers ce serveur »** : l'étape 1 n'est pas encore active. Attendez 15 minutes et relancez **exactement la même commande**. C'est sans danger.

---

## Étape 5 — Créer votre compte superviseur

1. Ouvrez `https://crm.samexdelivery.com` dans Chrome ou Edge.
2. Collez le **code d'initialisation** affiché à l'étape 4.
3. Choisissez votre nom, votre identifiant et un mot de passe solide (8 caractères minimum, lettres et chiffres).

Personne d'autre ne peut créer ce compte sans ce code.

---

## Étape 6 — Créer les agences et les agents

Dans le CRM :
1. **Agences & Hubs** → *Nouvelle agence* (nom, wilaya principale, wilayas couvertes).
2. **Utilisateurs** → *Nouvel utilisateur* → rôle *Agent terrain*, choisir son agence, définir un mot de passe provisoire.
3. Envoyez à chaque agent : l'adresse du CRM, son identifiant, son mot de passe provisoire. Il pourra le changer avec l'icône clé (🔑) en bas du menu.

**Sur téléphone (iPhone / Android)** : ouvrez l'adresse dans Safari ou Chrome, puis « Ajouter à l'écran d'accueil ». Le CRM s'ouvre alors comme une application.

---

## Étape 7 — Vérifications avant d'utiliser le CRM

Faites ces tests une fois (10 minutes). Cochez au fur et à mesure.

- [ ] **Connexion** : déconnectez-vous, reconnectez-vous. Un mauvais mot de passe affiche « Identifiants incorrects ».
- [ ] **Prospect** : créez un prospect test avec un numéro `0550 12 34 56` → il s'affiche en `+213 5 50 12 34 56`.
- [ ] **Permissions** : connectez-vous avec un compte agent (sur votre téléphone par exemple) → il ne voit ni *Utilisateurs* ni *Agences*, et uniquement ses propres prospects.
- [ ] **Filtres** : filtrez par wilaya, par agence, cherchez un numéro de téléphone.
- [ ] **Export** : bouton *Excel* en bas du menu → le fichier s'ouvre dans Excel.
- [ ] **Import** : *Importer* → choisissez le fichier exporté → « doublons ignorés ».
- [ ] **Sauvegarde** : *Sauvegarde & Données* → *Télécharger une sauvegarde*. Gardez ce fichier sur votre PC.
- [ ] **Téléphone** : ouvrez le CRM en 4G (Wi-Fi coupé) sur un smartphone.
- [ ] **Persistance** : sur le serveur, tapez `sudo samex-admin restart`, puis rechargez la page → vos données sont toujours là.

Supprimez ensuite le prospect test.

---

## Administration au quotidien

Connectez-vous au serveur avec `ssh root@IP_DU_VPS`, puis :

| Besoin | Commande |
|---|---|
| Voir si le CRM fonctionne | `sudo samex-admin status` |
| Voir les comptes | `sudo samex-admin list-users` |
| **Mot de passe oublié** (y compris le vôtre) | `sudo samex-admin reset-password IDENTIFIANT` |
| Créer un superviseur supplémentaire | `sudo samex-admin create-supervisor` |
| Redémarrer le CRM | `sudo samex-admin restart` |
| Voir les erreurs récentes | `sudo samex-admin logs` |
| Faire une sauvegarde immédiate | `sudo samex-backup` |
| Lister / restaurer une sauvegarde | `sudo samex-restore` puis `sudo samex-restore NOM_DU_FICHIER` |

Les mots de passe des agents se changent aussi directement dans le CRM (*Utilisateurs* → *Modifier*).

---

## Sauvegardes

Trois niveaux de protection, déjà actifs :

1. **Chaque nuit à 02:30**, une archive est créée dans `/var/backups/samex-crm` (30 jours conservés).
2. **Instantanés internes** quotidiens, visibles dans *Sauvegarde & Données* (restauration en un clic).
3. **Avant chaque mise à jour ou restauration**, une copie de sécurité automatique.

**Une fois par semaine**, rapatriez une copie sur votre PC (en cas de panne totale du VPS). Dans PowerShell, **sur votre PC** (pas dans le serveur) :

```powershell
scp root@IP_DU_VPS:/var/backups/samex-crm/* "$env:USERPROFILE\Documents\"
```

Ou bien : dans le CRM, *Sauvegarde & Données* → *Télécharger une sauvegarde*.

Ces fichiers contiennent les données de vos prospects : gardez-les dans un endroit protégé.

---

## Mettre à jour l'application

Quand vous recevez une nouvelle version `samex-delivery-crm.zip` :

1. Sur votre PC (PowerShell) : `scp "$env:USERPROFILE\Downloads\samex-delivery-crm.zip" root@IP_DU_VPS:/root/`
2. Sur le serveur : `sudo samex-update /root/samex-delivery-crm.zip`

La mise à jour fait une sauvegarde, installe la nouvelle version et vérifie qu'elle fonctionne.
**Si elle ne démarre pas, l'ancienne version est remise automatiquement.** Les données ne sont jamais touchées.

---

## Sécurité — bonnes pratiques

- Changez le mot de passe root du VPS s'il vous a été envoyé par email : `passwd`.
- Ne partagez jamais le fichier `/etc/samex-crm/samex-crm.env` ni les fichiers de sauvegarde.
- Désactivez immédiatement le compte d'un agent qui quitte l'entreprise (*Utilisateurs* → *Désactiver*) : il est déconnecté sur-le-champ.
- Le serveur installe seul les mises à jour de sécurité d'Ubuntu, bloque les attaques par force brute (fail2ban) et n'ouvre que les ports 22, 80 et 443.
- Données personnelles : le CRM contient des noms et numéros de téléphone. Renseignez-vous sur vos obligations au titre de la loi algérienne n° 18-07 sur la protection des données personnelles (ANPDP), notamment si le VPS est hébergé hors d'Algérie.

---

## En cas de problème

| Symptôme | Solution |
|---|---|
| La page ne s'ouvre pas | `sudo samex-admin status`, puis `sudo samex-admin restart`. Si ça persiste : `sudo samex-admin logs` et envoyez le résultat à votre support. |
| « Domaine ne pointe pas » pendant l'installation | Vérifiez l'enregistrement **A** (étape 1), attendez, relancez la commande d'installation. |
| Code d'initialisation perdu | `sudo grep SETUP_TOKEN /etc/samex-crm/samex-crm.env` (valable tant que le superviseur n'est pas créé). Sinon : `sudo samex-admin create-supervisor`. |
| Mot de passe superviseur oublié | `sudo samex-admin reset-password VOTRE_IDENTIFIANT` |
| « Trop de tentatives » à la connexion | Attendez 15 minutes, ou réinitialisez le mot de passe. |
| Erreur de certificat HTTPS | `sudo certbot renew --dry-run` pour tester le renouvellement. |
