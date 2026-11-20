#!/usr/bin/env node
//
// Λέει τι είναι το FB_PAGE_TOKEN και πότε λήγει. ΔΕΝ το τυπώνει ποτέ.
//
// Τα GitHub Secrets είναι μονόδρομα: μόλις μπουν, κανείς δεν τα
// ξαναδιαβάζει. Αυτό όμως δεν σημαίνει ότι δεν μπορούμε να ρωτήσουμε
// το Facebook τι ξέρει για το token — αρκεί να τρέξουμε εκεί που το
// μυστικό είναι ήδη διαθέσιμο, δηλαδή μέσα στο workflow.
//
// Τοπικά: node fb-token.js   (διαβάζει το .env)
// Στα Actions: Έλεγχος token → Run workflow
//
// Αν βγει «Λήγει: ΠΟΤΕ», δεν χρειάζεται να κάνεις τίποτα άλλο.

const fs = require('fs');
const path = require('path');

const FB_VERSION = process.env.FB_API_VERSION || 'v23.0';

function readEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const clean = line.trim();
    if (!clean || clean.startsWith('#')) continue;
    const at = clean.indexOf('=');
    if (at === -1) continue;
    out[clean.slice(0, at).trim()] = clean.slice(at + 1).trim();
  }
  return out;
}

// Ό,τι τυπώνεται από εδώ είναι ασφαλές να το δει κόσμος: ποτέ το ίδιο
// το token, ούτε κομμάτι του.
function pote(sec) {
  if (!sec) return 'ΠΟΤΕ — είναι μόνιμο ✓';
  const d = new Date(sec * 1000);
  const meres = Math.round((d - Date.now()) / 86400000);
  return `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC  (σε ${meres} μέρες)`;
}

async function main() {
  const env = readEnv();
  const token = env.FB_PAGE_TOKEN || process.env.FB_PAGE_TOKEN || '';
  const appId = env.FB_APP_ID || process.env.FB_APP_ID || '';
  const appSecret = env.FB_APP_SECRET || process.env.FB_APP_SECRET || '';

  if (!token) {
    console.error('Δεν υπάρχει FB_PAGE_TOKEN — ούτε στο .env ούτε στο περιβάλλον.');
    return 1;
  }

  // Το /debug_token θέλει κάποιον να εγγυηθεί για το ερώτημα. Το app
  // token είναι η σωστή απάντηση, αλλά θέλει App Secret. Χωρίς αυτό
  // δοκιμάζουμε με το ίδιο το token, που συχνά αρκεί.
  const egyitis = appId && appSecret ? `${appId}|${appSecret}` : token;

  const url = `https://graph.facebook.com/${FB_VERSION}/debug_token`
    + `?input_token=${encodeURIComponent(token)}`
    + `&access_token=${encodeURIComponent(egyitis)}`;

  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));

  if (!res.ok || !body.data) {
    const minima = (body.error && body.error.message) || `HTTP ${res.status}`;
    console.error(`Το Facebook δεν απάντησε: ${minima}`);
    if (!appSecret) {
      console.error('Δοκίμασε ξανά με FB_APP_ID και FB_APP_SECRET — '
        + 'μερικά token δεν μπορούν να ρωτήσουν για τον εαυτό τους.');
    }
    return 1;
  }

  const d = body.data;

  console.log('Τύπος      :', d.type || '—');
  console.log('Σελίδα     :', d.profile_id || '—');
  console.log('Εφαρμογή   :', d.app_id || '—');
  console.log('Έγκυρο     :', d.is_valid ? 'ναι' : 'ΟΧΙ');
  console.log('Λήγει      :', pote(d.expires_at));
  if (d.data_access_expires_at) {
    console.log('Πρόσβαση σε δεδομένα λήγει:', pote(d.data_access_expires_at));
  }
  console.log('Δικαιώματα :', (d.scopes || []).join(', ') || '—');

  // Αυτά χρειάζεται ο fetcher των Reels και το ανέβασμα.
  for (const need of ['pages_read_engagement', 'pages_show_list', 'pages_manage_posts']) {
    if (!(d.scopes || []).includes(need)) {
      console.warn(`ΠΡΟΣΟΧΗ: λείπει το δικαίωμα ${need}`);
    }
  }

  if (!d.expires_at) return 0;

  console.warn('\nΤο token λήγει. Για μόνιμο: Explorer → ανταλλαγή με App Secret '
    + '→ /me/accounts. Το page token που βγαίνει από long-lived user token '
    + 'δεν έχει λήξη.');
  return 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('Σφάλμα:', err.message);
  process.exit(1);
});
