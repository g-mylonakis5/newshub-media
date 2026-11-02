// fetch-social.js — μαζεύει τα κάθετα βίντεο (Shorts, TikTok, Reels) και
// τα σώζει στο data/social.json. Αδελφάκι του fetch-videos.js.
//
//   node fetch-social.js
//
// ΔΕΝ ΤΡΕΧΕΙ ΠΟΥΘΕΝΑ ΜΟΝΟ ΤΟΥ, επίτηδες. Δεν είναι ούτε στο
// package.json ούτε στο .github/workflows/fetch.yml, και το build
// δεν διαβάζει το data/social.json.
//
// Γιατί: οι λογαριασμοί δεν είναι αρκετά ενεργοί για λωρίδα στην
// αρχική — ανέβασμα κάθε 10-15 μέρες, και το Instagram ανενεργό.
// Μια λωρίδα με τρίμηνο υλικό δείχνει εγκαταλειμμένο site.
//
// Μένει εδώ γιατί η δύσκολη δουλειά έγινε: βρέθηκε πώς βγαίνουν τα
// Shorts χωρίς κλειδί και πώς βρίσκεται η ΚΑΘΕΤΗ μικρογραφία
// (oardefault, όχι αυτή του oEmbed). Αν το αφεντικό το θελήσει,
// φτάνει να μπει το βήμα στο workflow και η λωρίδα στο build.js.
//
// Τρεις πηγές, μία μορφή στην έξοδο:
//
//   YouTube Shorts — αυτόματα. Δεν υπάρχει feed μόνο για Shorts, οπότε
//     διαβάζουμε τη σελίδα /@newshubgr/shorts και κρατάμε τους κωδικούς.
//     Είναι το μόνο σημείο που στηρίζεται στη μορφή της σελίδας· αν το
//     YouTube την αλλάξει, το script το λέει καθαρά και ΔΕΝ πειράζει
//     ό,τι έχει ήδη σωθεί.
//
//   TikTok — από τα links που γράφει ο συντάκτης στο data/social-links.json.
//     Τίτλο και εικόνα τα δίνει το δημόσιο oEmbed, χωρίς κλειδί.
//
//   Instagram — από τα ίδια links, αλλά το oEmbed της Meta θέλει token
//     εφαρμογής. Μέχρι να το βγάλουμε, τίτλο και εικόνα τα γράφει ο
//     συντάκτης δίπλα στο link.
//
// Η ημερομηνία ΔΕΝ υπάρχει πουθενά δωρεάν. Κρατάμε τη σειρά που μας τα
// δίνει η πλατφόρμα — νεότερο πρώτο — και δεν δείχνουμε ημερομηνία.

const fs = require('fs');
const path = require('path');

const OUT_FILE = path.join(__dirname, 'data/social.json');
const LINKS_FILE = path.join(__dirname, 'data/social-links.json');

const CHANNEL = 'https://www.youtube.com/@newshubgr/shorts';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

// Πόσα Shorts κρατάμε. Η αρχική δείχνει λίγα· τα υπόλοιπα είναι για
// μελλοντική σελίδα «όλα τα social».
const MAX_SHORTS = 24;

// ---------------------------------------------------------------------
// Δίκτυο
// ---------------------------------------------------------------------

// Απλό GET που ακολουθεί ανακατευθύνσεις. Το YouTube στέλνει 302 σε
// σελίδα συγκατάθεσης, οπότε χωρίς αυτό παίρνουμε άδειο σώμα.
function get(url, hops = 0) {
  const https = require('https');
  return new Promise((resolve) => {
    if (hops > 5) return resolve({ code: 0, body: '' });

    https
      .get(url, { headers: { 'user-agent': UA, 'accept-language': 'el,en' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(get(new URL(res.headers.location, url).href, hops + 1));
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ code: res.statusCode, body }));
      })
      .on('error', (err) => resolve({ code: 0, body: '', error: String(err) }));
  });
}

