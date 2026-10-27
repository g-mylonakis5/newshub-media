// Κατεβάζει τις απομαγνητοφωνήσεις από το Buzzsprout και τις σώζει σε
// data/transcripts/<id>.json.
//
// Το feed δίνει διεύθυνση, όχι κείμενο. Η σελίδα του Buzzsprout το
// επιστρέφει σε σταθερή μορφή: ομιλητής, χρονοσήμανση, παράγραφος.
//
// Γιατί τις θέλουμε: η αναζήτηση ψάχνει μέσα στα λόγια, και ο χρήστης
// μπορεί να πατήσει μια χρονοσήμανση και να πάει ο player εκεί.
//
//   node fetch-transcripts.js
//
// Κατεβάζει ΜΟΝΟ όσες λείπουν. Ξανατρέξιμο δεν ξαναζητάει τίποτα.

const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA_FILE = path.join(__dirname, 'data/episodes.json');
const OUT_DIR = path.join(__dirname, 'data/transcripts');

const AT_ONCE = 3;

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'newshub-media-build/1.0 (+https://media.newshub.gr)',
        Connection: 'close',
      },
      agent: false,
      timeout: 25000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.destroy();
        return resolve(get(res.headers.location));
      }
      if (res.statusCode !== 200) {
        res.destroy();
        return reject(new Error(`${res.statusCode}`));
      }
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { b += d; });
      res.on('end', () => resolve(b));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('λήξη χρόνου')); });
    req.on('error', reject);
  });
}

function decode(s) {
  return String(s)
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

// «1:02:03» ή «5:07» -> δευτερόλεπτα
function toSeconds(stamp) {
  const parts = String(stamp).split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

// Η σελίδα δίνει τριάδες <cite>ομιλητής</cite><time>στιγμή</time><p>λόγια</p>.
// Κρατάμε μόνο αυτά — όχι το υπόλοιπο HTML της σελίδας τους.
function parse(html) {
  const out = [];
  const re = /<cite>([^<]*)<\/cite>\s*<time>([^<]*)<\/time>\s*<p>([\s\S]*?)<\/p>/g;

  for (const m of html.matchAll(re)) {
    const text = decode(m[3].replace(/<[^>]+>/g, ''));
    if (!text) continue;
    out.push({
      who: decode(m[1]),
      at: toSeconds(decode(m[2])),
      stamp: decode(m[2]),
      text,
    });
  }
  return out;
}

async function main() {
  const episodes = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const want = episodes.filter((ep) => ep.transcript);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const todo = want.filter((ep) => !fs.existsSync(path.join(OUT_DIR, `${ep.id}.json`)));

  console.log(`επεισόδια με απομαγνητοφώνηση: ${want.length}`);
  console.log(`ήδη κατεβασμένες: ${want.length - todo.length} · λείπουν: ${todo.length}`);

  if (!todo.length) return;

  let next = 0;
  let done = 0;
  let failed = 0;
  let empty = 0;
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  async function worker() {
    while (next < todo.length) {
      const ep = todo[next++];
      try {
        const lines = parse(await get(ep.transcript));
        if (!lines.length) {
          empty++;
        } else {
          fs.writeFileSync(path.join(OUT_DIR, `${ep.id}.json`), JSON.stringify(lines), 'utf8');
          done++;
        }
      } catch (err) {
        failed++;
        if (failed <= 3) console.warn('  παραλείπεται:', ep.id, '—', err.code || err.message);
      }
      if (done % 25 === 0 && done) process.stdout.write(`  ${done}/${todo.length}\r`);
      await pause(150);
    }
  }

  await Promise.all(Array.from({ length: AT_ONCE }, worker));

  console.log();
  console.log(`κατέβηκαν: ${done}`);
  if (empty) console.log(`χωρίς κείμενο: ${empty}`);
  if (failed) console.warn(`απέτυχαν: ${failed} — ξανατρέξε το για να τις πιάσει`);
}

main().catch((err) => {
  console.error('Απέτυχε:', err.message);
  process.exitCode = 1;
});
