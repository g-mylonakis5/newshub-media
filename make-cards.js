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
const EPISODES_FILE = path.join(__dirname, 'data/episodes.json');
const VIDEOS_FILE = path.join(__dirname, 'data/videos.json');
const OUT_DIR = path.join(__dirname, 'public/mf/kartes');

// Οι ειδήσεις είναι δικές τους — φέρουν το σήμα του newshub.gr. Τα
// podcast και τα βίντεο είναι δικά μας, άρα το Newshub Multimedia.
const LOGO_NEWS = path.join(__dirname, 'public/shows/logo-newshub.png');
const LOGO_MEDIA = path.join(__dirname, 'public/shows/logo-full-dark.png');

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
// Η ίδια η κάρτα
// ---------------------------------------------------------------------
//
// ΧΩΡΙΣ τίτλο πάνω στη φωτογραφία. Δοκιμάστηκε στον αέρα στις 20 Νοε
// 2026 και ο τίτλος φαινόταν τρεις φορές — στο κείμενο του post, πάνω
// στην εικόνα και στη λωρίδα της πλατφόρμας. Μένει η φωτογραφία, η
// ετικέτα με την κόκκινη γραμμή, και το σήμα.
function overlay(label){
  // Μια ελαφριά σκίαση μόνο στο κάτω μέρος, για να διαβάζεται η ετικέτα
  // πάνω σε φωτεινές φωτογραφίες. Όχι άλλη — η φωτογραφία είναι το θέμα.
  const bandTop = H - 190;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="skia" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${DARK}" stop-opacity="0"/>
      <stop offset="0.55" stop-color="${DARK}" stop-opacity="0.5"/>
      <stop offset="1" stop-color="${DARK}" stop-opacity="0.82"/>
    </linearGradient>
  </defs>

  <rect x="0" y="${bandTop}" width="${W}" height="${H - bandTop}" fill="url(#skia)"/>

  ${label ? `<text x="56" y="${H - 86}" font-family="Commissioner"
    font-size="24" letter-spacing="4.5" fill="${INK}">${esc(label)}</text>
  <rect x="56" y="${H - 66}" width="60" height="4" fill="${RED}"/>` : ''}
</svg>`;
}

async function grab(url){
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

const logoCache = new Map();
async function logo(file, height){
  const key = `${file}|${height}`;
  if (logoCache.has(key)) return logoCache.get(key);
  if (!fs.existsSync(file)) return null;
  const buf = await sharp(file).resize({ height }).png().toBuffer();
  logoCache.set(key, buf);
  return buf;
}

// Τετράγωνο εξώφυλλο podcast σε κάρτα 1200×630: αν το κόψουμε, χάνεται
// ο τίτλος που είναι τυπωμένος πάνω του. Οπότε η ίδια εικόνα μπαίνει
// δύο φορές — θολή και μεγεθυμένη για φόντο, και ολόκληρη από πάνω.
async function fitWhole(buffer){
  const back = await sharp(buffer)
    .resize(W, H, { fit: 'cover' })
    .blur(42)
    .modulate({ brightness: 0.55 })
    .toBuffer();

  const front = await sharp(buffer)
    .resize({ height: H - 48, fit: 'inside' })
    .toBuffer();

  const meta = await sharp(front).metadata();

  return sharp(back)
    .composite([{
      input: front,
      top: 24,
      left: Math.round((W - (meta.width || W)) / 2),
    }])
    .toBuffer();
}

// opts.label — η μικρή ετικέτα κάτω αριστερά (ΕΛΛΑΔΑ, PODCAST, ΒΙΝΤΕΟ)
// opts.logo  — ποιο σήμα μπαίνει πάνω δεξιά
// opts.whole — true όταν η εικόνα δεν αντέχει κόψιμο (τετράγωνα εξώφυλλα)
async function makeCard(photo, file, opts){
  const o = opts || {};
  if (!photo) throw new Error('χωρίς φωτογραφία');

  const raw = await grab(photo);

  const base = o.whole
    ? await fitWhole(raw)
    : await sharp(raw).resize(W, H, { fit: 'cover', position: 'attention' }).toBuffer();

  const band = new Resvg(overlay(o.label || ''), {
    fitTo: { mode: 'width', value: W },
    font: { fontFiles: [FONT_TITLE, FONT_LABEL], loadSystemFonts: false },
  }).render().asPng();

  const layers = [{ input: band, top: 0, left: 0 }];

  // o.logo === null σημαίνει «καθόλου σήμα»: τα εξώφυλλα των podcast
  // και τα καρέ των βίντεο έχουν ήδη τυπωμένο το Newshub Multimedia
  // πάνω τους, και δεύτερο σήμα από πάνω είναι σκέτη ακαταστασία.
  const mark = o.logo === null ? null : await logo(o.logo || LOGO_NEWS, o.logoHeight || 54);
  if (mark) {
    const meta = await sharp(mark).metadata();
    layers.push({ input: mark, top: 44, left: W - 56 - (meta.width || 150) });
  }

  await sharp(base).composite(layers).jpeg({ quality: 82, mozjpeg: true }).toFile(file);
}

// ---------------------------------------------------------------------

function read(file){
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn(`ΠΡΟΣΟΧΗ: το ${path.basename(file)} δεν διαβάζεται — ${err.message}`);
    return [];
  }
}

// Τι θέλει κάρτα, από τις τρεις πηγές. Το όνομα του αρχείου έχει
// πρόθεμα ανά είδος, ώστε μια είδηση και ένα επεισόδιο να μην
// πέσουν ποτέ πάνω στο ίδιο όνομα.
function wanted(){
  const limit = Date.now() - DAYS * 24 * 60 * 60 * 1000;
  const fresh = (date) => ALL || !date || new Date(date).getTime() >= limit;

  const out = [];

  for (const a of read(NEWS_FILE)) {
    if (!a || !a.id || !fresh(a.date)) continue;
    const photo = a.image_large || a.image_thumb;
    if (!photo) continue;
    out.push({
      name: `${a.id}.jpg`,
      photo,
      title: a.title,
      opts: { label: String(a.category || 'ΕΙΔΗΣΕΙΣ').toUpperCase(), logo: LOGO_NEWS },
    });
  }

  for (const ep of read(EPISODES_FILE)) {
    if (!ep || !ep.id || !ep.image || !fresh(ep.date)) continue;
    out.push({
      name: `ep-${String(ep.id).replace(/\D/g, '')}.jpg`,
      photo: ep.image,
      title: ep.title,
      // Το εξώφυλλο του Buzzsprout είναι τετράγωνο και έχει τον τίτλο
      // τυπωμένο πάνω του: ολόκληρο, ποτέ κομμένο.
      opts: { label: 'PODCAST', logo: null, whole: true },
    });
  }

  for (const v of read(VIDEOS_FILE)) {
    if (!v || !v.id || !v.image || !fresh(v.date)) continue;
    out.push({
      name: `vid-${v.id}.jpg`,
      photo: v.image,
      title: v.title,
      opts: { label: 'ΒΙΝΤΕΟ', logo: null },
    });
  }

  return out;
}

async function main(){
  if (!fs.existsSync(FONT_TITLE) || !fs.existsSync(FONT_LABEL)) {
    console.warn('ΠΡΟΣΟΧΗ: λείπουν οι γραμματοσειρές στο assets/fonts/ — καμία κάρτα.');
    return 0;
  }

  const list = wanted();
  if (!list.length) {
    console.log('Κάρτες social: δεν υπάρχει υλικό — τίποτα να φτιάξω.');
    return 0;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  let made = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of list) {
    const file = path.join(OUT_DIR, item.name);
    if (!FORCE && fs.existsSync(file)) { skipped++; continue; }

    try {
      await makeCard(item.photo, file, item.opts);
      made++;
    } catch (err) {
      failed++;
      console.warn(`  ⚠ κάρτα «${String(item.title || item.name).slice(0, 40)}…» — ${err.message}`);
    }
  }

  // Ό,τι δεν είναι πια στα δεδομένα δεν μοιράζεται ποτέ ξανά. Μετράει
  // ΟΛΗ η λίστα, όχι μόνο οι πρόσφατες: αλλιώς κάθε τρέξιμο θα έσβηνε
  // ό,τι έφτιαξε το προηγούμενο.
  const keep = new Set();
  for (const a of read(NEWS_FILE)) if (a && a.id) keep.add(`${a.id}.jpg`);
  for (const ep of read(EPISODES_FILE)) if (ep && ep.id) keep.add(`ep-${String(ep.id).replace(/\D/g, '')}.jpg`);
  for (const v of read(VIDEOS_FILE)) if (v && v.id) keep.add(`vid-${v.id}.jpg`);

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
