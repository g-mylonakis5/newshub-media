// admin-api.js — η λογική του διαχειριστικού, ΜΙΑ φορά.
//
// Το ίδιο αρχείο εξυπηρετεί δύο κόσμους:
//
//   τοπικά      — το serve.js το φωνάζει, και γράφει κατευθείαν στα
//                 αρχεία του φακέλου data/
//   στον αέρα   — μια Cloudflare Pages Function το φωνάζει, και το ίδιο
//                 αίτημα καταλήγει σε commit στο git
//
// Αυτό που αλλάζει είναι ΜΟΝΟ ο «αποθηκευτής» (store) που του δίνουμε.
// Η διεπαφή δεν ξέρει ποιος από τους δύο τρέχει, οπότε ό,τι δοκιμάσουμε
// στο μηχάνημά μας δουλεύει ίδια και στον αέρα.
//
// ΑΣΦΑΛΕΙΑ: εδώ μέσα ΔΕΝ υπάρχει έλεγχος ταυτότητας, επίτηδες. Τοπικά
// δεν χρειάζεται (ακούει μόνο στο localhost)· στον αέρα τον κάνει το
// Cloudflare Access ΠΡΙΝ φτάσει το αίτημα εδώ. Αν ποτέ μπει τρίτος
// δρόμος προς αυτές τις συναρτήσεις, ο έλεγχος μπαίνει ΕΚΕΙ.

'use strict';

// Τα μόνα αρχεία που επιτρέπεται να γραφτούν.
//
// Λίστα, όχι μοτίβο: χωρίς αυτήν, ένα όνομα σαν «../../package» θα
// έγραφε όπου ήθελε. Το ότι σήμερα μόνο εμείς στέλνουμε αιτήματα δεν
// είναι λόγος να λείπει ο έλεγχος — αύριο θα είναι στον αέρα.
const WRITABLE = new Set([
  'curation',        // πρωτοσέλιδο, δευτερεύοντα, κατηγορίες, θέματα
  'people-aliases',  // ποια ονόματα είναι ο ίδιος άνθρωπος
  'shows',           // οι εκπομπές
  'show-art',        // οι αφίσες τους
  'articles',        // τα δικά μας άρθρα
]);

// Αρχεία που διαβάζονται αλλά ΔΕΝ γράφονται: τα παράγουν τα fetch-*.js
// από τις πηγές, και ό,τι γράψουμε εδώ θα χανόταν στο επόμενο τρέξιμο.
const READABLE = new Set([
  ...WRITABLE,
  'episodes',
  'videos',
  'news',
  'shows',
]);

function isReadable(name){ return READABLE.has(name); }
function isWritable(name){ return WRITABLE.has(name); }

// ---------------------------------------------------------------------
// Έλεγχοι περιεχομένου
// ---------------------------------------------------------------------

