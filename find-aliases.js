
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data/episodes.json');
const ALIAS_FILE = path.join(__dirname, 'data/people-aliases.json');

const asJson = process.argv.includes('--json');
const willWrite = process.argv.includes('--write');

// ---- same cleanup as build.js ----
// Change it there and it changes here: otherwise the script sees names
// other than the ones that build the pages.
function cleanGuestName(name){
  return String(name)
    .replace(/[\s,–-]*(στο|στον|στη|στην)?\s*new(s)?h(s)?ub\.?\s*(gr)?\b\.?/i, '')
    .replace(/[\s,–-]*(ιστορικό\s+αφιέρωμα|αποκλειστικ[όο])\s*!?$/i, '')
    .replace(/[\s,–-]*μέρος\s+\S+$/i, '')
    .replace(/^\s*αποκλειστικ[όο]\s*!?\s*/i, '')
    .replace(/^(ο|η|το|o)\s+/i, '')
    .replace(/\s*[,–-]\s*$/, '')
    .trim();
}

const TITLES = /^(Δρ|Δρα|Καθ|Καθηγητής|Καθηγήτρια|Dr|Prof)\.?\s+/i;

function splitTitle(name){
  const m = String(name).match(TITLES);
  if (!m) return { title: '', name: String(name).trim() };
  return {
    title: m[1].replace(/\.$/, ''),
    name: String(name).slice(m[0].length).trim(),
  };
}

// Lowercase, no accents or diaereses — for comparison only.
function flat(text){
  return String(text).toLowerCase()
    .replace(/[ΐϊ]/g, 'ι').replace(/[ΰϋ]/g, 'υ')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim();
}

// "Α." or "Αλ." or "Ειρ." -> an initial. A bare word -> a full name.
function isInitial(word){
  return /\.$/.test(word) || /^[Α-ΩΆΈΉΊΌΎΏA-Z]$/.test(word);
}

function parts(name){
  const words = name.split(/\s+/).filter(Boolean);
  return {
    first: words[0] || '',
    last: words[words.length - 1] || '',
    middle: words.slice(1, -1),
  };
}

function suggestFamilies(counts){
  const names = Object.keys(counts);

  // Grouped by surname.
  const byLast = {};
  for (const n of names) {
    const p = parts(n);
    const key = flat(p.last);
    if (!key) continue;
    (byLast[key] = byLast[key] || []).push({ name: n, ...p, n: counts[n] });
  }

  // Candidate pairs: same surname, one with a matching initial.
  const pairs = [];
  for (const key of Object.keys(byLast)) {
    const group = byLast[key];
    if (group.length < 2) continue;

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        const aInit = isInitial(a.first);
        const bInit = isInitial(b.first);

        let why = '';
        if (aInit !== bInit) {
          // One is an initial, the other the full name.
          const short = aInit ? a : b;
          const full = aInit ? b : a;
          const stem = flat(short.first).replace(/\.$/, '');
          if (stem && flat(full.first).startsWith(stem)) why = 'αρχικό ↔ ολόκληρο';
        } else if (!aInit && !bInit && flat(a.first) === flat(b.first)) {
          // Same first name and surname, spelled differently (accents,
          // diaereses) — flat() levels those out.
          if (a.name !== b.name) why = 'ίδιο όνομα, άλλη γραφή';
        }

        if (why) pairs.push({ a, b, why });
      }
    }
  }

  const parent = {};
  const find = (x) => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  for (const n of names) parent[n] = n;
  for (const { a, b } of pairs) {
    const ra = find(a.name);
    const rb = find(b.name);
    if (ra !== rb) parent[ra] = rb;
  }

  const groups = {};
  for (const n of names) (groups[find(n)] = groups[find(n)] || []).push(n);

  // The canonical name: never an initial if a full one exists; then
  // whichever has the most episodes; on a tie, the longer
  // ("Κωνσταντίνος" over "Κώστας").
  const pick = (list) => {
    const full = list.filter((n) => !isInitial(parts(n).first));
    return (full.length ? full : list).sort((x, y) =>
      (counts[y] - counts[x]) || (y.length - x.length))[0];
  };

  return Object.values(groups)
    .filter((list) => list.length > 1)
    .map((list) => {
      const canonical = pick(list);
      return { canonical, others: list.filter((n) => n !== canonical) };
    })
    .sort((x, y) => counts[y.canonical] - counts[x.canonical]);
}

