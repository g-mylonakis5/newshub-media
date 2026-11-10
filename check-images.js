// Δικλείδα: μπαίνουν σωστά οι εικόνες;
//
// Οι πηγές μας έχουν ΚΕΙΜΕΝΟ ΨΗΜΕΝΟ ΜΕΣΑ ΤΟΥΣ — τίτλο εκπομπής, όνομα
// καλεσμένου, πρόσωπο. Μια τετράγωνη αφίσα Buzzsprout (1400×1400) και
// μια μικρογραφία YouTube (1280×720) δεν αντέχουν κόψιμο: ό,τι κοπεί
// είναι πληροφορία που χάνεται, όχι «λίγο φόντο».
//
// Το κόψιμο δεν βγάζει σφάλμα πουθενά. Η σελίδα φορτώνει κανονικά, το
// CSS είναι έγκυρο, το build περνάει. Απλώς η εικόνα είναι λάθος — και
// το βλέπεις μόνο αν κοιτάξεις τη συγκεκριμένη κάρτα, στο συγκεκριμένο
// πλάτος οθόνης. Έτσι έζησε αθέατο ένα `object-fit: cover` που έκοβε το
// 44% ΚΑΘΕ αφίσας σε ΚΑΘΕ κινητό.
//
// Γι' αυτό δεν διαβάζουμε CSS, ΜΕΤΡΑΜΕ: ανοίγουμε αληθινές σελίδες σε
// αληθινό browser, σε δύο πλάτη, και για κάθε <img> υπολογίζουμε πόσο
// τοις εκατό της πραγματικής εικόνας δεν φαίνεται.
//
// Έξοδος 0 = καμία εικόνα δεν κόβεται. Έξοδος 1 = λίστα με τι κόβεται.
//
//   node check-images.js            (δείγμα — γρήγορο)
//   node check-images.js --all      (κάθε σελίδα — αργό)

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PUBLIC = path.join(__dirname, 'public');

// Πόσο κομμένη εικόνα περνάει. Δεν είναι μηδέν επειδή το στρογγύλεμα
// του browser αφήνει κλάσματα του pixel σε πλαίσιο που «δένει» σωστά.
const MAX_LOST = 3;

// Τα δύο πλάτη που μετράμε. Το 390 είναι iPhone — εκεί κρύφτηκε το
// σοβαρότερο σφάλμα, γιατί κανείς δεν ξαναμετράει το κινητό όταν
// πειράζει μια κάρτα στο desktop.
const WIDTHS = [1600, 390];

// ---------- ΤΙ ΕΠΙΤΡΕΠΕΤΑΙ ΝΑ ΚΟΒΕΤΑΙ ----------
//
// Κάθε εξαίρεση εδώ είναι ΑΠΟΦΑΣΗ, όχι παράβλεψη. Αν προσθέσεις κλάση
// σε αυτή τη λίστα, γράψε και γιατί — αλλιώς σε έναν χρόνο κανείς δεν
// θα ξέρει αν ήταν σκόπιμο ή συγκάλυψη.

// 1. Θολά υπόβαθρα και σκιασμένα φόντα. Δεν είναι εικόνες που κοιτάς·
//    είναι χρώμα πίσω από κείμενο. Εκεί το κόψιμο δεν φαίνεται.
const DECORATIVE = [
  'card-bloom',     // το θολό πίσω από κάθε κάρτα
  'hero-bloom',     // το ίδιο, στο πρωτοσέλιδο
  'page-hero-img',  // θολή κορυφή σελίδας επεισοδίου/εκπομπής
  'intro-bg',       // φόντο της εισαγωγής
  'tcard-media',    // φόντο κάρτας θέματος, στο 55% διαφάνεια
];

// 2. Πρόσωπα. Το κόψιμο είναι ο ΣΚΟΠΟΣ: θέλουμε το κεφάλι σε κύκλο ή
//    τετράγωνο, όχι ολόκληρη τη φωτογραφία.
const FACES = [
  'face-pic', 'plist-pic', 'pname-face', 'person',
  // Τα πορτρέτα των αρθρογράφων στις «Απόψεις». Έρχονται από το
  // newshub.gr σε ό,τι διαστάσεις τα ανέβασαν (συχνά 194×248, όρθια)
  // και μπαίνουν σε κύκλο 72×72 με object-position στο πάνω μισό: το
  // κόψιμο ΕΙΝΑΙ ο σκοπός, θέλουμε το κεφάλι.
  'apop-pic',
];

