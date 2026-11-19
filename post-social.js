'use strict';

// Posts what the admin queued to Facebook and X.
//
// It reads data/social-queue.json, takes ONLY the entries marked
// "pending", posts them, and writes the result back into the same file.
// Nothing here decides WHAT gets posted — the admin wrote the title, the
// link, the photo and the text already. This script only carries it.
//
//   node post-social.js         — really posts
//   node post-social.js --dry   — prints what it would post, sends nothing
//
// Keys come from the environment (GitHub Secrets):
//   FB_PAGE_ID, FB_PAGE_TOKEN
//   X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const QUEUE_FILE = path.join(__dirname, 'data/social-queue.json');

const SITE_URL = 'https://newshubmedia.gr';

// Facebook retires a Graph API version roughly two years after it comes
// out. When it answers "Unsupported get request" or complains about the
// version, bump this — or set FB_API_VERSION and do not touch the file.
const FB_VERSION = process.env.FB_API_VERSION || 'v23.0';

// How many entries stay in the file. The rest are history nobody reads.
const KEEP = 200;

const DRY = process.argv.includes('--dry');

// X counts a link as 23 characters no matter how long it is, and the
// whole post can be 280. We cut the text so that text + newline + link
// fits with room to spare.
const X_LIMIT = 280;
const X_LINK_COST = 23;

// ---------------------------------------------------------------------
// Facebook
// ---------------------------------------------------------------------

// A link post. The card — big photo, title, description — is built by
// Facebook from the OG tags of the page we link to. We do NOT upload a
// photo here: a photo post makes the link un-clickable, which is the
// opposite of what we want.
// Cloudflare at newshub.gr answers 403 to facebookexternalhit — their
// pages AND their photos. Everyone else gets 200. So a link straight to
// an article gives a bare card: no photo, title "Just a moment...".
//
// build.js writes a share page per news item at /mf/<id>.html with the
// same title, photo and summary, which forwards the reader on. Facebook
// can read that one, because it is ours.
//
// Only for Facebook, and only for newshub.gr links: our own pages are
// posted as they are. The moment the rule changes on their side, delete
// this function and the call below.
//
// If the share page is not up yet (the build runs on its own clock), we
// post the real link anyway — a card without a photo beats a link to a
// 404.
async function facebookLink(post) {
  const link = String(post.link || '');
  if (!/^https:\/\/(www\.)?newshub\.gr\//.test(link)) return link;

  const id = link.split('?')[0].replace(/\/$/, '').split('/').pop();
  if (!id) return link;

  const mirror = `${SITE_URL}/mf/${id}.html`;

  try {
    const res = await fetch(mirror, { method: 'HEAD', headers: { 'user-agent': 'newshub-media' } });
    if (res.ok) return mirror;
    console.warn(`  ⚠ η σελίδα μοιράσματος δεν είναι ακόμα στον αέρα (HTTP ${res.status}) — `
      + 'πάει το κανονικό λινκ, χωρίς φωτογραφία στην κάρτα.');
  } catch (err) {
    console.warn(`  ⚠ δεν ελέγχθηκε η σελίδα μοιράσματος — ${err.message}`);
  }

  return link;
}

async function postFacebook(post) {
  const pageId = process.env.FB_PAGE_ID;
  const token = process.env.FB_PAGE_TOKEN;

  const url = `https://graph.facebook.com/${FB_VERSION}/${pageId}/feed`;

  const body = new URLSearchParams({
    message: post.text || post.title || '',
    link: await facebookLink(post),
    access_token: token,
  });

  const res = await fetch(url, { method: 'POST', body });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = (data.error && data.error.message) || `HTTP ${res.status}`;
    throw new Error(`Facebook: ${msg}`);
  }

  // The id looks like "<page-id>_<post-id>" — enough to build the link.
  return { id: data.id, url: `https://www.facebook.com/${String(data.id).replace('_', '/posts/')}` };
}

// ---------------------------------------------------------------------
// X — OAuth 1.0a
// ---------------------------------------------------------------------

