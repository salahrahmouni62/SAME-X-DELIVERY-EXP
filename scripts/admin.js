#!/usr/bin/env node
/* SAME X DELIVERY — server-side administration (run ON the server only).
 *   node scripts/admin.js create-supervisor      create a supervisor (works even if web setup is locked)
 *   node scripts/admin.js reset-password <login> set a new password and log that account out everywhere
 *   node scripts/admin.js list-users             list accounts (no passwords)
 * VPS (file mode): the CRM service must be stopped while this runs (the `samex-admin` wrapper does it for you).
 * Vercel (Redis mode): load the production variables first (vercel env pull), then run it from any computer;
 * the change is written atomically, the online CRM can keep running. */
const readline = require('readline');
const http = require('http');
const db = require('../lib/db');
const auth = require('../lib/auth');

const PORT = Number(process.env.PORT || 3000);

function serverRunning() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/health', timeout: 1500 }, (res) => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = function (s) { if (s.includes(question)) rl.output.write(s); else if (!/[\r\n]/.test(s)) rl.output.write('*'); else rl.output.write(s); };
    }
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a.trim()); });
  });
}

async function askPassword() {
  for (;;) {
    const p1 = await ask('Nouveau mot de passe : ', { hidden: true });
    const problem = auth.passwordProblem(p1);
    if (problem) { console.log('  ✘ 8 caractères minimum, avec des lettres ET des chiffres.'); continue; }
    const p2 = await ask('Confirmez le mot de passe : ', { hidden: true });
    if (p1 !== p2) { console.log('  ✘ Les deux mots de passe ne correspondent pas.'); continue; }
    return p1;
  }
}

(async () => {
  const [cmd, arg] = process.argv.slice(2);
  if (!['create-supervisor', 'reset-password', 'list-users'].includes(cmd)) {
    console.log('Usage : samex-admin create-supervisor | reset-password <identifiant> | list-users');
    process.exit(1);
  }
  if (db.MODE === 'unconfigured') { console.error('✘ Base non configurée (variables Redis manquantes ou invalides).\n' + db.describe()); process.exit(4); }
  if (db.MODE === 'file' && cmd !== 'list-users' && await serverRunning()) {
    console.error('✘ Le service CRM tourne encore. Utilisez la commande « sudo samex-admin ... » (elle l’arrête et le relance automatiquement).');
    process.exit(2);
  }
  console.log(`(base : ${db.MODE === 'redis' ? 'Redis / Vercel' : db.DATA_DIR})`);
  db.load();
  const users = await db.transaction(async () => db.col('users').map((u) => ({ ...u })));
  const auditCli = (action, detail) => db.insert('audit', { id: db.id('a'), at: new Date().toISOString(), userId: '', userName: 'Administration serveur', action, detail });

  if (cmd === 'list-users') {
    if (!users.length) console.log('Aucun compte. Lancez : sudo samex-admin create-supervisor');
    users.forEach((u) => console.log(`${u.active ? '●' : '○'} ${u.username.padEnd(20)} ${u.role === 'supervisor' ? 'Superviseur' : 'Agent      '}  ${u.name}`));
    process.exit(0);
  }

  if (cmd === 'create-supervisor') {
    console.log('=== Création d’un superviseur national SAME X DELIVERY ===');
    const name = await ask('Nom complet : ');
    let username;
    for (;;) {
      username = (await ask('Identifiant de connexion (ex. salah) : ')).toLowerCase();
      if (!/^[a-z0-9._-]{3,40}$/.test(username)) { console.log('  ✘ 3 à 40 caractères : lettres minuscules, chiffres, . _ -'); continue; }
      if (users.some((u) => u.username === username)) { console.log('  ✘ Cet identifiant existe déjà.'); continue; }
      break;
    }
    const passwordHash = auth.hashPassword(await askPassword());
    await db.transaction(async () => {
      if (db.col('users').some((u) => u.username === username)) throw new Error('Cet identifiant vient d’être créé par ailleurs.');
      db.insert('users', { id: db.id('u'), username, name: name || username, role: 'supervisor', agencyId: '', passwordHash,
        active: true, color: '#FFC800', createdAt: new Date().toISOString() });
      auditCli('supervisor_created_cli', username);
    });
    await db.flush();
    console.log(`✔ Superviseur « ${username} » créé. Vous pouvez vous connecter.`);
    process.exit(0);
  }

  if (cmd === 'reset-password') {
    const target = users.find((x) => x.username === String(arg || '').toLowerCase());
    if (!target) { console.error(`✘ Identifiant introuvable : ${arg || '(vide)'}. Voir : sudo samex-admin list-users`); process.exit(3); }
    console.log(`Réinitialisation du mot de passe de ${target.name} (${target.username})`);
    const passwordHash = auth.hashPassword(await askPassword());
    await db.transaction(async () => {
      const u = db.get('users', target.id);
      if (!u) throw new Error('Compte supprimé entre-temps.');
      u.passwordHash = passwordHash;
      u.active = true;
      auth.destroyUserSessions(u.id);
      auditCli('password_reset_cli', u.username);
      db.persist();
    });
    await db.flush();
    console.log('✔ Mot de passe changé (et compte réactivé si besoin). Les anciennes sessions sont fermées.');
    process.exit(0);
  }
})().catch((e) => { console.error('✘ ' + e.message); process.exit(1); });
