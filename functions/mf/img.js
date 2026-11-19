// /mf/img?u=<διεύθυνση εικόνας> — ο καθρέφτης φωτογραφίας.
//
// Το Cloudflare του newshub.gr απαντά 403 στον facebookexternalhit, και
// το ίδιο κάνει και το static.newshub.gr. Οπότε το Facebook δεν μπορεί
// να κατεβάσει ούτε τη σελίδα ούτε τη φωτογραφία — η κάρτα βγαίνει γυμνή.
//
// Εδώ τη φέρνουμε εμείς, σαν κανονικός browser (εμάς δεν μας κόβει), και
// τη σερβίρουμε από το δικό μας domain. Το Facebook τη βλέπει, ο κόσμος
// βλέπει κανονική κάρτα.
//
// Μόλις μπει ο κανόνας στο Cloudflare τους, όλο αυτό περισσεύει — δες
// τα σχόλια στο sharePage() του build.js.
//
// ΑΣΦΑΛΕΙΑ: μόνο διευθύνσεις του newshub, μόνο https, μόνο εικόνες.
// Χωρίς τη λίστα από κάτω θα ήμασταν δωρεάν μεταφορέας για τον καθένα.

const ALLOWED = new Set([
  'static.newshub.gr',
  'www.newshub.gr',
  'newshub.gr',
]);

// Ό,τι μεγαλύτερο δεν το δέχεται ούτε το Facebook ως φωτογραφία κάρτας.
const MAX_BYTES = 8 * 1024 * 1024;

// Ένας κανονικός browser. Με δικό μας όνομα θα τρώγαμε το ίδιο 403.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function fail(status, message) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return fail(405, 'Μόνο GET.');
  }

  const raw = new URL(request.url).searchParams.get('u');
  if (!raw) return fail(400, 'Λείπει το ?u=');

  let target;
  try {
    target = new URL(raw);
  } catch {
    return fail(400, 'Η διεύθυνση δεν είναι σωστή.');
  }

  if (target.protocol !== 'https:' || !ALLOWED.has(target.hostname)) {
    return fail(403, 'Μόνο εικόνες του newshub.');
  }

  // Το ίδιο αίτημα έρχεται πολλές φορές: ο scraper του Facebook, μετά
  // κάθε αναγνώστης που βλέπει την κάρτα. Το κρατάμε στην άκρη του
  // Cloudflare και δεν ξαναενοχλούμε τον server τους.
  const cache = caches.default;
  const key = new Request(new URL(request.url).toString(), { method: 'GET' });

  const hit = await cache.match(key);
  if (hit) return hit;

  let upstream;
  try {
    upstream = await fetch(target.toString(), {
      headers: { 'User-Agent': UA, Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
      cf: { cacheEverything: true, cacheTtl: 86400 },
    });
  } catch (err) {
    return fail(502, `Δεν ήρθε η φωτογραφία: ${err.message}`);
  }

  if (!upstream.ok) {
    return fail(502, `Η φωτογραφία απάντησε ${upstream.status}.`);
  }

  const type = (upstream.headers.get('content-type') || '').split(';')[0].trim();
  if (!type.startsWith('image/')) {
    return fail(415, 'Δεν είναι εικόνα.');
  }

  const len = Number(upstream.headers.get('content-length') || 0);
  if (len > MAX_BYTES) {
    return fail(413, 'Η φωτογραφία είναι πολύ μεγάλη.');
  }

  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_BYTES) {
    return fail(413, 'Η φωτογραφία είναι πολύ μεγάλη.');
  }

  const out = new Response(body, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Content-Length': String(body.byteLength),
      // Η διεύθυνση της φωτογραφίας δεν ξαναχρησιμοποιείται για άλλη
      // εικόνα — άρα μπορεί να μείνει για πάντα.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });

  context.waitUntil(cache.put(key, out.clone()));
  return out;
}
