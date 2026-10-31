// fetch-videos.js — κατεβάζει τις λίστες αναπαραγωγής του YouTube και
// σώζει τα βίντεό τους στο data/videos.json. Αδελφάκι του fetch-episodes.js.
//
// Δύο τρόποι, και διαλέγει μόνο του:
//   ΜΕ κλειδί στο .env  -> YouTube Data API v3, ΟΛΑ τα βίντεο κάθε λίστας
//   ΧΩΡΙΣ κλειδί        -> δημόσιο RSS, μόνο τα 15 πιο πρόσφατα
// Η μορφή του αρχείου είναι ίδια και στις δύο περιπτώσεις, οπότε ό,τι
// χτίζεται από πάνω δεν ξέρει καν ποιος δρόμος χρησιμοποιήθηκε.

const fs = require('fs');
const path = require('path');

const OUT_FILE = path.join(__dirname, 'data/videos.json');
const SHOWS_FILE = path.join(__dirname, 'data/shows.json');
const ENV_FILE = path.join(__dirname, '.env');

// Τα ονόματα των εκπομπών ΔΕΝ τα γράφουμε εδώ — τα δίνει το ίδιο το
// YouTube. Έτσι αν μετονομαστεί μια λίστα, μας ακολουθεί μόνη της.
const PLAYLISTS = [
  'PLeLPfJ0KGQSQ',                      // Εξ Απορρήτων
  'PLpwq9QIFWXEBxDudlG1tQG13CkwKq8CxF', // Παρασκήνιο
  'PLpwq9QIFWXECn12P5hag20T2bag23zR_x', // Ιστορία στο newshub.gr
  'PLpwq9QIFWXEDK0-mJOgKZ5hfG5SE1VWfX', // Κοινωνία σε 1ο πρόσωπο
  'PLpwq9QIFWXEDbl9zjLad1yz5V_MnryJtF', // Ιστορίες του Ηρακλείου
  'PLpwq9QIFWXECyXTLHzdRAGzSwEDWBCkZo', // Υγεία και Επιστήμες
  'PLpwq9QIFWXEDl91vT62OsokYfJ2fTzJFy', // Αναλύσεις στο Newshub.gr
  'PLpwq9QIFWXEDb2tmlPsmPec7z12Lgi7Tu', // 25 μαθήματα για την ελληνική ιστορία
  'PLpwq9QIFWXECjoVwMmmA1w1WGTy3tgvSr', // Αφιερώματα
  'PLpwq9QIFWXECDlVuWnkwmOKIxhFtuPuX4', // Αγροτική επικαιρότητα
  'PLpwq9QIFWXED9-fM7AxBxEsHPCGbknkhp', // ΕΠΙΚΑΙΡΟΤΗΤΑ
  'PLpwq9QIFWXEDoXajk01BWxrjMpYITTYeg', // Συνεντεύξεις και πρόσωπα

  // Νέες εκπομπές. Η λίστα γράφεται με το χέρι, οπότε ό,τι ανοίγει στο
  // YouTube δεν φτάνει εδώ μόνο του — ήταν αόρατες στο site.
  // Για να βρεις τι λείπει:
  //   node -e "…playlists?channelId=UCgI7vd72xX-ZNWb_x7zzWJg…"
  'PLZULcgj6z5z4',                      // Επίκαιρα στο Newshub.gr
  'PLEWTnP9rz2So',                      // Αντίλογος στο Newshub.gr
  'PLpwq9QIFWXEA2GoQ07cap1MW7B8EbbQhB', // Τα μονοπάτια ιστορίας

  // ΠΡΟΣΩΡΙΝΑ ΕΚΤΟΣ — ξεσχολίασέ τα όταν γεμίσουν:
  // 'PLLcdtU9QLgvs',                   // Αθλητικά (2 βίντεο)
];

// Διαβάζει το .env χωρίς βιβλιοθήκη: κάθε γραμμή ΟΝΟΜΑ=τιμή.
function readEnv() {
  if (!fs.existsSync(ENV_FILE)) return {};
  const out = {};
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const clean = line.trim();
    if (!clean || clean.startsWith('#')) continue;
    const at = clean.indexOf('=');
    if (at === -1) continue;
    out[clean.slice(0, at).trim()] = clean.slice(at + 1).trim();
  }
  return out;
}

