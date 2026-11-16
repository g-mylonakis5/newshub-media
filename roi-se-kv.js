// Pushes the news ticker into Cloudflare KV.
//
// Changing one line of the ticker used to mean rebuilding 4,697 pages: ~4
// minutes, against the 500 free Cloudflare Pages builds a month (16 a day)
// while newshub.gr publishes ~93 articles. The maths never worked.
//
// So the ticker no longer goes through a build. It lives in KV, the page
// reads it from the edge, and builds are left for what actually changes
// rarely: episodes, pages, articles.
//
// The ticker HTML still ships inside the page as a fallback: Facebook and
// Viber crawlers never run JavaScript. Worst case is then a few hours old
// instead of an empty box.
//
// Runs inside the GitHub Action, right after the news fetch.
//
//   node roi-se-kv.js
//
// It does not talk to Cloudflare directly: it posts the titles to the
// Worker (roloi/), which already has KV write access through its binding.
// A second token, with its own expiry and its own way to leak, to do the
// same job, is pure overhead.
//
// Needs two environment variables. If either is missing it exits QUIETLY
// with success: the live ticker is an improvement, not a requirement.
//
//   ROLOI_URL     the Worker's address
//   ROLOI_KLEIDI  its shared secret — the same value the Worker holds

const fs = require('fs');
const path = require('path');

const NEWS = path.join(__dirname, 'data', 'news.json');
const BLOCK = require('./data/roi-apokleismena.json');

// What the box shows, plus a few spare: if eight becomes ten tomorrow,
// nothing needs rebuilding.
const POSA = 12;


function xorismaTonon(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Same check as build.js, same list, same result. Title only — see
// data/roi-apokleismena.json for why.
function apokleietai(a) {
  if (BLOCK.katigories.some((c) => c === a.category)) return true;

  const t = xorismaTonon(a.title || '');
  return BLOCK.lexeis.some((w) => t.includes(xorismaTonon(w)));
}

function diale() {
  const list = JSON.parse(fs.readFileSync(NEWS, 'utf8'));

  return list
    .filter((a) => !apokleietai(a))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, POSA);
}

function roi(diales) {
  return diales
    // ONLY the three fields the box shows. No summaries, no images: the
    // reader downloads this JSON on every visit to the homepage, and
    // anything invisible is pure latency.
    .map((a) => ({ t: a.title, u: a.url, k: a.category || '' }));
}

async function main() {
  const { ROLOI_URL, ROLOI_KLEIDI } = process.env;

  if (!ROLOI_URL || !ROLOI_KLEIDI) {
    console.log('Ζωντανή ροή: δεν είναι στημένη (λείπουν ρυθμίσεις) — προσπερνώ.');
    return;
  }

  if (!fs.existsSync(NEWS)) {
    console.log('Ζωντανή ροή: δεν υπάρχει data/news.json — προσπερνώ.');
    return;
  }

  const diales = diale();
  const items = roi(diales);
  if (!items.length) {
    // Never write an empty ticker: it would blank the box for everyone,
    // turning a momentary fetch glitch into a visible fault. Better to
    // leave the previous one in place.
    console.warn('ΠΡΟΣΟΧΗ: η ροή βγήκε άδεια — ΔΕΝ γράφω στο KV.');
    return;
  }

  // "proto" is the timestamp of the newest article, not of this write.
  // The page uses it to decide whether this beats what was baked into it:
  // KV and the build fill from different places and do not always arrive
  // in order.
  const soma = JSON.stringify({
    pote: new Date().toISOString(),
    proto: diales[0].date || '',
    items,
  });

  // The key goes in the URL, not a header, so the Worker also accepts it
  // from a browser during a manual test — one code path instead of two.
  const url = `${ROLOI_URL.replace(/\/+$/, '')}/?kleidi=${encodeURIComponent(ROLOI_KLEIDI)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: soma,
  });

  const apantisi = (await res.text()).trim();

  if (!res.ok) {
    throw new Error(`Ο Worker απάντησε ${res.status}: ${apantisi.slice(0, 200)}`);
  }

  console.log(`Ζωντανή ροή: ${apantisi} Πρώτος: ${items[0].t}`);
}

main().catch((err) => {
  console.error(`Η ζωντανή ροή δεν ενημερώθηκε: ${err.message}`);
  process.exit(1);
});
