const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, 'data/episodes.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const EPISODE_DIR = path.join(PUBLIC_DIR, 'episode');
const GUEST_DIR = path.join(PUBLIC_DIR,'guest');
// How many cards show in the homepage flow. Deliberately small: a link to
// the full archive sits underneath.
const HOW_MANY = 9;
// The podcast's own artwork, written by fetch-episodes.js.
const PODCAST_FILE = path.join(__dirname, 'data/podcast.json');
const CURATION_FILE = path.join(__dirname, 'data/curation.json');
const NEWS_FILE = path.join(__dirname, 'data/news.json');
const VIDEO_FILE = path.join(__dirname, 'data/videos.json');
const TRANSCRIPT_DIR = path.join(__dirname, 'data/transcripts');
const TRANSCRIPT_OUT = path.join(__dirname, 'public/transcript');
const ALIAS_FILE = path.join(__dirname, 'data/people-aliases.json');
// Manual pairing fixes, written in the admin.
const PAIRS_FILE = path.join(__dirname, 'data/pairs.json');
// The "which spellings are the same person" logic lives there, and we
// borrow it to write the suggestions for the admin.
const { suggestFamilies } = require('./find-aliases.js');
const SHOW_ART_FILE = path.join(__dirname, 'data/show-art.json');
const ADS_FILE = path.join(__dirname, 'data/ads.json');
const SHOWS_FILE = path.join(__dirname, 'data/shows.json');
const SHOW_DIR = path.join(PUBLIC_DIR, 'show');
const ARTICLE_DIR = path.join(PUBLIC_DIR, 'arthro');
// Share pages for Facebook only — see sharePage().
const SHARE_DIR = path.join(PUBLIC_DIR, 'mf');
// Bodies of newshub.gr news. NOT data/articles.json — that one is written
// by the admin and holds our own articles.
const NEWS_BODY_DIR = path.join(__dirname, 'data/news-bodies');
// Our own articles, written in the admin.
const OWN_ARTICLES_FILE = path.join(__dirname, 'data/articles.json');
const VIDEO_DIR = path.join(PUBLIC_DIR, 'video');
const CATEGORY_DIR = path.join(PUBLIC_DIR, 'category');

// The final site address. Needed for share cards, canonical URLs and the
// sitemap — all of which want an ABSOLUTE address.
const SITE_URL = 'https://newshubmedia.gr';
const SITE_NAME = 'Newshub Media';

const FONT_PRELOAD = [
  'source-serif-4-greek.woff2',
  'commissioner-greek.woff2',
  'source-serif-4-latin.woff2',
  'commissioner-latin.woff2',
];

const CF_ANALYTICS = '1c6e9c91e5cd4c0ebdbeb09703c977fe';
const GOOGLE_VERIFY = '';
const GA4 = 'G-VSQD1S3PN5';

const ADSENSE = 'ca-pub-6446657266547680';

const GREEK = {
  'α':'a','β':'v','γ':'g','δ':'d','ε':'e','ζ':'z','η':'i','θ':'th',
  'ι':'i','κ':'k','λ':'l','μ':'m','ν':'n','ξ':'x','ο':'o','π':'p',
  'ρ':'r','σ':'s','ς':'s','τ':'t','υ':'y','φ':'f','χ':'ch','ψ':'ps','ω':'o'
};

// Titles arrive from RSS with encoded entities: &quot; for " and &amp;
// for &. decode turns them into real characters, esc makes them safe for
// HTML again. Always decode first, esc second.
function decode(text){
  return String(text)
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function esc(text){
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Text -> URL slug. decode first, or a title's &quot; becomes the word
// "quot" inside the link.
function slugify(text){
  const full = decode(text).toLowerCase()
  // A diaeresis means "do not read these two vowels together". It has to
  // be resolved BEFORE the diphthong rules, or "Αϋφαντής" goes through
  // αυ -> av and comes out avfantis instead of ayfantis.
    .replace(/[ΐϊ]/g, 'i').replace(/[ΰϋ]/g, 'y')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ου/g, 'ou').replace(/αυ/g, 'av').replace(/ευ/g, 'ev')
    .split('').map((ch) => GREEK[ch] || ch).join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (full.length <= 55) return full;              // fits whole, no cutting
  return full.slice(0, 55).replace(/-[^-]*$/, ''); // cut -> drop the half word
}

function episodeUrl(ep) {
  const number = ep.id.replace(/\D/g, '');
  // ep.slug is the ORIGINAL title, before the editor's corrections. The
  // URL never changes — see loadEpisodes.
  return `episode/${number}-${slugify(ep.slug || ep.headline)}.html`;
}


const MONTHS=['Ιαν','Φεβ','Μαρ','Απρ','Μαϊ','Ιουν','Ιουλ','Αυγ','Σεπ','Οκτ','Νοε','Δεκ'];

const ATHENS = 'Europe/Athens';
const athensFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: ATHENS,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit',
  hourCycle: 'h23',          // or midnight comes out as "24:00"
  weekday: 'short',
});

const DAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// The parts of a moment, as someone in Crete sees them.
function athens(iso){
  const d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d)) return null;

  const p = {};
  for (const part of athensFmt.formatToParts(d)) p[part.type] = part.value;

  return {
    year: +p.year,
    month: +p.month - 1,        // 0-11, as getMonth() has it
    day: +p.day,
    hour: p.hour,               // text, already zero-padded
    minute: p.minute,
    weekday: DAY_INDEX[p.weekday] ?? 0,
  };
}

// Its year, in Greece. Asked for often enough to deserve its own helper.
function athensYear(iso){
  const a = athens(iso);
  return a ? a.year : NaN;
}
function formatDate(iso){
  if(!iso) return '';
  const a = athens(iso);
  if (!a) return '';

// "Today" is measured at Greek midnight: otherwise a build at 01:30 local
// would say "yesterday" for something just published, because in UTC the
// day has not turned.
  const now = athens(new Date());
  const days = Math.round(
    (Date.UTC(now.year, now.month, now.day) - Date.UTC(a.year, a.month, a.day)) / 864e5,
  );

  if (days === 0 || days === 1) {
    return `${days === 0 ? 'σήμερα' : 'χθες'} ${a.hour}:${a.minute}`;
  }

  return `${a.day} ${MONTHS[a.month]} ${a.year}`;
}

function formatDuration(seconds){
  if(!seconds) return '';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} λεπτά`;
  return `${Math.floor(minutes / 60)}ω ${minutes % 60} λεπτά`;
}

// The persistent player bar. It exists on EVERY page, hidden, and appears
// once something plays. Living outside #page, navigation never touches it
// and the audio is not cut.
function playerBar(){
  return `  <div class="bar" hidden aria-label="Αναπαραγωγή">
    <a class="bar-now" href="#">
      <img class="bar-art" src="" alt="">
      <span class="bar-text">
        <span class="bar-show"></span>
        <span class="bar-title"></span>
      </span>
    </a>

    <div class="bar-controls">
      <button type="button" class="bar-btn" data-player="skip" data-by="-15" aria-label="15 δευτερόλεπτα πίσω">−15</button>
      <button type="button" class="bar-play" data-player="toggle" aria-label="Αναπαραγωγή">▶</button>
      <button type="button" class="bar-btn" data-player="skip" data-by="15" aria-label="15 δευτερόλεπτα μπροστά">+15</button>
    </div>

    <span class="bar-time" data-player-now>0:00</span>
    <div class="bar-seek" data-player="seek" role="slider" tabindex="0" aria-label="Θέση" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <div class="bar-fill"></div>
    </div>
    <span class="bar-time" data-player-total>--:--</span>

    <button type="button" class="bar-btn" data-player="speed" aria-label="Ταχύτητα">1×</button>
    <button type="button" class="bar-btn bar-close" data-player="close" aria-label="Κλείσιμο">✕</button>
  </div>`;
}

const SUMMARY_TAIL = [
// Channel boilerplate in its various spellings. "To" is written
// sometimes with a Latin and sometimes with a Greek o, so both are
// accepted.
  /\s*(?:[TΤ][oο]\s+|στ[ηοα]\s+)?(?:σελίδα|κανάλι)\s+μας\s+στ/u,
  /\s*Μας τιμάτε/u,
  /\s*@Newshub/iu,
  /\s*(?:Ακολουθήστε|Βρείτε) μας/u,
  /\s*Support the show/i,
  /\s*https?:\/\//u,
  /\s*#\s*[\p{L}\d]/u,
// In 2 episodes the "🎙️(date) Τα podcasts του Newshub.gr" marker is not
// at the front but in the middle. From the microphone on, nothing
// concerns the episode.
  /\s*🎙/u,
];

const SUMMARY_LEAD = [
  /^\(?\s*🎙️?\s*(?:\([^)]*\)|\d{1,2}\/\d{1,2}\/\d{2,4})?\s*\)?\s*/u,
  /^Τα podcasts του Newshub\.?gr\s*/i,
];

function stripBoilerplate(text){
// Spaces are collapsed WITHIN a line. Line breaks are Buzzsprout's
// paragraphs and must survive to summaryHtml — a plain s+ ate them and
// the description came out as one slab.
  let t = String(text || '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

// In a loop, because they also arrive in reverse order.
  for (let again = true; again; ) {
    again = false;
    for (const re of SUMMARY_LEAD) {
      const next = t.replace(re, '');
      if (next !== t) { t = next.trim(); again = true; }
    }
  }

  let cut = t.length;
  for (const re of SUMMARY_TAIL) {
    const m = t.match(re);
    if (m && m.index < cut) cut = m.index;
  }
  return t.slice(0, cut).trim().replace(/[-–·,;:]+$/, '').trim();
}

// Trims to a clean length for a description, without cutting a word in
// half. Single line: it goes into <meta description> and share cards.
function clip(text, max = 160){
  const t = stripBoilerplate(text).replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

const SUMMARY_POINT = /(?<=[.;!?»])\s+[-–]\s+(?=[Α-ΩΆΈΉΊΌΎΏΪΫA-Z«])/u;

function summaryHtml(text){
  const t = stripBoilerplate(text);
  if (!t) return '';

// Real paragraphs, as the editor wrote them in Buzzsprout. Where they
// exist we do not guess.
  const paras = t.split('\n').map((x) => x.trim()).filter(Boolean);
  if (paras.length > 1) {
    return paras
      .map((x) => `        <p class="episode-summary">${esc(x)}</p>`)
      .join('\n');
  }

  const bits = t.split(SUMMARY_POINT).map((s) => s.trim()).filter(Boolean);
  const lead = `<p class="episode-summary">${esc(bits[0])}</p>`;
  if (bits.length < 2) return lead;

  return `${lead}
        <ul class="episode-points">
${bits.slice(1).map((x) => `          <li>${esc(x)}</li>`).join('\n')}
        </ul>`;
}

const stamps = {};
function assetVersion(name){
  if (stamps[name] === undefined) {
    const file = path.join(PUBLIC_DIR, name);
    stamps[name] = fs.existsSync(file)
      ? crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex').slice(0, 8)
      : '';
  }
  return stamps[name] ? `?v=${stamps[name]}` : '';
}

function cleanUrl(u){
  if (!u) return u;
  return u
    .replace(/(^|\/)index\.html(?=$|[#?])/, '$1')
    .replace(/\.html(?=$|[#?])/, '');
}

function cleanHref(u){
  if (!u || u.startsWith('#') || u.startsWith('mailto:')) return u;

// External links stay EXACTLY as they are: their .html is not our
// business, and newshub.gr really does serve such URLs.
  if (/^(https?:)?\/\//.test(u) && !u.startsWith(SITE_URL)) return u;

  const out = cleanUrl(u);

// An empty href means "the current page", not the homepage. A plain
// index.html becomes "./", which is correct at any depth.
  return out === '' ? './' : out;
}

// Walks the finished page and cleans EVERY link, data-href included: that
// is the link the persistent player bar carries across navigation.
function cleanLinks(html){
  return html.replace(/\b(href|data-href)="([^"]*)"/g,
    (m, attr, u) => `${attr}="${cleanHref(u)}"`);
}

function metriseis(){
  const out = [];

  if (CF_ANALYTICS) {
    out.push('  <script type="module" src="https://static.cloudflareinsights.com/beacon.min.js"'
      + ` data-cf-beacon='{"token": "${esc(CF_ANALYTICS)}"}'></script>`);
  }

  if (GA4) {
    out.push('  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}'
      + "var _s='denied';try{if(localStorage.getItem('synainesi')==='nai')_s='granted'}catch(e){}"
      + "gtag('consent','default',{ad_storage:_s,ad_user_data:_s,ad_personalization:_s,"
      + "analytics_storage:_s,functionality_storage:'granted',security_storage:'granted',"
      + 'wait_for_update:500});'
      + `gtag('js',new Date());gtag('config','${esc(GA4)}');</script>`);
    out.push(`  <script async src="https://www.googletagmanager.com/gtag/js?id=${esc(GA4)}"></script>`);
  }

  return out.length ? out.join('\n') + '\n' : '';
}

function adsenseTag(){
  if (!ADSENSE) return '';

  return `  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(ADSENSE)}"
     crossorigin="anonymous"></script>\n`;
}

function consentBar(depth = 0){
  if (!GA4 && !ADSENSE) return '';

  const up = depth === 0 ? '' : '../';

// The text states ALL the reasons. A banner asking consent for analytics
// that in practice also opens an ad network is not valid consent.
  const logos = GA4 && ADSENSE
    ? 'Το Google Analytics μετράει πόσος κόσμος μας διαβάζει και το Google AdSense '
      + 'φέρνει τις διαφημίσεις. Και τα δύο χρειάζονται cookies'
    : ADSENSE
      ? 'Οι διαφημίσεις έρχονται από το Google AdSense, που χρειάζεται cookies '
        + 'για να σου δείξει εξατομικευμένες'
      : 'Μετράμε πόσος κόσμος μας διαβάζει με το Google Analytics, '
        + 'που χρειάζεται cookies';

  return `<div class="synainesi" data-synainesi hidden>
  <p class="synainesi-txt">${logos}. Χωρίς τη συγκατάθεσή σου δεν μπαίνει κανένα.
    <a href="${up}aporrito.html">Τι κρατάμε και τι όχι</a></p>
  <div class="synainesi-btns">
    <button type="button" class="synainesi-btn" data-syn="oxi">Όχι</button>
    <button type="button" class="synainesi-btn" data-syn="nai">Αποδοχή</button>
  </div>
</div>`;
}

const LOGO_URL = `${SITE_URL}/shows/logo-icon.png`;

// Publisher, short form. It goes inside every article, episode and video,
// so it is paid for 4,700 times — hence only the mandatory fields. The
// full form, with socials, appears once on the homepage.
const LD_PUB = {
  '@type': 'NewsMediaOrganization',
  '@id': `${SITE_URL}/#org`,
  name: SITE_NAME,
  url: `${SITE_URL}/`,
  logo: { '@type': 'ImageObject', url: LOGO_URL, width: 512, height: 512 },
};

function ldOrg(){
  return Object.assign({}, LD_PUB, {
// The same socials the footer shows. They tell Google this site and these
// accounts are the same organisation.
    sameAs: SOCIAL.map(([, link]) => link),
    description: 'Podcasts, βίντεο και συζητήσεις του newshub.gr — από την Κρήτη και τον κόσμο.',
  });
}

// Relative page URL -> absolute, in the ONE spelling we use everywhere
// (canonical, sitemap, og:url): no .html, no index.
function absUrl(url){
  return `${SITE_URL}/${cleanUrl(url || '')}`;
}

function absAsset(u){
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s) || s.startsWith('//') || s.startsWith('data:')) return s;
  return `${SITE_URL}/${s.replace(/^(\.\.?\/)+/, '').replace(/^\//, '')}`;
}

// The date needs ISO form with a timezone. Anything unreadable is dropped
// entirely: a wrong date is worse than none.
function ldDate(d){
  const t = Date.parse(d);
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
}

// Duration in ISO 8601 — "PT23M27S". The form schema.org wants.
function ldDuration(seconds){
  const s = Math.round(Number(seconds) || 0);
  if (!s) return '';
  return `PT${Math.floor(s / 60)}M${s % 60}S`;
}

function ldText(text, max = 110){
  const t = decode(String(text || '')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

// The same crumbs the page shows, in machine language. Takes exactly the
// list given to breadcrumb() — one source of truth, not two that drift.
function ldCrumbs(parts){
  const items = (parts || []).filter(Boolean);
  if (items.length < 2) return null;

  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((p, i) => Object.assign(
      { '@type': 'ListItem', position: i + 1, name: ldText(p.label, 160) },
      // The last crumb is the current page and carries no link.
      p.href ? { item: absUrl(p.href) } : {},
    )),
  };
}

// Drops empty keys. schema.org accepts missing fields; it does not accept
// empty values — datePublished: "" is an error, absence is not.
function ldClean(node){
  if (!node) return null;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    if (v === '' || v === null || v === undefined) continue;
    if (Array.isArray(v) && !v.length) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? ldClean(v) : v;
  }
  return out;
}

function ldBlock(nodes){
  const list = (Array.isArray(nodes) ? nodes : [nodes]).map(ldClean).filter(Boolean);
  if (!list.length) return '';

  const data = list.length === 1
    ? Object.assign({ '@context': 'https://schema.org' }, list[0])
    : { '@context': 'https://schema.org', '@graph': list };

  // " < " becomes < on purpose. If a title ever contains
  // "</script>", without this it would close the page mid-way. The JSON
  // stays valid — it is just another spelling of the same character.
  return `  <script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>\n`;
}

function page({ title, body, depth = 0, scripts = [], description = '', image = '', url = '', type = 'website', prev = '', next = '', canonical = '', jsonld = null }){
  const up = depth === 0 ? '' : '../';
  const vasika = (GA4 || ADSENSE) ? ['player.js', 'synainesi.js'] : ['player.js'];

  const tags = vasika.concat(scripts.filter((s) => vasika.indexOf(s) === -1))
    .map((s) => `  <script src="${up}${s}${assetVersion(s)}" defer></script>`)
    .join('\n');

  const desc = esc(clip(description || 'Podcasts, βίντεο και συζητήσεις του newshub.gr — από την Κρήτη και τον κόσμο.'));
  // With a trailing slash — the same spelling as in sitemap.xml, so
  // Google does not see two URLs for one homepage.
  const full = `${SITE_URL}/${cleanUrl(url)}`;
  const pic = absAsset(image) || `${SITE_URL}/share.jpg`;

  const canon = canonical || full;

  return cleanLinks(`<!DOCTYPE html>
<html lang="el">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${desc}">
  <link rel="canonical" href="${canon}">
${prev ? `  <link rel="prev" href="${SITE_URL}/${prev}">\n` : ''}${next ? `  <link rel="next" href="${SITE_URL}/${next}">\n` : ''}
  <!-- The card shown when the link is shared.
       The title arrives already passed through esc() — we do not escape it
       again, or &quot; would become &amp;quot; and show in the card. -->
  <meta property="og:type" content="${type}">
  <meta property="og:site_name" content="${SITE_NAME}">
  <meta property="og:locale" content="el_GR">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${desc}">
  <meta property="og:url" content="${full}">
  <meta property="og:image" content="${pic}">
${image ? '' : `  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
`}  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${desc}">
  <meta name="twitter:image" content="${pic}">

${ldBlock(jsonld)}${GOOGLE_VERIFY ? `  <meta name="google-site-verification" content="${esc(GOOGLE_VERIFY)}">\n` : ''}  <link rel="icon" href="${up}shows/logo-icon.png" type="image/png" sizes="512x512">
  <link rel="apple-touch-icon" href="${up}shows/logo-icon.png">
${FONT_PRELOAD.map((f) => `  <link rel="preload" href="${up}fonts/${f}" as="font" type="font/woff2" crossorigin>`).join('\n')}
  <link rel="stylesheet" href="${up}styles.css${assetVersion('styles.css')}">
${tags}
${metriseis()}${adsenseTag()}</head>
<body>
<div id="page">
${body}

${adSlot('footer', 'leaderboard')}

${siteFooter(depth)}
</div>

${playerBar()}
${consentBar(depth)}
</body>
</html>
`);
}


// newshub.gr socials. The icons are SVG written into the page — zero
// external files, zero icon library.
const SOCIAL = [
  ['Facebook', 'https://www.facebook.com/newshub.gr',
    'M14 9h2V6h-2c-1.7 0-3 1.3-3 3v2H9v3h2v6h3v-6h2.2l.3-3H14v-2c0-.6.4-1 1-1z'],
  ['Instagram', 'https://www.instagram.com/newshub.gr',
    'M12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4zm0 5.3a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2zM16 4H8a4 4 0 0 0-4 4v8a4 4 0 0 0 4 4h8a4 4 0 0 0 4-4V8a4 4 0 0 0-4-4zm2.9 12a2.9 2.9 0 0 1-2.9 2.9H8A2.9 2.9 0 0 1 5.1 16V8A2.9 2.9 0 0 1 8 5.1h8A2.9 2.9 0 0 1 18.9 8zm-1.6-7.8a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0z'],
  ['X', 'https://twitter.com/NewshubG',
    'M17.5 4h2.6l-5.7 6.5L21 20h-5.2l-4.1-5.4L6.9 20H4.3l6.1-7-5.9-9h5.4l3.7 4.9zm-.9 14.4h1.4L8.4 5.5H6.9z'],
  ['YouTube', 'https://www.youtube.com/@newshubgr',
    'M21.6 7.2c-.2-.9-.9-1.6-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4c-.9.2-1.6.9-1.8 1.8C2 8.8 2 12 2 12s0 3.2.4 4.8c.2.9.9 1.6 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4c.9-.2 1.6-.9 1.8-1.8.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15V9l5.2 3z'],
  ['TikTok', 'https://www.tiktok.com/@newshub.gr',
    'M16.5 3c.3 1.9 1.4 3.1 3.3 3.3v2.3c-1.1.1-2.1-.2-3.3-.9v5.9c0 4.7-5.1 6.2-7.2 2.9-1.3-2.1-.5-5.9 3.7-6v2.4c-.3.1-.7.1-1 .3-1 .3-1.5 1-1.4 2 .3 2 3.9 2.5 3.6-1.3V3z'],
];

function socialLinks(){
  return SOCIAL
    .map(([name, url, d]) => `<a href="${url}" target="_blank" rel="noopener" aria-label="${name}" title="${name}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg></a>`)
    .join('');
}

// Weather arrives ready in data/weather.json — the browser never asks
// for it. If the file is missing, the strip shows only the socials.
function loadWeather(){
  const file = path.join(__dirname, 'data/weather.json');
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn('ΠΡΟΣΟΧΗ: το data/weather.json δεν διαβάζεται —', err.message);
    return null;
  }
}

// Read once and cached — otherwise we would open the same file 1,500
// times, once per page.
let weatherCache;
function weather(){
  if (weatherCache === undefined) weatherCache = loadWeather();
  return weatherCache;
}

// Weather icons, one per family of WMO codes. Inline, like the socials.
const SKY = {
  sun:   '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.4M12 19.6V22M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2 12h2.4M19.6 12H22M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>',
  cloud: '<path d="M7.2 19h9.9a3.9 3.9 0 0 0 .5-7.77 5.6 5.6 0 0 0-10.78-1.2A4.3 4.3 0 0 0 7.2 19z"/>',
  rain:  '<path d="M7.4 15.5h9.4a3.6 3.6 0 0 0 .4-7.18 5.2 5.2 0 0 0-10-1.1 4 4 0 0 0 .2 8.28z"/><path d="M9 17.6l-.9 2.6M12.5 17.6l-.9 2.6M16 17.6l-.9 2.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"/>',
  snow:  '<path d="M7.4 15.5h9.4a3.6 3.6 0 0 0 .4-7.18 5.2 5.2 0 0 0-10-1.1 4 4 0 0 0 .2 8.28z"/><circle cx="9" cy="19" r="1"/><circle cx="12.5" cy="20.2" r="1"/><circle cx="16" cy="19" r="1"/>',
  storm: '<path d="M7.4 15.5h9.4a3.6 3.6 0 0 0 .4-7.18 5.2 5.2 0 0 0-10-1.1 4 4 0 0 0 .2 8.28z"/><path d="M13 16.5l-3 4h2.4l-1 3 3.6-4.6h-2.3z"/>',
};

function skyIcon(code){
  if (code === 0 || code === 1) return SKY.sun;
  if (code >= 95) return SKY.storm;
  if (code >= 71 && code <= 86) return SKY.snow;
  if (code >= 51 && code <= 82) return SKY.rain;
  return SKY.cloud;
}

function topBar(weather){
  const w = weather
    ? `<div class="weather" title="${esc(weather.condition)} · ${weather.low}°/${weather.high}°">
      <span class="weather-city">${esc(weather.city)}</span>
      <span class="weather-now">
        <svg class="weather-icon" viewBox="0 0 24 24" aria-hidden="true">${skyIcon(weather.code)}</svg>
        <span class="weather-temp">${weather.temp} °C</span>
      </span>
    </div>`
    : '';

  return { weather: w, social: `<nav class="social">${socialLinks()}</nav>`, today: todayLabel() };
}

const DAYS = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];
const MONTHS_FULL = ['Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου', 'Ιουνίου',
  'Ιουλίου', 'Αυγούστου', 'Σεπτεμβρίου', 'Οκτωβρίου', 'Νοεμβρίου', 'Δεκεμβρίου'];

function todayLabel(){
  const a = athens(new Date());
  return `${DAYS[a.weekday]}, ${a.day} ${MONTHS_FULL[a.month]} ${a.year}`;
}

// The strapline and the line under it. Written HERE and nowhere else.
const SLOGAN = 'Ενημέρωση που αξίζει να έχεις.';
const TAGLINE = 'Podcasts και βίντεο του newshub.gr — συζητήσεις, αναλύσεις και πρόσωπα, από την Κρήτη και τον κόσμο.';

// The strip image. Used as public/intro.jpg whenever it exists; until
// then the strip stands alone, with no gap and no broken image. jpg, png
// and webp are supported.
function introImage(){
  for (const name of ['intro.jpg', 'intro.png', 'intro.webp']) {
    if (fs.existsSync(path.join(PUBLIC_DIR, name))) return name;
  }
  return '';
}

function intro(newestEpisode, newestVideo){
  const img = introImage();

  // ONE button. The strapline promises stories worth hearing, so it leads
  // to the most recent episode — not to video.
  const cta = newestEpisode
    ? `<a class="intro-cta" href="${episodeUrl(newestEpisode)}">♪ Άκουσε το τελευταίο</a>`
    : (newestVideo ? `<a class="intro-cta" href="${videoUrl(newestVideo)}">▶ Δες το τελευταίο</a>` : '');

  // With an image: the words sit ON it, with a gradient from the left.
  // Without one: plain text, no gap.
  return `  <section class="intro${img ? ' intro--photo' : ''}">
    ${img ? `<img class="intro-bg" src="${img}" alt="" fetchpriority="high">` : ''}
    <div class="intro-text">
      <h2 class="intro-slogan">${esc(SLOGAN)}</h2>
      <p class="intro-sub">${esc(TAGLINE)}</p>

      ${cta}
    </div>
  </section>`;
}

function pageHero(image){
  if (!image) return '';
  return `  <div class="page-hero" aria-hidden="true">
    <div class="page-hero-box">
      <img class="page-hero-img" src="${image}" alt="">
    </div>
  </div>`;
}

function breadcrumb(parts, depth = 0){
  const up = depth === 0 ? '' : '../';
  const items = parts.filter(Boolean);

  const html = items.map((p, i) => {
    const last = i === items.length - 1;
    if (last || !p.href) return `<span>${esc(p.label)}</span>`;
    return `<a href="${up}${p.href}">${esc(p.label)}</a>`;
  }).join('<i>›</i>');

  return `  <nav class="crumbs">${html}</nav>`;
}

const LEGAL = [
  ['Ταυτότητα', 'https://www.newshub.gr/el/taytotita'],
  ['Επικοινωνία', 'https://www.newshub.gr/el/epikoinonia'],
  ['Όροι χρήσης', 'https://www.newshub.gr/el/oroi-chrisis'],
  ['Απόρρητο', 'aporrito.html', true],
];

let adsCache;
function adsAll(){
  if (adsCache) return adsCache;

  adsCache = [];
  try {
    const raw = JSON.parse(fs.readFileSync(ADS_FILE, 'utf8'));
    if (Array.isArray(raw && raw.ads)) adsCache = raw.ads;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('ΠΡΟΣΟΧΗ: το data/ads.json δεν διαβάζεται —', err.message);
    }
  }
  return adsCache;
}

const AD_SLIDES_MAX = 6;

function isAdVideo(src){
  return /\.mp4$/i.test(String(src || ''));
}

function adPics(a){
  const many = Array.isArray(a && a.images) ? a.images.filter(Boolean) : [];
  if (many.length) return many.slice(0, AD_SLIDES_MAX);
  return a && a.image ? [a.image] : [];
}

// How long each image lasts. Under 3 seconds there is no time to read a
// phone number or address — which is the whole point of a local ad.
const AD_EVERY_MIN = 3;
const AD_EVERY_MAX = 20;
const AD_EVERY_DEF = 5;

function adEvery(a){
  const n = Number(a && a.every);
  if (!Number.isFinite(n)) return AD_EVERY_DEF;
  return Math.min(AD_EVERY_MAX, Math.max(AD_EVERY_MIN, Math.round(n)));
}

function adFor(place, offset = 0){
  const today = new Date().toISOString().slice(0, 10);

  const live = adsAll().filter((a) => a
    && a.status !== 'off'
    && adPics(a).length
    && Array.isArray(a.places) && a.places.includes(place)
    && (!a.from || a.from <= today)
    && (!a.to || a.to >= today));

  if (!live.length) return null;

  const day = Math.floor(Date.parse(`${today}T00:00:00Z`) / 86400000);
  return live[(day + offset) % live.length];
}

function adInner(ad){
  const pics = adPics(ad);
  const alt = esc(ad.alt || ad.partner || 'Διαφήμιση');

  if (pics.length === 1 && isAdVideo(pics[0])) {
    return `    <a class="ad-link" href="${esc(ad.url || '#')}" target="_blank" rel="noopener sponsored"
       aria-label="Διαφήμιση: ${esc(ad.partner || '')}">
      <video class="ad-image ad-video" src="${esc(pics[0])}"
             autoplay muted loop playsinline preload="metadata"
             aria-label="${alt}"></video>
    </a>
    <span class="ad-note ad-note--on">Διαφήμιση</span>`;
  }

  const media = pics.length > 1
    ? `      <span class="ad-slides" data-n="${pics.length}"
            style="--ad-n:${pics.length};--ad-every:${adEvery(ad)}s">
${pics.map((src, i) => `        <img class="ad-image ad-slide" src="${esc(src)}" alt="${i === 0 ? alt : ''}"
             style="--i:${i}" loading="lazy">`).join('\n')}
      </span>`
    : `      <img class="ad-image" src="${esc(pics[0])}" alt="${alt}" loading="lazy">`;

  return `    <a class="ad-link" href="${esc(ad.url || '#')}" target="_blank" rel="noopener sponsored"
       aria-label="Διαφήμιση: ${esc(ad.partner || '')}">
${media}
    </a>
    <span class="ad-note ad-note--on">Διαφήμιση</span>`;
}