function tag(block, name) {
  const m = block.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>'));
  return m ? m[1].trim() : '';
}

function attr(block, name, key) {
  const m = block.match(new RegExp('<' + name + '[^>]*\\b' + key + '="([^"]*)"'));
  return m ? m[1] : '';
}

function makeVideo(id, show, playlist, title, date, image) {
  return {
    id,
    show,
    playlist,
    title,
    date,
    url: `https://www.youtube.com/watch?v=${id}&list=${playlist}`,
    embed: `https://www.youtube.com/embed/${id}`,
    image,
  };
}

// ---- δρόμος 1: χωρίς κλειδί, δημόσιο RSS (15 πιο πρόσφατα) ----

async function viaRss(playlistId) {
  const url = 'https://www.youtube.com/feeds/videos.xml?playlist_id=' + playlistId;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error('RSS HTTP ' + res.status);

  const xml = await res.text();
  const show = tag(xml.split('<entry>')[0], 'title');

  const videos = xml.split('<entry>').slice(1).map((raw) => {
    const block = raw.split('</entry>')[0];
    return makeVideo(
      tag(block, 'yt:videoId'),
      show,
      playlistId,
      tag(block, 'title'),
      tag(block, 'published'),
      attr(block, 'media:thumbnail', 'url'),
    );
  });

  return { show, videos };
}

// ---- δρόμος 2: με κλειδί, YouTube Data API v3 (όλα τα βίντεο) ----

async function api(endpoint, params, key) {
  const qs = new URLSearchParams({ ...params, key }).toString();
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${endpoint}?${qs}`);
  const data = await res.json();
  if (!res.ok) {
    const reason = data.error && data.error.message ? data.error.message : 'HTTP ' + res.status;
    throw new Error(reason);
  }
  return data;
}

// Οι περιγραφές των εκπομπών, όπως τις έγραψε η σύνταξη στο YouTube.
// Σώζονται χωριστά, στο data/shows.json: είναι μία ανά εκπομπή, όχι ανά
// βίντεο, και δεν έχει νόημα να επαναλαμβάνονται 1.500 φορές μέσα στο
// videos.json. Η σύνταξη δεν μαθαίνει τίποτα νέο — ήδη τις γράφει εκεί.
const showInfo = {};

async function viaApi(playlistId, key) {
  // Πρώτα το όνομα της λίστας...
  const info = await api('playlists', { part: 'snippet', id: playlistId }, key);
  const snip = info.items && info.items[0] ? info.items[0].snippet : null;
  const show = snip ? snip.title : '';

  if (show) {
    showInfo[show] = {
      description: (snip.description || '').trim(),
      playlist: playlistId,
    };
  }

  // ...μετά τα βίντεο, 50 τη φορά όσο υπάρχει επόμενη σελίδα.
  const videos = [];
  let pageToken = '';

  do {
    const page = await api('playlistItems', {
      part: 'snippet,contentDetails',
      playlistId,
      maxResults: '50',
      ...(pageToken ? { pageToken } : {}),
    }, key);

    for (const item of page.items || []) {
      const s = item.snippet;
      // Τα σβησμένα και τα ιδιωτικά μένουν στη λίστα ως κενά. Τα πετάμε.
      if (!s || s.title === 'Deleted video' || s.title === 'Private video') continue;

      const thumbs = s.thumbnails || {};
      const best = thumbs.maxres || thumbs.standard || thumbs.high || thumbs.medium || thumbs.default;

      videos.push(makeVideo(
        s.resourceId.videoId,
        show,
        playlistId,
        s.title,
        (item.contentDetails && item.contentDetails.videoPublishedAt) || s.publishedAt,
        best ? best.url : '',
      ));
    }

    pageToken = page.nextPageToken || '';
  } while (pageToken);

  return { show, videos };
}

// node fetch-videos.js --check
//
// Ρωτάει κάθε λίστα χωριστά και λέει ποια απαντά και ποια όχι, ΧΩΡΙΣ
// να γράψει τίποτα. Για όταν το κανονικό τρέξιμο βγάλει 404 παντού.
async function check() {
  const key = readEnv().YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY || '';
  if (!key) {
    console.log('Δεν υπάρχει YOUTUBE_API_KEY — ο έλεγχος αφορά μόνο το API.');
    return;
  }

  console.log(`Κλειδί: ${key.slice(0, 6)}…${key.slice(-4)} (${key.length} χαρακτήρες)\n`);

  // Πρώτα το ίδιο το κλειδί, με ένα ερώτημα που δουλεύει πάντα.
  try {
    const r = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=id&id=UCgI7vd72xX-ZNWb_x7zzWJg&key=${key}`);
    const j = await r.json();
    if (j.error) {
      console.log(`ΤΟ ΚΛΕΙΔΙ ΔΕΝ ΔΟΥΛΕΥΕΙ: ${j.error.code} — ${j.error.message}`);
      const reason = j.error.errors && j.error.errors[0] && j.error.errors[0].reason;
      if (reason) console.log(`αιτία: ${reason}`);
      return;
    }
    console.log('Το κλειδί δουλεύει.\n');
  } catch (err) {
    console.log('Δεν βγήκε σύνδεση:', err.message);
    return;
  }

  let ok = 0;
  for (const id of PLAYLISTS) {
    try {
      const r = await fetch(`https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&id=${id}&key=${key}`);
      const j = await r.json();
      if (j.error) {
        console.log(`  ✗ ${id.padEnd(36)} ${j.error.code} ${j.error.message.slice(0, 50)}`);
      } else if (!j.items || !j.items.length) {
        console.log(`  ✗ ${id.padEnd(36)} δεν υπάρχει πια (σβήστηκε ή έγινε ιδιωτική)`);
      } else {
        ok++;
        const s = j.items[0];
        console.log(`  ✓ ${id.padEnd(36)} ${String(s.contentDetails.itemCount).padStart(5)}  ${s.snippet.title}`);
      }
    } catch (err) {
      console.log(`  ✗ ${id.padEnd(36)} ${err.message}`);
    }
  }
  console.log(`\n${ok} από ${PLAYLISTS.length} λίστες απαντούν.`);
}