// Το JSON που φτάνει από τον browser ΔΕΝ εμπιστευόμαστε ότι είναι σωστό.
// Ένα χαλασμένο curation.json ρίχνει ολόκληρο το build, και το λάθος
// φαίνεται μόνο όταν το site δεν ανανεωθεί.
function validate(name, data){
  if (data === null || typeof data !== 'object') {
    return 'Το περιεχόμενο πρέπει να είναι αντικείμενο ή λίστα.';
  }

  if (name === 'curation') {
    if (Array.isArray(data)) return 'Το curation πρέπει να είναι αντικείμενο.';

    // Η δικλείδα του curation.json: χειροκίνητη επιλογή ΧΩΡΙΣ ημερομηνία
    // λήξης παγώνει την αρχική για πάντα, και κανείς δεν το προσέχει
    // μέχρι να παραπονεθεί κάποιος ότι «το site κόλλησε».
    if (data.featured && !data.featuredUntil) {
      return 'Η χειροκίνητη επιλογή πρωτοσέλιδου χρειάζεται ημερομηνία λήξης.';
    }
    if (data.featuredUntil && !/^\d{4}-\d{2}-\d{2}$/.test(data.featuredUntil)) {
      return 'Η ημερομηνία λήξης γράφεται ΕΕΕΕ-ΜΜ-ΗΗ.';
    }
    if (data.secondary && !Array.isArray(data.secondary)) {
      return 'Τα δευτερεύοντα πρέπει να είναι λίστα.';
    }
  }

  if (name === 'articles' && !Array.isArray(data)) {
    return 'Τα άρθρα πρέπει να είναι λίστα.';
  }

  if (name === 'people-aliases') {
    if (Array.isArray(data)) return 'Τα πρόσωπα πρέπει να είναι αντικείμενο.';

    // Κάθε κλειδί χωριστά: ένα χαλασμένο people-aliases.json δεν ρίχνει
    // το build — το build το πιάνει σε try και συνεχίζει — αλλά ΣΒΗΝΕΙ
    // σιωπηλά όλες τις ενώσεις, και 39 άνθρωποι ξαναγίνονται 78 σελίδες
    // χωρίς να το δει κανείς.
    if (data.aliases != null) {
      if (typeof data.aliases !== 'object' || Array.isArray(data.aliases)) {
        return 'Οι ενώσεις πρέπει να είναι αντικείμενο.';
      }
      for (const [canonical, list] of Object.entries(data.aliases)) {
        if (!Array.isArray(list)) {
          return `Οι γραφές του «${canonical}» πρέπει να είναι λίστα.`;
        }
        // Όνομα ενωμένο με τον εαυτό του φτιάχνει βρόχο στο build.
        if (list.some((v) => v === canonical)) {
          return `Το «${canonical}» δεν ενώνεται με τον εαυτό του.`;
        }
      }
    }
    if (data.not_people != null && !Array.isArray(data.not_people)) {
      return 'Το not_people πρέπει να είναι λίστα.';
    }
    if (data.roles != null && (typeof data.roles !== 'object' || Array.isArray(data.roles))) {
      return 'Οι ιδιότητες πρέπει να είναι αντικείμενο.';
    }
    if (data.titles != null && !Array.isArray(data.titles)) {
      return 'Το titles πρέπει να είναι λίστα.';
    }
  }

  return '';
}

// ---------------------------------------------------------------------
// Οι ενέργειες
// ---------------------------------------------------------------------

// Κάθε ενέργεια παίρνει έναν store με δύο μεθόδους:
//   read(name)         -> Promise<string>   το περιεχόμενο του αρχείου
//   write(name, text, message) -> Promise<void>
//
// Τίποτα άλλο. Έτσι ο τοπικός store είναι δέκα γραμμές, και ο store του
// git δεν αλλάζει ούτε μία γραμμή αυτού του αρχείου.

async function readData(store, name){
  if (!isReadable(name)) {
    return { status: 404, body: { error: `Άγνωστο αρχείο: ${name}` } };
  }

  try {
    const text = await store.read(name);
    return { status: 200, body: JSON.parse(text) };
  } catch (err) {
    if (err.code === 'ENOENT') return { status: 200, body: null };
    return { status: 500, body: { error: `Δεν διαβάζεται: ${err.message}` } };
  }
}

async function writeData(store, name, data, who){
  if (!isWritable(name)) {
    return { status: 403, body: { error: `Δεν γράφεται: ${name}` } };
  }

  const problem = validate(name, data);
  if (problem) return { status: 400, body: { error: problem } };

  // Δύο κενά, όπως γράφονται τα αρχεία με το χέρι: έτσι το git diff
  // δείχνει ΤΙ άλλαξε, αντί για μία τεράστια γραμμή.
  const text = JSON.stringify(data, null, 2) + '\n';
  const message = `${name}: αλλαγή από το διαχειριστικό${who ? ` (${who})` : ''}`;

  try {
    await store.write(name, text, message);
    return { status: 200, body: { ok: true } };
  } catch (err) {
    return { status: 500, body: { error: `Δεν αποθηκεύτηκε: ${err.message}` } };
  }
}

