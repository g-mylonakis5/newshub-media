// Κατεβάζει τις ειδήσεις του newshub.gr και γράφει το data/news.json.
//
// Το newshub.gr ΔΕΝ έχει RSS ούτε API. Έχει όμως sitemap ειδήσεων για τη
// Google — το ανακοινώνει το ίδιο του το robots.txt, δηλαδή είναι
// φτιαγμένο για να το διαβάζουν μηχανές. Από εκεί παίρνουμε διεύθυνση,
// τίτλο, ημερομηνία και κατηγορία με μία αίτηση.
//
// Περίληψη και φωτογραφία δεν υπάρχουν στο sitemap· τις παίρνουμε από το
// <head> κάθε άρθρου, και ΜΟΝΟ για όσα δεν έχουμε ήδη.
//
// Γράφει την ίδια μορφή που διαβάζει ήδη το build.js. Αν αύριο έρθει
// κανονικό API, αλλάζει μόνο αυτό το αρχείο και τίποτα άλλο.
//
//   node fetch-news.js

const fs = require('fs');
const path = require('path');
const https = require('https');

const SITEMAP = 'https://www.newshub.gr/sitemap_google_news.php';
const HOMEPAGE = 'https://www.newshub.gr/';
const OUT = path.join(__dirname, 'data', 'news.json');
const CURATION = path.join(__dirname, 'data', 'curation.json');

// Τα σώματα των ΕΙΔΗΣΕΩΝ του newshub.gr, ένα αρχείο το καθένα.
//
// ΟΧΙ μέσα στο news.json: εκείνο ξαναγράφεται ολόκληρο σε κάθε λήψη και
// είναι στο git. Με 600 σώματα μέσα του θα έστελνε ~2,5MB σε κάθε
// commit «Φρέσκο υλικό», πολλές φορές τη μέρα. Χωριστά αρχεία αλλάζουν
// μόνο όταν όντως προστεθεί άρθρο — ίδιο μοτίβο με το data/transcripts/.
//
// ΟΧΙ «articles»: το όνομα είναι πιασμένο. Το admin-api.js γράφει τα
// ΔΙΚΑ ΜΑΣ άρθρα — όσα συντάσσουν οι δημοσιογράφοι — στο
// data/articles.json. Δύο διαφορετικά πράγματα δεν μοιράζονται όνομα.
const BODY_DIR = path.join(__dirname, 'data', 'news-bodies');

// Πόσα άρθρα κρατάμε συνολικά. Το sitemap είναι κυλιόμενο παράθυρο 3
// ημερών — ό,τι δεν σώσουμε τώρα, χάνεται για πάντα. Γι' αυτό
// συσσωρεύουμε αντί να αντικαθιστούμε.
const KEEP = 600;

// Για πόσα από τα πιο πρόσφατα κρατάμε ΣΩΜΑ.
//
// Σώμα χρειάζονται μόνο όσα θα πάρουν δική τους σελίδα στο
// newshubmedia: τα must read και το πρωτοσέλιδο όταν είναι είδηση. Δεν
// ξέρουμε εδώ ποια θα διαλέξει το build, οπότε κρατάμε με το παραπάνω
// τα πιο πρόσφατα — από εκεί βγαίνουν — συν όσα ονομάζει το χέρι στο
// curation.json. Η ροή ειδήσεων στο πλάι ΔΕΝ θέλει σώμα: ανοίγει στο
// newshub.gr, όπως ζήτησε το αφεντικό.
const BODY_FOR = 20;

// Πόσα άρθρα κατεβάζουμε ταυτόχρονα. Το newshub.gr είναι μικρό site σε
// κοινόχρηστο server — δεν του ρίχνουμε 250 αιτήσεις μαζί.
const AT_ONCE = 4;

