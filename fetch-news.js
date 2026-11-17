
const fs = require('fs');
const path = require('path');
const https = require('https');

const SITEMAP = 'https://www.newshub.gr/sitemap_google_news.xml';
const HOMEPAGE = 'https://www.newshub.gr/';
const OUT = path.join(__dirname, 'data', 'news.json');
const CURATION = path.join(__dirname, 'data', 'curation.json');

const BODY_DIR = path.join(__dirname, 'data', 'news-bodies');

// How many articles we keep in total. Their sitemap is a rolling 3-day
// window — whatever we do not save now is gone forever. Hence we
// accumulate instead of replacing.
const KEEP = 600;

const BODY_FOR = 20;

// How many articles we fetch at once. newshub.gr is a small site on
// shared hosting — we do not hit it with 250 requests together.
const AT_ONCE = 4;

// Their categories, from the /el/<slug>/ path. The names in their menu
// are unaccented because they are uppercase, so we spell them properly
// here. Where one matches a category of ours, we keep OUR name.
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
  // The boss asked for this split into History and Culture. The URL does
  // not say which of the two it is, so it goes to History and the admin
  // corrects it.
  'istoria-politismos': 'Ιστορία',
  // Theirs, with no counterpart of ours. They stay as a tag.
  sugar: 'Sugar',
  'ta-en-oiko': 'Τα εν οίκω',
  exodos: 'Έξοδος',
  prosopografies: 'Προσωπογραφίες',
  'vima-toy-politi': 'Βήμα του πολίτη',
  'to-piato-tis-imeras': 'Το πιάτο της ημέρας',
  magazine: 'The Magazine',
};

// Our own podcasts, which they also post on their site. We do not want
// them as "news" — we have them from Buzzsprout, with audio and a page.
const SKIP = new Set(['ta-podcasts-toy-newshub-gr-1']);

function get(url, until = '') {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'newshub-media-build/1.0 (+https://newshubmedia.gr)',
        Connection: 'close',
      },
      // A fresh connection each time. We cut the download off mid-way as
      // soon as we have what we want; if the connection is reused after
      // that, later requests break — that lost 58 articles in one run.
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
      // Once we cut the connection ourselves, Node duly raises an error —
      // ours, not the server's. Without this marker we would reject a
      // download that succeeded.
      let teleiose = false;
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
        // We do not need the whole page — only up to the marker we care
        // about. We cut the connection there: less data for us, less
        // load for their server.
        if (until && body.includes(until)) {
          teleiose = true;
          res.destroy();
          resolve(body);
        }
      });

      res.on('end', () => {
        if (teleiose) return;
        // res.complete: Node tells us whether the WHOLE body arrived.
        if (!res.complete) {
          return reject(new Error(`κομμένη λήψη στο ${url}`));
        }
        teleiose = true;
        resolve(body);
      });
      res.on('error', (err) => {
        if (teleiose) return;
        teleiose = true;
        reject(new Error(`${err.message} στο ${url}`));
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error(`λήξη χρόνου στο ${url}`)); });
    req.on('error', reject);
  });
}

const TRIES = 3;
const WAITS = [5000, 15000];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getStubborn(url, until = '', elegxos = null){
  let last;
  for (let i = 0; i < TRIES; i++) {
    try {
      const body = await get(url, until);
      const psegadi = elegxos ? elegxos(body) : '';
      if (psegadi) throw new Error(psegadi);
      return body;
    } catch (err) {
      last = err;
      if (i < TRIES - 1) {
        const wait = WAITS[i];
        console.warn(`  ${err.message} — ξαναπροσπαθώ σε ${wait / 1000}"`
          + ` (${i + 2}η από ${TRIES})`);
        await sleep(wait);
      }
    }
  }
  throw last;
}

// Their <head> writes the metas in various orders and with tabs between,
// so we match both layouts: content before or after the name.
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

