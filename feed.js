// feed.js — φέρνει και διαβάζει το RSS. Το χρησιμοποιούν τα άλλα αρχεία.

const fs = require('fs');

const FEED_URL = 'https://feeds.buzzsprout.com/1904089.rss';

async function loadFeed(source) {
  if (source && fs.existsSync(source)) {
    return fs.readFileSync(source, 'utf8');
  }
  const res = await fetch(source || FEED_URL);
  if (!res.ok) throw new Error('Το feed δεν απάντησε: ' + res.status);
  return res.text();
}

function tag(block, name) {
  const m = block.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>'));
  if (!m) return '';
  return m[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
}

function attr(block, name, key) {
  const m = block.match(new RegExp('<' + name + '[^>]*\\b' + key + '="([^"]*)"'));
  return m ? m[1] : '';
}

function toSeconds(value) {
  if (!value) return 0;
  if (!value.includes(':')) return parseInt(value, 10) || 0;
  return value.split(':').map(Number).reduce((total, part) => total * 60 + part, 0);
}

// Καθαρίζει HTML και κενά από την περιγραφή.
const ENTITIES = {
  nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>',
  laquo: '«', raquo: '»', hellip: '…', ndash: '–', mdash: '—',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', deg: '°', euro: '€',
};

function entities(text) {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x'
        ? parseInt(code.slice(2), 16)
        : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    const found = ENTITIES[code.toLowerCase()];
    return found === undefined ? whole : found;
  });
}

function stripHtml(html) {
  let t = String(html).replace(/<[^>]+>/g, ' ');

  // Μερικές περιγραφές είναι κωδικοποιημένες δύο φορές: μέσα στο feed
  // γράφουν «&amp;apos;». Με μία περασιά έμενε «&apos;», που μετά το
  // escape της σελίδας γινόταν ορατό «&amp;apos;» πάνω στο κείμενο.
  // Δύο περασιές φτάνουν — παραπάνω θα χάλαγε κείμενο που θέλει «&».
  for (let i = 0; i < 2 && t.includes('&'); i++) t = entities(t);

  return t.replace(/\s+/g, ' ').trim();
}

// "Γαβριήλ Χαρίτος: Η 7η Οκτωβρίου..." -> καλεσμένος + καθαρός τίτλος.
// Αν δεν υπάρχει το μοτίβο, αφήνουμε τον τίτλο όπως είναι.
function splitGuest(title) {
  const m = title.match(/^([^:]{3,40}):\s*(.+)$/);
  if (!m) return { guest: '', headline: title };
  const guest = m[1].trim();
  const words = guest.split(/\s+/);
  if (words.length < 2 || words.length > 4) return { guest: '', headline: title };
  return { guest, headline: m[2].trim() };
}

function parseEpisodes(xml) {
  return xml.split('<item>').slice(1).map((raw) => {
    const block = raw.split('</item>')[0];
    const title = tag(block, 'title');
    const { guest, headline } = splitGuest(title);
    return {
      id: tag(block, 'guid').split('/').pop(),
      title,
      guest,
      headline,
      date: tag(block, 'pubDate') ? new Date(tag(block, 'pubDate')).toISOString() : '',
      seconds: toSeconds(tag(block, 'itunes:duration')),
      season: tag(block, 'itunes:season'),
      number: tag(block, 'itunes:episode'),
      image: attr(block, 'itunes:image', 'href'),
      audio: attr(block, 'enclosure', 'url'),
      page: tag(block, 'link'),
      keywords: tag(block, 'itunes:keywords').split(',').map((k) => k.trim()).filter(Boolean),
      // Χωρίς κόψιμο εδώ. Ήταν .slice(0, 600) και πετούσε κατά μέσο όρο
      // τα δύο τρίτα κάθε περιγραφής — 1.052 από τις 1.053 είναι πάνω
      // από 600 χαρακτήρες — κόβοντας μάλιστα στη μέση της λέξης.
      // Όποιος θέλει μικρό απόσπασμα το κόβει μόνος του (clip στο build).
      summary: stripHtml(tag(block, 'description')),
      transcript: attr(block, 'podcast:transcript', 'url'),
    };
  });
}

module.exports = { loadFeed, parseEpisodes, FEED_URL };