// RFC 3986, which is NOT what encodeURIComponent does: it leaves
// ! * ' ( ) alone and X's signature check does not.
function enc(s) {
  return encodeURIComponent(String(s))
    .replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

// The Authorization header for one request. Only the oauth_* parameters
// go into the signature: our bodies are JSON or multipart, neither of
// which counts as a signed parameter.
function oauthHeader(method, url) {
  const params = {
    oauth_consumer_key: process.env.X_API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: process.env.X_ACCESS_TOKEN,
    oauth_version: '1.0',
  };

  const sorted = Object.keys(params).sort()
    .map((k) => `${enc(k)}=${enc(params[k])}`).join('&');

  const base = [method.toUpperCase(), enc(url), enc(sorted)].join('&');
  const key = `${enc(process.env.X_API_SECRET)}&${enc(process.env.X_ACCESS_SECRET)}`;

  params.oauth_signature = crypto.createHmac('sha1', key).update(base).digest('base64');

  return 'OAuth ' + Object.keys(params).sort()
    .map((k) => `${enc(k)}=\"${enc(params[k])}\"`).join(', ');
}

// Fetches the photo so we can hand the bytes to X. Our own images sit on
// newshubmedia.gr, the news photos on static.newshub.gr — both public.
async function grabImage(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'newshub-media' } });
  if (!res.ok) throw new Error(`η φωτογραφία δεν κατέβηκε (HTTP ${res.status})`);

  const type = res.headers.get('content-type') || 'image/jpeg';
  if (!/^image\//.test(type)) throw new Error(`η διεύθυνση δεν είναι φωτογραφία (${type})`);

  const bytes = Buffer.from(await res.arrayBuffer());
  if (!bytes.length) throw new Error('άδεια φωτογραφία');

  // X takes up to 5MB for a photo. A news photo is 50-300KB, so this
  // only fires if something is very wrong.
  if (bytes.length > 5 * 1024 * 1024) throw new Error('η φωτογραφία ξεπερνά τα 5MB');

  return { bytes, type };
}

// Uploads one photo and gives back its media id.
//
// X moved media upload from upload.twitter.com/1.1 to api.x.com/2 and
// has been retiring the old address in stages. We try the new one and
// fall back — so whichever of the two is alive on the day, we post.
async function uploadToX(image) {
  const endpoints = [
    'https://api.x.com/2/media/upload',
    'https://upload.twitter.com/1.1/media/upload.json',
  ];

  let last = '';

  for (const url of endpoints) {
    const form = new FormData();
    form.append('media', new Blob([image.bytes], { type: image.type }), 'photo.jpg');

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: oauthHeader('POST', url) },
      body: form,
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      // v2 answers { data: { id } }, v1.1 answers { media_id_string }.
      const id = (data.data && data.data.id) || data.media_id_string;
      if (id) return String(id);
      last = 'απάντησε χωρίς κωδικό φωτογραφίας';
      continue;
    }

    last = (data.detail || data.title || (data.errors && data.errors[0] && data.errors[0].message)
      || `HTTP ${res.status}`);
  }

  throw new Error(`το ανέβασμα φωτογραφίας στο X απέτυχε: ${last}`);
}

// The text of the post, cut to fit. The link always survives — a post
// without it is pointless.
function xText(post) {
  const link = post.link;
  const room = X_LIMIT - X_LINK_COST - 2;   // 2 = the newline and a margin
  let text = String(post.text || post.title || '').trim();

  if (text.length > room) text = text.slice(0, room - 1).trimEnd() + '…';

  return text ? `${text}\n${link}` : link;
}

async function postX(post) {
  const url = 'https://api.x.com/2/tweets';

  const body = { text: xText(post) };

  // The photo is a bonus, not the post. If it fails we still want the
  // news out — X's own link card will do, and the editor sees the note.
  let note = '';
  if (post.image) {
    try {
      body.media = { media_ids: [await uploadToX(await grabImage(post.image))] };
    } catch (err) {
      note = `χωρίς φωτογραφία — ${err.message}`;
      console.warn(`  ⚠ ${note}`);
    }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: oauthHeader('POST', url),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data.detail || data.title
      || (data.errors && data.errors[0] && data.errors[0].message) || `HTTP ${res.status}`;

    // The commonest real failure once it is live: the free tier's
    // monthly cap. Say so in words, not as a number.
    if (res.status === 429) {
      throw new Error('X: συμπληρώθηκε το μηνιαίο όριο δημοσιεύσεων της δωρεάν βαθμίδας');
    }
    throw new Error(`X: ${msg}`);
  }

  const id = data.data && data.data.id;
  return { id, url: id ? `https://x.com/i/status/${id}` : '', note };
}

// ---------------------------------------------------------------------
// The link
// ---------------------------------------------------------------------

// For a news item the link is newshub.gr's own and the admin sends it
// whole. For OUR pages it does not: the address contains a slug made
// from the title by build.js, and a second copy of that function in the
// browser would sooner or later make a link that 404s.
//
// So we ask the site. The sitemap is the only thing that knows for
// certain — and if the page is not in it yet, the build has not run and
// we must NOT post: the reader would land on nothing.
let sitemapCache = null;

