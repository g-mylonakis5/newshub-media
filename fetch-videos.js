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

async function viaApi(playlistId, key) {
  // Πρώτα το όνομα της λίστας...
  const info = await api('playlists', { part: 'snippet', id: playlistId }, key);
  const show = info.items && info.items[0] ? info.items[0].snippet.title : '';

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

async function main() {
  const key = readEnv().YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY || '';

  if (key) {
    console.log('Βρέθηκε κλειδί — τραβάω ΟΛΑ τα βίντεο από το YouTube Data API.');
  } else {
    console.log('Χωρίς κλειδί — πέφτω στα δημόσια RSS (15 ανά λίστα).');
    console.log('Βάλε YOUTUBE_API_KEY στο .env για ολόκληρο το αρχείο.');
  }
  console.log('');

  const all = [];

  for (const id of PLAYLISTS) {
    try {
      const { show, videos } = key ? await viaApi(id, key) : await viaRss(id);
      all.push(...videos);
      console.log(`  ${String(videos.length).padStart(5)} βίντεο  ${show}`);
    } catch (err) {
      console.warn(`  ΣΦΑΛΜΑ στη λίστα ${id}: ${err.message}`);
    }
  }

  // Νεότερα πρώτα, όπως και τα επεισόδια.
  all.sort((a, b) => new Date(b.date) - new Date(a.date));

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(all, null, 2), 'utf8');

  console.log('');
  console.log(`Σώθηκαν ${all.length} βίντεο στο data/videos.json`);
}

main();
