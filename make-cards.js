// make-cards.js — η εικόνα που βλέπει ο κόσμος στα social.
//
// Το αφεντικό ζήτησε την κάρτα όπως βγαίνει στο X από κινητό: η
// φωτογραφία ολόκληρη, ο τίτλος τυπωμένος ΠΑΝΩ της κάτω αριστερά, το
// σήμα του newshub στη γωνία. Το Facebook δεν τυπώνει ποτέ τίτλο πάνω
// στη φωτογραφία — βάζει δική του λωρίδα από κάτω. Οπότε τον τυπώνουμε
// εμείς μέσα στην εικόνα: τότε φαίνεται ίδια παντού, σε Facebook, X,
// Viber, Messenger, WhatsApp.
//
// ΜΟΝΟ για τα social. Το site δεν αγγίζεται: οι κάρτες ζουν στο
// public/mf/kartes/ και τις δείχνει μόνο η σελίδα μοιράσματος.
//
//   node make-cards.js          — όσες λείπουν, για τις πρόσφατες
//   node make-cards.js --all    — για όλες τις ειδήσεις που έχουμε
//   node make-cards.js --force  — ξαναφτιάχνει και όσες υπάρχουν
//
// Τρέχει ΠΡΙΝ το build.js (δες publish.js): το build κοιτάζει ποιες
// κάρτες υπάρχουν και δείχνει εκεί το og:image.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { Resvg } = require('@resvg/resvg-js');

const NEWS_FILE = path.join(__dirname, 'data/news.json');
const OUT_DIR = path.join(__dirname, 'public/mf/kartes');
const LOGO = path.join(__dirname, 'public/shows/logo-newshub.png');

const FONT_TITLE = path.join(__dirname, 'assets/fonts/SourceSerif4-SemiBold.ttf');
const FONT_LABEL = path.join(__dirname, 'assets/fonts/Commissioner-SemiBold.ttf');

// Το μέγεθος που ζητούν όλες οι πλατφόρμες για μεγάλη κάρτα.
const W = 1200;
const H = 630;

// Πόσο πίσω πάμε όταν δεν ζητηθεί αλλιώς. Μοιράζεται ό,τι είναι φρέσκο·
// μια είδηση δέκα ημερών δεν ανεβαίνει ποτέ στα social.
// Βγάζουν περίπου 130 ειδήσεις τη μέρα: στις 3 ημέρες είναι ~400
// κάρτες, που φτιάχνονται μία φορά και μένουν στη μνήμη του CI. Πιο
// πίσω δεν χρειάζεται — είδηση τριών ημερών δεν ανεβαίνει στα social.
const DAYS = 3;

// Τα χρώματα του site — ίδια με τα CSS variables του styles.css.
const INK = '#F0EDE8';
const DARK = '#121010';
const RED = '#CF2233';

const ARGS = process.argv.slice(2);
const ALL = ARGS.includes('--all');
const FORCE = ARGS.includes('--force');

// Ο scraper του Facebook τρώει 403 στο static.newshub.gr. Εμείς όχι, αν
// δεν συστηθούμε ως ρομπότ.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function esc(text){
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------
// Πόσο πιάνει μια αράδα
// ---------------------------------------------------------------------
//
// Δεν το μαντεύουμε: ζητάμε από τον ίδιο μηχανισμό που θα τη ζωγραφίσει
// να μας πει το πλάτος της. Αλλιώς τα ελληνικά κεφαλαία ξεχειλίζουν και
// ο τίτλος βγαίνει κομμένος.
const widthCache = new Map();