// Οι κατηγορίες τους, από τη διαδρομή /el/<slug>/. Τα ονόματα στο μενού
// τους είναι άτονα επειδή είναι σε κεφαλαία, οπότε τα γράφουμε σωστά εδώ.
// Όπου ταιριάζει με δική μας κατηγορία, κρατάμε ΤΟ ΔΙΚΟ ΜΑΣ όνομα.
const CATEGORY = {
  kriti: 'Κρήτη',
  ellada: 'Ελλάδα',
  kosmos: 'Κόσμος',
  oikonomia: 'Οικονομία',
  geopolitiki: 'Γεωπολιτική',
  politiki: 'Πολιτική',
  athlitika: 'Αθλητικά',
  ygeia: 'Υγεία',
  agronews: 'Agronews',
  'tech-hub': 'Tech-Hub',
  perivallon: 'Περιβάλλον',
  apopseis: 'Απόψεις',
  // Το αφεντικό ζήτησε να χωρίσει σε Ιστορία και Πολιτισμό. Από τη
  // διεύθυνση δεν φαίνεται ποιο από τα δύο είναι, οπότε μπαίνει στην
  // Ιστορία και το διορθώνει το διαχειριστικό.
  'istoria-politismos': 'Ιστορία',
  // Δικές τους, χωρίς αντίστοιχη δική μας. Μένουν ως ετικέτα.
  sugar: 'Sugar',
  'ta-en-oiko': 'Τα εν οίκω',
  exodos: 'Έξοδος',
  prosopografies: 'Προσωπογραφίες',
  'vima-toy-politi': 'Βήμα του πολίτη',
  'to-piato-tis-imeras': 'Το πιάτο της ημέρας',
  magazine: 'The Magazine',
};

// Τα δικά μας podcast, που ανεβάζουν και στο site τους. Δεν τα θέλουμε
// ως «ειδήσεις» — τα έχουμε ήδη από το Buzzsprout, με ήχο και σελίδα.
const SKIP = new Set(['ta-podcasts-toy-newshub-gr-1']);

function get(url, until = '') {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'newshub-media-build/1.0 (+https://newshubmedia.gr)',
        Connection: 'close',
      },
      // Φρέσκια σύνδεση κάθε φορά. Κόβουμε τη λήψη στη μέση μόλις βρούμε
      // ό,τι θέλουμε· αν η σύνδεση ξαναχρησιμοποιηθεί μετά από αυτό,
      // σπάνε οι επόμενες αιτήσεις — έτσι χάθηκαν 58 άρθρα σε μία λήψη.
      agent: false,
      timeout: 20000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.destroy();
        return resolve(get(res.headers.location, until));
      }
      if (res.statusCode !== 200) {
        res.destroy();
        return reject(new Error(`${res.statusCode} στο ${url}`));
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        // Δεν χρειαζόμαστε ολόκληρη τη σελίδα — μόνο μέχρι το σημάδι που
        // μας ενδιαφέρει. Κόβουμε εκεί τη σύνδεση: λιγότερα δεδομένα για
        // εμάς, λιγότερος φόρτος για τον δικό τους διακομιστή.
        if (until && body.includes(until)) {
          res.destroy();
          resolve(body);
        }
      });
      res.on('end', () => resolve(body));
      res.on('error', () => resolve(body));
    });

    req.on('timeout', () => { req.destroy(); reject(new Error(`λήξη χρόνου στο ${url}`)); });
    req.on('error', reject);
  });
}