// ---------------------------------------------------------------------
// Εικόνες
// ---------------------------------------------------------------------
//
// ΔΕΝ περνούν από το git, επίτηδες. Δύο λόγοι, και οι δύο μετρημένοι:
//
//   · Το Cloudflare Pages δέχεται 20.000 αρχεία και το public/ έχει ήδη
//     9.726. Τρεις φωτογραφίες ανά άρθρο τελειώνουν το περιθώριο.
//   · Τα binary αρχεία δεν συμπιέζονται στο ιστορικό του git: ό,τι
//     ανέβει μένει για πάντα, ακόμα κι αν σβηστεί. Το repo είναι ήδη
//     132MB.
//
// Πάνε σε ξεχωριστό χώρο (τοπικά φάκελος, στον αέρα Cloudflare R2) και
// σερβίρονται από το /uploads/. Η διεύθυνση είναι ΙΔΙΑ και στα δύο,
// ώστε ένα άρθρο γραμμένο τοπικά να δείχνει σωστά και στον αέρα.

// Τι δεχόμαστε. Ο browser στέλνει ήδη συμπιεσμένο JPEG ή WebP — δες
// τη shrink() στο admin.js — οπότε ό,τι άλλο φτάνει εδώ είναι λάθος.
const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/png': 'png',
};

// 4MB μετά τη συμπίεση. Μια φωτογραφία ρεπορτάζ βγαίνει 150-400KB·
// οτιδήποτε δεκαπλάσιο σημαίνει ότι κάτι δεν δούλεψε.
const MAX_IMAGE = 4 * 1024 * 1024;

// Καθαρό όνομα αρχείου από αυτό που έδωσε ο χρήστης.
//
// Ο συντάκτης ανεβάζει «Φωτογραφία ΔΕΗ (1).JPG». Κρατάμε κάτι
// αναγνωρίσιμο για να ξεχωρίζει μετά στη βιβλιοθήκη, αλλά περασμένο
// από φίλτρο: χωρίς αυτό, ένα όνομα με ../ γράφει έξω από τον φάκελο.
// Ελληνικά -> λατινικά. ΟΧΙ για ομορφιά: ένα όνομα αρχείου με ελληνικά
// ταξιδεύει στη διεύθυνση ως %CF%86%CE%B1... και αρκεί ένα εργαλείο στη
// μέση που δεν το αποκωδικοποιεί σωστά για να σπάσει η εικόνα μέσα στο
// άρθρο. Τα ονόματα είναι μόνιμα — δεν αλλάζουν μετά τη δημοσίευση.
const GREEK_MAP = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th',
  ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p',
  ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
};

function imageName(original, stamp){
  const base = String(original || 'foto')
    .replace(/\.[^.]*$/, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // πρώτα οι τόνοι
    .toLowerCase()
    .split('').map((ch) => GREEK_MAP[ch] || ch).join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '') || 'foto';

  return `${stamp}-${base}`;
}

async function saveImage(store, { bytes, type, name }){
  const ext = IMAGE_TYPES[type];
  if (!ext) {
    return { status: 400, body: { error: 'Δεκτές μόνο φωτογραφίες JPG, PNG ή WebP.' } };
  }
  if (!bytes || !bytes.length) {
    return { status: 400, body: { error: 'Άδειο αρχείο.' } };
  }
  if (bytes.length > MAX_IMAGE) {
    return { status: 400, body: { error: 'Η φωτογραφία είναι πολύ μεγάλη.' } };
  }

  // Η χρονοσφραγίδα μπροστά κρατάει τη βιβλιοθήκη ταξινομημένη και
  // αποτρέπει δύο φωτογραφίες με το ίδιο όνομα να πατήσουν η μία την
  // άλλη — συμβαίνει συνέχεια με «image.jpg» από κινητό.
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  const file = `${imageName(name, stamp)}.${ext}`;

  try {
    await store.putImage(file, bytes, type);
    return { status: 200, body: { ok: true, url: `/uploads/${file}`, name: file } };
  } catch (err) {
    return { status: 500, body: { error: `Δεν ανέβηκε: ${err.message}` } };
  }
}

async function listImages(store){
  try {
    const files = await store.listImages();
    return { status: 200, body: files.map((f) => ({ name: f, url: `/uploads/${f}` })) };
  } catch (err) {
    return { status: 500, body: { error: err.message } };
  }
}

module.exports = {
  readData, writeData, saveImage, listImages,
  isReadable, isWritable, validate,
  WRITABLE, IMAGE_TYPES, MAX_IMAGE, imageName,
};
