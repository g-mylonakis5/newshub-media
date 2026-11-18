// fetch-episodes.js — downloads the feed and saves it to data/episodes.json
// Run: node fetch-episodes.js

const fs = require('fs');
const path = require('path');
const { loadFeed, parseEpisodes, parseChannelImage } = require('./feed');

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

  // The podcast's own artwork, kept apart from the episodes: the build
  // puts it where an episode has no cover of its own. Written only if we
  // found one, so a bad fetch does not wipe what we had.
  const cover = parseChannelImage(xml);
  if (cover) {
    fs.writeFileSync(
      path.join(outDir, 'podcast.json'),
      JSON.stringify({ image: cover }, null, 2),
      'utf8'
    );
  } else {
    console.warn('ΠΡΟΣΟΧΗ: δεν βρέθηκε εξώφυλλο καναλιού — κρατάω το παλιό.');
  }

  const withGuest = episodes.filter((e) => e.guest).length;
  const guests = new Set(episodes.map((e) => e.guest).filter(Boolean));

  console.log('Αποθηκεύτηκαν', episodes.length, 'επεισόδια στο data/episodes.json');
  console.log('Με αναγνωρισμένο καλεσμένο:', withGuest);
  console.log('Διαφορετικά ονόματα καλεσμένων:', guests.size);
  console.log('\nΠαράδειγμα:');
  console.log(JSON.stringify(episodes[0], null, 2).slice(0, 700));
}

main().catch((err) => console.error('Σφάλμα:', err.message));