// Το <head> γράφει τα meta με διάφορες σειρές και με tabs ανάμεσα, οπότε
// ψάχνουμε και τις δύο διατάξεις: content πριν ή μετά το όνομα.
function meta(head, name) {
  const a = head.match(new RegExp(`<meta[^>]*(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'));
  if (a) return a[1].trim();
  const b = head.match(new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i'));
  return b ? b[1].trim() : '';
}

function decode(s) {
  return String(s)
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .trim();
}

// Οι διευθύνσεις είναι της μορφής /el/<κατηγορία>/<τίτλος>
function partsOf(url) {
  const m = url.match(/\/el\/([a-z0-9-]+)\/([^/?#]+)/);
  return m ? { cat: m[1], slug: m[2] } : null;
}

function parseSitemap(xml) {
  const out = [];
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const block = m[1];
    const loc = (block.match(/<loc>([^<]+)<\/loc>/) || [])[1];
    const date = (block.match(/<news:publication_date>([^<]+)<\/news:publication_date>/) || [])[1];
    const title = (block.match(/<news:title>([^<]*)<\/news:title>/) || [])[1];
    if (!loc) continue;

    const p = partsOf(loc);
    if (!p || SKIP.has(p.cat)) continue;

    out.push({
      id: p.slug,
      url: loc,
      title: decode(title || ''),
      date: date || '',
      cat: p.cat,
    });
  }
  return out;
}

// Ποιο άρθρο έβαλαν ΕΚΕΙΝΟΙ πρώτο στην αρχική τους. Είναι η κρίση των
// δημοσιογράφων τους για το τι είναι σημαντικότερο σήμερα, και τη
// δανειζόμαστε αντί να μαντεύουμε — κανείς δεν χρειάζεται να μάθει
// καινούριο εργαλείο για να τη δώσει.
async function frontPagePick() {
  try {
    const html = await get(HOMEPAGE);
    const m = html.match(/id=["']frontpage-title["'][^>]*>/) ? html : null;
    if (!m) return '';
    // Ο πρώτος σύνδεσμος που φέρει το σημάδι του πρωτοσέλιδου.
    const link = html.match(/<a[^>]*href=["'](https:\/\/www\.newshub\.gr\/el\/[^"']+)["'][^>]*id=["']frontpage-title["']/);
    return link ? link[1] : '';
  } catch (err) {
    console.warn('ΠΡΟΣΟΧΗ: δεν διαβάστηκε η αρχική τους —', err.message);
    return '';
  }
}

const MONTHS = ['ιανουαριου', 'φεβρουαριου', 'μαρτιου', 'απριλιου', 'μαιου', 'ιουνιου',
  'ιουλιου', 'αυγουστου', 'σεπτεμβριου', 'οκτωβριου', 'νοεμβριου', 'δεκεμβριου'];

function bareMonth(word) {
  return word.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Η ώρα που διαβάζουμε είναι ώρα Ελλάδας. Τη μετατρέπουμε σε απόλυτη
// στιγμή δοκιμάζοντας και τις δύο ζώνες (θερινή +3, χειμερινή +2) και
// κρατώντας εκείνη που, γυρισμένη πίσω σε ώρα Αθήνας, ξαναδίνει την ώρα
// που διαβάσαμε. Έτσι δεν χρειάζεται να ξέρουμε πότε αλλάζει η ώρα.
function athensToISO(y, mo, d, h, mi) {
  for (const off of [3, 2]) {
    const t = Date.UTC(y, mo, d, h - off, mi);
    const back = new Date(t).toLocaleString('en-GB', {
      timeZone: 'Europe/Athens', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    const n = back.match(/(\d+)\/(\d+)\/(\d+),?\s+(\d+):(\d+)/);
    if (n && +n[1] === d && +n[2] === mo + 1 && +n[3] === y && +n[4] === h && +n[5] === mi) {
      return new Date(t).toISOString();
    }
  }
  return new Date(Date.UTC(y, mo, d, h - 3, mi)).toISOString();
}

// Η πραγματική ώρα δημοσίευσης: «16 Οκτωβρίου 2026 - 07:00».
//
// ΟΧΙ το og:updated_time — εκείνο είναι η στιγμή που ανανεώθηκε η
// προσωρινή μνήμη τους, ίδια για όλα τα άρθρα. Με αυτό, και τα 256
// άρθρα έπαιρναν την ίδια ώρα και η σειρά τους γινόταν τυχαία.
function when(html, fallbackDay) {
  // Υπάρχει και μία ημερομηνία μέσα σε σχόλιο HTML, λίγο πιο κάτω.
  const clean = html.replace(/<!--[\s\S]*?-->/g, '');
  const m = clean.match(/class="news-date"[^>]*>\s*(\d{1,2})\s+(\S+)\s+(\d{4})\s*[-–]\s*(\d{1,2}):(\d{2})/);

  if (m) {
    const mo = MONTHS.indexOf(bareMonth(m[2]));
    if (mo > -1) {
      const iso = athensToISO(+m[3], mo, +m[1], +m[4], +m[5]);
      // Άρθρα προγραμματισμένα για αργότερα: τα αφήνουμε. Δεν τα έχουν
      // δημοσιεύσει ακόμα ούτε εκείνοι, και δεν θα τα βγάλουμε εμείς
      // πρώτοι. Θα τα πάρουμε στο επόμενο τρέξιμο, όταν έρθει η ώρα τους.
      return new Date(iso) > Date.now() ? null : iso;
    }
  }

  // Εφεδρεία: η ημέρα από το sitemap, χωρίς ώρα.
  const d = new Date(fallbackDay);
  if (isNaN(d)) return new Date().toISOString();
  return d > Date.now() ? null : d.toISOString();
}

// Το σώμα του άρθρου, σε παραγράφους.
//
// Κάθεται πάντα σε <div id="news-desc" class="cmslinks"> και τελειώνει
// στο σημάδι news-tags. Μέσα είναι σκέτα <p>· όσα είναι ολόκληρα σε
// <strong> είναι υπότιτλοι και τα σημαδεύουμε ως τέτοιους, ώστε στη
// δική μας σελίδα να γίνουν κανονικές επικεφαλίδες και όχι ψεύτικο
// έντονο κείμενο.
//
// Κρατάμε ΚΕΙΜΕΝΟ, όχι HTML: ό,τι φτάνει εδώ είναι ξένη σελίδα και δεν
// το εμπιστευόμαστε να περάσει αυτούσιο μέσα στις δικές μας.
function articleBody(html) {
  const start = html.indexOf('id="news-desc"');
  if (start < 0) return [];

  let block = html.slice(start);

  // Τέλος: το σημάδι των ετικετών, ή — αν λείπει — το μπλοκ «Ακολουθήστε
  // μας», που είναι κολλημένο στο τέλος του κειμένου και δεν είναι άρθρο.
  for (const mark of ['news-tags', 'follow-news-social', 'news-related']) {
    const end = block.indexOf(mark);
    if (end > 0) block = block.slice(0, end);
  }

  const out = [];
  for (const m of block.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const raw = m[1];
    const text = decode(raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
    if (text.length < 2) continue;

    // Υπότιτλος: όλη η παράγραφος μέσα σε <strong>, χωρίς άλλο κείμενο.
    const bold = raw.match(/^\s*<strong[^>]*>([\s\S]*?)<\/strong>\s*$/i);
    out.push({ type: bold ? 'h' : 'p', text });
  }

  return trimTail(out);
}

// Πολλά άρθρα τελειώνουν με «Διαβάστε επίσης:» και συνδέσμους προς άλλα
// δικά τους. Είναι δική τους πλοήγηση, όχι κείμενο του άρθρου — και στη
// δική μας σελίδα θα έβγαινε επικεφαλίδα που δεν οδηγεί πουθενά.
//
// Κόβουμε ΜΟΝΟ όταν βρίσκεται στο τελευταίο τέταρτο. Η ίδια φράση στη
// μέση ενός κειμένου είναι παραπομπή του συντάκτη και δεν πειράζεται·
// αλλιώς ένα άρθρο θα έχανε τη μισή του ουσία.
const TAIL = /^\s*(Διαβάστε|Δείτε|Δειτε|Διαβαστε)\s+(επίσης|επισης|κι ακόμα)/i;

function trimTail(paras) {
  const from = Math.floor(paras.length * 0.75);
  const cut = paras.findIndex((p, i) => i >= from && TAIL.test(p.text));
  return cut > 0 ? paras.slice(0, cut) : paras;
}

async function details(item, wantBody = false) {
  // Σταματάμε μόλις περάσουμε την ημερομηνία — είναι λίγο κάτω από τον
  // τίτλο, άρα κατεβάζουμε ένα κλάσμα της σελίδας. Όταν θέλουμε και το
  // σώμα, κατεβαίνουμε ως τις ετικέτες: ~45KB αντί 32KB, ίδια αίτηση.
  const html = await get(item.url, wantBody ? 'news-tags' : 'news-share-container');
  const head = html.split('</head>')[0];
  const img = meta(head, 'og:image');

  const date = when(html, item.date);
  if (!date) return null;               // δημοσιεύεται αργότερα — όχι ακόμα

  return {
    id: item.id,
    title: decode(meta(head, 'og:title') || item.title).replace(/\s*-\s*Newshub\.gr\s*$/i, ''),
    url: item.url,
    date,
    category: CATEGORY[item.cat] || item.cat,
    // Έχουν δύο μεγέθη. Το μικρό για τις κάρτες, το μεγάλο για το hero.
    image_large: img,
    image_thumb: img.replace('/765x435/', '/400x227/'),
    summary: decode(meta(head, 'og:description')),
    featured: false,
  };
}

// ---- Τα σώματα ----

function bodyPath(id) {
  return path.join(BODY_DIR, `${id}.json`);
}

function hasBody(id) {
  return fs.existsSync(bodyPath(id));
}

function saveBody(article, paras) {
  // Σώμα κάτω από δύο παραγράφους δεν είναι άρθρο — είναι φωτογραφία με
  // λεζάντα ή σελίδα που δεν διαβάστηκε σωστά. Δεν το σώζουμε· έτσι το
  // build θα αφήσει το άρθρο να ανοίγει στο newshub.gr, αντί να βγάλει
  // δική μας σελίδα μισοάδεια.
  if (paras.length < 2) return false;

  fs.mkdirSync(BODY_DIR, { recursive: true });
  fs.writeFileSync(bodyPath(article.id), JSON.stringify({
    id: article.id,
    url: article.url,
    title: article.title,
    fetched: new Date().toISOString(),
    body: paras,
  }, null, 2), 'utf8');
  return true;
}

// Ποια άρθρα ονομάζει το χέρι στο curation.json; Εκείνα θέλουν σώμα
// όποια κι αν είναι η ημερομηνία τους — μπορεί να είναι μηνών.
function handPicked() {
  try {
    const c = JSON.parse(fs.readFileSync(CURATION, 'utf8'));
    return [...(c.mustRead || []), c.featured || '']
      .map((s) => String(s).trim())
      .filter(Boolean);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('ΠΡΟΣΟΧΗ: το data/curation.json δεν διαβάστηκε —', err.message);
    }
    return [];
  }
}

// Κατεβάζει τα σώματα που λείπουν, για όσα άρθρα μπορεί να πάρουν δική
// τους σελίδα. Τρέχει ΜΕΤΑ τη συγχώνευση, όταν ξέρουμε τη σειρά.
async function ensureBodies(all) {
  const want = new Map();

  for (const a of all.slice(0, BODY_FOR)) want.set(a.id, a);

  const picks = handPicked();
  if (picks.length) {
    for (const a of all) {
      if (picks.some((p) => p === a.url || p === a.id || p.includes(a.id))) want.set(a.id, a);
    }
  }

  const missing = [...want.values()].filter((a) => !hasBody(a.id));
  if (!missing.length) {
    console.log('Σώματα άρθρων: δεν λείπει κανένα');
    return;
  }

  console.log(`Σώματα άρθρων: κατεβάζω ${missing.length}`);
  let got = 0;
  let thin = 0;

  for (const a of missing) {
    try {
      const html = await get(a.url, 'news-tags');
      const paras = articleBody(html);
      if (saveBody(a, paras)) got++; else thin++;
    } catch (err) {
      console.warn('  παραλείπεται:', a.id, '—', err.code || err.message);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(`  ${got} σώματα γράφτηκαν στο data/news-bodies/`);
  if (thin) console.log(`  ${thin} ήταν πολύ μικρά — μένουν σύνδεσμος προς το newshub.gr`);
}

// Τρέχουν λίγα μαζί, όχι όλα: AT_ONCE εργάτες που τραβούν από την ίδια ουρά.
async function fetchAll(list) {
  const done = [];
  let next = 0;
  let failed = 0;

  let later = 0;
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  async function worker() {
    while (next < list.length) {
      const item = list[next++];
      try {
        let got;
        try {
          got = await details(item);
        } catch (first) {
          // Μία δεύτερη ευκαιρία: οι περισσότερες αποτυχίες είναι
          // στιγμιαίες και περνούν με μισό δευτερόλεπτο αναμονή.
          await pause(600);
          got = await details(item);
        }
        if (got) done.push(got); else later++;
      } catch (err) {
        failed++;
        if (failed <= 3) console.warn('  παραλείπεται:', item.id, '—', err.code || err.message || 'άγνωστο σφάλμα');
      }
      await pause(120);   // ανάσα, για να μην πιέζουμε τον διακομιστή τους
      if (done.length % 20 === 0 && done.length) process.stdout.write(`  ${done.length}/${list.length}\r`);
    }
  }

  await Promise.all(Array.from({ length: AT_ONCE }, worker));
  if (later) console.log(`  ${later} δημοσιεύονται αργότερα — θα έρθουν όταν βγουν`);
  if (failed) console.warn(`  δεν κατέβηκαν ${failed} άρθρα`);
  return done;
}

async function main() {
  console.log('Διαβάζω το sitemap ειδήσεων...');
  const listed = parseSitemap(await get(SITEMAP));
  console.log(`  ${listed.length} άρθρα στη ροή τους`);

  // Ό,τι έχουμε ήδη μένει. Το sitemap κρατάει μόνο 3 μέρες.
  let old = [];
  if (fs.existsSync(OUT)) {
    try {
      old = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    } catch (err) {
      console.warn('ΠΡΟΣΟΧΗ: το data/news.json δεν διαβάστηκε —', err.message);
    }
  }

  // Τα δείγματα φεύγουν μόλις έρθουν αληθινά άρθρα.
  old = old.filter((a) => a.url && !/\[ΔΕΙΓΜΑ\]/.test(a.title || ''));

  const have = new Set(old.map((a) => a.url));
  const fresh = listed.filter((a) => !have.has(a.url));
  console.log(`  ${old.length} ήδη αποθηκευμένα, ${fresh.length} καινούρια`);

  const added = fresh.length ? await fetchAll(fresh) : [];

  const all = [...old, ...added]
    .filter((a) => a.title && a.url)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, KEEP);

  // Το πρωτοσέλιδό τους γίνεται πρωτοσέλιδό μας.
  const pick = await frontPagePick();
  let marked = '';
  for (const a of all) {
    a.featured = pick ? a.url === pick : false;
    if (a.featured) marked = a.title;
  }
  // Αν δεν βρέθηκε (άλλαξαν το HTML τους), πέφτουμε στο πιο πρόσφατο με
  // εικόνα — ώστε το hero να μη μείνει ποτέ άδειο.
  if (!marked) {
    const first = all.find((a) => a.image_large);
    if (first) { first.featured = true; marked = first.title; }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(all, null, 2), 'utf8');

  console.log();
  console.log(`Γράφτηκαν ${all.length} άρθρα στο data/news.json`);
  if (marked) console.log(`Πρωτοσέλιδο: ${marked.slice(0, 70)}`);

  // Τα σώματα έρχονται τελευταία: χρειάζονται τη ΣΕΙΡΑ των άρθρων, και
  // αν κάτι πάει στραβά εδώ, το news.json έχει ήδη γραφτεί σωστά.
  console.log();
  await ensureBodies(all);

  // Αν η ροή σταματήσει, πρέπει να το μάθουμε — όχι να σερβίρουμε
  // χθεσινές ειδήσεις σαν σημερινές.
  const newest = all.length ? new Date(all[0].date) : null;
  const hours = newest ? (Date.now() - newest.getTime()) / 36e5 : Infinity;
  if (hours > 24) {
    console.warn(`\nΠΡΟΣΟΧΗ: η πιο πρόσφατη είδηση είναι ${Math.round(hours)} ώρες παλιά.`);
    console.warn('Μήπως έπαψε να ενημερώνεται το sitemap_google_news.php τους;');
  }
}

main().catch((err) => {
  console.error('Απέτυχε:', err.message);
  process.exitCode = 1;
});
