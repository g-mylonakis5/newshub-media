
const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://newshubmedia.gr';
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS = path.join(__dirname, 'uploads');

// How many we download at once. It is our own site behind Cloudflare,
// but there is no reason to hit it with 100 requests together.
const AT_ONCE = 4;

const ONOMA = /^[\w.-]+$/;

// Which images the pages we have built ask for.
function zitoumena() {
  const out = new Set();
  if (!fs.existsSync(PUBLIC_DIR)) return out;

  const stack = [PUBLIC_DIR];
  while (stack.length) {
    const dir = stack.pop();
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { stack.push(p); continue; }
      if (!e.name.endsWith('.html')) continue;
      const html = fs.readFileSync(p, 'utf8');
      for (const m of html.matchAll(/\/uploads\/([\w.-]+)/g)) out.add(m[1]);
    }
  }
  return out;
}

async function kateva(file) {
  const res = await fetch(`${SITE_URL}/uploads/${encodeURIComponent(file)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const bytes = Buffer.from(await res.arrayBuffer());
  if (!bytes.length) throw new Error('άδειο αρχείο');

  // We write ONLY if it really is an image or a video. If the site ever
  // answers with an error page and a 200, we do not want it saved as a
  // .jpg and then wonder why it will not open.
  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/') && !type.startsWith('video/')) {
    throw new Error(`δεν είναι εικόνα ούτε βίντεο (${type})`);
  }

  await fs.promises.writeFile(path.join(UPLOADS, file), bytes);
  return bytes.length;
}

async function main() {
  const zita = zitoumena();
  if (!zita.size) {
    console.log('Καμία φωτογραφία δεν ζητείται από τις σελίδες.');
    console.log('Μήπως δεν έχει τρέξει ακόμα το build; (npm run build:fast)');
    return;
  }

  fs.mkdirSync(UPLOADS, { recursive: true });
  const echoume = new Set(fs.readdirSync(UPLOADS));

  const leipoun = [...zita].filter((f) => !echoume.has(f) && ONOMA.test(f));

  console.log(`Ζητούνται ${zita.size}, υπάρχουν ${zita.size - leipoun.length}.`);
  if (!leipoun.length) {
    console.log('Δεν λείπει καμία — όλα δείχνουν σωστά τοπικά.');
    return;
  }

  console.log(`Κατεβάζω ${leipoun.length} από το ${SITE_URL}/uploads/ ...`);
  console.log();

  let ok = 0;
  let bytes = 0;
  const apotyxies = [];
  let next = 0;

  async function ergatis() {
    while (next < leipoun.length) {
      const file = leipoun[next++];
      try {
        const n = await kateva(file);
        ok++;
        bytes += n;
        console.log(`  ✓ ${file} (${Math.round(n / 1024)}KB)`);
      } catch (err) {
        apotyxies.push([file, err.message]);
        console.log(`  ✗ ${file} — ${err.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(AT_ONCE, leipoun.length) }, ergatis));

  console.log();
  console.log(`Κατέβηκαν ${ok} από ${leipoun.length}, ${Math.round(bytes / 1024)}KB συνολικά.`);

  // Failures do NOT fail the command: an image deleted from the library
  // while an article still asks for it will always 404, and there is no
  // reason for your terminal to go red over it every time.
  if (apotyxies.length) {
    console.log();
    console.log(`${apotyxies.length} δεν βρέθηκαν στον αέρα:`);
    for (const [f, why] of apotyxies) console.log(`  ${f} — ${why}`);
    console.log('Πιθανότατα σβήστηκαν από τη βιβλιοθήκη ενώ κάποιο άρθρο τις ζητάει ακόμα.');
  }
}

main().catch((err) => {
  console.error('Απέτυχε:', err.message);
  process.exitCode = 1;
});