// Διαστάσεις εικόνας από τα πρώτα bytes του JPEG.
//
// Τις θέλουμε ΠΡΙΝ χτιστεί η σελίδα: η κάρτα δεσμεύει ύψος με
// aspect-ratio, ώστε να μην πηδάει η αρχική όταν φορτώσουν οι εικόνες.
// Κατεβάζουμε μόνο την αρχή του αρχείου και κλείνουμε τη σύνδεση.
function imageSize(url) {
  const https = require('https');
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'user-agent': UA } }, (res) => {
      if (res.statusCode !== 200) {
        res.destroy();
        return resolve(null);
      }

      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        chunks.push(c);
        size += c.length;
        if (size > 16000) res.destroy();
      });
      res.on('close', () => {
        const buf = Buffer.concat(chunks);
        // Περπατάμε τα τμήματα του JPEG ώσπου να βρούμε ένα SOF.
        let i = 2;
        while (i < buf.length - 9) {
          if (buf[i] !== 0xff) {
            i++;
            continue;
          }
          const marker = buf[i + 1];
          const isSOF = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
          if (isSOF) {
            return resolve({ height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) });
          }
          i += 2 + buf.readUInt16BE(i + 2);
        }
        resolve(null);
      });
    });
    req.on('error', () => resolve(null));
  });
}