function main(){
  const episodes = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

  // name -> episode count
  const seen = {};
  for (const ep of episodes) {
    if (!ep.guest) continue;
    const cleaned = cleanGuestName(ep.guest);
    if (!cleaned) continue;
    const { name } = splitTitle(cleaned);
    if (!name) continue;
    if (!seen[name]) seen[name] = { count: 0, titles: new Set() };
    seen[name].count++;
    const t = splitTitle(cleaned).title;
    if (t) seen[name].titles.add(t);
  }

  const names = Object.keys(seen);

  // The same name with and without a title is not reported as a pair,
  // because splitTitle has already merged them — we print those
  // separately, for information.
  const titled = names.filter((n) => seen[n].titles.size);

  const counts = {};
  for (const n of names) counts[n] = seen[n].count;

  const families = suggestFamilies(counts);
  const dropped = families.reduce((n, f) => n + f.others.length, 0);

  if (asJson || willWrite) {
    const aliases = {};
    for (const f of families) aliases[f.canonical] = f.others;

    // We keep whatever is already there — notes, titles, and manual
    // mappings that no automatic check would produce.
    let current = {};
    try {
      current = JSON.parse(fs.readFileSync(ALIAS_FILE, 'utf8'));
    } catch { /* δεν υπάρχει ακόμα */ }

    const next = {
      ...current,
      aliases: { ...(current.aliases || {}), ...aliases },
    };
    const text = JSON.stringify(next, null, 2) + '\n';

    if (willWrite) {
      fs.writeFileSync(ALIAS_FILE, text, 'utf8');
      console.log(`Γράφτηκαν ${Object.keys(next.aliases).length} ομάδες στο ${path.relative(__dirname, ALIAS_FILE)}.`);
      console.log('Τρέξε «node build.js» για να ενωθούν οι σελίδες.');
    } else {
      console.log(text);
    }
    return;
  }

  console.log(`Διαφορετικές γραφές ονόματος: ${names.length}`);
  console.log(`Ομάδες προς ένωση: ${families.length}`);
  console.log('');

  if (!families.length) {
    console.log('Δεν βρέθηκε τίποτα.');
  } else {
    console.log('ΔΕΝ ενώθηκε τίποτα — χρειάζεται η έγκρισή σου.');
    console.log(`Με «node find-aliases.js --json» βγαίνει έτοιμο για το`);
    console.log(`${path.relative(__dirname, ALIAS_FILE)}.`);
    console.log('');

    for (const f of families) {
      console.log(`  ${f.canonical}  (${seen[f.canonical].count})`);
      for (const o of f.others) console.log(`      ← ${o}  (${seen[o].count})`);
    }
  }

  if (titled.length) {
    console.log('');
    console.log(`Τίτλοι που αφαιρέθηκαν από το όνομα (${titled.length}):`);
    for (const n of titled) {
      console.log(`  ${[...seen[n].titles].join('/')}.  →  ${n}  (${seen[n].count})`);
    }
  }

  console.log('');
  console.log(`Πρόσωπα τώρα:      ${names.length}`);
  console.log(`Αν εγκριθούν όλα:  ${names.length - dropped}   (−${dropped})`);
}

// Runs only when called directly. When build.js loads it, it supplies
// the suggestion logic only — it neither reads nor writes files.
if (require.main === module) {
  main();
} else {
  module.exports = { suggestFamilies };
}
