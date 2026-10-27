// Διαβάζει το RSS του podcast και τυπώνει τι υπάρχει μέσα.
// Τρέξε: node read-feed.js <διαδρομή-αρχείου-ή-URL>

const fs = require('fs');

const FEED_URL = 'https://feeds.buzzsprout.com/1904089.rss';

// --- 1. Φέρνουμε το feed -----------------------------------------------
async function loadFeed(source) {
  if (source && fs.existsSync(source)) {
    return fs.readFileSync(source, 'utf8');
  }
  const res = await fetch(source || FEED_URL);
  if (!res.ok) throw new Error('Το feed δεν απάντησε: ' + res.status);
  return res.text();
}

// --- 2. Μικρά βοηθητικά για να βγάλουμε τιμές από το XML ----------------
function tag(block, name) {
  const m = block.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>'));
  if (!m) return '';
  return m[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
}

function attr(block, name, key) {
  const m = block.match(new RegExp('<' + name + '[^>]*\\b' + key + '="([^"]*)"'));
  return m ? m[1] : '';
}

// "1:19:30" ή "24:46" ή "1470" -> δευτερόλεπτα
function toSeconds(value) {
  if (!value) return 0;
  if (!value.includes(':')) return parseInt(value, 10) || 0;
  const parts = value.split(':').map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

// --- 3. Σπάμε το feed σε επεισόδια --------------------------------------
function parseEpisodes(xml) {
  const blocks = xml.split('<item>').slice(1);
  return blocks.map((raw) => {
    const block = raw.split('</item>')[0];
    return {
      guid: tag(block, 'guid'),
      title: tag(block, 'title'),
      published: new Date(tag(block, 'pubDate')),
      seconds: toSeconds(tag(block, 'itunes:duration')),
      season: tag(block, 'itunes:season'),
      episode: tag(block, 'itunes:episode'),
      image: attr(block, 'itunes:image', 'href'),
      audio: attr(block, 'enclosure', 'url'),
      keywords: tag(block, 'itunes:keywords'),
      description: tag(block, 'description'),
      transcript: attr(block, 'podcast:transcript', 'url'),
    };
  });
}

// --- 4. Τυπώνουμε τι βρήκαμε --------------------------------------------
function hours(seconds) {
  return (seconds / 3600).toFixed(1);
}

async function main() {
  const xml = await loadFeed(process.argv[2]);
  const episodes = parseEpisodes(xml);

  const totalSeconds = episodes.reduce((sum, e) => sum + e.seconds, 0);
  const dates = episodes.map((e) => e.published).filter((d) => !isNaN(d));
  const withImage = episodes.filter((e) => e.image).length;
  const withAudio = episodes.filter((e) => e.audio).length;
  const withTranscript = episodes.filter((e) => e.transcript).length;
  const seasons = [...new Set(episodes.map((e) => e.season).filter(Boolean))];

  console.log('Επεισόδια:            ', episodes.length);
  console.log('Συνολική διάρκεια:    ', hours(totalSeconds), 'ώρες');
  console.log('Μέση διάρκεια:        ', Math.round(totalSeconds / episodes.length / 60), 'λεπτά');
  console.log('Πρώτο:                ', new Date(Math.min(...dates)).toISOString().slice(0, 10));
  console.log('Τελευταίο:            ', new Date(Math.max(...dates)).toISOString().slice(0, 10));
  console.log('Σεζόν:                ', seasons.sort().join(', ') || '—');
  console.log('Με εξώφυλλο:          ', withImage, '/', episodes.length);
  console.log('Με αρχείο ήχου:       ', withAudio, '/', episodes.length);
  console.log('Με απομαγνητοφώνηση:  ', withTranscript, '/', episodes.length);

  console.log('\nΤα 3 τελευταία:');
  for (const e of episodes.slice(0, 3)) {
    console.log(' -', e.title);
    console.log('   ', e.published.toISOString().slice(0, 10), '·', Math.round(e.seconds / 60), 'λεπτά');
  }
}

main().catch((err) => console.error('Σφάλμα:', err.message));