async function oembed(endpoint) {
  const res = await get(endpoint);
  if (res.code !== 200) return null;
  try {
    return JSON.parse(res.body);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// YouTube Shorts
// ---------------------------------------------------------------------

async function fetchShorts() {
  const page = await get(CHANNEL);
  if (page.code !== 200) {
    console.warn(`ΠΡΟΣΟΧΗ: η σελίδα Shorts δεν απάντησε (${page.code})`);
    return [];
  }

  // Οι κωδικοί κάθονται μέσα στο ytInitialData, με τη σειρά που τους
  // δείχνει το κανάλι: νεότερο πρώτο. Το Set πετάει τα διπλά, γιατί
  // ο ίδιος κωδικός εμφανίζεται και στις μικρογραφίες και στα links.
  const ids = [...new Set([...page.body.matchAll(/"videoId":"([\w-]{11})"/g)].map((m) => m[1]))];

  if (!ids.length) {
    console.warn('ΠΡΟΣΟΧΗ: δεν βρέθηκε κανένα Short — μάλλον άλλαξε η σελίδα του YouTube');
    return [];
  }

  const out = [];
  for (const id of ids.slice(0, MAX_SHORTS)) {
    const data = await oembed(
      `https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${id}`
    );
    if (!data) continue;

    // Η μικρογραφία που δίνει το oEmbed είναι 16:9 με μαύρες μπάρες
    // δεξιά κι αριστερά — άχρηστη για κάθετη κάρτα. Η oardefault είναι
    // στις αληθινές αναλογίες του βίντεο («original aspect ratio»),
    // αλλά δεν υπάρχει για όλα, οπότε πέφτουμε πίσω στο oEmbed.
    // Δεύτερη εφεδρεία η frame0: μικρή, αλλά κάθετη. Προτιμάμε μια
    // μικρή σωστών αναλογιών από μια μεγάλη με μπάρες.
    let image = '';
    let size = null;
    for (const candidate of [
      `https://i.ytimg.com/vi/${id}/oardefault.jpg`,
      `https://i.ytimg.com/vi/${id}/frame0.jpg`,
      data.thumbnail_url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    ]) {
      size = await imageSize(candidate);
      if (size) {
        image = candidate;
        if (size.height > size.width) break;
      }
    }

    out.push({
      id: `yt-${id}`,
      platform: 'youtube',
      title: data.title || '',
      url: `https://www.youtube.com/shorts/${id}`,
      image,
      width: size ? size.width : 0,
      height: size ? size.height : 0,
    });
  }

  console.log(`YouTube Shorts: ${out.length} από ${ids.length} που βρέθηκαν`);
  return out;
}

// ---------------------------------------------------------------------
// TikTok και Instagram — από τα χειροκίνητα links
// ---------------------------------------------------------------------

function readLinks() {
  if (!fs.existsSync(LINKS_FILE)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(LINKS_FILE, 'utf8'));
    return Array.isArray(raw.links) ? raw.links : [];
  } catch (err) {
    console.warn(`ΠΡΟΣΟΧΗ: το ${path.basename(LINKS_FILE)} δεν διαβάζεται — ${err.message}`);
    return [];
  }
}

// Δέχεται είτε σκέτο link, είτε αντικείμενο με link + δικά μας στοιχεία.
function normalizeLink(entry) {
  if (typeof entry === 'string') return { url: entry.trim() };
  if (entry && typeof entry.url === 'string') return { ...entry, url: entry.url.trim() };
  return null;
}

function platformOf(url) {
  if (/tiktok\.com/i.test(url)) return 'tiktok';
  if (/instagram\.com/i.test(url)) return 'instagram';
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  return null;
}

async function fetchManual() {
  const out = [];

  for (const entry of readLinks().map(normalizeLink).filter(Boolean)) {
    const platform = platformOf(entry.url);
    if (!platform) {
      console.warn(`ΠΡΟΣΟΧΗ: άγνωστη πλατφόρμα — ${entry.url.slice(0, 60)}`);
      continue;
    }

    const item = {
      id: `${platform}-${slug(entry.url)}`,
      platform,
      title: entry.title || '',
      url: entry.url,
      image: entry.image || '',
    };

    if (platform === 'tiktok') {
      const data = await oembed(`https://www.tiktok.com/oembed?url=${encodeURIComponent(entry.url)}`);
      if (data) {
        // Ό,τι έγραψε ο συντάκτης υπερισχύει του αυτόματου.
        item.title = item.title || data.title || '';
        item.image = item.image || data.thumbnail_url || '';
      } else {
        console.warn(`ΠΡΟΣΟΧΗ: το TikTok δεν απάντησε για ${entry.url.slice(0, 60)}`);
      }
    }

    // Χωρίς εικόνα η κάρτα βγαίνει άδειο ορθογώνιο — καλύτερα να λείπει.
    if (!item.image) {
      console.warn(`ΠΡΟΣΟΧΗ: χωρίς εικόνα, το παραλείπω — ${entry.url.slice(0, 60)}`);
      continue;
    }

    // Οι εικόνες του συντάκτη κάθονται στο public/, όχι στο δίκτυο.
    const size = /^https?:/i.test(item.image)
      ? await imageSize(item.image)
      : null;
    item.width = size ? size.width : 0;
    item.height = size ? size.height : 0;

    out.push(item);
  }

  if (out.length) console.log(`Χειροκίνητα links: ${out.length}`);
  return out;
}

// Σταθερός κωδικός από το link, για να μην αλλάζει σε κάθε τρέξιμο.
function slug(url) {
  return String(url)
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .split('/')
    .pop()
    .slice(0, 40);
}

// ---------------------------------------------------------------------

async function main() {
  const shorts = await fetchShorts();
  const manual = await fetchManual();

  const items = [...manual, ...shorts];

  // Αν δεν μαζέψαμε τίποτα, ΔΕΝ πατάμε πάνω στο παλιό αρχείο: μια
  // προσωρινή αλλαγή του YouTube δεν πρέπει να αδειάζει την αρχική.
  if (!items.length) {
    console.warn('Δεν μαζεύτηκε τίποτα — αφήνω το data/social.json ως έχει.');
    return;
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(items, null, 2) + '\n', 'utf8');
  console.log(`Γράφτηκαν ${items.length} στο data/social.json`);
}

// Ποτέ δεν ρίχνουμε το workflow για τα social: είναι το στολίδι, όχι
// το περιεχόμενο. Ό,τι πάει λάθος το λέμε και προχωράμε.
main().catch((err) => {
  console.warn(`ΠΡΟΣΟΧΗ: το fetch-social σταμάτησε — ${err.message}`);
});
