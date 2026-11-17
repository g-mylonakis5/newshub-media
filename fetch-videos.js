
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

const MAX_PERIGRAFI = 2000;

const SKOUPIDIA = [
  /^κάντε\s+εγγραφή/i,
  /^εγγραφείτε/i,
  /^subscribe/i,
  /^[@#]/,
  /^(ακολουθήστε|βρείτε)\s+μας/i,
  /^μας\s+τιμάτε/i,
  /^support the show/i,
  /^(?:[TΤ][oο]\s+)?(?:κανάλι|σελίδα)\s+μας\s+στ/i,
  /^🎙/u,
];

// Τα 👉 ▶ 🔴 • στην αρχή της γραμμής είναι στολίδι, όχι κείμενο — και
// κρύβουν από τον έλεγχο τον σύνδεσμο που ακολουθεί.
function xeguma(line) {
  return line.replace(/^[\s\p{Extended_Pictographic} -⯿️•·▪]+/u, '').trim();
}

function skoupidi(line) {
  if (/https?:\/\//i.test(line)) return true;
  return SKOUPIDIA.some((re) => re.test(line));
}

function perigrafi(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n')
    .map((l) => xeguma(l.replace(/[ \t]+/g, ' ')));

  // Μπροστά: πετάμε όσες γραμμές είναι σκουπίδι ή κενές.
  let a = 0;
  while (a < lines.length && (!lines[a] || skoupidi(lines[a]))) a++;

  // Από εκεί και κάτω: κόβουμε στην ΠΡΩΤΗ γραμμή-σκουπίδι. Ό,τι
  // ακολουθεί την ουρά είναι πάντα κι άλλη ουρά.
  const keep = [];
  for (let i = a; i < lines.length; i++) {
    if (skoupidi(lines[i])) break;
    if (lines[i]) keep.push(lines[i]);
  }

  // Υπογραφή συντάκτη στο τέλος: «Β.Β.», «Μ.Κ.».
  while (keep.length && keep[keep.length - 1].length <= 8
    && /^[Α-ΩA-Z][.\s]/.test(keep[keep.length - 1])) keep.pop();

  // Το όριο μετριέται σε ΟΛΟΚΛΗΡΕΣ παραγράφους: μισή παράγραφος με
  // αποσιωπητικά διαβάζεται σαν χαλασμένο κείμενο.
  const out = [];
  let len = 0;
  for (const p of keep) {
    if (out.length && len + p.length > MAX_PERIGRAFI) break;
    out.push(p);
    len += p.length + 1;
  }

  // Οι αλλαγές γραμμής ΜΕΝΟΥΝ: είναι οι παράγραφοι, και το summaryHtml
  // του build.js τις σέβεται όπως και στα επεισόδια.
  return out.join('\n');
}

function makeVideo(id, show, playlist, title, date, image, summary) {
  return {
    id,
    show,
    playlist,
    title,
    date,
    url: `https://www.youtube.com/watch?v=${id}&list=${playlist}`,
    embed: `https://www.youtube.com/embed/${id}`,
    image,
    ...(summary ? { summary } : {}),
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
      perigrafi(tag(block, 'media:description')),
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
        perigrafi(s.description),
      ));
    }

    pageToken = page.nextPageToken || '';
  } while (pageToken);

  return { show, videos };
}

const CHANNEL = 'UCgI7vd72xX-ZNWb_x7zzWJg';

async function lipoysesListes(key, gnosta) {
  const found = [];
  let pageToken = '';

  do {
    const page = await api('playlists', {
      part: 'snippet,contentDetails',
      channelId: CHANNEL,
      maxResults: '50',
      ...(pageToken ? { pageToken } : {}),
    }, key);

    for (const p of page.items || []) {
      const title = (p.snippet && p.snippet.title) || '';
      if (gnosta.ids.has(p.id) || gnosta.titloi.has(title)) continue;
      found.push({ id: p.id, title, n: (p.contentDetails || {}).itemCount || 0 });
    }

    pageToken = page.nextPageToken || '';
  } while (pageToken);

  return found;
}

function anaforaLipoyson(found) {
  if (!found.length) {
    console.log('Καμία άγνωστη λίστα στο κανάλι.');
    return;
  }

  console.log('');
  console.log(found.length === 1
    ? 'ΠΡΟΣΟΧΗ: 1 λίστα του καναλιού ΔΕΝ είναι στη PLAYLISTS:'
    : `ΠΡΟΣΟΧΗ: ${found.length} λίστες του καναλιού ΔΕΝ είναι στη PLAYLISTS:`);
  for (const p of found.sort((a, b) => b.n - a.n)) {
    console.log(`  '${p.id}', // ${p.title} (${p.n} βίντεο)`);
  }
  console.log('');
  console.log('Αν θέλεις να μπουν στο site, αντίγραψε τις γραμμές στη');
  console.log('λίστα PLAYLISTS στην κορυφή αυτού του αρχείου.');
}

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
  const titloi = new Set();
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
        titloi.add(s.snippet.title);
        console.log(`  ✓ ${id.padEnd(36)} ${String(s.contentDetails.itemCount).padStart(5)}  ${s.snippet.title}`);
      }
    } catch (err) {
      console.log(`  ✗ ${id.padEnd(36)} ${err.message}`);
    }
  }
  console.log(`\n${ok} από ${PLAYLISTS.length} λίστες απαντούν.`);

  // Ο έλεγχος απαντά «ποιες από τις δικές μας ζουν». Το ανάποδο —
  // ποιες του καναλιού δεν είναι δικές μας — είναι η άλλη μισή
  // απάντηση, και εδώ δεν κοστίζει τίποτα παραπάνω.
  try {
    anaforaLipoyson(await lipoysesListes(key, { ids: new Set(PLAYLISTS), titloi }));
  } catch (err) {
    console.log(`Δεν ελέγχθηκε τι λίστες λείπουν: ${err.message}`);
  }
}

async function main() {
  if (process.argv.includes('--check')) return check();

  const key = readEnv().YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY || '';

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

  // Τα ονόματα τα ξέρουμε μόνο μετά τον βρόχο — τα γράφει το viaApi
  // στο showInfo. Σε δικό της try: μια αστοχία εδώ είναι ενημέρωση που
  // χάθηκε, όχι λόγος να πάνε χαμένα 1.500 βίντεο που ήδη κατέβηκαν.
  try {
    anaforaLipoyson(await lipoysesListes(key, {
      ids: new Set(PLAYLISTS),
      titloi: new Set(Object.keys(showInfo)),
    }));
  } catch (err) {
    console.warn(`  δεν ελέγχθηκε τι λίστες λείπουν: ${err.message}`);
  }

  const seenPairs = new Set();
  const once = all.filter((v) => {
    const pair = `${v.id}|${v.show}`;
    if (seenPairs.has(pair)) return false;
    seenPairs.add(pair);
    return true;
  });

  if (once.length < all.length) {
    console.log(`  ${all.length - once.length} διπλότυπες εγγραφές αφαιρέθηκαν`);
    all.splice(0, all.length, ...once);
  }

  // Νεότερα πρώτα, όπως και τα επεισόδια.
  all.sort((a, b) => new Date(b.date) - new Date(a.date));

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

  const meKeimeno = new Set(all.filter((v) => v.summary).map((v) => v.id)).size;
  const mona = new Set(all.map((v) => v.id)).size;

  console.log('');
  console.log(`Σώθηκαν ${all.length} βίντεο στο data/videos.json`);
  console.log(`${meKeimeno} από ${mona} μοναδικά βίντεο έχουν περιγραφή.`);
}

main();
