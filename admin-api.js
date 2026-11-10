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
  'pairs',           // ποιο βίντεο και ποιος καλεσμένος πάει σε ποιο επεισόδιο
  'photos',          // ποιες φωτογραφίες είναι «στάνταρ»
  'writers',         // τα πορτρέτα των αρθρογράφων του newshub.gr
  'ads',             // οι διαφημίσεις των συνεργατών
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

    // Τα καρφιτσωμένα της ροής. ΔΕΝ ζητάμε ημερομηνία λήξης εδώ — το
    // νόημά τους είναι ακριβώς να μένουν όσο χρειάζεται. Ελέγχουμε όμως
    // ότι είναι λίστα από κείμενα: ένα αντικείμενο μέσα εδώ θα έσκαγε
    // στο sameItem() και θα έριχνε ολόκληρο το build.
    if (data.latest != null) {
      if (!Array.isArray(data.latest)) {
        return 'Τα καρφιτσωμένα της ροής πρέπει να είναι λίστα.';
      }
      if (data.latest.some((x) => typeof x !== 'string')) {
        return 'Κάθε καρφιτσωμένο πρέπει να είναι σύνδεσμος ή κωδικός, σε κείμενο.';
      }
    }

    // Η σειρά των Απόψεων. Ίδιος έλεγχος, ίδιος λόγος: ένα αντικείμενο
    // εδώ μέσα θα έσκαγε στο sameItem() και θα έριχνε το build.
    if (data.opinions != null) {
      if (!Array.isArray(data.opinions)) {
        return 'Οι απόψεις πρέπει να είναι λίστα.';
      }
      if (data.opinions.some((x) => typeof x !== 'string')) {
        return 'Κάθε άποψη πρέπει να είναι σύνδεσμος, σε κείμενο.';
      }
    }
  }

  if (name === 'photos') {
    if (Array.isArray(data)) return 'Οι φωτογραφίες πρέπει να είναι αντικείμενο.';
    if (data.standard != null) {
      if (!Array.isArray(data.standard)) {
        return 'Οι στάνταρ φωτογραφίες πρέπει να είναι λίστα.';
      }
      // Ονόματα αρχείων, τίποτα άλλο. Μια διαδρομή με «/» ή «..» εδώ
      // δεν σπάει τίποτα σήμερα, αλλά η λίστα διαβάζεται για να βρεθεί
      // αρχείο στο R2 — και δεν αφήνουμε να μπει τέτοιο σχήμα.
      for (const n of data.standard) {
        if (typeof n !== 'string' || !/^[\w.-]+$/.test(n)) {
          return 'Κάθε στάνταρ φωτογραφία πρέπει να είναι σκέτο όνομα αρχείου.';
        }
      }
    }
  }

  // Τα πορτρέτα των αρθρογράφων. Ίδιος κανόνας με τις αφίσες εκπομπών:
  // μόνο αρχεία του δικού μας /uploads/ — η φωτογραφία ενός ανθρώπου
  // δεν τραβιέται από ξένη διεύθυνση που μπορεί να αλλάξει αύριο.
  //
  // Όποιο όνομα ΔΕΝ γράφεται εδώ, κρατάει τη φωτογραφία που κατέβηκε
  // από το newshub.gr — δες writerPhoto() στο build.js.
  if (name === 'writers') {
    if (Array.isArray(data)) return 'Οι αρθρογράφοι πρέπει να είναι αντικείμενο.';
    if (data.photos != null) {
      if (typeof data.photos !== 'object' || Array.isArray(data.photos)) {
        return 'Τα πορτρέτα πρέπει να είναι αντικείμενο «όνομα: διεύθυνση».';
      }
      for (const [who, url] of Object.entries(data.photos)) {
        if (typeof url !== 'string' || !/^\/uploads\/[\w.-]+$/.test(url)) {
          return `Η φωτογραφία του «${who}» πρέπει να είναι αρχείο του /uploads/.`;
        }
      }
    }
  }

  // Οι διαφημίσεις. Εδώ ο έλεγχος είναι ΑΥΣΤΗΡΟΣ, πιο αυστηρός από
  // παντού αλλού: ό,τι γράφεται εδώ γίνεται σύνδεσμος και εικόνα σε
  // 4.700 σελίδες, και μια διαφήμιση είναι ο ευκολότερος τρόπος να
  // μπει ξένο περιεχόμενο σε ένα site.
  if (name === 'ads') {
    if (Array.isArray(data)) return 'Οι διαφημίσεις πρέπει να είναι αντικείμενο με «ads».';
    if (!Array.isArray(data.ads)) return 'Λείπει η λίστα «ads».';

    for (const a of data.ads) {
      if (a === null || typeof a !== 'object' || Array.isArray(a)) {
        return 'Κάθε διαφήμιση πρέπει να είναι αντικείμενο.';
      }

      const who = a.partner ? `«${a.partner}»` : 'μιας διαφήμισης';

      if (typeof a.partner !== 'string' || !a.partner.trim()) {
        return 'Κάθε διαφήμιση χρειάζεται όνομα συνεργάτη.';
      }

      // Η εικόνα ΜΟΝΟ από το δικό μας /uploads/. Ξένη διεύθυνση θα
      // σήμαινε ότι ο συνεργάτης αλλάζει το creative χωρίς να το
      // δούμε, και ότι ο server του μετράει τους αναγνώστες μας.
      if (typeof a.image !== 'string' || !/^\/uploads\/[\w.-]+$/.test(a.image)) {
        return `Η εικόνα ${who} πρέπει να είναι αρχείο του /uploads/.`;
      }

      // Ο σύνδεσμος φεύγει έξω, άρα μόνο http(s) — ποτέ javascript:
      if (typeof a.url !== 'string' || !/^https?:\/\/[^\s"']+$/.test(a.url)) {
        return `Ο σύνδεσμος ${who} πρέπει να ξεκινά με http:// ή https://`;
      }

      if (!Array.isArray(a.places) || !a.places.length) {
        return `Η διαφήμιση ${who} δεν έχει καμία θέση.`;
      }
      if (a.places.some((p) => typeof p !== 'string' || !/^[\w-]+$/.test(p))) {
        return `Άκυρη θέση στη διαφήμιση ${who}.`;
      }

      for (const field of ['from', 'to']) {
        if (a[field] && !/^\d{4}-\d{2}-\d{2}$/.test(a[field])) {
          return `Η ημερομηνία «${field}» ${who} γράφεται ΕΕΕΕ-ΜΜ-ΗΗ.`;
        }
      }
      if (a.from && a.to && a.from > a.to) {
        return `Η διαφήμιση ${who} τελειώνει πριν αρχίσει.`;
      }

      if (a.status && a.status !== 'on' && a.status !== 'off') {
        return `Άγνωστη κατάσταση στη διαφήμιση ${who}.`;
      }
    }
  }

  if (name === 'articles' && !Array.isArray(data)) {
    return 'Τα άρθρα πρέπει να είναι λίστα.';
  }

  if (name === 'shows') {
    if (Array.isArray(data)) return 'Οι εκπομπές πρέπει να είναι αντικείμενο.';
    for (const [show, v] of Object.entries(data)) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) {
        return `Η εκπομπή «${show}» πρέπει να είναι αντικείμενο.`;
      }
      if (v.description != null && typeof v.description !== 'string') {
        return `Η περιγραφή της «${show}» πρέπει να είναι κείμενο.`;
      }
      if (v.playlist != null && typeof v.playlist !== 'string') {
        return `Το playlist της «${show}» πρέπει να είναι κείμενο.`;
      }
    }
  }

  if (name === 'show-art') {
    if (Array.isArray(data)) return 'Οι αφίσες πρέπει να είναι αντικείμενο.';

    // Το build διαβάζει ΜΟΝΟ το data.art. Αν χαθεί, δεν σκάει τίποτα —
    // απλώς κάθε εκπομπή μένει χωρίς αφίσα, σιωπηλά. Γι' αυτό ο έλεγχος.
    if (data.art == null || typeof data.art !== 'object' || Array.isArray(data.art)) {
      return 'Λείπει το «art» με την αντιστοίχιση εκπομπής σε αφίσα.';
    }
    for (const [show, v] of Object.entries(data.art)) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) {
        return `Η αφίσα της «${show}» πρέπει να είναι αντικείμενο.`;
      }
      // Η ανεβασμένη φωτογραφία. Μόνο διεύθυνση του δικού μας /uploads/:
      // ο,τιδήποτε αλλού θα έβαζε ξένο εικονοστοιχείο σε 4.700 σελίδες,
      // και η αφίσα της εκπομπής φαίνεται σχεδόν παντού.
      if (v.url != null && v.url !== '') {
        if (typeof v.url !== 'string' || !/^\/uploads\/[\w.-]+$/.test(v.url)) {
          return `Η φωτογραφία της «${show}» πρέπει να είναι αρχείο του /uploads/.`;
        }
      }

      // Το όνομα γίνεται διαδρομή αρχείου στο public/shows/. Όταν
      // υπάρχει ανεβασμένη φωτογραφία, το έτοιμο αρχείο μπορεί να
      // λείπει εντελώς — αλλιώς δεν θα μπορούσε να μπει αφίσα σε
      // εκπομπή που δεν έχει webp φτιαγμένο με το χέρι.
      const hasFile = typeof v.file === 'string' && v.file !== '';
      if (hasFile && !/^[\w-]+$/.test(v.file)) {
        return `Άκυρο όνομα αφίσας στην «${show}».`;
      }
      if (!hasFile && !v.url) {
        return `Η αφίσα της «${show}» χρειάζεται αρχείο ή φωτογραφία.`;
      }
    }
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

    // Τα πορτρέτα. Η τιμή μπαίνει αυτούσια σε src εικόνας, οπότε δεν
    // δεχόμαστε ό,τι να 'ναι: μόνο διεύθυνση μέσα στο site μας ή στον
    // δικό μας χώρο φωτογραφιών. Ένα «javascript:» ή ένα ξένο domain
    // εδώ θα ήταν τρύπα, όχι απλώς λάθος εικόνα.
    if (data.photos != null) {
      if (typeof data.photos !== 'object' || Array.isArray(data.photos)) {
        return 'Τα πορτρέτα πρέπει να είναι αντικείμενο.';
      }
      for (const [who, url] of Object.entries(data.photos)) {
        if (url === '' || url === null) continue;   // «βγάλ' την»
        if (typeof url !== 'string' || !/^\/uploads\/[\w.-]+$/.test(url)) {
          return `Η φωτογραφία του «${who}» πρέπει να είναι από τη βιβλιοθήκη.`;
        }
      }
    }
  }

  if (name === 'pairs') {
    if (Array.isArray(data)) return 'Οι αντιστοιχίσεις πρέπει να είναι αντικείμενο.';
    if (data.pairs == null || typeof data.pairs !== 'object' || Array.isArray(data.pairs)) {
      return 'Λείπει το «pairs» με τις αντιστοιχίσεις.';
    }

    for (const [id, rec] of Object.entries(data.pairs)) {
      if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
        return `Η εγγραφή «${id}» πρέπει να είναι αντικείμενο.`;
      }

      // Ο κωδικός μπαίνει αυτούσιος σε διεύθυνση youtube.com/embed/… —
      // ό,τι άλλο δεν σπάει μόνο το ζευγάρωμα, σπάει τη σελίδα.
      if (rec.video != null
          && (typeof rec.video !== 'string' || !/^[\w-]{6,20}$/.test(rec.video))) {
        return `Άκυρος κωδικός βίντεο στο «${id}».`;
      }

      if (rec.guest != null && typeof rec.guest !== 'string') {
        return `Ο καλεσμένος του «${id}» πρέπει να είναι κείμενο.`;
      }
      // Το όνομα γίνεται τίτλος και διεύθυνση σελίδας προσώπου.
      if (rec.guest && rec.guest.length > 80) {
        return `Πολύ μακρύ όνομα καλεσμένου στο «${id}».`;
      }

      // ---- Οι διορθώσεις στο ίδιο το επεισόδιο ----
      //
      // Τίτλος, περιγραφή και φωτογραφία, για όταν το Buzzsprout τα
      // έχει αλλιώς απ' ό,τι θέλουμε εμείς. Μπαίνουν στην ίδια εγγραφή
      // με το βίντεο και τον καλεσμένο: είναι κι αυτά «η απάντηση του
      // ανθρώπου για αυτό το επεισόδιο».
      if (rec.title != null && typeof rec.title !== 'string') {
        return `Ο τίτλος του «${id}» πρέπει να είναι κείμενο.`;
      }
      // Ο τίτλος μπαίνει σε <title>, σε κάρτες και στα κοινωνικά. Πάνω
      // από αυτό δεν είναι τίτλος, είναι περιγραφή.
      if (rec.title && rec.title.length > 300) {
        return `Πολύ μακρύς τίτλος στο «${id}» (${rec.title.length} χαρακτήρες, όριο 300).`;
      }

      if (rec.summary != null && typeof rec.summary !== 'string') {
        return `Η περιγραφή του «${id}» πρέπει να είναι κείμενο.`;
      }
      if (rec.summary && rec.summary.length > 20000) {
        return `Πολύ μεγάλη περιγραφή στο «${id}».`;
      }

      // Η φωτογραφία μπαίνει αυτούσια σε img src. Μόνο από τη δική μας
      // βιβλιοθήκη — ίδιος κανόνας με τα πορτρέτα των προσώπων.
      if (rec.image != null && rec.image !== ''
          && (typeof rec.image !== 'string' || !/^\/uploads\/[\w.-]+$/.test(rec.image))) {
        return `Η φωτογραφία του «${id}» πρέπει να είναι από τη βιβλιοθήκη.`;
      }

      // «Δεν υπάρχει» μαζί με ρητή επιλογή είναι αντίφαση: το build θα
      // τιμούσε το ένα και ο συντάκτης θα κοίταζε το άλλο.
      if (rec.novideo && rec.video) {
        return `Το «${id}» λέει «χωρίς βίντεο» και δίνει βίντεο μαζί.`;
      }
      if (rec.noguest && rec.guest) {
        return `Το «${id}» λέει «χωρίς καλεσμένο» και δίνει καλεσμένο μαζί.`;
      }
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

// Η διαγραφή είναι ΟΡΙΣΤΙΚΗ: οι φωτογραφίες ζουν σε R2, όχι στο git,
// οπότε δεν υπάρχει ιστορικό να τις επαναφέρει. Η επιβεβαίωση γίνεται
// στη διεπαφή.
//
// Το φίλτρο του ονόματος είναι ΤΟ ΙΔΙΟ με του /uploads/: μόνο γράμματα,
// ψηφία, κάτω παύλα, τελεία και παύλα. Χωρίς αυτό ένα «../» θα έσβηνε
// αρχείο έξω από τον χώρο των φωτογραφιών.
async function deleteImage(store, name){
  const file = String(name || '');

  if (!file || !/^[\w.-]+$/.test(file) || file.includes('..')) {
    return { status: 400, body: { error: 'Άκυρο όνομα αρχείου.' } };
  }
  if (!/\.(jpg|jpeg|webp|png)$/i.test(file)) {
    return { status: 400, body: { error: 'Διαγράφονται μόνο φωτογραφίες.' } };
  }

  try {
    await store.delImage(file);
    return { status: 200, body: { ok: true } };
  } catch (err) {
    return { status: 500, body: { error: `Δεν διαγράφηκε: ${err.message}` } };
  }
}

module.exports = {
  readData, writeData, saveImage, listImages, deleteImage,
  isReadable, isWritable, validate,
  WRITABLE, IMAGE_TYPES, MAX_IMAGE, imageName,
};
