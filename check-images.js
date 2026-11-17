
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PUBLIC = path.join(__dirname, 'public');

// How much cropping passes. Not zero, because the browser's rounding
// leaves fractions of a pixel in a frame that fits correctly.
const MAX_LOST = 3;

// The two widths we measure. 390 is an iPhone — that is where the worst
// bug hid, because nobody re-measures the phone when tweaking a card on
// the desktop.
const WIDTHS = [1600, 390];

// 1. Blurred and dimmed backdrops. These are not images you look at;
//    they are colour behind text. Cropping does not show there.
const DECORATIVE = [
  'card-bloom',     // το θολό πίσω από κάθε κάρτα
  'hero-bloom',     // το ίδιο, στο πρωτοσέλιδο
  'page-hero-img',  // θολή κορυφή σελίδας επεισοδίου/εκπομπής
  'intro-bg',       // φόντο της εισαγωγής
  'tcard-media',    // φόντο κάρτας θέματος, στο 55% διαφάνεια
];

// 2. Faces. Cropping is the POINT: we want the head in a circle or a
//    square, not the whole photo.
const FACES = [
  'face-pic', 'plist-pic', 'pname-face', 'person',
  'apop-pic',
];

// 3. News photos. Reporting shots with no baked-in text, so they take
//    cropping like any newspaper photo.
const PHOTOS = ['must-image', 'intro-photo'];

function isBarTrim(natAR, boxAR, lost){
  const near = (a, b) => Math.abs(a - b) < 0.04;
  return near(natAR, 4 / 3) && near(boxAR, 16 / 9) && lost < 26;
}

function allowed(classes, natAR, boxAR, lost){
  const has = (list) => list.some((c) => classes.includes(c));
  if (has(DECORATIVE) || has(FACES) || has(PHOTOS)) return true;
  return isBarTrim(natAR, boxAR, lost);
}

function sample(dir, n){
  const full = path.join(PUBLIC, dir);
  if (!fs.existsSync(full)) return [];
  const files = fs.readdirSync(full).filter((f) => f.endsWith('.html')).sort();
  const out = [];
  for (let i = 0; i < n && i < files.length; i++) {
    out.push(`${dir}/${files[Math.floor((i * files.length) / n)]}`);
  }
  return out;
}

// A show page that is ALL video: .grid--wide, the wide 16:9 frame, lives
// only there. Without it the slot goes unmeasured.
function wideShow(){
  const dir = path.join(PUBLIC, 'show');
  if (!fs.existsSync(dir)) return [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.html')) continue;
    if (fs.readFileSync(path.join(dir, f), 'utf8').includes('grid--wide')) {
      return [`show/${f}`];
    }
  }
  return [];
}

function pages(){
  if (process.argv.includes('--all')) {
    const out = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(path.join(PUBLIC, d), { withFileTypes: true })) {
        if (e.isDirectory() && e.name !== 'pagefind') walk(path.join(d, e.name));
        else if (e.name.endsWith('.html')) out.push(path.join(d, e.name).split(path.sep).join('/'));
      }
    };
    walk('.');
    return out.map((p) => p.replace(/^\.\//, ''));
  }

  return [
    'index.html', 'episodes.html', 'shows.html', 'guests.html',
    'categories.html', 'search.html',
    ...sample('episode', 3),
    ...sample('video', 3),
    ...sample('guest', 2),
    ...sample('show', 2),
    ...wideShow(),
    ...sample('category', 2),
    ...sample('arthro', 2),
    ...sample('transcript', 1),
    ...sample('shows', 1),
  ];
}

// ---------- THE MEASUREMENT ----------

