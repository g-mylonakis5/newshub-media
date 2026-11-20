
const fs = require('fs');
const path = require('path');

const OUT_FILE = path.join(__dirname, 'data/social.json');
const LINKS_FILE = path.join(__dirname, 'data/social-links.json');

const CHANNEL = 'https://www.youtube.com/@newshubgr/shorts';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

// How many Shorts we keep. The homepage shows a few; the rest are for a
// future "all social" page.
const MAX_SHORTS = 24;

// ---------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------

// A plain GET that follows redirects. YouTube sends a 302 to a consent
// page, so without this we get an empty body.
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
        // We walk the JPEG's segments until we find an SOF.
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
// Ημερομηνίες
// ---------------------------------------------------------------------

// Η σελίδα /shorts δίνει τα βίντεο με σειρά αλλά ΧΩΡΙΣ ημερομηνία, και
// ούτε το oembed δίνει. Το RSS του καναλιού δίνει <published>, αλλά μόνο
// για τα 15 πιο πρόσφατα ΑΝΕΒΑΣΜΑΤΑ — και με 3.800 κανονικά βίντεο στο
// κανάλι, κανένα Short δεν προλαβαίνει να μπει εκεί. Δοκιμάστηκε: 0/24.
//
// Το API το λύνει με μία κλήση ανά 50 βίντεο, κόστους 1 μονάδας. Το
// κλειδί υπάρχει ήδη — ο fetcher τρέχει στο ίδιο βήμα με τα βίντεο.
// Χωρίς κλειδί δεν σπάει τίποτα: μένει η σειρά του καναλιού, που είναι
// ούτως ή άλλως νεότερα πρώτα.

// Διαβάζει το .env χωρίς βιβλιοθήκη — ένα NAME=value ανά γραμμή.
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

async function imerominies(ids) {
  const map = new Map();
  if (!ids.length) return map;

  const key = readEnv().YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY || '';
  if (!key) {
    console.warn('ΠΡΟΣΟΧΗ: χωρίς YOUTUBE_API_KEY — τα Shorts μένουν στη σειρά '
      + 'που τα δίνει το κανάλι, χωρίς ημερομηνία.');
    return map;
  }

  // Το API δέχεται μέχρι 50 id ανά κλήση.
  for (let i = 0; i < ids.length; i += 50) {
    const fasa = ids.slice(i, i + 50);
    const url = 'https://www.googleapis.com/youtube/v3/videos'
      + `?part=snippet&maxResults=50&id=${fasa.join(',')}&key=${key}`;

    const res = await get(url);
    if (res.code !== 200) {
      console.warn(`ΠΡΟΣΟΧΗ: το YouTube API απάντησε ${res.code} — `
        + 'συνεχίζω χωρίς ημερομηνίες.');
      break;
    }

    let data;
    try {
      data = JSON.parse(res.body);
    } catch (err) {
      console.warn(`ΠΡΟΣΟΧΗ: το YouTube API δεν διαβάστηκε — ${err.message}`);
      break;
    }

    for (const item of data.items || []) {
      const pub = item.snippet && item.snippet.publishedAt;
      if (item.id && pub) map.set(item.id, pub);
    }
  }

  console.log(`YouTube API: ${map.size} ημερομηνίες από ${ids.length} Shorts`);
  return map;
}

// Ό,τι ημερομηνία ξέρουμε ήδη από το αρχείο της προηγούμενης φοράς. Ένα
// Short βγαίνει από τα 15 του RSS μέσα σε λίγες μέρες· χωρίς αυτό θα
// έχανε την ημερομηνία του και θα ξανάπεφτε στο τέλος της λωρίδας.
function palies() {
  const map = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (item && item.id && item.date) map.set(item.id, item.date);
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`ΠΡΟΣΟΧΗ: το παλιό ${path.basename(OUT_FILE)} δεν διαβάστηκε — ${err.message}`);
    }
  }
  return map;
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

  // The ids sit inside ytInitialData, in the order the channel shows
  // them: newest first. The Set drops duplicates, because the same id
  // appears in both the thumbnails and the links.
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
      date: '',
    });
  }

  console.log(`YouTube Shorts: ${out.length} από ${ids.length} που βρέθηκαν`);
  return out;
}

// ---------------------------------------------------------------------
// TikTok and Instagram — from the manual links
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

// Takes either a bare link or an object with link + details of our own.
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
        // What the editor wrote wins over the automatic value.
        item.title = item.title || data.title || '';
        item.image = item.image || data.thumbnail_url || '';
      } else {
        console.warn(`ΠΡΟΣΟΧΗ: το TikTok δεν απάντησε για ${entry.url.slice(0, 60)}`);
      }
    }

    // With no image the card is an empty rectangle — better left out.
    if (!item.image) {
      console.warn(`ΠΡΟΣΟΧΗ: χωρίς εικόνα, το παραλείπω — ${entry.url.slice(0, 60)}`);
      continue;
    }

    // The editor's images sit in public/, not on the network.
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

// A stable id from the link, so it does not change on every run.
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

  // Οι ημερομηνίες: ό,τι λέει το API σήμερα, πάνω σε ό,τι είχαμε μάθει
  // τις προηγούμενες φορές. Το API κερδίζει, γιατί είναι η πηγή — το
  // παλιό αρχείο είναι μόνο δίχτυ για μέρες που δεν απαντάει.
  const potes = palies();
  const ytIds = shorts.map((x) => String(x.id).replace(/^yt-/, ''));
  for (const [id, date] of await imerominies(ytIds)) potes.set(`yt-${id}`, date);

  for (const item of items) {
    if (!item.date) item.date = potes.get(item.id) || '';
  }

  // Νεότερα πρώτα. Όσα δεν έχουν ημερομηνία — χειροκίνητα links, ή
  // Shorts που βγήκαν από τα 15 του RSS πριν προλάβουμε — κρατούν τη
  // σειρά που ήρθαν και πάνε στο τέλος. Σταθερή ταξινόμηση: χωρίς αυτό
  // η λωρίδα θα κουνιόταν σε κάθε τρέξιμο χωρίς λόγο.
  items.forEach((item, i) => { item.seira = i; });
  items.sort((a, b) => {
    if (a.date && b.date) return new Date(b.date) - new Date(a.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return a.seira - b.seira;
  });
  items.forEach((item) => { delete item.seira; });

  const me = items.filter((x) => x.date).length;
  console.log(`Με ημερομηνία: ${me} από ${items.length}`);

  // If we collected nothing we do NOT overwrite the old file: a
  // temporary YouTube change must not empty the homepage.
  if (!items.length) {
    console.warn('Δεν μαζεύτηκε τίποτα — αφήνω το data/social.json ως έχει.');
    return;
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(items, null, 2) + '\n', 'utf8');
  console.log(`Γράφτηκαν ${items.length} στο data/social.json`);
}

// We never fail the workflow over social: it is the garnish, not the
// content. Whatever goes wrong we report and move on.
main().catch((err) => {
  console.warn(`ΠΡΟΣΟΧΗ: το fetch-social σταμάτησε — ${err.message}`);
});