function adRatio(ad){
  const w = Number(ad && ad.w);
  const h = Number(ad && ad.h);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return '';
  return (w / h).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

function adSlot(place, size, key = place, offset = 0){
  const ad = adFor(key, offset);

  // Empty slot: the reserved space and the word stay. The page is exactly
  // the same height with or without an ad.
  const inner = ad
    ? adInner(ad)
    : '    <span class="ad-note">Διαφήμιση</span>';

  const ar = ad ? adRatio(ad) : '';
  const cls = `ad ad--${size}${ad ? ' ad--full' : ''}${ar ? ' ad--fit' : ''}`;

  const style = ar ? ` style="--ad-ar:${ar};--ad-wpx:${Number(ad.w)}px"` : '';

  return `  <aside class="${cls}"${style} data-ad="${place}" aria-label="Διαφήμιση">
${inner}
  </aside>`;
}

const CARDS_PER_AD = 20;

const WIDE_SHARE = 0.8;

function allVideo(items){
  if (!items.length) return false;
  const wide = items.filter((it) => it.kind === 'video').length;
  return wide / items.length >= WIDE_SHARE;
}

function cardsWithAds(cards, place){
  const out = [];

  cards.forEach((html, i) => {
    if (i > 0 && i % CARDS_PER_AD === 0) {
      const nth = i / CARDS_PER_AD;
      // "place" is what gets sold; the number stays in data-ad only, to
      // tell slots apart within a page.
      out.push(adSlot(`${place}-${nth}`, 'leaderboard', place, nth - 1));
    }
    out.push(html);
  });

  return out.join('\n');
}

const WAVE_BARS = 120;

function waveMask(seed){
  // A small deterministic generator. Not cryptographic quality — just
  // enough that everyone does not get the same shape.
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const next = () => {
    h = (h * 1103515245 + 12345) >>> 0;
    return h / 4294967296;
  };

  const bars = [];
  for (let i = 0; i < WAVE_BARS; i++) {
    const argo = Math.sin((i / WAVE_BARS) * Math.PI * 2.6);
    const grigoro = Math.sin((i / WAVE_BARS) * Math.PI * 9.4);
    const curve = 0.56 + 0.26 * argo + 0.13 * grigoro;

    const height = Math.max(0.12, Math.min(1, curve * (0.38 + next() * 1.25)));
    bars.push(height);
  }

  const step = 12;
  const width = 7;

  const d = bars.map((v, i) => {
    const h = Math.round(v * 100);
    // The round cap sticks out by half the stroke on each side, so the
    // line is drawn shorter to end up at the requested height.
    const len = Math.max(0, h - width);
    const top = Math.round((100 - len) / 2);
    const x = i * step + Math.round(width / 2);
    // Zero length = a dot. "v0" is enough: linecap round turns it into a
    // circle, which is what we want for a bar shorter than its width.
    return `M${x} ${top}v${len}`;
  }).join('');

  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${WAVE_BARS * step} 100' preserveAspectRatio='none'><path d='${d}' stroke='#fff' stroke-width='${width}' stroke-linecap='round'/></svg>`;
  const data = encodeURIComponent(svg).replace(/'/g, '%27').replace(/[()]/g, (c) => (c === '(' ? '%28' : '%29'));
  return `url(data:image/svg+xml,${data})`;
}

function playerView({ id, src, title, show, art, href, indent = 8 }){
  const pad = ' '.repeat(indent);
  const p = (n, s) => `${' '.repeat(indent + n)}${s}`;

  return `${pad}<div class="player" data-player-view
${p(5, `data-id="${esc(id)}"`)}
${p(5, `data-src="${esc(src)}"`)}
${p(5, `data-title="${esc(title)}"`)}
${p(5, `data-show="${esc(show || '')}"`)}
${p(5, `data-art="${esc(art || '')}"`)}
${p(5, `data-href="${esc(href)}">`)}
${p(2, art
    ? `<img class="player-art" src="${esc(art)}" alt="" loading="lazy">`
    : '<span class="player-art player-art--blank"></span>')}
${p(2, '<div class="player-body">')}
${show ? `${p(4, `<p class="player-show">${esc(show)}</p>`)}\n` : ''}${p(4, '<div class="player-top">')}
${p(6, '<button type="button" class="player-play" data-player="toggle" aria-label="Αναπαραγωγή">▶</button>')}
${p(6, `<p class="player-title">${esc(title)}</p>`)}
${p(4, '</div>')}
${p(4, `<div class="player-bar" data-player="seek" role="slider" tabindex="0" aria-label="Θέση" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" style="--wave: ${waveMask(id)}">`)}
${p(6, '<div class="player-fill"></div>')}
${p(4, '</div>')}
${p(4, '<div class="player-foot">')}
${p(6, '<span class="player-time">')}
${p(8, '<span class="player-now" data-player-now>0:00</span>')}
${p(8, '<span class="player-sep">|</span>')}
${p(8, '<span class="player-total" data-player-total>--:--</span>')}
${p(6, '</span>')}
${p(6, '<span class="player-jump">')}
${p(8, '<button type="button" class="player-skip" data-player="skip" data-by="-15" aria-label="15 δευτερόλεπτα πίσω">−15</button>')}
${p(8, '<button type="button" class="player-skip" data-player="skip" data-by="15" aria-label="15 δευτερόλεπτα μπροστά">+15</button>')}
${p(6, '</span>')}
${p(4, '</div>')}
${p(2, '</div>')}
${pad}</div>`;
}

function siteFooter(depth = 0){
  const up = depth === 0 ? '' : '../';
  const year = new Date().getFullYear();

  const nav = MENU
    .map(([t, href, reload]) => `<a href="${up}${href}"${reload ? ' data-reload' : ''}>${t}</a>`)
    .join('\n      ');

  // A third element means "our own page": it needs the depth prefix and
  // does NOT open in a new tab.
  const legal = LEGAL
    .map(([t, href, diki]) => (diki
      ? `<a href="${up}${href}">${t}</a>`
      : `<a href="${href}" target="_blank" rel="noopener">${t}</a>`))
    .join('\n      ');

  return `  <footer class="site-footer">
    <nav class="foot-nav">
      ${nav}
    </nav>

    <nav class="foot-legal">
      ${legal}
      <a href="https://www.newshub.gr" target="_blank" rel="noopener">newshub.gr ↗</a>
    </nav>

    <nav class="social foot-social">${socialLinks()}</nav>

    <a class="wordmark foot-mark" href="${up}index.html" aria-label="Newshub Media">
      <img src="${up}shows/logo-full-dark.png" alt="Newshub Media" width="220" height="70" loading="lazy">
    </a>

    <a class="foot-top" href="#top" aria-label="Πάνω">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 14l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </a>

    <div class="foot-bar">
      <p class="foot-rights">© Newshub Media, 2021 – ${year} · Με επιφύλαξη παντός δικαιώματος.</p>
      <p class="foot-place">Ηράκλειο Κρήτης</p>
    </div>
  </footer>`;
}

const MENU = [
  ['Εκπομπές', 'shows.html'],
  ['Podcasts', 'episodes.html'],
  ['Ενότητες', 'categories.html'],
  ['Πρόσωπα', 'guests.html'],
  ['Αρχείο', 'search.html', true],
];

let menuData = { shows: [], topics: [], people: [] };
function indexMenu(showGroups, catGroups){
  menuData = {
    shows: Object.keys(showGroups)
      .map((k) => ({ name: showName(showGroups[k].name), href: showUrl(showGroups[k].name), n: showGroups[k].items.length }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 8),

    topics: Object.keys(catGroups)
      .filter((k) => catGroups[k].items.length)
      .map((k) => ({ name: catGroups[k].name, href: categoryUrl(catGroups[k].name), n: catGroups[k].items.length }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 8),

    people: [...peopleIndex]
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map((p) => ({ name: p.name, href: `guest/${p.slug}.html`, n: p.count })),
  };
}

function gridPanel(depth = 0){
  const up = depth === 0 ? '' : '../';

  const col = (title, all, allHref, rows) => `      <div class="gm-col">
        <p class="gm-head">${title}</p>
${rows.map((r) => `        <a class="gm-link" href="${up}${r.href}"><span>${esc(r.name)}</span></a>`).join('\n')}
        <a class="gm-all" href="${up}${allHref}">${all} →</a>
      </div>`;

  const platforms = PLATFORMS
    .map(([name, url]) => `        <a class="gm-link" href="${url}" target="_blank" rel="noopener"><span>${name}</span><i>↗</i></a>`)
    .join('\n');

  const socials = SOCIAL
    .map(([name, url, path]) => `        <a class="gm-link gm-social" href="${url}" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" fill="currentColor"/></svg>
          <span>${name}</span>
        </a>`)
    .join('\n');

  // The main menu is here too, but only visible below 760px, where the
  // header bar hides it. On desktop this copy stays hidden via CSS.
  const nav = `      <nav class="gm-nav">
${MENU.map(([t, href, reload]) => `        <a href="${up}${href}"${reload ? ' data-reload' : ''}>${t}</a>`).join('\n')}
      </nav>`;

  return `  <div class="gm" id="gridmenu" hidden>
    <div class="wrap gm-cols">
${nav}
${menuData.shows.length ? col('Εκπομπές', 'Όλες οι εκπομπές', 'shows.html', menuData.shows) : ''}
${menuData.topics.length ? col('Ενότητες', 'Όλες οι ενότητες', 'categories.html', menuData.topics) : ''}
${menuData.people.length ? col('Πρόσωπα', 'Όλα τα πρόσωπα', 'guests.html', menuData.people) : ''}
      <div class="gm-col">
        <p class="gm-head">Άκου παντού</p>
${platforms}
      </div>
      <div class="gm-col">
        <p class="gm-head">Follow</p>
${socials}
        <a class="gm-link gm-out" href="https://www.newshub.gr"><span>newshub.gr</span><i>↗</i></a>
      </div>
    </div>
  </div>`;
}

function siteHeader(depth = 0){
  const up = depth === 0 ? '': '../';
  const items = MENU.map(([t, href, reload]) => [t, `${up}${href}`, reload]);

  const bar = topBar(weather());

  return `<header class = "site-header" id="top">
  <div class="wrap mast">
    <span class="mast-today">${bar.today}</span>
    <a class="wordmark" href="${up}index.html" aria-label="Newshub Media">
      <img src="${up}shows/logo-full-dark.png" alt="Newshub Media" width="1920" height="640" fetchpriority="high">
    </a>
  </div>
  <div class="wrap strip-inner">
  <div class="topstrip-left">
    ${bar.weather}
    ${bar.social}
  </div>
  <nav class = "site-nav">
  ${items.map(([t, href, reload]) => (href ? `<a href="${href}"${reload ? ' data-reload' : ''}>${t}</a>` : `<span>${t}</span>`)).join('\n     ')}
  </nav>
  <div class="topstrip-right">
    <a class="site-out" href="https://www.newshub.gr" title="Μετάβαση στο newshub.gr">
      <span class="site-out-label">Μετάβαση στο</span>
      <img class="site-out-logo" src="${up}shows/logo-newshub.png" alt="newshub.gr" width="1920" height="640" loading="lazy">
    </a>
    <a class="site-search" href="${up}search.html" data-reload aria-label="Αναζήτηση">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
    </a>
    <button type="button" class="site-grid" data-gridmenu
            aria-controls="gridmenu" aria-expanded="false" aria-label="Όλες οι ενότητες">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="6" cy="6" r="1.6"/><circle cx="12" cy="6" r="1.6"/><circle cx="18" cy="6" r="1.6"/>
        <circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/>
        <circle cx="6" cy="18" r="1.6"/><circle cx="12" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/>
      </svg>
    </button>
  </div>
  </div>
${gridPanel(depth)}
  </header>`

}
// One shape for podcasts and news. Cards and the hero work on it without
// knowing which is which; only the label colour changes.
function itemFromEpisode(ep){
  const vt = videoTwin(ep);
  return {
    kind: 'podcast',
    id: ep.id,
    href: episodeUrl(ep),
    external: false,
    label: episodeCategories(ep)[0] || '',
    name: guestOf(ep),
    title: decode(ep.headline),
    image: ep.image,
    hero: (vt && vt.image) ? vt.image : ep.image,
    date: ep.date,
    // Duration moved out of the meta line onto its own badge over the
    // image — otherwise it would be printed twice on the same card.
    meta: formatDate(ep.date),
    duration: formatDuration(ep.seconds),
    cta: 'Άκου το επεισόδιο',
    topics: episodeCategories(ep),
  };
}

function itemFromVideo(v){
  return {
    kind: 'video',
    // The YouTube id. Needed for sameItem() when a journalist pins a
    // video from the admin: without it it.id was "undefined" and the pick
    // was silently lost.
    id: v.id,
    href: videoUrl(v),
    external: false,                // plays on our own page, embedded
    label: categoriesFor(v.id, v.title)[0] || '',
    name: '',
    title: v.title,
    image: v.image,
    hero: v.image,
    date: v.date,
    meta: formatDate(v.date),
    cta: 'Δες το βίντεο',
    topics: categoriesFor(v.id, v.title),
  };
}

const bodyCache = new Map();
function articleBody(id){
  if (bodyCache.has(id)) return bodyCache.get(id);

  let body = null;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(NEWS_BODY_DIR, `${id}.json`), 'utf8'));
    if (Array.isArray(raw.body) && raw.body.length >= 2) body = raw.body;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`ΠΡΟΣΟΧΗ: το data/news-bodies/${id}.json δεν διαβάζεται —`, err.message);
    }
  }

  bodyCache.set(id, body);
  return body;
}

function articleUrl(a){
  return `arthro/${a.id}.html`;
}

function itemFromArticle(a){
  const mine = !!articleBody(a.id);

  return {
    kind: 'news',
    href: mine ? articleUrl(a) : a.url,
    // The newshub.gr URL travels with it, so a manual pick by the editor
    // is recognised however they write it.
    source: a.url,
    external: !mine,                // no body, lives only on newshub.gr
    label: a.category || '',
    name: '',
    title: a.title,
    image: a.image_thumb || a.image_large,
    hero: a.image_large || a.image_thumb,
    date: a.date,
    meta: formatDate(a.date),
    cta: 'Διάβασε το άρθρο',
    topics: a.category ? [a.category] : [],
  };
}

// rank is written ONLY in the homepage flow, the only one with a topic
// filter. Other card rows neither receive nor print it.
// The podcast's own artwork, for episodes that carry none.
//
// 19 of 1,095 have no itunes:image — the producer never attached one —
// and an empty frame on the homepage reads as a broken site rather than
// as a missing cover.
//
// Applied at RENDER time and never written into ep.image, on purpose: the
// topic and show pages choose their picture with "the first item that has
// an image", and a fallback everywhere would hand them this generic
// artwork instead of a real photograph.
let podcastCover = null;

function podcastArt(){
  if (podcastCover !== null) return podcastCover;

  try {
    podcastCover = String(JSON.parse(fs.readFileSync(PODCAST_FILE, 'utf8')).image || '');
  } catch {
    // Not fetched yet. The frame stays empty, exactly as before.
    podcastCover = '';
  }

  return podcastCover;
}

// Videos are left out: a YouTube video always has a thumbnail, so a
// missing one means something is wrong and should look wrong.
function coverOf(item){
  return item.image || (item.kind === 'podcast' ? podcastArt() : '');
}

function card(item, depth = 0, rank = null){
  const up = depth === 0 ? '' : '../';
  const href = item.external ? item.href : `${up}${item.href}`;
  const out = item.external ? ' target="_blank" rel="noopener"' : '';

  // Topics are written as slugs, space separated: data-topics="kriti ygeia".
  // That lets the filter strip find its cards without asking a server.
  const topics = (item.topics || []).map(slugify).filter(Boolean).join(' ');

  const cls = ['card', item.extra ? 'is-extra' : '', item.lead ? 'card--lead' : '']
    .filter(Boolean).join(' ');

  const img = coverOf(item);
  const letterbox = /\/(sddefault|hqdefault)\.jpg/.test(img);
  const imgCls = `card-image${letterbox ? ' card-image--letterbox' : ''}`;
  const hide = item.extra ? ' hidden' : '';

  return `<article class="${cls}"${hide} data-kind="${item.kind}"${topics ? ` data-topics="${topics}"` : ''}${rank === null ? '' : ` data-rank="${rank}"`}>
    <a class="card-link" href="${href}"${out}>
    <span class="card-media">
      ${img ? `<img class="card-bloom${letterbox ? ' card-bloom--letterbox' : ''}" src="${img}" alt="" aria-hidden="true" loading="lazy">
      <img class="${imgCls}" src="${img}" alt="" loading="lazy">` : '<span class="card-image card-image--empty"></span>'}
      ${item.kind === 'news' ? '' : `<span class="card-play" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M9 7.5v9l7.5-4.5z" fill="currentColor"/></svg>
      </span>`}
      ${item.duration ? `<span class="card-time">${item.duration}</span>` : ''}
    </span>

    <span class="card-text">
      ${item.label ? `<span class="card-label">${esc(item.label)}</span>` : ''}
      <h2 class="card-title">${esc(item.title)}</h2>
      ${item.name ? `<span class="card-guest">${esc(item.name)}</span>` : ''}
      <span class="card-meta">${item.meta}</span>
    </span>
    </a>
  </article>`;
}

function inTopic(item, name){
  return { ...item, label: name, labelIsKind: false };
}

// The small horizontal card: thumbnail left, title right. Sits next to
// the big one in the topic sections.
function rowCard(item, depth = 0){
  const up = depth === 0 ? '' : '../';
  const href = item.external ? item.href : `${up}${item.href}`;
  const out = item.external ? ' target="_blank" rel="noopener"' : '';

  const img = coverOf(item);
  const letterbox = /\/(sddefault|hqdefault)\.jpg/.test(img);

  return `        <article class="row-card" data-kind="${item.kind}">
          <a class="row-card-link" href="${href}"${out}>
            <span class="row-card-media">
              ${img
                ? `<img class="card-bloom${letterbox ? ' card-bloom--letterbox' : ''}" src="${img}" alt="" aria-hidden="true" loading="lazy">
              <img class="row-card-art${letterbox ? ' row-card-art--letterbox' : ''}" src="${img}" alt="" loading="lazy">`
                : ''}
            </span>
            <span class="row-card-text">
              ${item.label ? `<span class="row-card-label">${esc(item.label)}</span>` : ''}
              <span class="row-card-title">${esc(item.title)}</span>
              <span class="row-card-meta">${item.meta}</span>
            </span>
          </a>
        </article>`;
}

//? Creates an HTML card for a single episode, ? means if not a than b
function episodeCard(ep,depth= 0){
  return card(itemFromEpisode(ep), depth);
}

// ---- hero ----

// data/curation.json is written by the admin and read here. If it does
// not exist the site works normally with automatic picks. The admin is an
// improvement, not a requirement.
function loadCuration(){
  if (!fs.existsSync(CURATION_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CURATION_FILE, 'utf8'));
  } catch (err) {
    console.warn('ΠΡΟΣΟΧΗ: το data/curation.json δεν διαβάζεται —', err.message);
    return {};
  }
}

const NEWS_BLOCK = require('./data/roi-apokleismena.json');
const NEWS_BLOCK_WORDS = NEWS_BLOCK.lexeis;
const NEWS_BLOCK_CATEGORIES = NEWS_BLOCK.katigories;

function blockedNews(a){
  const t = decode(a.title || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');

  if (NEWS_BLOCK_CATEGORIES.some((c) => c === a.category)) return true;

  return NEWS_BLOCK_WORDS.some((w) => t.includes(
    w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''),
  ));
}

function loadNews(){
  if (!fs.existsSync(NEWS_FILE)) return [];
  try {
    const list = JSON.parse(fs.readFileSync(NEWS_FILE, 'utf8'));
    const kept = list.filter((a) => !blockedNews(a));

    const dropped = list.length - kept.length;
    if (dropped) console.log(`Ειδήσεις εκτός site: ${dropped} από ${list.length}`);

    return kept.sort((a, b) => new Date(b.date) - new Date(a.date));
  } catch (err) {
    console.warn('ΠΡΟΣΟΧΗ: το data/news.json δεν διαβάζεται —', err.message);
    return [];
  }
}

// ---------------------------------------------------------------------
// Share pages for Facebook — public/mf/<id>.html
// ---------------------------------------------------------------------
//
// Cloudflare at newshub.gr answers 403 to facebookexternalhit, and so
// does static.newshub.gr. Everything else — Googlebot, Twitterbot, a
// real browser — gets 200. So Facebook cannot read their OG tags and
// shows a bare link with no photo.
//
// Until someone fixes that rule on THEIR side, a news link posted to
// Facebook points here instead: a page on our own domain that carries
// the same title, description and photo, and sends the reader on to the
// article. Facebook reads us; the reader still lands on newshub.gr.
//
// The photo goes through /mf/img — see functions/mf/img.js — for the
// same reason: Facebook cannot fetch it from static.newshub.gr either.
//
// noindex: this is the same article twice, and the one that belongs in
// Google is theirs, not ours.
// Buzzsprout serves every artwork square — 1400×1400. In a 16:9 frame
// that loses 44% of it, and what is lost is the show's title: it is
// printed on the picture. Where such a picture stands in for a missing
// cover, it must be shown WHOLE, which is what .show-cover already does.
function isSquareArt(url){
  return /storage\.buzzsprout\.com/.test(String(url || ''));
}

function shareUrl(a){
  return `mf/${a.id}.html`;
}

function sharePage(a){
  const title = decode(a.title || '');
  const summary = decode(a.summary || '');
  const target = a.url || '';
  const photo = a.image_large || a.image_thumb || '';

  // First choice: the card make-cards.js drew — their photo with the
  // headline printed on it, the way the boss asked for. It is already
  // 1200×630 and lives on our domain, so nothing needs mirroring.
  const card = path.join(PUBLIC_DIR, 'mf/kartes', `${a.id}.jpg`);
  const hasCard = fs.existsSync(card);

  const mirrored = hasCard
    ? `${SITE_URL}/mf/kartes/${a.id}.jpg`
    : (photo ? `${SITE_URL}/mf/img?u=${encodeURIComponent(photo)}` : `${SITE_URL}/share.jpg`);

  // The sizes are in the path they serve them from: .../765x435/...
  const size = hasCard ? [null, '1200', '630'] : /\/(\d{2,4})x(\d{2,4})\//.exec(photo);

  return `<!DOCTYPE html>
<html lang="el">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="robots" content="noindex, follow">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="newshub.gr">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(summary)}">
  <meta property="og:url" content="${SITE_URL}/mf/${a.id}">
  <meta property="og:image" content="${esc(mirrored)}">
${size ? `  <meta property="og:image:width" content="${size[1]}">
  <meta property="og:image:height" content="${size[2]}">
` : ''}  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(summary)}">
  <meta name="twitter:image" content="${esc(mirrored)}">
  <!-- ΟΧΙ canonical και ΟΧΙ meta refresh προς το άρθρο. Ο scraper του
       Facebook ακολουθεί και τα δύο: πήγαινε στο newshub.gr, έτρωγε το
       403 του Cloudflare τους και η κάρτα έβγαινε «Just a moment...».
       Η προώθηση γίνεται με JavaScript, που ο scraper δεν τρέχει —
       το ρομπότ βλέπει την κάρτα, ο άνθρωπος το άρθρο. -->
  <style>
    body{background:#121010;color:#F0EDE8;font-family:system-ui,sans-serif;
         display:grid;place-items:center;min-height:100vh;margin:0;padding:2rem;
         text-align:center;line-height:1.6}
    a{color:#CF2233}
  </style>
</head>
<body>
  <p>Πάμε στο άρθρο…<br><a href="${esc(target)}">${esc(title)}</a></p>
  <script>location.replace(${JSON.stringify(target)});</script>
</body>
</html>`;
}

function loadOwnArticles(){
  if (!fs.existsSync(OWN_ARTICLES_FILE)) return [];

  let list;
  try {
    list = JSON.parse(fs.readFileSync(OWN_ARTICLES_FILE, 'utf8'));
  } catch (err) {
    console.warn('ΠΡΟΣΟΧΗ: το data/articles.json δεν διαβάζεται —', err.message);
    return [];
  }

  if (!Array.isArray(list)) {
    console.warn('ΠΡΟΣΟΧΗ: το data/articles.json δεν είναι λίστα — το αγνοώ.');
    return [];
  }

  const now = Date.now();
  const out = [];
  let drafts = 0;
  let later = 0;

  for (const a of list) {
    if (!a || !a.id || !a.title) continue;

    // Draft: the editor has not published it yet.
    if (a.status && a.status !== 'published') { drafts++; continue; }

    // Scheduled for later. We do not publish it early — same rule as the
    // news feed.
    if (a.date && new Date(a.date) > now) { later++; continue; }

    // A body under one paragraph is not an article. Better missing than a
    // page with a title and nothing under it.
    const body = Array.isArray(a.body) ? a.body.filter((b) => b && b.type) : [];
    if (!body.length) {
      console.warn(`ΠΡΟΣΟΧΗ: το άρθρο «${a.title}» δεν έχει σώμα — δεν βγαίνει σελίδα.`);
      continue;
    }

    out.push({ ...a, body });
  }

  if (drafts) console.log(`Δικά μας άρθρα: ${drafts} πρόχειρα, δεν δημοσιεύονται`);
  if (later) console.log(`Δικά μας άρθρα: ${later} προγραμματισμένα για αργότερα`);

  return out.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

function ownArticleUrl(a){
  return `arthro/${a.id}.html`;
}

// The episode with this id, for embeds inside articles. Accepts both
// "Buzzsprout-19907711" and a bare "19907711": the editor copies what
// they see, and both forms are in circulation.
let episodeIndex;
function episodeById(id){
  if (!episodeIndex) {
    episodeIndex = new Map();
    for (const ep of loadEpisodes()) {
      episodeIndex.set(String(ep.id).toLowerCase(), ep);
      episodeIndex.set(String(ep.id).replace(/\D/g, ''), ep);
    }
  }
  const key = String(id).trim();
  return episodeIndex.get(key.toLowerCase()) || episodeIndex.get(key.replace(/\D/g, '')) || null;
}

function itemFromOwnArticle(a){
  return {
    kind: 'news',
    href: ownArticleUrl(a),
    external: false,                // ours, lives here
    label: a.category || '',
    name: a.author || '',
    title: a.title,
    image: a.image || '',
    hero: a.image || '',
    date: a.date,
    meta: formatDate(a.date),
    cta: 'Διάβασε το άρθρο',
    topics: a.category ? [a.category] : [],
  };
}

function pickFeatured(items, curation){
  const withImage = items.filter((it) => it.hero);

  // 1) The editor's pick. Accepts a URL OR an id, so copying the link
  //    from the browser is enough. Works the same for news, podcast and
  //    video.
  const want = String(curation.featured || '').trim();
  if (want) {
    if (curationExpired(curation)) {
      console.log(`Πρωτοσέλιδο: η χειροκίνητη επιλογή έληξε στις ${curation.featuredUntil} — γυρίζω στην αυτόματη`);
    } else {
      const chosen = items.find((it) => sameOrTwin(it, refsDidimou(want)));
      if (chosen) {
        if (curation.featuredHero) {
          chosen.hero = curation.featuredHero;
        }
        if (chosen.hero) {
          console.log(`Πρωτοσέλιδο: χειροκίνητο — ${String(chosen.title).slice(0, 60)}`);
          return chosen;
        }
        console.warn(`ΠΡΟΣΟΧΗ: το πρωτοσέλιδο «${want.slice(0, 60)}» δεν έχει εικόνα — γυρίζω στην αυτόματη επιλογή`);
      } else {
        console.warn(`ΠΡΟΣΟΧΗ: το πρωτοσέλιδο «${want.slice(0, 60)}» δεν βρέθηκε — γυρίζω στην αυτόματη επιλογή`);
      }
    }
  }

  // 2) Whatever they led with on newshub.gr.
  const flagged = withImage.find((it) => it.featured);
  if (flagged) return flagged;

  // 3) The most recent one with an image.
  return withImage[0] || items[0];
}

// Matches an item against what the editor wrote. Accepts an id, a full
// newshub.gr URL, or one of our own page URLs as the browser shows it —
// with or without http, localhost or domain.
function sameItem(it, want){
  const strip = (s) => String(s)
    .trim()
    .replace(/^https?:\/\/[^/]+\//i, '')   // drop the http://something/
    .replace(/^\/+/, '')
    .replace(/[?#].*$/, '')                 // and whatever hangs off the end
    .toLowerCase();

  const target = strip(want);
  if (!target) return false;

  if (String(it.id).toLowerCase() === target) return true;

  const mine = strip(it.href);
  if (mine === target) return true;

  if (it.source && strip(it.source) === target) return true;

  // Last resort: the filename alone, without extension — "arthro/x.html"
  // and "el/kriti/x" are the same thing.
  const tail = (s) => s.split('/').pop().replace(/\.html?$/, '');
  return tail(mine) === tail(target);
}

function refsDidimou(ref){
  const refs = [ref];

  const v = loadVideos().find((x) => sameItem({ id: x.id, href: videoUrl(x) }, ref));
  if (v) {
    const ep = episodeTwin(v);
    if (ep) refs.push(ep.id, episodeUrl(ep));
  }

  const ep = loadEpisodes().find((x) => sameItem({ id: x.id, href: episodeUrl(x) }, ref));
  if (ep) {
    const vid = videoTwin(ep);
    if (vid) refs.push(vid.id, videoUrl(vid));
  }

  return refs;
}

// Matches what the editor asked for — or its twin.
function sameOrTwin(it, refs){
  return refs.some((r) => sameItem(it, r));
}

// A manual pick expires if a date was set. Without it a forgotten line in
// curation.json freezes the homepage forever.
function curationExpired(curation){
  if (!curation.featuredUntil) return false;
  const until = new Date(`${curation.featuredUntil}T23:59:59`);
  return !isNaN(until) && until < new Date();
}

const PIN_ZOI = {
  mustRead: 3,
  latest: 7,
  opinions: 7,
  topics: 30,
};

// Which picks in a list are still valid.
function freshPins(lista, refs, kleidi){
  const life = PIN_ZOI[lista];
  if (!life) return refs;

  const stamps = ((curation().pinnedAt || {})[kleidi || lista]) || {};
  const orio = Date.now() - life * 864e5;

  return refs.filter((ref) => {
    const t = Date.parse(stamps[ref] || '');
    return isNaN(t) ? true : t >= orio;
  });
}

function kryfa(lista, kleidi){
  const stamps = (curation().hidden || {})[kleidi || lista] || {};
  const life = PIN_ZOI[lista];
  const orio = life ? Date.now() - life * 864e5 : null;

  const zonta = [];
  for (const [ref, pote] of Object.entries(stamps)) {
    if (typeof ref !== 'string' || !ref.trim()) continue;
    const t = Date.parse(pote || '');
    // No date means fresh — same reasoning as freshPins().
    if (orio !== null && !isNaN(t) && t < orio) continue;
    zonta.push(refsDidimou(ref.trim()));
  }

  if (!zonta.length) return () => false;
  return (it) => zonta.some((refs) => sameOrTwin(it, refs));
}

function pinnedFlow(curation, pools){
  const want = freshPins('latest', (curation.latest || []).map((s) => String(s).trim()).filter(Boolean));
  if (!want.length) return [];

  const out = [];
  for (const ref of want) {
    const refs = refsDidimou(ref);
    let hit = null;
    for (const { list, make } of pools) {
      const found = list.find((row) => sameOrTwin(make(row), refs));
      if (found) { hit = make(found); break; }
    }
    if (hit) out.push(hit);
    else console.warn(`ΠΡΟΣΟΧΗ: το καρφιτσωμένο «${ref}» δεν βρέθηκε — το προσπερνώ`);
  }
  return out;
}

function pickSecondary(items, curation, featured){
  const ids = curation.secondary || [];
  const chosen = ids.map((id) => items.find((it) => it.id === id)).filter(Boolean);

  const taken = new Set([featured, ...chosen]);

  // One queue per type, walked round-robin — so four of a kind do not
  // come out together, and no hole is left if one type runs out.
  const queues = ['news', 'video', 'podcast']
    .map((kind) => items.filter((it) => it.kind === kind && !taken.has(it)));

  const out = [...chosen];
  while (out.length < 4 && queues.some((q) => q.length)) {
    for (const q of queues) {
      if (out.length >= 4) break;
      if (q.length) out.push(q.shift());
    }
  }

  return out.slice(0, 4);
}

function naturalWidth(url = ''){
  const nh = url.match(/static\.newshub\.gr\/(\d+)x\d+\//);
  if (nh) return Number(nh[1]);
  if (/maxresdefault\.jpg/.test(url)) return 1280;
  if (/sddefault\.jpg/.test(url)) return 640;
  if (/hqdefault\.jpg/.test(url)) return 480;
  if (/buzzsprout\.com/.test(url)) return 1400;
  return 1200;
}

// The image ASPECT RATIO, so the row takes its shape. sddefault and
// hqdefault are 4:3 WITH black bars around 16:9 content — the content is
// what counts, so they are 16/9 too.
function naturalRatio(url = ''){
  const nh = url.match(/static\.newshub\.gr\/(\d+)x(\d+)\//);
  if (nh) return Number(nh[1]) / Number(nh[2]);
  return 16 / 9;
}

function heroBanner(item){
  const out = item.external ? ' target="_blank" rel="noopener"' : '';

  const art = item.kind === 'podcast' && naturalRatio(item.hero) < 1.3;
  const ar = naturalRatio(item.hero).toFixed(3);

  return `  <section class="hero${art ? ' hero--art' : ' hero--photo'}">
    <div class="hero-stage"${art ? '' : ` style="--ar: ${ar}"`}>
    ${item.hero
      ? `<img class="hero-bloom" src="${item.hero}" alt="" aria-hidden="true">
    <img class="hero-image" src="${item.hero}" alt="" style="--nat: ${naturalWidth(item.hero)}px">`
      : '<div class="hero-image hero-image--empty"></div>'}
    </div>
    <div class="hero-text">
      <div class="hero-block">
        ${item.label ? `<p class="hero-eyebrow">${esc(item.label)}</p>` : ''}
        ${item.name ? `<p class="hero-guest">${esc(item.name)}</p>` : ''}
        <h2 class="hero-title"><a href="${item.href}"${out}>${esc(item.title)}</a></h2>
        <p class="hero-date hero-date--${item.kind}">${formatDate(item.date)}</p>
        <a class="hero-cta" href="${item.href}"${out}>${item.cta}</a>
      </div>
    </div>
  </section>`;
}

// ---- shows ----

let videoCache;
function loadVideos(){
  if (videoCache) return videoCache;
  if (!fs.existsSync(VIDEO_FILE)) return [];
  try {
    const all = JSON.parse(fs.readFileSync(VIDEO_FILE, 'utf8'));
    const seenPairs = new Set();
    videoCache = all.filter((v) => {
      const pair = `${v.id}|${v.show}`;
      if (seenPairs.has(pair)) return false;
      seenPairs.add(pair);
      return true;
    });
    return videoCache;
  } catch (err) {
    console.warn('ΠΡΟΣΟΧΗ: το data/videos.json δεν διαβάζεται —', err.message);
    return [];
  }
}

let videosOnceCache;
function videosOnce(){
  if (videosOnceCache) return videosOnceCache;
  const seen = new Set();
  videosOnceCache = loadVideos().filter((v) => {
    if (seen.has(v.id)) return false;
    seen.add(v.id);
    return true;
  });
  return videosOnceCache;
}

// Video or episode? The two now travel together in the people groups and
// have to be told apart: a video has an embed, an episode has audio.
function einaiVideo(x){
  return !!(x && x.embed);
}

const AIR_WINDOW_DAYS = 30;

function airDate(ep){
  const twin = videoTwin(ep);
  if (!twin) return ep.date;

  const pod = new Date(ep.date).getTime();
  const vid = new Date(twin.date).getTime();
  if (!vid || isNaN(vid) || isNaN(pod)) return ep.date;
  if (vid >= pod) return ep.date;                              // already right
  if (pod - vid > AIR_WINDOW_DAYS * 86400000) return ep.date;  // a re-release

  return new Date(vid).toISOString();
}

let episodeCache;
function loadEpisodes(){
  if (episodeCache) return episodeCache;

  let list;
  try {
    list = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    console.warn('ΠΡΟΣΟΧΗ: το data/episodes.json δεν διαβάζεται —', err.message);
    return (episodeCache = []);
  }

  // Caching happens BEFORE the fix: airDate descends into videoTwin, and
  // without this a future path back to episodes would loop forever.
  episodeCache = list;

  for (const ep of list) {
    ep.slug = ep.headline;

    const fix = pairOf(ep);
    if (!fix) continue;

    if (fix.title) {
      const t = String(fix.title).trim();
      // Same "Name: topic" split as feed.js, so a corrected title yields
      // the same guest as the original.
      const m = t.match(/^([^:]{3,40}):\s*(.+)$/);
      const words = m ? m[1].trim().split(/\s+/) : [];

      ep.title = t;
      if (m && words.length >= 2 && words.length <= 4) {
        ep.guest = m[1].trim();
        ep.headline = m[2].trim();
      } else {
        ep.headline = t;
      }
    }

    if (fix.summary) ep.summary = String(fix.summary);
    if (fix.image) ep.image = String(fix.image);
  }

  valeProsopa([...list, ...videosOnce()]);

  for (const ep of list) {
    const when = airDate(ep);
    if (when === ep.date) continue;
    ep.published = ep.date;   // when the podcast went up, should it ever be needed
    ep.date = when;
  }

  list.sort((a, b) => new Date(b.date) - new Date(a.date));
  return episodeCache;
}

function showUrl(name){
  return `show/${slugify(name)}.html`;
}

function videoUrl(v){
  return `video/${v.id}-${slugify(v.title)}.html`;
}

function videoPage(v, category){
  const title = esc(decode(v.title));

  // The guest panel exists only when the title carries a name — in two
  // thirds of videos it does not.
  const gbox = videoGuestBox(v, 1);

  const cats = categoriesFor(v.id, v.title);

  // The twin episode, if any. When it exists the video page offers audio
  // too — same player, same "Βλέπω / Ακούω" switch, same behaviour as an
  // episode page.
  const twin = episodeTwin(v);

  const keimeno = (twin && twin.summary) || v.summary || '';

  const meta = [
    formatDate(v.date),
    twin ? formatDuration(twin.seconds) : '',
    ...cats.map((c) => `<a href="../${categoryUrl(c)}">${esc(c)}</a>`),
  ].filter(Boolean).join(' · ');

  const player = twin
    ? playerView({
      id: twin.id,
      src: twin.audio,
      title: decode(twin.headline),
      show: showLabel(v.show),
      art: twin.image || '',
      href: `../${episodeUrl(twin)}`,
    })
    : '';

  const toggle = twin
    ? `      <div class="modes">
        <button type="button" class="mode is-on" data-mode="video">Βλέπω</button>
        <button type="button" class="mode" data-mode="audio">Ακούω</button>
      </div>`
    : '';

  const queue = relatedVideos(v).map((x) => `      <a class="queue-row" href="${path.basename(videoUrl(x))}">
        ${x.image ? `<img src="${x.image}" alt="" loading="lazy">` : '<span class="queue-blank"></span>'}
        <span class="queue-text">
          <span class="queue-title">${esc(decode(x.title))}</span>
          <span class="queue-meta">${showLabel(x.show)} · ${formatDate(x.date)}</span>
        </span>
      </a>`).join('\n');

  const crumbs = [
    { label: 'Αρχική', href: 'index.html' },
    { label: showName(v.show), href: showUrl(v.show) },
    category ? { label: category, href: '' } : null,
    { label: decode(v.title) },
  ];

  const body = `${siteHeader(1)}

${breadcrumb(crumbs, 1)}

  <main class="episode" data-pagefind-body
        data-pagefind-meta="image:${v.image || ''},type:Βίντεο,date:${formatDate(v.date)}"
        data-pagefind-filter="Είδος:Βίντεο,Εκπομπή:${esc(showLabel(v.show))}${cats.map((c) => `,Κατηγορία:${esc(c)}`).join('')}">
    <div class="episode-grid">
      <div class="episode-main">
        <div class="stage-media" data-embed="${v.embed}">
          ${v.image ? `<img src="${v.image}" alt="" loading="lazy">` : ''}
          <button type="button" class="video-play" aria-label="Αναπαραγωγή">▶</button>
        </div>
${twin && twin.image ? `        <div class="stage-art" hidden>
          <img src="${twin.image}" alt="" loading="lazy">
        </div>` : ''}

${player}

        <div class="strip">
${toggle}
${twin ? '          <button type="button" class="act" data-player="speed">1×</button>' : ''}
          <button type="button" class="act act-save">+ Στη λίστα μου</button>
          <button type="button" class="act act-share">Κοινοποίηση</button>
${twin ? '          <span class="strip-note">Η θέση σου κρατιέται σε κάθε συσκευή</span>' : ''}
        </div>

        ${cats[0] ? `<p class="card-label">${esc(cats[0])}</p>` : ''}
        <h1 class="episode-title">${title}</h1>
        <p class="episode-meta">${meta}</p>
${/* THROUGH summaryHtml, never raw. With a plain esc() the hashtags and
     every Apple/Spotify/YouTube/facebook/twitter/instagram/TikTok link
     of Buzzsprout's tail arrived here — and as one slab at that, because
     the paragraphs were lost too. The episode page got this right from
     the start; the video page did not. */ ''}
${keimeno ? summaryHtml(keimeno) : ''}

        <p class="episode-links">
          <a href="${v.url}" target="_blank" rel="noopener">Άνοιγμα στο YouTube ↗</a>
          ${twin ? `<a href="../${episodeUrl(twin)}">Η σελίδα του επεισοδίου →</a>` : ''}
        </p>

${/* Below the video, the description and the links, and before "Next".
     That is, once the visitor has had what they came for and before the
     next thing is offered — the natural pause. NEVER higher up: the
     player sits at the top of this column. */ ''}
${adSlot('video-mid', 'leaderboard')}

        ${queue ? `<section class="queue">
          <h2 class="section-head">Επόμενο ${esc(showSe(showLabel(v.show)))}</h2>
${queue}
        </section>` : ''}
      </div>

      <aside class="episode-side">
${gbox}
${showBannerBox(v.show, 1)}

        <div class="side-box">
          <p class="side-head">Άκου ή δες όπου θέλεις</p>
          <nav class="platforms-links platforms-stack">
        ${platformsRow()}
          </nav>
        </div>
      </aside>
    </div>
  </main>`;

  return page({
    title: `${title} — ${SITE_NAME}`,
    body,
    depth: 1,
    description: keimeno ? clip(keimeno) : `${decode(v.title)} — ${v.show}`,
    image: v.image,
    url: videoUrl(v),
    type: 'article',
    // embedUrl points at YouTube, because that is where the video lives —
    // we do not host it. Duration comes from the twin episode when there
    // is one: same conversation, same length.
    jsonld: [
      {
        '@type': 'VideoObject',
        '@id': `${absUrl(videoUrl(v))}#video`,
        url: absUrl(videoUrl(v)),
        name: ldText(v.title),
        // stripBoilerplate here too: without it Google read the channel
        // boilerplate as the description.
        description: ldText(keimeno ? stripBoilerplate(keimeno) : v.title, 300),
        uploadDate: ldDate(v.date),
        thumbnailUrl: absAsset(v.image),
        embedUrl: v.embed || '',
        duration: twin ? ldDuration(twin.seconds) : '',
        inLanguage: 'el',
        keywords: cats.join(', '),
        publisher: LD_PUB,
      },
      ldCrumbs(crumbs),
    ],
  });
}

