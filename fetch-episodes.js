// fetch-episodes.js — κατεβάζει το feed και το σώζει σε data/episodes.json
// Τρέξε: node fetch-episodes.js

const fs = require('fs');
const path = require('path');
const { loadFeed, parseEpisodes } = require('./feed');

async function main() {
  console.log('Κατεβάζω το feed...');
  const xml = await loadFeed(process.argv[2]);

  const episodes = parseEpisodes(xml);
  episodes.sort((a, b) => new Date(b.date) - new Date(a.date));

  const outDir = path.join(__dirname, 'data');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'episodes.json'),
    JSON.stringify(episodes, null, 2),
    'utf8'
  );

  const withGuest = episodes.filter((e) => e.guest).length;
  const guests = new Set(episodes.map((e) => e.guest).filter(Boolean));

  console.log('Αποθηκεύτηκαν', episodes.length, 'επεισόδια στο data/episodes.json');
  console.log('Με αναγνωρισμένο καλεσμένο:', withGuest);
  console.log('Διαφορετικά ονόματα καλεσμένων:', guests.size);
  console.log('\nΠαράδειγμα:');
  console.log(JSON.stringify(episodes[0], null, 2).slice(0, 700));
}

main().catch((err) => console.error('Σφάλμα:', err.message));
