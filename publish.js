// publish.js — χτίζει το site και ξαναφτιάχνει το ευρετήριο αναζήτησης
// ΜΟΝΟ όταν χρειάζεται.
//
// Γιατί υπάρχει: το Pagefind θέλει ~100 δευτερόλεπτα, ενώ το build όταν
// δεν άλλαξε τίποτα τελειώνει σε 6. Αν ο host ξαναχτίζει κάθε λίγες ώρες
// για να πιάνει νέα επεισόδια, οι περισσότερες φορές δεν θα έχουν αλλαγές
// — και τα δωρεάν πακέτα φιλοξενίας χρεώνουν σε λεπτά χτισίματος.
//
//   node publish.js

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { main: build } = require('./build.js');

const INDEX_DIR = path.join(__dirname, 'public/pagefind');

function hasIndex() {
  return fs.existsSync(path.join(INDEX_DIR, 'pagefind.js'));
}

// Υπάρχει σελίδα νεότερη από το ευρετήριο;
//
// ΔΕΝ αρκεί να ρωτήσουμε «άλλαξε κάτι σε αυτό το τρέξιμο»: αν κάποιος
// τρέξει σκέτο `node build.js` — όπως γίνεται συνέχεια στη δουλειά —
// οι σελίδες αλλάζουν χωρίς να το μάθει ποτέ το publish.js. Μετά, το
// επόμενο publish βλέπει «καμία αλλαγή» και το ευρετήριο μένει πίσω
// για πάντα. Το βρήκαμε όταν η αναζήτηση ήταν 92 ωρών.
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
  // ΠΡΩΤΑ σβήνουμε τον παλιό φάκελο.
  //
  // Το Pagefind γράφει ένα αρχείο ανά κομμάτι σελίδας με όνομα που
  // βγαίνει από το περιεχόμενο. Όταν αλλάζει μια σελίδα, γράφεται ΝΕΟ
  // αρχείο — το παλιό μένει για πάντα.
  //
  // Σε επτά builds είχαν μαζευτεί 19.009 fragments για 4.660 σελίδες,
  // και το deployment χτύπησε στο όριο των 20.000 αρχείων του
  // Cloudflare Pages. Τα 14.886 ήταν νεκρά.
  fs.rmSync(INDEX_DIR, { recursive: true, force: true });

  // Το npx κατεβάζει το Pagefind την πρώτη φορά και μετά το βρίσκει έτοιμο.
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

// Πόσα αρχεία θα σταλούν — το Cloudflare Pages δέχεται έως 20.000.
function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countFiles(path.join(dir, e.name));
    else n++;
  }
  return n;
}

function main() {
  const started = Date.now();

  console.log('— Χτίσιμο σελίδων —');
  const changed = build();

  console.log('');

  if (!hasIndex()) {
    console.log('Δεν υπάρχει ευρετήριο αναζήτησης — το φτιάχνω από την αρχή.');
    reindex();
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

main();