async function main() {
  if (process.argv.includes('--check')) return check();

  const key = readEnv().YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY || '';

  // ΧΩΡΙΣ ΚΛΕΙΔΙ ΔΕΝ ΠΡΟΧΩΡΑΜΕ.
  //
  // Υπήρχε εφεδρεία στα δημόσια RSS του YouTube. Το YouTube τα
  // ΚΑΤΑΡΓΗΣΕ για λίστες αναπαραγωγής: το
  // youtube.com/feeds/videos.xml?playlist_id=… απαντά 404 σε κάθε
  // λίστα, επαληθευμένα.
  //
  // Η εφεδρεία έγινε έτσι παγίδα: χωρίς κλειδί το script έπαιρνε 404
  // παντού, έγραφε άδειο αρχείο, και το build έσβηνε 3.075 σελίδες.
  // Καλύτερα να σταματήσει αμέσως και να το πει.
  if (!key) {
    console.error('');
    console.error('Δεν βρέθηκε YOUTUBE_API_KEY.');
    console.error('');
    console.error('  · τοπικά:  βάλ\' το στο .env  ->  YOUTUBE_API_KEY=…');
    console.error('  · στο CI:  πέρασέ το ως μυστικό μεταβλητής περιβάλλοντος');
    console.error('');
    console.error('Τα δημόσια RSS του YouTube ΔΕΝ δουλεύουν πια για λίστες');
    console.error('(404 σε όλες), οπότε δεν υπάρχει εφεδρικός δρόμος.');
    console.error('Το data/videos.json μένει ως έχει.');
    console.error('');

    // ΔΕΝ βγαίνουμε με σφάλμα: το build πρέπει να συνεχίσει με τα
    // δεδομένα που ήδη υπάρχουν στο repo. Αν σπάγαμε εδώ, ένα
    // ξεχασμένο κλειδί θα μπλόκαρε κάθε δημοσίευση.
    const have = (() => {
      try { return JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')).length; }
      catch { return 0; }
    })();
    console.error(`Συνεχίζω με τα ${have} βίντεο που ήδη υπάρχουν.`);
    console.error('');
    return;
  }

  console.log('Βρέθηκε κλειδί — τραβάω ΟΛΑ τα βίντεο από το YouTube Data API.');
  console.log('');

  const all = [];
  let failed = 0;

  for (const id of PLAYLISTS) {
    try {
      const { show, videos } = key ? await viaApi(id, key) : await viaRss(id);
      all.push(...videos);
      console.log(`  ${String(videos.length).padStart(5)} βίντεο  ${show}`);
    } catch (err) {
      failed++;
      console.warn(`  ΣΦΑΛΜΑ στη λίστα ${id}: ${err.message}`);
    }
  }

  // Νεότερα πρώτα, όπως και τα επεισόδια.
  all.sort((a, b) => new Date(b.date) - new Date(a.date));

  // ---- ΠΡΟΣΤΑΣΙΑ: δεν σβήνουμε ό,τι έχουμε ----
  //
  // Μια φορά το YouTube απάντησε 404 σε ΟΛΕΣ τις λίστες. Το script
  // έγραψε άδειο videos.json, και το επόμενο build έσβησε 3.075
  // σελίδες βίντεο και 72 εκπομπών — επειδή «δεν υπάρχουν πια».
  //
  // Ένα προσωρινό πρόβλημα δικτύου ή ένα ληγμένο κλειδί δεν σημαίνει
  // ότι χάθηκαν τα βίντεο. Αν το αποτέλεσμα είναι άδειο ή πολύ
  // μικρότερο από ό,τι είχαμε, κρατάμε το παλιό και φωνάζουμε.
  const before = (() => {
    try {
      return JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
    } catch {
      return [];
    }
  })();

  // Κάτω από το μισό = κάτι πήγε στραβά, όχι πραγματική μείωση.
  const SAFE_DROP = 0.5;

  if (before.length && all.length < before.length * SAFE_DROP) {
    console.error('');
    console.error('╔══════════════════════════════════════════════════════════╗');
    console.error('║  ΤΟ ΑΡΧΕΙΟ ΔΕΝ ΓΡΑΦΤΗΚΕ — τα παλιά δεδομένα κρατήθηκαν   ║');
    console.error('╚══════════════════════════════════════════════════════════╝');
    console.error(`  είχαμε:    ${before.length} βίντεο`);
    console.error(`  ήρθαν:     ${all.length} βίντεο`);
    console.error(`  απέτυχαν:  ${failed} από ${PLAYLISTS.length} λίστες`);
    console.error('');
    console.error('  Πιθανές αιτίες: ληγμένο ή μπλοκαρισμένο YOUTUBE_API_KEY,');
    console.error('  εξαντλημένο ημερήσιο όριο, ή αλλαγμένα playlist ids.');
    console.error('  Έλεγξε με:  node fetch-videos.js --check');
    console.error('');
    console.error(`  Συνεχίζω με τα ${before.length} βίντεο που ήδη υπάρχουν.`);
    console.error('');
    return;
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(all, null, 2), 'utf8');

  if (failed) {
    console.warn(`ΠΡΟΣΟΧΗ: ${failed} λίστες απέτυχαν — το αρχείο γράφτηκε με ${all.length} βίντεο.`);
  }

  // Οι περιγραφές των εκπομπών. Γράφονται μόνο αν μαζέψαμε κάποια —
  // χωρίς κλειδί ο δρόμος του RSS δεν τις δίνει, και δεν θέλουμε να
  // σβήσουμε ό,τι είχαμε από προηγούμενο τρέξιμο με κλειδί.
  const names = Object.keys(showInfo);
  if (names.length) {
    const withText = names.filter((n) => showInfo[n].description).length;
    fs.writeFileSync(SHOWS_FILE, JSON.stringify(showInfo, null, 2), 'utf8');
    console.log(`Σώθηκαν ${names.length} εκπομπές στο data/shows.json (${withText} με περιγραφή)`);
  }

  console.log('');
  console.log(`Σώθηκαν ${all.length} βίντεο στο data/videos.json`);
}

main();