// Runs INSIDE the page. For each image: how much of the real image does
// not fit in its box?
function measure(){
  const out = [];
  for (const img of document.querySelectorAll('img')) {
    const box = img.getBoundingClientRect();
    // Hidden or tiny: nobody sees them.
    if (box.width < 8 || box.height < 8) continue;
    // Did not load — we do not know its real shape, so we do not judge.
    if (!img.naturalWidth) continue;

    const cs = getComputedStyle(img);
    if (cs.visibility === 'hidden' || cs.opacity === '0') continue;

    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const fit = cs.objectFit;

    let lost = 0;
    let stretch = 0;

    if (fit === 'cover' || fit === 'none') {
      // cover scales the image up until the box is full; whatever is
      // left over falls outside.
      const scale = Math.max(box.width / nw, box.height / nh);
      const visible = (box.width / scale) * (box.height / scale);
      lost = Math.max(0, 1 - visible / (nw * nh)) * 100;
    } else if (fit === 'fill') {
      // fill does not crop, it DISTORTS. Correct only when the box has
      // exactly the image's shape — otherwise faces stretch.
      stretch = Math.abs(Math.log((box.width / box.height) / (nw / nh)));
    }

    out.push({
      classes: (img.className || '').toString().split(/\s+/).filter(Boolean),
      parent: (img.parentElement && img.parentElement.className || '').toString(),
      src: img.currentSrc || img.src,
      fit,
      natAR: nw / nh,
      boxAR: box.width / box.height,
      nat: `${nw}×${nh}`,
      box: `${Math.round(box.width)}×${Math.round(box.height)}`,
      lost: Math.round(lost * 10) / 10,
      stretch: Math.round(stretch * 100) / 100,
    });
  }
  return out;
}

// The player bar and the video frame are not in the HTML — player.js
// builds them when you press play. Without this click they stay
// unmeasured forever.
async function wakePlayer(page){
  const btn = page.locator('[data-player="toggle"]').first();
  if (!(await btn.count())) return;
  try {
    await btn.click({ timeout: 2000 });
    await page.waitForTimeout(1200);
  } catch (e) { /* δεν άνοιξε — δεν πειράζει, συνεχίζουμε */ }
}

async function main(){
  const list = pages();
  const browser = await chromium.launch();
  const bad = [];
  let seen = 0;

  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });

    await ctx.route('**/pagead2.googlesyndication.com/**', (r) => r.abort());

    for (const file of list) {
      const page = await ctx.newPage();
      try {
        await page.goto('file:///' + path.join(PUBLIC, file).split(path.sep).join('/'),
          { waitUntil: 'load', timeout: 30000 });

        // The images are lazy: without this we measure only the first screen.
        await page.evaluate(() => {
          document.querySelectorAll('img[loading="lazy"]').forEach((i) => { i.loading = 'eager'; });
        });
        await page.waitForTimeout(2500);
        await wakePlayer(page);

        for (const r of await page.evaluate(measure)) {
          seen++;
          if (allowed(r.classes.concat(r.parent.split(/\s+/)), r.natAR, r.boxAR, r.lost)) continue;
          if (r.lost > MAX_LOST || r.stretch > 0.02) bad.push({ ...r, file, width });
        }
      } catch (err) {
        console.error(`Δεν άνοιξε: ${file} — ${err.message}`);
      }
      await page.close();
    }
    await ctx.close();
  }
  await browser.close();

  if (!bad.length) {
    console.log(`Εντάξει: ${seen} εικόνες σε ${list.length} σελίδες × ${WIDTHS.length} πλάτη. Καμία δεν κόβεται.`);
    return 0;
  }

  // Grouping: one CSS mistake hits hundreds of images, and the list must
  // show THE SLOT at fault, not every appearance of it.
  const groups = new Map();
  for (const b of bad) {
    const key = `${b.classes.join('.') || '(χωρίς κλάση)'}|${b.width}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }

  console.error(`ΛΑΘΟΣ ΕΙΚΟΝΑ: ${bad.length} από ${seen} μετρήσεις, σε ${groups.size} θέσεις.\n`);
  for (const [key, items] of [...groups].sort((a, b) => b[1][0].lost - a[1][0].lost)) {
    const w = items.reduce((a, x) => (x.lost > a.lost ? x : a), items[0]);
    const [cls, width] = key.split('|');
    console.error(`  .${cls}  στα ${width}px`);
    if (w.stretch > 0.02) {
      console.error(`    παραμορφώνεται: εικόνα ${w.nat} σε κουτί ${w.box} με object-fit: fill`);
    } else {
      console.error(`    χάνεται ${w.lost}%: εικόνα ${w.nat} σε κουτί ${w.box} με object-fit: ${w.fit}`);
    }
    console.error(`    ${items.length} εμφανίσεις, π.χ. ${w.file}`);
    console.error('');
  }
  console.error('Αν κάποιο από αυτά είναι σκόπιμο, πρόσθεσέ το στις λίστες '
    + 'DECORATIVE / FACES / PHOTOS στην κορυφή αυτού του αρχείου — με σχόλιο γιατί.');
  return 1;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('Ο έλεγχος εικόνων έσκασε:', err);
  process.exit(1);
});
