
'use strict';

const WRITABLE = new Set([
  'curation',        // lead, secondaries, categories, topics
  'people-aliases',  // which names are the same person
  'shows',           // the shows
  'show-art',        // their posters
  'articles',        // our own articles
  'pairs',           // which video and which guest go with which episode
  'photos',          // which images are "standard"
  'writers',         // the portraits of newshub.gr's columnists
  'ads',             // the partners' ads
]);

// Files that are read but NOT written: the fetch-*.js scripts produce
// them from the sources, and anything written here would be lost on the
// next run.
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
// Content checks
// ---------------------------------------------------------------------

// JSON arriving from the browser is NOT trusted to be correct. A broken
// curation.json takes the whole build down, and the mistake only shows
// when the site fails to refresh.
function validate(name, data){
  if (data === null || typeof data !== 'object') {
    return 'Το περιεχόμενο πρέπει να είναι αντικείμενο ή λίστα.';
  }

  if (name === 'curation') {
    if (Array.isArray(data)) return 'Το curation πρέπει να είναι αντικείμενο.';

    // curation.json's safety catch: a manual pick WITHOUT an expiry
    // freezes the homepage forever, and nobody notices until someone
    // complains that "the site is stuck".
    if (data.featured && !data.featuredUntil) {
      return 'Η χειροκίνητη επιλογή πρωτοσέλιδου χρειάζεται ημερομηνία λήξης.';
    }
    if (data.featuredUntil && !/^\d{4}-\d{2}-\d{2}$/.test(data.featuredUntil)) {
      return 'Η ημερομηνία λήξης γράφεται ΕΕΕΕ-ΜΜ-ΗΗ.';
    }
    if (data.featuredPrev != null) {
      if (!Array.isArray(data.featuredPrev)) {
        return 'Το ιστορικό του πρωτοσέλιδου πρέπει να είναι λίστα.';
      }
      const kakia = data.featuredPrev.some((x) => (
        !x || typeof x !== 'object' || Array.isArray(x)
        || typeof x.ref !== 'string' || !x.ref.trim()
        || (x.hero != null && typeof x.hero !== 'string')
      ));
      if (kakia) {
        return 'Κάθε εγγραφή στο ιστορικό πρωτοσέλιδου θέλει ref σε κείμενο.';
      }
    }

    if (data.secondary && !Array.isArray(data.secondary)) {
      return 'Τα δευτερεύοντα πρέπει να είναι λίστα.';
    }

    if (data.latest != null) {
      if (!Array.isArray(data.latest)) {
        return 'Τα καρφιτσωμένα της ροής πρέπει να είναι λίστα.';
      }
      if (data.latest.some((x) => typeof x !== 'string')) {
        return 'Κάθε καρφιτσωμένο πρέπει να είναι σύνδεσμος ή κωδικός, σε κείμενο.';
      }
    }

    // The Opinion order. Same check, same reason: an object in here
    // would throw in sameItem() and take the build down.
    if (data.opinions != null) {
      if (!Array.isArray(data.opinions)) {
        return 'Οι απόψεις πρέπει να είναι λίστα.';
      }
      if (data.opinions.some((x) => typeof x !== 'string')) {
        return 'Κάθε άποψη πρέπει να είναι σύνδεσμος, σε κείμενο.';
      }
    }

    // The homepage topics: category names, as text. An object in here
    // would pass through the build's slugify() and produce a row titled
    // "[object Object]".
    for (const key of ['featuredTopics', 'spotlightTopics']) {
      if (data[key] == null) continue;
      if (!Array.isArray(data[key])) return `Το ${key} πρέπει να είναι λίστα.`;
      if (data[key].some((x) => typeof x !== 'string' || !x.trim())) {
        return `Κάθε θέμα στο ${key} πρέπει να είναι όνομα κατηγορίας, σε κείμενο.`;
      }
    }

    // What is pinned under each topic: "topic slug" -> list of ids.
    // Same check as the flow's pins — an object in here would throw in
    // sameItem() and take the whole build down.
    if (data.categoryPicks != null) {
      if (typeof data.categoryPicks !== 'object' || Array.isArray(data.categoryPicks)) {
        return 'Το categoryPicks πρέπει να είναι αντικείμενο «θέμα: λίστα».';
      }
      for (const [thema, list] of Object.entries(data.categoryPicks)) {
        if (!Array.isArray(list)) return `Το θέμα «${thema}» πρέπει να έχει λίστα.`;
        if (list.some((x) => typeof x !== 'string' || !x.trim())) {
          return `Κάθε επιλογή στο «${thema}» πρέπει να είναι κωδικός ή σύνδεσμος, σε κείμενο.`;
        }
      }
    }

    // What ✕ removed: "list" -> { id: when }. The date is the reason the
    // field exists — without it a "not this" would hold forever. See
    // kryfa() in build.js.
    if (data.hidden != null) {
      if (typeof data.hidden !== 'object' || Array.isArray(data.hidden)) {
        return 'Το hidden πρέπει να είναι αντικείμενο «λίστα: κρυμμένα».';
      }
      for (const [lista, map] of Object.entries(data.hidden)) {
        if (!map || typeof map !== 'object' || Array.isArray(map)) {
          return `Τα κρυμμένα του «${lista}» πρέπει να είναι αντικείμενο «κωδικός: ημερομηνία».`;
        }
        for (const [ref, pote] of Object.entries(map)) {
          if (!ref.trim()) return `Κρυμμένο χωρίς κωδικό στο «${lista}».`;
          if (typeof pote !== 'string' || isNaN(Date.parse(pote))) {
            return `Το κρυμμένο «${ref}» θέλει ημερομηνία σε κείμενο ISO.`;
          }
        }
      }
    }
  }

  if (name === 'photos') {
    if (Array.isArray(data)) return 'Οι φωτογραφίες πρέπει να είναι αντικείμενο.';
    if (data.standard != null) {
      if (!Array.isArray(data.standard)) {
        return 'Οι στάνταρ φωτογραφίες πρέπει να είναι λίστα.';
      }
      // Filenames, nothing else. A path with "/" or ".." in here breaks
      // nothing today, but the list is read to find a file in R2 — and
      // we do not let that shape in.
      for (const n of data.standard) {
        if (typeof n !== 'string' || !/^[\w.-]+$/.test(n)) {
          return 'Κάθε στάνταρ φωτογραφία πρέπει να είναι σκέτο όνομα αρχείου.';
        }
      }
    }
  }

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

    if (data.ipografes != null) {
      if (typeof data.ipografes !== 'object' || Array.isArray(data.ipografes)) {
        return 'Οι υπογραφές πρέπει να είναι αντικείμενο «email: όνομα».';
      }
      for (const [email, onoma] of Object.entries(data.ipografes)) {
        if (typeof onoma !== 'string' || !onoma.trim()) {
          return `Η υπογραφή του «${email}» είναι άδεια.`;
        }
        if (onoma.length > 80) {
          return `Η υπογραφή του «${email}» είναι υπερβολικά μεγάλη.`;
        }
      }
    }
  }

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

      const pics = Array.isArray(a.images) && a.images.length
        ? a.images
        : (a.image === undefined ? [] : [a.image]);

      if (!pics.length) {
        return `Η διαφήμιση ${who} δεν έχει καμία εικόνα.`;
      }
      if (pics.length > 6) {
        return `Η διαφήμιση ${who} έχει πάνω από 6 εικόνες.`;
      }
      for (const pic of pics) {
        if (typeof pic !== 'string' || !/^\/uploads\/[\w.-]+$/.test(pic)) {
          return `Η εικόνα ${who} πρέπει να είναι αρχείο του /uploads/.`;
        }
      }

      const videos = pics.filter((p) => /\.mp4$/i.test(p));
      if (videos.length && pics.length > 1) {
        return `Η διαφήμιση ${who} έχει βίντεο μαζί με εικόνες — το βίντεο μπαίνει μόνο του.`;
      }

      for (const dim of ['w', 'h']) {
        if (a[dim] === undefined) continue;
        const n = Number(a[dim]);
        if (!Number.isInteger(n) || n < 1 || n > 10000) {
          return `Άκυρες διαστάσεις ${who} — το «${dim}» θέλει ακέραιο 1 έως 10000.`;
        }
      }
      if ((a.w === undefined) !== (a.h === undefined)) {
        return `Η διαφήμιση ${who} έχει τη μία μόνο διάσταση — χρειάζονται και οι δύο.`;
      }

      // The slideshow interval. Under 3 seconds there is no time to read
      // a phone number or an address; over 20 it is not a slideshow any
      // more.
      if (a.every !== undefined) {
        const every = Number(a.every);
        if (!Number.isFinite(every) || every < 3 || every > 20) {
          return `Ο ρυθμός εναλλαγής ${who} θέλει 3 έως 20 δευτερόλεπτα.`;
        }
      }

      // The link goes out, so http(s) only — never javascript:
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

    // The build reads data.art ONLY. If it is lost nothing throws — each
    // show is just left without a poster, silently. Hence the check.
    if (data.art == null || typeof data.art !== 'object' || Array.isArray(data.art)) {
      return 'Λείπει το «art» με την αντιστοίχιση εκπομπής σε αφίσα.';
    }
    for (const [show, v] of Object.entries(data.art)) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) {
        return `Η αφίσα της «${show}» πρέπει να είναι αντικείμενο.`;
      }
      // The uploaded image. Only a URL under our own /uploads/:
      // anything else would put a foreign pixel on 4,700 pages, and a
      // show's poster appears almost everywhere.
      if (v.url != null && v.url !== '') {
        if (typeof v.url !== 'string' || !/^\/uploads\/[\w.-]+$/.test(v.url)) {
          return `Η φωτογραφία της «${show}» πρέπει να είναι αρχείο του /uploads/.`;
        }
      }

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

    if (data.aliases != null) {
      if (typeof data.aliases !== 'object' || Array.isArray(data.aliases)) {
        return 'Οι ενώσεις πρέπει να είναι αντικείμενο.';
      }
      for (const [canonical, list] of Object.entries(data.aliases)) {
        if (!Array.isArray(list)) {
          return `Οι γραφές του «${canonical}» πρέπει να είναι λίστα.`;
        }
        // A name merged with itself makes a loop in the build.
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

    if (data.photos != null) {
      if (typeof data.photos !== 'object' || Array.isArray(data.photos)) {
        return 'Τα πορτρέτα πρέπει να είναι αντικείμενο.';
      }
      for (const [who, url] of Object.entries(data.photos)) {
        if (url === '' || url === null) continue;   // "take it out"
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

      // The id goes verbatim into a youtube.com/embed/… URL — anything
      // else breaks not just the pairing but the page.
      if (rec.video != null
          && (typeof rec.video !== 'string' || !/^[\w-]{6,20}$/.test(rec.video))) {
        return `Άκυρος κωδικός βίντεο στο «${id}».`;
      }

      if (rec.guest != null && typeof rec.guest !== 'string') {
        return `Ο καλεσμένος του «${id}» πρέπει να είναι κείμενο.`;
      }
      // The name becomes a title and a person page's URL.
      if (rec.guest && rec.guest.length > 80) {
        return `Πολύ μακρύ όνομα καλεσμένου στο «${id}».`;
      }

      if (rec.title != null && typeof rec.title !== 'string') {
        return `Ο τίτλος του «${id}» πρέπει να είναι κείμενο.`;
      }
      // The title goes in <title>, in cards and in social. Beyond this
      // it is not a title, it is a description.
      if (rec.title && rec.title.length > 300) {
        return `Πολύ μακρύς τίτλος στο «${id}» (${rec.title.length} χαρακτήρες, όριο 300).`;
      }

      if (rec.summary != null && typeof rec.summary !== 'string') {
        return `Η περιγραφή του «${id}» πρέπει να είναι κείμενο.`;
      }
      if (rec.summary && rec.summary.length > 20000) {
        return `Πολύ μεγάλη περιγραφή στο «${id}».`;
      }

      // The image goes verbatim into an img src. From our own library
      // only — same rule as the people's portraits.
      if (rec.image != null && rec.image !== ''
          && (typeof rec.image !== 'string' || !/^\/uploads\/[\w.-]+$/.test(rec.image))) {
        return `Η φωτογραφία του «${id}» πρέπει να είναι από τη βιβλιοθήκη.`;
      }

      // "Does not exist" together with an explicit pick is a
      // contradiction: the build would honour one and the editor would
      // be looking at the other.
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
// The actions
// ---------------------------------------------------------------------

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

  // Two spaces, as the hand-written files are: that way git diff shows
  // WHAT changed instead of one enormous line.
  const text = JSON.stringify(data, null, 2) + '\n';
  const message = `${name}: αλλαγή από το διαχειριστικό${who ? ` (${who})` : ''}`;

  try {
    await store.write(name, text, message);
    return { status: 200, body: { ok: true } };
  } catch (err) {
    return { status: 500, body: { error: `Δεν αποθηκεύτηκε: ${err.message}` } };
  }
}

const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/png': 'png',
  'image/gif': 'gif',
};

const VIDEO_TYPES = {
  'video/mp4': 'mp4',
};

// 4MB after compression. A reporting photo comes out at 150-400KB;
// anything ten times that means something did not work.
const MAX_IMAGE = 4 * 1024 * 1024;

const MAX_VIDEO = 8 * 1024 * 1024;

function maxFor(type){
  return VIDEO_TYPES[type] ? MAX_VIDEO : MAX_IMAGE;
}

const GREEK_MAP = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th',
  ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p',
  ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
};

function imageName(original, stamp){
  const base = String(original || 'foto')
    .replace(/\.[^.]*$/, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // accents first
    .toLowerCase()
    .split('').map((ch) => GREEK_MAP[ch] || ch).join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '') || 'foto';

  return `${stamp}-${base}`;
}

async function saveImage(store, { bytes, type, name }){
  const ext = IMAGE_TYPES[type] || VIDEO_TYPES[type];
  if (!ext) {
    return { status: 400, body: { error: 'Δεκτά μόνο JPG, PNG, WebP, GIF ή βίντεο MP4.' } };
  }
  if (!bytes || !bytes.length) {
    return { status: 400, body: { error: 'Άδειο αρχείο.' } };
  }

  const video = !!VIDEO_TYPES[type];
  const max = video ? MAX_VIDEO : MAX_IMAGE;

  if (bytes.length > max) {
    const mb = Math.round(max / (1024 * 1024));
    return {
      status: 400,
      body: {
        error: video
          ? `Το βίντεο ξεπερνά τα ${mb}MB. Ζήτησε από τον συνεργάτη μικρότερο αρχείο.`
          : 'Η φωτογραφία είναι πολύ μεγάλη.',
      },
    };
  }

  // The leading timestamp keeps the library sorted and stops two images
  // with the same name overwriting each other — which happens constantly
  // with "image.jpg" from a phone.
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

async function deleteImage(store, name){
  const file = String(name || '');

  if (!file || !/^[\w.-]+$/.test(file) || file.includes('..')) {
    return { status: 400, body: { error: 'Άκυρο όνομα αρχείου.' } };
  }
  const ok = Object.values(IMAGE_TYPES)
    .concat(Object.values(VIDEO_TYPES))
    .concat('jpeg');
  if (!ok.some((ext) => new RegExp(`\\.${ext}$`, 'i').test(file))) {
    return {
      status: 400,
      body: { error: `Διαγράφονται μόνο αρχεία ${ok.join(', ')}.` },
    };
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
  WRITABLE, IMAGE_TYPES, VIDEO_TYPES, MAX_IMAGE, MAX_VIDEO, maxFor, imageName,
};
