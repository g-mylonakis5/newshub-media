// Κατεβάζει τοπικά τις φωτογραφίες των άρθρων που λείπουν.
//
// ΓΙΑΤΙ ΧΡΕΙΑΖΕΤΑΙ
//
// Οι φωτογραφίες που ανεβάζουν οι δημοσιογράφοι ΔΕΝ περνούν από το
// git — δες το σχόλιο στο .gitignore για το γιατί. Ζουν σε δύο
// χωριστά μέρη, ανάλογα με το πού ανέβηκαν:
//
//   από το διαχειριστικό στον αέρα  ->  Cloudflare R2
//   από το τοπικό διαχειριστικό     ->  ο φάκελος uploads/ εδώ
//
// Η διεύθυνση είναι ΙΔΙΑ και στα δύο (/uploads/<αρχείο>), οπότε ένα
// άρθρο δείχνει σωστά όπου κι αν γράφτηκε. Αυτό όμως σημαίνει ότι
// τοπικά λείπει ό,τι ανέβηκε από τον αέρα: η σελίδα το ζητάει, ο
// serve.js δεν το βρίσκει, και βλέπεις σπασμένη εικόνα σε σημείο που
// στον αέρα είναι μια χαρά. Μοιάζει με βλάβη ενώ δεν είναι.
//
// Αυτό το αρχείο κλείνει το κενό: κοιτάζει ΤΙ ζητούν οι χτισμένες
// σελίδες, βλέπει τι λείπει, και το κατεβάζει από το ίδιο μας το
// site — όπου είναι ήδη δημόσιο.
//
//   node sync-uploads.js
//
// Δεν σβήνει και δεν ξαναγράφει τίποτα: ό,τι υπάρχει ήδη τοπικά
// μένει ανέπαφο. Τρέξε το μετά από «git pull» ή μετά από build, όποτε
// δεις σπασμένες φωτογραφίες τοπικά.

const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://newshubmedia.gr';
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOADS = path.join(__dirname, 'uploads');

// Όσα κατεβάζουμε ταυτόχρονα. Είναι το δικό μας site πίσω από την
// Cloudflare, αλλά δεν υπάρχει λόγος να του ρίξουμε 100 αιτήσεις μαζί.
const AT_ONCE = 4;

// Το ίδιο φίλτρο ονόματος με το admin-api.js και το functions/uploads/:
// γράμματα, αριθμοί, παύλα, τελεία. Ό,τι άλλο δεν είναι δικό μας
// όνομα αρχείου και δεν το αγγίζουμε — ένα «..» εδώ θα έγραφε έξω
// από τον φάκελο.
const ONOMA = /^[\w.-]+$/;

// Ποιες φωτογραφίες ζητούν οι σελίδες που έχουμε χτίσει.
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

  // Γράφουμε ΜΟΝΟ αν είναι όντως εικόνα. Αν κάποτε το site απαντήσει
  // με σελίδα σφάλματος και κωδικό 200, δεν θέλουμε να σωθεί ως .jpg
  // και να ψάχνουμε μετά γιατί δεν ανοίγει.
  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/')) throw new Error(`δεν είναι εικόνα (${type})`);

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

  // Οι αποτυχίες ΔΕΝ ρίχνουν την εντολή: μια φωτογραφία που σβήστηκε
  // από τη βιβλιοθήκη ενώ το άρθρο τη ζητάει ακόμα θα δίνει πάντα 404,
  // και δεν υπάρχει λόγος να κοκκινίζει το τερματικό σου κάθε φορά.
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