function textWidth(text, size, font){
  const key = `${font}|${size}|${text}`;
  if (widthCache.has(key)) return widthCache.get(key);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="400">
    <text x="0" y="200" font-family="${font}" font-size="${size}">${esc(text)}</text>
  </svg>`;

  let w = 0;
  try {
    const box = new Resvg(svg, {
      font: { fontFiles: [FONT_TITLE, FONT_LABEL], loadSystemFonts: false },
    }).getBBox();
    w = box ? box.width : text.length * size * 0.5;
  } catch {
    w = text.length * size * 0.5;
  }

  widthCache.set(key, w);
  return w;
}

function wrap(text, size, font, maxWidth, maxLines){
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size, font) > maxWidth) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    } else {
      line = next;
    }
  }

  if (lines.length < maxLines && line) lines.push(line);

  // Δεν χώρεσε: η τελευταία αράδα κόβεται με αποσιωπητικά, ποτέ στη μέση
  // λέξης αν μπορεί να αποφευχθεί.
  const used = lines.join(' ');
  if (used.length < String(text).replace(/\s+/g, ' ').trim().length) {
    let last = lines[lines.length - 1] || '';
    while (last && textWidth(`${last}…`, size, font) > maxWidth) {
      last = last.replace(/\s*\S+$/, '');
    }
    lines[lines.length - 1] = `${last}…`;
  }

  return lines;
}

// ---------------------------------------------------------------------
// Η ίδια η κάρτα
// ---------------------------------------------------------------------

// Το κείμενο σμικρύνεται μέχρι να χωρέσει σε τρεις αράδες. Κάτω από 38
// δεν κατεβαίνουμε — σε κινητό δεν διαβάζεται.
function fitTitle(title){
  for (const size of [54, 50, 46, 42, 38]) {
    const lines = wrap(title, size, 'Source Serif 4', W - 112, 3);
    const whole = lines.join(' ').replace('…', '');
    if (lines.length <= 3 && String(title).startsWith(whole.slice(0, 20))) {
      if (!lines.join('').includes('…') || size === 38) return { size, lines };
    }
  }
  return { size: 38, lines: wrap(title, 38, 'Source Serif 4', W - 112, 3) };
}

function overlay(title, label){
  const { size, lines } = fitTitle(title);
  const leading = Math.round(size * 1.22);
  const bottom = H - 54;

  // Από κάτω προς τα πάνω: η τελευταία αράδα κάθεται πάνω από το κάτω
  // περιθώριο και οι προηγούμενες στοιβάζονται από πάνω της.
  const texts = lines.map((line, i) => {
    const y = bottom - (lines.length - 1 - i) * leading;
    return `<text x="56" y="${y}" font-family="Source Serif 4" font-size="${size}"
      fill="${INK}">${esc(line)}</text>`;
  }).join('\n');

  const bandTop = bottom - lines.length * leading - 48;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="skia" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${DARK}" stop-opacity="0"/>
      <stop offset="0.3" stop-color="${DARK}" stop-opacity="0.58"/>
      <stop offset="0.6" stop-color="${DARK}" stop-opacity="0.86"/>
      <stop offset="1" stop-color="${DARK}" stop-opacity="0.96"/>
    </linearGradient>
  </defs>

  <rect x="0" y="${Math.max(0, bandTop)}" width="${W}" height="${H - Math.max(0, bandTop)}"
    fill="url(#skia)"/>

  <rect x="56" y="${Math.max(24, bandTop - 6)}" width="54" height="4" fill="${RED}"/>

  ${label ? `<text x="56" y="${Math.max(24, bandTop - 24)}" font-family="Commissioner"
    font-size="22" letter-spacing="4" fill="${INK}" fill-opacity="0.82">${esc(label)}</text>` : ''}

  ${texts}
</svg>`;
}

async function grab(url){
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

let logoBuffer = null;
async function logo(){
  if (logoBuffer) return logoBuffer;
  if (!fs.existsSync(LOGO)) return null;
  logoBuffer = await sharp(LOGO).resize({ height: 54 }).png().toBuffer();
  return logoBuffer;
}

async function makeCard(item, file){
  const photo = item.image_large || item.image_thumb;
  if (!photo) throw new Error('χωρίς φωτογραφία');

  const base = await sharp(await grab(photo))
    .resize(W, H, { fit: 'cover', position: 'attention' })
    .toBuffer();

  const svg = overlay(item.title || '', (item.category || '').toUpperCase());

  const band = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    font: { fontFiles: [FONT_TITLE, FONT_LABEL], loadSystemFonts: false },
  }).render().asPng();

  const layers = [{ input: band, top: 0, left: 0 }];

  const mark = await logo();
  if (mark) {
    const meta = await sharp(mark).metadata();
    layers.push({ input: mark, top: 44, left: W - 56 - (meta.width || 150) });
  }

  await sharp(base).composite(layers).jpeg({ quality: 82, mozjpeg: true }).toFile(file);
}

// ---------------------------------------------------------------------

async function main(){
  if (!fs.existsSync(NEWS_FILE)) {
    console.log('Κάρτες social: δεν υπάρχει data/news.json — τίποτα να φτιάξω.');
    return 0;
  }

  if (!fs.existsSync(FONT_TITLE) || !fs.existsSync(FONT_LABEL)) {
    console.warn('ΠΡΟΣΟΧΗ: λείπουν οι γραμματοσειρές στο assets/fonts/ — καμία κάρτα.');
    return 0;
  }

  const list = JSON.parse(fs.readFileSync(NEWS_FILE, 'utf8'));
  const limit = Date.now() - DAYS * 24 * 60 * 60 * 1000;

  const wanted = list
    .filter((a) => a && a.id && a.title && (a.image_large || a.image_thumb))
    .filter((a) => ALL || !a.date || new Date(a.date).getTime() >= limit);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  let made = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of wanted) {
    const file = path.join(OUT_DIR, `${item.id}.jpg`);
    if (!FORCE && fs.existsSync(file)) { skipped++; continue; }

    try {
      await makeCard(item, file);
      made++;
    } catch (err) {
      failed++;
      console.warn(`  ⚠ κάρτα «${String(item.title).slice(0, 40)}…» — ${err.message}`);
    }
  }

  // Ό,τι δεν είναι πια στο news.json δεν μοιράζεται ποτέ ξανά.
  const keep = new Set(list.map((a) => `${a.id}.jpg`));
  let removed = 0;
  for (const file of fs.readdirSync(OUT_DIR)) {
    if (!file.endsWith('.jpg') || keep.has(file)) continue;
    fs.unlinkSync(path.join(OUT_DIR, file));
    removed++;
  }

  console.log(`Κάρτες social: ${made} νέες, ${skipped} υπήρχαν, ${failed} απέτυχαν, ${removed} σβήστηκαν`);
  return failed && !made ? 1 : 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(`Οι κάρτες social δεν φτιάχτηκαν: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main, makeCard };