async function sitemap() {
  if (sitemapCache) return sitemapCache;

  const res = await fetch(`${SITE_URL}/sitemap.xml`, {
    headers: { 'user-agent': 'newshub-media' },
  });
  if (!res.ok) throw new Error(`το sitemap δεν διαβάστηκε (HTTP ${res.status})`);

  sitemapCache = (await res.text()).match(/<loc>([^<]+)<\/loc>/g) || [];
  sitemapCache = sitemapCache.map((m) => m.slice(5, -6));

  return sitemapCache;
}

async function findLink(post) {
  const ref = String(post.ref || '');

  // What the address starts with, per kind. The rest is the slug.
  let prefix;

  if (post.kind === 'podcast') {
    const number = ref.replace(/\D/g, '');
    if (!number) throw new Error('το επεισόδιο δεν έχει κωδικό');
    prefix = `${SITE_URL}/episode/${number}-`;
  } else if (post.kind === 'video') {
    if (!/^[\w-]{6,20}$/.test(ref)) throw new Error('άκυρος κωδικός βίντεο');
    prefix = `${SITE_URL}/video/${ref}-`;
  } else if (post.kind === 'article') {
    const id = ref.replace(/^arthro\//, '').replace(/\.html$/, '');
    if (!id) throw new Error('το άρθρο δεν έχει κωδικό');
    prefix = `${SITE_URL}/arthro/${id}`;
  } else {
    throw new Error(`δεν ξέρω να φτιάξω σύνδεσμο για «${post.kind}»`);
  }

  const hit = (await sitemap()).find((u) => u === prefix || u.startsWith(prefix));

  if (!hit) {
    throw new Error('η σελίδα δεν βρέθηκε στο site — μάλλον δεν έχει χτιστεί ακόμα. '
      + 'Ξαναπάτα το σε λίγα λεπτά.');
  }

  return hit;
}

// ---------------------------------------------------------------------
// Which platforms can actually run
// ---------------------------------------------------------------------

const NEEDS = {
  facebook: ['FB_PAGE_ID', 'FB_PAGE_TOKEN'],
  x: ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'],
};

const SENDERS = { facebook: postFacebook, x: postX };

const NAMES = { facebook: 'Facebook', x: 'X' };

// Platforms we do NOT send to from here, however good the keys are.
//
// X stopped letting anyone post for free in February 2026 and charges
// per request — $0.20 for a post that carries a link, and every post of
// ours carries one. Until that is paid for, the admin opens X with the
// post already written and a person presses the last button. The reader
// sees the same thing either way; see ΔΙΑΧΕΙΡΙΣΤΙΚΟ-ΣΤΗΣΙΜΟ.md.
//
// This is the ONE place that decides it. Take 'x' out of this list and
// the admin starts sending automatically again — it reads the answer
// out of the queue file, so nothing else has to be changed.
const MANUAL = ['x'];

function missingKeys(target) {
  return (NEEDS[target] || []).filter((k) => !process.env[k]);
}

// true, false, or 'manual' — what the admin shows for this platform.
function readyOf(target) {
  if (MANUAL.includes(target)) return 'manual';
  return missingKeys(target).length === 0;
}

// ---------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------

function readQueue() {
  let raw;
  try {
    raw = fs.readFileSync(QUEUE_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  const data = JSON.parse(raw);
  if (!Array.isArray(data.posts)) data.posts = [];
  return data;
}

function writeQueue(data) {
  if (data.posts.length > KEEP) {
    // The newest stay. Only entries that are finished get dropped — a
    // pending one is still owed a post, however old.
    const done = data.posts.filter((p) => p.status !== 'pending');
    const live = data.posts.filter((p) => p.status === 'pending');
    data.posts = live.concat(done.slice(0, Math.max(0, KEEP - live.length)));
  }
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------

async function main() {
  const data = readQueue();

  if (!data) {
    console.log('Δεν υπάρχει data/social-queue.json — τίποτα να στείλω.');
    return 0;
  }

  // Which platforms have their keys, written into the file so the admin
  // can grey out the rest. The browser cannot see GitHub Secrets, and
  // hard-coding the answer there would mean a second place to remember
  // on the day the missing keys arrive. This way it finds out by itself
  // within a quarter of an hour — the cron is enough to refresh it.
  const ready = {};
  Object.keys(NEEDS).forEach((t) => { ready[t] = readyOf(t); });

  let readyChanged = false;
  if (!DRY && JSON.stringify(data.ready) !== JSON.stringify(ready)) {
    data.ready = ready;
    readyChanged = true;
  }

  const pending = data.posts.filter((p) => p.status === 'pending');

  if (!pending.length) {
    console.log('Η ουρά είναι άδεια.');
    if (readyChanged) writeQueue(data);
    return 0;
  }

  console.log(`${pending.length} στην ουρά.${DRY ? ' ΔΟΚΙΜΗ — δεν στέλνεται τίποτα.' : ''}`);

  let failed = 0;
  let waiting = 0;
  let hands = 0;
  let touched = false;

  for (const post of pending) {
    console.log(`\n• ${post.title || post.link}`);

    // A platform that is posted by hand never belongs to this script,
    // even if an older entry still names it: the editor has already
    // been shown the button for it.
    const byHand = (post.targets || []).filter((t) => MANUAL.includes(t));
    const targets = (post.targets || []).filter((t) => SENDERS[t] && !MANUAL.includes(t));

    if (byHand.length) {
      console.log(`  ⤴ ${byHand.map((t) => NAMES[t]).join(', ')}: με το χέρι, το προσπερνώ.`);
    }

    if (!targets.length) {
      // Only hand-posted platforms were asked for. This script will
      // never send it and must not pretend it did — the entry stays
      // pending, which is the truth: it is waiting for a person.
      //
      // Entries made by the admin's own button are written as done the
      // moment the window opens, so they never reach this line. What
      // does reach it is an older entry, queued back when the platform
      // still went out by itself.
      if (byHand.length) {
        const note = `Το ${byHand.map((t) => NAMES[t]).join(' και το ')} ανεβαίνει πλέον `
          + 'με το χέρι. Άνοιξέ το από το διαχειριστικό.';
        if (post.note !== note) {
          post.note = note;
          delete post.error;
          touched = true;
        }
        hands++;
        continue;
      }

      post.status = 'error';
      post.error = 'Δεν ορίστηκε πλατφόρμα.';
      failed++;
      touched = true;
      continue;
    }

    // Keys first, for ALL the platforms this post wants. Half a post is
    // worse than none: the editor would have to remember which half.
    const gaps = DRY ? [] : targets.flatMap(missingKeys);
    if (gaps.length) {
      post.note = `Λείπουν τα κλειδιά: ${gaps.join(', ')}. Μένει στην ουρά.`;
      console.log(`  ⏸ ${post.note}`);
      waiting++;
      touched = true;
      continue;
    }

    // The address, if the admin could not know it. This comes BEFORE
    // any sending: half a post, to one platform, with no link, is worse
    // than none.
    if (!post.link) {
      try {
        post.link = await findLink(post);
        console.log(`  σύνδεσμος: ${post.link}`);
      } catch (err) {
        post.status = 'error';
        post.error = `Δεν βρήκα τον σύνδεσμο — ${err.message}`;
        console.error(`  ✗ ${post.error}`);
        failed++;
        touched = true;
        continue;
      }
    }

    post.results = post.results || {};
    const errors = [];

    for (const target of targets) {
      if (DRY) {
        console.log(`  ${NAMES[target]} ←`);
        console.log(`    κείμενο: ${target === 'x' ? xText(post) : (post.text || post.title)}`);
        console.log(`    λινκ:    ${target === 'facebook' ? await facebookLink(post) : post.link}`);
        if (post.image) console.log(`    φωτό:    ${post.image}`);
        continue;
      }

      // Already up from an earlier run that half-failed — never twice.
      if (post.results[target] && post.results[target].id) {
        console.log(`  ${NAMES[target]}: ανέβηκε ήδη, το προσπερνώ.`);
        continue;
      }

      try {
        const out = await SENDERS[target](post);
        post.results[target] = { ...out, at: new Date().toISOString() };
        console.log(`  ✓ ${NAMES[target]}: ${out.url || out.id}`);
      } catch (err) {
        errors.push(err.message);
        post.results[target] = { error: err.message, at: new Date().toISOString() };
        console.error(`  ✗ ${err.message}`);
      }
    }

    if (DRY) continue;

    touched = true;

    if (errors.length) {
      post.status = 'error';
      post.error = errors.join(' · ');
      failed++;
    } else {
      post.status = 'done';
      delete post.error;
      delete post.note;
    }
  }

  if ((touched || readyChanged) && !DRY) writeQueue(data);

  if (waiting) {
    console.log(`\n${waiting} περιμένουν κλειδιά. Μόλις μπουν τα secrets, `
      + 'ξανατρέχει και φεύγουν μόνα τους.');
  }

  if (hands) {
    console.log(`\n${hands} περιμένουν άνθρωπο — ανεβαίνουν από το διαχειριστικό.`);
  }

  if (failed) {
    console.error(`\n${failed} απέτυχαν — δες πιο πάνω.`);
    return 1;
  }

  return 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(`Έσκασε: ${err.message}`);
  process.exit(1);
});