const AD_AFTER_PARAS = 3;
const AD_MIN_PARAS = 6;

function articleAdAt(body){
  if (body.filter((p) => p.type === 'p').length < AD_MIN_PARAS) return -1;

  let seen = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i].type !== 'p') continue;
    if (++seen < AD_AFTER_PARAS) continue;

    const next = body[i + 1];
    if (next && next.type === 'embed') continue;   // against the player, not this
    return i + 1;
  }
  return -1;
}

function articleBodyHtml(body){
  const adAt = articleAdAt(body);

  const parts = body.map((p) => {
    if (p.type === 'h') return `        <h2 class="art-sub">${esc(p.text)}</h2>`;
    if (p.type === 'p') return `        <p>${esc(p.text)}</p>`;

    if (p.type === 'image' && p.src) {
      return `        <figure class="art-inline">
          <img src="${esc(p.src)}" alt="${esc(p.alt || '')}" loading="lazy">
          ${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ''}
        </figure>`;
    }

    // Embeds accept an ID ONLY, never free HTML or a free URL: otherwise
    // the admin becomes a way to put someone else's script on the page.
    if (p.type === 'embed' && p.id) {
      if (p.kind === 'youtube' && /^[\w-]{6,20}$/.test(p.id)) {
        return `        <div class="art-embed stage-media" data-embed="https://www.youtube.com/embed/${esc(p.id)}">
          <img src="https://i.ytimg.com/vi/${esc(p.id)}/hqdefault.jpg" alt="" loading="lazy">
          <button type="button" class="video-play" aria-label="Αναπαραγωγή">▶</button>
        </div>`;
      }
      if (p.kind === 'episode') {
        const ep = episodeById(p.id);
        if (ep) {
          const card = `          <a class="art-embed-ep queue-row" href="../${episodeUrl(ep)}">
            ${ep.image ? `<img src="${ep.image}" alt="" loading="lazy">` : '<span class="queue-blank"></span>'}
            <span class="queue-text">
              <span class="queue-title">${esc(decode(ep.headline || ep.title))}</span>
              <span class="queue-meta">${['Επεισόδιο', formatDate(ep.date), formatDuration(ep.seconds)].filter(Boolean).join(' · ')}</span>
            </span>
          </a>`;

          if (p.play && ep.audio) {
            const show = episodeShow(ep);
            return `        <div class="art-embed-play">
${card}
${playerView({
              id: ep.id,
              src: ep.audio,
              title: decode(ep.headline || ep.title),
              show: show ? showLabel(show) : '',
              art: ep.image || '',
              href: `../${episodeUrl(ep)}`,
              indent: 10,
            })}
        </div>`;
          }

          return `        <div class="art-embed-play">\n${card}\n        </div>`;
        }
        console.warn(`ΠΡΟΣΟΧΗ: ενσωματωμένο επεισόδιο που δεν υπάρχει — ${p.id}`);
      }
    }

    return '';
  });

  // The position is measured against the ORIGINAL sections, not the
  // result: ones that render nothing (an embedded episode since deleted)
  // would move the ad somewhere other than where it was judged to go.
  const out = [];
  parts.forEach((html, i) => {
    if (html) out.push(html);
    if (i + 1 === adAt) out.push(adSlot('article-mid', 'leaderboard'));
  });

  return out.join('\n');
}

function articlePage(a, body, hasCat = false){
  const title = esc(a.title);
  const img = a.image_large || a.image_thumb || '';

  const text = articleBodyHtml(body);

  const words = body.reduce((n, p) => n + p.text.split(/\s+/).length, 0);
  const minutes = Math.max(1, Math.round(words / 200));

  const crumbs = [
    { label: 'Αρχική', href: 'index.html' },
    a.category ? { label: a.category, href: hasCat ? categoryUrl(a.category) : '' } : null,
    { label: a.title },
  ];

  const inner = `${siteHeader(1)}

${breadcrumb(crumbs, 1)}

  <main class="art" data-pagefind-body
        data-pagefind-meta="image:${img},type:Είδηση,date:${formatDate(a.date)}"
        data-pagefind-filter="Είδος:Είδηση${a.category ? `,Κατηγορία:${esc(a.category)}` : ''}">
    <article class="art-wrap">
      <header class="art-head">
        ${a.category ? `<p class="card-label">${esc(a.category)}</p>` : ''}
        <h1 class="art-title">${title}</h1>
        ${writerLine(a)}
        <p class="art-meta">${formatDate(a.date)} · ${minutes}′ ανάγνωση</p>

        <!-- The source goes BEFORE the text. The reader should know who
             wrote it before reading, not after. -->
        <p class="art-origin">
          Δημοσιεύτηκε πρώτα στο
          <a href="${a.url}" rel="noopener">newshub.gr</a>
        </p>
      </header>

${img ? `      <figure class="art-figure">
        <img src="${img}" alt="" width="765" height="435">
      </figure>` : ''}

      <div class="art-body">
${text}
      </div>

      <footer class="art-foot">
        <p class="art-foot-line">
          Ολόκληρο το άρθρο και η συνέχεια της είδησης στο
          <a class="art-source" href="${a.url}" rel="noopener">newshub.gr ↗</a>
        </p>
        ${hasCat ? `<p class="art-foot-more">
          <a href="../${categoryUrl(a.category)}">Περισσότερα: ${esc(a.category)} →</a>
        </p>` : ''}
      </footer>
    </article>

${/* At the end of the article, outside the reading column: whoever got
     here read what they came for. It is the second slot on the page — the
     first sits inside the text, much higher up. */ ''}
${adSlot('article-end', 'leaderboard')}
  </main>`;

  return page({
    title: `${title} — ${SITE_NAME}`,
    body: inner,
    depth: 1,
    description: a.summary || a.title,
    image: img,
    url: articleUrl(a),
    type: 'article',
    canonical: a.url,
  });
}

function writerUrl(name){
  return `arthrografos/${slugify(name)}.html`;
}

// Who wrote what. Published only — drafts do not exist here.
function writersFrom(ownArticles){
  const groups = new Map();

  for (const a of ownArticles) {
    const name = String(a.author || '').trim();
    if (!name) continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(a);
  }

  for (const list of groups.values()) {
    list.sort((x, y) => new Date(y.date) - new Date(x.date));
  }

  return groups;
}

function writerPage(name, list){
  const safe = esc(name);
  const cards = list.map((a) => card(itemFromOwnArticle(a), 1)).join('\n');

  const dates = list.map((a) => new Date(a.date).getTime()).filter((t) => !Number.isNaN(t));
  const facts = [
    list.length === 1 ? '1 άρθρο' : `${list.length} άρθρα`,
    dates.length ? `τελευταίο ${formatDate(new Date(Math.max(...dates)).toISOString())}` : '',
  ].filter(Boolean).join(' · ');

  // Their photo, if they also write for newshub.gr: the admin keeps
  // portraits in ONE place, and there is no reason to ask twice for the
  // same person.
  const face = writersFile()[name] || '';

  const body = `${siteHeader(1)}

${breadcrumb([
    { label: 'Αρχική', href: 'index.html' },
    { label: name },
  ], 1)}

  <main class="bio" data-pagefind-body
        data-pagefind-meta="image:${esc(face)},type:Δημοσιογράφος"
        data-pagefind-filter="Είδος:Δημοσιογράφος">
    <header class="bio-head${face ? ' bio-head--face' : ''}">
${face ? `      <span class="bio-face"><img src="${esc(face)}" alt="${safe}" loading="eager"></span>` : ''}
      <p class="page-label">Υπογράφει</p>
      <h1 class="bio-name">${safe}</h1>
      <p class="bio-facts">${facts}</p>
    </header>

    <section class="bio-work">
      <h2 class="section-head">${list.length === 1 ? 'Το άρθρο' : 'Όλα τα άρθρα'}</h2>
      <div class="grid bio-grid">
${cards}
      </div>
    </section>
  </main>`;

  return page({
    title: `${safe} — ${SITE_NAME}`,
    body,
    depth: 1,
    description: `${name}: ${facts} στο ${SITE_NAME}.`,
    image: face,
    url: writerUrl(name),
    // The page IS a person profile, and says so. The same @id their
    // articles reference: one person, one identity.
    jsonld: {
      '@type': 'ProfilePage',
      mainEntity: {
        '@type': 'Person',
        '@id': absUrl(writerUrl(name)),
        name,
        url: absUrl(writerUrl(name)),
        image: absAsset(face),
        jobTitle: 'Δημοσιογράφος',
        worksFor: LD_PUB,
      },
    },
  });
}

const SUMMARY_CHARS = 200;

function ownSummary(a){
  if (a.summary) return a.summary;

  const first = (a.body || []).find((p) => p && p.type !== 'image' && p.text);
  if (!first) return '';

  const text = String(first.text).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length <= SUMMARY_CHARS) return text;

  // Cut at a space, not mid-word.
  const cut = text.slice(0, SUMMARY_CHARS);
  return `${cut.slice(0, cut.lastIndexOf(' ')) || cut}…`;
}

function ownArticlePage(a, hasCat = false){
  const title = esc(a.title);

  const byline = [
    a.author ? `<a class="art-by" href="../${writerUrl(a.author)}">${esc(a.author)}</a>` : '',
    formatDate(a.date),
  ].filter(Boolean).join(' · ');

  const words = a.body.reduce((n, p) => n + String(p.text || '').split(/\s+/).length, 0);
  const minutes = Math.max(1, Math.round(words / 200));

  const crumbs = [
    { label: 'Αρχική', href: 'index.html' },
    a.category ? { label: a.category, href: hasCat ? categoryUrl(a.category) : '' } : null,
    { label: a.title },
  ];

  const inner = `${siteHeader(1)}

${breadcrumb(crumbs, 1)}

  <main class="art" data-pagefind-body
        data-pagefind-meta="image:${a.image || ''},type:Άρθρο,date:${formatDate(a.date)}"
        data-pagefind-filter="Είδος:Άρθρο${a.category ? `,Κατηγορία:${esc(a.category)}` : ''}">
    <article class="art-wrap">
      <header class="art-head">
        ${a.category ? `<p class="card-label">${esc(a.category)}</p>` : ''}
        <h1 class="art-title">${title}</h1>
        <p class="art-meta">${byline} · ${minutes}′ ανάγνωση</p>
      </header>

${a.image ? `      <figure class="art-figure">
        <img src="${esc(a.image)}" alt="${esc(a.imageAlt || '')}" loading="lazy">
        ${a.imageCaption ? `<figcaption>${esc(a.imageCaption)}</figcaption>` : ''}
      </figure>` : ''}

      <div class="art-body">
${articleBodyHtml(a.body)}
      </div>

      <footer class="art-foot">
        ${hasCat ? `<p class="art-foot-more">
          <a href="../${categoryUrl(a.category)}">Περισσότερα: ${esc(a.category)} →</a>
        </p>` : ''}
      </footer>
    </article>

${/* At the end of the article, outside the reading column: whoever got
     here read what they came for. It is the second slot on the page — the
     first sits inside the text, much higher up. */ ''}
${adSlot('article-end', 'leaderboard')}
  </main>`;

  return page({
    title: `${title} — ${SITE_NAME}`,
    body: inner,
    depth: 1,
    description: ownSummary(a) || a.title,
    image: a.image || '',
    url: ownArticleUrl(a),
    type: 'article',
    jsonld: [
      {
        '@type': 'NewsArticle',
        mainEntityOfPage: { '@type': 'WebPage', '@id': absUrl(ownArticleUrl(a)) },
        headline: ldText(a.title),
        description: ldText(ownSummary(a) || a.title, 300),
        image: a.image ? [absAsset(a.image)] : [],
        datePublished: ldDate(a.date),
        articleSection: a.category || '',
        inLanguage: 'el',
        // The author with THEIR OWN page: that ties their articles
        // together for Google instead of leaving a name as plain text.
        author: a.author ? {
          '@type': 'Person',
          name: a.author,
          url: absUrl(writerUrl(a.author)),
        } : null,
        publisher: LD_PUB,
      },
      ldCrumbs(crumbs),
    ],
  });
}

const CATEGORIES = [
  ['Agronews',    ['αγροτ', '~καλλιεργ', 'ελαιολαδ', 'αμπελ', '~κτηνοτροφ', 'γεωργ', '~φυτοφαρμακ', '~κτηνιατρ']],
  ['Tech-Hub',    ['τεχνολογ', 'ψηφιακ', 'τεχνητη νοημοσυν', 'διαδικτυ', 'λογισμικ', 'ρομποτ']],
  ['Αθλητικά',    ['~αθλητ', 'ποδοσφαιρ', 'μπασκετ', '~πρωταθλημ', '=οφη', 'παναθηναικ']],
  ['Υγεία',       ['υγεια', 'διατροφ', '~ανοσ', '~νοσοκομει', 'ιατρ', 'γιατρ', '~ψυχιατρ', 'ασθεν',
    'φαρμακ', 'παγνη', '~θεραπει', 'εμβολι', 'καρκιν', 'ψυχικ', 'ψυχολογ']],
  ['Περιβάλλον',  ['περιβαλλον', 'κλιματικ', 'ανακυκλωσ', '~ρυπανσ', '~σεισμ', 'οικοσυστημ',
    'πυρκαγι', '~πλημμυρ', 'σκουπιδ', 'απορριμ', 'νερο']],
  ['Πολιτισμός',  ['πολιτισμ', '~θεατρ', 'μουσικ', 'ταινι', 'μουσει', 'ποιητ', 'λογοτεχν',
    'βιβλι', 'συγγραφ', 'τραγουδ', 'φεστιβαλ']],
  ['Ιστορία',     ['ιστορι', '1821', 'βυζαντ', 'οθωμαν', 'αρχαι', 'κατοχη', '~εμφυλι', '~επανασταση',
    '1940', '1922', 'μικρασια', 'χουντα', 'δικτατορ', 'μακεδονικ', 'επος']],
  ['Γεωπολιτική', ['γεωπολιτικ', '~τουρκι', '=νατο', '~ισραηλ', '~ουκραν', '~αμυν', '~πολεμ', 'εξοπλισ',
    'ερντογαν', 'αιγαι', 'μεσ ανατολ', 'ορμουζ', 'χουθι', 'χαμας', 'γαζα', 'συρια', 'κυπριακ', 'πυραυλ']],
  ['Οικονομία',   ['οικονομ', 'γεωοικονομ', '~πληθωρισμ', 'επενδυσ', 'φορολογ', 'τραπεζ', '=αεπ', 'ενεργειακ',
    'επιχειρημ', 'συνταξ', 'αγορα', 'εμποριο', 'ακριβεια']],
  ['Πολιτική',    ['~κυβερνησ', 'βουλη', '~εκλογ', '~κομμα', '~υπουργ', 'πρωθυπουργ', 'συνταγμ',
    'πολιτικ', 'μητσοτακ', 'τσιπρα', 'συριζα', 'πασοκ', 'δημοκρατ', 'ακροδεξ', '~αριστερ',
    '~δημαρχ', '~περιφερειαρχ', 'αυτοδιοικησ']],
  ['Κρήτη',       ['~κρητ', 'ηρακλει', 'χανι', 'ρεθυμν', 'λασιθ']],
  ['Κόσμος',      ['διεθν', 'ευρωπ', '=ηπα', 'κινα', '~ρωσι', 'γερμανι', 'γαλλι', 'βρεταν',
    'τραμπ', 'πουτιν', 'αλβανι', 'σερβια', 'βαλκανι', '~αιγυπτ', 'ινδια']],
  ['Ελλάδα',      ['~ελλαδ', 'αθηνα', 'θεσσαλονικ']],
  ['Απόψεις',     []],   // by hand only — no words identify it
];

// The handwritten stem, compiled into a rule that checks fast. Done once
// at startup, not per title.
const CATEGORY_RULES = CATEGORIES.map(([name, roots]) => [
  name,
  roots.map((raw) => ({
    // Two words in sequence; the marker concerns the last one.
    parts: (raw[0] === '~' || raw[0] === '=' ? raw.slice(1) : raw).split(' '),
    pou: raw[0] === '~' ? 'mesa' : raw[0] === '=' ? 'oli' : 'arxi',
  })),
]);