function authorOf(html) {
  const block = html.match(/<a[^>]*class=["']news-author["'][\s\S]{0,600}?<\/a>/i);
  if (!block) return null;

  const href = (block[0].match(/href=["']([^"']+)["']/) || [])[1] || '';
  const img = (block[0].match(/<img[^>]*>/i) || [])[0] || '';
  const name = decode((img.match(/alt=["']([^"']*)["']/) || [])[1] || '');
  if (!name) return null;

  return { name, url: href, photo: bigPhoto(img) };
}

function bigPhoto(img) {
  const src = (img.match(/src=["']([^"']*)["']/) || [])[1] || '';
  if (!src) return '';

  const inner = src.match(/[?&]src=([^&"']+)/);
  if (!inner) return decode(src);

  const file = decodeURIComponent(inner[1]).replace(/^(\.\.\/)+/, '').replace(/^\/+/, '');
  if (!/^files\//.test(file)) return decode(src);

  return `https://static.newshub.gr/${file}`;
}

// URLs are of the form /el/<category>/<title>
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

async function frontPagePick() {
  try {
    const html = await get(HOMEPAGE);
    const m = html.match(/id=["']frontpage-title["'][^>]*>/) ? html : null;
    if (!m) return '';
    // The first link carrying the lead marker.
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

function when(html, fallbackDay) {
  // There is also a date inside an HTML comment, a little further down.
  const clean = html.replace(/<!--[\s\S]*?-->/g, '');
  const m = clean.match(/class="news-date"[^>]*>\s*(\d{1,2})\s+(\S+)\s+(\d{4})\s*[-–]\s*(\d{1,2}):(\d{2})/);

  if (m) {
    const mo = MONTHS.indexOf(bareMonth(m[2]));
    if (mo > -1) {
      const iso = athensToISO(+m[3], mo, +m[1], +m[4], +m[5]);
      // Articles scheduled for later: we leave them. They have not
      // published them yet either, and we will not be the first to. We
      // pick them up on the next run, when their time comes.
      return new Date(iso) > Date.now() ? null : iso;
    }
  }

  // Fallback: the day from the sitemap, with no time.
  const d = new Date(fallbackDay);
  if (isNaN(d)) return new Date().toISOString();
  return d > Date.now() ? null : d.toISOString();
}

function articleBody(html) {
  const start = html.indexOf('id="news-desc"');
  if (start < 0) return [];

  let block = html.slice(start);

  // The end: the tags marker, or — if missing — the "follow us" block,
  // which is glued to the end of the text and is not article.
  for (const mark of ['news-tags', 'follow-news-social', 'news-related']) {
    const end = block.indexOf(mark);
    if (end > 0) block = block.slice(0, end);
  }

  const out = [];
  for (const m of block.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const raw = m[1];
    const text = decode(raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '));
    if (text.length < 2) continue;

    // Standfirst: the whole paragraph inside <strong>, with no other text.
    const bold = raw.match(/^\s*<strong[^>]*>([\s\S]*?)<\/strong>\s*$/i);
    out.push({ type: bold ? 'h' : 'p', text });
  }

  return trimTail(out);
}

const TAIL = /^\s*(Διαβάστε|Δείτε|Δειτε|Διαβαστε)\s+(επίσης|επισης|κι ακόμα)/i;

function trimTail(paras) {
  const from = Math.floor(paras.length * 0.75);
  const cut = paras.findIndex((p, i) => i >= from && TAIL.test(p.text));
  return cut > 0 ? paras.slice(0, cut) : paras;
}

async function details(item, wantBody = false) {
  // We stop once past the date — it sits just under the title, so we
  // download a fraction of the page. When we want the body too, we go
  // down to the tags: ~45KB instead of 32KB, same request.
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
    // They come in two sizes. Small for the cards, large for the hero.
    image_large: img,
    image_thumb: img.replace('/765x435/', '/400x227/'),
    summary: decode(meta(head, 'og:description')),
    // Who signs it. Almost always present; where it is missing it stays
    // null and the site simply shows no face.
    author: authorOf(html),
    featured: false,
  };
}

// ---- The bodies ----

function bodyPath(id) {
  return path.join(BODY_DIR, `${id}.json`);
}

function hasBody(id) {
  return fs.existsSync(bodyPath(id));
}

function saveBody(article, paras) {
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

// Which articles does a human name in curation.json? Those need a body
// whatever their date — it may be months old.
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

const OPINIONS = 'https://www.newshub.gr/el/apopseis';
const OPINIONS_MAX = 15;

async function seedOpinions(have) {
  let html;
  try {
    html = await get(OPINIONS, 'footer');
  } catch (err) {
    console.warn('Απόψεις: δεν διαβάστηκε η σελίδα τους —', err.code || err.message);
    return [];
  }

  const links = [...new Set(
    [...html.matchAll(/href=["'](https:\/\/www\.newshub\.gr\/el\/apopseis\/[^"'?#]+)["']/g)]
      .map((m) => m[1]),
  )].filter((u) => !have.has(u)).slice(0, OPINIONS_MAX);

  if (!links.length) {
    console.log('Απόψεις: καμία καινούρια στη σελίδα τους');
    return [];
  }

  console.log(`Απόψεις: κατεβάζω ${links.length} από τη σελίδα τους`);
  const out = [];

  for (const url of links) {
    const p = partsOf(url);
    if (!p) continue;
    try {
      const one = await details({ id: p.slug, url, title: '', date: '', cat: p.cat });
      if (one) out.push(one);
    } catch (err) {
      console.warn('  παραλείπεται:', p.slug, '—', err.code || err.message);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(`  ${out.length} προστέθηκαν`);
  return out;
}

const AUTHORS_PER_RUN = 15;

async function ensureAuthors(all) {
  const missing = all
    .filter((a) => a.category === 'Απόψεις' && a.author === undefined)
    .slice(0, AUTHORS_PER_RUN);

  if (!missing.length) return;

  console.log(`Αρθρογράφοι: συμπληρώνω ${missing.length} παλιές Απόψεις`);
  let got = 0;

  for (const a of missing) {
    try {
      const html = await get(a.url, 'news-share-container');
      // null, not undefined: otherwise we would ask for it again on
      // every fetch, forever, for an article that simply has no byline.
      a.author = authorOf(html);
      if (a.author) got++;
    } catch (err) {
      console.warn('  παραλείπεται:', a.id, '—', err.code || err.message);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(`  ${got} βρήκαν αρθρογράφο`);
}

async function ensureBodies(all) {
  const want = new Map();

  for (const a of all.slice(0, BODY_FOR)) want.set(a.id, a);

  for (const a of all) {
    if (a.category === 'Απόψεις') want.set(a.id, a);
  }

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

// A few run together, not all: AT_ONCE workers pulling from one queue.
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
          // One second chance: most failures are momentary and clear
          // with half a second's wait.
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
  let apotyxia = null;
  let listed = [];
  try {
    listed = parseSitemap(await getStubborn(SITEMAP, '', (body) => (
      parseSitemap(body).length ? '' : 'το sitemap γύρισε 0 άρθρα'
    )));
  } catch (err) {
    apotyxia = err;
  }
  console.log(`  ${listed.length} άρθρα στη ροή τους`);

  const FRESH_HOURS = 3;   // ίδιο όριο με το check-fresh.js

  if (!listed.length) {
    let ores = Infinity;
    try {
      let top = 0;
      for (const a of JSON.parse(fs.readFileSync(OUT, 'utf8'))) {
        const t = new Date(a.date).getTime();
        if (!isNaN(t) && t > top) top = t;
      }
      if (top) ores = (Date.now() - top) / 3600000;
    } catch { /* δεν διαβάζεται: τότε δεν υπάρχει εφεδρεία, κοκκινίζουμε */ }

    const giati = apotyxia ? apotyxia.message : 'το sitemap γύρισε 0 άρθρα';

    if (ores <= FRESH_HOURS) {
      console.warn(`Δεν ήρθε ροή σε ${TRIES} προσπάθειες: ${giati}`);
      console.warn(`Τα δικά μας είναι φρέσκα — τελευταία είδηση πριν`
        + ` ${ores.toFixed(1)} ώρες. Στιγμιαία αστοχία τους· δεν κοκκινίζω.`);
      return;
    }

    throw new Error(`${giati} — άλλαξαν διεύθυνση ή έσπασε.`
      + ` Δες το ${SITEMAP} και το https://www.newshub.gr/robots.txt`);
  }

  // Whatever we already have stays. The sitemap holds only 3 days.
  let old = [];
  if (fs.existsSync(OUT)) {
    try {
      old = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    } catch (err) {
      console.warn('ΠΡΟΣΟΧΗ: το data/news.json δεν διαβάστηκε —', err.message);
    }
  }

  // The samples go as soon as real articles arrive.
  old = old.filter((a) => a.url && !/\[ΔΕΙΓΜΑ\]/.test(a.title || ''));

  const have = new Set(old.map((a) => a.url));
  const fresh = listed.filter((a) => !have.has(a.url));
  console.log(`  ${old.length} ήδη αποθηκευμένα, ${fresh.length} καινούρια`);

  const added = fresh.length ? await fetchAll(fresh) : [];

  // And Opinion from its own page — see seedOpinions().
  for (const a of added) have.add(a.url);
  const opinions = await seedOpinions(have);

  const sorted = [...old, ...added, ...opinions]
    .filter((a) => a.title && a.url)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  // The 600 cap cuts by date — and Opinion is sparse, so a three-week-old
  // piece would fall out while its homepage section still needs it. ALL
  // of them stay, and count normally inside the 600.
  const keep = sorted.slice(0, KEEP);
  const kept = new Set(keep.map((a) => a.url));
  const all = [
    ...keep,
    ...sorted.filter((a) => a.category === 'Απόψεις' && !kept.has(a.url)),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  // Their lead becomes our lead.
  const pick = await frontPagePick();
  let marked = '';
  for (const a of all) {
    a.featured = pick ? a.url === pick : false;
    if (a.featured) marked = a.title;
  }
  // If it was not found (they changed their HTML) we fall back to the
  // most recent one with an image — so the hero is never left empty.
  if (!marked) {
    const first = all.find((a) => a.image_large);
    if (first) { first.featured = true; marked = first.title; }
  }

  // Before writing: Opinion needs a face, and the old ones need it TOO —
  // otherwise the homepage section would be half empty for months.
  await ensureAuthors(all);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(all, null, 2), 'utf8');

  console.log();
  console.log(`Γράφτηκαν ${all.length} άρθρα στο data/news.json`);
  if (marked) console.log(`Πρωτοσέλιδο: ${marked.slice(0, 70)}`);

  // The bodies come last: they need the ORDER of the articles, and if
  // something goes wrong here, news.json has already been written right.
  console.log();
  await ensureBodies(all);

  // If the flow stops we have to find out — not serve yesterday's news
  // as today's.
  const newest = all.length ? new Date(all[0].date) : null;
  const hours = newest ? (Date.now() - newest.getTime()) / 36e5 : Infinity;
  if (hours > 24) {
    console.warn(`\nΠΡΟΣΟΧΗ: η πιο πρόσφατη είδηση είναι ${Math.round(hours)} ώρες παλιά.`);
    console.warn(`Μήπως έπαψε να ενημερώνεται το sitemap τους; ${SITEMAP}`);
  }
}

main().catch((err) => {
  console.error('Απέτυχε:', err.message);
  process.exitCode = 1;
});
