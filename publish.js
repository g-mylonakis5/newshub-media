// publish.js — builds the site and rebuilds the search index ONLY when
// it is worth it.
//
// Pagefind takes ~100 seconds; a build with nothing to do finishes in 6.
// Rebuilding every few hours to pick up new episodes means most runs have
// no changes at all — and free hosting plans bill build minutes.
//
//   node publish.js

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { main: build } = require('./build.js');
const { main: makeCards } = require('./make-cards.js');

const INDEX_DIR = path.join(__dirname, 'public/pagefind');

// How often, at most, the search index is rebuilt.
//
// Pages take 14 seconds, the index 100. At 160 deploys a day the index is
// the entire wait — rebuilt whole for a single article.
//
// With the brake on, an article's page ships immediately; only SEARCH may
// miss it for a few minutes. Nobody searches for something just published;
// they read it off the homepage.
//
// Zero or empty = no brake. Set by the Action.
const FRENO_LEPTA = Number(process.env.EVRETIRIO_LEPTA || 0);

function hasIndex() {
  return fs.existsSync(path.join(INDEX_DIR, 'pagefind.js'));
}

// Age of the current index in minutes; Infinity if there is none.
function indexAgeMin() {
  const stamp = path.join(INDEX_DIR, 'pagefind.js');
  if (!fs.existsSync(stamp)) return Infinity;
  return (Date.now() - fs.statSync(stamp).mtimeMs) / 60000;
}

// Is any page newer than the index?
//
// Asking "did this run change anything" is not enough: a plain `node
// build.js` — which happens constantly during work — changes pages without
// publish.js ever knowing. The next publish then sees "no changes" and the
// index stays behind forever. Found when search was 92 hours stale.
function indexIsStale() {
  const stamp = path.join(INDEX_DIR, 'pagefind.js');
  if (!fs.existsSync(stamp)) return true;

  const indexedAt = fs.statSync(stamp).mtimeMs;
  let newest = 0;

  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'pagefind') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) {
        const t = fs.statSync(p).mtimeMs;
        if (t > newest) newest = t;
      }
    }
  };
  walk(path.join(__dirname, 'public'));

  return newest > indexedAt;
}

function reindex() {
  // Delete the old folder FIRST.
  //
  // Pagefind writes one file per page fragment, named after its content.
  // When a page changes it writes a NEW file and the old one stays forever.
  // Seven builds left 19,009 fragments for 4,660 pages and the deploy hit
  // Cloudflare Pages' 20,000-file limit. 14,886 of them were dead.
  fs.rmSync(INDEX_DIR, { recursive: true, force: true });

  // npx downloads Pagefind the first time and finds it ready afterwards.
  execFileSync('npx', ['-y', 'pagefind@latest', '--site', 'public'], {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true,
  });

  const files = countFiles(path.join(__dirname, 'public'));
  console.log(`Αρχεία στο public/: ${files.toLocaleString('el')} (όριο Cloudflare: 20.000)`);
  if (files > 19000) {
    console.warn('ΠΡΟΣΟΧΗ: πλησιάζουμε το όριο αρχείων του Cloudflare Pages.');
  }
}

// How many files will be uploaded — Cloudflare Pages accepts up to 20,000.
function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
    else n++;
  }
  return n;
}

async function main() {
  const started = Date.now();

  // ΠΡΙΝ το χτίσιμο: οι κάρτες των social. Το build κοιτάζει ποιες
  // υπάρχουν και δείχνει εκεί το og:image της σελίδας μοιράσματος, άρα
  // αν τρέξουν μετά, η πρώτη φορά κάθε είδησης θα έχανε την κάρτα της.
  //
  // Ποτέ δεν σταματά το ανέβασμα: μια κάρτα που δεν βγήκε σημαίνει
  // κάρτα χωρίς τίτλο στο Facebook, όχι σελίδα που λείπει.
  console.log('— Κάρτες για τα social —');
  try {
    await makeCards();
  } catch (err) {
    console.warn(`ΠΡΟΣΟΧΗ: οι κάρτες των social δεν φτιάχτηκαν — ${err.message}`);
  }

  console.log('');

  console.log('— Χτίσιμο σελίδων —');
  const changed = build();

  console.log('');

  // The brake comes before every other check, but NEVER when the index is
  // missing: without it search does not work at all, and that is a fault,
  // not a delay.
  const ilikia = indexAgeMin();

  if (!hasIndex()) {
    console.log('Δεν υπάρχει ευρετήριο αναζήτησης — το φτιάχνω από την αρχή.');
    reindex();
  } else if (FRENO_LEPTA > 0 && ilikia < FRENO_LEPTA) {
    console.log(`Το ευρετήριο είναι ${Math.round(ilikia)}' — το φρένο είναι στα ${FRENO_LEPTA}'.`);
    console.log('Οι σελίδες ανεβαίνουν τώρα· η αναζήτηση θα τις πιάσει στο επόμενο.');
  } else if (changed > 0) {
    console.log(`Άλλαξαν ${changed} αρχεία — ξαναφτιάχνω το ευρετήριο αναζήτησης.`);
    reindex();
  } else if (indexIsStale()) {
    console.log('Το ευρετήριο είναι παλιότερο από τις σελίδες — το ξαναφτιάχνω.');
    reindex();
  } else {
    console.log('Καμία αλλαγή — το ευρετήριο αναζήτησης μένει ως έχει.');
    console.log('(γλιτώσαμε ~100 δευτερόλεπτα)');
  }

  console.log('');
  console.log(`Τελείωσε σε ${Math.round((Date.now() - started) / 1000)} δευτερόλεπτα.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