// 3. Φωτογραφίες ειδήσεων. Είναι ρεπορτάζ χωρίς ψημένο κείμενο, οπότε
//    αντέχουν κόψιμο όπως κάθε φωτογραφία εφημερίδας.
const PHOTOS = ['must-image', 'intro-photo'];

// 4. Το σβήσιμο των μαύρων λωρίδων. 585 βίντεό μας δεν έχουν maxres,
//    οπότε το YouTube δίνει 4:3 με μαύρες λωρίδες πάνω-κάτω — ακριβώς
//    το 25% του ύψους. Τις κόβουμε επίτηδες, σε πλαίσιο 16:9. Αυτό
//    ΔΕΝ είναι απώλεια: οι λωρίδες δεν είναι εικόνα.
//    Το αναγνωρίζουμε από τα σχήματα, όχι από κλάση — έτσι πιάνεται
//    όπου κι αν συμβεί, και δεν καλύπτει κανένα άλλο κόψιμο.
function isBarTrim(natAR, boxAR, lost){
  const near = (a, b) => Math.abs(a - b) < 0.04;
  return near(natAR, 4 / 3) && near(boxAR, 16 / 9) && lost < 26;
}

function allowed(classes, natAR, boxAR, lost){
  const has = (list) => list.some((c) => classes.includes(c));
  if (has(DECORATIVE) || has(FACES) || has(PHOTOS)) return true;
  return isBarTrim(natAR, boxAR, lost);
}

// ---------- ΠΟΙΕΣ ΣΕΛΙΔΕΣ ----------
//
// Το CSS είναι κοινό, οπότε δεν χρειάζεται να ανοίξουμε και τις 4.694
// σελίδες: χρειάζεται να ανοίξουμε μία από ΚΑΘΕ ΕΙΔΟΣ, ώστε να δούμε
// κάθε θέση εικόνας τουλάχιστον μία φορά.
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

// Σελίδα εκπομπής που είναι ΟΛΗ βίντεο: μόνο εκεί ζει το .grid--wide,
// το φαρδύ πλαίσιο 16:9. Χωρίς αυτήν η θέση μένει αμέτρητη.
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

// ---------- Η ΜΕΤΡΗΣΗ ----------

// Τρέχει ΜΕΣΑ στη σελίδα. Για κάθε εικόνα: πόσο μέρος της πραγματικής
// εικόνας δεν χωράει στο κουτί της;
function measure(){
  const out = [];
  for (const img of document.querySelectorAll('img')) {
    const box = img.getBoundingClientRect();
    // Κρυφές ή μικροσκοπικές: δεν τις βλέπει κανείς.
    if (box.width < 8 || box.height < 8) continue;
    // Δεν φόρτωσε — δεν ξέρουμε το πραγματικό της σχήμα, δεν κρίνουμε.
    if (!img.naturalWidth) continue;

    const cs = getComputedStyle(img);
    if (cs.visibility === 'hidden' || cs.opacity === '0') continue;

    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const fit = cs.objectFit;

    let lost = 0;
    let stretch = 0;

    if (fit === 'cover' || fit === 'none') {
      // Το cover μεγαλώνει την εικόνα μέχρι να γεμίσει το κουτί· ό,τι
      // περισσεύει πέφτει έξω.
      const scale = Math.max(box.width / nw, box.height / nh);
      const visible = (box.width / scale) * (box.height / scale);
      lost = Math.max(0, 1 - visible / (nw * nh)) * 100;
    } else if (fit === 'fill') {
      // Το fill δεν κόβει, ΠΑΡΑΜΟΡΦΩΝΕΙ. Σωστό μόνο όταν το κουτί έχει
      // ακριβώς το σχήμα της εικόνας — αλλιώς τα πρόσωπα τεντώνονται.
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

// Η μπάρα του player και το κάδρο του βίντεο δεν υπάρχουν στο HTML —
// τα φτιάχνει το player.js όταν πατήσεις αναπαραγωγή. Χωρίς αυτό το
// κλικ μένουν για πάντα αμέτρητα.
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
    for (const file of list) {
      const page = await ctx.newPage();
      try {
        await page.goto('file:///' + path.join(PUBLIC, file).split(path.sep).join('/'),
          { waitUntil: 'load', timeout: 30000 });

        // Οι εικόνες είναι lazy: χωρίς αυτό μετράμε μόνο την πρώτη οθόνη.
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

  // Ομαδοποίηση: ένα λάθος CSS χτυπάει σε εκατοντάδες εικόνες, και η
  // λίστα πρέπει να δείχνει ΤΗ ΘΕΣΗ που φταίει, όχι κάθε εμφάνισή της.
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