// Does the stem appear inside any word of the title?
function rizaTairiazei(words, { parts, pou }){
  for (let i = 0; i + parts.length <= words.length; i++) {
    let ok = true;
    for (let j = 0; j < parts.length; j++) {
      const w = words[i + j];
      const p = parts[j];
      // In a multi-word phrase the middle words match on their start —
      // otherwise "Μέσης Ανατολής" would never match "μεσ ανατολ". The
      // marker applies to the last word only.
      const good = j < parts.length - 1 ? w.startsWith(p)
        : pou === 'oli' ? w === p
        : pou === 'mesa' ? w.includes(p)
        : w.startsWith(p);
      if (!good) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

const FEATURED_TOPICS = ['Κρήτη', 'Γεωπολιτική', 'Πολιτική', 'Ιστορία'];

const SPOTLIGHT_TOPICS = [
  ['Agronews', 'agro', 'Η γη της Κρήτης, από το χωράφι στην αγορά'],
  ['Tech-Hub', 'tech', 'Τεχνολογία, ψηφιακά και τεχνητή νοημοσύνη'],
];

// How many slots exist. Both are design limits, not technical ones: five
// rows turn the homepage into a catalogue, and a third framed section
// makes the tail of the page longer than its body.
const FEATURED_MAX = 4;
const SPOTLIGHT_MAX = 2;

// The subtitle of each framed section. A topic not listed here comes out
// without one — better nothing than wrong words.
const SPOTLIGHT_BLURB = Object.fromEntries(
  SPOTLIGHT_TOPICS.map(([name, , blurb]) => [name, blurb]),
);

// The 4 topics with a row. Whatever the admin chose, otherwise the list in
// the code.
function featuredTopics(){
  const picked = curation().featuredTopics;
  const names = Array.isArray(picked) && picked.length ? picked : FEATURED_TOPICS;
  return names.slice(0, FEATURED_MAX);
}

function spotlightTopics(){
  const picked = curation().spotlightTopics;
  const names = Array.isArray(picked) && picked.length
    ? picked
    : SPOTLIGHT_TOPICS.map(([name]) => name);

  const pano = new Set(featuredTopics().map(slugify));

  return names
    .filter((name) => !pano.has(slugify(name)))
    .slice(0, SPOTLIGHT_MAX)
    .map((name, i) => [name, i === 0 ? 'agro' : 'tech', SPOTLIGHT_BLURB[name] || '']);
}

function katWords(s){
  return String(s == null ? '' : s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zα-ω0-9]+/gi, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function moiazeiOnoma(s){
  const kommatia = String(s).split(/[\s\-–]+/).filter(Boolean);
  if (!kommatia.length || kommatia.length > 5) return false;
  return kommatia.every((w) => /^[Α-ΩΆΈΉΊΌΎΏA-Z][^\s]*$/.test(w));
}

function themaKeimeno(title, guest){
  const words = katWords(decode(title));

  // 1) An explicit name from the feed — we know it, we use it.
  if (guest) {
    const out = new Set(katWords(guest).filter((w) => w.length >= 4));
    if (out.size) return words.filter((w) => !out.has(w));
    return words;
  }

  // 2) Video: only "Name: topic", and only when it looks like a name.
  const raw = decode(title);
  const at = raw.indexOf(':');
  if (at > 0 && at <= 45 && moiazeiOnoma(raw.slice(0, at))) {
    return katWords(raw.slice(at + 1));
  }

  return words;
}

function suggestCategories(title, guest){
  const words = themaKeimeno(title, guest);
  return CATEGORY_RULES
    .filter(([, rules]) => rules.some((r) => rizaTairiazei(words, r)))
    .map(([name]) => name);
}

function categoryUrl(name){
  return `category/${slugify(name)}.html`;
}

// Read once and cached, like the weather.
let curationCache;
function curation(){
  if (curationCache === undefined) curationCache = loadCuration();
  return curationCache;
}

const catCache = new Map();

function categoriesFor(id, title, guest){
  if (catCache.has(id)) return catCache.get(id);

  const picked = curation().categories && curation().categories[id];
  const result = picked
    ? (Array.isArray(picked) ? picked : [picked])
    : suggestCategories(title, guest);

  catCache.set(id, result);
  return result;
}

let didimoKatigories;
function katigoriaApoDidimo(epId){
  if (!didimoKatigories) {
    didimoKatigories = {};
    const manual = curation().categories || {};

    for (const key of Object.keys(manual)) {
      const v = loadVideos().find((x) => x.id === key);
      if (!v) continue;                    // not a video; it is an episode
      const ep = episodeTwin(v);
      // Their own correction, where it exists, always wins.
      if (ep && !manual[ep.id]) didimoKatigories[ep.id] = manual[key];
    }
  }
  return didimoKatigories[epId];
}

// The episode knows who spoke — see themaKeimeno().
function episodeCategories(ep){
  const apoDidimo = katigoriaApoDidimo(ep.id);
  if (apoDidimo) return Array.isArray(apoDidimo) ? apoDidimo : [apoDidimo];

  return categoriesFor(ep.id, ep.title, ep.guest);
}

// Short names ONLY for the card label. In spaced capitals the full show
// name took three lines above every card. The show page keeps the full
// one.
const SHOW_SHORT = {
  'Συνεντεύξεις και πρόσωπα της επικαιρότητας': 'Συνεντεύξεις',
  'Αναλύσεις στο Newshub.gr': 'Αναλύσεις',
  'Ιστορία στο newshub.gr': 'Ιστορία',
  '25 μαθήματα για την ελληνική ιστορία': '25 μαθήματα',
  'Κοινωνία σε 1ο πρόσωπο': 'Κοινωνία',
  'Υγεία και Επιστήμες': 'Υγεία',
  'Αγροτική επικαιρότητα': 'Αγροτικά',
  'Ιστορίες του Ηρακλείου': 'Ιστορίες Ηρακλείου',
};

const SHOW_SE = {
  'Επικαιρότητα': 'στην Επικαιρότητα',
  'Συνεντεύξεις': 'στις Συνεντεύξεις',
  'Αναλύσεις': 'στις Αναλύσεις',
  'Αγροτικά': 'στα Αγροτικά',
  'Υγεία': 'στην Υγεία',
  'Παρασκήνιο': 'στο Παρασκήνιο',
  'Αφιερώματα': 'στα Αφιερώματα',
  'Ιστορία': 'στην Ιστορία',
  'Κοινωνία': 'στην Κοινωνία',
  '25 μαθήματα': 'στα 25 μαθήματα',
  'Επίκαιρα στο Newshub.gr': 'στα Επίκαιρα',
  'Αντίλογος στο Newshub.gr': 'στον Αντίλογο',
  'Ιστορίες Ηρακλείου': 'στις Ιστορίες Ηρακλείου',
  'Εξ Απορρήτων': 'στο «Εξ Απορρήτων»',
  'Τα μονοπάτια ιστορίας του Newshub.gr': 'στα Μονοπάτια ιστορίας',
};

function showSe(label){
  return SHOW_SE[label] || `από «${label}»`;
}

const SHOW_NAME = {
  'ΕΠΙΚΑΙΡΟΤΗΤΑ': 'Επικαιρότητα',
  'Αναλύσεις στο Newshub.gr': 'Αναλύσεις στο newshub.gr',
};

function showName(raw){
  return SHOW_NAME[raw] || raw;
}

const SHOW_ORDER = [
  'Συνεντεύξεις και πρόσωπα της επικαιρότητας',
  'Αναλύσεις στο Newshub.gr',
  'Επίκαιρα στο Newshub.gr',
  'Αντίλογος στο Newshub.gr',
  'Υγεία και Επιστήμες',
  'Παρασκήνιο',
  'Ιστορία στο newshub.gr',
  'Αφιερώματα',
  'Ιστορίες του Ηρακλείου',
  'Εξ Απορρήτων',
  'Τα μονοπάτια ιστορίας του Newshub.gr',
].map(slugify);

// Shows that do NOT appear in the lists. Their page is still built and old
// links still work — we just do not show it anywhere. One line brings it
// back.
const SHOW_HIDDEN = ['Αγροτική επικαιρότητα'].map(slugify);

function orderedShowKeys(groups){
  const rank = (k) => {
    const i = SHOW_ORDER.indexOf(k);
    return i === -1 ? SHOW_ORDER.length : i;
  };

  return Object.keys(groups)
    .filter((k) => !SHOW_HIDDEN.includes(k))
    .sort((a, b) => rank(a) - rank(b) || groups[b].items.length - groups[a].items.length);
}

function showLabel(name){
  return SHOW_SHORT[name] || showName(name);
}

// Title comparison key between YouTube and Buzzsprout: lowercase, no
// accents, no punctuation, first 60 letters. Loose enough to survive
// small differences, tight enough not to confuse episodes.
function matchKey(text){
  return decode(text).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zα-ω0-9]+/gi, ' ')
    .trim()
    .slice(0, 60);
}

function headKey(text){
  const m = decode(text).match(/^([^:]{3,40}):\s*(.+)$/);
  return matchKey(m ? m[2] : text);
}

let pairData;
function pairs(){
  if (pairData) return pairData;

  pairData = { byEpisode: {}, byVideo: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(PAIRS_FILE, 'utf8'));
    for (const [id, rec] of Object.entries((raw && raw.pairs) || {})) {
      if (!rec || typeof rec !== 'object') continue;
      pairData.byEpisode[id] = rec;
      // The reverse path: from video to episode. The video page needs it,
      // since it offers the twin's audio.
      if (rec.video) pairData.byVideo[rec.video] = id;
    }
  } catch (err) {
    // A corrupt file does not bring the build down — but it does NOT pass
    // unnoticed: it would silently erase every manual fix.
    if (err.code !== 'ENOENT') {
      console.warn('ΠΡΟΣΟΧΗ: το data/pairs.json δεν διαβάζεται —', err.message);
    }
  }
  return pairData;
}

function pairOf(ep){
  return (ep && pairs().byEpisode[ep.id]) || null;
}

function episodeKeys(ep){
  const fix = pairOf(ep);
  if (fix && (fix.video || fix.novideo)) return [];
  return [matchKey(ep.title), headKey(ep.title)];
}

// Which show an episode belongs to — learned from its video. Comparison
// key: no hash, no accents, no punctuation.
function tagKey(s){
  return String(decode(s)).replace(/^#/, '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zα-ω0-9]+/gi, '');
}

let showByTag;
function showFromTags(ep){
  if (!ep.keywords || !ep.keywords.length) return '';

  if (!showByTag) {
    showByTag = new Map();
    for (const v of loadVideos()) {
      if (!v.show) continue;
      showByTag.set(tagKey(v.show), v.show);           // the playlist's full name
      showByTag.set(tagKey(showLabel(v.show)), v.show); // and the short form
    }
  }

  for (const raw of ep.keywords) {
    const t = decode(raw).replace(/^#/, '').trim();

    // With an explicit marker we also accept the short form.
    const marked = t.match(/^εκπομπ[ήη]\s*[:\-–]\s*(.+)$/i);
    if (marked) {
      const hit = showByTag.get(tagKey(marked[1]));
      if (hit) return hit;
      continue;
    }

    // Without a marker, only a FULL playlist name match counts.
    for (const v of showByTag.values()) {
      if (tagKey(v) === tagKey(t)) return v;
    }
  }

  return '';
}

function episodeShow(ep){
  // First what the journalist declared, then what we work out ourselves.
  const tagged = showFromTags(ep);
  if (tagged) return tagged;

  const v = videoTwin(ep);
  return v ? v.show : '';
}

// One group per show, with videos AND episodes together. Where a video
// has a twin episode we keep the episode: it has a page of ours, so the
// visitor stays here instead of leaving for YouTube.
function buildShows(videos, episodes){
  const groups = {};
  for (const v of videos) {
    if (!v.show) continue;
    const key = slugify(v.show);
    if (!key) continue;
    if (!groups[key]) groups[key] = { name: v.show, items: [] };

    const twin = episodeTwin(v);
    groups[key].items.push(twin ? itemFromEpisode(twin) : itemFromVideo(v));
  }

  for (const key of Object.keys(groups)) {
    groups[key].items.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  return groups;
}

let artMap;
function showArtMap(){
  if (!artMap) {
    artMap = {};
    try {
      const raw = JSON.parse(fs.readFileSync(SHOW_ART_FILE, 'utf8'));
      for (const [show, v] of Object.entries(raw.art || {})) {
        artMap[matchKey(show)] = typeof v === 'string'
          ? { file: v, titled: true }
          : { file: v.file, url: v.url || '', titled: v.titled !== false };
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('ΠΡΟΣΟΧΗ: το data/show-art.json δεν διαβάζεται —', err.message);
      }
    }
  }
  return artMap;
}

// A show record, or null. matchKey flattens accents and case so
// "Newshub.gr" and "newshub.gr" land together.
function showArtOf(name){
  const m = showArtMap();
  return m[matchKey(showName(name))] || m[matchKey(name)] || null;
}

// The show image for the blurred backdrop at the top. Empty when there is
// no poster — the page then falls back to the episode cover.
function showHeroSrc(name){
  const art = showArtOf(name);
  if (!art) return '';
  // Absolute path for an uploaded one: /uploads/ is served from the root
  // and reads the same at any depth.
  if (art.url) return art.url;
  return art.file ? `../shows/${art.file}-800.webp` : '';
}

// Is the title baked into the image? Then we do not print it again.
function artIsTitled(name){
  const a = showArtOf(name);
  return !!(a && a.titled);
}

let showsInfo;
function showAbout(name){
  if (!showsInfo) {
    showsInfo = {};
    try {
      const raw = JSON.parse(fs.readFileSync(SHOWS_FILE, 'utf8'));
      for (const [show, v] of Object.entries(raw)) {
        if (v && v.description) showsInfo[matchKey(show)] = v.description;
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('ΠΡΟΣΟΧΗ: το data/shows.json δεν διαβάζεται —', err.message);
      }
    }
  }

  const text = showsInfo[matchKey(showName(name))] || showsInfo[matchKey(name)] || '';
  if (!text) return [];

  return text
    .split(/\s*https?:\/\//)[0]          // whatever follows a link goes
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    // YouTube writes both "Παρουσίαση" and "παρουσίαση". Capitalise the
    // first letter of each line — it is the start of a sentence.
    .map((line) => line.charAt(0).toLocaleUpperCase('el') + line.slice(1))
    .slice(0, 3);
}

const ART_MIN = 200;

const artSizeCache = new Map();
function webpSize(file){
  if (artSizeCache.has(file)) return artSizeCache.get(file);

  let size = null;
  try {
    const b = fs.readFileSync(path.join(PUBLIC_DIR, 'shows', file));
    const tag = b.toString('ascii', 12, 16);
    if (tag === 'VP8X') {
      size = { w: (b.readUIntLE(24, 3) & 0xffffff) + 1, h: (b.readUIntLE(27, 3) & 0xffffff) + 1 };
    } else if (tag === 'VP8 ') {
      size = { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    } else if (tag === 'VP8L') {
      const bits = b.readUInt32LE(21);
      size = { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`ΠΡΟΣΟΧΗ: το public/shows/${file} δεν διαβάζεται —`, err.message);
    }
  }

  artSizeCache.set(file, size);
  return size;
}

function showArtImg(name, { depth = 0, sizes, cls = '', eager = false, minWidth = 999 } = {}){
  if (minWidth < ART_MIN) return '';

  const art = showArtOf(name);
  if (!art) return '';

  const up = depth === 0 ? '' : '../';

  if (art.url) {
    return `<img${cls ? ` class="${cls}"` : ''} src="${esc(art.url)}"
            sizes="${sizes}" alt="${esc(showName(name))}"${eager ? '' : ' loading="lazy"'}>`;
  }

  if (!art.file) return '';

  const src = `${up}shows/${art.file}`;

  // The large file defines shape and ratio; -800/-400 are downsizes of the
  // same frame. If one is missing we leave it out of the srcset rather
  // than lie about its width.
  const full = webpSize(`${art.file}.webp`);
  const srcset = [
    [`${src}-400.webp`, webpSize(`${art.file}-400.webp`)],
    [`${src}-800.webp`, webpSize(`${art.file}-800.webp`)],
    [`${src}.webp`, full],
  ]
    .filter(([, s]) => s)
    .map(([url, s]) => `${url} ${s.w}w`)
    .join(', ');

  const dims = full ? ` width="${full.w}" height="${full.h}"` : '';

  return `<img${cls ? ` class="${cls}"` : ''} src="${src}-800.webp"
            srcset="${srcset}"
            sizes="${sizes}" alt="${esc(showName(name))}"${dims}${eager ? '' : ' loading="lazy"'}>`;
}

function showsSection(groups, depth = 0){
  const keys = orderedShowKeys(groups);
  if (!keys.length) return '';

  const up = depth === 0 ? '' : '../';
  const cards = orderedShowKeys(groups)
    .map((key) => {
      const g = groups[key];
      const latest = g.items[0];
      const count = g.items.length;

      // With its own poster the card does NOT print the title: it is
      // already in the image. Without one, a video still says nothing by
      // itself, so the name goes underneath.
      const art = showArtImg(g.name, {
        depth,
        cls: 'card-image show-cover',
        // Four columns at full width, two at medium, one on mobile.
        sizes: '(max-width: 560px) 90vw, (max-width: 1100px) 45vw, 23vw',
        // Measured: 256px at 1280, 290px at 390 — the narrowest is 256.
        minWidth: 256,
      });

      return `      <article class="show-card${art ? ' show-card--art' : ''}">
        <a class="card-link" href="${up}${showUrl(g.name)}">
          ${art || (latest && latest.image
            ? `<img class="card-image${isSquareArt(latest.image) ? ' show-cover' : ''}" src="${latest.image}" alt="" loading="lazy">`
            : '<div class="card-image card-image--empty"></div>')}
          <h3 class="show-name">${esc(showName(g.name))}</h3>
          <p class="card-meta">${count === 1 ? '1 επεισόδιο' : `${count.toLocaleString('el')} επεισόδια`}</p>
        </a>
      </article>`;
    }).join('\n');

  // Shows and platforms share ONE frame: both answer the same question —
  // what do I listen to, and where. Separated, people saw the shows and
  // reached the platforms three sections later.
  return `  <section class="spot spot--pod">
    <header class="spot-head spot-head--center">
      ${waveform()}
      <h2 class="spot-title">Οι εκπομπές του <img class="spot-title-logo" src="${up}shows/logo-inline.png" alt="Newshub Multimedia" width="1764" height="331" style="height: 3.2rem; max-height: 56px; width: auto; max-width: 300px; display: inline-block; vertical-align: middle; margin-left: 0.6rem; object-fit: contain;" loading="lazy"></h2>
      <p class="spot-sub">${keys.length} εκπομπές, νέο επεισόδιο σχεδόν κάθε μέρα</p>
      <a class="spot-all" href="${up}shows.html">Όλες οι εκπομπές →</a>
    </header>

    <div class="shows-grid">
${cards}
    </div>

    <div class="pod-platforms">
      <p class="pod-platforms-label">Σε όλες τις πλατφόρμες</p>
      <nav class="platforms-links">
        ${platformsRow()}
      </nav>
    </div>
  </section>`;
}

// The newshub.gr logo, made from letters and CSS instead of an image: it
// stays sharp on any screen, takes the size of the text around it, and is
// not one more file to download.
function nhLogo(){
  return `<span class="nh">news<b>hub</b><i>.gr</i></span>`;
}

// The microphone for the podcast section.
function micIcon(){
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
}

// ---- category pages ----

function buildCategories(videos, episodes, ownArticles = []){
  const groups = {};
  const seen = new Set();

  // An episode goes into ALL of its categories. seen only prevents the
  // same item appearing twice — not appearing under several topics.
  const add = (names, item, id) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const name of names) {
      const key = slugify(name);
      if (!key) continue;
      if (!groups[key]) groups[key] = { name, items: [] };
      groups[key].items.push(item);
    }
  };

  for (const ep of episodes) {
    add(episodeCategories(ep), itemFromEpisode(ep), ep.id);
  }

  for (const v of videos) {
    if (videoHasTwin(v)) continue;          // its podcast is already in
    add(categoriesFor(v.id, v.title), itemFromVideo(v), v.id);
  }

  for (const a of ownArticles) {
    if (!a.category) continue;
    add([a.category], itemFromOwnArticle(a), `arthro:${a.id}`);
  }

  for (const key of Object.keys(groups)) {
    groups[key].items.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  return groups;
}

// Is there an episode with the same title? Then the video is a duplicate.
let episodeTitles;
function videoHasTwin(v){
  // Explicit pairing: the video belongs to an episode whatever the title says.
  if (pairs().byVideo[v.id]) return true;

  if (!episodeTitles) {
    episodeTitles = new Set();
    for (const ep of loadEpisodes()) {
      for (const k of episodeKeys(ep)) if (k) episodeTitles.add(k);
    }
  }
  if (episodeTitles.has(matchKey(v.title)) || episodeTitles.has(headKey(v.title))) {
    return true;
  }
  return !!twinApoOnoma(v);
}

const TWIN_MERES = 10;     // how far apart the two dates may be
const TWIN_KOINES = 2;     // how many words the subjects must share
const TWIN_MIKOS = 5;      // how long a word must be to count

// The name before the colon, normalised.
function onomaApoTitlo(text){
  const m = decode(text).match(/^([^:]{3,40}):/);
  return m ? matchKey(m[1]) : '';
}

function kleidiArxikou(onoma){
  const lexeis = String(onoma).split(' ').filter(Boolean);
  if (lexeis.length < 2) return '';
  return `${lexeis[0][0]} ${lexeis[lexeis.length - 1]}`;
}

// The topic words — whatever follows the colon. Long ones only: "στη",
// "και", "του" are shared by every title in the world and prove nothing.
function themaLexeis(text){
  const m = decode(text).match(/^([^:]{3,40}):\s*(.+)$/);
  return new Set(
    matchKey(m ? m[2] : text).split(' ').filter((w) => w.length >= TWIN_MIKOS),
  );
}

let epsAnaOnoma;
let epsAnaArxiko;
function twinApoOnoma(v){
  if (!epsAnaOnoma) {
    epsAnaOnoma = {};
    epsAnaArxiko = {};
    for (const ep of loadEpisodes()) {
      // Where a human has spoken, we do not guess. "novideo" means "looked,
      // none exists" — and an explicit video means the episode is already
      // taken elsewhere.
      const fix = pairOf(ep);
      if (fix && (fix.video || fix.novideo)) continue;

      const n = onomaApoTitlo(ep.title);
      if (!n) continue;
      (epsAnaOnoma[n] = epsAnaOnoma[n] || []).push(ep);

      const s = kleidiArxikou(n);
      if (s) (epsAnaArxiko[s] = epsAnaArxiko[s] || []).push(ep);
    }
  }

  const onoma = onomaApoTitlo(v.title);
  if (!onoma) return null;

  // Exact name first. The initial is a FALLBACK, not an equal: "Κ.
  // Λουκόπουλος" matches "Κωνσταντίνος Λουκόπουλος" only when nobody
  // carries that exact name.
  const ypopsifia = epsAnaOnoma[onoma]
    || epsAnaArxiko[kleidiArxikou(onoma)]
    || null;
  if (!ypopsifia) return null;

  const pote = new Date(v.date).getTime();
  if (isNaN(pote)) return null;

  const dikes = themaLexeis(v.title);

  const tairiazoun = ypopsifia.filter((ep) => {
    if (Math.abs(new Date(ep.date).getTime() - pote) >= TWIN_MERES * 864e5) return false;

    const alles = themaLexeis(ep.title);
    let koines = 0;
    for (const w of dikes) if (alles.has(w)) koines++;
    return koines >= TWIN_KOINES;
  });

  // Two matches means we do not know. Better a duplicate than hiding the
  // wrong video — you can see a duplicate and fix it; you cannot see
  // something hidden.
  return tairiazoun.length === 1 ? tairiazoun[0] : null;
}

// The inverse of videoTwin: from a video, find the episode. Needed so the
// video page can also offer the audio — same player, position kept, like
// the episode page.
let episodeByKey;
function episodeTwin(v){
  if (!episodeByKey) {
    episodeByKey = { full: {}, head: {}, id: {} };
    for (const ep of loadEpisodes()) {
      episodeByKey.id[ep.id] = ep;
      const [a, b] = episodeKeys(ep);
      if (a && !episodeByKey.full[a]) episodeByKey.full[a] = ep;
      if (b && !episodeByKey.head[b]) episodeByKey.head[b] = ep;
    }
  }

  const fixed = pairs().byVideo[v.id];
  if (fixed) return episodeByKey.id[fixed] || null;

  return episodeByKey.full[matchKey(v.title)]
      || episodeByKey.head[headKey(v.title)]
      // Same rule as videoHasTwin, otherwise the video would be hidden
      // from the flow as "has a twin" while its page failed to offer that
      // twin's audio.
      || twinApoOnoma(v)
      || null;
}

// Related videos: same show, excluding itself. Ones with a twin episode
// are skipped — their own page shows those.
let videosByShow;
function relatedVideos(v, how = 6){
  if (!videosByShow) {
    videosByShow = {};
    for (const x of loadVideos()) {
      if (!x.show) continue;
      (videosByShow[x.show] = videosByShow[x.show] || []).push(x);
    }
    for (const k of Object.keys(videosByShow)) {
      videosByShow[k].sort((a, b) => new Date(b.date) - new Date(a.date));
    }
  }

  const seen = new Set([v.id]);
  return (videosByShow[v.show] || [])
    .filter((x) => !seen.has(x.id) && seen.add(x.id))
    .slice(0, how);
}

// ---- pagination ----

// Items per page. Κρήτη has 1,082 and ΕΠΙΚΑΙΡΟΤΗΤΑ 1,532 — unpaginated,
// 74% of topics and 86% of shows were unreachable while the homepage
// promised "all 1,082".
const PER_PAGE = 60;

// The FIRST page keeps the bare name. That way no existing URL changes
// and no link breaks.
function pagedName(base, n){
  return n <= 1 ? `${base}.html` : `${base}-${n}.html`;
}

function pageCount(total){
  return Math.max(1, Math.ceil(total / PER_PAGE));
}

let writes = 0;
function writeIfChanged(file, text){
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (current === text) return false;
  fs.writeFileSync(file, text, 'utf8');
  writes++;
  return true;
}

function sectionHead(kind, name, line, key){
  return `    <header class="sec-head" data-topic="${key}">
      <span class="sec-head-icon">${topicIcon(key)}</span>
      <div class="sec-head-text">
        <p class="sec-head-kind">${kind}</p>
        <h1 class="guest-name">${name}</h1>
        <p class="guest-count">${line}</p>
      </div>
    </header>`;
}

// The pager. Across 26 pages we do not list them all: first, last and the
// neighbourhood of the current one, with ellipses between.
function pager(base, page, pages){
  if (pages <= 1) return '';

  const link = (n, text, cls = '') =>
    `<a class="pg${cls ? ' ' + cls : ''}" href="${pagedName(base, n)}">${text}</a>`;

  const wanted = new Set([1, pages, page, page - 1, page + 1]);
  if (page <= 3) { wanted.add(2); wanted.add(3); }
  if (page >= pages - 2) { wanted.add(pages - 1); wanted.add(pages - 2); }

  const nums = [...wanted].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);

  let out = '';
  let last = 0;
  for (const n of nums) {
    if (n - last > 1) out += '<span class="pg-gap">…</span>';
    out += n === page
      ? `<span class="pg pg--on" aria-current="page">${n}</span>`
      : link(n, String(n));
    last = n;
  }

  return `    <nav class="pager" aria-label="Σελίδες">
      ${page > 1 ? link(page - 1, '← Προηγούμενη', 'pg--step') : '<span class="pg pg--step pg--off">← Προηγούμενη</span>'}
      <span class="pg-nums">${out}</span>
      ${page < pages ? link(page + 1, 'Επόμενη →', 'pg--step') : '<span class="pg pg--step pg--off">Επόμενη →</span>'}
    </nav>`;
}

// What we print above the cards so the visitor knows where they are.
function pageCountLine(total, n, pages){
  const word = total === 1 ? '1 επεισόδιο' : `${total.toLocaleString('el')} επεισόδια`;
  return pages <= 1 ? word : `${word} · σελίδα ${n} από ${pages}`;
}

function categoryPage(group, n = 1){
  const name = esc(group.name);
  const total = group.items.length;
  const pages = pageCount(total);
  const base = `${slugify(group.name)}`;

  const cards = cardsWithAds(
    group.items.slice((n - 1) * PER_PAGE, n * PER_PAGE).map((it) => card(inTopic(it, group.name), 1)),
    'category-list'
  );

  // The topic backdrop: the cover of its most recent item.
  const pic = group.items.find((it) => it.image);

  const body = `${siteHeader(1)}
${pageHero(pic ? pic.image : '')}

${breadcrumb([
    { label: 'Αρχική', href: 'index.html' },
    { label: 'Ενότητες', href: 'categories.html' },
    { label: group.name },
  ], 1)}

  <main class="guest">
${sectionHead('Ενότητα', name, pageCountLine(total, n, pages), base)}

    <div class="grid">
      ${cards}
    </div>
${pager(base, n, pages)}
  </main>`;

  return pagedShell({ name, body, base, n, pages, dir: 'category' });
}

function pagedShell({ name, body, base, n, pages, dir }){
  const suffix = n > 1 ? ` — σελίδα ${n}` : '';
  return page({
    title: `${name}${suffix} — ${SITE_NAME}`,
    body,
    depth: 1,
    url: `${dir}/${pagedName(base, n)}`,
    prev: n > 1 ? `${dir}/${pagedName(base, n - 1)}` : '',
    next: n < pages ? `${dir}/${pagedName(base, n + 1)}` : '',
  });
}

// The archive: every episode, page by page. The homepage link says "Όλα
// τα επεισόδια" and has to deliver exactly that.
// The month in genitive, for phrases like "από τον Δεκέμβριο 2021".
const MONTHS_OF = ['Ιανουάριο', 'Φεβρουάριο', 'Μάρτιο', 'Απρίλιο', 'Μάιο', 'Ιούνιο',
  'Ιούλιο', 'Αύγουστο', 'Σεπτέμβριο', 'Οκτώβριο', 'Νοέμβριο', 'Δεκέμβριο'];

function monthName(iso){
  const d = new Date(iso);
  const a = athens(d);
  return a ? MONTHS_OF[a.month] : '';
}

// Nominative, for headings inside the archive: "Οκτώβριος 2026".
const MONTHS_NOM = ['Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος',
  'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος'];

// Which page each year starts on. The archive runs newest to oldest, so
// the first appearance of a year also gives its page.
function yearJumps(episodes){
  const seen = new Map();
  episodes.forEach((ep, i) => {
    const y = athensYear(ep.date);
    if (!isNaN(y) && !seen.has(y)) seen.set(y, Math.floor(i / PER_PAGE) + 1);
  });
  return [...seen.entries()].sort((a, b) => b[0] - a[0]);
}

function episodesPage(episodes, n = 1){
  const total = episodes.length;
  const pages = pageCount(total);

  // A heading card every time the month changes. Without it the archive is
  // 18 pages of identical cards and you lose any sense of where you are in
  // time.
  const slice = episodes.slice((n - 1) * PER_PAGE, n * PER_PAGE);

  let lastMonth = '';
  const rows = slice.map((ep) => {
    const d = new Date(ep.date);
    const a = athens(d);
    const key = a ? `${a.year}-${a.month}` : '';

    let head = '';
    if (key && key !== lastMonth) {
      lastMonth = key;
      head = `      <h2 class="arch-month">${MONTHS_NOM[a.month]} ${a.year}</h2>\n`;
    }

    return head + episodeCard(ep);
  });

  const cards = cardsWithAds(rows, 'archive-list');

  const jumps = yearJumps(episodes).map(([year, page]) =>
    `      <a class="arch-year${page === n ? ' is-on' : ''}" href="${pagedName('episodes', page)}">${year}</a>`,
  ).join('\n');

  // The size of the archive IS the identity of the page, so it becomes its
  // graphic: the number large, with the hours and the starting year
  // beside it.
  const hours = Math.round(episodes.reduce((s, ep) => s + (ep.seconds || 0), 0) / 3600);
  const oldest = episodes.length ? episodes[episodes.length - 1].date : '';

  const body = `${siteHeader()}

${breadcrumb([
    { label: 'Αρχική', href: 'index.html' },
    { label: 'Όλα τα επεισόδια' },
  ], 0)}

  <header class="arch-open">
    <p class="arch-big" data-countup="${total}">${total.toLocaleString('el')}</p>
    <p class="arch-unit">Επεισόδια</p>
    <h1 class="arch-title">Όλα τα podcasts του ${nhLogo()}</h1>
    <p class="arch-note">${hours.toLocaleString('el')} ώρες ακρόασης${oldest ? ` · από τον ${monthName(oldest)} ${athensYear(oldest)}` : ''}</p>
  </header>

  <main class="arch">
    <nav class="arch-years" aria-label="Χρονιές">
      <span class="arch-years-label">Πήγαινε στο</span>
${jumps}
    </nav>

    <p class="arch-page">${pageCountLine(total, n, pages)}</p>

    <div class="grid">
${cards}
    </div>
${pager('episodes', n, pages)}
  </main>`;

  const suffix = n > 1 ? ` — σελίδα ${n}` : '';
  return page({
    title: `Όλα τα επεισόδια${suffix} — ${SITE_NAME}`,
    body,
    url: pagedName('episodes', n),
    prev: n > 1 ? pagedName('episodes', n - 1) : '',
    next: n < pages ? pagedName('episodes', n + 1) : '',
  });
}

// The all-topics page. Empty ones are shown too, so it is visible what is
// missing and where to work.
// How many topics get a large card with an image at the top.
const TOPICS_LEAD = 4;

// How many titles each topic column shows further down.
const TOPICS_PEEK = 3;

function categoriesIndexPage(groups){
  const live = CATEGORIES
    .map(([name]) => ({ name, key: slugify(name), g: groups[slugify(name)] }))
    .filter((c) => c.g && c.g.items.length)
    .map((c) => ({ ...c, n: c.g.items.length }))
    .sort((a, b) => b.n - a.n);

  const lead = live.slice(0, TOPICS_LEAD);
  const rest = live.slice(TOPICS_LEAD);

  const used = new Set();
  const leadCards = lead.map(({ name, key, g, n }) => {
    const pic = g.items.find((it) => it.image && !used.has(it.image))
      || g.items.find((it) => it.image);
    if (pic) used.add(pic.image);
    return `      <a class="tcard" href="${categoryUrl(name)}" style="--tint: var(--t-${key}, var(--t-default))">
        <span class="tcard-media">
          ${pic ? `<img src="${pic.image}" alt="" loading="lazy">` : ''}
        </span>
        <span class="tcard-text">
          <span class="tcard-icon">${topicIcon(key)}</span>
          <span class="tcard-name">${esc(name)}</span>
          <span class="tcard-n">${n.toLocaleString('el')}</span>
        </span>
      </a>`;
  }).join('\n');

  const restCols = rest.map(({ name, key, g, n }) => {
    const rows = g.items.slice(0, TOPICS_PEEK).map((it) => `          <a class="tcol-row" href="${it.href}">
            <span class="tcol-title">${esc(it.title)}</span>
            <span class="tcol-meta">${it.meta}</span>
          </a>`).join('\n');

    return `      <section class="tcol" style="--tint: var(--t-${key}, var(--t-default))">
        <a class="tcol-head" href="${categoryUrl(name)}">
          <span class="tcol-icon">${topicIcon(key)}</span>
          <h3 class="tcol-name">${esc(name)}</h3>
          <span class="tcol-n">${n.toLocaleString('el')}</span>
        </a>
${rows}
        <a class="tcol-all" href="${categoryUrl(name)}">Όλα τα ${n.toLocaleString('el')} →</a>
      </section>`;
  }).join('\n\n');

  const total = Object.values(groups).reduce((s, g) => s + g.items.length, 0);

  const body = `${siteHeader()}

  <main class="guest">
    <p class="page-label">Ενότητες</p>
    <h1 class="guest-name">Οι ενότητές μας</h1>
    <p class="guest-count">${live.length} ενότητες · ${total.toLocaleString('el')} κομμάτια ταξινομημένα</p>

    <div class="tcard-grid">
${leadCards}
    </div>
${rest.length ? `
    <section class="tlist">
      <h2 class="section-head">Και οι υπόλοιπες ενότητες</h2>
      <div class="tlist-grid">
${restCols}
      </div>
    </section>` : ''}
  </main>`;

  return page({
    title: 'Οι ενότητές μας — Newshub Media',
    body,
    description: `Οι ${live.length} ενότητες του Newshub Media: ${live.slice(0, 6).map((c) => c.name).join(', ')} και άλλα.`,
    url: 'categories.html',
  });
}

// ---- topics on the homepage ----

function topicStrip(groups){
  const keys = Object.keys(groups)
    .filter((k) => groups[k].items.length)
    .sort((a, b) => groups[b].items.length - groups[a].items.length);

  if (!keys.length) return '';

  const chips = keys.map((key) => {
    const g = groups[key];
    const n = g.items.length.toLocaleString('el');
    return `        <a class="topic" href="${categoryUrl(g.name)}" data-topic="${key}" data-name="${esc(g.name)}" data-count="${n}">${esc(g.name)}</a>`;
  }).join('\n');

  return `  <nav class="topics" aria-label="Φίλτρα θεμάτων">
    <div class="topics-list">
        <a class="topic is-on" href="categories.html" data-topic="all">Όλα</a>
${chips}
    </div>
  </nav>`;
}

// Each topic's icon, as newshub.gr does. A topic without one gets the
// plain mark — nothing breaks.
const TOPIC_ICONS = {
  kriti:       '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="10" r="2.4" fill="currentColor"/>',
  geopolitiki: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 12h17M12 3.5c2.6 2.6 2.6 14.4 0 17M12 3.5c-2.6 2.6-2.6 14.4 0 17" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  agronews:    '<path d="M5 20c0-8 5-14.2 14.5-15C20 15 14 20 5 20z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M5 20C8 15.5 12 11.5 17 8.5" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  istoria:     '<path d="M4 20h16M6.5 20V9M10 20V9M14 20V9M17.5 20V9M3.5 9h17L12 4.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  ygeia:       '<path d="M12 20s-7-4.6-7-9.5A4 4 0 0 1 12 7a4 4 0 0 1 7 3.5c0 4.9-7 9.5-7 9.5z" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  politismos:  '<circle cx="9" cy="17" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M11.6 17V6l7-1.5V15" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="16" cy="15" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  'tech-hub':  '<rect x="7" y="7" width="10" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M10 7V4M14 7V4M10 20v-3M14 20v-3M7 10H4M7 14H4M20 10h-3M20 14h-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  oikonomia:   '<path d="M4 18l5-5 3.5 3L20 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 8h5v5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  athlitika:   '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 3.5c3 3 3 14 0 17M3.6 9.5c5 2 11.8 2 16.8 0M3.6 14.5c5-2 11.8-2 16.8 0" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  perivallon:  '<path d="M12 21V11M12 11c0-4 3-6.5 7-6.5 0 4.5-3 6.5-7 6.5zM12 14c0-3-2.4-5-5.5-5 0 3.5 2.4 5 5.5 5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  kosmos:      '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 12h17M12 3.5c2.6 2.6 2.6 14.4 0 17M12 3.5c-2.6 2.6-2.6 14.4 0 17" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  ellada:      '<path d="M4 20h16M6 20V9M10 20V9M14 20V9M18 20V9M4.5 9h15L12 4.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  politiki:    '<path d="M12 3.5v17M5 8l7-3 7 3M5 8l-1.5 5a3.2 3.2 0 0 0 6.4 0zM19 8l1.5 5a3.2 3.2 0 0 1-6.4 0z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M7.5 20.5h9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
};

function topicIcon(key){
  const glyph = TOPIC_ICONS[key] || '<circle cx="12" cy="12" r="4.5" fill="currentColor"/>';
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${glyph}</svg>`;
}

const TOPIC_ROW = 4;

// How many cards of each topic hide inside the homepage flow, so
// filtering always has something to show.
const FLOW_PER_TOPIC = 6;

// How many show in the "Τελευταία" flow before "Όλα τα επεισόδια →".
// Admin pins take slots INSIDE that count.
const FLOW_VISIBLE = 9;

const FLOW_SKIP_SHOWS = new Set(['ΕΠΙΚΑΙΡΟΤΗΤΑ']);

const homeCache = new Map();
function homeItems(group){
  const key = slugify(group.name);
  if (homeCache.has(key)) return homeCache.get(key);

  const all = (curation().categoryPicks || {})[key];
  const picks = Array.isArray(all) ? freshPins('topics', all, `cat:${key}`) : null;

  // What was removed with the ✕ from THIS topic. A separate key per topic,
  // like the pins: the same episode can miss out in "Κρήτη" and deserve a
  // place in "Οικονομία".
  const kryfoTh = kryfa('topics', `cat:${key}`);
  let out = group.items.filter((it) => !kryfoTh(it));

  if (Array.isArray(picks) && picks.length) {
    // Anything not found is ignored silently: a pinned episode may have
    // changed category or been deleted, and that is no reason to leave a
    // slot empty — the next automatic pick fills it.
    const taken = new Set();
    const first = [];

    // A pinned item is searched across the WHOLE topic, not the filtered
    // one: if someone removed it and then pinned it, they mean it.
    for (const ref of picks) {
      const refs = refsDidimou(ref);
      const hit = group.items.find((it) => !taken.has(it) && sameOrTwin(it, refs));
      if (hit) { taken.add(hit); first.push(hit); }
      else console.warn(`ΠΡΟΣΟΧΗ: το καρφιτσωμένο «${ref}» δεν είναι στο θέμα «${group.name}»`);
    }

    out = first.concat(out.filter((it) => !taken.has(it)));
  }

  homeCache.set(key, out);
  return out;
}

// One row for one topic: name, its most recent cards, and the way to the
// rest.
function topicRow(group){
  const key = slugify(group.name);
  const total = group.items.length;

  // One large and three small, rather than four identical in a row: the
  // most recent item gets real space and the section gains hierarchy.
  const items = homeItems(group).slice(0, TOPIC_ROW);
  const lead = items[0];
  const rest = items.slice(1);

  // The whole bar is the link — a large target, so on mobile nobody has to
  // hit a small "Όλα".
  return `  <section class="topic-row" data-topic="${key}">
    <a class="topic-bar" href="${categoryUrl(group.name)}">
      <span class="topic-bar-icon">${topicIcon(key)}</span>
      <h2 class="topic-bar-name">${esc(group.name)}</h2>
      <span class="topic-bar-all">Όλα τα ${total.toLocaleString('el')} →</span>
    </a>
    <div class="topic-split">
${lead ? card({ ...inTopic(lead, group.name), lead: true }) : ''}

      <div class="topic-side">
${rest.map((it) => rowCard(inTopic(it, group.name))).join('\n')}
      </div>
    </div>
  </section>`;
}

// The four rows together. A topic with no content yet is simply skipped —
// we do not leave an empty row on the page.
function topicRows(groups){
  return featuredTopics()
    .map((name) => groups[slugify(name)])
    .filter((g) => g && g.items.length)
    .map((g) => topicRow(g))
    .join('\n\n');
}

function spotlightSections(groups){
  return spotlightTopics()
    .map(([name, variant, blurb]) => ({ g: groups[slugify(name)], variant, blurb, key: slugify(name) }))
    .filter((x) => x.g && x.g.items.length)
    .map(({ g, variant, blurb, key }) => {
      const total = g.items.length;
      const cards = homeItems(g).slice(0, SPOTLIGHT_CARDS).map((it) => card(inTopic(it, g.name))).join('\n');


      return `  <section class="spot spot--${variant}" data-topic="${key}">
    <header class="spot-head">
      <span class="spot-icon">${topicIcon(key)}</span>
      <div class="spot-text">
        <h2 class="spot-title">${esc(g.name)}</h2>
${blurb ? `        <p class="spot-sub">${esc(blurb)}</p>` : ''}
      </div>
      <a class="spot-all" href="${categoryUrl(g.name)}">Όλα τα ${total.toLocaleString('el')} →</a>
    </header>

    <div class="grid grid--3">
${cards}
    </div>
  </section>`;
    })
    .join('\n\n');
}

const SPOTLIGHT_CARDS = 3;

function bandMark(first, second, sub, depth = 0){
  const up = depth === 0 ? '' : '../';

  return `    <div class="band-head">
      <p class="mark">
        <img class="mark-sign" src="${up}shows/logo-icon.png" alt="" aria-hidden="true" width="512" height="512" loading="lazy">
        <span class="mark-dot"></span>
        <span class="mark-word">${first}<em>${second}</em></span>
      </p>
${sub}
    </div>`;
}

// How many cards the small section of each topic shows.
const MORE_CARDS = 2;

// Topics that did not get a row. Each gets a small space of its own: name,
// count, and its three most recent titles. A bare name with a number tells
// nobody what is inside.
function moreTopics(groups){
  const used = new Set([
    ...featuredTopics().map(slugify),
    ...spotlightTopics().map(([name]) => slugify(name)),
  ]);

  const rest = Object.keys(groups)
    .filter((k) => groups[k].items.length && !used.has(k))
    .sort((a, b) => groups[b].items.length - groups[a].items.length);

  if (!rest.length) return '';

  // Every topic gets a proper small section: same heading as the large
  // rows, just smaller, with its own cards.
  const blocks = rest.map((key) => {
    const g = groups[key];
    const cards = homeItems(g).slice(0, MORE_CARDS).map((it) => card(inTopic(it, g.name))).join('\n');

    return `      <section class="more-topic" data-topic="${key}">
        <a class="topic-bar topic-bar--sm" href="${categoryUrl(g.name)}">
          <span class="topic-bar-icon">${topicIcon(key)}</span>
          <h3 class="topic-bar-name">${esc(g.name)}</h3>
          <span class="topic-bar-all">Όλα τα ${g.items.length.toLocaleString('el')} →</span>
        </a>
        <div class="grid grid--2">
${cards}
        </div>
      </section>`;
  }).join('\n');

  return `  <section class="band band--more">
    <div class="band-open">
      <h2 class="band-open-title">Και ακόμα</h2>
    </div>

    <div class="more-grid">
${blocks}
    </div>
  </section>`;
}

function showStats(g){
  const dates = g.items.map((it) => new Date(it.date))
    .filter((d) => !isNaN(d))
    .sort((a, b) => a - b);

  if (!dates.length) return null;

  const first = dates[0];
  const last = dates[dates.length - 1];
  const now = new Date();

  const firstMonth = new Date(first.getFullYear(), first.getMonth(), 1);

  const bars = [];
  let aliveMonths = 0;
  for (let i = 11; i >= 0; i--) {
    const from = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const to = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    bars.push(dates.filter((d) => d >= from && d < to).length);
    if (from >= firstMonth) aliveMonths++;
  }

  aliveMonths = Math.max(1, aliveMonths);
  const inWindow = bars.reduce((a, b) => a + b, 0);
  const activeMonths = bars.filter((n) => n > 0).length;

  return {
    bars,
    aliveMonths,
    activeMonths,
    // How often it publishes, relative to how long it has existed.
    steadiness: activeMonths / aliveMonths,
    fromYear: first.getFullYear(),
    perMonth: inWindow / aliveMonths,
  };
}

// The rhythm strip. Heights are relative to the busiest month of the SAME
// show — otherwise ΕΠΙΚΑΙΡΟΤΗΤΑ with 18 a month would visually flatten
// Ιστορία with 2, though both publish steadily.
function sparkline(bars){
  const top = Math.max(...bars, 1);
  const cells = bars.map((n) => `<i style="--h:${(n / top).toFixed(2)}"${n ? '' : ' class="is-off"'}></i>`).join('');
  return `<span class="spark" aria-hidden="true">${cells}</span>`;
}

// Waveform for the shows page heading. The heights are fixed and written
// here — not random — so the page builds identically every time and does
// not churn in the repository.
const WAVE = [3, 6, 11, 7, 14, 9, 18, 12, 22, 15, 26, 17, 30, 20, 34, 24,
  30, 18, 26, 14, 22, 11, 18, 9, 14, 7, 11, 5, 8, 4];

function waveform(){
  const bars = WAVE.map((h, i) =>
    `<rect x="${i * 6}" y="${36 - h}" width="3" height="${h}" rx="1.5" opacity="${(0.25 + (h / 34) * 0.75).toFixed(2)}"/>`,
  ).join('');

  return `<svg class="shows-wave" viewBox="0 0 ${WAVE.length * 6} 36" aria-hidden="true" fill="currentColor">${bars}</svg>`;
}

function rateLine(s){
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const rate = s.perMonth >= 1
    ? `${plural(Math.round(s.perMonth), 'επεισόδιο', 'επεισόδια')} τον μήνα`
    : `${plural(Math.max(1, Math.round(s.perMonth * 12)), 'επεισόδιο', 'επεισόδια')} τον χρόνο`;

  return `Από το ${s.fromYear} · περίπου ${rate}`;
}

function showsIndexPage(groups){
  const keys = orderedShowKeys(groups);

  const total = keys.reduce((sum, k) => sum + groups[k].items.length, 0);

  const cards = keys.map((key) => {
    const g = groups[key];
    const latest = g.items[0];
    const n = g.items.length;
    const s = showStats(g);

    return `      <article class="show-tile">
        <a class="show-tile-art" href="${showUrl(g.name)}">
          ${showArtImg(g.name, { cls: 'show-cover', sizes: '(max-width: 760px) 92vw, 30vw', minWidth: 360 })
            || (latest && latest.image
              ? `<img${isSquareArt(latest.image) ? ' class="show-cover"' : ''} src="${latest.image}" alt="" loading="lazy">`
              : '<span class="show-tile-blank"></span>')}
        </a>

        <div class="show-tile-text">
          <h3 class="show-tile-name"><a href="${showUrl(g.name)}">${esc(showName(g.name))}</a></h3>

          <p class="show-tile-meta">
            <span class="show-tile-count">${n === 1 ? '1 επεισόδιο' : `${n.toLocaleString('el')} επεισόδια`}</span>
            ${s ? sparkline(s.bars) : ''}
          </p>

          ${latest ? `<a class="show-latest" href="${showUrl(g.name)}">
            <span class="show-latest-label">Τελευταίο · ${formatDate(latest.date)}</span>
            <span class="show-latest-title">${esc(latest.title)}</span>
          </a>` : ''}
        </div>
      </article>`;
  }).join('\n');

  const body = `${siteHeader()}

${breadcrumb([
    { label: 'Αρχική', href: 'index.html' },
    { label: 'Εκπομπές' },
  ], 0)}

  <header class="shows-open">
    ${waveform()}
    <h1 class="shows-open-title">Εκπομπές</h1>
    <p class="shows-open-by"><img class="shows-open-logo" src="shows/logo-full-dark.png" alt="Newshub Multimedia" width="1920" height="640" loading="lazy"></p>
    <p class="shows-open-count">${keys.length} εκπομπές · ${total.toLocaleString('el')} επεισόδια σε ήχο και βίντεο</p>
  </header>

  <div class="shows-tiles">
${cards}
  </div>

  <section class="shows-platforms">
    <span class="shows-platforms-icon">${micIcon()}</span>
    <h2 class="shows-platforms-title">Άκου τα παντού</h2>
    <p class="shows-platforms-note">Τα podcasts μας σε κάθε πλατφόρμα — διάλεξε τη δική σου</p>
    <nav class="platforms-links">
      ${platformsRow()}
    </nav>
  </section>`;

  return page({
    title: `Οι εκπομπές μας — ${SITE_NAME}`,
    body,
    url: 'shows.html',
    description: `Οι ${keys.length} εκπομπές του newshub.gr — ${total.toLocaleString('el')} επεισόδια σε ήχο και βίντεο.`,
  });
}

function showPage(group, n = 1){
  const name = esc(showName(group.name));
  const total = group.items.length;
  const pages = pageCount(total);
  const base = `${slugify(group.name)}`;

  const page = group.items.slice((n - 1) * PER_PAGE, n * PER_PAGE);
  const cards = cardsWithAds(page.map((it) => card(it, 1)), 'show-list');

  // Shows that live on YouTube produce a page of videos only, so their
  // thumbnails can fill a 16:9 frame.
  const wide = allVideo(page) ? ' grid--wide' : '';

  const art = showArtImg(group.name, {
    depth: 1,
    // The class is NOT decorative: it sets contain and height:auto.
    // Without it the height="900" attribute crops the poster.
    cls: 'show-cover',
    // The poster width, locked by CSS — see .show-head-art.
    sizes: '(max-width: 760px) 96vw, 840px',
    eager: true,
    minWidth: 360,
  });
  const pic = group.items.find((it) => it.image);
  const titled = art && artIsTitled(group.name);
  const about = showAbout(group.name);

  const head = art
    ? `    <header class="show-head">
      <div class="show-head-art">${art}</div>
      <div class="show-head-text">
        <p class="page-label">Εκπομπή</p>\n        <h1 class="show-head-name">${name}</h1>
        ${about.map((line, i) => i === 0
          ? `<p class="show-about">${esc(clip(line, 260))}</p>`
          : `<p class="show-credit">${esc(clip(line, 120))}</p>`).join('\n        ')}
        <p class="show-head-line">${pageCountLine(total, n, pages)}</p>
      </div>
    </header>`
    : sectionHead('Εκπομπή', name, pageCountLine(total, n, pages), base);

  const body = `${siteHeader(1)}
${pageHero(showHeroSrc(group.name) || (pic ? pic.image : ''))}

${breadcrumb([
    { label: 'Αρχική', href: 'index.html' },
    { label: 'Εκπομπές', href: 'shows.html' },
    { label: showName(group.name) },
  ], 1)}

  <main class="guest">
${head}

    <div class="grid${wide}">
      ${cards}
    </div>
${pager(base, n, pages)}
  </main>`;

  return pagedShell({ name, body, base, n, pages, dir: 'show' });
}

const DARK = 'var(--bg)';
const PLATFORMS = [
  ['YouTube', 'https://www.youtube.com/@newshubgr/podcasts', '#FF0000',
    `<path d="M21.6 7.2c-.2-.9-.9-1.6-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4c-.9.2-1.6.9-1.8 1.8C2 8.8 2 12 2 12s0 3.2.4 4.8c.2.9.9 1.6 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4c.9-.2 1.6-.9 1.8-1.8.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15V9l5.2 3z" fill="currentColor"/>`],

  ['Spotify', 'https://open.spotify.com/show/1W9rhtqzGlbfs8xGWNK7gN', '#1DB954',
    `<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7 9.4c3.3-.9 6.8-.6 9.5 1M7.6 12.6c2.8-.7 5.8-.4 8.1.9M8.3 15.6c2.2-.5 4.5-.3 6.3.7" stroke="${DARK}" stroke-width="1.5" fill="none" stroke-linecap="round"/>`],

  ['Apple Podcasts', 'https://podcasts.apple.com/gr/podcast/%CF%84%CE%B1-podcast-%CF%84%CE%BF%CF%85-newshub-gr/id1601368308?l=el', '#9933CC',
    `<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M12 7a2 2 0 0 1 2 2v2.6a2 2 0 1 1-4 0V9a2 2 0 0 1 2-2zm-3.6 5a.8.8 0 0 1 .8.8 2.8 2.8 0 0 0 5.6 0 .8.8 0 1 1 1.6 0 4.4 4.4 0 0 1-3.6 4.3v1.2a.8.8 0 1 1-1.6 0v-1.2A4.4 4.4 0 0 1 7.6 12.8a.8.8 0 0 1 .8-.8z" fill="${DARK}"/>`],

  ['Pocket Casts', 'https://pocketcasts.com/podcast/%CF%84%CE%B1-podcasts-%CF%84%CE%BF%CF%85-newshubgr/ee0a5f70-401d-013a-d681-0acc26574db2', '#F43E37',
    `<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M12 6.6a5.4 5.4 0 1 0 5.4 5.4h-1.9A3.5 3.5 0 1 1 12 8.5z" fill="${DARK}"/><path d="M10.6 9.9l3.8 2.1-3.8 2.1z" fill="${DARK}"/>`],

  ['Audible', 'https://www.audible.com/podcast/podcasts-newshubgr/B08K57X52T', '#F8991C',
    `<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M6.5 12h1.8l1.6-3.4 2 7 1.8-5.2 1.3 1.6h2.5" stroke="${DARK}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`],

  ['Amazon Music', 'https://music.amazon.com/podcasts/69249bb9-33d2-4d3c-9ada-1fbc7b93588b', '#25D1DA',
    `<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7 10.5v3M9.5 8.5v7M12 9.5v5M14.5 7.5v9M17 10.5v3" stroke="${DARK}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`],

  ['Buzzsprout', 'https://www.buzzsprout.com/1904089', '#5BA829',
    `<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7.4 16.6c-.5-4.4 2.7-8 9-8.2.5 5.3-3.1 8.8-9 8.2z" fill="${DARK}"/>`],
];

const MUST_COUNT = 4;

function pickMustRead(articles, curation, taken = new Set()){
  const want = freshPins('mustRead', (curation.mustRead || []).map((s) => String(s).trim()).filter(Boolean));

  const chosen = want
    .map((w) => articles.find((a) => sameItem({ id: a.id, href: a.url }, w)))
    .filter(Boolean);

  const have = new Set(chosen.map((a) => a.url));
  const seenCat = new Set(chosen.map((a) => a.category));

  const kryfoMr = kryfa('mustRead');

  // Two passes: one per category first, then whatever remains — otherwise
  // with few categories in the feed the band came out half empty.
  for (const strict of [true, false]) {
    for (const a of articles) {
      if (chosen.length >= MUST_COUNT) break;
      if (have.has(a.url) || taken.has(a.url)) continue;
      if (kryfoMr({ id: a.id, href: a.url, source: a.url })) continue;
      if (strict && seenCat.has(a.category)) continue;
      chosen.push(a);
      have.add(a.url);
      seenCat.add(a.category);
    }
  }

  return chosen.slice(0, MUST_COUNT);
}

function resumeSection(){
  return `  <section class="syn" data-synexeia hidden aria-labelledby="syn-head">
    <div class="syn-head">
      <h2 class="syn-mark" id="syn-head">Συνέχισε όπου έμεινες</h2>
      <p class="syn-note">Μόνο σε αυτή τη συσκευή</p>
    </div>
    <div class="syn-grid" data-synexeia-grid></div>
  </section>`;
}

function listaSection(){
  return `  <section class="syn lista" data-lista hidden aria-labelledby="lista-head">
    <div class="syn-head">
      <h2 class="syn-mark" id="lista-head">Η λίστα μου</h2>
      <p class="syn-note">Μόνο σε αυτή τη συσκευή</p>
    </div>
    <div class="syn-grid" data-lista-grid></div>
  </section>`;
}

const OPINIONS_SHOWN = 6;

let writersCache;
function writersFile(){
  if (writersCache === undefined) {
    writersCache = {};
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/writers.json'), 'utf8'));
      if (raw && typeof raw.photos === 'object') writersCache = raw.photos;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('ΠΡΟΣΟΧΗ: το data/writers.json δεν διαβάζεται —', err.message);
      }
    }
  }
  return writersCache;
}

function writerPhoto(author){
  if (!author || !author.name) return '';
  const mine = writersFile()[author.name];
  return mine || author.photo || '';
}

function writerLine(a){
  const name = a.author && a.author.name ? a.author.name : '';
  if (!name) return '';

  const face = writerPhoto(a.author);
  const url = a.author.url || '';

  const inner = `${face
    ? `<img class="art-by-pic" src="${esc(face)}" alt="" loading="lazy" width="96" height="96">`
    : ''}<span class="art-by-name">${esc(name)}</span>`;

  return `<p class="art-by-line">${url
    ? `<a class="art-by-link" href="${esc(url)}" target="_blank" rel="noopener">${inner}</a>`
    : inner}</p>`;
}

// Which opinions appear and in what order: the admin's picks first, then
// the most recent. Same logic as Must read.
function pickOpinions(articles, curation){
  const all = articles
    .filter((a) => a.category === 'Απόψεις')
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const want = freshPins('opinions', (curation.opinions || []).map((s) => String(s).trim()).filter(Boolean));

  const chosen = want
    .map((w) => all.find((a) => sameItem({ id: a.id, href: a.url }, w)))
    .filter(Boolean);

  const have = new Set(chosen.map((a) => a.url));

  const onoma = (a) => (a.author && a.author.name) || '';
  const prosopa = new Set(chosen.map(onoma).filter(Boolean));

  const vale = (a) => {
    chosen.push(a);
    have.add(a.url);
    if (onoma(a)) prosopa.add(onoma(a));
  };

  const kryfoOp = kryfa('opinions');

  for (const a of all) {
    if (chosen.length >= OPINIONS_SHOWN) break;
    if (have.has(a.url)) continue;
    if (kryfoOp({ id: a.id, href: a.url, source: a.url })) continue;
    if (onoma(a) && prosopa.has(onoma(a))) continue;
    vale(a);
  }

  // Second, looser pass: if there are not enough writers for six slots, a
  // second piece by the same one beats a hole in the band.
  for (const a of all) {
    if (chosen.length >= OPINIONS_SHOWN) break;
    if (have.has(a.url)) continue;
    if (kryfoOp({ id: a.id, href: a.url, source: a.url })) continue;
    vale(a);
  }

  return chosen.slice(0, OPINIONS_SHOWN);
}

function opinionsSection(articles, curation){
  const picks = pickOpinions(articles, curation);

  // Under three the band does not hold — same rule as Must read.
  if (picks.length < 3) return '';

  const cards = picks.map((a) => {
    const name = a.author && a.author.name ? a.author.name : '';
    const face = writerPhoto(a.author);

    const mine = !!articleBody(a.id);
    const href = mine ? articleUrl(a) : esc(a.url);
    const out = mine ? '' : ' target="_blank" rel="noopener"';

    return `      <article class="apop-card">
        <a class="apop-link" href="${href}"${out}>
          ${face
            ? `<span class="apop-face"><img class="apop-pic" src="${esc(face)}" alt="${esc(name)}" loading="lazy" width="120" height="120"></span>`
            : (name ? `<span class="apop-face">${avatar(name, 'avatar--round')}</span>` : '')}
          <span class="apop-text">
            ${name ? `<span class="apop-name">${esc(name)}</span>` : ''}
            <h3 class="apop-title">${esc(a.title)}</h3>
            <span class="apop-meta">${formatDate(a.date)}${mine ? '' : '<i>↗</i>'}</span>
          </span>
        </a>
      </article>`;
  }).join('\n');

  return `  <section class="must apop" aria-labelledby="apop-head">
    <div class="must-head">
      <p class="must-mark" id="apop-head">
        <span class="must-word apop-word">Από<em>ψεις</em></span>
        <span class="must-by">στο</span>
        <img class="must-logo" src="shows/logo-newshub.png" alt="Newshub.gr" loading="lazy">
      </p>
      <a class="must-all" href="https://www.newshub.gr/el/apopseis" target="_blank" rel="noopener">Όλες οι απόψεις →</a>
    </div>

    <div class="apop-grid">
${cards}
    </div>
  </section>`;
}

function mustReadSection(articles, curation, taken){
  const picks = pickMustRead(articles, curation, taken);

  // Under two the band does not hold: one lone article in a red frame
  // looks like an ad.
  if (picks.length < 2) return '';

  const cards = picks.map((a, i) => {
    const img = a.image_large || a.image_thumb || '';

    // Must-read items open HERE when we have the text — explicit
    // instruction. Those without a body keep the old behaviour and leave
    // for newshub.gr in a new tab.
    const mine = !!articleBody(a.id);
    const href = mine ? articleUrl(a) : a.url;
    const out = mine ? '' : ' target="_blank" rel="noopener"';

    return `      <article class="must-card">
        <a class="must-link" href="${href}"${out}>
          <span class="must-media">
            ${img
              ? `<img class="must-image" src="${img}" alt="" loading="lazy" width="765" height="435">`
              : '<span class="must-image must-image--empty"></span>'}
            <span class="must-no" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
          </span>
          <span class="must-text">
            ${a.category ? `<span class="must-cat">${esc(a.category)}</span>` : ''}
            <h3 class="must-title">${esc(a.title)}</h3>
            <span class="must-meta">${formatDate(a.date)}</span>
          </span>
        </a>
      </article>`;
  }).join('\n');

  return `  <section class="must" aria-labelledby="must-head">
    <div class="must-head">
      <p class="must-mark" id="must-head">
        <span class="must-word">Must<em>read</em></span>
        <span class="must-by">από το</span>
        <img class="must-logo" src="shows/logo-newshub.png" alt="Newshub.gr" loading="lazy">
      </p>
      <a class="must-all" href="https://www.newshub.gr/" target="_blank" rel="noopener">Όλες οι ειδήσεις →</a>
    </div>

    <div class="must-grid">
${cards}
    </div>
  </section>`;
}

function newsTicker(articles){
  if (!articles.length) return '';

  const rows = articles.slice(0, 8).map((a) => `      <li>
        <a href="${a.url}" target="_blank" rel="noopener">
          <span class="ticker-cat">${esc(a.category || 'Είδηση')}</span>
          <span class="ticker-title">${esc(a.title)}</span>
        </a>
      </li>`).join('\n');

  return `    <aside class="ticker">
      <p class="ticker-head">Ροή ειδήσεων</p>
      <ul class="ticker-list" data-roi="${esc(articles[0].date || '')}">
${rows}
      </ul>
      <a class="ticker-all" href="https://www.newshub.gr/" target="_blank" rel="noopener">Όλες οι ειδήσεις →</a>
    </aside>`;
}


const ONOMA_STOP = /\s+(για|μιλ[άαεί]\S*|αναλύει|εξηγεί|σχολιάζει|απαντά|περιγράφει|αποκαλύπτει|προειδοποιεί|αφιέρωμα|ρίχνει|ανοίγει|στο|στον|στη|στην|σε)(?=\s|$|[,:«"'])/i;

// Initial and surname, with or without a space.
const ARXIKO = /^[Α-ΩΆΈΉΊΌΎΏA-Z][α-ωά-ώa-z]?\.\s*[Α-ΩΆΈΉΊΌΎΏA-Z][α-ωά-ώa-z]+(-[Α-ΩΆΈΉΊΌΎΏA-Z][α-ωά-ώa-z]+)?$/;

// Capital initial then lowercase — a first name, not an ALL-CAPS show.
const KEFALAIO = /^[Α-ΩΆΈΉΊΌΎΏA-Z][α-ωά-ώa-z]/;

// Whatever the editors stick in front of the name that is not a name.
function tidyGuest(s){
  return cleanGuestName(String(s == null ? '' : s)
    .replace(/^\s*(μόνο|αποκλειστικά)\s+στο\s+new(s)?h(s)?ub\.?\s*(gr)?\s*[-–:]?\s*/i, '')
    .replace(/^\s*θέμα\s+new(s)?h(s)?ub\.?\s*(gr)?\s*[-–:]?\s*/i, '')
    .trim())
    // "Γ.Καραμπελιάς" and "Γ. Καραμπελιάς" are the same spelling. Without
    // the space they became two pages, and neither merged with the full
    // name.
    .replace(/^([Α-ΩΆΈΉΊΌΎΏA-Z][α-ωά-ώa-z]?\.)\s*(?=[Α-ΩΆΈΉΊΌΎΏA-Z])/, '$1 ');
}

// One name, or empty. Also accepts "initial + surname", which
// looksLikePerson accepts too, but not when the space is missing.
function enaOnoma(s){
  const n = tidyGuest(s);
  if (!n) return '';
  if (looksLikePerson(n)) return n;
  if (ARXIKO.test(n)) return n;
  return '';
}

// Names hiding BEFORE the colon (or the comma).
function onomataApoProthema(prefix){
  let p = tidyGuest(prefix);
  if (!p) return [];

  // "Name Surname για το something" -> cut at the word starting the phrase.
  const cut = p.search(ONOMA_STOP);
  if (cut > 0) p = p.slice(0, cut).trim();

  // Two people — "A - B", "A και B". We keep whichever is human: the left
  // side is often the show name, which fails the check.
  const parts = p.split(/\s+(?:[-–]|και)\s+/).map(enaOnoma).filter(Boolean);
  if (parts.length) return [...new Set(parts)];

  const one = enaOnoma(p);
  return one ? [one] : [];
}

// Pass 1: names that come out of the title itself.
function onomataApoTitlo(title){
  const t = decode(title);

  const m = t.match(/^([^:]{3,80}):\s*(.+)$/);
  if (m) {
    const got = onomataApoProthema(m[1]);
    if (got.length) return got;
  }

  // Here the colon comes much later, inside the title of the series.
  const c = t.match(/^([^,«»:]{3,45}),?\s*[«"]/);
  if (c) {
    const got = onomataApoProthema(c[1]);
    if (got.length) return got;
  }

  // A dash instead of a colon. looksLikePerson keeps out titles like
  // "Πνευμονική ίνωση - Οι νέες θεραπείες": second word lowercase.
  const d = t.match(/^([^-–:]{3,45})\s[-–]\s/);
  if (d) {
    const got = onomataApoProthema(d[1]);
    if (got.length) return got;
  }

  const v = t.match(/(?:^|[\s«"(])(?:[ΟΗ]\s+)?([Α-ΩΆΈΉΊΌΎΏ][α-ωά-ώ]{2,}\s+[Α-ΩΆΈΉΊΌΎΏ][α-ωά-ώ]{3,})\s+(?:μιλ[άαεί]\S*|αναλύει|εξηγεί|σχολιάζει|απαντά|περιγράφει|αποκαλύπτει|συμμετέχει|ανοίγει)(?=\s|$)/);
  if (v) {
    const one = enaOnoma(v[1]);
    if (one) return [one];
  }

  return [];
}

function onomaKleidi(s){
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function valeProsopa(list){
  const vrethika = new Map();

  for (const ep of list) {
    const fix = pairOf(ep) || {};
    if (fix.noguest) { vrethika.set(ep, []); continue; }
    if (fix.guest) { vrethika.set(ep, [String(fix.guest).trim()]); continue; }

    let names = onomataApoTitlo(ep.title);
    // Safety net: what feed.js found and we did not find again here.
    if (!names.length && ep.guest) {
      const n = enaOnoma(decode(ep.guest));
      if (n) names = [n];
    }
    vrethika.set(ep, names);
  }

  // ---- pass 2: dictionary ----
  const gnosta = new Map();     // name key -> name
  const epitheta = new Map();   // surname key -> set of names

  for (const [ep, names] of vrethika) {
    if (einaiVideo(ep)) continue;
    for (const n of names) {
      gnosta.set(onomaKleidi(n), n);
      const w = n.split(/\s+/);
      const last = w[w.length - 1];
      if (last.length < 4) continue;
      const k = onomaKleidi(last);
      if (!epitheta.has(k)) epitheta.set(k, new Set());
      epitheta.get(k).add(n);
    }
  }

  function apoLexiko(title){
    const words = decode(title).split(/[\s,.:;!?«»"()\-–]+/).filter(Boolean);

    // A full name we already know.
    for (let i = 0; i < words.length - 1; i++) {
      const hit = gnosta.get(onomaKleidi(words[i] + ' ' + words[i + 1]));
      if (hit) return [hit];
    }

    // A known SURNAME inside the title. If a first name sits in front of
    // it, we keep what the title says and NOT the dictionary name:
    // "Βασίλης Λαμπρινός" is not "Φραγκίσκος Λαμπρινός".
    for (let i = 0; i < words.length; i++) {
      const hit = epitheta.get(onomaKleidi(words[i]));
      if (!hit) continue;
      const prev = words[i - 1] || '';
      if (prev.length >= 3 && KEFALAIO.test(prev) && !ONOMA_STOP.test(' ' + prev)) {
        return [prev + ' ' + words[i]];
      }
      if (hit.size === 1) return [[...hit][0]];
    }

    return [];
  }

  for (const [ep, names] of vrethika) {
    if (names.length) continue;
    if (einaiVideo(ep)) continue;
    const fix = pairOf(ep) || {};
    if (fix.noguest) continue;
    vrethika.set(ep, apoLexiko(ep.title));
  }

  // ---- pass 3a: one spelling per name ----
  // "Αγγελος Συρίγος" and "Άγγελος Συρίγος" are the same person: the
  // spelling that appears most often wins.
  const grafes = new Map();
  for (const names of vrethika.values()) {
    for (const n of names) {
      const k = onomaKleidi(n);
      if (!grafes.has(k)) grafes.set(k, new Map());
      const m = grafes.get(k);
      m.set(n, (m.get(n) || 0) + 1);
    }
  }
  const kiria = new Map();
  for (const [k, m] of grafes) {
    kiria.set(k, [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'el'))[0][0]);
  }

  // ---- pass 3b: initial -> full name ----
  // Only when the answer is UNIQUE: same surname, same initial, one full
  // name. Otherwise two siblings become one person.
  const plires = new Map();
  for (const names of vrethika.values()) {
    for (const raw of names) {
      const n = kiria.get(onomaKleidi(raw)) || raw;
      const w = n.split(/\s+/);
      if (w.length < 2) continue;
      if (/\.$/.test(w[0]) || w[0].length <= 2) continue;   // an initial, not a name
      const k = onomaKleidi(w[w.length - 1]);
      if (!plires.has(k)) plires.set(k, new Set());
      plires.get(k).add(n);
    }
  }

  const veto = new Set(aliasNos());
  function enose(name){
    const w = name.split(/\s+/);
    if (w.length < 2) return name;
    if (!/\.$/.test(w[0]) && w[0].length > 2) return name;   // already full

    const hit = plires.get(onomaKleidi(w[w.length - 1]));
    if (!hit || hit.size !== 1) return name;

    const full = [...hit][0];
    // The initial has to match: "Α. Συρίγος" does not become "Βασίλης
    // Συρίγος".
    if (onomaKleidi(full[0]) !== onomaKleidi(name[0])) return name;
    // And the human has the final word.
    if (veto.has(`${guestKey(full)}|${guestKey(name)}`)) return name;
    if (veto.has(`${guestKey(name)}|${guestKey(full)}`)) return name;
    return full;
  }

  for (const [ep, names] of vrethika) {
    const mia = names.map((n) => kiria.get(onomaKleidi(n)) || n);
    ep.guestRaw = mia[0] || '';
    ep.guests = [...new Set(mia.map(enose))];
    ep.guest = ep.guests[0] || '';
  }
}

function cleanGuestName(name){
  return String(name)
    // The site name, with or without "στο", and with the misspellings
    // circulating in titles: newhub, newhsub, bare newshub.
    .replace(/[\s,–-]*(στο|στον|στη|στην)?\s*new(s)?h(s)?ub\.?\s*(gr)?\b\.?/i, '')
    // Suffixes that are not part of the name.
    .replace(/[\s,–-]*(ιστορικό\s+αφιέρωμα|αποκλειστικ[όο])\s*!?$/i, '')
    .replace(/[\s,–-]*μέρος\s+\S+$/i, '')
    // Prefixes that are not part of the name. Latin "O" included.
    .replace(/^\s*αποκλειστικ[όο]\s*!?\s*/i, '')
    .replace(/^\s*(αποκαλυπτικ|συγκλονιστικ|συγκινητικ)[όοήηάαέεςσ]*\s+/i, '')
    // The "i" matters: titles write "Ο Αλέξανδρος" with a capital article.
    // A Latin o is accepted too, since it slips in while typing.
    .replace(/^(ο|η|το|o)\s+/i, '')
    .replace(/\s*[,–-]\s*$/, '')
    .trim();
}

const ORGANISMOS = new RegExp('(^|\\s)(' + [
  'υπηρεσία', 'υπηρεσίες', 'υπόθεση', 'υποθέσεις', 'περιφέρεια', 'περιφέρειας',
  'περιφερειάρχη', 'περιφερειάρχης', 'δήμος', 'δήμου', 'δήμοι', 'δημοτική', 'δημοτικό',
  'διοίκηση', 'αποκεντρωμένη', 'υπουργείο', 'υπουργείου', 'επιμελητήριο',
  'σύλλογος', 'συλλόγου', 'ένωση', 'ομοσπονδία', 'σωματείο', 'επιτροπή',
  'ίδρυμα', 'ινστιτούτο', 'ακαδημία', 'πανεπιστήμιο', 'πολυτεχνείο',
  'νοσοκομείο', 'νοσοκομείου', 'κέντρο', 'μέγαρο', 'μουσείο', 'βιβλιοθήκη',
  'γυμνάσιο', 'λύκειο', 'σχολείο', 'δημοτικού', 'αεροδρόμιο', 'λιμάνι',
  'αστυνομία', 'πυροσβεστική', 'λιμεναρχείο', 'στρατόπεδο', 'φυλακές',
  'φεστιβάλ', 'εκδήλωση', 'συνέδριο', 'ημερίδα', 'έκθεση', 'παρουσίαση',
  'πρωτάθλημα', 'τουρνουά', 'αγώνας', 'αγώνες', 'φράγμα', 'ποταμός',
  'μεταναστευτικό', 'τροχαίο', 'σεισμός', 'απεργία', 'συγκέντρωση',
  'αρχιεπίσκοπος', 'αρχιεπισκόπου', 'μητρόπολη', 'εκκλησία', 'ενορία',
].join('|') + ')(\\s|$)', 'i');

// Place names of Crete and the news, where you would expect a surname.
// Only at the END: "Κρητικός" is a surname, "Κρήτης" is not.
const TOPOS_TELOS = new RegExp('(^|\\s)(' + [
  'κρήτη', 'κρήτης', 'ηράκλειο', 'ηρακλείου', 'χανιά', 'χανίων',
  'ρέθυμνο', 'ρεθύμνου', 'λασίθι', 'λασιθίου', 'αθήνα', 'αθηνών',
  'θεσσαλονίκη', 'ελλάδα', 'ελλάδας', 'κύπρος', 'κύπρου', 'ευρώπη',
  'πεδιάδας', 'αλικαρνασσού', 'καστελίου', 'μεσαρά', 'μεσαράς',
].join('|') + ')$', 'i');

// Preposition or article at the start: whatever follows is not a name.
const ARXI_STOP = /^(σε|στο|στον|στη|στην|στους|στις|από|για|με|προς|κατά|μετά|πριν|ο|η|το|οι|τα|τον|την|του|της|των|νέα|νέο|νέος|νέες|νέοι|έκτακτο|μεγάλη|μεγάλο)$/i;

function looksLikePerson(name){
  const n = String(name).trim();
  if (!n) return false;

  // Quotes, exclamation marks and the comma: "Γ. Καραμπελιάς, Ιστορικό"
  // is a name AND a role, not a name.
  if (/[«»"!;?…:,]/.test(n)) return false;
  if (/\d/.test(n)) return false;           // "μέρος 9ο"

  const words = n.split(/[\s.\-–]+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;

  if (/(^|\s)ημέρα(\s|$)/i.test(n)) return false;

  if (ORGANISMOS.test(n)) return false;

  // A place at the end: no surname is a place name in the genitive.
  if (TOPOS_TELOS.test(n)) return false;

  // Preposition or article in front: a cut phrase, not a name.
  if (ARXI_STOP.test(words[0])) return false;

  for (const w of words) {
    // Every part of a name starts with a capital. "και", "της", "στο"
    // give away a phrase, not a name.
    if (!/^[Α-ΩΆΈΉΊΌΎΏA-Z]/.test(w)) return false;
    // An ALL-CAPS word = a show name, not a person.
    if (/^[Α-ΩΆΈΉΊΌΎΏA-Z]{3,}$/.test(w)) return false;
  }

  return true;
}

function notGuest(name){
  return aliases().notPeople.has(guestKey(name));
}

let aliasData;
function aliases(){
  if (!aliasData) {
    aliasData = { titles: [], map: {}, notPeople: new Set(), roles: {}, photos: {}, nos: [] };
    try {
      const raw = JSON.parse(fs.readFileSync(ALIAS_FILE, 'utf8'));
      aliasData.titles = Array.isArray(raw.titles) ? raw.titles : [];
      // Inverted: the file is written "canonical -> variants" because that
      // reads well; here we want "variant -> canonical".
      for (const [canonical, list] of Object.entries(raw.aliases || {})) {
        for (const variant of list) aliasData.map[guestKey(variant)] = canonical;
      }
      // By key, not by the name as written: the junk an editor deletes
      // appears in titles with different accents too, and would come back
      // as a person.
      for (const name of raw.not_people || []) {
        aliasData.notPeople.add(guestKey(name));
      }
      // Role per CANONICAL name — after merging, otherwise the same person
      // would need it written against every spelling.
      for (const [name, role] of Object.entries(raw.roles || {})) {
        if (role) aliasData.roles[guestKey(name)] = String(role);
      }
      // The portrait, keyed by canonical name — same logic as the role. A
      // human picks it in the admin; we cannot guess it from anywhere.
      for (const [name, url] of Object.entries(raw.photos || {})) {
        if (url) aliasData.photos[guestKey(name)] = String(url);
      }
      for (const pair of raw.not_aliases || []) {
        if (Array.isArray(pair) && pair.length === 2) {
          aliasData.nos.push(`${guestKey(pair[0])}|${guestKey(pair[1])}`);
        }
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('ΠΡΟΣΟΧΗ: το data/people-aliases.json δεν διαβάζεται —', err.message);
      }
    }
  }
  return aliasData;
}

// Splits the honorific from the name: "Δρ. Αγγελική Ασημάκη" -> Δρ + the
// name. It leaves the name so it does not create a second person, but is
// kept so it can show on their page.
function splitTitle(name){
  const titles = aliases().titles;
  if (!titles.length) return { title: '', name: String(name).trim() };

  const re = new RegExp(`^(${titles.join('|')})\\.?\\s+`, 'i');
  const m = String(name).match(re);
  if (!m) return { title: '', name: String(name).trim() };
  return { title: m[1], name: String(name).slice(m[0].length).trim() };
}

// A person's honorific, if any. Empty for almost everyone.
function titleOf(ep){
  if (!ep.guest) return '';
  return splitTitle(cleanGuestName(decode(ep.guest))).title;
}

// The episode's guest, or empty if there is no person in front. EVERY
// place goes through here, so card, person page and "related" agree.
function guestOf(ep){
  const fix = pairOf(ep);
  if (fix && fix.noguest) return '';
  if (fix && fix.guest) {
    const typed = String(fix.guest).trim();
    return aliases().map[guestKey(typed)] || typed;
  }

  return guestsOf(ep)[0] || '';
}

function guestsOf(ep){
  const fix = pairOf(ep);
  if (fix && fix.noguest) return [];
  if (fix && fix.guest) {
    const typed = String(fix.guest).trim();
    return [aliases().map[guestKey(typed)] || typed];
  }

  const out = [];
  for (const raw of (ep.guests && ep.guests.length ? ep.guests : [ep.guest].filter(Boolean))) {
    const { name } = splitTitle(cleanGuestName(decode(raw)));
    if (!name || !looksLikePerson(name) || notGuest(name)) continue;
    const canonical = aliases().map[guestKey(name)] || name;
    // Deletion applies to the canonical name too: the editor deletes what
    // they see on the card, and that is the merged one.
    if (notGuest(canonical)) continue;
    if (!out.some((n) => guestKey(n) === guestKey(canonical))) out.push(canonical);
  }
  return out;
}

// A person's role ("professor of international relations"). Empty for
// anyone nobody filled in — it is a note, not a requirement.
function roleOf(name){
  return aliases().roles[guestKey(name)] || '';
}

function photoOf(name){
  return aliases().photos[guestKey(name)] || '';
}

// Is there at least one portrait? That decides whether the homepage
// "Πρόσωπα" section shows images — with zero portraits it would be 40
// empty circles, worse than plain names.
let facesKnown;
function haveFaces(){
  if (facesKnown === undefined) {
    facesKnown = Object.keys(aliases().photos).length > 0;
  }
  return facesKnown;
}

// Pairs the editor explicitly rejected: "no, different person". For the
// suggestions only — they change nothing on the site.
function aliasNos(){
  return aliases().nos;
}

function guestKey(name){
  return slugify(String(name).replace(/[ΐϊ]/g, 'ι').replace(/[ΰϋ]/g, 'υ'));
}

function guestUrl(name){
  return `guest/${slugify(name)}.html`;
}
// Grouping by person. Episodes AND videos go in — to the person they are
// the same thing: one time they spoke.
function groupByGuest(items){
  const groups ={};

  for (const ep of items){
    for (const name of guestsOf(ep)) {
      const key = guestKey(name);
      if (!key) continue;
      if(!groups[key]) groups[key] = {names: [], items:[]};
      groups[key].names.push(name);
      groups[key].items.push(ep);
    }
  }
  return groups;
}

let guestSlugIndex = {};
let guestIndex = [];
function indexGuestSlugs(groups){
  guestSlugIndex = {};
  guestIndex = [];

  for (const key of Object.keys(groups)) {
    const name = mostCommon(groups[key].names);
    const withImage = groups[key].items.find((e) => e.image);

    guestSlugIndex[key] = slugify(name);
    guestIndex.push({
      key,
      name,
      slug: slugify(name),
      image: withImage ? withImage.image : '',
      count: groups[key].items.length,
      last: groups[key].items[0] ? groups[key].items[0].date : '',
      hay: matchKey(name),
      weight: name.length,          // longer names match first
    });
  }

  // "Γιώργος Παπαδόπουλος" must be tried before "Γιώργος Παπά", or the
  // shorter name steals the match.
  guestIndex.sort((a, b) => b.weight - a.weight);
}

function peopleForAdmin(episodes){
  // The raw inventory first: every spelling as it comes out of the title,
  // BEFORE merging. Without it you cannot see what merged with what.
  const raw = {};
  const katelixe = {};   // spelling -> the person it merged into
  for (const ep of episodes) {
    const fix = pairOf(ep);
    if (fix && fix.noguest) continue;

    let name;
    if (fix && fix.guest) {
      // Handwritten: it does not go through looksLikePerson. That judges a
      // GUESS from a title — here a human judged.
      name = String(fix.guest).trim();
    } else {
      // The spelling BEFORE automatic merging: "Γ. Καραμπελιάς", not
      // "Γιώργος Καραμπελιάς". Otherwise the tab would never show what
      // merged with what, and the × beside it would have nothing to undo.
      name = ep.guestRaw || ep.guest;
      if (!name) continue;
      name = splitTitle(cleanGuestName(decode(name))).name;
      if (!name || !looksLikePerson(name)) continue;
    }
    raw[name] = (raw[name] || 0) + 1;

    // Where this spelling ended up after merging. Taken from the episode
    // itself: automatic merging does not pass through aliases().map.
    const final = guestsOf(ep)[0];
    if (final) katelixe[name] = final;
  }

  // Which spellings ended up as which person, and which were deleted.
  const writings = {};   // person key -> [{ name, n }]
  const rejected = [];
  for (const [name, n] of Object.entries(raw)) {
    const canonical = katelixe[name] || aliases().map[guestKey(name)] || name;
    if (notGuest(name) || notGuest(canonical)) {
      rejected.push({ name, n });
      continue;
    }
    const key = guestKey(canonical);
    (writings[key] = writings[key] || []).push({ name, n });
  }
  for (const list of Object.values(writings)) list.sort((a, b) => b.n - a.n);

  const people = guestIndex.map((p) => ({
    name: p.name,
    slug: p.slug,
    n: p.count,
    last: p.last,
    image: p.image,
    writings: (writings[p.key] || []).map((w) => w.name),
  })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'el'));

  const map = aliases().map;
  const no = new Set(aliasNos());
  const suggest = suggestFamilies(raw)
    .map((f) => ({
      canonical: f.canonical,
      cn: raw[f.canonical] || 0,
      others: f.others
        .filter((o) => {
          if (notGuest(o)) return false;
          if (no.has(`${guestKey(f.canonical)}|${guestKey(o)}`)) return false;
          const to = map[guestKey(o)];
          return guestKey(to || o) !== guestKey(f.canonical);
        })
        .map((o) => ({ name: o, n: raw[o] || 0 })),
    }))
    .filter((f) => f.others.length && !notGuest(f.canonical));

  return { people, rejected: rejected.sort((a, b) => b.n - a.n), suggest };
}

function pairsForAdmin(episodes){
  const rows = [];

  for (const ep of episodes) {
    const fix = pairOf(ep) || {};
    const v = videoTwin(ep);
    const guest = guestOf(ep);
    const touched = !!(fix.video || fix.guest || fix.novideo || fix.noguest
      || fix.title || fix.summary || fix.image);

    rows.push({
      id: ep.id,
      title: decode(ep.title),
      date: ep.date,
      image: ep.image || '',
      video: v ? v.id : '',
      vtitle: v ? decode(v.title) : '',
      guest,
      gaps: (!v || !guest) ? 1 : 0,
      edited: touched ? 1 : 0,
    });
  }

  rows.sort((a, b) => new Date(b.date) - new Date(a.date));
  return { rows };
}

let peopleIndex = [];
function indexPeople(groups){
  peopleIndex = Object.keys(groups).map((key) => {
    const name = mostCommon(groups[key].names);
    const cats = {};
    for (const ep of groups[key].items) {
      for (const c of episodeCategories(ep)) cats[c] = (cats[c] || 0) + 1;
    }
    return {
      key,
      name,
      slug: slugify(name),
      count: groups[key].items.length,
      cats,
      // Topic totals only, so two people can be compared.
      topics: new Set(Object.keys(cats)),
    };
  });
}

// A person's topics, most frequent first.
function topicsOf(key){
  const me = peopleIndex.find((p) => p.key === key);
  if (!me) return [];
  return Object.entries(me.cats)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'el'))
    .map(([name, n]) => ({ name, n }));
}

// Others who talk about the same things. We count shared topics and break
// ties by appearance count: between two with the same two topics, prefer
// the one who speaks here more often.
function nearbyPeople(key, max = 4){
  const me = peopleIndex.find((p) => p.key === key);
  if (!me || !me.topics.size) return [];

  return peopleIndex
    .filter((p) => p.key !== key)
    .map((p) => {
      let shared = 0;
      for (const t of p.topics) if (me.topics.has(t)) shared++;
      return { p, shared };
    })
    .filter((x) => x.shared > 0)
    .sort((a, b) => b.shared - a.shared || b.p.count - a.p.count)
    .slice(0, max)
    .map((x) => x.p);
}

// Which known guest is mentioned inside a text. Videos need it: they have
// no guest field, only a title.
function guestInText(text){
  const hay = matchKey(text);
  if (!hay) return null;
  for (const g of guestIndex) {
    if (g.hay && hay.includes(g.hay)) return g;
  }
  return null;
}

function guestFirstInText(text){
  const hay = matchKey(text);
  if (!hay) return null;

  let best = null;
  let bestAt = Infinity;
  for (const g of guestIndex) {
    if (!g.hay) continue;
    const at = hay.indexOf(g.hay);
    // Tie on position: the longer name wins, as in the title —
    // "Γιώργος Παπαδόπουλος" before "Γιώργος Παπά".
    if (at !== -1 && (at < bestAt || (at === bestAt && g.hay.length > best.hay.length))) {
      best = g;
      bestAt = at;
    }
  }
  return best;
}

function videoGuest(v){
  // First, whatever the shared people pass found in the video title — the
  // same one that produces episode guests, with the same merging and the
  // same editor corrections.
  for (const onoma of guestsOf(v)) {
    const g = guestIndex.find((x) => x.key === guestKey(onoma));
    if (g) return g;
  }

  // Then the title as free text: this catches "μίλησε ο Χ" forms with no
  // colon, which the people pass never sees.
  const apoTitlo = guestInText(v.title);
  if (apoTitlo) return apoTitlo;

  // Last, the FIRST paragraph of the description.
  const proti = String(v.summary || '').split('\n')[0];
  return proti ? guestFirstInText(proti) : null;
}

// The URL of an episode guest's page — empty if there is no guest or no
// page for them.
function guestHref(ep, depth = 0){
  const name = guestOf(ep);
  if (!name) return '';
  const slug = guestSlugIndex[guestKey(name)];
  if (!slug) return '';
  return `${depth === 0 ? '' : '../'}guest/${slug}.html`;
}

function mostCommon(list){
  let best = list[0];
  let bestCount = 0;

  for (const item of list){
    const count = list.filter((x) => x === item).length;
    if (count > bestCount){
      best = item;
      bestCount = count;
    }
  }
  return best;
}

// Page for addresses that do not exist. We do not leave the visitor on a
// blank browser screen — we give them ways to carry on.
function notFoundPage(){
  const body = `${siteHeader()}

  <main class="guest">
    <p class="page-label">404</p>
    <h1 class="guest-name">Η σελίδα δεν βρέθηκε</h1>
    <p class="guest-count">Ίσως άλλαξε διεύθυνση ή γράφτηκε λάθος.</p>

    <div class="cat-grid">
      <a class="cat" href="index.html"><span class="cat-name">Αρχική</span><span class="cat-count">→</span></a>
      <a class="cat" href="search.html" data-reload><span class="cat-name">Αναζήτηση</span><span class="cat-count">→</span></a>
      <a class="cat" href="shows.html"><span class="cat-name">Εκπομπές</span><span class="cat-count">→</span></a>
      <a class="cat" href="categories.html"><span class="cat-name">Ενότητες</span><span class="cat-count">→</span></a>
      <a class="cat" href="guests.html"><span class="cat-name">Πρόσωπα</span><span class="cat-count">→</span></a>
    </div>
  </main>`;

  return page({ title: `Η σελίδα δεν βρέθηκε — ${SITE_NAME}`, body });
}

function privacyPage(){
  const body = `${siteHeader()}

  <main class="guest">
    <p class="page-label">Απόρρητο</p>
    <h1 class="guest-name">Τι κρατάμε, και τι όχι</h1>
    <p class="guest-count">Ενημερώθηκε στις ${ADSENSE ? '15' : '12'} Νοεμβρίου 2026</p>

    <section class="bio-topics">
      <h2 class="bio-sub">Με δυο λόγια</h2>
      ${ADSENSE
    ? `<p>Αυτό το site <strong>δεν βάζει καμία cookie μέχρι να το δεχτείς</strong>.
      Δεν σου ζητάει λογαριασμό. Οι διαφημίσεις έρχονται από το Google
      AdSense, και χωρίς τη συγκατάθεσή σου είναι
      <strong>μη εξατομικευμένες</strong>: δεν φτιάχνεται προφίλ σου και δεν
      αποθηκεύεται τίποτα στη συσκευή σου για διαφημιστικό σκοπό.</p>`
    : GA4
    ? `<p>Αυτό το site <strong>δεν βάζει καμία cookie μέχρι να το δεχτείς</strong>.
      Δεν σου ζητάει λογαριασμό και δεν δίνει στοιχεία σου σε διαφημιστικές
      εταιρείες — γιατί δεν υπάρχει καμία διαφημιστική εδώ.</p>`
    : `<p>Αυτό το site <strong>δεν βάζει cookies</strong>. Δεν σου ζητάει
      λογαριασμό, δεν σε παρακολουθεί από σελίδα σε σελίδα, και δεν δίνει
      στοιχεία σου σε διαφημιστικές εταιρείες — γιατί δεν υπάρχει καμία.</p>`}

      <h2 class="bio-sub">Πόσος κόσμος μας διαβάζει</h2>
      <p>Μετράμε επισκέψεις με το Cloudflare Web Analytics. Δεν βάζει
      cookies και δεν φτιάχνει προφίλ: κρατάει συγκεντρωτικά νούμερα —
      πόσες προβολές είχε μια σελίδα, από ποια χώρα, από τι συσκευή.
      Δεν μπορούμε να δούμε τι διάβασε ένας συγκεκριμένος άνθρωπος.</p>
${GA4 ? `
      <h2 class="bio-sub">Το Google Analytics, και η επιλογή σου</h2>
      <p>Χρησιμοποιούμε και το Google Analytics, που χρειάζεται cookies
      για να ξεχωρίσει αν δύο προβολές είναι ο ίδιος άνθρωπος. Αυτές
      <strong>δεν μπαίνουν αν δεν πεις ναι</strong>: μέχρι να απαντήσεις,
      και αν απαντήσεις «Όχι», το Google δέχεται από εμάς μόνο ένα
      ανώνυμο σήμα χωρίς τίποτα αποθηκευμένο στη συσκευή σου.</p>
      <p>Αν δεχτείς, μπαίνουν cookies της Google που κρατούν έναν τυχαίο
      κωδικό — όχι το όνομά σου — για δύο χρόνια, και τα στοιχεία
      επεξεργάζεται η Google ως δική μας εκτελούσα. Η απάντησή σου
      φυλάσσεται στη συσκευή σου και δεν ξαναρωτιέσαι.</p>

      <div class="syn-allagi" data-syn-allagi>
        <p data-syn-tora>Δεν έχεις απαντήσει ακόμα.</p>
        <div class="synainesi-btns">
          <button type="button" class="synainesi-btn" data-syn="oxi">Όχι, καμία cookie</button>
          <button type="button" class="synainesi-btn" data-syn="nai">Δέχομαι</button>
        </div>
      </div>
` : ''}
      <h2 class="bio-sub">Τι μένει στη δική σου συσκευή</h2>
      <p>Ο player κρατάει τρία πράγματα στον browser σου, ώστε να
      συνεχίζεις εκεί που έμεινες:</p>
      <ul>
        <li>σε ποιο δευτερόλεπτο σταμάτησες κάθε επεισόδιο</li>
        <li>τα τελευταία που άκουσες, για το «Συνέχισε όπου έμεινες»</li>
        <li>όσα κράτησες για μετά</li>
      </ul>
      <p>Αυτά <strong>δεν φεύγουν ποτέ από τη συσκευή σου</strong>. Δεν τα
      βλέπουμε εμείς, δεν ταξιδεύουν σε άλλη συσκευή σου, και σβήνονται
      αν καθαρίσεις τα δεδομένα του browser.</p>

      <h2 class="bio-sub">Τι φορτώνει από αλλού</h2>
      <p>Κάθε φορά που ο browser σου ζητάει αρχείο από άλλον διακομιστή,
      εκείνος βλέπει τη διεύθυνση IP σου. Αυτό ισχύει για κάθε site στο
      διαδίκτυο· να ποιοι είναι στην περίπτωσή μας:</p>
      <ul>
        <li><strong>Buzzsprout</strong> — ο ήχος των podcast και τα εξώφυλλά τους</li>
        <li><strong>YouTube</strong> — οι μικρογραφίες των βίντεο. Το ίδιο
        το βίντεο, και ό,τι κρατάει το YouTube μαζί του, φορτώνει
        <strong>μόνο αν πατήσεις play</strong></li>
        <li><strong>newshub.gr</strong> — οι φωτογραφίες των ειδήσεων</li>
        <li><strong>Google Fonts</strong> — οι γραμματοσειρές</li>
        <li><strong>Cloudflare</strong> — η φιλοξενία του site</li>${GA4 ? `
        <li><strong>Google Analytics</strong> — οι μετρήσεις, με την άδειά σου</li>` : ''}${ADSENSE ? `
        <li><strong>Google AdSense</strong> — οι διαφημίσεις</li>` : ''}
      </ul>

      <h2 class="bio-sub">Διαφημίσεις</h2>
${ADSENSE ? `      <p>Οι διαφημίσεις εδώ είναι δύο ειδών. Οι <strong>δικές μας</strong>,
      των τοπικών συνεργατών, είναι στατικές εικόνες που φιλοξενούμε εμείς:
      δεν σε ακολουθεί τίποτα και δεν μπαίνει καμία cookie. Οι υπόλοιπες
      έρχονται από το <strong>Google AdSense</strong>, που είναι διαφημιστικό
      δίκτυο και μπορεί να βάλει cookies στη συσκευή σου.</p>
      <p>Αυτές <strong>δεν μπαίνουν αν δεν πεις ναι</strong>. Μέχρι να
      απαντήσεις, και αν απαντήσεις «Όχι», οι διαφημίσεις που βλέπεις είναι
      μη εξατομικευμένες: διαλέγονται από το περιεχόμενο της σελίδας, όχι
      από εσένα, και δεν αποθηκεύεται τίποτα για διαφημιστικό σκοπό.</p>
      <p>Ό,τι κι αν διαλέξεις, <strong>καμία διαφήμιση δεν σκεπάζει το
      περιεχόμενο</strong> και καμία δεν κουνάει τη σελίδα καθώς φορτώνει:
      κάθε θέση έχει δεσμευμένο χώρο από την αρχή. Δεν υπάρχουν αναδυόμενα,
      δεν υπάρχουν λωρίδες που κολλάνε στην οθόνη, και δεν υπάρχει καμία
      διαφήμιση μέσα ή πάνω από τον player.</p>` : `      <p>Όσες διαφημίσεις βλέπεις είναι στατικές εικόνες που φιλοξενούμε
      εμείς. Δεν υπάρχει διαφημιστικό δίκτυο, δεν σε ακολουθεί τίποτα, και
      καμία διαφήμιση δεν σκεπάζει το περιεχόμενο. Αν αυτό αλλάξει κάποτε,
      θα αλλάξει και αυτή η σελίδα — και θα μπει μήνυμα συγκατάθεσης πριν
      φορτώσει οτιδήποτε τρίτο.</p>`}

      <h2 class="bio-sub">Επικοινωνία</h2>
      <p>Για οτιδήποτε αφορά τα δεδομένα σου, γράψε μας μέσα από τη
      <a href="https://www.newshub.gr/el/epikoinonia" target="_blank" rel="noopener">σελίδα επικοινωνίας του newshub.gr ↗</a>.</p>
    </section>
  </main>`;

  return page({
    title: `Απόρρητο — ${SITE_NAME}`,
    body,
    description: 'Τι κρατάει το Newshub Media και τι όχι: καμία cookie, μετρήσεις χωρίς προφίλ, και τι μένει στη συσκευή σου.',
    url: 'aporrito.html',
  });
}

// Search engines need a sitemap to reach all 4,500 pages — following links
// alone they would miss most of them.
function sitemapXml(urls){
  // Without .html, like every link on the site: otherwise the sitemap
  // sends Google to 4,700 URLs that all redirect.
  const rows = urls.map((u) => `  <url><loc>${SITE_URL}/${cleanUrl(u.loc)}</loc>${u.date ? `<lastmod>${u.date.slice(0, 10)}</lastmod>` : ''}</url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rows}
</urlset>
`;
}

// The search page. Pagefind builds the index after the build and serves it
// from /pagefind/ — there is no search server and nothing is billed per
// visitor.
function searchPage(episodes, catGroups){
  // The page is not empty before anyone searches: topics and the most
  // recent episodes sit below, so there is a way forward even if you do
  // not know what to type.
  const topics = Object.keys(catGroups || {})
    .filter((k) => catGroups[k].items.length)
    .sort((a, b) => catGroups[b].items.length - catGroups[a].items.length)
    .map((k) => `      <a class="cat" href="${categoryUrl(catGroups[k].name)}">
        <span class="cat-name">${esc(catGroups[k].name)}</span>
        <span class="cat-count">${catGroups[k].items.length.toLocaleString('el')}</span>
      </a>`).join('\n');

  const latest = (episodes || []).slice(0, 9).map((ep) => episodeCard(ep)).join('\n');

  const body = `${siteHeader()}

  <main class="guest">
    <p class="page-label">Αρχείο</p>
    <h1 class="guest-name">Αναζήτηση</h1>
    <p class="guest-count">Σε όλα τα επεισόδια και τα βίντεο</p>

    <div id="search"></div>
  </main>

  ${topics ? `<section class="search-extra">
    <h2 class="section-head">Ξεκίνα από ένα θέμα</h2>
    <div class="cat-grid">
${topics}
    </div>
  </section>` : ''}

  ${latest ? `<section class="search-extra">
    <h2 class="section-head">Τελευταία επεισόδια</h2>
    <div class="grid">
${latest}
    </div>
    <p class="flow-all"><a href="episodes.html">Όλα τα επεισόδια →</a></p>
  </section>` : ''}

  <link rel="stylesheet" href="pagefind/pagefind-ui.css">
  <script src="pagefind/pagefind-ui.js"></script>
  <script>
    window.addEventListener('DOMContentLoaded', function () {
      var ui = new PagefindUI({
        element: '#search',
        showSubResults: true,
        showImages: true,
        pageSize: 12,
        translations: {
          placeholder: 'Αναζήτησε επεισόδια, πρόσωπα, ενότητες...',
          clear_search: 'Καθαρισμός',
          load_more: 'Περισσότερα αποτελέσματα',
          search_label: 'Αναζήτηση στο αρχείο',
          filters_label: 'Φίλτρα',
          zero_results: 'Κανένα αποτέλεσμα για [SEARCH_TERM]',
          many_results: '[COUNT] αποτελέσματα για [SEARCH_TERM]',
          one_result: '1 αποτέλεσμα για [SEARCH_TERM]',
          searching: 'Αναζήτηση για [SEARCH_TERM]...'
        }
      });

      try {
        // Search from the URL: /search?q=κρήτη runs on its own.
        //
        // Two things come of it: the link to a search can be shared, and
        // Google may show a search box inside our results (SearchAction
        // on the homepage) — which points at exactly this address.
        var q = new URLSearchParams(location.search).get('q');
        if (q) ui.triggerSearch(q);
      } catch (e) {}
    });
  </script>`;

  return page({ title: 'Αναζήτηση — Newshub Media', body });
}

// All guests, alphabetically.
// How many appearances count as "regular". Above that the number is
// highlighted in the list.
const OFTEN = 5;

// The initial letter for the anchors: capital, unaccented, so "Άγγελος"
// and "Ανδρέας" land under the same Α.
function firstLetter(name){
  return String(name).trim().charAt(0).toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// How many names the homepage "Πρόσωπα" section shows.
const NAMES_SHOWN = 40;

function peopleFaces(){ return haveFaces(); }

function namesSection(groups, depth = 0){
  const keys = Object.keys(groups);
  if (!keys.length) return '';

  const up = depth === 0 ? '' : '../';

  const people = keys
    .map((key) => {
      const name = mostCommon(groups[key].names);
      return {
        name,
        n: groups[key].items.length,
        // A real portrait only. This used to hold the episode cover — see
        // photoOf().
        face: photoOf(name),
      };
    })
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'el'))
    .slice(0, NAMES_SHOWN);

  const faceOn = peopleFaces();

  const chips = people.map((p) => `      <a class="pname" href="${up}guest/${slugify(p.name)}.html">
        ${faceOn ? `<span class="pname-face">${p.face
          ? `<img src="${esc(p.face)}" alt="" loading="lazy">`
          : ''}</span>` : ''}
        <span class="pname-text">${esc(p.name)}</span>
        <span class="pname-n">${p.n}</span>
      </a>`).join('\n');

  return `  <section class="band band--people">
${bandMark('Τα', ' πρόσωπα', `      <p class="band-sub">${keys.length} άνθρωποι έχουν μιλήσει στο newshub.gr</p>`)}

    <div class="pnames${faceOn ? ' pnames--faces' : ''}">
${chips}
    </div>

    <p class="pnames-all"><a href="${up}guests.html">Όλα τα πρόσωπα <i>→</i></a></p>
  </section>`;
}

// Surname and first name, for alphabetical sorting by surname.
function parseGuestName(fullName) {
  const s = String(fullName || '').trim();
  if (s === 'Κ.Φίλης') return { surname: 'Φίλης', firstname: 'Κ.' };
  if (s === 'Ζένια Σαριδάκη Ζώρα') return { surname: 'Σαριδάκη Ζώρα', firstname: 'Ζένια' };
  if (s === 'Ρένα Παπαδάκη - Σκαλίδη') return { surname: 'Παπαδάκη - Σκαλίδη', firstname: 'Ρένα' };
  if (s === 'Χρήστος Αρμ. Γκέζος') return { surname: 'Γκέζος', firstname: 'Χρήστος Αρμ.' };
  if (s === 'Gian Andrea Paolo Garancini') return { surname: 'Garancini', firstname: 'Gian Andrea Paolo' };

  const parts = s.split(/\s+/);
  if (parts.length <= 1) return { surname: parts[0] || '', firstname: '' };
  
  const surname = parts[parts.length - 1];
  const firstname = parts.slice(0, -1).join(' ');
  return { surname, firstname };
}

function guestsIndexPage(groups){
  const people = Object.keys(groups).map((key) => {
    const rawName = mostCommon(groups[key].names);
    const pName = parseGuestName(rawName);
    const eps = groups[key].items;
    const face = eps.find((ep) => ep.image);
    const displayName = pName.firstname ? `${pName.surname} ${pName.firstname}` : pName.surname;
    return {
      name: rawName,
      displayName,
      surname: pName.surname,
      firstname: pName.firstname,
      slug: slugify(rawName),
      n: eps.length,
      image: face ? face.image : '',
      letter: firstLetter(pName.surname),
      find: `${matchKey(pName.surname)} ${matchKey(pName.firstname)} ${matchKey(rawName)}`,
    };
  });

  const total = people.reduce((n, p) => n + p.n, 0);
  const years = [];
  for (const key of Object.keys(groups)) {
    for (const ep of groups[key].items) {
      const y = athensYear(ep.date);
      if (!Number.isNaN(y)) years.push(y);
    }
  }
  const since = years.length ? Math.min(...years) : '';

  // ---- the most frequent ----
  const top = [...people].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'el')).slice(0, 20);

  // NOT p.image: that is an episode cover, and cropped to a circle it
  // showed half a baked-in letter instead of a person. Either a portrait
  // the editor chose, or the initials.
  const faces = top.map((p) => `      <a class="face" href="guest/${p.slug}.html">
        <span class="face-pic">${photoOf(p.name)
          ? `<img src="${esc(photoOf(p.name))}" alt="" loading="lazy">`
          : avatar(p.name)}</span>
        <span class="face-name">${esc(p.name)}</span>
        <span class="face-n">${p.n === 1 ? '1 εμφάνιση' : `${p.n} εμφανίσεις`}</span>
      </a>`).join('\n');

  // ---- everyone, alphabetically ----
  const sorted = [...people].sort((a, b) => a.surname.localeCompare(b.surname, 'el') || a.firstname.localeCompare(b.firstname, 'el'));

  const letters = [];
  const rows = [];
  for (const p of sorted) {
    if (p.letter !== letters[letters.length - 1]) {
      letters.push(p.letter);
      rows.push(`      <li class="plist-mark" id="g-${p.letter}" data-letter="${p.letter}">${p.letter}</li>`);
    }
    rows.push(`      <li class="plist-row" data-find="${esc(p.find)}" data-letter="${p.letter}">
        <a href="guest/${p.slug}.html">
          <span class="plist-pic">${p.image
            ? `<img src="${p.image}" alt="" loading="lazy">`
            : avatar(p.name)}</span>
          <span class="plist-name">${esc(p.displayName)}</span>
          <span class="plist-n${p.n > OFTEN ? ' is-often' : ''}">${p.n}</span>
        </a>
      </li>`);
  }

  const abc = [
    `        <a href="#g-all" data-letter-all class="is-on">Όλα</a>`,
    ...letters.map((l) => `        <a href="#g-${l}" data-letter-pick="${l}">${l}</a>`),
  ].join('\n');

  const body = `${siteHeader()}

  <main class="guest">
    <p class="page-label">Πρόσωπα</p>
    <h1 class="guest-name">Όλοι οι καλεσμένοι</h1>
    <p class="guest-count">${people.length} πρόσωπα · ${total.toLocaleString('el')} συζητήσεις${since ? ` · από το ${since}` : ''}</p>
  </main>

  <section class="top-people">
    <h2 class="section-head">Οι πιο συχνοί</h2>
    <div class="faces">
${faces}
    </div>
  </section>

  <section class="all-people">
    <h2 class="section-head">Όλοι αλφαβητικά</h2>

    <div class="plist-tools">
      <input class="plist-find" type="search" data-people-filter
             placeholder="Βρες όνομα…" aria-label="Βρες όνομα">
      <nav class="plist-abc" aria-label="Αλφάβητο">
${abc}
      </nav>
    </div>

    <ul class="plist">
${rows.join('\n')}
    </ul>

    <p class="plist-none" hidden>Κανένα όνομα δεν ταιριάζει.</p>
  </section>`;

  return page({
    title: 'Όλοι οι καλεσμένοι — Newshub Media',
    body,
    description: `${people.length} πρόσωπα έχουν μιλήσει στο ${SITE_NAME} σε ${total.toLocaleString('el')} συζητήσεις.`,
    url: 'guests.html',
  });
}

// The first and last appearance dates in the stats line above say
// everything the removed dotted timeline used to.

function guestPage(name, list){
  const safe = esc(name);

  // Chronological, newest first. We do not rely on arrival order: if the
  // feed or the grouping changes, the page stays correct.
  const episodes = [...list].sort((a, b) => new Date(b.date) - new Date(a.date));
  const count = episodes.length;

  const key = guestKey(name);
  // The role ("καθηγητής", "αντιναύαρχος ε.α.") comes from the episode
  // title — videos do not write it the same way.
  const title = episodes.filter((x) => !einaiVideo(x)).map((ep) => titleOf(ep)).find(Boolean) || '';

  // The role, if someone writes it in the admin. It goes under the name:
  // "who is this" is the visitor's first question, and today the page
  // only answers "how many times they came".
  const role = roleOf(name);

  // The blurred backdrop comes from the most recent episode cover — baked
  // text does not matter there, because it is blurred and darkened.
  const pic = episodes.find((ep) => ep.image);

  // The portrait is a different thing: shown sharp, next to the name, and
  // only when a human chose it.
  const face = photoOf(name);

  // ---- the stats line ----
  const dates = episodes.map((ep) => new Date(ep.date).getTime())
    .filter((t) => !Number.isNaN(t));
  const seconds = episodes.reduce((n, ep) => n + (ep.seconds || 0), 0);
  const hours = seconds / 3600;

  const facts = [
    count === 1 ? '1 εμφάνιση' : `${count} εμφανίσεις`,
    dates.length ? `πρώτη ${formatDate(new Date(dates[dates.length - 1]).toISOString())}` : '',
    dates.length > 1 ? `τελευταία ${formatDate(new Date(dates[0]).toISOString())}` : '',
    // Under an hour "0 hours" says nothing; we say minutes.
    hours >= 1
      ? `${hours.toFixed(hours < 10 ? 1 : 0).replace('.', ',')} ώρες συζήτησης`
      : (seconds ? `${Math.round(seconds / 60)} λεπτά συζήτησης` : ''),
  ].filter(Boolean).join(' · ');

  // ---- talks about ----
  const topics = topicsOf(key);
  const topicTags = topics.map((t) => `      <a class="ptag" href="../${categoryUrl(t.name)}" style="--tint: var(--t-${slugify(t.name)}, var(--t-default))">
        <span class="ptag-name">${esc(t.name)}</span>
        <span class="ptag-n">${t.n}</span>
      </a>`).join('\n');

  const itemOf = (x) => (einaiVideo(x) ? itemFromVideo(x) : itemFromEpisode(x));

  // The most recent gets the large card: it is why someone opens a
  // person's page today.
  const lead = episodes[0]
    ? card({ ...itemOf(episodes[0]), lead: true }, 1)
    : '';
  const rest = episodes.slice(1).map((x) => card(itemOf(x), 1)).join('\n');

  // ---- others on the same topics ----
  const near = nearbyPeople(key).map((p) => `      <a class="pnear" href="${p.slug}.html">
        ${avatar(p.name, 'avatar--round')}
        <span class="pnear-text">
          <span class="pnear-name">${esc(p.name)}</span>
          <span class="pnear-n">${p.count === 1 ? '1 εμφάνιση' : `${p.count} εμφανίσεις`}</span>
        </span>
      </a>`).join('\n');

  const body = `${siteHeader(1)}
${pageHero(pic ? pic.image : '')}

${breadcrumb([
    { label: 'Αρχική', href: 'index.html' },
    { label: 'Πρόσωπα', href: 'guests.html' },
    { label: name },
  ], 1)}

  <main class="bio" data-pagefind-body
        data-pagefind-meta="image:${face || (pic ? pic.image : '')},type:Πρόσωπο"
        data-pagefind-filter="Είδος:Πρόσωπο">
    <header class="bio-head${face ? ' bio-head--face' : ''}">
${face ? `      <span class="bio-face"><img src="${esc(face)}" alt="${safe}" loading="eager"></span>` : ''}
      <p class="page-label">Πρόσωπο</p>
      <h1 class="bio-name">${title ? `<span class="bio-title">${esc(title)}.</span> ` : ''}${safe}</h1>
${role ? `      <p class="bio-role">${esc(role)}</p>` : ''}
      <p class="bio-facts">${facts}</p>
    </header>

${topicTags ? `    <section class="bio-topics">
      <h2 class="bio-sub">Μιλάει για</h2>
      <div class="ptags">
${topicTags}
      </div>
    </section>` : ''}

    <section class="bio-work">
      <h2 class="section-head">${count === 1 ? 'Η συζήτηση' : 'Όλες οι συζητήσεις'}</h2>
      <div class="grid bio-grid">
${lead}${rest ? `\n${rest}` : ''}
      </div>
    </section>

${/* After the person's conversations, before the "others". Same logic as
     the episode page: first what the reader came to see. */ ''}
${adSlot('guest-mid', 'leaderboard')}

${near ? `    <section class="bio-near">
      <h2 class="section-head">Άλλοι στις ίδιες ενότητες</h2>
      <div class="pnear-row">
${near}
      </div>
    </section>` : ''}
  </main>`;

  return page({
    title: `${safe} — ${SITE_NAME}`,
    body,
    depth: 1,
    description: `${name}: ${facts}. Όλες οι συμμετοχές στο ${SITE_NAME}.`,
    // In a shared message the portrait says far more than the episode
    // cover.
    image: face || (pic ? pic.image : ''),
    url: `guest/${slugify(name)}.html`,
  });
}
// How many videos each show has. Needed because a video can belong to
// several playlists — the smaller playlist is the more specific one, and
// that is the show we want to display.
let showSize;
function sizeOf(show){
  if (!showSize) {
    showSize = {};
    for (const v of loadVideos()) showSize[v.show] = (showSize[v.show] || 0) + 1;
  }
  return showSize[show] || 0;
}

// Of two entries for the same video, keep the one with the more specific show.
function moreSpecific(a, b){
  if (!a) return b;
  if (!b) return a;
  return sizeOf(b.show) < sizeOf(a.show) ? b : a;
}

// Video catalogue, keyed two ways: full title and bare topic.
let videoIndex;
function videoTwin(ep){
  if (!videoIndex) {
    videoIndex = { full: {}, head: {}, id: {} };
    for (const v of loadVideos()) {
      videoIndex.id[v.id] = v;
      const a = matchKey(v.title);
      const b = headKey(v.title);
      if (a) videoIndex.full[a] = moreSpecific(videoIndex.full[a], v);
      if (b) videoIndex.head[b] = moreSpecific(videoIndex.head[b], v);
    }
  }

  // The editor's answer comes first.
  const fix = pairOf(ep);
  if (fix && fix.novideo) return null;
  if (fix && fix.video) {
    const v = videoIndex.id[fix.video];
    if (v) return v;
    // A chosen video missing from the catalogue: deleted on YouTube, or
    // videos.json has not been re-fetched. Said out loud — otherwise the
    // editor sees the episode without video and thinks their fix was not
    // saved.
    console.warn(`ΠΡΟΣΟΧΗ: το ${ep.id} δείχνει στο βίντεο ${fix.video}, `
      + 'που δεν υπάρχει στο data/videos.json');
    // We do not fall back to guessing: episodeKeys has already gone quiet
    // for this episode, so a title match would show up here AND on its own
    // in the categories.
    return null;
  }

  return videoIndex.full[matchKey(ep.title)]
      || videoIndex.head[headKey(ep.title)]
      // The same name-and-date match, reversed. Without it the broadcast
      // date never found the video and the episode kept its Buzzsprout
      // upload time: the same interview showed as "today 20:00" in the
      // flow and "4 Nov" in the show row.
      || videoApoOnomaTwin(ep)
      || null;
}

// The reverse of twinApoOnoma: from an episode, find the video.
//
// Built by running every video through the same rule ONCE, rather than
// writing the rule a second time backwards. Two copies of a rule always
// drift.
let videoApoOnoma;
function videoApoOnomaTwin(ep){
  if (!videoApoOnoma) {
    videoApoOnoma = {};
    for (const v of loadVideos()) {
      const match = twinApoOnoma(v);
      if (match) videoApoOnoma[match.id] = moreSpecific(videoApoOnoma[match.id], v);
    }
  }
  return videoApoOnoma[ep.id] || null;
}

// Indexes for the suggestions: by show and by topic. Built once —
// otherwise each of the 1,094 pages would scan the whole catalogue to
// find four episodes.
//
// No guest index: a guest has their own page with every appearance, and
// the side panel leads there.
let relatedIndex = { byShow: {}, byCategory: {}, all: [] };
function indexRelated(episodes){
  relatedIndex = { byShow: {}, byCategory: {}, all: episodes };
  const push = (box, key, ep) => {
    if (!key) return;
    (box[key] = box[key] || []).push(ep);
  };
  for (const ep of episodes) {
    push(relatedIndex.byShow, episodeShow(ep), ep);
    for (const cat of episodeCategories(ep)) push(relatedIndex.byCategory, cat, ep);
  }
}

function relatedEpisodes(ep, max = 4){
  const show = episodeShow(ep);

  const pick = (list) => (list || [])
    .filter((x) => x.id !== ep.id)
    .slice(0, max);

  if (show) {
    const list = pick(relatedIndex.byShow[show]);
    if (list.length) return { by: 'show', label: showLabel(show), list };
  }

  const cat = episodeCategories(ep)[0];
  if (cat) {
    const list = pick(relatedIndex.byCategory[cat]);
    if (list.length) return { by: 'category', label: cat, list };
  }

  return { by: '', label: '', list: [] };
}

// Guest square, top left. We have no portraits for any of the 435 guests,
// and an episode cover is a poster, not a face. Instead: initials on a
// fixed colour — same person, same colour everywhere.
function initials(name){
  return String(name).trim().split(/\s+/).slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase();
}

// The colour comes from the name itself, so nothing needs storing and it
// never changes on its own.
function colorFor(name){
  let hue = 0;
  for (let i = 0; i < name.length; i++) hue = (hue * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${hue} 30% 26%)`;
}

function avatar(name, extra = ''){
  const cls = extra ? `avatar ${extra}` : 'avatar';
  return `<span class="${cls}" style="background:${colorFor(name)}" aria-hidden="true">${esc(initials(name))}</span>`;
}

// Both episodes and videos need this panel, so it is written once. We
// have no biographies — in their place goes something we know for
// certain: how many times this person has spoken here.
function guestPanel(name, href, count = 0, last = ''){
  if (!name) return '';

  const sub = [
    count ? (count === 1 ? '1 συμμετοχή' : `${count} συμμετοχές`) : '',
    last ? `τελευταία ${formatDate(last)}` : '',
  ].filter(Boolean).join(' · ');

  const inner = `        <span class="gbox-label">Καλεσμένος</span>
        <span class="gbox-row">
          ${avatar(name, 'avatar--round')}
          <span class="gbox-id">
            <span class="gbox-name">${esc(name)}</span>
            ${sub ? `<span class="gbox-sub">${sub}</span>` : ''}
          </span>
        </span>
        <span class="gbox-more">Όλες οι εμφανίσεις →</span>`;

  return href
    ? `      <a class="gbox" href="${href}">\n${inner}\n      </a>`
    : `      <div class="gbox">\n${inner}\n      </div>`;
}

// Show banner in the side column of the player / episode page.
function showBannerBox(show, depth = 1){
  const targetShow = show || 'Συνεντεύξεις και πρόσωπα της επικαιρότητας';
  const up = depth === 0 ? '' : '../';
  const art = showArtImg(targetShow, {
    depth,
    cls: 'side-show-art',
    sizes: '(max-width: 760px) 100vw, 360px',
    minWidth: 200,
  });
  if (!art) return '';
  return `        <div class="side-box side-box--show">
          <a class="side-show-link" href="${up}${showUrl(targetShow)}" title="Μετάβαση στην εκπομπή ${esc(showName(targetShow))}">
            ${art}
          </a>
        </div>`;
}

function guestBox(ep, depth = 1){
  const name = guestOf(ep);
  if (!name) return '';

  const key = guestKey(name);
  const g = guestIndex.find((x) => x.key === key);
  if (!g) return '';

  return guestPanel(g.name, guestHref(ep, depth), g.count, g.last);
}

// For a video: there is no guest field, so we look for one of the known
// names in the title. The photo comes from that person's episodes, not
// from the video thumbnail.
function videoGuestBox(v, depth = 1){
  const g = videoGuest(v);
  if (!g) return '';

  const up = depth === 0 ? '' : '../';
  return guestPanel(g.name, `${up}guest/${g.slug}.html`, g.count, g.last);
}

// Who is speaking, straight under the title.
//
// The side panel says it too, but on a narrow screen it falls below all
// the text — so on mobile the reader learned the guest only after the
// page ended.
function guestLine(ep, depth = 1){
  const name = guestOf(ep);
  if (!name) return '';

  const g = guestIndex.find((x) => x.key === guestKey(name));
  if (!g) return '';

  // We have no biographies. The appearance count is the one thing we know
  // for certain, and it says something: regular, or first time.
  const more = g.count > 1
    ? ` <span class="byline-count">${g.count} εμφανίσεις στο αρχείο</span>`
    : '';

  return `        <p class="episode-byline">με τον/την <a href="${guestHref(ep, depth)}">${esc(g.name)}</a>${more}</p>`;
}

// The transcript, for the page.
//
// The feed only gives a Buzzsprout URL; fetch-transcripts.js downloads them
// into data/transcripts/<id>.json. Where one is missing the section simply
// does not appear.
const transcriptCache = {};
function transcriptOf(ep){
  if (transcriptCache[ep.id] === undefined) {
    const file = path.join(TRANSCRIPT_DIR, `${ep.id}.json`);
    try {
      transcriptCache[ep.id] = fs.existsSync(file)
        ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    } catch {
      transcriptCache[ep.id] = null;
    }
  }
  return transcriptCache[ep.id];
}

// Transcript data in the shape the browser wants.
//
// Grouping happens here, not in the page: consecutive lines from the same
// speaker become one block, so the timestamp is printed once per change of
// speaker.
//
// Each line is an array [speaker, second, text] rather than an object:
// across 17,793 lines the key names would outweigh the data. The "1:02"
// form is not stored — the player derives it.
function transcriptData(ep){
  const lines = transcriptOf(ep);
  if (!lines || !lines.length) return null;

  const blocks = [];
  for (const l of lines) {
    const last = blocks[blocks.length - 1];
    if (last && last.who === l.who) last.text += ` ${l.text}`;
    else blocks.push({ who: l.who, at: l.at, text: l.text });
  }

  // We do not know speaker names — Buzzsprout gives "SPEAKER_00". We do
  // not invent any; just a number so one is visually distinct from the
  // next, with the first voice always 0.
  const order = [];
  const speaker = (who) => {
    if (!order.includes(who)) order.push(who);
    return order.indexOf(who) % 4;
  };

  return {
    words: blocks.reduce((n, b) => n + b.text.split(' ').length, 0),
    lines: blocks.map((b) => [speaker(b.who), b.at, b.text]),
  };
}

function transcriptFile(ep){
  return `transcript/${ep.id}.json`;
}

// The section shell. The text itself does NOT go in here.
//
// Inlining it took pages from 21KB to 76KB, and worse: the transcript is
// machine-made and gets words and names wrong, so Google could show it as
// a snippet, attributing to named people words they never said.
//
// This keeps the useful part — find a moment, tap, the audio jumps there —
// without it becoming published text. The word count comes from the build
// so the heading is complete before anything downloads.
//
// SWITCHED OFF until further notice: the quality is not publishable.
// Broken Greek and, above all, wrong proper names. The switch hides both
// the section and the Buzzsprout link, otherwise the same words would just
// show up elsewhere. The data stays in data/transcripts/ and
// fetch-transcripts.js keeps downloading it; one line back to true brings
// it all back.
const TRANSCRIPTS_ON = false;

function transcriptSection(ep){
  if (!TRANSCRIPTS_ON) return '';

  const data = transcriptData(ep);
  if (!data) return '';

  return `        <details class="transcript" data-transcript="../${transcriptFile(ep)}">
          <summary class="transcript-head">
            <span class="transcript-title">Απομαγνητοφώνηση</span>
            <span class="transcript-note">${data.words.toLocaleString('el-GR')} λέξεις · αυτόματη, μπορεί να έχει λάθη</span>
          </summary>
          <div class="transcript-body" data-transcript-body>
            <p class="transcript-hint">Πάτα μια ώρα για να πάει ο ήχος εκεί.</p>
            <p class="transcript-load">Φορτώνει…</p>
          </div>
        </details>`;
}

// The other platforms — where else the podcast can be heard. Each button
// carries its brand mark, name, and the arrow that says you are leaving.
function platformsRow(){
  return PLATFORMS
    .map(([name, url, brand, icon]) => `<a class="plat" href="${url}" target="_blank" rel="noopener" style="--brand:${brand}">
          <svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>
          <span>${name}</span>
          <i>↗</i>
        </a>`)
    .join('\n        ');
}

function episodePage(ep){
  const title = esc(decode(ep.headline));
  const season = ep.season ? `Σεζόν ${ep.season}` : '';
  const show = episodeShow(ep);
  const twin = videoTwin(ep);
  const cats = episodeCategories(ep);

  const meta = [
    formatDate(ep.date),
    formatDuration(ep.seconds),
    season,
    ...cats.map((c) => `<a href="../${categoryUrl(c)}">${esc(c)}</a>`),
  ].filter(Boolean).join(' · ');

  // The podcast's artwork stands in where the episode has none — see
  // podcastArt(). The page is about audio: with no picture at all the
  // player sits over a hole.
  const art = ep.image || podcastArt();

  const stage = twin
    ? `        <div class="stage-media" data-embed="${twin.embed}" hidden>
          <img src="${twin.image}" alt="" loading="lazy">
          <button type="button" class="video-play" aria-label="Αναπαραγωγή">▶</button>
        </div>
        <div class="stage-art">
          ${art ? `<img src="${art}" alt="" loading="lazy">` : ''}
        </div>`
    : `        <div class="stage-art">
          ${art ? `<img src="${art}" alt="" loading="lazy">` : ''}
        </div>`;

  // One criterion, stated in the heading. Show names come in every gender
  // and number, so the article is spelled out per show — see SHOW_SE.
  // Anything missing falls back to quotes, which work for any name.
  const rel = relatedEpisodes(ep);
  const queueHead = rel.by === 'show'
    ? `Επόμενο ${esc(showSe(rel.label))}`
    : `Επόμενο στην κατηγορία «${esc(rel.label)}»`;

  const queue = rel.list.map((x) => `      <a class="queue-row" href="${path.basename(episodeUrl(x))}">
        ${x.image ? `<img src="${x.image}" alt="" loading="lazy">` : '<span class="queue-blank"></span>'}
        <span class="queue-text">
          <span class="queue-title">${esc(decode(x.headline))}</span>
          <span class="queue-meta">${[formatDate(x.date), formatDuration(x.seconds)].filter(Boolean).join(' · ')}</span>
        </span>
      </a>`).join('\n');

  // The switch only makes sense when both media exist. "Ακούω" keeps
  // is-on so it agrees with the stage above: the switch must show what is
  // ALREADY playing.
  const toggle = twin
    ? `      <div class="modes">
        <button type="button" class="mode" data-mode="video">Βλέπω</button>
        <button type="button" class="mode is-on" data-mode="audio">Ακούω</button>
      </div>`
    : '';

  // One list, two readers: the crumbs the visitor sees and the
  // BreadcrumbList Google reads. Change the path and both change.
  const crumbs = [
    { label: 'Αρχική', href: 'index.html' },
    show ? { label: showName(show), href: showUrl(show) } : null,
    { label: decode(ep.headline) },
  ];

  const body = `${siteHeader(1)}
${pageHero(art)}

${breadcrumb(crumbs, 1)}

  <main class="episode" data-pagefind-body
        data-pagefind-meta="image:${art},type:Podcast,date:${formatDate(ep.date)},duration:${formatDuration(ep.seconds)}"
        data-pagefind-filter="Είδος:Podcast${show ? `,Εκπομπή:${esc(showLabel(show))}` : ''}${cats.map((c) => `,Κατηγορία:${esc(c)}`).join('')}">
    <div class="episode-grid">
      <div class="episode-main">
${stage}

${playerView({
    id: ep.id,
    src: ep.audio,
    title: decode(ep.headline),
    show: showLabel(show) || 'Podcast',
    art: ep.image || '',
    href: path.basename(episodeUrl(ep)),
  })}

        <div class="strip">
${toggle}
          <button type="button" class="act" data-player="speed">1×</button>
          <button type="button" class="act act-save">+ Στη λίστα μου</button>
          <button type="button" class="act act-share">Κοινοποίηση</button>
          <span class="strip-note">Η θέση σου κρατιέται σε κάθε συσκευή</span>
        </div>

        ${cats[0] ? `<p class="card-label">${esc(cats[0])}</p>` : ''}
        <h1 class="episode-title">${title}</h1>
${guestLine(ep, 1)}
        <p class="episode-meta">${meta}</p>
${summaryHtml(ep.summary)}

${/* The line exists ONLY if it has a link inside. With transcripts
     switched off it would be empty on 438 pages, and .episode-links
     reserves space on its own. */ ''}
${(() => {
  const links = [
    twin ? `<a href="${twin.url}" target="_blank" rel="noopener">Άνοιγμα στο YouTube ↗</a>` : '',
    TRANSCRIPTS_ON && ep.transcript && !transcriptOf(ep)
      ? `<a href="${ep.transcript}" target="_blank" rel="noopener">Απομαγνητοφώνηση ↗</a>` : '',
  ].filter(Boolean);

  return links.length
    ? `        <p class="episode-links">\n          ${links.join('\n          ')}\n        </p>`
    : '';
})()}

${transcriptSection(ep)}

${/* The only slot on an episode page, placed HERE on purpose: after the
     content, before the suggestions. The player sits at the top, so the
     whole page separates them — "no ad inside or above the player". */ ''}
${adSlot('episode-mid', 'leaderboard')}

${/* And a second one, MPU shaped. Below the first, not beside it: the
     episode page has no side column on mobile, and two layouts for one
     slot would mean two reserved heights to maintain. */ ''}
${adSlot('episode-side', 'mpu')}

        ${queue ? `<section class="queue">
          <h2 class="section-head">${queueHead}</h2>
${queue}
        </section>` : ''}
      </div>

      <aside class="episode-side">
${guestBox(ep, 1)}
${showBannerBox(show, 1)}


        <div class="side-box">
          <p class="side-head">Άκου ή δες όπου θέλεις</p>
          <nav class="platforms-links platforms-stack">
        ${platformsRow()}
          </nav>
        </div>
      </aside>
    </div>
  </main>`;

  return page({
    title: `${title} — ${SITE_NAME}`,
    body,
    depth: 1,
    description: ep.summary,
    image: art,
    url: episodeUrl(ep),
    type: 'article',
    // A podcast episode, not an article: it has audio, duration and a
    // series. associatedMedia points at the real Buzzsprout mp3 — the same
    // URL our player uses.
    jsonld: [
      {
        '@type': 'PodcastEpisode',
        '@id': `${absUrl(episodeUrl(ep))}#episode`,
        url: absUrl(episodeUrl(ep)),
        name: ldText(ep.headline),
        description: ldText(stripBoilerplate(ep.summary), 300),
        datePublished: ldDate(ep.date),
        image: absAsset(art),
        inLanguage: 'el',
        timeRequired: ldDuration(ep.seconds),
        associatedMedia: {
          '@type': 'AudioObject',
          contentUrl: ep.audio || '',
          encodingFormat: 'audio/mpeg',
          duration: ldDuration(ep.seconds),
        },
        partOfSeries: show ? {
          '@type': 'PodcastSeries',
          name: showName(show),
          url: absUrl(showUrl(show)),
        } : null,
        keywords: cats.join(', '),
        publisher: LD_PUB,
      },
      ldCrumbs(crumbs),
    ],
  });
}

function main(){
  // Parsed, with corrected dates and sorted — see loadEpisodes.
  const episodes = loadEpisodes();

  const videoItems = videosOnce().filter((v) => !videoHasTwin(v));
  const groups = groupByGuest([...episodes, ...videoItems]);
  indexGuestSlugs(groups);
  indexPeople(groups);
  indexRelated(episodes);


  // The 5 banners: one large and four below. Podcasts and news share one
  // pool — importance decides, not type.
  const curation = loadCuration();
  const articles = loadNews();
  const ownArticles = loadOwnArticles();
  const videos = loadVideos();
  const showGroups = buildShows(videos, episodes);

  // Topic groups are needed HERE, before the homepage is written: the
  // filter strip and the four topic rows come out of them.
  const catGroups = buildCategories(videos, episodes, ownArticles);
  indexMenu(showGroups, catGroups);

  // ---- What did not get classified ----
  //
  // Both category and show are guessed: the first from title words, the
  // second from the twin video's YouTube playlist. Both fail SILENTLY —
  // the episode simply appears nowhere, and nobody looks for something
  // they do not know is missing. So we count them out loud on every
  // build. Both are fixed from the admin, one by one.
  const dixosKat = episodes.filter((ep) => !episodeCategories(ep).length);
  const dixosEkp = episodes.filter((ep) => !videoTwin(ep));

  const pos = (n) => `${n} από ${episodes.length}`
    + ` (${(n * 100 / episodes.length).toFixed(1)}%)`;

  console.log(`Χωρίς κατηγορία: ${pos(dixosKat.length)}`);
  console.log(`Χωρίς εκπομπή:   ${pos(dixosEkp.length)}`);

  // The overall share hides the only thing that matters: whether what is
  // published NOW is classified correctly. Old gaps are fixed once from
  // the admin; a new one that slips through is a fault.
  const edo = Date.now() - 90 * 864e5;
  const fres = episodes.filter((ep) => new Date(ep.date).getTime() > edo);
  if (fres.length) {
    const fk = fres.filter((ep) => !episodeCategories(ep).length).length;
    const fe = fres.filter((ep) => !videoTwin(ep)).length;
    console.log(`  στις τελευταίες 90 μέρες (${fres.length}): `
      + `${fk} χωρίς κατηγορία, ${fe} χωρίς εκπομπή`);
  }

  // A video can live in several playlists. One entry per video, under its
  // most specific show — otherwise the card would say "Συνεντεύξεις"
  // while its own page says "Αναλύσεις".
  const seenVideo = {};
  for (const v of videos) seenVideo[v.id] = moreSpecific(seenVideo[v.id], v);
  const uniqueVideos = Object.values(seenVideo)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const pool = [
    // Ours first: few and handwritten, so when they exist they deserve at
    // least equal footing with what was pulled automatically.
    ...ownArticles.map((a) => ({ ...itemFromOwnArticle(a), id: a.id })),
    ...articles.map((a) => ({ ...itemFromArticle(a), id: a.id, featured: a.featured })),
    ...uniqueVideos.slice(0, 20).map((v) => ({ ...itemFromVideo(v), id: v.id })),
    ...episodes.slice(0, 40).map((ep) => ({ ...itemFromEpisode(ep), id: ep.id })),
  ];

  if (curation.featured && !pool.some((it) => sameItem(it, curation.featured))) {
    const want = String(curation.featured).trim();
    const epMatch = episodes.find((ep) => sameItem({ id: ep.id, href: episodeUrl(ep) }, want));
    if (epMatch) {
      pool.push({ ...itemFromEpisode(epMatch), id: epMatch.id });
    } else {
      const vidMatch = videos.find((v) => sameItem({ id: v.id, href: videoUrl(v) }, want));
      if (vidMatch) {
        pool.push({ ...itemFromVideo(vidMatch), id: vidMatch.id });
      }
    }
  }

  // Did the editor pick an article with NO body?
  //
  // Then it will not open here — it leaves for newshub.gr, silently,
  // while the editor thinks it was published on the Media channel. It
  // happens when they pick one older than fetch-news.js keeps. We do not
  // fix it automatically (the build never downloads), but we do not let
  // it pass in silence either.
  for (const want of [curation.featured, ...(curation.mustRead || [])].filter(Boolean)) {
    const hit = articles.find((a) => sameItem({ id: a.id, href: a.url }, want));
    if (hit && !articleBody(hit.id)) {
      console.warn(`ΠΡΟΣΟΧΗ: το επιλεγμένο άρθρο «${hit.title.slice(0, 50)}» δεν έχει κείμενο`);
      console.warn('  Ανοίγει στο newshub.gr αντί για εδώ. Τρέξε «node fetch-news.js» και ξαναχτίσε.');
    }
  }

  const featured = pickFeatured(pool, curation);

  // The four secondary cards under the hero are gone: the flow follows
  // the big card directly. pickSecondary stays in the code and works —
  // two lines here bring it back.
  //
  // Only the hero is held out of the flow now.
  const onTop = new Set([featured.href]);

  // The flow under the banners. The 24 most recent are visible, and the 6
  // most recent of EVERY topic are hidden inside it. So tapping
  // "Tech-Hub" — 33 items, none among the 24 — has something to show
  // without loading anything.
  const flow = [];
  const inFlow = new Set();
  const pushFlow = (item) => {
    if (inFlow.has(item.href)) return;
    if (onTop.has(item.href)) return;      // already in the banners
    inFlow.add(item.href);
    flow.push(item);
  };

  // Pinned items FIRST, in the order the journalist set.
  //
  // Before anything else: if they came after our own articles, the order
  // in the admin would not be the order on the page — which is exactly
  // what it is there to control.
  const pinned = pinnedFlow(curation, [
    { list: episodes, make: (ep) => itemFromEpisode(ep) },
    { list: uniqueVideos, make: (v) => itemFromVideo(v) },
    { list: ownArticles, make: (a) => itemFromOwnArticle(a) },
    { list: articles, make: (a) => itemFromArticle(a) },
  ]);
  for (const it of pinned) pushFlow(it);

  const soloShows = uniqueVideos.filter((v) =>
    v.show && !FLOW_SKIP_SHOWS.has(v.show) && !videoHasTwin(v));

  // Mixed and sorted TOGETHER: otherwise yesterday's video would sit
  // below a podcast from the day before.
  //
  // Our own articles go in here too, by their date. They used to go
  // first regardless of age, which put a week-old article above today's
  // episodes. Position is earned by time, not by type; anything that must
  // stay high regardless gets pinned.
  const recent = [
    ...episodes.slice(0, 40).map(itemFromEpisode),
    ...soloShows.slice(0, 40).map(itemFromVideo),
    ...ownArticles.map(itemFromOwnArticle),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  // Automatic filling. If pinned items exceed the nine slots we keep them
  // ALL: a human asked for them, and we do not silently drop what someone
  // asked to be visible.
  const room = Math.max(FLOW_VISIBLE, flow.length);
  const kryfoFlow = kryfa('latest');
  for (const it of recent) {
    if (kryfoFlow(it)) continue;        // a human took it out with the ✕
    pushFlow(it);
    if (flow.length >= room) break;
  }

  for (const key of Object.keys(catGroups)) {
    for (const it of catGroups[key].items.slice(0, FLOW_PER_TOPIC)) {
      pushFlow({ ...it, extra: true });    // hidden while we show "all"
    }
  }

  const seira = flow.slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const rank = new Map(seira.map((it, i) => [it, i]));

  const list = flow.map((it) => card(it, 0, rank.get(it))).join('\n');

  const html = page({
    // The tab shows the first twenty characters or so, and the homepage
    // title is the one Google leans on hardest. It was the bare name,
    // which says nothing to anyone who has not been here before.
    title: `${SITE_NAME} — podcast και βίντεο από την Κρήτη`,
    // Only here: the ticker exists only on the homepage, and we do not
    // load scripts on 4,700 pages that do not need them.
    scripts: ['roi.js'],
    body: `${siteHeader()}

${heroBanner(featured)}

${/* Straight after the lead story, before the flow. The most valuable
     slot on the site — but BELOW the hero, never above: the homepage
     opens with one full-width story, and an ad above would make it
     second. */ ''}
${adSlot('home-hero', 'leaderboard')}

  <section class="band band--latest">
${/* Just "Τελευταία", not "Τελευταία επεισόδια": the flow carries
     articles and videos too. The heading has to be true about what is
     under it. */ ''}
${bandMark('Lat', 'est', '      <h1 data-flow-head>Τελευταία</h1>')}

${topicStrip(catGroups)}

    <div class="flow" data-topic="all">
      <div class ="grid">
    ${list}
      </div>
      <p class="flow-all"><a data-flow-all href="episodes.html">Όλα τα επεισόδια →</a></p>
    </div>
  </section>

${adSlot('home-top', 'billboard')}

${/* Shows go OUTSIDE the two columns on purpose: inside the left column
     the posters came out 226px wide, too small to read the show name
     baked into them. Full width fits three large ones. */ ''}
${showsSection(showGroups)}

${/* Must read sits between the shows and the topics: our own material
     has been shown, and the reader gets a pause with news before the deep
     part of the page. */ ''}
${mustReadSection(articles, curation, onTop)}

${/* Opinions right below: same source, same box, different kind of
     reading. News says what happened, opinion says who claims it — hence
     the article photo there and the face here. */ ''}
${opinionsSection(articles, curation)}

${/* After Must read, before the topics: whoever left something half-read
     finds it before the deep part of the page. For everyone else the
     section does not exist, so the approved layout is untouched. */ ''}
${resumeSection()}

${/* Right after: "what you left unfinished" and "what you saved for
     later" are the same conversation, and both sections appear only to
     someone who already has history. */ ''}
${listaSection()}

  <div class="page-cols">
    <div class="page-main">
${topicRows(catGroups)}

${namesSection(groups)}

${/* The homepage's second slot. Between "Πρόσωπα" and "Και ακόμα":
     that is where the main body ends and the page's tail begins — a
     pause, not an interruption. The first slot (home-top) sits much
     higher, so the two are not neighbours. */ ''}
${adSlot('home-mid', 'leaderboard')}

${moreTopics(catGroups)}

${spotlightSections(catGroups)}
    </div>

    <div class="page-side">
${/* ABOVE the ticker, on purpose, and the only position that works.
     The whole column used to be sticky, so anything inside followed the
     scroll — exactly the ad that chases the reader. Now only the ticker
     is sticky (.ticker in styles.css) and the ad stays put.

     Below the ticker does not work: a sticky element keeps its space but
     paints offset, so it would scroll over the ad. Above it, the ticker
     travels down and never meets it. */ ''}
${adSlot('home-side', 'mpu')}

${newsTicker(articles)}
    </div>
  </div>

${intro(episodes[0], videos[0])}`,
    // Site identity, once, here. Every other page refers to the same
    // organisation by the same @id.
    //
    // SearchAction tells Google we have our own search; it works only
    // because search.html now reads ?q= (see searchPage).
    jsonld: [
      ldOrg(),
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#site`,
        url: `${SITE_URL}/`,
        name: SITE_NAME,
        inLanguage: 'el',
        publisher: { '@id': `${SITE_URL}/#org` },
        potentialAction: {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
          },
          'query-input': 'required name=search_term_string',
        },
      },
    ],
  });

  fs.mkdirSync(PUBLIC_DIR, { recursive: true }); //creation of the public directory if it doesn't exist

  // Logos live in public/shows/ — committed, not generated.

  writeIfChanged(path.join(PUBLIC_DIR, 'index.html'), html); //writes the generated HTML to the index.html file

  const pinnedHrefs = new Set(pinned.map((it) => it.href));
  const shown = flow.filter((it) => !it.extra);

  // Plus a few spares below: when a journalist removes something with the
  // ✕, the freed slot must be filled with WHAT THE SITE WOULD PUT there.
  //
  // Hidden items stay out of the spares too: the reserve is exactly "what
  // the site would show", and the site does not show them.
  const shownHrefs = new Set(shown.map((it) => it.href));
  const reserve = recent
    .filter((it) => !shownHrefs.has(it.href) && !onTop.has(it.href) && !kryfoFlow(it))
    .slice(0, 6);

  const flowRow = (it, extra) => Object.assign({
    kind: it.kind,
    href: it.href,
    title: it.title,
    who: it.name || it.label || '',
    image: it.image || '',
    date: it.date,
    pinned: pinnedHrefs.has(it.href),
  }, extra);

  writeIfChanged(path.join(PUBLIC_DIR, 'flow.json'), JSON.stringify({
    slots: FLOW_VISIBLE,
    items: shown.map((it) => flowRow(it))
      .concat(reserve.map((it) => flowRow(it, { reserve: true }))),
  }, null, 2));
  // Build fingerprint: when it ran, and the newest item it knows about.
  //
  // It exists so someone outside can ask the live site how old it is.
  // check-fresh.js looks at OUR data and answers a different question —
  // if the deploy breaks, data keeps arriving and that check stays green
  // while the site is frozen. See check-live.js.
  //
  // Deliberately not through writeIfChanged: the timestamp changes on
  // every build, which is exactly what we want to measure.
  fs.writeFileSync(path.join(PUBLIC_DIR, 'build.json'), JSON.stringify({
    pote: new Date().toISOString(),
    neotero: [...episodes, ...articles]
      .map((x) => x.date)
      .filter(Boolean)
      .sort()
      .pop() || null,
  }), 'utf8');

  writeIfChanged(path.join(PUBLIC_DIR, 'guests.html'), guestsIndexPage(groups));
  writeIfChanged(path.join(PUBLIC_DIR, 'search.html'), searchPage(episodes, catGroups));
  writeIfChanged(path.join(PUBLIC_DIR, 'shows.html'), showsIndexPage(showGroups));

  // The full episode archive, paginated.
  const archivePages = pageCount(episodes.length);
  const expectedArchive = new Set();
  for (let p = 1; p <= archivePages; p++) {
    const name = pagedName('episodes', p);
    expectedArchive.add(name);
    writeIfChanged(path.join(PUBLIC_DIR, name), episodesPage(episodes, p));
  }

  // Episode pages. Compared against what is already on disk so only the
  // changed ones are written — otherwise every build would touch all
  // 1,094 files for nothing.
  fs.mkdirSync(EPISODE_DIR, { recursive: true });
  let written = 0;
  for (const ep of episodes) {
    const file = path.join(PUBLIC_DIR, episodeUrl(ep));
    const next = episodePage(ep);
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (current === next) continue;
    fs.writeFileSync(file, next, 'utf8');
    written++;
  }
  
  // Facebook share pages, one per news item. Tiny files, written only
  // when they change, and the ones whose article fell out of the rolling
  // window are deleted — the queue may still hold a link to them, but a
  // dead share page is better than a stale one.
  fs.mkdirSync(SHARE_DIR, { recursive: true });
  const expectedShare = new Set();
  let shareWritten = 0;
  for (const a of articles) {
    if (!a.id || !a.url) continue;
    expectedShare.add(`${a.id}.html`);
    if (writeIfChanged(path.join(PUBLIC_DIR, shareUrl(a)), sharePage(a))) shareWritten++;
  }
  let shareRemoved = 0;
  for (const file of fs.readdirSync(SHARE_DIR)) {
    if (!file.endsWith('.html')) continue;
    if (expectedShare.has(file)) continue;
    fs.unlinkSync(path.join(SHARE_DIR, file));
    shareRemoved++;
  }
  console.log(`Σελίδες μοιράσματος: ${expectedShare.size} συνολικά, ${shareWritten} γράφτηκαν, ${shareRemoved} σβήστηκαν`);

  const expected = new Set(episodes.map((ep) => path.basename(episodeUrl(ep))));
  let removed = 0;
  for(const file of fs.readdirSync(EPISODE_DIR)){
    if(!file.endsWith('.html')) continue;
    if(expected.has(file)) continue;
    fs.unlinkSync(path.join(EPISODE_DIR, file));
    removed++;
  }

  // Transcripts, in separate files the player fetches only when someone
  // opens the section. See transcriptSection for why they are not inside
  // the pages.
  fs.mkdirSync(TRANSCRIPT_OUT, { recursive: true });
  const expectedTr = new Set();
  let trWritten = 0;
  for (const ep of TRANSCRIPTS_ON ? episodes : []) {
    const data = transcriptData(ep);
    if (!data) continue;
    const name = path.basename(transcriptFile(ep));
    expectedTr.add(name);
    const file = path.join(TRANSCRIPT_OUT, name);
    const next = JSON.stringify(data);
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (current === next) continue;
    fs.writeFileSync(file, next, 'utf8');
    trWritten++;
  }

  let trRemoved = 0;
  for (const file of fs.readdirSync(TRANSCRIPT_OUT)) {
    if (!file.endsWith('.json') || expectedTr.has(file)) continue;
    fs.unlinkSync(path.join(TRANSCRIPT_OUT, file));
    trRemoved++;
  }

  fs.mkdirSync(GUEST_DIR,{recursive:true});
  const expectedGuests = new Set();
  let guestsWritten = 0;
  for (const key of Object.keys(groups)){
    const group = groups[key];
    const name = mostCommon(group.names);   // the spelling that appears most often
    const slug = slugify(name);             // ...and the URL comes from it

    // The loose key merges, the slug names — so two groups can in theory
    // ask for the same file. We say so instead of silently writing one
    // over the other.
    if (expectedGuests.has(`${slug}.html`)) {
      console.warn(`ΠΡΟΣΟΧΗ: δύο καλεσμένοι ζητούν το guest/${slug}.html — ο «${name}» δεν γράφτηκε`);
      continue;
    }
    expectedGuests.add(`${slug}.html`);

    const file = path.join(GUEST_DIR,`${slug}.html`);
    const next = guestPage(name,group.items);
    const current = fs.existsSync(file) ? fs.readFileSync(file,'utf8') : null;
    if(current === next) continue;
    fs.writeFileSync(file, next, 'utf8');
    guestsWritten++;

  }

  let guestsRemoved = 0;
  for (const file of fs.readdirSync(GUEST_DIR)){
    if (!file.endsWith('html')) continue;
    if (expectedGuests.has(file)) continue;
    fs.unlinkSync(path.join(GUEST_DIR,file));
    guestsRemoved++;
  }

  // Video pages — same pattern as episodes.
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  // A video can appear in several playlists. One page per video, under
  // its most specific show.
  const best = {};
  for (const v of videos) {
    const name = path.basename(videoUrl(v));
    best[name] = moreSpecific(best[name], v);
  }

  const expectedVideos = new Set();
  let videosWritten = 0;
  for (const name of Object.keys(best)) {
    const v = best[name];
    expectedVideos.add(name);

    const file = path.join(VIDEO_DIR, name);
    const next = videoPage(v, '');
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (current === next) continue;
    fs.writeFileSync(file, next, 'utf8');
    videosWritten++;
  }

  let videosRemoved = 0;
  for (const file of fs.readdirSync(VIDEO_DIR)) {
    if (!file.endsWith('.html')) continue;
    if (expectedVideos.has(file)) continue;
    fs.unlinkSync(path.join(VIDEO_DIR, file));
    videosRemoved++;
  }

  // Topic pages — same pattern. The groups were built earlier, because the
  // homepage needed them too.
  fs.mkdirSync(CATEGORY_DIR, { recursive: true });
  const expectedCats = new Set();
  let catsWritten = 0;
  for (const key of Object.keys(catGroups)) {
    const pages = pageCount(catGroups[key].items.length);
    for (let p = 1; p <= pages; p++) {
      const name = pagedName(key, p);
      const file = path.join(CATEGORY_DIR, name);
      expectedCats.add(name);
      const next = categoryPage(catGroups[key], p);
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (current === next) continue;
      fs.writeFileSync(file, next, 'utf8');
      catsWritten++;
    }
  }

  let catsRemoved = 0;
  for (const file of fs.readdirSync(CATEGORY_DIR)) {
    if (!file.endsWith('.html')) continue;
    if (expectedCats.has(file)) continue;
    fs.unlinkSync(path.join(CATEGORY_DIR, file));
    catsRemoved++;
  }

  writeIfChanged(path.join(PUBLIC_DIR, 'categories.html'), categoriesIndexPage(catGroups));

  // Article pages — the ones with a body in data/news-bodies/.
  //
  // Written AFTER the categories on purpose: an article shows its
  // category, and 4 of their 16 categories have no page of ours. Without
  // the check the article pointed at a 404.
  //
  // Leftovers are NOT deleted. An article drops out of must-read within
  // hours, but its page may already be shared or indexed; deleting it
  // would turn that into a 404. The folder grows with the bodies, and
  // fetch-news.js keeps those bounded.
  fs.mkdirSync(ARTICLE_DIR, { recursive: true });
  const hasCatPage = (cat) => !!cat && expectedCats.has(path.basename(categoryUrl(cat)));

  // OUR OWN first. They share a folder with the republished ones — for
  // the reader they are the same thing — but if two articles land on the
  // same name, ours wins and we say so loudly. A silent overwrite means a
  // journalist wrote an article that never appeared.
  const ownTaken = new Set();
  let ownWritten = 0;
  for (const a of ownArticles) {
    const file = path.join(ARTICLE_DIR, `${a.id}.html`);
    ownTaken.add(`${a.id}.html`);
    if (writeIfChanged(file, ownArticlePage(a, hasCatPage(a.category)))) ownWritten++;
  }

  // Journalist pages. One per byline, and orphans are deleted — otherwise
  // a page lives forever listing articles that changed byline or were
  // removed.
  const writerGroups = writersFrom(ownArticles);
  const WRITER_DIR = path.join(PUBLIC_DIR, 'arthrografos');
  fs.mkdirSync(WRITER_DIR, { recursive: true });

  let writersWritten = 0;
  const writersWanted = new Set();
  for (const [name, list] of writerGroups) {
    const file = path.basename(writerUrl(name));
    writersWanted.add(file);
    if (writeIfChanged(path.join(WRITER_DIR, file), writerPage(name, list))) writersWritten++;
  }

  let writersRemoved = 0;
  for (const file of fs.readdirSync(WRITER_DIR)) {
    if (!file.endsWith('.html') || writersWanted.has(file)) continue;
    fs.unlinkSync(path.join(WRITER_DIR, file));
    writersRemoved++;
  }

  console.log(`Δημοσιογράφοι: ${writersWritten} γράφτηκαν, ${writerGroups.size} συνολικά`
    + (writersRemoved ? `, ${writersRemoved} σβήστηκαν` : ''));

  let artWritten = 0;
  let artSkipped = 0;
  let artClash = 0;
  for (const a of articles) {
    const body = articleBody(a.id);
    if (!body) { artSkipped++; continue; }
    if (ownTaken.has(`${a.id}.html`)) {
      console.warn(`ΠΡΟΣΟΧΗ: σύγκρουση ονόματος «${a.id}» — κρατάω το δικό μας άρθρο, η αναδημοσίευση δεν γράφεται.`);
      artClash++;
      continue;
    }
    const hasCat = hasCatPage(a.category);
    const file = path.join(ARTICLE_DIR, `${a.id}.html`);
    if (writeIfChanged(file, articlePage(a, body, hasCat))) artWritten++;
  }

  // ---- Orphaned article pages, header only ----
  //
  // Republished pages are not deleted when they leave the flow (reason
  // above), but they are never rewritten either: their body is gone from
  // data/news-bodies/, so the build CANNOT regenerate them. They stay
  // frozen with the header of the day they were written — which left 799
  // of them still calling Google for fonts.
  //
  // Here we change ONLY the two font lines. When none are left the loop
  // finds nothing and costs nothing.
  const paliesFonts = /[ \t]*<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com"[^>]*>\r?\n[ \t]*<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>\r?\n/;
  const neesFonts = `${FONT_PRELOAD
    .map((f) => `  <link rel="preload" href="../fonts/${f}" as="font" type="font/woff2" crossorigin>`)
    .join('\n')}\n`;

  let artFixed = 0;
  for (const name of fs.readdirSync(ARTICLE_DIR)) {
    if (!name.endsWith('.html')) continue;
    const file = path.join(ARTICLE_DIR, name);
    const html = fs.readFileSync(file, 'utf8');
    if (!paliesFonts.test(html)) continue;
    fs.writeFileSync(file, html.replace(paliesFonts, neesFonts), 'utf8');
    artFixed++;
  }
  if (artFixed) {
    console.log(`  ${artFixed} παλιές σελίδες άρθρων: η κεφαλίδα τους δεν ζητά πια γραμματοσειρές από τη Google`);
  }

  // Show pages — same pattern: write what changed, delete the orphans.
  fs.mkdirSync(SHOW_DIR, { recursive: true });
  const expectedShows = new Set();
  let showsWritten = 0;
  for (const key of Object.keys(showGroups)) {
    const pages = pageCount(showGroups[key].items.length);
    for (let p = 1; p <= pages; p++) {
      const name = pagedName(key, p);
      const file = path.join(SHOW_DIR, name);
      expectedShows.add(name);
      const next = showPage(showGroups[key], p);
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (current === next) continue;
      fs.writeFileSync(file, next, 'utf8');
      showsWritten++;
    }
  }

  let showsRemoved = 0;
  for (const file of fs.readdirSync(SHOW_DIR)) {
    if (!file.endsWith('.html')) continue;
    if (expectedShows.has(file)) continue;
    fs.unlinkSync(path.join(SHOW_DIR, file));
    showsRemoved++;
  }

  // The three files every site needs that are not pages: 404, the sitemap
  // for Google, and the robots instructions.
  writeIfChanged(path.join(PUBLIC_DIR, '404.html'), notFoundPage());
  writeIfChanged(path.join(PUBLIC_DIR, 'aporrito.html'), privacyPage());

  // transcript/ stays out. Nothing links there — the player fetches them
  // — but we say it explicitly: machine transcripts get names wrong, and
  // we do not want them as search results for words nobody said.
  writeIfChanged(path.join(PUBLIC_DIR, 'robots.txt'),
    `User-agent: *\nAllow: /\nDisallow: /transcript/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);

  // ads.txt declares who may sell space here. Without it many buyers do
  // not bid at all. The f08c47... id is Google's, the same for everyone.
  //
  // Only written when the switch is on: an ads.txt naming a network that
  // is not actually serving is a lie to the buyers.
  if (ADSENSE) {
    writeIfChanged(path.join(PUBLIC_DIR, 'ads.txt'),
      `google.com, ${ADSENSE.replace(/^ca-/, '')}, DIRECT, f08c47fec0942fa0\n`);
  }

  // Every page with content goes into the sitemap. The search page stays
  // out: it has nothing of its own to show Google.
  const sitemap = [
    { loc: '' },
    { loc: 'shows.html' },
    { loc: 'categories.html' },
    { loc: 'guests.html' },
    // In the sitemap on purpose: AdSense and every compliance check looks
    // for the privacy page and wants it indexed.
    { loc: 'aporrito.html' },
    ...[...expectedArchive].map((n) => ({ loc: n })),
    ...episodes.map((ep) => ({ loc: episodeUrl(ep), date: ep.date })),
    ...Object.keys(best).map((n) => ({ loc: `video/${n}`, date: best[n].date })),
    // Every page, not just the first — otherwise we built 85 pages nobody
    // will ever find.
    ...[...expectedShows].map((n) => ({ loc: `show/${n}` })),
    ...[...expectedCats].map((n) => ({ loc: `category/${n}` })),
    ...[...expectedGuests].map((n) => ({ loc: `guest/${n}` })),
    // ONLY our own articles. Republished newshub.gr pieces stay out: they
    // declare their canonical elsewhere, so they do not ask to be indexed
    // for themselves.
    ...ownArticles.map((a) => ({ loc: ownArticleUrl(a), date: a.date })),
    // And our journalists' pages: our content, stable addresses, worth
    // finding through search.
    ...[...writerGroups.keys()].map((name) => ({
      loc: writerUrl(name),
      date: writerGroups.get(name)[0].date,
    })),
  ];
  writeIfChanged(path.join(PUBLIC_DIR, 'sitemap.xml'), sitemapXml(sitemap));
  console.log(`Κατάλογος sitemap.xml: ${sitemap.length} διευθύνσεις`);

  console.log('Η αρχική δημιουργήθηκε στο public/index.html');
  console.log(`Σελίδες βίντεο: ${videosWritten} γράφτηκαν, ${videosRemoved} σβήστηκαν`);
  console.log(`Σελίδες θεμάτων: ${catsWritten} γράφτηκαν, ${catsRemoved} σβήστηκαν`);
  console.log(`Δικά μας άρθρα: ${ownWritten} γράφτηκαν, ${ownArticles.length} δημοσιευμένα συνολικά`);
  console.log(`Αναδημοσιεύσεις: ${artWritten} γράφτηκαν, ${artSkipped} χωρίς σώμα μένουν στο newshub.gr${artClash ? `, ${artClash} σε σύγκρουση` : ''}`);
  console.log(`Σελίδες εκπομπών: ${showsWritten} γράφτηκαν, ${showsRemoved} σβήστηκαν`);
  
console.log(`Σελίδες επεισοδίου: ${written} γράφτηκαν, ${episodes.length - written} ήταν ήδη ενημερωμένες, ${removed} σβήστηκαν`);
  console.log(TRANSCRIPTS_ON
    ? `Απομαγνητοφωνήσεις: ${expectedTr.size} συνολικά, ${trWritten} γράφτηκαν, ${trRemoved} σβήστηκαν`
    : `Απομαγνητοφωνήσεις: ΚΑΤΕΒΑΣΜΕΝΕΣ μέχρι νεωτέρας${trRemoved ? ` — ${trRemoved} σβήστηκαν τώρα` : ''}`);
console.log(`Σελίδες καλεσμένων: ${guestsWritten} γράφτηκαν, ${guestsRemoved} σβήστηκαν`);

  // ---- the admin ----
  //
  // Its source lives in admin/ and is copied here. Not written straight
  // into public/, because .gitignore drops all of public/ as generated.
  // Copy, not move: admin/ stays the source.
  const ADMIN_SRC = path.join(__dirname, 'admin');
  const ADMIN_OUT = path.join(PUBLIC_DIR, 'admin');
  let adminFiles = 0;

  // Which category the site gives each episode and video TODAY.
  //
  // The admin has to show the editor the automatic suggestion, otherwise
  // they do not know what they are correcting. Only this file knows that
  // logic (suggestCategories) and we do not copy it into the UI: two
  // copies drift. Generated, out of git — 4,800 entries have no place in
  // every commit.
  if (fs.existsSync(ADMIN_SRC)) {
    const autoCats = {};
    for (const ep of episodes) autoCats[ep.id] = suggestCategories(ep.title);
    for (const v of videos) autoCats[v.id] = suggestCategories(v.title);

    const catsFile = path.join(ADMIN_SRC, 'auto-categories.json');
    const catsText = JSON.stringify(autoCats);
    if (!fs.existsSync(catsFile) || fs.readFileSync(catsFile, 'utf8') !== catsText) {
      fs.writeFileSync(catsFile, catsText, 'utf8');
    }

    // People inventory — same logic, same reason. Generated, out of git.
    const peopleFile = path.join(ADMIN_SRC, 'people.json');
    // Videos too: once they create people, those people must show up
    // here, or the editor sees a name on the site that is not a person and
    // has nowhere to remove it.
    const peopleText = JSON.stringify(peopleForAdmin([...episodes, ...videoItems]));
    if (!fs.existsSync(peopleFile) || fs.readFileSync(peopleFile, 'utf8') !== peopleText) {
      fs.writeFileSync(peopleFile, peopleText, 'utf8');
    }

    const topicsFile = path.join(ADMIN_SRC, 'topics.json');
    const topicsText = JSON.stringify({
      defaults: {
        featured: FEATURED_TOPICS,
        spotlight: SPOTLIGHT_TOPICS.map(([name]) => name),
      },
      // How many days a manual pick lives, per list. The build knows
      // (PIN_ZOI) and sends it, so the admin shows the truth instead of a
      // second copy that drifts.
      pinLife: PIN_ZOI,
      list: Object.keys(catGroups)
        .map((key) => ({ name: catGroups[key].name, key, n: catGroups[key].items.length }))
        .sort((a, b) => b.n - a.n),
    });
    if (!fs.existsSync(topicsFile) || fs.readFileSync(topicsFile, 'utf8') !== topicsText) {
      fs.writeFileSync(topicsFile, topicsText, 'utf8');
    }

    // Pairing inventory: which episodes found no video or guest.
    // Generated, out of git.
    const todoFile = path.join(ADMIN_SRC, 'pairs-todo.json');
    const todoText = JSON.stringify(pairsForAdmin(episodes));
    if (!fs.existsSync(todoFile) || fs.readFileSync(todoFile, 'utf8') !== todoText) {
      fs.writeFileSync(todoFile, todoText, 'utf8');
    }
  }

  // The admin does NOT go to the live site until there is a gate in front
  // of it. Locally serve.js serves it straight from admin/. Once
  // Cloudflare Access is in place, ADMIN_PUBLIC=1 opens it — and only
  // then.
  if (!process.env.ADMIN_PUBLIC) {
    // Anything a previous build uploaded goes now.
    if (fs.existsSync(ADMIN_OUT)) {
      fs.rmSync(ADMIN_OUT, { recursive: true, force: true });
      console.log('Διαχειριστικό: αφαιρέθηκε από το public/ (δεν υπάρχει ακόμα πύλη εισόδου)');
    } else {
      console.log('Διαχειριστικό: δεν ανεβαίνει στο site (τοπικά στο /admin/ κανονικά)');
    }
  } else if (fs.existsSync(ADMIN_SRC)) {
    fs.mkdirSync(ADMIN_OUT, { recursive: true });
    for (const file of fs.readdirSync(ADMIN_SRC)) {
      const from = path.join(ADMIN_SRC, file);
      if (!fs.statSync(from).isFile()) continue;
      const to = path.join(ADMIN_OUT, file);
      let next = fs.readFileSync(from);

      // Version stamp on the admin CSS and JS.
      //
      // These are static files, so Cloudflare tells the browser to keep
      // them for four hours. Without the stamp a UI fix never reached an
      // editor's phone within the same shift. Same pattern as
      // assetVersion() for the site.
      if (file === 'index.html') {
        const tag = (name) => crypto.createHash('md5')
          .update(fs.readFileSync(path.join(ADMIN_SRC, name)))
          .digest('hex').slice(0, 8);

        next = Buffer.from(String(next)
          .replace('href="admin.css"', `href="admin.css?v=${tag('admin.css')}"`)
          .replace('src="admin.js"', `src="admin.js?v=${tag('admin.js')}"`));
      }
      // Write only what changed, or publish.js thinks pages were touched
      // and rebuilds the search index for nothing.
      if (!fs.existsSync(to) || !fs.readFileSync(to).equals(next)) {
        fs.writeFileSync(to, next);
        adminFiles++;
      }
    }
    console.log(`Διαχειριστικό: ${adminFiles} αρχεία αντιγράφηκαν ΣΤΟ SITE (ADMIN_PUBLIC=1)`);
  }

  // How many files were touched. publish.js uses it to decide whether the
  // search index is worth rebuilding. "writes" counts the one-off pages —
  // homepage, topics, archive, sitemap.
  return written + removed + guestsWritten + guestsRemoved
    + showsWritten + showsRemoved + videosWritten + videosRemoved
    + catsWritten + catsRemoved + writes + adminFiles;
}

// Runs on its own when called directly (node build.js). When required
// by another file it just exports main.
if (require.main === module) {
  main();
} else {
  module.exports = { main };
}
