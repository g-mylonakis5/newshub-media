const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, 'data/episodes.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const EPISODE_DIR = path.join(PUBLIC_DIR, 'episode');
const GUEST_DIR = path.join(PUBLIC_DIR,'guest');
// Πόσες κάρτες φαίνονται στη ροή της αρχικής. Κρατιέται μικρή επίτηδες:
// από κάτω υπάρχει σύνδεσμος για ολόκληρο το αρχείο.
const HOW_MANY = 9;
const CURATION_FILE = path.join(__dirname, 'data/curation.json');
const NEWS_FILE = path.join(__dirname, 'data/news.json');
const VIDEO_FILE = path.join(__dirname, 'data/videos.json');
const TRANSCRIPT_DIR = path.join(__dirname, 'data/transcripts');
const TRANSCRIPT_OUT = path.join(__dirname, 'public/transcript');
const ALIAS_FILE = path.join(__dirname, 'data/people-aliases.json');
// Οι χειροκίνητες διορθώσεις στο ζευγάρωμα, γραμμένες στο διαχειριστικό.
const PAIRS_FILE = path.join(__dirname, 'data/pairs.json');
// Η λογική «ποιες γραφές είναι ο ίδιος άνθρωπος» ζει εκεί, και τη
// δανειζόμαστε για να γράψουμε τις προτάσεις στο διαχειριστικό.
const { suggestFamilies } = require('./find-aliases.js');
const SHOW_ART_FILE = path.join(__dirname, 'data/show-art.json');
const SHOWS_FILE = path.join(__dirname, 'data/shows.json');
const SHOW_DIR = path.join(PUBLIC_DIR, 'show');
const ARTICLE_DIR = path.join(PUBLIC_DIR, 'arthro');
// Τα σώματα των ειδήσεων του newshub.gr. ΔΕΝ είναι το data/articles.json
// — εκείνο το γράφει το διαχειριστικό και κρατάει τα δικά μας άρθρα.
const NEWS_BODY_DIR = path.join(__dirname, 'data/news-bodies');
// Τα δικά μας άρθρα, γραμμένα στο διαχειριστικό.
const OWN_ARTICLES_FILE = path.join(__dirname, 'data/articles.json');
const VIDEO_DIR = path.join(PUBLIC_DIR, 'video');
const CATEGORY_DIR = path.join(PUBLIC_DIR, 'category');

// Η τελική διεύθυνση του site. Χρειάζεται για τις κάρτες κοινοποίησης,
// το canonical και το sitemap — όλα θέλουν ΠΛΗΡΗ διεύθυνση, όχι σχετική.
// Άλλαξέ τη μόλις κλειδώσει το domain.
const SITE_URL = 'https://newshubmedia.gr';
const SITE_NAME = 'Newshub Media';

const GREEK = {
  'α':'a','β':'v','γ':'g','δ':'d','ε':'e','ζ':'z','η':'i','θ':'th',
  'ι':'i','κ':'k','λ':'l','μ':'m','ν':'n','ξ':'x','ο':'o','π':'p',
  'ρ':'r','σ':'s','ς':'s','τ':'t','υ':'y','φ':'f','χ':'ch','ψ':'ps','ω':'o'
};

// Οι τίτλοι έρχονται από το RSS με κωδικοποιημένα σύμβολα: &quot; αντί
// για " και &amp; αντί για &. Το decode τα κάνει κανονικούς χαρακτήρες,
// το esc τα ξαναγράφει ασφαλή για HTML. Πάντα decode πρώτα, esc μετά.
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

// Κείμενο -> κομμάτι διεύθυνσης. Το decode πρώτα, αλλιώς το &quot;
// του τίτλου γίνεται η λέξη "quot" μέσα στο link.
function slugify(text){
  const full = decode(text).toLowerCase()
    // Τα διαλυτικά σημαίνουν «μη διαβάσεις τα δύο φωνήεντα μαζί». Πρέπει
    // να λυθούν ΠΡΙΝ τους κανόνες των διφθόγγων, αλλιώς το «Αϋφαντής»
    // περνάει από το αυ -> av και βγαίνει avfantis αντί για ayfantis.
    .replace(/[ΐϊ]/g, 'i').replace(/[ΰϋ]/g, 'y')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ου/g, 'ou').replace(/αυ/g, 'av').replace(/ευ/g, 'ev')
    .split('').map((ch) => GREEK[ch] || ch).join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (full.length <= 55) return full;              // χωράει ολόκληρο, δεν κόβουμε
  return full.slice(0, 55).replace(/-[^-]*$/, ''); // κόπηκε -> φεύγει η μισή λέξη
}

function episodeUrl(ep) {
  const number = ep.id.replace(/\D/g, '');
  // ep.slug είναι ο ΑΥΘΕΝΤΙΚΟΣ τίτλος, πριν τις διορθώσεις του
  // συντάκτη. Η διεύθυνση δεν αλλάζει ποτέ — δες το loadEpisodes.
  return `episode/${number}-${slugify(ep.slug || ep.headline)}.html`;
}


const MONTHS=['Ιαν','Φεβ','Μαρ','Απρ','Μαϊ','Ιουν','Ιουλ','Αυγ','Σεπ','Οκτ','Νοε','Δεκ'];

// ---- Η ώρα είναι ΠΑΝΤΑ ελληνική ----
//
// Το getHours() και τα αδέλφια του δίνουν την ώρα ΤΟΥ ΜΗΧΑΝΗΜΑΤΟΣ ΠΟΥ
// ΧΤΙΖΕΙ. Τοπικά αυτό είναι Ελλάδα και όλα δείχνουν σωστά· στο
// Cloudflare είναι UTC, και κάθε ώρα στο site έβγαινε ΔΥΟ ΩΡΕΣ ΠΙΣΩ.
// Το είδε το αφεντικό στις 7 Νοεμβρίου 2026, βάζοντας δίπλα-δίπλα το
// newshub.gr (19:20) και το δικό μας (17:20).
//
// Ήταν αθέατο ακριβώς επειδή τοπικά δούλευε. Γι' αυτό καμία ημερομηνία
// δεν τυπώνεται πια κατευθείαν: όλες περνούν από εδώ.
//
// Δεν υπολογίζουμε μόνοι μας UTC+2/+3 — η θερινή ώρα αλλάζει χωρίς να
// μας ρωτήσει κανείς, και η Node ξέρει ήδη την απάντηση.
const ATHENS = 'Europe/Athens';
const athensFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: ATHENS,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit',
  hourCycle: 'h23',          // αλλιώς τα μεσάνυχτα βγαίνουν «24:00»
  weekday: 'short',
});

const DAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Τα κομμάτια μιας στιγμής, όπως τα βλέπει κάποιος στην Κρήτη.
function athens(iso){
  const d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d)) return null;

  const p = {};
  for (const part of athensFmt.formatToParts(d)) p[part.type] = part.value;

  return {
    year: +p.year,
    month: +p.month - 1,        // 0-11, όπως το getMonth()
    day: +p.day,
    hour: p.hour,               // κείμενο, ήδη με μηδενικό μπροστά
    minute: p.minute,
    weekday: DAY_INDEX[p.weekday] ?? 0,
  };
}

// Το έτος του, στην Ελλάδα. Το ζητάμε συχνά και σκέτο.
function athensYear(iso){
  const a = athens(iso);
  return a ? a.year : NaN;
}
// Για ό,τι βγήκε σήμερα ή χθες γράφουμε «σήμερα 14:20» αντί για σκέτη
// ημερομηνία — δείχνει αμέσως τι είναι φρέσκο.
//
// ΠΡΟΣΟΧΗ: το «σήμερα» υπολογίζεται τη ΣΤΙΓΜΗ ΤΟΥ BUILD. Σε στατικό site
// αυτό σημαίνει ότι μια σελίδα φτιαγμένη στις 23:50 λέει «σήμερα» και
// μισή ώρα μετά έχει άδικο. Αντέχει γιατί ξαναχτίζουμε κάθε δύο ώρες·
// αν ποτέ αραιώσει αυτό, το «σήμερα» πρέπει να φύγει.
function formatDate(iso){
  if(!iso) return '';
  const a = athens(iso);
  if (!a) return '';

  // Και το «σήμερα» μετριέται με ελληνικά μεσάνυχτα: αλλιώς, ένα
  // χτίσιμο στη 01:30 ώρα Ελλάδας θα έλεγε «χθες» για κάτι που μόλις
  // βγήκε, επειδή στο UTC η μέρα δεν έχει αλλάξει ακόμα.
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

// Η μπάρα του μόνιμου player. Υπάρχει σε ΚΑΘΕ σελίδα, κρυμμένη, και
// εμφανίζεται μόλις ξεκινήσει κάτι να παίζει. Επειδή ζει έξω από το
// #page, η πλοήγηση δεν την αγγίζει και ο ήχος δεν κόβεται.
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

// Το κοινό περίβλημα κάθε σελίδας, ώστε το <head> να γράφεται μία φορά.
// Το depth λέει πόσο βαθιά κάθεται το αρχείο, για να βρει το styles.css:
// 0 = public/index.html, 1 = public/episode/κάτι.html
// Κάθε περιγραφή του Buzzsprout έχει γύρω από το κείμενο πράγματα που
// είναι ίδια σε όλα τα επεισόδια: μπροστά «🎙️(ημερομηνία) Τα podcasts
// του Newshub.gr», και πίσω μια ουρά με hashtags και συνδέσμους προς
// Apple, Spotify, YouTube, facebook, twitter, instagram, TikTok.
//
// Η ουρά είναι κατά μέσο όρο 560 χαρακτήρες — πιο μεγάλη από όσο
// χωράει μια κάρτα — και δεν λέει τίποτα για το συγκεκριμένο επεισόδιο.
// Κόβουμε στο πρώτο σημάδι της και κρατάμε ό,τι είναι από πάνω.
const SUMMARY_TAIL = [
  // «To κανάλι μας στα Apple podcasts», «στη σελίδα μας στο facebook»,
  // «στο κανάλι μας στο Youtube». Το «To» γράφεται άλλοτε με λατινικό
  // και άλλοτε με ελληνικό o — γι' αυτό δέχεται και τα δύο.
  /\s*(?:[TΤ][oο]\s+|στ[ηοα]\s+)?(?:σελίδα|κανάλι)\s+μας\s+στ/u,
  /\s*Μας τιμάτε/u,
  /\s*@Newshub/iu,
  /\s*(?:Ακολουθήστε|Βρείτε) μας/u,
  /\s*Support the show/i,
  /\s*https?:\/\//u,
  /\s*#\s*[\p{L}\d]/u,
  // Σε 2 επεισόδια το «🎙️(ημερομηνία) Τα podcasts του Newshub.gr» δεν
  // είναι μπροστά αλλά στη μέση: μπαίνει μετά από μια σειρά πραγματικού
  // κειμένου. Από το μικρόφωνο και μετά, τίποτα δεν αφορά το επεισόδιο.
  /\s*🎙/u,
];

// Το μικρόφωνο στην αρχή γράφεται με πέντε διαφορετικούς τρόπους:
//   🎙️(12/10/2026) ·  🎙️ 27/11/2024 ·  🎙️10/05/2025
//   (🎙️ 3/2/2025) ·  🎙️(Το podcast μεταδόθηκε στις …) ·  🎙️ σκέτο
// Ένας κανόνας για όλα: προαιρετική παρένθεση, το μικρόφωνο, μετά είτε
// παρένθεση με ό,τι έχει μέσα είτε σκέτη ημερομηνία.
const SUMMARY_LEAD = [
  /^\(?\s*🎙️?\s*(?:\([^)]*\)|\d{1,2}\/\d{1,2}\/\d{2,4})?\s*\)?\s*/u,
  /^Τα podcasts του Newshub\.?gr\s*/i,
];

function stripBoilerplate(text){
  // Τα κενά μαζεύονται ΜΕΣΑ στη γραμμή. Οι αλλαγές γραμμής είναι οι
  // παράγραφοι του Buzzsprout και πρέπει να φτάσουν ως το summaryHtml —
  // ένα σκέτο \s+ τις έτρωγε, και η περιγραφή έβγαινε ένα κατεβατό.
  let t = String(text || '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

  // Σε βρόχο, γιατί έρχονται και με την αντίστροφη σειρά: άλλοτε
  // «🎙️(ημερομηνία) Τα podcasts του Newshub.gr», άλλοτε το ανάποδο.
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

// Κόβει σε καθαρό μήκος για περιγραφή — χωρίς να σπάει λέξη στη μέση.
function clip(text, max = 160){
  // Μονή γραμμή: πάει σε <meta description> και σε κάρτες.
  const t = stripBoilerplate(text).replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

// Σε 18 επεισόδια η περιγραφή απαριθμεί τα σημεία της συζήτησης με
// παύλες: εισαγωγή, μετά « - » και κάθε θέμα χωριστά. Σε αυτά φτιάχνουμε
// λίστα· στα υπόλοιπα μένει μια παράγραφος.
//
// Η παύλα πρέπει να έρχεται μετά από τέλος πρότασης ΚΑΙ να ακολουθείται
// από κεφαλαίο. Χωρίς αυτόν τον περιορισμό έσπαγαν 174 περιγραφές στη
// μέση, γιατί η ίδια παύλα χρησιμοποιείται και μέσα στην πρόταση:
// «Μαιευτήρας - Γυναικολόγος», «Ελλάδας – Κύπρου», «τα πάνω - κάτω».
const SUMMARY_POINT = /(?<=[.;!?»])\s+[-–]\s+(?=[Α-ΩΆΈΉΊΌΎΏΪΫA-Z«])/u;

function summaryHtml(text){
  const t = stripBoilerplate(text);
  if (!t) return '';

  // Αληθινές παράγραφοι, όπως τις έγραψε ο συντάκτης στο Buzzsprout.
  // Όταν υπάρχουν, δεν μαντεύουμε: τις σεβόμαστε όπως είναι.
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

// Σφραγίδα έκδοσης για styles.css και player.js.
//
// Ο browser κρατάει τα αρχεία αυτά στη μνήμη του — σωστά, γιατί αλλιώς
// θα τα κατέβαζε σε κάθε σελίδα. Όταν όμως τα αλλάζουμε, συνεχίζει να
// δείχνει τα παλιά: νέο HTML με παλιά στυλ, που μοιάζει με χαλασμένη
// σελίδα. Με τη σφραγίδα, η διεύθυνση αλλάζει μόλις αλλάξει το αρχείο,
// οπότε είναι υποχρεωμένος να κατεβάσει το νέο.
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

// ---- καθαρές διευθύνσεις ----
//
// Στον δίσκο τα αρχεία μένουν .html — έτσι τα σερβίρει το Cloudflare
// Pages. Στους συνδέσμους όμως το .html δεν φαίνεται πουθενά.
//
// Δεν είναι καλλωπισμός. Το Pages κάνει 308 κάθε /x.html σε /x, οπότε
// κάθε κλικ πλήρωνε ένα περιττό ταξίδι. Και το player.js, που πλοηγεί
// μόνο του για να μη σταματά ο ήχος, έγραφε στη μπάρα διευθύνσεων το
// href αυτούσιο: ο επισκέπτης έβλεπε «newshubmedia.gr/index.html».
//
// Γίνεται σε ΕΝΑ σημείο, πάνω στην έτοιμη σελίδα, αντί σε πενήντα
// σημεία που φτιάχνουν href. Δύο αντίγραφα ενός κανόνα αποκλίνουν.
function cleanUrl(u){
  if (!u) return u;
  return u
    .replace(/(^|\/)index\.html(?=$|[#?])/, '$1')
    .replace(/\.html(?=$|[#?])/, '');
}

function cleanHref(u){
  if (!u || u.startsWith('#') || u.startsWith('mailto:')) return u;

  // Ξένοι σύνδεσμοι μένουν ΑΚΡΙΒΩΣ όπως είναι: το .html τους δεν είναι
  // δικό μας θέμα, και το newshub.gr όντως σερβίρει τέτοιες διευθύνσεις.
  if (/^(https?:)?\/\//.test(u) && !u.startsWith(SITE_URL)) return u;

  const out = cleanUrl(u);

  // Άδειο href σημαίνει «η τρέχουσα σελίδα» — όχι η αρχική. Το σκέτο
  // «index.html» γίνεται «./», που από οποιοδήποτε βάθος δείχνει σωστά.
  return out === '' ? './' : out;
}

// Περνάει την έτοιμη σελίδα και καθαρίζει ΟΛΟΥΣ τους συνδέσμους. Το
// data-href μπαίνει κι αυτό: είναι ο σύνδεσμος που κουβαλάει η μόνιμη
// μπάρα του player όταν αλλάζει σελίδα.
function cleanLinks(html){
  return html.replace(/\b(href|data-href)="([^"]*)"/g,
    (m, attr, u) => `${attr}="${cleanHref(u)}"`);
}

function page({ title, body, depth = 0, scripts = [], description = '', image = '', url = '', type = 'website', prev = '', next = '', canonical = '' }){
  const up = depth === 0 ? '' : '../';
  // Ο player φορτώνει ΠΑΝΤΟΥ: κρατάει τον ήχο ζωντανό και αναλαμβάνει την
  // πλοήγηση, οπότε πρέπει να υπάρχει και στις σελίδες που δεν παίζουν ήχο.
  const tags = ['player.js'].concat(scripts.filter((s) => s !== 'player.js'))
    .map((s) => `  <script src="${up}${s}${assetVersion(s)}" defer></script>`)
    .join('\n');

  const desc = esc(clip(description || 'Podcasts, βίντεο και συζητήσεις του newshub.gr — από την Κρήτη και τον κόσμο.'));
  // Με κάθετο στο τέλος — ίδια γραφή με τον κατάλογο sitemap.xml, ώστε η
  // Google να μη βλέπει δύο διευθύνσεις για την ίδια αρχική.
  const full = `${SITE_URL}/${cleanUrl(url)}`;
  const pic = image || `${SITE_URL}/intro.jpg`;

  // Το canonical δείχνει κανονικά στη ΔΙΚΗ μας διεύθυνση. Εξαίρεση: οι
  // σελίδες άρθρων του newshub.gr, που δηλώνουν πρωτότυπο το δικό τους.
  // Έτσι ο αναγνώστης διαβάζει εδώ, αλλά η Google μετράει την αξία εκεί
  // — αυτός είναι όλος ο σκοπός, το SEO του newshub.gr.
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
  <!-- Η κάρτα που εμφανίζεται όταν μοιράζεται ο σύνδεσμος.
       Ο τίτλος φτάνει εδώ ήδη περασμένος από esc() — δεν τον ξαναπερνάμε,
       γιατί το &quot; θα γινόταν &amp;quot; και θα φαινόταν στην κάρτα. -->
  <meta property="og:type" content="${type}">
  <meta property="og:site_name" content="${SITE_NAME}">
  <meta property="og:locale" content="el_GR">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${desc}">
  <meta property="og:url" content="${full}">
  <meta property="og:image" content="${pic}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${desc}">
  <meta name="twitter:image" content="${pic}">

  <link rel="icon" href="${up}shows/logo-icon.png" type="image/png" sizes="512x512">
  <link rel="apple-touch-icon" href="${up}shows/logo-icon.png">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Commissioner:wght@400..900&family=Source+Serif+4:wght@400..600&display=swap">
  <link rel="stylesheet" href="${up}styles.css${assetVersion('styles.css')}">
${tags}
</head>
<body>
<div id="page">
${body}

${adSlot('footer', 'leaderboard')}

${siteFooter(depth)}
</div>

${playerBar()}

</body>
</html>
`);
}


// Τα σόσιαλ του newshub.gr. Τα εικονίδια είναι SVG γραμμένα μέσα στη
// σελίδα — μηδέν εξωτερικό αρχείο, μηδέν βιβλιοθήκη εικονιδίων.
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

// Ο καιρός έρχεται έτοιμος από το data/weather.json — δεν τον ζητάει ο
// browser. Αν λείπει το αρχείο, η λωρίδα δείχνει μόνο τα σόσιαλ.
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

// Το διαβάζουμε μία φορά και το κρατάμε — αλλιώς θα ανοίγαμε το ίδιο
// αρχείο 1.500 φορές, μία για κάθε σελίδα.
let weatherCache;
function weather(){
  if (weatherCache === undefined) weatherCache = loadWeather();
  return weatherCache;
}

// Εικονίδια καιρού, ένα ανά οικογένεια κωδικών WMO. Γραμμένα μέσα στη
// σελίδα, όπως και τα σόσιαλ.
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

  // ΔΕΝ είναι πια ξεχωριστή λωρίδα. Ο καιρός και τα κοινωνικά δίκτυα
  // κατεβαίνουν στη γραμμή του μενού, αριστερά· η ημερομηνία πάει δίπλα
  // στο σήμα. Η παλιά πάνω λωρίδα έφευγε — ήταν μια τρίτη οριζόντια
  // ζώνη που έτρωγε ύψος χωρίς να λέει κάτι.
  return { weather: w, social: `<nav class="social">${socialLinks()}</nav>`, today: todayLabel() };
}

const DAYS = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];
const MONTHS_FULL = ['Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου', 'Ιουνίου',
  'Ιουλίου', 'Αυγούστου', 'Σεπτεμβρίου', 'Οκτωβρίου', 'Νοεμβρίου', 'Δεκεμβρίου'];

function todayLabel(){
  const a = athens(new Date());
  return `${DAYS[a.weekday]}, ${a.day} ${MONTHS_FULL[a.month]} ${a.year}`;
}

// Το σλόγκαν και η φράση από κάτω. Γράφονται ΕΔΩ και πουθενά αλλού.
// Προσωρινή διατύπωση — περιμένει την τελική από το αφεντικό.
const SLOGAN = 'Ενημέρωση που αξίζει να έχεις.';
const TAGLINE = 'Podcasts και βίντεο του newshub.gr — συζητήσεις, αναλύσεις και πρόσωπα, από την Κρήτη και τον κόσμο.';

// Η φωτογραφία της λωρίδας. Μπαίνει ως public/intro.jpg όποτε υπάρχει·
// μέχρι τότε η λωρίδα στέκει μόνη της, χωρίς κενό και χωρίς σπασμένη
// εικόνα. Υποστηρίζονται jpg, png και webp.
function introImage(){
  for (const name of ['intro.jpg', 'intro.png', 'intro.webp']) {
    if (fs.existsSync(path.join(PUBLIC_DIR, name))) return name;
  }
  return '';
}

function intro(newestEpisode, newestVideo){
  const img = introImage();

  // ΕΝΑ κουμπί. Το σλόγκαν λέει «ιστορίες που αξίζει να ακούς», οπότε το
  // κουμπί οδηγεί στο πιο πρόσφατο επεισόδιο — όχι στο βίντεο.
  const cta = newestEpisode
    ? `<a class="intro-cta" href="${episodeUrl(newestEpisode)}">♪ Άκουσε το τελευταίο</a>`
    : (newestVideo ? `<a class="intro-cta" href="${videoUrl(newestVideo)}">▶ Δες το τελευταίο</a>` : '');

  // Με εικόνα: τα λόγια κάθονται ΠΑΝΩ της, με σκίαση βαθμιαία από
  // αριστερά — ο κανόνας του claude.md, όχι συμπαγής μαύρη λωρίδα.
  // Χωρίς εικόνα: σκέτο κείμενο, χωρίς κενό.
  return `  <section class="intro${img ? ' intro--photo' : ''}">
    ${img ? `<img class="intro-bg" src="${img}" alt="" fetchpriority="high">` : ''}
    <div class="intro-text">
      <h2 class="intro-slogan">${esc(SLOGAN)}</h2>
      <p class="intro-sub">${esc(TAGLINE)}</p>

      ${cta}
    </div>
  </section>`;
}

// Ψίχουλα πλοήγησης: Αρχική → Εκπομπή → Κατηγορία → ο τίτλος.
// Όσα βήματα δεν έχουν δεδομένα απλώς λείπουν — δεν αφήνουμε κενά σκαλιά.
// Το τελευταίο κομμάτι είναι πάντα κείμενο, όχι σύνδεσμος: είσαι ήδη εκεί.
// Θολό υπόβαθρο στην κορυφή μιας σελίδας, φτιαγμένο από μια εικόνα που
// έχουμε ήδη: το εξώφυλλο του επεισοδίου, η φωτογραφία του καλεσμένου,
// η κάρτα της εκπομπής, το πιο πρόσφατο επεισόδιο του θέματος.
//
// Το θόλωμα μπαίνει στην ΕΙΚΟΝΑ, σε δικό της στοιχείο — ποτέ στο κείμενο.
// Αν έμπαινε στον γονέα, θα θόλωνε και τα γράμματα από πάνω.
//
// Το ύψος είναι μηδέν ώστε να μη σπρώχνει τίποτα προς τα κάτω: κάθεται
// πίσω από τα ψίχουλα και την κορυφή του περιεχομένου.
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

// Οι θεσμικές σελίδες ΔΕΝ ξαναγράφονται εδώ: υπάρχουν στο newshub.gr και
// ισχύουν για τον ίδιο εκδότη. Δείχνουμε εκεί, αντί να βάλουμε νεκρό
// κείμενο ή να φτιάξουμε δεύτερο αντίγραφο που θα μείνει πίσω.
const LEGAL = [
  ['Ταυτότητα', 'https://www.newshub.gr/el/taytotita'],
  ['Επικοινωνία', 'https://www.newshub.gr/el/epikoinonia'],
  ['Όροι χρήσης', 'https://www.newshub.gr/el/oroi-chrisis'],
  ['Πολιτική Cookies', 'https://www.newshub.gr/el/politiki-cookies'],
];

// Το υποσέλιδο ακολουθεί τη δομή του newshub.gr: σύνδεσμοι στο κέντρο,
// σόσιαλ από κάτω, σήμα, και χωριστή γραμμή με τα δικαιώματα.
// Θέση διαφήμισης. ΜΟΝΟ ο χώρος — το δίκτυο δεν έχει επιλεγεί ακόμα.
//
// Οι απαιτήσεις του αφεντικού, κατά λέξη: καμία διαφήμιση δεν σκεπάζει
// περιεχόμενο, κάθε θέση έχει δεσμευμένο ύψος από την αρχή, φορτώνουν
// τελευταίες, καμία μέσα ή πάνω από τον player. Οι τρεις πρώτες
// κρίνονται εδώ, η τέταρτη στο πού καλείται αυτή η συνάρτηση.
//
// Το ύψος το δεσμεύει το CSS μέσω της κλάσης, ΟΧΙ inline style: έτσι
// το responsive μένει σε ένα σημείο. Γι' αυτό κάθε νέο όνομα θέσης
// χρειάζεται και κανόνα .ad--<όνομα> στο styles.css, αλλιώς βγαίνει
// με ύψος μηδέν και ξαναγυρίζει το layout shift που αποφεύγουμε.
//
//   place  — πού κάθεται· μπαίνει ως data-ad, εκεί θα κρεμάσει το
//            δίκτυο το δικό του div όταν έρθει η ώρα
//   size   — ποια κλάση μεγέθους, από το styles.css
function adSlot(place, size){
  return `  <aside class="ad ad--${size}" data-ad="${place}" aria-label="Διαφήμιση">
    <span class="ad-note">Διαφήμιση</span>
  </aside>`;
}

// Παρεμβάλλει θέσεις ανάμεσα στις κάρτες μιας λίστας.
//
// Ανά 20 και όχι πυκνότερα: η σελίδα δείχνει 60 κάρτες, οπότε βγαίνουν
// δύο θέσεις — μαζί με τη θέση του footer, τρεις σε όλη τη σελίδα.
// Το ύφος που ζητήθηκε είναι «πολύς αέρας, λίγα στοιχεία ανά οθόνη».
//
// ΠΟΤΕ στο τέλος: εκεί ακολουθεί ήδη η θέση του footer, και δύο
// διαφημίσεις η μία πάνω στην άλλη μοιάζουν με σελίδα-σκουπίδι.
const CARDS_PER_AD = 20;

// Είναι η λίστα ΟΛΗ βίντεο; Τότε οι κάρτες της παίρνουν πλαίσιο 16:9
// αντί για τετράγωνο, και οι μικρογραφίες του YouTube γεμίζουν χωρίς
// θολό πάνω-κάτω. Δες .grid--wide στο styles.css.
//
// «Σχεδόν όλα» και όχι «όλα»: η Αγροτική επικαιρότητα έχει 59 βίντεο
// και ΕΝΑ podcast, και με απαίτηση για καθαρή λίστα έμενε αδιόρθωτη —
// 59 κάρτες με θολό εξαιτίας μιας. Η μοναδική τετράγωνη αφίσα ΔΕΝ
// κόβεται: μπαίνει ολόκληρη μέσα στο φαρδύ πλαίσιο, με το θολό της.
// Δες .grid--wide .card[data-kind="podcast"] στο styles.css.
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
      out.push(adSlot(`${place}-${i / CARDS_PER_AD}`, 'leaderboard'));
    }
    out.push(html);
  });

  return out.join('\n');
}

// ---- η κυματομορφή του player ----
//
// ΔΙΑΚΟΣΜΗΤΙΚΗ, όχι αληθινή: ΔΕΝ δείχνει πού μιλάει κάποιος και πού
// υπάρχει σιωπή. Το λέμε καθαρά εδώ ώστε να μην το ανακαλύψει κανείς
// με έκπληξη σε έξι μήνες.
//
// Γιατί όχι αληθινή: τα 1.059 επεισόδια είναι 25,7 GB. Για πραγματικά
// peaks πρέπει να κατέβουν όλα και να περάσουν από ffmpeg. Γίνεται —
// σταδιακά στο GitHub Actions, όπως οι απομαγνητοφωνήσεις — αλλά είναι
// δουλειά ημερών και η προθεσμία είναι κοντά. Αν γίνει, αλλάζει ΜΟΝΟ
// αυτή η συνάρτηση: η όψη και ο player μένουν ως έχουν.
//
// Σταθερή ανά επεισόδιο: βγαίνει από το id, άρα το ίδιο επεισόδιο
// δείχνει πάντα την ίδια κυματομορφή — σε κάθε build και σε κάθε
// συσκευή. Τυχαία θα «ανακατευόταν» σε κάθε ανανέωση.
// Λιγότερα και χοντρότερα ραβδία. Με 48 η μάσκα τεντωνόταν σε όλο το
// πλάτος και έβγαιναν λεπτές γραμμές που διαβάζονταν ως υφή, όχι ως
// μπλοκ. Με 30 το καθένα πιάνει χώρο και ξεχωρίζει.
const WAVE_BARS = 30;

function waveMask(seed){
  // Ένας μικρός ντετερμινιστικός γεννήτορας. Δεν θέλουμε ποιότητα
  // κρυπτογραφίας, θέλουμε να μη βγαίνει το ίδιο σχήμα σε όλους.
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const next = () => {
    h = (h * 1103515245 + 12345) >>> 0;
    return h / 4294967296;
  };

  const bars = [];
  for (let i = 0; i < WAVE_BARS; i++) {
    // Ένα ημίτονο δίνει το γενικό σχήμα — χωρίς αυτό οι μπάρες μοιάζουν
    // με θόρυβο, όχι με ομιλία. Ο τυχαίος παράγοντας σπάει τη συμμετρία.
    // Το ημίτονο δίνει το γενικό σχήμα. Ήταν 0.45 ± 0.3 και στο κάτω
    // μέρος του κύματος η κυματομορφή ισοπεδωνόταν σε σχεδόν ευθεία
    // γραμμή — έμοιαζε με σφάλμα φόρτωσης, όχι με ήχο. Μικρότερο
    // εύρος γύρω από ψηλότερη βάση κρατά παντού ζωή.
    // Δύο ημίτονα αντί για ένα: το αργό δίνει το γενικό ανέβασμα και
    // κατέβασμα μιας κουβέντας, το γρήγορο τις συλλαβές από μέσα. Με
    // ένα μόνο, και με στενό εύρος γύρω από ψηλή βάση, όλα τα ραβδία
    // έβγαιναν σχεδόν ίδια — έμοιαζαν με χάρακα χρόνου, όχι με ήχο.
    const argo = Math.sin((i / WAVE_BARS) * Math.PI * 2.6);
    const grigoro = Math.sin((i / WAVE_BARS) * Math.PI * 9.4);
    const curve = 0.56 + 0.26 * argo + 0.13 * grigoro;

    // Το κάτω όριο είναι χαμηλά επίτηδες: χρειάζονται και κοντά
    // ραβδία για να φανούν ψηλά τα διπλανά τους. Χωρίς αυτά δεν
    // υπάρχει δυναμική, άρα δεν μοιάζει με κυματομορφή.
    const height = Math.max(0.26, Math.min(1, curve * (0.52 + next() * 0.92)));
    bars.push(height);
  }

  // Το SVG γίνεται ΜΑΣΚΑ, όχι εικόνα: το χρώμα το δίνουν από κάτω τα
  // δύο στρώματα του player. Έτσι το «παιγμένο» κόκκινο και το
  // «υπόλοιπο» μπλε βγαίνουν με ένα μόνο width, όπως και πριν —
  // ο player.js δεν χρειάστηκε να αλλάξει ούτε γραμμή.
  // Το SVG μπαίνει σε HTML attribute και πολλαπλασιάζεται επί 1.059
  // σελίδες, οπότε κάθε χαρακτήρας μετράει δύο φορές:
  //
  //   1) Εισαγωγικά — ΑΠΑΓΟΡΕΥΟΝΤΑΙ. Το πρώτο γράψιμο έβγαζε
  //      style="--wave: url("data:...")" και το διπλό εισαγωγικό
  //      τερμάτιζε το attribute στη μέση. Λύση: encodeURIComponent,
  //      που τα κωδικοποιεί όλα, και url() χωρίς εισαγωγικά.
  //
  //   2) Μέγεθος — ακέραιες συντεταγμένες αντί για δεκαδικά, και
  //      viewBox σε πλέγμα που βγάζει στρογγυλούς αριθμούς. Τα
  //      δεκαδικά τριπλασίαζαν το μήκος χωρίς ορατή διαφορά.
  const step = 20;
  const rects = bars.map((v, i) => {
    const h = Math.round(v * 100);
    // width 14 στα 20 του βήματος: το ραβδί κυριαρχεί και το κενό το
    // χωρίζει, αντί για λεπτή γραμμή μέσα σε πολύ αέρα. Το rx στο 4
    // στρογγυλεύει τις γωνίες χωρίς να γίνει χάπι — στο 6 (δηλαδή
    // μισό πλάτος) τα κοντά ραβδία έβγαιναν κουκκίδες.
    return `<rect x='${i * step}' y='${Math.round((100 - h) / 2)}' width='14' height='${h}' rx='4'/>`;
  }).join('');

  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${WAVE_BARS * step} 100' preserveAspectRatio='none' fill='#fff'>${rects}</svg>`;
  // Το encodeURIComponent αφήνει άθικτα τα ' ( ) ! * — δες τον ορισμό
  // του. Μέσα σε url(...) χωρίς εισαγωγικά, ένα ' αρκεί για να μη
  // διαβαστεί ο κανόνας καθόλου: η μάσκα δεν εφαρμοζόταν και ο player
  // έβγαινε δύο συμπαγή ορθογώνια. Τα κωδικοποιούμε ρητά.
  const data = encodeURIComponent(svg).replace(/'/g, '%27').replace(/[()]/g, (c) => (c === '(' ? '%28' : '%29'));
  return `url(data:image/svg+xml,${data})`;
}

function siteFooter(depth = 0){
  const up = depth === 0 ? '' : '../';
  const year = new Date().getFullYear();

  const nav = MENU
    .map(([t, href, reload]) => `<a href="${up}${href}"${reload ? ' data-reload' : ''}>${t}</a>`)
    .join('\n      ');

  const legal = LEGAL
    .map(([t, href]) => `<a href="${href}" target="_blank" rel="noopener">${t}</a>`)
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

// Το κύριο μενού, σε ΕΝΑ σημείο: το χρησιμοποιούν και η γραμμή της
// κεφαλίδας και το πάνελ του κινητού. Οι διευθύνσεις γράφονται χωρίς
// πρόθεμα· το «../» το βάζει όποιος το χρησιμοποιεί, ανάλογα με το βάθος.
//
// Το «Podcasts» δείχνει στο αρχείο όλων των επεισοδίων: είναι ο ΜΟΝΟΣ
// δρόμος προς 87 επεισόδια που δεν έχουν ούτε εκπομπή ούτε θέμα.
// Το «Video» έφυγε — και τα 3.027 βίντεο έχουν εκπομπή.
// Η αναζήτηση έχει δικό της script, που δεν τρέχει αν η σελίδα μπει
// μέσω της γρήγορης πλοήγησης· το data-reload τη φορτώνει κανονικά.
const MENU = [
  ['Εκπομπές', 'shows.html'],
  ['Podcasts', 'episodes.html'],
  ['Ενότητες', 'categories.html'],
  ['Πρόσωπα', 'guests.html'],
  ['Αρχείο', 'search.html', true],
];

// ---- το πάνελ του πλέγματος ----
//
// Το κύριο μενού ΔΕΝ κρύβεται: το πάνελ είναι επιπλέον, για το βάθος που
// δεν χωράει πουθενά — 12 εκπομπές, 13 θέματα, 382 πρόσωπα.
//
// Κάτω από 760px παίρνει μέσα του και το κύριο μενού, οπότε η κεφαλίδα
// του κινητού πέφτει από 170px (δύο σειρές) σε μία.
//
// Γεμίζει μία φορά στο main(), πριν γραφτεί οποιαδήποτε σελίδα: η
// siteHeader καλείται από παντού και δεν μπορεί να κουβαλάει δεδομένα.
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

  // Το κύριο μενού μπαίνει ΚΑΙ εδώ, αλλά φαίνεται μόνο κάτω από 760px:
  // εκεί κρύβεται από τη γραμμή της κεφαλίδας. Στον υπολογιστή μένει
  // πάνω και αυτό το αντίγραφο είναι κρυφό με CSS.
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
// Κοινή μορφή για podcast και είδηση. Η κάρτα και το hero δουλεύουν πάνω
// σε αυτήν και δεν χρειάζεται να ξέρουν τι είναι το καθένα — αλλάζει μόνο
// το χρώμα της ετικέτας. Έτσι μπαίνουν στην ίδια ροή, όπως στο mockup.
function itemFromEpisode(ep){
  const vt = videoTwin(ep);
  return {
    kind: 'podcast',
    href: episodeUrl(ep),
    external: false,
    // Η ταμπέλα γράφει ΤΟ ΘΕΜΑ, όχι την εκπομπή. Όλα εδώ είναι podcast,
    // οπότε το «Podcast» δίπλα στο «Συνεντεύξεις» έλεγε δύο διαφορετικά
    // είδη πράγματος στην ίδια θέση. Το αν είναι ήχος ή βίντεο το λέει
    // πλέον το ΧΡΩΜΑ της ταμπέλας.
    // Κενό όταν δεν ξέρουμε κατηγορία: δεν το γεμίζουμε με το είδος.
    label: episodeCategories(ep)[0] || '',
    name: guestOf(ep),
    title: decode(ep.headline),
    image: ep.image,
    hero: (vt && vt.image) ? vt.image : ep.image,
    date: ep.date,
    // Η διάρκεια βγήκε από το meta και πήγε σε δικό της πλακίδιο πάνω
    // στην εικόνα — αλλιώς θα γραφόταν δύο φορές στην ίδια κάρτα.
    meta: formatDate(ep.date),
    duration: formatDuration(ep.seconds),
    cta: 'Άκου το επεισόδιο',
    topics: episodeCategories(ep),
  };
}

function itemFromVideo(v){
  return {
    kind: 'video',
    href: videoUrl(v),
    external: false,                // παίζει στη δική μας σελίδα, με embed
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

// ---- Τα άρθρα του newshub.gr που ανοίγουν ΕΔΩ ----
//
// Οδηγία του αφεντικού, 4 Νοεμβρίου: όσα άρθρα ανεβαίνουν στο Media
// channel — τα must read και το πρωτοσέλιδο όταν είναι είδηση —
// ανοίγουν σε δική μας σελίδα, με backlink προς το newshub.gr. Η ροή
// ειδήσεων στο πλάι ΔΕΝ αλλάζει: εκείνη οδηγεί στο newshub.gr.
//
// Σελίδα παίρνει μόνο όποιο άρθρο έχει σώμα στο data/news-bodies/. Το
// γράφει το fetch-news.js, και μόνο για όσα μπορεί να χρειαστούν.
// Χωρίς σώμα, το άρθρο μένει εξωτερικός σύνδεσμος — ποτέ μισοάδεια
// σελίδα, που θα έκανε ακριβώς το αντίθετο για το SEO.
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
    // Η διεύθυνση στο newshub.gr μένει μαζί, ώστε να αναγνωρίζεται η
    // χειροκίνητη επιλογή του συντάκτη όπως κι αν τη γράψει.
    source: a.url,
    external: !mine,                // χωρίς σώμα, ζει μόνο στο newshub.gr
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

// Το rank μπαίνει ΜΟΝΟ στη ροή της αρχικής, που είναι η μόνη με φίλτρο
// θεμάτων. Οι υπόλοιπες σειρές καρτών δεν το περνούν και δεν το γράφουν.
function card(item, depth = 0, rank = null){
  const up = depth === 0 ? '' : '../';
  const href = item.external ? item.href : `${up}${item.href}`;
  const out = item.external ? ' target="_blank" rel="noopener"' : '';

  // Τα θέματα γράφονται ως slug, χωρισμένα με κενό: data-topics="kriti ygeia".
  // Έτσι η λωρίδα-φίλτρο βρίσκει τις κάρτες της χωρίς να ρωτήσει διακομιστή.
  const topics = (item.topics || []).map(slugify).filter(Boolean).join(' ');

  // Οι «extra» κάρτες υπάρχουν στη σελίδα για το φιλτράρισμα, αλλά μένουν
  // κρυμμένες όσο δείχνουμε τα πιο πρόσφατα όλων των θεμάτων.
  // Κρυμμένες ΑΠΟ ΕΔΩ, όχι από τη JavaScript: όποιος την έχει κλειστή
  // βλέπει τα 24 πιο πρόσφατα, όχι και τα ενενήντα μαζί.
  const cls = ['card', item.extra ? 'is-extra' : '', item.lead ? 'card--lead' : '']
    .filter(Boolean).join(' ');

  // Το YouTube δίνει τρία μεγέθη μικρογραφίας και ΔΕΝ είναι ίδιου σχήματος:
  // το maxresdefault είναι καθαρό 16:9, ενώ το sddefault (640×480) και το
  // hqdefault (480×360) είναι 4:3 με μαύρες λωρίδες πάνω και κάτω.
  // 585 από τα βίντεό μας δεν έχουν maxres. Τα σημαδεύουμε εδώ, και το CSS
  // τα μεγεθύνει τόσο όσο χρειάζεται για να φύγουν οι λωρίδες.
  const letterbox = /\/(sddefault|hqdefault)\.jpg/.test(item.image || '');
  const imgCls = `card-image${letterbox ? ' card-image--letterbox' : ''}`;
  const hide = item.extra ? ' hidden' : '';

  // Το κείμενο κάθεται ΚΑΤΩ από την εικόνα, όχι μέσα της.
  //
  // Δοκιμάστηκε και μέσα, με σκίαση στο κάτω μέρος. Στις μεγάλες κάρτες
  // της ροής διαβαζόταν· στις μικρές — λωρίδες θεμάτων, «και ακόμα»,
  // spotlight — γινόταν χάος: τα εξώφυλλά μας είναι αφίσες με δικό τους
  // κείμενο και πρόσωπα, και ο τίτλος μας έπεφτε από πάνω τους.
  //
  // Εδώ η εικόνα μένει ολόκληρη και καθαρή, και το κείμενο διαβάζεται
  // πάντα — ανεξάρτητα από το πόσο μικρή είναι η κάρτα.
  return `<article class="${cls}"${hide} data-kind="${item.kind}"${topics ? ` data-topics="${topics}"` : ''}${rank === null ? '' : ` data-rank="${rank}"`}>
    <a class="card-link" href="${href}"${out}>
    <span class="card-media">
      ${item.image ? `<img class="card-bloom${letterbox ? ' card-bloom--letterbox' : ''}" src="${item.image}" alt="" aria-hidden="true" loading="lazy">
      <img class="${imgCls}" src="${item.image}" alt="" loading="lazy">` : '<span class="card-image card-image--empty"></span>'}
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

// Μέσα σε μπλοκ θέματος, η ετικέτα δείχνει ΤΟ ΘΕΜΑ ΤΟΥ ΜΠΛΟΚ.
//
// Ένα επεισόδιο ανήκει συχνά σε πολλές κατηγορίες, και η ετικέτα έπαιρνε
// πάντα την πρώτη της λίστας. Έτσι, μέσα στο μπλοκ «Πολιτική» έβγαινε
// ετικέτα «Γεωπολιτική» — σωστή για το επεισόδιο, λάθος για τη θέση.
function inTopic(item, name){
  return { ...item, label: name, labelIsKind: false };
}

// Η μικρή οριζόντια κάρτα: μικρογραφία αριστερά, τίτλος δεξιά. Μπαίνει
// δίπλα στη μεγάλη, στις ενότητες θεμάτων.
function rowCard(item, depth = 0){
  const up = depth === 0 ? '' : '../';
  const href = item.external ? item.href : `${up}${item.href}`;
  const out = item.external ? ' target="_blank" rel="noopener"' : '';

  return `        <article class="row-card" data-kind="${item.kind}">
          <a class="row-card-link" href="${href}"${out}>
            <span class="row-card-media">
              ${item.image
                ? `<img class="card-bloom${/\/(sddefault|hqdefault)\.jpg/.test(item.image) ? ' card-bloom--letterbox' : ''}" src="${item.image}" alt="" aria-hidden="true" loading="lazy">
              <img class="row-card-art${/\/(sddefault|hqdefault)\.jpg/.test(item.image) ? ' row-card-art--letterbox' : ''}" src="${item.image}" alt="" loading="lazy">`
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

// ---- πρωτοσέλιδο ----

// Το data/curation.json το γράφει το διαχειριστικό και το διαβάζουμε εδώ.
// Αν δεν υπάρχει — και σήμερα δεν υπάρχει — το site δουλεύει κανονικά με
// αυτόματες επιλογές. Το διαχειριστικό είναι βελτίωση, όχι προϋπόθεση.
function loadCuration(){
  if (!fs.existsSync(CURATION_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CURATION_FILE, 'utf8'));
  } catch (err) {
    console.warn('ΠΡΟΣΟΧΗ: το data/curation.json δεν διαβάζεται —', err.message);
    return {};
  }
}

// Οι ειδήσεις. Σήμερα το data/news.json είναι δείγμα· όταν έρθει το API
// του newshub.gr, ένα fetch-news.js θα γράφει το ΙΔΙΟ αρχείο και δεν
// αλλάζει τίποτα από εδώ και πάνω.
// Ειδήσεις που δεν αναδημοσιεύουμε. Η λίστα ζει στο
// data/roi-apokleismena.json — εκεί μέσα γράφει και γιατί, και εκεί
// αλλάζει.
//
// Δεν είναι εδώ επειδή τη διαβάζει και το roi-se-kv.js, που στέλνει τη
// ζωντανή ροή στο KV. Αν την είχαμε δύο φορές, κάποια μέρα θα έμπαινε
// λέξη στη μία και όχι στην άλλη — και θα το μαθαίναμε από το άρθρο
// που δεν έπρεπε να βγει.
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

// ---- Τα ΔΙΚΑ ΜΑΣ άρθρα ----
//
// Γράφονται στο διαχειριστικό και ζουν στο data/articles.json. Δεν
// υπάρχουν πουθενά αλλού: κανένα feed, καμία πηγή, μόνο εδώ. Γι' αυτό
// και σε όλα διαφέρουν από τις αναδημοσιεύσεις — canonical σε εμάς,
// μπαίνουν στο sitemap, καμία γραμμή προέλευσης.
//
// Το σχήμα του σώματος είναι ΤΟ ΙΔΙΟ με των ειδήσεων ({type, text}),
// με δύο επιπλέον τύπους: image και embed. Έτσι ο κώδικας που τα
// ζωγραφίζει μένει ένας.
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

    // Πρόχειρο: ο συντάκτης δεν το έχει δημοσιεύσει ακόμα.
    if (a.status && a.status !== 'published') { drafts++; continue; }

    // Προγραμματισμένο για αργότερα. Δεν το βγάζουμε εμείς πριν την ώρα
    // του — ίδιος κανόνας με τις ειδήσεις του feed.
    if (a.date && new Date(a.date) > now) { later++; continue; }

    // Σώμα κάτω από μία παράγραφο δεν είναι άρθρο. Καλύτερα να λείπει
    // παρά να βγει σελίδα με τίτλο και τίποτα από κάτω.
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

// Το επεισόδιο με αυτόν τον κωδικό, για τις ενσωματώσεις μέσα στα
// άρθρα. Δέχεται και «Buzzsprout-19907711» και σκέτο «19907711»: ο
// συντάκτης αντιγράφει ό,τι βλέπει, και τα δύο κυκλοφορούν.
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
    external: false,                // δικό μας, ζει εδώ
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

// Ποιο μπαίνει μεγάλο — podcast, video ή είδηση, ό,τι είναι σημαντικότερο.
// Σειρά προτεραιότητας: επιλογή συντάκτη, μετά είδηση σημασμένη ως
// featured, μετά το πιο πρόσφατο επεισόδιο.
// Το πρωτοσέλιδο ΠΡΕΠΕΙ να έχει εικόνα: χωρίς αυτήν βγάζει ένα άδειο
// σκούρο ορθογώνιο μισής οθόνης. Οπότε σε κάθε στάδιο προτιμάμε κάτι
// που έχει, και μόνο ως έσχατη λύση δεχόμαστε κάτι χωρίς.
function pickFeatured(items, curation){
  const withImage = items.filter((it) => it.hero);

  // 1) Η επιλογή του συντάκτη. Δέχεται ΚΑΙ διεύθυνση ΚΑΙ κωδικό, ώστε να
  //    αρκεί να αντιγράψει τον σύνδεσμο από τον browser. Δουλεύει το ίδιο
  //    για είδηση, podcast και βίντεο.
  const want = String(curation.featured || '').trim();
  if (want) {
    if (curationExpired(curation)) {
      console.log(`Πρωτοσέλιδο: η χειροκίνητη επιλογή έληξε στις ${curation.featuredUntil} — γυρίζω στην αυτόματη`);
    } else {
      const chosen = items.find((it) => sameItem(it, want));
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

  // 2) Ό,τι έβαλαν πρώτο στο newshub.gr.
  const flagged = withImage.find((it) => it.featured);
  if (flagged) return flagged;

  // 3) Το πιο πρόσφατο με εικόνα.
  return withImage[0] || items[0];
}

// Ταιριάζει το αντικείμενο με ό,τι έγραψε ο συντάκτης. Δέχεται κωδικό,
// πλήρη διεύθυνση του newshub.gr, ή διεύθυνση δικής μας σελίδας όπως
// τη δίνει ο browser — με ή χωρίς http, localhost ή domain.
function sameItem(it, want){
  const strip = (s) => String(s)
    .trim()
    .replace(/^https?:\/\/[^/]+\//i, '')   // πετάμε το http://κάτι/
    .replace(/^\/+/, '')
    .replace(/[?#].*$/, '')                 // και ό,τι κρέμεται στο τέλος
    .toLowerCase();

  const target = strip(want);
  if (!target) return false;

  if (String(it.id).toLowerCase() === target) return true;

  const mine = strip(it.href);
  if (mine === target) return true;

  // Η ΠΗΓΑΙΑ διεύθυνση, όταν το αντικείμενο ζει αλλού.
  //
  // Τα άρθρα του newshub.gr δείχνουν πλέον στη δική μας σελίδα, οπότε
  // το href τους είναι «arthro/κάτι.html». Ο συντάκτης όμως κολλάει
  // στο curation.json τη διεύθυνση που βλέπει στον browser — τη δική
  // ΤΟΥΣ. Χωρίς αυτόν τον έλεγχο η επιλογή του αποτύγχανε σιωπηλά και
  // η αρχική γύριζε στην αυτόματη, σαν να μην είχε γράψει τίποτα.
  if (it.source && strip(it.source) === target) return true;

  // Τελευταία ευκαιρία: μόνο το όνομα του αρχείου, χωρίς κατάληξη —
  // «arthro/x.html» και «el/kriti/x» είναι το ίδιο πράγμα.
  const tail = (s) => s.split('/').pop().replace(/\.html?$/, '');
  return tail(mine) === tail(target);
}

// Η χειροκίνητη επιλογή λήγει, αν έχει οριστεί ημερομηνία. Χωρίς αυτό,
// μια ξεχασμένη γραμμή στο curation.json παγώνει την αρχική για πάντα.
function curationExpired(curation){
  if (!curation.featuredUntil) return false;
  const until = new Date(`${curation.featuredUntil}T23:59:59`);
  return !isNaN(until) && until < new Date();
}

// Τα 4 από κάτω. Όσα όρισε ο συντάκτης πρώτα, μετά γεμίζουμε εναλλάξ
// είδηση–podcast ώστε να μη βγαίνουν τέσσερα ίδιου τύπου.
// Τα καρφιτσωμένα της ροής «Τελευταία»: ποια θέλει ο δημοσιογράφος να
// φαίνονται πρώτα, και με ΠΟΙΑ ΣΕΙΡΑ.
//
// Γιατί υπάρχει: η ροή είναι καθαρά χρονολογική, και μια καλή συνέντευξη
// πέφτει κάτω μέσα σε δύο μέρες. Κάποια αξίζουν να μείνουν πάνω για
// βδομάδες — αυτό δεν βγαίνει από ημερομηνία, το ξέρει μόνο άνθρωπος.
//
// ΔΕΝ βάζουμε ημερομηνία λήξης, σε αντίθεση με το πρωτοσέλιδο. Εκεί η
// δικλείδα χρειάζεται γιατί μια ξεχασμένη γραμμή παγώνει ΟΛΗ την
// αρχική. Εδώ το ξεχασμένο καρφίτσωμα πιάνει μία θέση από τις εννιά,
// και οι υπόλοιπες συνεχίζουν να ανανεώνονται κανονικά — ενώ το «να
// μείνει πολύ καιρό» είναι ακριβώς ο σκοπός. Το διαχειριστικό δείχνει
// πόσο παλιό είναι το καθένα, ώστε να φαίνεται τι ξεχάστηκε.
//
// Ό,τι δεν βρεθεί αγνοείται σιωπηλά: ένα επεισόδιο μπορεί να έχει βγει
// από τα 40 πιο πρόσφατα, και δεν θέλουμε να ρίξει το build.
function pinnedFlow(curation, pools){
  const want = (curation.latest || []).map((s) => String(s).trim()).filter(Boolean);
  if (!want.length) return [];

  const out = [];
  for (const ref of want) {
    let hit = null;
    for (const { list, make } of pools) {
      const found = list.find((row) => sameItem(make(row), ref));
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

  // Μία ουρά ανά τύπο, και τις διατρέχουμε κυκλικά — ώστε να μη βγαίνουν
  // τέσσερα ίδιου είδους, αλλά και να μη μένει τρύπα αν κάποιος λείπει.
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

// Πόσο πλατιά είναι ΣΤΗΝ ΠΡΑΓΜΑΤΙΚΟΤΗΤΑ η εικόνα. Δεν το μαντεύουμε: το
// λέει η ίδια η διεύθυνση.
//   · ειδήσεις  — static.newshub.gr/765x435/... (μόνο αυτό το μέγεθος
//     υπάρχει· δοκιμάστηκαν 1200, 1600, 1920 και απαντά 404)
//   · YouTube   — maxresdefault 1280, sddefault 640, hqdefault 480
//   · Buzzsprout— οι αφίσες είναι 1400×1400
// Το χρειάζεται το πρωτοσέλιδο, για να μην τραβήξει μια μικρή φωτογραφία
// στα 1600 και τη θολώσει.
function naturalWidth(url = ''){
  const nh = url.match(/static\.newshub\.gr\/(\d+)x\d+\//);
  if (nh) return Number(nh[1]);
  if (/maxresdefault\.jpg/.test(url)) return 1280;
  if (/sddefault\.jpg/.test(url)) return 640;
  if (/hqdefault\.jpg/.test(url)) return 480;
  if (/buzzsprout\.com/.test(url)) return 1400;
  return 1200;
}

// Η ΑΝΑΛΟΓΙΑ της εικόνας, για να πάρει η λωρίδα το σχήμα της.
// Το sddefault και το hqdefault είναι 4:3 ΜΕ μαύρες λωρίδες γύρω από
// περιεχόμενο 16:9 — μετράει το περιεχόμενο, άρα 16/9 και αυτά.
function naturalRatio(url = ''){
  const nh = url.match(/static\.newshub\.gr\/(\d+)x(\d+)\//);
  if (nh) return Number(nh[1]) / Number(nh[2]);
  return 16 / 9;
}

function heroBanner(item){
  const out = item.external ? ' target="_blank" rel="noopener"' : '';

  // ΔΥΟ ΣΧΗΜΑΤΑ ΠΗΓΗΣ, ΔΥΟ ΣΥΜΠΕΡΙΦΟΡΕΣ — και στις δύο ολόκληρη εικόνα.
  //
  // · ΕΙΔΗΣΗ / ΒΙΝΤΕΟ: η φωτογραφία είναι φαρδιά, οπότε η λωρίδα παίρνει
  //   ΤΟ ΣΧΗΜΑ ΤΗΣ και τη γεμίζει από άκρη σε άκρη. Μηδέν θολό.
  // · PODCAST: η αφίσα είναι τετράγωνη. Σε φαρδιά λωρίδα ή θα κοπεί ή θα
  //   αφήσει κενό — διαλέγουμε το κενό, και το γεμίζει η ίδια θολωμένη.
  //
  // Ο τίτλος δεν κάθεται πάνω στην εικόνα σε καμία περίπτωση: πάει από
  // κάτω, στη ροή, όπου διαβάζεται χωρίς σκιές.
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

// ---- εκπομπές ----

// Τα βίντεο από τις λίστες του YouTube. Κάθε βίντεο ξέρει ήδη σε ποια
// εκπομπή ανήκει — δεν μαντεύουμε τίποτα, ήρθε μέσα από τη λίστα της.
//
// Διαβάζεται ΜΙΑ φορά και μένει στη μνήμη: δέκα σημεία το ζητούν, και
// κάθε φορά ξαναδιάβαζε και ξαναδιάβαζε 2MB JSON.
//
// Το ίδιο βίντεο σε δύο λίστες μένει δύο φορές ΕΠΙΤΗΔΕΣ — έτσι φαίνεται
// και στις δύο εκπομπές. Φεύγουν μόνο οι πανομοιότυπες εγγραφές (ίδιο
// βίντεο, ίδια εκπομπή), που έδειχναν το ίδιο βίντεο δύο φορές στη σειρά
// μέσα στην ίδια λωρίδα. Το ξεκαθάρισμα γίνεται και εδώ και στο
// fetch-videos.js: το δεύτερο θέλει YOUTUBE_API_KEY για να ξανατρέξει,
// οπότε το build δεν πρέπει να περιμένει καθαρό αρχείο για να δουλέψει.
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

// ---- τα επεισόδια, με διορθωμένη ημερομηνία ----
//
// Το Buzzsprout δίνει «πότε ανέβηκε το podcast», όχι «πότε έγινε η
// συνέντευξη». Τα δύο απέχουν: στα 770 ζευγάρια που βρίσκουμε, το
// podcast βγαίνει κατά μέσο όρο 1,7 μέρες μετά το βίντεο.
//
// Το αποτέλεσμα το είδε χρήστης: συνέντευξη της 31ης Οκτωβρίου —
// έτσι τη γράφει και το newshub.gr και το YouTube — έβγαινε εδώ ως
// «χθες», επειδή το podcast ανέβηκε πέντε μέρες αργότερα. Σε
// ειδησεογραφικό site αυτό δεν είναι λεπτομέρεια.
//
// Παίρνουμε λοιπόν την ημερομηνία του βίντεο όταν είναι παλιότερη.
//
// ΜΕ ΟΡΙΟ 30 ΗΜΕΡΩΝ, και ο λόγος είναι πραγματικός: υπάρχουν βίντεο
// του 2024 που ξαναβγήκαν ως podcast το 2026 — ολόκληρες σειρές, σαν
// τα «25 μαθήματα ελληνικής ιστορίας», 620 μέρες μετά. Εκείνες είναι
// ΕΠΑΝΕΚΔΟΣΕΙΣ: το newsroom τις ανέβασε επίτηδες για να ξαναφανούν,
// και αν τις γυρίζαμε στο 2024 δεν θα τις έβλεπε ποτέ κανείς.
//
// Το όριο είναι αυθαίρετο και το παραδεχόμαστε. Στις τελευταίες 90
// μέρες κανένα από τα 140 επεισόδια δεν ξεπερνά τις 7 — οπότε οι 30
// αφήνουν χώρο χωρίς να αγγίζουν την κανονική ροή.
const AIR_WINDOW_DAYS = 30;

function airDate(ep){
  const twin = videoTwin(ep);
  if (!twin) return ep.date;

  const pod = new Date(ep.date).getTime();
  const vid = new Date(twin.date).getTime();
  if (!vid || isNaN(vid) || isNaN(pod)) return ep.date;
  if (vid >= pod) return ep.date;                              // ήδη σωστή
  if (pod - vid > AIR_WINDOW_DAYS * 86400000) return ep.date;  // επανέκδοση

  return new Date(vid).toISOString();
}

// Ένας κατάλογος για όλο το build. Ήταν τέσσερα ξεχωριστά διαβάσματα
// του ίδιου αρχείου, άρα τέσσερα ανεξάρτητα αντίγραφα: η διόρθωση σε
// ένα δεν θα φαινόταν στα άλλα, και η σελίδα βίντεο θα έγραφε άλλη
// ημερομηνία από τη σελίδα επεισοδίου.
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

  // Η μνήμη μπαίνει ΠΡΙΝ τη διόρθωση: το airDate κατεβαίνει στο
  // videoTwin, και χωρίς αυτό ένας μελλοντικός δρόμος πίσω στα
  // επεισόδια θα γύριζε ατέρμονα.
  episodeCache = list;

  // ---- Οι διορθώσεις του συντάκτη ----
  //
  // Το Buzzsprout και το YouTube είναι ΜΟΝΟ ΓΙΑ ΑΝΑΓΝΩΣΗ — δεν τα
  // αγγίζουμε ποτέ. Ο δημοσιογράφος όμως πρέπει να μπορεί να
  // διορθώσει τίτλο, περιγραφή ή φωτογραφία χωρίς να περιμένει
  // κανέναν, και χωρίς να μάθει καινούριο εργαλείο.
  //
  // Μπαίνουν ΕΔΩ, στο ένα σημείο που διαβάζει τα επεισόδια, ώστε να τις
  // δουν όλα μαζί: κάρτες, σελίδα, αναζήτηση, ζευγάρωμα με βίντεο,
  // σελίδα καλεσμένου. Αν τις βάζαμε στην εμφάνιση, θα έπρεπε να τις
  // θυμόμαστε σε δεκαπέντε μέρη και θα ξεχνιόταν το δέκατο έκτο.
  //
  // ΝΙΚΑΕΙ ΠΑΝΤΑ Ο ΑΝΘΡΩΠΟΣ. Ό,τι γράφτηκε εδώ δεν το σβήνει καμία
  // επόμενη λήψη — ακόμα κι αν αλλάξει το Buzzsprout. Αλλιώς η
  // διόρθωση θα εξαφανιζόταν μόνη της μέσα στην επόμενη μισή ώρα και
  // κανείς δεν θα καταλάβαινε γιατί.
  for (const ep of list) {
    // Η διεύθυνση κλειδώνει ΠΡΙΝ αλλάξει ο τίτλος, και δεν ξεκλειδώνει
    // ποτέ: οι σελίδες επεισοδίου είναι ήδη μοιρασμένες και ευρετη-
    // ριασμένες. Ένας διορθωμένος τίτλος δεν αξίζει 1.074 σπασμένους
    // συνδέσμους.
    ep.slug = ep.headline;

    const fix = pairOf(ep);
    if (!fix) continue;

    if (fix.title) {
      const t = String(fix.title).trim();
      // Ίδιος χωρισμός «Όνομα: θέμα» με το feed.js, ώστε ο διορθωμένος
      // τίτλος να βγάζει καλεσμένο όπως και ο αυθεντικός.
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

  for (const ep of list) {
    const when = airDate(ep);
    if (when === ep.date) continue;
    ep.published = ep.date;   // πότε ανέβηκε το podcast, αν χρειαστεί ποτέ
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

// Σελίδα βίντεο. Το βίντεο ΠΑΙΖΕΙ ΕΔΩ — δεν στέλνουμε τον κόσμο στο
// YouTube. Αλλά δεν φορτώνουμε και τον player τους αμέσως: δείχνουμε τη
// μικρογραφία με κουμπί, και το πραγματικό βίντεο μπαίνει μόνο αν πατηθεί.
// Έτσι η σελίδα ανοίγει ακαριαία και δεν φορτώνει τίποτα ξένο πριν το
// ζητήσει ο επισκέπτης — ο κανόνας του claude.md για ταχύτητα.
function videoPage(v, category){
  const title = esc(decode(v.title));

  // Το πάνελ του καλεσμένου υπάρχει μόνο όταν ο τίτλος έχει όνομα — στα
  // δύο τρίτα των βίντεο δεν έχει.
  const gbox = videoGuestBox(v, 1);

  const cats = categoriesFor(v.id, v.title);

  // Το δίδυμο επεισόδιο, αν υπάρχει. Όταν υπάρχει, η σελίδα βίντεο δίνει
  // ΚΑΙ ήχο — ίδιος player, ίδιος διακόπτης «Βλέπω / Ακούω», ίδια
  // συμπεριφορά με τη σελίδα επεισοδίου. Αυτό ήταν που διέφερε.
  const twin = episodeTwin(v);

  const meta = [
    formatDate(v.date),
    twin ? formatDuration(twin.seconds) : '',
    ...cats.map((c) => `<a href="../${categoryUrl(c)}">${esc(c)}</a>`),
  ].filter(Boolean).join(' · ');

  const player = twin
    ? `        <div class="player" data-player-view
             data-id="${twin.id}"
             data-src="${twin.audio}"
             data-title="${esc(decode(twin.headline))}"
             data-show="${esc(showLabel(v.show))}"
             data-art="${twin.image || ''}"
             data-href="../${episodeUrl(twin)}">
          <button type="button" class="player-skip" data-player="skip" data-by="-15" aria-label="15 δευτερόλεπτα πίσω">−15</button>
          <button type="button" class="player-play" data-player="toggle" aria-label="Αναπαραγωγή">▶</button>
          <button type="button" class="player-skip" data-player="skip" data-by="15" aria-label="15 δευτερόλεπτα μπροστά">+15</button>
          <span class="player-now" data-player-now>0:00</span>
          <div class="player-bar" data-player="seek" role="slider" tabindex="0" aria-label="Θέση" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" style="--wave: ${waveMask(twin.id)}">
            <div class="player-fill"></div>
          </div>
          <span class="player-total" data-player-total>--:--</span>
        </div>`
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

  const body = `${siteHeader(1)}

${breadcrumb([
    { label: 'Αρχική', href: 'index.html' },
    { label: showName(v.show), href: showUrl(v.show) },
    category ? { label: category, href: '' } : null,
    { label: decode(v.title) },
  ], 1)}

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
${twin && twin.summary ? `        <p class="episode-summary">${esc(twin.summary)}</p>` : ''}

        <p class="episode-links">
          <a href="${v.url}" target="_blank" rel="noopener">Άνοιγμα στο YouTube ↗</a>
          ${twin ? `<a href="../${episodeUrl(twin)}">Η σελίδα του επεισοδίου →</a>` : ''}
        </p>

${/* Κάτω από το βίντεο, την περιγραφή και τους συνδέσμους, και πριν
     το «Επόμενο». Δηλαδή αφού τελειώσει ό,τι ήρθε να δει ο επισκέπτης
     και πριν του προταθεί το επόμενο — το φυσικό σημείο παύσης.
     ΠΟΤΕ πιο πάνω: ο player κάθεται στην κορυφή αυτής της στήλης. */ ''}
${adSlot('video-mid', 'leaderboard')}

        ${queue ? `<section class="queue">
          <h2 class="section-head">Επόμενο στις ${esc(showLabel(v.show))}</h2>
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
    description: `${decode(v.title)} — ${v.show}`,
    image: v.image,
    url: videoUrl(v),
    type: 'article',
  });
}

// Η σελίδα ενός άρθρου του newshub.gr, φιλοξενούμενη εδώ.
//
// Τρία πράγματα την κρατούν τίμια απέναντι στην πηγή, και τα τρία
// είναι απαίτηση — χωρίς αυτά η σελίδα θα ανταγωνιζόταν το πρωτότυπο
// αντί να το στηρίζει:
//   1. canonical προς το newshub.gr
//   2. η προέλευση γραμμένη ΠΑΝΩ από το κείμενο, όχι κρυμμένη στο τέλος
//   3. σύνδεσμος πίσω στο πρωτότυπο, χωρίς nofollow
//
// Έξω από το sitemap μας: σελίδα που δηλώνει αλλού το πρωτότυπό της
// δεν ζητάει ευρετηρίαση για τον εαυτό της.
// Το hasCat λέει αν υπάρχει ΔΙΚΗ μας σελίδα γι' αυτή την κατηγορία.
// Τέσσερις από τις δικές τους — Sugar, Τα εν οίκω, Έξοδος,
// Προσωπογραφίες — δεν έχουν, γιατί δεν έχουμε περιεχόμενο εκεί. Η
// ετικέτα γράφεται πάντα, αλλά γίνεται σύνδεσμος μόνο όταν οδηγεί
// κάπου.
// Το σώμα ενός άρθρου σε HTML. Κοινό για τις αναδημοσιεύσεις και για
// τα δικά μας: οι πρώτες φέρνουν μόνο p και h, τα δεύτερα και εικόνες
// και ενσωματώσεις.
//
// Ό,τι δεν αναγνωρίζεται ΠΑΡΑΛΕΙΠΕΤΑΙ σιωπηλά αντί να τυπωθεί ωμό. Το
// data/articles.json το γράφει το διαχειριστικό, δηλαδή τελικά ένας
// browser — δεν το εμπιστευόμαστε να βγει αυτούσιο στη σελίδα.
// Πού μπαίνει η διαφήμιση μέσα στο κείμενο — ή πουθενά.
//
// Μετά την τρίτη παράγραφο: ο αναγνώστης έχει ήδη μπει στο θέμα και
// δεν τον σταματάμε στην πρώτη ανάσα. Και μόνο σε άρθρα με έξι
// παραγράφους και πάνω — σε τρισέλιδο κείμενο η θέση θα κατέληγε
// δίπλα σε εκείνη του footer, δύο διαφημίσεις μαζί.
//
// ΠΟΤΕ ακριβώς πάνω από player: ρητή απαίτηση του αφεντικού. Αν η
// επόμενη ενότητα είναι ενσωμάτωση — βίντεο ή επεισόδιο που ακούγεται
// μέσα στο άρθρο — προσπερνάμε και ψάχνουμε την επόμενη παράγραφο.
const AD_AFTER_PARAS = 3;
const AD_MIN_PARAS = 6;

function articleAdAt(body){
  if (body.filter((p) => p.type === 'p').length < AD_MIN_PARAS) return -1;

  let seen = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i].type !== 'p') continue;
    if (++seen < AD_AFTER_PARAS) continue;

    const next = body[i + 1];
    if (next && next.type === 'embed') continue;   // κολλητά στον player, όχι
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

    // Οι ενσωματώσεις μπαίνουν ΜΟΝΟ με κωδικό, ποτέ με ελεύθερο HTML
    // ή ελεύθερη διεύθυνση: αλλιώς το διαχειριστικό γίνεται τρόπος να
    // μπει ξένο script στη σελίδα.
    if (p.type === 'embed' && p.id) {
      if (p.kind === 'youtube' && /^[\w-]{6,20}$/.test(p.id)) {
        // ΠΛΗΡΗΣ διεύθυνση, όχι σκέτος κωδικός: ο player γράφει
        // iframe.src = data-embed + '?autoplay=1', όπως ακριβώς κάνει και
        // στις σελίδες βίντεο, όπου το πεδίο embed είναι ήδη ολόκληρο
        // το https://www.youtube.com/embed/... Με σκέτο τον κωδικό έβγαινε
        // σχετικός σύνδεσμος και το βίντεο του άρθρου δεν έπαιζε ποτέ.
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

          // Με τον διακόπτη του διαχειριστικού το επεισόδιο ΑΚΟΥΓΕΤΑΙ εδώ,
          // χωρίς ο αναγνώστης να φύγει από το άρθρο. Είναι η ίδια όψη με
          // τη σελίδα επεισοδίου — το player.js δέχεται ήδη πολλές όψεις
          // στην ίδια σελίδα και δείχνει σε καθεμία μόνο το δικό της
          // επεισόδιο, οπότε δύο ενσωματωμένα επεισόδια σε ένα άρθρο δεν
          // μπερδεύονται. Η κάρτα μένει από πάνω: λέει ΤΙ ακούς, και
          // οδηγεί στη σελίδα του αν θες περιγραφή και απομαγνητοφώνηση.
          if (p.play && ep.audio) {
            const show = episodeShow(ep);
            return `        <div class="art-embed-play">
${card}
          <div class="player" data-player-view
               data-id="${esc(ep.id)}"
               data-src="${esc(ep.audio)}"
               data-title="${esc(decode(ep.headline || ep.title))}"
               data-show="${esc(show ? showLabel(show) : '')}"
               data-art="${esc(ep.image || '')}"
               data-href="../${episodeUrl(ep)}">
            <button type="button" class="player-skip" data-player="skip" data-by="-15" aria-label="15 δευτερόλεπτα πίσω">−15</button>
            <button type="button" class="player-play" data-player="toggle" aria-label="Αναπαραγωγή">▶</button>
            <button type="button" class="player-skip" data-player="skip" data-by="15" aria-label="15 δευτερόλεπτα μπροστά">+15</button>
            <span class="player-now" data-player-now>0:00</span>
            <div class="player-bar" data-player="seek" role="slider" tabindex="0" aria-label="Θέση" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" style="--wave: ${waveMask(ep.id)}">
              <div class="player-fill"></div>
            </div>
            <span class="player-total" data-player-total>--:--</span>
          </div>
        </div>`;
          }

          return `        <div class="art-embed-play">\n${card}\n        </div>`;
        }
        console.warn(`ΠΡΟΣΟΧΗ: ενσωματωμένο επεισόδιο που δεν υπάρχει — ${p.id}`);
      }
    }

    return '';
  });

  // Η θέση μετριέται πάνω στις ΑΡΧΙΚΕΣ ενότητες, όχι στο αποτέλεσμα:
  // όσες δεν βγάζουν HTML (π.χ. ενσωματωμένο επεισόδιο που σβήστηκε)
  // θα μετατόπιζαν τη διαφήμιση σε άλλο σημείο από αυτό που κρίθηκε.
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

  const inner = `${siteHeader(1)}

${breadcrumb([
    { label: 'Αρχική', href: 'index.html' },
    a.category ? { label: a.category, href: hasCat ? categoryUrl(a.category) : '' } : null,
    { label: a.title },
  ], 1)}

  <main class="art" data-pagefind-body
        data-pagefind-meta="image:${img},type:Είδηση,date:${formatDate(a.date)}"
        data-pagefind-filter="Είδος:Είδηση${a.category ? `,Κατηγορία:${esc(a.category)}` : ''}">
    <article class="art-wrap">
      <header class="art-head">
        ${a.category ? `<p class="card-label">${esc(a.category)}</p>` : ''}
        <h1 class="art-title">${title}</h1>
        <p class="art-meta">${formatDate(a.date)} · ${minutes}′ ανάγνωση</p>

        <!-- Η προέλευση μπαίνει ΠΡΙΝ το κείμενο. Ο αναγνώστης πρέπει να
             ξέρει ποιος το έγραψε προτού το διαβάσει, όχι αφού. -->
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

// Η σελίδα ενός ΔΙΚΟΥ ΜΑΣ άρθρου, γραμμένου στο διαχειριστικό.
//
// Σχεδόν ίδια όψη με την αναδημοσίευση — ο αναγνώστης δεν πρέπει να
// μαθαίνει δεύτερη διάταξη — αλλά τρία πράγματα αλλάζουν, και όλα
// λένε «αυτό είναι δικό μας»:
//   · canonical στη δική μας διεύθυνση (το βάζει μόνο του το page)
//   · καμία γραμμή προέλευσης, κανένα backlink
//   · υπογραφή του δημοσιογράφου
function ownArticlePage(a, hasCat = false){
  const title = esc(a.title);

  // Σκέτο το όνομα. Το «από τον/την Γιώργος Παυλουδής» θέλει γενική
  // («του Γιώργου Παυλουδή»), και τη γενική δεν τη βγάζουμε από
  // ονομαστική χωρίς να ξέρουμε το όνομα — ούτε το φύλο, που δεν το
  // ρωτάμε. Τα περισσότερα site γράφουν σκέτο το όνομα· το ίδιο.
  const byline = [a.author ? esc(a.author) : '', formatDate(a.date)]
    .filter(Boolean).join(' · ');

  const words = a.body.reduce((n, p) => n + String(p.text || '').split(/\s+/).length, 0);
  const minutes = Math.max(1, Math.round(words / 200));

  const inner = `${siteHeader(1)}

${breadcrumb([
    { label: 'Αρχική', href: 'index.html' },
    a.category ? { label: a.category, href: hasCat ? categoryUrl(a.category) : '' } : null,
    { label: a.title },
  ], 1)}

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
  </main>`;

  return page({
    title: `${title} — ${SITE_NAME}`,
    body: inner,
    depth: 1,
    description: a.summary || a.title,
    image: a.image || '',
    url: ownArticleUrl(a),
    type: 'article',
  });
}

// ---- κατηγορίες ----
//
// Οι ίδιες με το newshub.gr, με τη μόνη αλλαγή που ζήτησε το αφεντικό:
// η «Ιστορία - Πολιτισμός» σπάει στα δύο.
//
// Η κατηγορία ΔΕΝ βγαίνει αξιόπιστα από το κείμενο — το μετρήσαμε. Οπότε
// η αλήθεια έρχεται από το διαχειριστικό (data/curation.json) και αυτό
// εδώ είναι μόνο ΠΡΟΤΑΣΗ, για να μην ξεκινά ο συντάκτης από το μηδέν.
//
// Η σειρά μετράει: από την πιο ειδική προς την πιο γενική. Όταν ένας
// τίτλος ταιριάζει σε πολλές, κερδίζει η πρώτη.
const CATEGORIES = [
  ['Agronews',    ['αγροτ', 'καλλιεργ', 'ελαιολαδ', 'αμπελ', 'κτηνοτροφ', 'γεωργ']],
  ['Tech-Hub',    ['τεχνολογ', 'ψηφιακ', 'τεχνητη νοημοσυν', 'διαδικτυ', 'λογισμικ']],
  // Το «οφη » χρειάζεται κενό ΚΑΙ μπροστά: χωρίς αυτό έπιανε κάθε λέξη
  // που τελειώνει σε -οφη — «καταστροφή η», «επιστροφή», «διατροφή».
  // 92 τίτλοι έμπαιναν στα Αθλητικά· οι σωστοί ήταν 18.
  ['Αθλητικά',    ['αθλητ', 'ποδοσφαιρ', 'μπασκετ', 'πρωταθλημ', ' οφη ']],
  ['Υγεία',       ['υγεια', 'νοσοκομει', 'ιατρ', 'ασθεν', 'φαρμακ', 'παγνη', 'θεραπει', 'εμβολι']],
  ['Περιβάλλον',  ['περιβαλλον', 'κλιματικ', 'ανακυκλωσ', 'ρυπανσ', 'σεισμ', 'οικοσυστημ']],
  ['Πολιτισμός',  ['πολιτισμ', 'θεατρ', 'μουσικ', 'ταινι', 'μουσει', 'ποιητ', 'λογοτεχν']],
  ['Ιστορία',     ['ιστορι', '1821', 'βυζαντ', 'οθωμαν', 'αρχαι', 'κατοχη', 'εμφυλι', 'επανασταση']],
  ['Γεωπολιτική', ['γεωπολιτικ', 'τουρκι', 'νατο', 'ισραηλ', 'ουκραν', 'αμυν', 'πολεμ', 'εξοπλισ']],
  ['Οικονομία',   ['οικονομ', 'πληθωρισμ', 'επενδυσ', 'φορολογ', 'τραπεζ', 'αεπ', 'ενεργειακ']],
  ['Πολιτική',    ['κυβερνησ', 'βουλη', 'εκλογ', ' κομμα', 'υπουργ', 'πρωθυπουργ', 'συνταγμ']],
  ['Κρήτη',       ['κρητ', 'ηρακλει', ' χανι', 'ρεθυμν', 'λασιθ']],
  ['Κόσμος',      ['διεθν', 'ευρωπαικ', ' ηπα ', ' κινα', ' ρωσι', 'γερμανι', 'γαλλι', 'βρεταν']],
  ['Ελλάδα',      ['ελλαδ', 'αθηνα', 'θεσσαλονικ']],
  ['Απόψεις',     []],   // μόνο με το χέρι — δεν αναγνωρίζεται από λέξεις
];

// Τα θέματα που παίρνουν δική τους λωρίδα στην αρχική, με σειρά. Τα
// υπόλοιπα φαίνονται στη λωρίδα-φίλτρο και στη σελίδα «Τα θέματά μας».
//
// Διαλεγμένα ώστε να διαφέρουν μεταξύ τους: ο τόπος, ο κόσμος, η οικονομία
// της Κρήτης, το αρχείο. Τέσσερις λωρίδες «Κρήτη / Ελλάδα / Κόσμος /
// Γεωπολιτική» θα έλεγαν τέσσερις φορές το ίδιο πράγμα.
//
// ΑΛΛΑΖΕΙ ΕΔΩ, και πουθενά αλλού. Αργότερα το διαχειριστικό θα γράφει
// featuredTopics στο data/curation.json και θα υπερισχύει αυτής της λίστας.
// Η Πολιτική μπαίνει ανάμεσα στο Agronews και την Ιστορία, όχι δίπλα
// στη Γεωπολιτική: δύο γειτονικές λωρίδες με παρόμοιο όνομα διαβάζονται
// σαν η ίδια ενότητα δύο φορές.
const FEATURED_TOPICS = ['Κρήτη', 'Γεωπολιτική', 'Πολιτική', 'Ιστορία'];

// Θέματα με δική τους ενότητα σε χρωματιστό πλαίσιο, κάτω από το «Και
// ακόμα». Κάθε ένα έχει δικό του γραφικό — γι' αυτό δηλώνεται και η
// παραλλαγή του. Δεν μπαίνουν ούτε στις κύριες λωρίδες ούτε στο «Και
// ακόμα», αλλιώς θα εμφανίζονταν δύο φορές.
const SPOTLIGHT_TOPICS = [
  ['Agronews', 'agro', 'Η γη της Κρήτης, από το χωράφι στην αγορά'],
  ['Tech-Hub', 'tech', 'Τεχνολογία, ψηφιακά και τεχνητή νοημοσύνη'],
];

function featuredTopics(){
  const picked = curation().featuredTopics;
  return Array.isArray(picked) && picked.length ? picked : FEATURED_TOPICS;
}

// Ψάχνουμε ΜΟΝΟ στον τίτλο. Η περιγραφή είναι βιογραφικό του καλεσμένου
// («ο συγγραφέας, εκδότης...») και κατατάσσει τον άνθρωπο αντί για το θέμα.
// Επιστρέφει ΟΛΕΣ όσες ταιριάζουν, όχι μία.
//
// Η «Κρήτη» είναι τόπος, όχι θέμα — ένα επεισόδιο για την υγεία στο ΠΑΓΝΗ
// είναι και Υγεία και Κρήτη. Με μία μόνο κατηγορία, 331 επεισόδια έχαναν
// την Κρήτη τους επειδή κέρδιζε κάτι πιο ειδικό.
function suggestCategories(title){
  // ΟΧΙ matchKey εδώ: εκείνο κόβει στους 60 χαρακτήρες, γιατί φτιάχτηκε
  // για να ταυτοποιεί τίτλους. Για κατηγορίες θέλουμε ΟΛΟΝ τον τίτλο —
  // αλλιώς χάνονται λέξεις που βρίσκονται στο δεύτερο μισό.
  const hay = ' ' + decode(title).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zα-ω0-9]+/gi, ' ')
    .trim() + ' ';
  return CATEGORIES
    .filter(([, words]) => words.some((w) => hay.includes(w)))
    .map(([name]) => name);
}

function categoryUrl(name){
  return `category/${slugify(name)}.html`;
}

// Το διαβάζουμε μία φορά και το κρατάμε, όπως και τον καιρό.
let curationCache;
function curation(){
  if (curationCache === undefined) curationCache = loadCuration();
  return curationCache;
}

// Οι τελικές κατηγορίες: ό,τι όρισε ο συντάκτης, αλλιώς οι προτάσεις.
// Δέχεται και μία γραμμένη σκέτα και λίστα, για να μη δεσμεύουμε το
// διαχειριστικό σε μορφή πριν γραφτεί.
// Κρατάμε ό,τι βρήκαμε: τώρα που κάθε κάρτα γράφει τις κατηγορίες της,
// η συνάρτηση καλείται δεκάδες χιλιάδες φορές αντί για μία ανά επεισόδιο.
const catCache = new Map();

function categoriesFor(id, title){
  if (catCache.has(id)) return catCache.get(id);

  const picked = curation().categories && curation().categories[id];
  const result = picked
    ? (Array.isArray(picked) ? picked : [picked])
    : suggestCategories(title);

  catCache.set(id, result);
  return result;
}

function episodeCategories(ep){
  return categoriesFor(ep.id, ep.title);
}

// Σύντομα ονόματα ΜΟΝΟ για την ετικέτα της κάρτας. Με κεφαλαία και αραιά
// γράμματα, το «Συνεντεύξεις και πρόσωπα της επικαιρότητας» έπιανε τρεις
// γραμμές πάνω από κάθε κάρτα. Η σελίδα της εκπομπής κρατάει το πλήρες.
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

// Τα ονόματα έρχονται από τις λίστες του YouTube, γραμμένα από ανθρώπους
// σε διαφορετικές στιγμές: μία είναι ΟΛΟΚΕΦΑΛΑΙΑ, και το όνομα του site
// γράφεται πότε με κεφαλαίο και πότε με πεζό. Εδώ μπαίνουν στην ίδια
// μορφή. Το slug ΔΕΝ αλλάζει — βγαίνει από πεζά χωρίς τόνους — άρα δεν
// σπάει κανένας σύνδεσμος και καμία σελίδα δεν μετονομάζεται.
const SHOW_NAME = {
  'ΕΠΙΚΑΙΡΟΤΗΤΑ': 'Επικαιρότητα',
  'Αναλύσεις στο Newshub.gr': 'Αναλύσεις στο newshub.gr',
};

function showName(raw){
  return SHOW_NAME[raw] || raw;
}

// Η σειρά με την οποία βγαίνουν οι εκπομπές στην αρχική και στη σελίδα
// «Εκπομπές». Μέχρι τώρα ήταν κατά πλήθος επεισοδίων — ο αριθμός όμως
// δεν λέει τι είναι σημαντικό για το site. Η σειρά είναι συντακτική
// απόφαση, όχι στατιστικό, και γράφεται εδώ.
//
// Τα ονόματα μπαίνουν ΑΚΡΙΒΩΣ όπως έρχονται από το YouTube και γίνονται
// slug, ώστε να μη σπάσει τίποτα αν κάποιος γράψει τόνο διαφορετικά.
// Ό,τι δεν είναι στη λίστα βγαίνει μετά, με το παλιό κριτήριο.
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

// Εκπομπές που ΔΕΝ εμφανίζονται στις λίστες. Η σελίδα τους εξακολουθεί
// να χτίζεται και οι παλιοί σύνδεσμοι δουλεύουν — απλώς δεν τη δείχνουμε
// πουθενά. Έτσι, αν το αφεντικό το ξανασκεφτεί, είναι μία γραμμή πίσω.
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

// Κλειδί σύγκρισης τίτλων ανάμεσα σε YouTube και Buzzsprout: πεζά, χωρίς
// τόνους, χωρίς σημεία στίξης, τα πρώτα 60 γράμματα. Αρκετά χαλαρό για να
// αντέχει μικροδιαφορές, αρκετά σφιχτό για να μη μπερδεύει επεισόδια.
function matchKey(text){
  return decode(text).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zα-ω0-9]+/gi, ' ')
    .trim()
    .slice(0, 60);
}

// Σε ποια εκπομπή ανήκει ένα επεισόδιο. Το μαθαίνουμε κοιτώντας αν ο
// τίτλος του υπάρχει στα βίντεο — εκεί η εκπομπή είναι γνωστή με βεβαιότητα.
// Τίποτα δεν γράφεται στα αρχεία δεδομένων· η σύνδεση ζει μόνο στο build.
// Δεύτερο κλειδί: μόνο το κομμάτι ΜΕΤΑ την άνω τελεία.
//
// Οι τίτλοι γράφονται «Όνομα: θέμα», και το όνομα συχνά διαφέρει ανάμεσα
// στις δύο πηγές — «Ειρήνη Αναστασοπούλου» στο Buzzsprout, «Ειρ.
// Αναστασοπούλου» στο YouTube. Το θέμα όμως είναι ίδιο, οπότε όταν ο
// πλήρης τίτλος αποτυγχάνει, δοκιμάζουμε αυτό. Κερδίζει 103 επεισόδια.
function headKey(text){
  const m = decode(text).match(/^([^:]{3,40}):\s*(.+)$/);
  return matchKey(m ? m[2] : text);
}

// ---- η χειροκίνητη διόρθωση ----
//
// Όλα τα παραπάνω είναι ΜΑΝΤΕΜΑ από τον τίτλο, και αστοχούν σιωπηλά:
// 299 από τα 1.069 επεισόδια δεν βρίσκουν βίντεο και 94 δεν βγάζουν
// καλεσμένο, επειδή ο τίτλος γράφτηκε αλλιώς στο YouTube ή δεν έχει
// άνω τελεία. Τίποτα δεν σπάει — απλώς λείπει, και δεν το βλέπει κανείς.
//
// Το data/pairs.json είναι η απάντηση ανθρώπου σε αυτά: ανά επεισόδιο,
//
//   "Buzzsprout-20078837": {
//     "video": "XNLy2B983xs",     ρητό βίντεο
//     "guest": "Μαρία Παπαδάκη",  ρητός καλεσμένος
//     "novideo": true,            δεν υπάρχει βίντεο, σταμάτα να ρωτάς
//     "noguest": true             δεν υπάρχει καλεσμένος
//   }
//
// Κερδίζει ΠΑΝΤΑ τον τίτλο. Ο τίτλος είναι εικασία, αυτό είναι απόφαση.
let pairData;
function pairs(){
  if (pairData) return pairData;

  pairData = { byEpisode: {}, byVideo: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(PAIRS_FILE, 'utf8'));
    for (const [id, rec] of Object.entries((raw && raw.pairs) || {})) {
      if (!rec || typeof rec !== 'object') continue;
      pairData.byEpisode[id] = rec;
      // Ο ανάποδος δρόμος: από το βίντεο στο επεισόδιο. Τον χρειάζεται
      // η σελίδα βίντεο, που προσφέρει τον ήχο του διδύμου της.
      if (rec.video) pairData.byVideo[rec.video] = id;
    }
  } catch (err) {
    // Χαλασμένο αρχείο δεν ρίχνει το build — αλλά ΔΕΝ περνάει απαρατήρητο:
    // σιωπηλά θα έσβηνε κάθε διόρθωση που έγινε με το χέρι.
    if (err.code !== 'ENOENT') {
      console.warn('ΠΡΟΣΟΧΗ: το data/pairs.json δεν διαβάζεται —', err.message);
    }
  }
  return pairData;
}

function pairOf(ep){
  return (ep && pairs().byEpisode[ep.id]) || null;
}

// Τα κλειδιά τίτλου ενός επεισοδίου, για όποιον ψάχνει το βίντεό του.
//
// Κενά όταν υπάρχει ρητή απάντηση — είτε «αυτό είναι το βίντεο» είτε
// «βίντεο δεν υπάρχει». Και στις δύο περιπτώσεις το μάντεμα πρέπει να
// σωπάσει: αλλιώς μια τυχαία ομοιότητα τίτλου θα έφερνε ΔΕΥΤΕΡΟ βίντεο
// από την πίσω πόρτα, και ο συντάκτης θα κοίταζε μια διόρθωση που δεν
// ίσχυσε πουθενά.
function episodeKeys(ep){
  const fix = pairOf(ep);
  if (fix && (fix.video || fix.novideo)) return [];
  return [matchKey(ep.title), headKey(ep.title)];
}

// Σε ποια εκπομπή ανήκει ένα επεισόδιο — το μαθαίνουμε από το βίντεό του.
// Κλειδί σύγκρισης ετικέτας: χωρίς δίεση, τόνους και σημεία στίξης.
function tagKey(s){
  return String(decode(s)).replace(/^#/, '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zα-ω0-9]+/gi, '');
}

// Η εκπομπή από ετικέτα του Buzzsprout. Ζητάει ΡΗΤΗ σήμανση:
//
//     #εκπομπή:Αναλύσεις
//
// Δεν δεχόμαστε σκέτο «#Αναλύσεις», γιατί οι ετικέτες είναι κυρίως
// θεματικές και θα μπερδεύονταν: ένα επεισόδιο με #ιστορία μιλάει ΓΙΑ
// ιστορία, δεν ανήκει απαραίτητα στην εκπομπή «Ιστορία στο newshub.gr».
// Δεχόμαστε και το πλήρες όνομα της λίστας, που είναι αρκετά ξεχωριστό
// ώστε να μην πέφτει τυχαία.
let showByTag;
function showFromTags(ep){
  if (!ep.keywords || !ep.keywords.length) return '';

  if (!showByTag) {
    showByTag = new Map();
    for (const v of loadVideos()) {
      if (!v.show) continue;
      showByTag.set(tagKey(v.show), v.show);           // πλήρες όνομα λίστας
      showByTag.set(tagKey(showLabel(v.show)), v.show); // και η σύντομη μορφή
    }
  }

  for (const raw of ep.keywords) {
    const t = decode(raw).replace(/^#/, '').trim();

    // Με ρητή σήμανση δεχόμαστε και τη σύντομη μορφή.
    const marked = t.match(/^εκπομπ[ήη]\s*[:\-–]\s*(.+)$/i);
    if (marked) {
      const hit = showByTag.get(tagKey(marked[1]));
      if (hit) return hit;
      continue;
    }

    // Χωρίς σήμανση, μόνο αν ταιριάζει ΟΛΟΚΛΗΡΟ το όνομα της λίστας.
    for (const v of showByTag.values()) {
      if (tagKey(v) === tagKey(t)) return v;
    }
  }

  return '';
}

function episodeShow(ep){
  // Πρώτα ό,τι δήλωσε ο δημοσιογράφος, μετά ό,τι βρίσκουμε μόνοι μας.
  const tagged = showFromTags(ep);
  if (tagged) return tagged;

  const v = videoTwin(ep);
  return v ? v.show : '';
}

// Μία ομάδα ανά εκπομπή, με βίντεο ΚΑΙ επεισόδια μαζί. Όπου ένα βίντεο
// έχει δίδυμο επεισόδιο, κρατάμε το επεισόδιο: έχει δική μας σελίδα, οπότε
// ο επισκέπτης μένει εδώ αντί να φύγει στο YouTube.
function buildShows(videos, episodes){
  const groups = {};
  for (const v of videos) {
    if (!v.show) continue;
    const key = slugify(v.show);
    if (!key) continue;
    if (!groups[key]) groups[key] = { name: v.show, items: [] };

    // Το ζευγάρωμα γίνεται ΜΟΝΟ από το episodeTwin. Εδώ υπήρχε δεύτερο
    // αντίγραφο της ίδιας αναζήτησης, και έμεινε πίσω: όταν προστέθηκε
    // το ταίριασμα με όνομα και ημερομηνία, η λωρίδα της εκπομπής
    // συνέχισε να δείχνει το βίντεο ενώ η ροή έδειχνε το επεισόδιο.
    // Ίδιο πράγμα, δύο θέσεις, δύο ημερομηνίες — το είδε το αφεντικό.
    const twin = episodeTwin(v);
    groups[key].items.push(twin ? itemFromEpisode(twin) : itemFromVideo(v));
  }

  for (const key of Object.keys(groups)) {
    groups[key].items.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  return groups;
}

// Η ενότητα «Εκπομπές» της αρχικής: μία κάρτα ανά εκπομπή, με τη
// μικρογραφία του πιο πρόσφατου βίντεό της.
// ---- τα εξώφυλλα των εκπομπών ----
//
// Έχουν τον τίτλο ΨΗΜΕΝΟ μέσα στην εικόνα, στο κέντρο, σε 16:9.
// Από αυτό βγαίνουν δύο κανόνες που δεν παραβιάζονται πουθενά:
//
//   1. ΠΟΤΕ crop. Το παραμικρό κόψιμο τρώει τον τίτλο. Όπου μπαίνουν,
//      μπαίνουν ολόκληρες, σε θέση 16:9.
//   2. Ποτέ δικός μας τίτλος από πάνω τους. Θα γραφόταν δύο φορές.
//
// Η αντιστοίχιση είναι ΔΕΔΟΜΕΝΑ, στο data/show-art.json: τα ονόματα
// των εκπομπών έρχονται από το YouTube και δεν μαντεύονται από slug.
let artMap;
function showArtMap(){
  if (!artMap) {
    artMap = {};
    try {
      const raw = JSON.parse(fs.readFileSync(SHOW_ART_FILE, 'utf8'));
      for (const [show, v] of Object.entries(raw.art || {})) {
        // Δέχεται και σκέτο όνομα αρχείου, για να μη σπάσει αν κάποιος
        // γράψει γρήγορα «"Εκπομπή": "αρχείο"» χωρίς τα υπόλοιπα.
        artMap[matchKey(show)] = typeof v === 'string'
          ? { file: v, titled: true }
          : { file: v.file, titled: v.titled !== false };
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn('ΠΡΟΣΟΧΗ: το data/show-art.json δεν διαβάζεται —', err.message);
      }
    }
  }
  return artMap;
}

// Η εγγραφή μιας εκπομπής, ή null. Το matchKey ισοπεδώνει τόνους και
// κεφαλαία, ώστε «Newshub.gr» και «newshub.gr» να πέφτουν μαζί.
function showArtOf(name){
  const m = showArtMap();
  return m[matchKey(showName(name))] || m[matchKey(name)] || null;
}

// Έχει ο τίτλος ψηθεί μέσα στην εικόνα; Τότε δεν τον ξαναγράφουμε.
function artIsTitled(name){
  const a = showArtOf(name);
  return !!(a && a.titled);
}

// Η περιγραφή μιας εκπομπής, γραμμένη από τη σύνταξη στο YouTube και
// κατεβασμένη από το fetch-videos.js. 12 από τις 16 έχουν — οι
// υπόλοιπες απλώς δεν δείχνουν παράγραφο.
//
// Δεν τις γράφουμε εμείς: η σύνταξη τις έχει ήδη, και έτσι μένουν
// συγχρονισμένες χωρίς να μάθει κανείς καινούργιο εργαλείο.
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

  // Η περιγραφή του YouTube είναι γραμμένη σε ΓΡΑΜΜΕΣ, και οι γραμμές
  // σημαίνουν κάτι: η τελευταία είναι συνήθως «Παρουσίαση: Όνομα».
  //
  // Τις ισοπεδώναμε σε κενά, κι έβγαινε «…ιστορία, πολιτισμός
  // παρουσίαση: Γιάννης Χαραλαμπίδης» — δύο προτάσεις κολλημένες,
  // με πεζό αρχικό στη μέση. Τώρα κάθε γραμμή μένει χωριστή.
  return text
    .split(/\s*https?:\/\//)[0]          // ό,τι ακολουθεί σύνδεσμο φεύγει
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    // Το YouTube γράφει άλλοτε «Παρουσίαση» και άλλοτε «παρουσίαση».
    // Κεφαλαίο το πρώτο γράμμα κάθε γραμμής — είναι αρχή πρότασης.
    .map((line) => line.charAt(0).toLocaleUpperCase('el') + line.slice(1))
    .slice(0, 3);
}

// Η εικόνα σε τρία μεγέθη. Ο browser διαλέγει μόνος του από το srcset:
// μια κάρτα 343px κατεβάζει 24KB, όχι το πλήρες των 300KB.
//
// Το «sizes» λέει πόσο ΠΛΑΤΟΣ θα πιάσει η εικόνα στη σελίδα — χωρίς
// αυτό ο browser υποθέτει 100vw και κατεβάζει πάντα το μεγαλύτερο.
// Κάτω από αυτό το πλάτος ο ψημένος τίτλος δεν διαβάζεται: η εικόνα
// γίνεται θολή κηλίδα και είναι χειρότερη από ένα στιγμιότυπο. Όποια
// θέση είναι πιο στενή, παίρνει το εξώφυλλο του τελευταίου επεισοδίου.
const ART_MIN = 200;

// Οι διαστάσεις ενός webp, διαβασμένες από το ΙΔΙΟ το αρχείο.
//
// Γράφαμε παντού «400w, 800w, 1600w» και «width=1600 height=900» χωρίς
// να τα ελέγχει κανείς, και δύο πράγματα χαλούσαν:
//   · όποια αφίσα ήταν μικρότερη, ο browser τη θεωρούσε 1600άρα και τη
//     ζωγράφιζε σμικρυμένη — 426px αρχείο έβγαινε 224px στη σελίδα
//   · η τετράγωνη αφίσα δήλωνε 16:9, άρα η σελίδα τιναζόταν μόλις
//     φόρτωνε η εικόνα και φαινόταν το αληθινό της σχήμα
// Τα αρχεία είναι 40 και διαβάζονται μία φορά το καθένα.
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
  const src = `${up}shows/${art.file}`;

  // Το μεγάλο αρχείο ορίζει σχήμα και αναλογία· τα -800/-400 είναι
  // σμικρύνσεις του ίδιου καρέ. Αν λείπει κάποιο, το παραλείπουμε από
  // το srcset αντί να πούμε ψέματα για το πλάτος του.
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

      // Με δικό της εξώφυλλο, η κάρτα ΔΕΝ γράφει τον τίτλο: είναι ήδη
      // μέσα στην εικόνα. Χωρίς εξώφυλλο, το στιγμιότυπο του βίντεο
      // δεν λέει τίποτα μόνο του, οπότε το όνομα μπαίνει από κάτω.
      const art = showArtImg(g.name, {
        depth,
        cls: 'card-image show-cover',
        // Τέσσερις στήλες στο πλήρες πλάτος, δύο στα μεσαία, μία στο κινητό.
        sizes: '(max-width: 560px) 90vw, (max-width: 1100px) 45vw, 23vw',
        // Μετρημένο: 256px στα 1280, 290px στα 390 — το στενότερο είναι 256.
        minWidth: 256,
      });

      // Το όνομα γράφεται ΠΑΝΤΑ. Το είχα παραλείψει όπου ο τίτλος είναι
      // ψημένος στην αφίσα, αλλά σε κάρτα 256px δεν διαβάζεται — και οι
      // μισές κάρτες έμεναν ανώνυμες δίπλα στις άλλες.
      //
      // Η διαφορά είναι ΠΟΥ κάθεται: με αφίσα πάει από κάτω, ώστε να
      // μη σκεπάζει την εικόνα· χωρίς, μένει πάνω της με σκίαση.
      return `      <article class="show-card${art ? ' show-card--art' : ''}">
        <a class="card-link" href="${up}${showUrl(g.name)}">
          ${art || (latest && latest.image
            ? `<img class="card-image" src="${latest.image}" alt="" loading="lazy">`
            : '<div class="card-image card-image--empty"></div>')}
          <h3 class="show-name">${esc(showName(g.name))}</h3>
          <p class="card-meta">${count === 1 ? '1 επεισόδιο' : `${count.toLocaleString('el')} επεισόδια`}</p>
        </a>
      </article>`;
    }).join('\n');

  // Οι εκπομπές και οι πλατφόρμες μπαίνουν στο ΙΔΙΟ πλαίσιο: και τα δύο
  // απαντούν στο ίδιο ερώτημα — «τι ακούω και πού». Χωριστά, ο κόσμος
  // έβλεπε τις εκπομπές και έφτανε στις πλατφόρμες τρεις ενότητες μετά.
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

// Το λογότυπο του newshub.gr, φτιαγμένο με γράμματα και CSS αντί για
// εικόνα: μένει καθαρό σε κάθε οθόνη, παίρνει το μέγεθος του κειμένου
// γύρω του, και δεν είναι ένα ακόμα αρχείο να κατέβει.
function nhLogo(){
  return `<span class="nh">news<b>hub</b><i>.gr</i></span>`;
}

// Το μικρόφωνο της ενότητας podcast.
function micIcon(){
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M8.5 21h7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
}

// ---- σελίδες κατηγορίας ----

// Μία ομάδα ανά κατηγορία, με επεισόδια ΚΑΙ βίντεο μαζί. Όπου ένα βίντεο
// έχει δίδυμο επεισόδιο, κρατάμε το επεισόδιο — έχει δική μας σελίδα.
// Τα δικά μας άρθρα μπαίνουν ΚΑΙ ΑΥΤΑ στις σελίδες κατηγορίας.
//
// Χωρίς αυτό, ο δημοσιογράφος διάλεγε «Κρήτη» στο διαχειριστικό και η
// επιλογή του έκανε μόνο την ετικέτα στην κάρτα: το άρθρο δεν φαινόταν
// ποτέ στο /category/kriti.html. Η επιλογή πρέπει να σημαίνει αυτό που
// δείχνει ότι σημαίνει.
//
// Η κατηγορία εδώ είναι ΡΗΤΗ — τη διάλεξε άνθρωπος — σε αντίθεση με
// επεισόδια και βίντεο, όπου τη μαντεύουμε από τον τίτλο.
function buildCategories(videos, episodes, ownArticles = []){
  const groups = {};
  const seen = new Set();

  // Ένα επεισόδιο μπαίνει σε ΟΛΕΣ τις κατηγορίες του. Το seen εμποδίζει
  // μόνο να μπει δύο φορές το ίδιο πράγμα — όχι να μπει σε πολλά θέματα.
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
    if (videoHasTwin(v)) continue;          // το podcast του μπήκε ήδη
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

// Υπάρχει επεισόδιο με τον ίδιο τίτλο; Τότε το βίντεο είναι διπλό.
let episodeTitles;
function videoHasTwin(v){
  // Ρητό ζευγάρωμα: το βίντεο ανήκει σε επεισόδιο ό,τι κι αν λέει ο τίτλος.
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

// ---- Δεύτερη ευκαιρία: ίδιος άνθρωπος, ίδια μέρα, ίδιο θέμα ----
//
// Η σύγκριση τίτλων πιάνει μόνο όταν οι δύο συντάκτες έγραψαν τα ίδια
// λόγια. Συχνά δεν το κάνουν:
//
//   YouTube     Γιώργος Αϋφαντής: Έχουμε αποτύχει στη Τουρκική αποτροπή!
//   Buzzsprout  Γιώργος Αϋφαντής: «Έχουμε αποτύχει στην αποτροπή έναντι
//               της Τουρκίας – Οδεύουμε σε σύγκρουση...»
//
// Ίδια συνέντευξη, δύο τίτλοι. Έβγαινε δύο φορές στην αρχική, και το
// είδε το αφεντικό πριν από εμάς.
//
// ΤΡΕΙΣ ΟΡΟΙ ΜΑΖΙ, και χρειάζονται και οι τρεις. Μετρημένο στα 2.327
// βίντεο χωρίς δίδυμο: το «ίδιο όνομα + 48 ώρες» βρίσκει 66 ζευγάρια
// και κανένα διφορούμενο — αλλά τα 3 από αυτά είναι ΛΑΘΟΣ, γιατί ο
// ίδιος άνθρωπος μίλησε δύο φορές για άλλο πράγμα:
//
//   V  Χρόνης Βάρσος: Η Ελλάδα στη «χαραυγή» του 2ου ΠΠ
//   E  Χρόνης Βάρσος: Αφιέρωμα στη Μικρασιατική Καταστροφή
//
// Οι κοινές λέξεις τα κόβουν και τα τρία, χωρίς να χάσουν κανένα σωστό.
// Δέκα μέρες, όχι δύο. Το βίντεο ανεβαίνει στο YouTube την ίδια μέρα,
// ο ήχος στο Buzzsprout όποτε προλάβει ο μοντέρ — συνήθως τρεις με
// τέσσερις μέρες μετά. Με παράθυρο δύο ημερών χάναμε ακριβώς αυτά.
//
// Μετρημένο στα βίντεο χωρίς δίδυμο, με τον έλεγχο λέξεων ενεργό:
//
//    2 μέρες →  42 ζευγάρια, 0 διφορούμενα
//    5 μέρες →  70 ζευγάρια, 0 διφορούμενα
//   10 μέρες →  70 ζευγάρια, 0 διφορούμενα
//   21 μέρες →  71 ζευγάρια, 0 διφορούμενα
//   60 μέρες →  71 ζευγάρια, 2 ΔΙΦΟΡΟΥΜΕΝΑ
//
// Στις 10 είμαστε στο πλατό και πολύ πριν αρχίσουν τα μπερδέματα.
const TWIN_MERES = 10;     // πόσο μακριά επιτρέπεται να είναι οι δύο ημερομηνίες
const TWIN_KOINES = 2;     // πόσες λέξεις πρέπει να μοιράζονται τα θέματα
const TWIN_MIKOS = 5;      // πόσο μεγάλη πρέπει να είναι μια λέξη για να μετρήσει

// Το όνομα μπροστά από την άνω τελεία, κανονικοποιημένο.
function onomaApoTitlo(text){
  const m = decode(text).match(/^([^:]{3,40}):/);
  return m ? matchKey(m[1]) : '';
}

// Οι λέξεις του θέματος — ό,τι είναι ΜΕΤΑ την άνω τελεία. Μόνο οι
// μεγάλες: τα «στη», «και», «του» τα μοιράζονται όλοι οι τίτλοι του
// κόσμου και δεν αποδεικνύουν τίποτα.
function themaLexeis(text){
  const m = decode(text).match(/^([^:]{3,40}):\s*(.+)$/);
  return new Set(
    matchKey(m ? m[2] : text).split(' ').filter((w) => w.length >= TWIN_MIKOS),
  );
}

let epsAnaOnoma;
function twinApoOnoma(v){
  if (!epsAnaOnoma) {
    epsAnaOnoma = {};
    for (const ep of loadEpisodes()) {
      // Όπου μίλησε άνθρωπος, δεν μαντεύουμε. Το «novideo» σημαίνει
      // «το έψαξα, δεν υπάρχει» — και το ρητό βίντεο σημαίνει ότι το
      // επεισόδιο είναι ήδη πιασμένο αλλού.
      const fix = pairOf(ep);
      if (fix && (fix.video || fix.novideo)) continue;

      const n = onomaApoTitlo(ep.title);
      if (n) (epsAnaOnoma[n] = epsAnaOnoma[n] || []).push(ep);
    }
  }

  const onoma = onomaApoTitlo(v.title);
  if (!onoma || !epsAnaOnoma[onoma]) return null;

  const pote = new Date(v.date).getTime();
  if (isNaN(pote)) return null;

  const dikes = themaLexeis(v.title);

  // Πρώτα η ημερομηνία, μετά το θέμα — και η μέτρηση γίνεται ΠΑΝΩ ΣΕ
  // ΟΣΑ ΠΕΡΑΣΑΝ και τα δύο. Με δεκαήμερο παράθυρο ένας συχνός
  // καλεσμένος έχει συχνά δύο επεισόδια μέσα στο διάστημα· αν
  // κόβαμε στο «δύο υποψήφιοι» πριν κοιτάξουμε θέμα, θα πετούσαμε
  // ζευγάρια που είναι ολοφάνερα σωστά.
  const tairiazoun = epsAnaOnoma[onoma].filter((ep) => {
    if (Math.abs(new Date(ep.date).getTime() - pote) >= TWIN_MERES * 864e5) return false;

    const alles = themaLexeis(ep.title);
    let koines = 0;
    for (const w of dikes) if (alles.has(w)) koines++;
    return koines >= TWIN_KOINES;
  });

  // Δύο που ταιριάζουν σημαίνει ότι δεν ξέρουμε. Καλύτερα διπλή
  // εμφάνιση παρά να κρύψουμε λάθος βίντεο — το διπλό το βλέπεις και
  // το διορθώνεις, το κρυμμένο όχι.
  return tairiazoun.length === 1 ? tairiazoun[0] : null;
}

// Το αντίστροφο του videoTwin: από βίντεο βρες το επεισόδιο. Χρειάζεται
// ώστε η σελίδα βίντεο να μπορεί να προσφέρει και τον ήχο — τον ίδιο
// player, με τη θέση να κρατιέται, όπως κάνει η σελίδα επεισοδίου.
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
      // Ίδιος κανόνας με το videoHasTwin, αλλιώς το βίντεο θα κρυβόταν
      // από τη ροή ως «έχει δίδυμο» και η σελίδα του δεν θα πρόσφερε
      // τον ήχο εκείνου του διδύμου.
      || twinApoOnoma(v)
      || null;
}

// Σχετικά βίντεο: από την ίδια εκπομπή, εκτός από το ίδιο. Όσα έχουν
// δίδυμο επεισόδιο παραλείπονται — εκείνα τα δείχνει η σελίδα τους.
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

// ---- σελιδοποίηση ----

// Πόσα αντικείμενα ανά σελίδα. Η Κρήτη έχει 1.082 και η ΕΠΙΚΑΙΡΟΤΗΤΑ
// 1.532 — χωρίς σπάσιμο, το 74% των θεμάτων και το 86% των εκπομπών
// ήταν απρόσιτα, ενώ η αρχική υποσχόταν «Όλα τα 1.082».
const PER_PAGE = 60;

// Η ΠΡΩΤΗ σελίδα κρατάει το σκέτο όνομα. Έτσι καμία υπάρχουσα διεύθυνση
// δεν αλλάζει και κανένας σύνδεσμος δεν σπάει.
function pagedName(base, n){
  return n <= 1 ? `${base}.html` : `${base}-${n}.html`;
}

function pageCount(total){
  return Math.max(1, Math.ceil(total / PER_PAGE));
}

// Γράφει μόνο αν άλλαξε κάτι, και λέει αν έγραψε.
//
// Το ίδιο μοτίβο που κάνουν ήδη οι σελίδες επεισοδίων. Οι «μοναδικές»
// σελίδες — αρχική, θέματα, εκπομπές — γράφονταν πάντα, οπότε η
// ημερομηνία τους άλλαζε σε κάθε τρέξιμο ακόμα κι όταν το περιεχόμενο
// ήταν ίδιο. Αυτό χαλούσε τον έλεγχο «είναι παλιό το ευρετήριο;» και
// πείραζε άδικα 25 αρχεία σε κάθε build.
let writes = 0;
function writeIfChanged(file, text){
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (current === text) return false;
  fs.writeFileSync(file, text, 'utf8');
  writes++;
  return true;
}

// Η επικεφαλίδα μιας σελίδας θέματος ή εκπομπής: εικονίδιο μέσα σε
// έγχρωμο τετράγωνο, όνομα, και μετρητής. Το χρώμα και το εικονίδιο
// είναι ΤΑ ΙΔΙΑ με τη λωρίδα του θέματος στην αρχική — ώστε να φαίνεται
// ότι είναι το ίδιο πράγμα, από όπου κι αν ήρθες.
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

// Η μπάρα πλοήγησης. Σε 26 σελίδες δεν τις γράφουμε όλες: δείχνουμε την
// αρχή, το τέλος και τη γειτονιά της τρέχουσας, με «…» ανάμεσα.
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

// Τι γράφουμε πάνω από τις κάρτες, ώστε να ξέρει ο επισκέπτης πού είναι.
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

  // Το υπόβαθρο του θέματος: το εξώφυλλο του πιο πρόσφατου κομματιού του.
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

// Κοινό τύλιγμα για τις σελιδοποιημένες σελίδες: τίτλος που λέει σε ποια
// σελίδα είσαι, και τα rel=prev/next που θέλει η Google για να καταλάβει
// ότι οι 19 σελίδες της Κρήτης είναι μία σειρά, όχι 19 άσχετες σελίδες.
// ΠΡΟΣΟΧΗ: η παράμετρος λέγεται «n», όχι «page» — το «page» είναι το
// όνομα της συνάρτησης που φτιάχνει τη σελίδα, και θα τη σκέπαζε.
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

// Το αρχείο: όλα τα επεισόδια, σελίδα σελίδα. Ο σύνδεσμος της αρχικής
// λέει «Όλα τα επεισόδια» και πρέπει να παραδίδει ακριβώς αυτό.
// Ο μήνας στη γενική, για φράσεις όπως «από τον Δεκέμβριο 2021».
const MONTHS_OF = ['Ιανουάριο', 'Φεβρουάριο', 'Μάρτιο', 'Απρίλιο', 'Μάιο', 'Ιούνιο',
  'Ιούλιο', 'Αύγουστο', 'Σεπτέμβριο', 'Οκτώβριο', 'Νοέμβριο', 'Δεκέμβριο'];

function monthName(iso){
  const d = new Date(iso);
  const a = athens(d);
  return a ? MONTHS_OF[a.month] : '';
}

// Ονομαστική, για επικεφαλίδες μέσα στο αρχείο: «Οκτώβριος 2026».
const MONTHS_NOM = ['Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος',
  'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος'];

// Σε ποια σελίδα αρχίζει κάθε χρονιά. Το αρχείο είναι ταξινομημένο από
// το νεότερο προς το παλιότερο, οπότε η πρώτη εμφάνιση μιας χρονιάς
// δείχνει και τη σελίδα της.
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

  // Οι κάρτες με επικεφαλίδα κάθε φορά που αλλάζει ο μήνας. Χωρίς αυτήν,
  // το αρχείο είναι 18 σελίδες ίδιες κάρτες και χάνεις την αίσθηση του
  // πού βρίσκεσαι μέσα στον χρόνο.
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

  // Το μέγεθος του αρχείου ΕΙΝΑΙ η ταυτότητα της σελίδας, οπότε γίνεται
  // το γραφικό της: ο αριθμός μεγάλος, και δίπλα οι ώρες και η χρονιά
  // που ξεκίνησαν όλα.
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

// Η σελίδα με όλα τα θέματα. Δείχνει και τις άδειες, ώστε να φαίνεται
// τι λείπει και να ξέρει ο συντάκτης πού να δουλέψει.
// Πόσα θέματα παίρνουν μεγάλη κάρτα με εικόνα στην κορυφή.
const TOPICS_LEAD = 4;

// Πόσους τίτλους δείχνει η στήλη κάθε θέματος πιο κάτω.
const TOPICS_PEEK = 3;

function categoriesIndexPage(groups){
  // Τα θέματα χωρίς περιεχόμενο δεν φαίνονται καθόλου. Ένα θέμα που
  // υπόσχεται και δεν δίνει τίποτα είναι χειρότερο από ένα που λείπει.
  //
  // Σειρά κατά πλήθος, φθίνουσα. Πριν ήταν με τη σειρά του CATEGORIES,
  // που είναι σειρά αναγνώρισης λέξεων — τυχαία για τον αναγνώστη, και
  // έβαζε πρώτα τα «Agronews» και «Tech-Hub» με λίγα κομμάτια.
  const live = CATEGORIES
    .map(([name]) => ({ name, key: slugify(name), g: groups[slugify(name)] }))
    .filter((c) => c.g && c.g.items.length)
    .map((c) => ({ ...c, n: c.g.items.length }))
    .sort((a, b) => b.n - a.n);

  const lead = live.slice(0, TOPICS_LEAD);
  const rest = live.slice(TOPICS_LEAD);

  // Τα κορυφαία με εικόνα. Η εικόνα είναι του πιο πρόσφατου κομματιού
  // του θέματος που έχει εξώφυλλο — δεν έχουν όλα.
  //
  // Κρατάμε ποιες εικόνες πιάστηκαν, γιατί ένα επεισόδιο ανήκει σε
  // πολλά θέματα: το πιο πρόσφατο της «Πολιτικής» ήταν και το πιο
  // πρόσφατο του «Κόσμου», και οι δύο κάρτες έβγαιναν ίδιες.
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

  // Τα υπόλοιπα: στήλη με τους πιο πρόσφατους τίτλους, χωρίς εικόνες.
  //
  // ΕΠΙΤΗΔΕΣ διαφορετικά από την αρχική. Εκείνη δείχνει κάρτες με
  // εξώφυλλα· αν τα έβαζα κι εδώ, η σελίδα θα ήταν η ίδια σελίδα δύο
  // φορές. Εδώ η δουλειά είναι άλλη: να δεις με μια ματιά τι βρίσκεται
  // μέσα σε κάθε θέμα, και σκέτα ονόματα με έναν αριθμό δεν το λένε.
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

// ---- τα θέματα στην αρχική ----

// Η λεπτή λωρίδα πάνω από τη ροή. Κάθε ετικέτα είναι ΚΑΝΟΝΙΚΟΣ σύνδεσμος
// προς τη σελίδα του θέματος — δουλεύει χωρίς JavaScript και η Google
// ακολουθεί και τα δεκατρία. Ο player.js πιάνει το κλικ και φιλτράρει τη
// ροή επί τόπου, χωρίς να φορτώσει τίποτα.
//
// Μόνο κείμενο, καμία εικόνα: έτσι δεν μπερδεύεται με τις κάρτες των
// εκπομπών πιο κάτω. Εκπομπή = πού ακούστηκε. Θέμα = περί τίνος μιλάει.
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

  // Χωρίς ορατή ετικέτα «Θέματα» μπροστά: οι ίδιες οι ετικέτες λένε τι
  // είναι, και η λωρίδα κάθεται ήδη κάτω από τον τίτλο της ενότητας.
  // Το aria-label μένει — όποιος ακούει τη σελίδα δεν βλέπει τα χρώματα
  // και χρειάζεται να ξέρει τι είναι αυτή η ομάδα συνδέσμων.
  return `  <nav class="topics" aria-label="Φίλτρα θεμάτων">
    <div class="topics-list">
        <a class="topic is-on" href="categories.html" data-topic="all">Όλα</a>
${chips}
    </div>
  </nav>`;
}

// Το εικονίδιο κάθε θέματος, όπως κάνει και το newshub.gr. Όποιο θέμα
// δεν έχει δικό του παίρνει το απλό σημάδι — δεν σπάει τίποτα.
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

// Πόσες κάρτες παίρνει κάθε θέμα στη λωρίδα του: μία μεγάλη και τρεις
// μικρές.
//
// Ήταν 5 (μία συν τέσσερις), για να μη μένει μισοάδεια η δεξιά στήλη
// δίπλα στην τετράγωνη μεγάλη εικόνα. Το γέμιζε, αλλά στρίμωχνε τις
// μικρογραφίες. Τώρα οι μικρές είναι τρεις και η μικρογραφία τους
// μεγάλωσε αντίστοιχα — δες το .row-card-link στο styles.css, που
// πρέπει να αλλάζει ΜΑΖΙ με αυτόν τον αριθμό, αλλιώς ξαναμένει κενό.
const TOPIC_ROW = 4;

// Πόσες κάρτες κάθε θέματος κρύβονται μέσα στη ροή της αρχικής, ώστε το
// φιλτράρισμα να έχει πάντα τι να δείξει.
const FLOW_PER_TOPIC = 6;

// Πόσα φαίνονται στη ροή «Τελευταία» πριν το «Όλα τα επεισόδια →».
// Τα καρφιτσωμένα του διαχειριστικού πιάνουν θέσεις ΜΕΣΑ σε αυτά.
const FLOW_VISIBLE = 9;

// Λίστες του YouTube που ΔΕΝ μπαίνουν στη ροή της αρχικής όταν δεν
// έχουν podcast από πίσω.
//
// Η ΕΠΙΚΑΙΡΟΤΗΤΑ δεν είναι εκπομπή: είναι ωμά αποσπάσματα ρεπορτάζ,
// 31 τον μήνα — περισσότερα από όλες τις εκπομπές μαζί. Μέσα στη ροή
// θα έπνιγαν τα επεισόδια, που είναι ο λόγος ύπαρξης της σελίδας.
//
// Στις κατηγορίες, στα θέματα και στη σελίδα της λίστας τους βγαίνουν
// κανονικά. Εδώ μιλάμε ΜΟΝΟ για τις εννιά κάρτες της αρχικής.
const FLOW_SKIP_SHOWS = new Set(['ΕΠΙΚΑΙΡΟΤΗΤΑ']);

// Μία λωρίδα για ένα θέμα: όνομα, οι πιο πρόσφατες κάρτες του, και ο
// δρόμος προς όλα τα υπόλοιπα.
function topicRow(group){
  const key = slugify(group.name);
  const total = group.items.length;

  // Μία μεγάλη και τρεις μικρές, αντί για τέσσερις ίδιες στη σειρά: το
  // πιο πρόσφατο του θέματος παίρνει πραγματικό χώρο, και η ενότητα
  // αποκτά ιεραρχία αντί να είναι τέσσερα πανομοιότυπα κουτιά.
  const items = group.items.slice(0, TOPIC_ROW);
  const lead = items[0];
  const rest = items.slice(1);

  // Ολόκληρη η μπάρα είναι ο σύνδεσμος — μεγάλος στόχος, και στο κινητό
  // δεν χρειάζεται να πετύχει κανείς ένα μικρό «Όλα».
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

// Οι τέσσερις λωρίδες μαζί. Ένα θέμα που δεν έχει ακόμα περιεχόμενο
// απλώς παραλείπεται — δεν αφήνουμε κενή λωρίδα στη σελίδα.
function topicRows(groups){
  return featuredTopics()
    .map((name) => groups[slugify(name)])
    .filter((g) => g && g.items.length)
    .map((g) => topicRow(g))
    .join('\n\n');
}

// Οι ενότητες με χρωματιστό πλαίσιο, κάτω από το «Και ακόμα». Η κάθε μία
// παίρνει το χρώμα του θέματός της — πράσινο το Agronews, μπλε το
// Tech-Hub — και δικό της γραφικό: το «agro» βάζει το εικονίδιο μεγάλο
// στο πλάι, το «tech» το βάζει πάνω με κεφαλαία γράμματα.
function spotlightSections(groups){
  return SPOTLIGHT_TOPICS
    .map(([name, variant, blurb]) => ({ g: groups[slugify(name)], variant, blurb, key: slugify(name) }))
    .filter((x) => x.g && x.g.items.length)
    .map(({ g, variant, blurb, key }) => {
      const total = g.items.length;
      const cards = g.items.slice(0, SPOTLIGHT_CARDS).map((it) => card(inTopic(it, g.name))).join('\n');


      return `  <section class="spot spot--${variant}" data-topic="${key}">
    <header class="spot-head">
      <span class="spot-icon">${topicIcon(key)}</span>
      <div class="spot-text">
        <h2 class="spot-title">${esc(g.name)}</h2>
        <p class="spot-sub">${esc(blurb)}</p>
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

// Πόσες κάρτες δείχνει μια ενότητα με πλαίσιο.
//
// Ήταν 4 και οι κάρτες έβγαιναν 196px μέσα στη στήλη — η εικόνα τόσο
// μικρή που δεν έλεγε τίποτα. Τρεις πιάνουν τον ίδιο χώρο και
// αναπνέουν. Αλλάζει ΜΑΖΙ με την κλάση .grid--3 παρακάτω.
const SPOTLIGHT_CARDS = 3;

// Το γραφικό σήμα μιας ενότητας: κουκκίδα που χτυπάει, μεγάλη λέξη σε
// δύο τόνους, γραμμές δεξιά κι αριστερά. Το «δεύτερο μισό πιο σβηστό»
// είναι το μοτίβο του λογοτύπου του newshub.gr, όπου το «hub» ξεχωρίζει.
// Γράφεται ΜΙΑ φορά και το φοράνε όλες οι ενότητες.
function bandMark(first, second, sub, depth = 0){
  const up = depth === 0 ? '' : '../';

  // Το σήμα μπαίνει ΑΝΑΜΕΣΑ στη γραμμή και στην τελεία που αναβοσβήνει.
  // Σκοπός του δεν είναι να διαβαστεί — είναι να αναγνωρίζεται. Κάθε
  // λωρίδα της αρχικής το περνάει μπροστά από τα μάτια, ώστε να μένει
  // ότι αυτό εδώ είναι το Newshub Multimedia, όχι το κεντρικό site.
  //
  // aria-hidden: ο αναγνώστης οθόνης δεν έχει λόγο να το ακούσει σε
  // κάθε ενότητα — η επικεφαλίδα από κάτω λέει ήδη τι είναι.
  return `    <div class="band-head">
      <p class="mark">
        <img class="mark-sign" src="${up}shows/logo-icon.png" alt="" aria-hidden="true" width="512" height="512" loading="lazy">
        <span class="mark-dot"></span>
        <span class="mark-word">${first}<em>${second}</em></span>
      </p>
${sub}
    </div>`;
}

// Πόσες κάρτες δείχνει η μικρή ενότητα κάθε θέματος.
const MORE_CARDS = 2;

// Τα θέματα που δεν πήραν λωρίδα. Το καθένα παίρνει μικρό δικό του χώρο:
// όνομα, πλήθος, και οι τρεις πιο πρόσφατοι τίτλοι του. Σκέτο όνομα με
// έναν αριθμό δεν λέει σε κανέναν τι θα βρει μέσα.
function moreTopics(groups){
  const used = new Set([
    ...featuredTopics().map(slugify),
    ...SPOTLIGHT_TOPICS.map(([name]) => slugify(name)),
  ]);

  const rest = Object.keys(groups)
    .filter((k) => groups[k].items.length && !used.has(k))
    .sort((a, b) => groups[b].items.length - groups[a].items.length);

  if (!rest.length) return '';

  // Κάθε θέμα παίρνει κανονική μικρή ενότητα: ίδια επικεφαλίδα με τις
  // μεγάλες λωρίδες, απλώς σε μικρότερο μέγεθος, και δικές της κάρτες.
  const blocks = rest.map((key) => {
    const g = groups[key];
    const cards = g.items.slice(0, MORE_CARDS).map((it) => card(inTopic(it, g.name))).join('\n');

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

// Η σελίδα με όλες τις εκπομπές. Πιο αναλυτική από την ενότητα της
// αρχικής: δείχνει και το πιο πρόσφατο επεισόδιο κάθε εκπομπής.
// Ο ρυθμός μιας εκπομπής, από τις ημερομηνίες των επεισοδίων της.
//
// Δώδεκα κουτάκια, ένα ανά μήνα του τελευταίου χρόνου. Δείχνει με μια
// ματιά ποια εκπομπή βγάζει σταθερά και ποια κατά διαστήματα — κάτι που
// δεν φαίνεται πουθενά αλλού στο site, ούτε καν στο Buzzsprout.
function showStats(g){
  const dates = g.items.map((it) => new Date(it.date))
    .filter((d) => !isNaN(d))
    .sort((a, b) => a - b);

  if (!dates.length) return null;

  const first = dates[0];
  const last = dates[dates.length - 1];
  const now = new Date();

  // Μετράμε και ΠΟΣΟΥΣ από τους δώδεκα μήνες υπήρχε η εκπομπή. Το
  // «Παρασκήνιο» ξεκίνησε τον Φεβρουάριο και βγάζει επεισόδιο κάθε μήνα
  // από τότε — αν το μετρούσαμε σε δώδεκα, θα έβγαινε 9/12 και θα
  // κατέληγε στις «αραιές» για μήνες που δεν υπήρχε καν.
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
    // Πόσο συχνά βγάζει, σε σχέση με το πόσο καιρό υπάρχει.
    steadiness: activeMonths / aliveMonths,
    fromYear: first.getFullYear(),
    perMonth: inWindow / aliveMonths,
  };
}

// Η λωρίδα ρυθμού. Τα ύψη είναι σχετικά με τον πιο γεμάτο μήνα της ΙΔΙΑΣ
// εκπομπής — αλλιώς η Επικαιρότητα με 18 τον μήνα θα ισοπέδωνε οπτικά
// την Ιστορία με 2, ενώ και οι δύο βγάζουν σταθερά.
function sparkline(bars){
  const top = Math.max(...bars, 1);
  const cells = bars.map((n) => `<i style="--h:${(n / top).toFixed(2)}"${n ? '' : ' class="is-off"'}></i>`).join('');
  return `<span class="spark" aria-hidden="true">${cells}</span>`;
}

// Κυματομορφή για την επικεφαλίδα της σελίδας εκπομπών. Τα ύψη είναι
// σταθερά και γραμμένα εδώ — όχι τυχαία — ώστε η σελίδα να βγαίνει ίδια
// σε κάθε χτίσιμο και να μην αλλάζει χωρίς λόγο στο αποθετήριο.
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

  // Αφίσες, όχι λίστα. Η μεγάλη κάρτα δείχνει και τον τελευταίο τίτλο
  // από κάτω — σε σελίδα αφιερωμένη στις εκπομπές αξίζει να ξέρεις τι
  // παίζει τώρα στην καθεμιά, όχι μόνο πόσα επεισόδια έχει.
  // Κάρτες με το όνομα ΚΑΤΩ από την εικόνα — όχι πάνω της όπως στην
  // αρχική. Η σειρά είναι κατά μέγεθος αρχείου.
  const cards = keys.map((key) => {
    const g = groups[key];
    const latest = g.items[0];
    const n = g.items.length;
    const s = showStats(g);

    return `      <article class="show-tile">
        <a class="show-tile-art" href="${showUrl(g.name)}">
          ${showArtImg(g.name, { cls: 'show-cover', sizes: '(max-width: 760px) 92vw, 30vw', minWidth: 360 })
            || (latest && latest.image
              ? `<img src="${latest.image}" alt="" loading="lazy">`
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

  // Οι εκπομπές που ζουν στο YouTube βγάζουν σελίδα μόνο με βίντεο,
  // οπότε οι μικρογραφίες τους μπορούν να γεμίσουν πλαίσιο 16:9.
  const wide = allVideo(page) ? ' grid--wide' : '';

  // Η κορυφή: η αφίσα σε ΛΟΓΙΚΟ πλάτος, όχι σε όλη την οθόνη, και η
  // ίδια εικόνα θολή από πίσω για να γεμίζει τον χώρο.
  //
  // Σε πλήρες πλάτος έπιανε 1224×689 — μισή οθόνη πριν δεις ένα
  // επεισόδιο. Και τέσσερις από τις αφίσες ήρθαν σε 426px, οπότε
  // τεντωμένες σε 1224 θα ήταν θολές ούτως ή άλλως.
  //
  // Ο <h1> μένει κρυμμένος όπου ο τίτλος είναι ψημένος στην εικόνα:
  // τον χρειάζονται η Google και όποιος ακούει τη σελίδα.
  const art = showArtImg(group.name, {
    depth: 1,
    // Η κλάση ΔΕΝ είναι διακοσμητική: δίνει contain και height:auto.
    // Χωρίς αυτήν το height="900" του attribute κόβει την αφίσα.
    cls: 'show-cover',
    // Το πλάτος της αφίσας, κλειδωμένο από το CSS — δες .show-head-art.
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
${pageHero(art ? `../shows/${showArtOf(group.name).file}-800.webp` : (pic ? pic.image : ''))}

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

// Το podcast σε κάθε πλατφόρμα. Σκέτοι σύνδεσμοι με το όνομα της κάθε
// υπηρεσίας — όχι τα επίσημα κουμπιά τους με τα λογότυπα, που θα ήταν έξι
// εικόνες παραπάνω και ξένα χρώματα μέσα στην παλέτα μας.
// Το τρίτο στοιχείο είναι το χρώμα της κάθε πλατφόρμας. Περνάει ως
// μεταβλητή --brand, οπότε αν αύριο αλλάξουμε ύφος — γεμάτο, περίγραμμα,
// σβηστό — πειράζουμε ΜΟΝΟ τον κανόνα στο CSS, όχι τη λίστα.
// Το τέταρτο στοιχείο είναι το σήμα της πλατφόρμας, σχεδιασμένο ως SVG
// μέσα στη σελίδα. Δεν κατεβάζουμε τα επίσημα κουμπιά τους: θα ήταν έξι
// εικόνες παραπάνω σε κάθε σελίδα, σε λευκό φόντο που δεν ταιριάζει.
// Το «κενό» μέσα στα σήματα παίρνει το φόντο μας από το CSS, ώστε να
// ακολουθεί κι αυτό την παλέτα αν κάποτε αλλάξει.
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

  ['Buzzsprout', 'https://www.buzzsprout.com/1904089', '#5BA829',
    `<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7.4 16.6c-.5-4.4 2.7-8 9-8.2.5 5.3-3.1 8.8-9 8.2z" fill="${DARK}"/>`],
];

// ---- «Must read» ----
//
// Τα κορυφαία άρθρα του κεντρικού site, σε δική τους ζώνη με κόκκινο
// πλαίσιο και το λογότυπο του newshub.gr — ώστε να είναι σαφές ότι εδώ
// μιλάει το κεντρικό site, όχι το multimedia.
//
// ΠΡΟΣΟΧΗ: «κορυφαία» δεν το ξέρει κανείς αυτόματα. Δεν έχουμε
// επισκεψιμότητα, ούτε ετικέτα στο feed. Άρα δύο δρόμοι, με την ίδια
// σειρά προτεραιότητας που ακολουθεί και το πρωτοσέλιδο:
//   1. χειροκίνητα — data/curation.json, πεδίο mustRead
//   2. αυτόματα — τα πιο πρόσφατα, ΕΝΑ ανά κατηγορία, ώστε να μη βγουν
//      τέσσερα «Οικονομία» στη σειρά.
const MUST_COUNT = 4;

function pickMustRead(articles, curation, taken = new Set()){
  const want = (curation.mustRead || []).map((s) => String(s).trim()).filter(Boolean);

  const chosen = want
    .map((w) => articles.find((a) => sameItem({ id: a.id, href: a.url }, w)))
    .filter(Boolean);

  const have = new Set(chosen.map((a) => a.url));
  const seenCat = new Set(chosen.map((a) => a.category));

  // Δύο περάσματα: πρώτα ένα ανά κατηγορία, μετά ό,τι μένει — αλλιώς με
  // λίγες κατηγορίες στο feed η ζώνη θα έβγαινε μισοάδεια.
  for (const strict of [true, false]) {
    for (const a of articles) {
      if (chosen.length >= MUST_COUNT) break;
      if (have.has(a.url) || taken.has(a.url)) continue;
      if (strict && seenCat.has(a.category)) continue;
      chosen.push(a);
      have.add(a.url);
      seenCat.add(a.category);
    }
  }

  return chosen.slice(0, MUST_COUNT);
}

// ---- «Συνέχισε όπου έμεινες» ----
//
// Το ΜΟΝΟ κομμάτι της αρχικής που δεν το ξέρει το build: τι άκουσε ο
// καθένας ζει στον browser του και πουθενά αλλού. Οπότε εδώ γράφουμε
// άδειο και ΚΡΥΦΟ κουτί, και το γεμίζει το player.js αν βρει κάτι.
//
// Γιατί hidden από το build αντί για display:none στο CSS: ο
// καινούριος επισκέπτης — και κάθε ρομπότ — δεν πρέπει να δει καν
// επικεφαλίδα για ενότητα που δεν έχει περιεχόμενο. Έτσι δεν μπαίνει
// ποτέ άδειο κουτί στη σελίδα ούτε στο ευρετήριο της αναζήτησης.
function resumeSection(){
  return `  <section class="syn" data-synexeia hidden aria-labelledby="syn-head">
    <div class="syn-head">
      <h2 class="syn-mark" id="syn-head">Συνέχισε όπου έμεινες</h2>
      <p class="syn-note">Μόνο σε αυτή τη συσκευή</p>
    </div>
    <div class="syn-grid" data-synexeia-grid></div>
  </section>`;
}

function mustReadSection(articles, curation, taken){
  const picks = pickMustRead(articles, curation, taken);

  // Με λιγότερα από δύο η ζώνη δεν στέκει: ένα μοναχικό άρθρο μέσα σε
  // κόκκινο πλαίσιο μοιάζει με διαφήμιση.
  if (picks.length < 2) return '';

  const cards = picks.map((a, i) => {
    const img = a.image_large || a.image_thumb || '';

    // Τα must read ανοίγουν ΕΔΩ, όταν έχουμε το κείμενο — ρητή οδηγία
    // του αφεντικού. Όσα δεν έχουν σώμα κρατούν την παλιά συμπεριφορά
    // και φεύγουν για το newshub.gr, σε νέα καρτέλα.
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

// Η ροή ειδήσεων στο πλάι. Αν δεν υπάρχουν ειδήσεις, δεν βγαίνει καθόλου
// — καλύτερα να λείπει το πλαίσιο παρά να στέκει άδειο.
//
// Το data-roi είναι το σημάδι για το public/roi.js, που αντικαθιστά
// αυτούς τους τίτλους με φρέσκους από το KV. Ό,τι γράφουμε εδώ είναι το
// δίχτυ: το βλέπουν τα ρομπότ των κοινωνικών δικτύων, που δεν εκτελούν
// JavaScript, και όποιος έχασε τη σύνδεση. Γι' αυτό γράφεται κανονικά
// και όχι άδειο πλαίσιο που «θα γεμίσει μετά».
//
// Μέσα στο data-roi μπαίνει η ώρα της πρώτης είδησης. Είναι η απάντηση
// στο «ποιος από τους δύο είναι πιο φρέσκος»: το KV γράφεται από το
// Action και η σελίδα από το χτίσιμο, και δεν προλαβαίνουν πάντα με την
// ίδια σειρά. Χωρίς τη σύγκριση, ένα KV που έμεινε πίσω θα έσβηνε
// καινούριες ειδήσεις και θα έβαζε παλιές στη θέση τους.
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


// Πολλοί τίτλοι γράφονται «Όνομα Επώνυμο στο newshub.gr: ...», οπότε ο
// διαχωρισμός παίρνει και τον ιστότοπο για μέρος του ονόματος. 64 ονόματα
// το έχουν, και 26 από αυτά είναι άνθρωποι που υπάρχουν ήδη και καθαροί —
// χωρίς αυτό, ο καθένας τους παίρνει δεύτερη μισοάδεια σελίδα.
function cleanGuestName(name){
  return String(name)
    // Το όνομα του site, με ή χωρίς «στο», και με τα ορθογραφικά που
    // κυκλοφορούν στους τίτλους: newhub, newhsub, σκέτο newshub.
    .replace(/[\s,–-]*(στο|στον|στη|στην)?\s*new(s)?h(s)?ub\.?\s*(gr)?\b\.?/i, '')
    // Ουρές που δεν είναι μέρος του ονόματος.
    .replace(/[\s,–-]*(ιστορικό\s+αφιέρωμα|αποκλειστικ[όο])\s*!?$/i, '')
    .replace(/[\s,–-]*μέρος\s+\S+$/i, '')
    // Αρχές που δεν είναι μέρος του ονόματος. Το «O» μπαίνει και λατινικό.
    .replace(/^\s*αποκλειστικ[όο]\s*!?\s*/i, '')
    // Επίθετα-καμπάνα που η σύνταξη κολλάει μπροστά από το όνομα:
    // «Αποκαλυπτικός Σταυρος Λυγερός: ...». Περνούσαν τον έλεγχο
    // looksLikePerson — τρεις λέξεις, όλες με κεφαλαίο — και έφτιαχναν
    // τρίτη σελίδα για άνθρωπο που είχε ήδη δύο.
    //
    // Ρητή λίστα, ΟΧΙ κανόνας για καταλήξεις σε -ικός: υπάρχουν
    // επώνυμα που τελειώνουν έτσι και θα τα έτρωγε.
    .replace(/^\s*(αποκαλυπτικ|συγκλονιστικ|συγκινητικ)[όοήηάαέεςσ]*\s+/i, '')
    // Το «i» είναι απαραίτητο: οι τίτλοι γράφουν «Ο Αλέξανδρος», με
    // κεφαλαίο άρθρο. Μπαίνει και λατινικό o, που ξεφεύγει στο γράψιμο.
    .replace(/^(ο|η|το|o)\s+/i, '')
    .replace(/\s*[,–-]\s*$/, '')
    .trim();
}

// Οι τίτλοι «Κάτι: κάτι άλλο» ΔΕΝ έχουν πάντα όνομα μπροστά. Μερικές
// φορές μπροστά είναι η εκπομπή («ΑΝΑΛΥΣΕΙΣ Εξ Απορρήτων») ή σκέτος
// τίτλος («Ρωσική εισβολή»). Χωρίς έλεγχο, αυτά εμφανίζονταν στη θέση
// του καλεσμένου και έφτιαχναν και δικές τους σελίδες προσώπου.
//
// Ο έλεγχος είναι ΑΡΝΗΤΙΚΟΣ επίτηδες: ψάχνει σημάδια ότι κάτι ΔΕΝ είναι
// όνομα, αντί να προσπαθεί να ορίσει τι είναι. Έτσι ένα ασυνήθιστο
// όνομα — «Gian Andrea Paolo Garancini» — περνάει.
function looksLikePerson(name){
  const n = String(name).trim();
  if (!n) return false;

  if (/[«»"!;?…:]/.test(n)) return false;   // εισαγωγικά και θαυμαστικά = τίτλος
  if (/\d/.test(n)) return false;           // «μέρος 9ο»

  const words = n.split(/[\s.\-–]+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;

  // Επετειακοί τίτλοι: «Παγκόσμια Ημέρα Θαλασσαιμίας», «Παγκόσμια Ημέρα
  // Ραδιοφώνου». Τρεις λέξεις με κεφαλαία, άρα περνούσαν όλους τους
  // παρακάτω ελέγχους και έπαιρναν σελίδα προσώπου.
  //
  // ΧΩΡΙΣ \b: στη JavaScript το \b ορίζεται πάνω στο [A-Za-z0-9_], άρα
  // δίπλα σε ελληνικό γράμμα δεν βρίσκει ποτέ όριο λέξης και ο κανόνας
  // δεν πιάνει τίποτα. Το έμαθα εδώ — ισχύει για κάθε ελληνικό regex
  // αυτού του αρχείου.
  if (/(^|\s)ημέρα(\s|$)/i.test(n)) return false;

  for (const w of words) {
    // Κάθε κομμάτι ονόματος ξεκινά με κεφαλαίο. Το «και», «της», «στο»
    // προδίδουν φράση, όχι όνομα.
    if (!/^[Α-ΩΆΈΉΊΌΎΏA-Z]/.test(w)) return false;
    // ΟΛΟΚΕΦΑΛΑΙΑ λέξη = όνομα εκπομπής, όχι ανθρώπου.
    if (/^[Α-ΩΆΈΉΊΌΎΏA-Z]{3,}$/.test(w)) return false;
  }

  return true;
}

// Τα λίγα που περνούν τον έλεγχο αλλά δεν είναι άνθρωποι.
//
// Ήταν σκληρογραμμένα εδώ. Τώρα ζουν στο data/people-aliases.json, στο
// κλειδί not_people, ώστε να τα σβήνει ο συντάκτης από την καρτέλα
// «Πρόσωπα» — χωρίς αυτό, κάθε νέο σκουπίδι ήθελε αλλαγή κώδικα.
function notGuest(name){
  return aliases().notPeople.has(guestKey(name));
}

// ---- ένα όνομα ανά άνθρωπο ----
//
// Η σύνταξη γράφει άλλοτε «Α. Συρίγος» και άλλοτε «Άγγελος Συρίγος».
// Χωρίς ένωση, ο ίδιος άνθρωπος παίρνει δύο σελίδες με μοιρασμένα
// επεισόδια και λάθος μετρήματα.
//
// Οι αντιστοιχίσεις είναι ΔΕΔΟΜΕΝΑ, όχι κώδικας: το data/people-aliases.json
// γράφεται με έγκριση ανθρώπου. Το find-aliases.js προτείνει, δεν αποφασίζει
// — δύο αδέρφια με το ίδιο επώνυμο μοιάζουν ίδια σε κάθε αυτόματο έλεγχο.
let aliasData;
function aliases(){
  if (!aliasData) {
    aliasData = { titles: [], map: {}, notPeople: new Set(), roles: {}, photos: {}, nos: [] };
    try {
      const raw = JSON.parse(fs.readFileSync(ALIAS_FILE, 'utf8'));
      aliasData.titles = Array.isArray(raw.titles) ? raw.titles : [];
      // Αντιστρέφουμε: το αρχείο γράφεται «κανονικό -> παραλλαγές»,
      // γιατί έτσι διαβάζεται· εδώ θέλουμε «παραλλαγή -> κανονικό».
      for (const [canonical, list] of Object.entries(raw.aliases || {})) {
        for (const variant of list) aliasData.map[guestKey(variant)] = canonical;
      }
      // Με κλειδί, όχι με το όνομα όπως γράφτηκε: το σκουπίδι που
      // σβήνει ο συντάκτης εμφανίζεται στους τίτλους και με άλλους
      // τόνους, και θα ξαναγύριζε ως πρόσωπο.
      for (const name of raw.not_people || []) {
        aliasData.notPeople.add(guestKey(name));
      }
      // Ιδιότητα ανά ΚΑΝΟΝΙΚΟ όνομα — μετά την ένωση, αλλιώς ο ίδιος
      // άνθρωπος θα την ήθελε γραμμένη σε κάθε παραλλαγή.
      for (const [name, role] of Object.entries(raw.roles || {})) {
        if (role) aliasData.roles[guestKey(name)] = String(role);
      }
      // Το πορτρέτο, με κλειδί το κανονικό όνομα — ίδια λογική με την
      // ιδιότητα. Το διαλέγει άνθρωπος από το διαχειριστικό· δεν
      // μπορούμε να το μαντέψουμε από πουθενά.
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

// Χωρίζει τον τίτλο από το όνομα: «Δρ. Αγγελική Ασημάκη» -> Δρ + το όνομα.
// Ο τίτλος φεύγει από το όνομα ώστε να μην κάνει δεύτερο άνθρωπο, αλλά
// κρατιέται για να φαίνεται στη σελίδα του.
function splitTitle(name){
  const titles = aliases().titles;
  if (!titles.length) return { title: '', name: String(name).trim() };

  const re = new RegExp(`^(${titles.join('|')})\\.?\\s+`, 'i');
  const m = String(name).match(re);
  if (!m) return { title: '', name: String(name).trim() };
  return { title: m[1], name: String(name).slice(m[0].length).trim() };
}

// Ο τίτλος ενός προσώπου, αν έχει. Κενό για σχεδόν όλους.
function titleOf(ep){
  if (!ep.guest) return '';
  return splitTitle(cleanGuestName(decode(ep.guest))).title;
}

// Ο καλεσμένος του επεισοδίου, ή κενό αν δεν υπάρχει άνθρωπος μπροστά.
// ΟΛΑ τα σημεία περνούν από εδώ, ώστε κάρτα, σελίδα προσώπου και
// «σχετικά» να συμφωνούν μεταξύ τους.
function guestOf(ep){
  // Η χειροκίνητη απάντηση πρώτη, και κερδίζει ακόμα κι όταν ο τίτλος
  // δεν έχει άνω τελεία — εκεί ο αυτόματος δεν βγάζει ΤΙΠΟΤΑ να
  // διορθωθεί, και 94 επεισόδια έμεναν για πάντα χωρίς άνθρωπο.
  //
  // Περνάει και αυτή από την ένωση γραφών: αλλιώς ένα όνομα γραμμένο με
  // το χέρι θα έφτιαχνε ΔΕΥΤΕΡΗ σελίδα δίπλα στην κανονική.
  const fix = pairOf(ep);
  if (fix && fix.noguest) return '';
  if (fix && fix.guest) {
    const typed = String(fix.guest).trim();
    return aliases().map[guestKey(typed)] || typed;
  }

  if (!ep.guest) return '';
  const { name } = splitTitle(cleanGuestName(decode(ep.guest)));
  if (!looksLikePerson(name) || notGuest(name)) return '';
  const canonical = aliases().map[guestKey(name)] || name;
  // Το σβήσιμο γίνεται και στο κανονικό όνομα: ο συντάκτης σβήνει αυτό
  // που βλέπει στην καρτέλα, κι εκείνο είναι το ενωμένο.
  if (notGuest(canonical)) return '';
  return canonical;
}

// Η ιδιότητα ενός προσώπου («καθηγητής διεθνών σχέσεων»). Κενό για
// όσους δεν την έβαλε κανείς — είναι σχόλιο, όχι απαίτηση.
function roleOf(name){
  return aliases().roles[guestKey(name)] || '';
}

// Το πορτρέτο ενός προσώπου, όπως το διάλεξε ο συντάκτης.
//
// ΠΡΟΣΟΧΗ στη διαφορά από το ep.image: εκείνο είναι το εξώφυλλο του
// επεισοδίου — τετράγωνη αφίσα με ψημένο μέσα τον τίτλο και συχνά το
// λογότυπο. Κομμένο σε κύκλο δείχνει μισό γράμμα, όχι άνθρωπο. Γι' αυτό
// οι δύο δεν ανακατεύονται πουθενά: όπου θέλουμε πρόσωπο, είτε υπάρχει
// πορτρέτο είτε πέφτουμε στα αρχικά.
function photoOf(name){
  return aliases().photos[guestKey(name)] || '';
}

// Υπάρχει έστω ένα πορτρέτο; Από αυτό κρίνεται αν η ενότητα «Τα
// πρόσωπα» στην αρχική δείχνει εικόνες — με μηδέν πορτρέτα θα ήταν 40
// άδειοι κύκλοι, που είναι χειρότερο από σκέτα ονόματα.
let facesKnown;
function haveFaces(){
  if (facesKnown === undefined) {
    facesKnown = Object.keys(aliases().photos).length > 0;
  }
  return facesKnown;
}

// Ζεύγη που ο συντάκτης απέρριψε ρητά: «όχι, άλλος άνθρωπος». Μόνο
// για τις προτάσεις — δεν αλλάζουν τίποτα στο site.
function aliasNos(){
  return aliases().nos;
}

// Χαλαρό κλειδί ΜΟΝΟ για την ένωση — ισοπεδώνει και τα διαλυτικά, ώστε
// το «Αϋφαντής» και το τυπογραφικό «Αυφαντής» να πέσουν στον ίδιο άνθρωπο.
// Η διεύθυνση δεν βγαίνει από εδώ: βγαίνει από τη γραφή που κερδίζει,
// ώστε να μένει σωστή. Ένωση και διεύθυνση θέλουν διαφορετικά κριτήρια.
function guestKey(name){
  return slugify(String(name).replace(/[ΐϊ]/g, 'ι').replace(/[ΰϋ]/g, 'υ'));
}

function guestUrl(name){
  return `guest/${slugify(name)}.html`;
}
//grouping episodes by guest
function groupByGuest(episodes){
  const groups ={};

  for (const ep of episodes){
    // ΟΧΙ «if (!ep.guest) continue» εδώ: ένα επεισόδιο χωρίς άνω τελεία
    // δεν έχει ep.guest, αλλά μπορεί να έχει καλεσμένο γραμμένο με το
    // χέρι στο data/pairs.json. Μόνο το guestOf τα ξέρει και τα δύο.
    const name = guestOf(ep);
    const key = guestKey(name);
    if (!key) continue;
    if(!groups[key]) groups[key] = {names: [], episodes:[]};
    groups[key].names.push(name);
    groups[key].episodes.push(ep);

  }
  return groups;
}

// Από ποιο κλειδί σε ποιο αρχείο. Γεμίζει μία φορά στο build, μόλις
// σχηματιστούν οι ομάδες. Χρειάζεται επειδή το αρχείο παίρνει το όνομα
// της γραφής που κέρδισε, όχι του κλειδιού — οπότε δεν υπολογίζεται
// κατευθείαν από το όνομα που γράφει το επεισόδιο.
let guestSlugIndex = {};
let guestIndex = [];
function indexGuestSlugs(groups){
  guestSlugIndex = {};
  guestIndex = [];

  for (const key of Object.keys(groups)) {
    const name = mostCommon(groups[key].names);
    const withImage = groups[key].episodes.find((e) => e.image);

    guestSlugIndex[key] = slugify(name);
    guestIndex.push({
      key,
      name,
      slug: slugify(name),
      image: withImage ? withImage.image : '',
      count: groups[key].episodes.length,
      last: groups[key].episodes[0] ? groups[key].episodes[0].date : '',
      hay: matchKey(name),
      weight: name.length,          // τα μεγαλύτερα ονόματα ταιριάζουν πρώτα
    });
  }

  // Ο «Γιώργος Παπαδόπουλος» πρέπει να δοκιμαστεί πριν τον «Γιώργος Παπά»,
  // αλλιώς το μικρότερο όνομα κλέβει το ταίριασμα.
  guestIndex.sort((a, b) => b.weight - a.weight);
}

// ---- η απογραφή προσώπων για το διαχειριστικό ----
//
// Τι βλέπει ο συντάκτης στην καρτέλα «Πρόσωπα»: κάθε άνθρωπος όπως
// τον βγάζει ΣΗΜΕΡΑ το site, με όλες τις γραφές που έπεσαν πάνω του,
// όσα σβήστηκαν ως «δεν είναι άνθρωπος», και τις προτάσεις ένωσης.
//
// Γράφεται από εδώ και ΜΟΝΟ από εδώ, για τον ίδιο λόγο που γράφεται
// και το auto-categories.json: τη λογική (καθαρισμός τίτλου, έλεγχος
// looksLikePerson, ένωση) την ξέρει αυτό το αρχείο. Αντίγραφο στη
// διεπαφή θα απέκλινε, και ο συντάκτης θα διόρθωνε φαντάσματα.
function peopleForAdmin(episodes){
  // Πρώτα η ωμή απογραφή: κάθε γραφή ονόματος όπως βγαίνει από τον
  // τίτλο, ΠΡΙΝ την ένωση. Χωρίς αυτό δεν φαίνεται τι ενώθηκε με τι.
  const raw = {};
  for (const ep of episodes) {
    const fix = pairOf(ep);
    if (fix && fix.noguest) continue;

    let name;
    if (fix && fix.guest) {
      // Γραμμένο με το χέρι: δεν περνάει από looksLikePerson. Εκείνο
      // κρίνει ΜΑΝΤΕΜΑ από τίτλο — εδώ κρίνει άνθρωπος.
      name = String(fix.guest).trim();
    } else {
      if (!ep.guest) continue;
      name = splitTitle(cleanGuestName(decode(ep.guest))).name;
      if (!name || !looksLikePerson(name)) continue;
    }
    raw[name] = (raw[name] || 0) + 1;
  }

  // Ποιες γραφές κατέληξαν σε ποιον άνθρωπο, και ποιες σβήστηκαν.
  const writings = {};   // κλειδί ανθρώπου -> [{ name, n }]
  const rejected = [];
  for (const [name, n] of Object.entries(raw)) {
    const canonical = aliases().map[guestKey(name)] || name;
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

  // Προτάσεις ένωσης. Κρατάμε μόνο όσες έχουν κάτι να προσφέρουν:
  // ό,τι είναι ήδη ενωμένο δεν ξαναρωτιέται, αλλιώς η καρτέλα θα
  // έδειχνε 39 «προτάσεις» που ο συντάκτης έχει ήδη εγκρίνει.
  //
  // Ούτε ό,τι έχει ΑΠΟΡΡΙΦΘΕΙ ρητά: δύο αδέρφια με το ίδιο επώνυμο
  // μοιάζουν ίδια σε κάθε αυτόματο έλεγχο, και η πρόταση θα ξαναρχόταν
  // σε κάθε build μέχρι να την εγκρίνει κάποιος από κούραση.
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

// Η απογραφή του ζευγαρώματος, για το διαχειριστικό.
//
// Ίδιος λόγος με το people.json και το auto-categories.json: τη λογική
// (matchKey, headKey, splitTitle, looksLikePerson) την ξέρει ΜΟΝΟ αυτό
// το αρχείο. Αντίγραφο στη διεπαφή θα απέκλινε, και ο συντάκτης θα
// διόρθωνε επεισόδια που στο site φαίνονται μια χαρά.
//
// Μπαίνουν μόνο τα προβληματικά — και όσα έχουν ήδη διορθωθεί, ώστε η
// διόρθωση να φαίνεται και να μπορεί να αναιρεθεί.
function pairsForAdmin(episodes){
  const rows = [];

  for (const ep of episodes) {
    const fix = pairOf(ep) || {};
    const v = videoTwin(ep);
    const guest = guestOf(ep);
    const touched = !!(fix.video || fix.guest || fix.novideo || fix.noguest
      || fix.title || fix.summary || fix.image);

    // ΟΛΑ τα επεισόδια, όχι μόνο τα ελλιπή.
    //
    // Παλιά η λίστα ήταν μόνο «τι λείπει», και σωστά: ήταν λίστα
    // δουλειάς. Τώρα από την ίδια οθόνη διορθώνεται και τίτλος,
    // περιγραφή και φωτογραφία — και αυτά δεν «λείπουν» ποτέ, απλώς
    // κάποια μέρα κάποιος θέλει να τα αλλάξει. Αν δεν είναι στη λίστα,
    // δεν μπορεί.
    //
    // Η λίστα δουλειάς δεν χάνεται: έγινε φίλτρο, και είναι το
    // προεπιλεγμένο. Το «gaps» λέει αν η γραμμή ανήκει σε αυτήν.
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

// Ποιο πρόσωπο μιλάει για ποια θέματα, και πόσο συχνά.
//
// Το χρειάζονται δύο πράγματα στη σελίδα προσώπου: η ενότητα «Μιλάει
// για», και το «άλλοι που μιλούν για τα ίδια θέματα» στο τέλος.
// Φτιάχνεται μία φορά — αλλιώς κάθε μία από τις 382 σελίδες θα διάβαζε
// ξανά όλα τα επεισόδια όλων των άλλων.
let peopleIndex = [];
function indexPeople(groups){
  peopleIndex = Object.keys(groups).map((key) => {
    const name = mostCommon(groups[key].names);
    const cats = {};
    for (const ep of groups[key].episodes) {
      for (const c of episodeCategories(ep)) cats[c] = (cats[c] || 0) + 1;
    }
    return {
      key,
      name,
      slug: slugify(name),
      count: groups[key].episodes.length,
      cats,
      // Σύνολο μόνο των θεμάτων, για να συγκρίνουμε δύο πρόσωπα.
      topics: new Set(Object.keys(cats)),
    };
  });
}

// Τα θέματα ενός προσώπου, από το πιο συχνό προς το πιο σπάνιο.
function topicsOf(key){
  const me = peopleIndex.find((p) => p.key === key);
  if (!me) return [];
  return Object.entries(me.cats)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'el'))
    .map(([name, n]) => ({ name, n }));
}

// Άλλοι που μιλούν για τα ίδια. Μετράμε πόσα θέματα μοιράζονται, και
// σπάμε την ισοπαλία με το πλήθος εμφανίσεων: ανάμεσα σε δύο που έχουν
// τα ίδια δύο θέματα, προτιμάμε αυτόν που μιλάει πιο συχνά εδώ.
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

// Ποιος γνωστός καλεσμένος αναφέρεται μέσα σε ένα κείμενο. Το χρειάζονται
// τα βίντεο, που δεν έχουν πεδίο καλεσμένου — μόνο τίτλο.
function guestInText(text){
  const hay = matchKey(text);
  if (!hay) return null;
  for (const g of guestIndex) {
    if (g.hay && hay.includes(g.hay)) return g;
  }
  return null;
}

// Η διεύθυνση της σελίδας του καλεσμένου ενός επεισοδίου — κενό αν δεν
// έχει καλεσμένο ή αν δεν του αντιστοιχεί σελίδα.
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

// Σελίδα για διευθύνσεις που δεν υπάρχουν. Δεν αφήνουμε τον επισκέπτη
// σε λευκή οθόνη του browser — του δίνουμε δρόμους να συνεχίσει.
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

// Οι μηχανές αναζήτησης χρειάζονται κατάλογο για να φτάσουν και στις
// 4.500 σελίδες — ακολουθώντας μόνο συνδέσμους θα έχαναν τα περισσότερα.
function sitemapXml(urls){
  // Χωρίς .html, όπως και κάθε σύνδεσμος της σελίδας: αλλιώς ο κατάλογος
  // στέλνει τη Google σε 4.700 διευθύνσεις που όλες ανακατευθύνουν.
  const rows = urls.map((u) => `  <url><loc>${SITE_URL}/${cleanUrl(u.loc)}</loc>${u.date ? `<lastmod>${u.date.slice(0, 10)}</lastmod>` : ''}</url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${rows}
</urlset>
`;
}

// Η σελίδα αναζήτησης. Το Pagefind φτιάχνει το ευρετήριο μετά το build
// και το σερβίρει από το /pagefind/ — δεν υπάρχει διακομιστής αναζήτησης
// και δεν χρεώνεται τίποτα ανά επισκέπτη.
function searchPage(episodes, catGroups){
  // Η σελίδα δεν μένει άδεια όσο δεν έχει ψάξει κανείς: από κάτω τα θέματα
  // και τα πιο πρόσφατα επεισόδια, ώστε να υπάρχει δρόμος ακόμα και αν
  // δεν ξέρεις τι να γράψεις.
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
      new PagefindUI({
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
    });
  </script>`;

  return page({ title: 'Αναζήτηση — Newshub Media', body });
}

// Σελίδα με όλους τους καλεσμένους, αλφαβητικά.
// Πόσες εμφανίσεις θεωρούνται «τακτικός». Πάνω από αυτό, το νούμερο
// βάφεται κίτρινο στη λίστα.
const OFTEN = 5;

// Το αρχικό γράμμα για τις άγκυρες: κεφαλαίο, χωρίς τόνο, ώστε το
// «Άγγελος» και το «Ανδρέας» να πέσουν στο ίδιο Α.
function firstLetter(name){
  return String(name).trim().charAt(0).toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Πόσα ονόματα δείχνει η ενότητα «Τα πρόσωπα» στην αρχική.
const NAMES_SHOWN = 40;

// Έγινε συνάρτηση: ήταν σταθερό false όσο δεν είχαμε κανένα πορτρέτο.
// Τώρα το αφεντικό τα βάζει ένα-ένα από το διαχειριστικό, οπότε ανάβει
// μόνο του με το πρώτο — κανείς δεν χρειάζεται να θυμηθεί να γυρίσει
// έναν διακόπτη σε αρχείο που δεν ξέρει ότι υπάρχει.
function peopleFaces(){ return haveFaces(); }

// Η ενότητα «Τα πρόσωπα»: ποιοι μιλούν εδώ, σε μία ματιά.
//
// Ονόματα και αριθμοί, χωρίς εικόνες — γιατί οι «εικόνες» που θα
// είχαμε είναι εξώφυλλα επεισοδίων, δηλαδή αφίσες, όχι πρόσωπα.
// Σαράντα αφίσες στη σειρά θα έλεγαν λιγότερα από σαράντα ονόματα.
function namesSection(groups, depth = 0){
  const keys = Object.keys(groups);
  if (!keys.length) return '';

  const up = depth === 0 ? '' : '../';

  const people = keys
    .map((key) => {
      const name = mostCommon(groups[key].names);
      return {
        name,
        n: groups[key].episodes.length,
        // Μόνο αληθινό πορτρέτο. Παλιά έμπαινε εδώ το εξώφυλλο του
        // επεισοδίου — δες photoOf().
        face: photoOf(name),
      };
    })
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'el'))
    .slice(0, NAMES_SHOWN);

  const faceOn = peopleFaces();

  // ΧΩΡΙΣ αρχικά εδώ, σε αντίθεση με τη λίστα καλεσμένων.
  //
  // Στα 26px τα δύο γράμματα δεν διαβάζονται· γίνονται μουτζούρα, και
  // σαράντα μουτζούρες στη σειρά τραβούν το μάτι από τα ονόματα, που
  // είναι το περιεχόμενο της ενότητας. Ο άδειος κύκλος είναι ήσυχος
  // και κάνει τις λίγες αληθινές φωτογραφίες να ξεχωρίζουν.
  //
  // Στη guests.html τα αρχικά μένουν: εκεί ο κύκλος είναι 110px και
  // το όνομα γράφεται από κάτω, οπότε διαβάζονται κανονικά.
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

    <p class="band-open"><a href="${up}guests.html">Όλα τα πρόσωπα →</a></p>
  </section>`;
}

// Εξαγωγή επωνύμου και ονόματος για αλφαβητική ταξινόμηση ανά επώνυμο
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
    const eps = groups[key].episodes;
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
    for (const ep of groups[key].episodes) {
      const y = athensYear(ep.date);
      if (!Number.isNaN(y)) years.push(y);
    }
  }
  const since = years.length ? Math.min(...years) : '';

  // ---- οι πιο συχνοί ----
  const top = [...people].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'el')).slice(0, 20);

  // ΟΧΙ το p.image: εκείνο είναι το εξώφυλλο επεισοδίου, και κομμένο σε
  // κύκλο έδειχνε μισό ψημένο γράμμα αντί για άνθρωπο. Είτε πορτρέτο
  // που διάλεξε ο συντάκτης, είτε τα αρχικά του ονόματος.
  const faces = top.map((p) => `      <a class="face" href="guest/${p.slug}.html">
        <span class="face-pic">${photoOf(p.name)
          ? `<img src="${esc(photoOf(p.name))}" alt="" loading="lazy">`
          : avatar(p.name)}</span>
        <span class="face-name">${esc(p.name)}</span>
        <span class="face-n">${p.n === 1 ? '1 εμφάνιση' : `${p.n} εμφανίσεις`}</span>
      </a>`).join('\n');

  // ---- όλοι αλφαβητικά ----
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

  // Τα γράμματα ήταν άγκυρες: σε πήγαιναν στο «Κ» μέσα σε μια λίστα
  // 373 ονομάτων που έμενε ολόκληρη ανοιχτή. Τώρα φιλτράρουν —
  // δείχνουν ΜΟΝΟ τα ονόματα του γράμματος, και η σελίδα από εννιά
  // οθόνες γίνεται μισή.
  //
  // Μένουν <a href="#g-X">: χωρίς JavaScript εξακολουθούν να είναι
  // άγκυρες που δουλεύουν, όπως πριν. Η JS απλώς τα αναβαθμίζει.
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

// Η γραμμή χρόνου: μία κουκκίδα ανά επεισόδιο, από την πρώτη ως την
// τελευταία εμφάνιση. Δείχνει με μια ματιά αν κάποιος είναι σταθερός
// συνομιλητής ή πέρασε μια φορά — κάτι που ο αριθμός «12 εμφανίσεις»
// δεν λέει: δώδεκα μέσα σε έναν μήνα και δώδεκα σε τέσσερα χρόνια
// είναι εντελώς διαφορετικά πράγματα.
function personSpark(dates){
  if (dates.length < 2) return '';

  const first = dates[dates.length - 1];
  const last = dates[0];
  const span = last - first;
  if (!span) return '';

  const dots = dates.map((d) => {
    const at = ((d - first) / span) * 100;
    return `      <span class="life-dot" style="left:${at.toFixed(2)}%"></span>`;
  }).join('\n');

  return `    <div class="life">
      <span class="life-line"></span>
${dots}
      <span class="life-from">${athensYear(first)}</span>
      <span class="life-to">${athensYear(last)}</span>
    </div>`;
}

function guestPage(name, list){
  const safe = esc(name);

  // Χρονολογικά, πιο πρόσφατο πρώτο. Δεν βασιζόμαστε στη σειρά που
  // ήρθαν: αν αλλάξει το feed ή η ομαδοποίηση, η σελίδα μένει σωστή.
  const episodes = [...list].sort((a, b) => new Date(b.date) - new Date(a.date));
  const count = episodes.length;

  const key = guestKey(name);
  const title = episodes.map((ep) => titleOf(ep)).find(Boolean) || '';

  // Η ιδιότητα, αν τη γράψει κάποιος από το διαχειριστικό. Μπαίνει
  // κάτω από το όνομα: «ποιος είναι αυτός» είναι η πρώτη ερώτηση του
  // επισκέπτη, και σήμερα η σελίδα απαντά μόνο «πόσες φορές ήρθε».
  const role = roleOf(name);

  // Το θολό υπόβαθρο της κορυφής βγαίνει από το εξώφυλλο του πιο
  // πρόσφατου επεισοδίου — εκεί το ψημένο κείμενο δεν ενοχλεί, γιατί
  // είναι θολό και σκοτεινιασμένο.
  const pic = episodes.find((ep) => ep.image);

  // Το πορτρέτο είναι άλλο πράγμα: μπαίνει καθαρό, δίπλα στο όνομα, και
  // υπάρχει μόνο αν το διάλεξε άνθρωπος.
  const face = photoOf(name);

  // ---- η γραμμή με τα στοιχεία ----
  const dates = episodes.map((ep) => new Date(ep.date).getTime())
    .filter((t) => !Number.isNaN(t));
  const seconds = episodes.reduce((n, ep) => n + (ep.seconds || 0), 0);
  const hours = seconds / 3600;

  const facts = [
    count === 1 ? '1 εμφάνιση' : `${count} εμφανίσεις`,
    dates.length ? `πρώτη ${formatDate(new Date(dates[dates.length - 1]).toISOString())}` : '',
    dates.length > 1 ? `τελευταία ${formatDate(new Date(dates[0]).toISOString())}` : '',
    // Κάτω από μία ώρα το «0 ώρες» δεν λέει τίποτα· λέμε λεπτά.
    hours >= 1
      ? `${hours.toFixed(hours < 10 ? 1 : 0).replace('.', ',')} ώρες συζήτησης`
      : (seconds ? `${Math.round(seconds / 60)} λεπτά συζήτησης` : ''),
  ].filter(Boolean).join(' · ');

  // ---- μιλάει για ----
  const topics = topicsOf(key);
  const topicTags = topics.map((t) => `      <a class="ptag" href="../${categoryUrl(t.name)}" style="--tint: var(--t-${slugify(t.name)}, var(--t-default))">
        <span class="ptag-name">${esc(t.name)}</span>
        <span class="ptag-n">${t.n}</span>
      </a>`).join('\n');

  // ---- τα επεισόδια ----
  // Το πιο πρόσφατο παίρνει μεγάλη κάρτα: είναι ο λόγος που κάποιος
  // ανοίγει τη σελίδα ενός προσώπου σήμερα.
  const lead = episodes[0]
    ? card({ ...itemFromEpisode(episodes[0]), lead: true }, 1)
    : '';
  const rest = episodes.slice(1).map((ep) => episodeCard(ep, 1)).join('\n');

  // ---- άλλοι για τα ίδια θέματα ----
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
${personSpark(dates)}
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
    // Στο μήνυμα που μοιράζεται κάποιος, το πορτρέτο λέει πολύ
    // περισσότερα από το εξώφυλλο του επεισοδίου.
    image: face || (pic ? pic.image : ''),
    url: `guest/${slugify(name)}.html`,
  });
}
// Το βίντεο-δίδυμο ενός επεισοδίου στο YouTube, αν υπάρχει. Το βρίσκουμε
// με τον ίδιο κατάλογο τίτλων που δίνει και την εκπομπή.
// Πόσα βίντεο έχει κάθε εκπομπή. Το χρειαζόμαστε επειδή ένα βίντεο
// μπορεί να ανήκει σε πολλές λίστες — π.χ. και στις «Αναλύσεις» (310)
// και στις «Συνεντεύξεις» (1367). Η μικρότερη λίστα είναι η πιο ειδική,
// και αυτή θέλουμε να δείχνουμε ως εκπομπή του.
let showSize;
function sizeOf(show){
  if (!showSize) {
    showSize = {};
    for (const v of loadVideos()) showSize[v.show] = (showSize[v.show] || 0) + 1;
  }
  return showSize[show] || 0;
}

// Από δύο εγγραφές του ίδιου βίντεο, κρατάμε αυτή με την ειδικότερη εκπομπή.
function moreSpecific(a, b){
  if (!a) return b;
  if (!b) return a;
  return sizeOf(b.show) < sizeOf(a.show) ? b : a;
}

// Ο κατάλογος των βίντεο, με δύο κλειδιά: πλήρης τίτλος και σκέτο θέμα.
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

  // Η απάντηση του συντάκτη, πρώτη.
  const fix = pairOf(ep);
  if (fix && fix.novideo) return null;
  if (fix && fix.video) {
    const v = videoIndex.id[fix.video];
    if (v) return v;
    // Διαλεγμένο βίντεο που δεν υπάρχει στον κατάλογο: σβήστηκε από το
    // YouTube, ή το videos.json δεν έχει ξανακατέβει ακόμα. Λέγεται —
    // αλλιώς ο συντάκτης βλέπει το επεισόδιο χωρίς βίντεο και νομίζει
    // ότι δεν αποθηκεύτηκε η διόρθωσή του.
    console.warn(`ΠΡΟΣΟΧΗ: το ${ep.id} δείχνει στο βίντεο ${fix.video}, `
      + 'που δεν υπάρχει στο data/videos.json');
    // Δεν γυρνάμε στο μάντεμα: το episodeKeys έχει ήδη σωπάσει γι' αυτό
    // το επεισόδιο, οπότε ένα βίντεο από τον τίτλο θα εμφανιζόταν ΚΑΙ
    // εδώ ΚΑΙ μόνο του στις κατηγορίες.
    return null;
  }

  return videoIndex.full[matchKey(ep.title)]
      || videoIndex.head[headKey(ep.title)]
      // Το ίδιο ταίριασμα με όνομα και ημερομηνία, ανάποδα. Χωρίς
      // αυτό, η ημερομηνία προβολής (airDate) δεν έβρισκε το βίντεο
      // και το επεισόδιο κρατούσε την ώρα που ανέβηκε στο Buzzsprout:
      // η ΙΔΙΑ συνέντευξη έβγαινε «σήμερα 20:00» στη ροή και «4 Νοε»
      // στη λωρίδα της εκπομπής.
      || videoApoOnomaTwin(ep)
      || null;
}

// Ο ανάποδος δρόμος του twinApoOnoma: από επεισόδιο βρες το βίντεο.
//
// Χτίζεται περνώντας ΜΙΑ φορά όλα τα βίντεο από τον ίδιο κανόνα —
// όχι γράφοντάς τον δεύτερη φορά ανάποδα. Δύο αντίγραφα ενός κανόνα
// αποκλίνουν πάντα· απλώς δεν ξέρεις πότε.
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

// Ευρετήρια για τις προτάσεις: ανά εκπομπή και ανά θέμα. Φτιάχνονται
// μία φορά — αλλιώς κάθε μία από τις 1.053 σελίδες θα διάβαζε όλον τον
// κατάλογο για να βρει τέσσερα επεισόδια.
//
// Ευρετήριο ανά καλεσμένο δεν κρατάμε: ο καλεσμένος έχει δική του
// σελίδα με όλες τις εμφανίσεις του, και το πάνελ στο πλάι οδηγεί εκεί.
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

// ΕΝΑ κριτήριο, και φαίνεται στον τίτλο της ενότητας.
//
// Πριν ανακάτευε τρία — ίδιος καλεσμένος, μετά ίδια εκπομπή, μετά
// πρόσφατα — οπότε κάτω από το «Επόμενο στις Αναλύσεις» έβγαιναν
// επεισόδια άλλης εκπομπής. Τώρα: ίδια εκπομπή όπου την ξέρουμε,
// αλλιώς ίδιο θέμα· και ό,τι διαλέξαμε το λέει η επικεφαλίδα.
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

// Το τετράγωνο του καλεσμένου, πάνω αριστερά. Πορτρέτα δεν έχουμε, οπότε
// δείχνουμε το εξώφυλλο του επεισοδίου — η ίδια εφεδρεία με την ενότητα
// «πρόσωπα» της αρχικής.
// Πορτρέτα καλεσμένων δεν έχουμε για κανέναν από τους 435, και το
// εξώφυλλο του επεισοδίου είναι αφίσα, όχι πρόσωπο. Αντί γι' αυτό:
// αρχικά πάνω σε σταθερό χρώμα — ίδιος άνθρωπος, ίδιο χρώμα παντού.
function initials(name){
  return String(name).trim().split(/\s+/).slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase();
}

// Το χρώμα βγαίνει από το ίδιο το όνομα, άρα δεν χρειάζεται να το
// αποθηκεύσουμε πουθενά και δεν αλλάζει ποτέ μόνο του.
function colorFor(name){
  let hue = 0;
  for (let i = 0; i < name.length; i++) hue = (hue * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${hue} 30% 26%)`;
}

function avatar(name, extra = ''){
  const cls = extra ? `avatar ${extra}` : 'avatar';
  return `<span class="${cls}" style="background:${colorFor(name)}" aria-hidden="true">${esc(initials(name))}</span>`;
}

// Το ίδιο πάνελ το χρειάζονται και τα επεισόδια και τα βίντεο, οπότε
// γράφεται μία φορά. Βιογραφικά δεν έχουμε για κανέναν — στη θέση τους
// μπαίνει κάτι που ξέρουμε με βεβαιότητα: πόσες φορές έχει μιλήσει εδώ.
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

// Για επεισόδιο: ο καλεσμένος είναι γραμμένος στο ίδιο το πεδίο.

// Banner εκπομπής στην πλαϊνή στήλη του player / επεισοδίου.
// Οδηγεί κατευθείαν στη σελίδα της εκπομπής.
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

// Για βίντεο: δεν υπάρχει πεδίο καλεσμένου, οπότε ψάχνουμε στον τίτλο
// ποιο από τα 435 γνωστά ονόματα αναφέρεται. Η φωτογραφία έρχεται από τα
// επεισόδια του ίδιου ανθρώπου, όχι από τη μικρογραφία του βίντεο.
function videoGuestBox(v, depth = 1){
  const g = guestInText(v.title);
  if (!g) return '';

  const up = depth === 0 ? '' : '../';
  return guestPanel(g.name, `${up}guest/${g.slug}.html`, g.count, g.last);
}

// Ποιος μιλάει, αμέσως κάτω από τον τίτλο.
//
// Το πάνελ στο πλάι το λέει κι αυτό, αλλά σε στενή οθόνη πέφτει κάτω
// από όλο το κείμενο — οπότε στο κινητό ο αναγνώστης δεν μάθαινε ποιος
// είναι ο καλεσμένος παρά αφού τελείωνε η σελίδα.
function guestLine(ep, depth = 1){
  const name = guestOf(ep);
  if (!name) return '';

  const g = guestIndex.find((x) => x.key === guestKey(name));
  if (!g) return '';

  // Βιογραφικά δεν έχουμε. Ο αριθμός των εμφανίσεων είναι το μόνο που
  // ξέρουμε με βεβαιότητα, και λέει κάτι: τακτικός ή πρώτη φορά.
  const more = g.count > 1
    ? ` <span class="byline-count">${g.count} εμφανίσεις στο αρχείο</span>`
    : '';

  return `        <p class="episode-byline">με τον/την <a href="${guestHref(ep, depth)}">${esc(g.name)}</a>${more}</p>`;
}

// Η απομαγνητοφώνηση, μέσα στη σελίδα.
//
// Το feed δίνει μόνο διεύθυνση προς το Buzzsprout· το fetch-transcripts.js
// τις κατεβάζει σε data/transcripts/<id>.json. Υπάρχουν για 401 από τα
// 1.053 επεισόδια — όπου λείπει, η ενότητα απλώς δεν εμφανίζεται.
//
// Είναι αυτόματη, όχι ανθρώπινη: λείπουν τα τελικά «ς» και τα ονόματα
// βγαίνουν λάθος. Γι' αυτό μένει κλειστή και το γράφει από πάνω.
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

// Τα δεδομένα της απομαγνητοφώνησης, σε μορφή έτοιμη για τον browser.
//
// Η ομαδοποίηση γίνεται εδώ, όχι στη σελίδα: διαδοχικές γραμμές του ίδιου
// ομιλητή γίνονται ένα μπλοκ, ώστε η χρονοσήμανση να μπαίνει μία φορά σε
// κάθε αλλαγή ομιλητή.
//
// Κάθε γραμμή είναι πίνακας [ομιλητής, δευτερόλεπτο, κείμενο] και όχι
// αντικείμενο με κλειδιά: με 17.793 γραμμές συνολικά, τα ονόματα των
// κλειδιών θα ζύγιζαν περισσότερο από τα δεδομένα. Η ώρα σε μορφή «1:02»
// δεν αποθηκεύεται — ο player τη φτιάχνει από το δευτερόλεπτο.
function transcriptData(ep){
  const lines = transcriptOf(ep);
  if (!lines || !lines.length) return null;

  const blocks = [];
  for (const l of lines) {
    const last = blocks[blocks.length - 1];
    if (last && last.who === l.who) last.text += ` ${l.text}`;
    else blocks.push({ who: l.who, at: l.at, text: l.text });
  }

  // Ονόματα ομιλητών δεν ξέρουμε — το Buzzsprout δίνει «SPEAKER_00».
  // Δεν βάζουμε ψεύτικα· κρατάμε μόνο αριθμό ώστε να ξεχωρίζει οπτικά
  // ο ένας από τον άλλον, με τον πρώτο που μιλάει πάντα ως 0.
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

// Το κέλυφος της ενότητας. Το κείμενο ΔΕΝ μπαίνει εδώ.
//
// Μπήκε πρώτα μέσα στο HTML και ήταν λάθος για δύο λόγους. Οι σελίδες
// πήγαν από 21KB στα 76KB — και η ταχύτητα είναι ρητή απαίτηση. Και,
// πιο σοβαρό, η απομαγνητοφώνηση είναι αυτόματη και βγάζει λέξεις και
// ονόματα λάθος· μέσα στη σελίδα τη διάβαζε η Google και μπορούσε να
// τη δείξει ως απόσπασμα, αποδίδοντας σε κατονομαζόμενους ανθρώπους
// λόγια που δεν είπαν.
//
// Έτσι μένει η χρήσιμη δουλειά της — βρίσκεις το σημείο και πατάς για
// να πάει ο ήχος εκεί — χωρίς να γίνεται δημοσιευμένο κείμενο. Ο
// αριθμός λέξεων είναι από το build, ώστε η επικεφαλίδα να είναι
// πλήρης πριν κατεβεί τίποτα.
//
// Αν κάποτε βελτιωθεί η ποιότητα και θέλουμε να μπει σε Google και
// αναζήτηση, τα δεδομένα είναι ήδη εδώ: αρκεί να γραφτούν οι γραμμές
// μέσα στο HTML, όπως στην πρώτη εκδοχή.
function transcriptSection(ep){
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

// Τα άλλα μέσα — όπου αλλού ακούγεται το podcast.
// Κουμπί πλατφόρμας με το σήμα της: εικονίδιο στο χρώμα της μάρκας,
// όνομα, και το βελάκι που λέει «φεύγεις από εδώ».
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

  // Η οθόνη. Όπου υπάρχει βίντεο μπαίνουν και τα δύο — βίντεο και
  // εξώφυλλο — και ο διακόπτης αποφασίζει ποιο φαίνεται.
  //
  // ΑΝΟΙΓΕΙ ΣΤΟΝ ΗΧΟ, όχι στο βίντεο. Κάθε σελίδα ανοίγει με το δικό
  // της μέσο: η σελίδα βίντεο με βίντεο, η σελίδα επεισοδίου με ήχο.
  // Εδώ ήρθες από τη ροή επεισοδίων, με αφίσα, διάρκεια και
  // απομαγνητοφώνηση — είναι σελίδα podcast.
  //
  // Είχε σημασία πέρα από το ύφος: 891 από τις 1.079 σελίδες
  // επεισοδίου έχουν δίδυμο βίντεο, και όσο άνοιγαν στο «Βλέπω» το
  // πάτημα του play ξεκινούσε iframe του YouTube. Ο δικός μας player
  // δεν έτρεχε καθόλου, άρα δεν κρατιόταν θέση και το «Συνέχισε όπου
  // έμεινες» δεν έβλεπε ποτέ τίποτα στο 83% του αρχείου.
  const stage = twin
    ? `        <div class="stage-media" data-embed="${twin.embed}" hidden>
          <img src="${twin.image}" alt="" loading="lazy">
          <button type="button" class="video-play" aria-label="Αναπαραγωγή">▶</button>
        </div>
        <div class="stage-art">
          ${ep.image ? `<img src="${ep.image}" alt="" loading="lazy">` : ''}
        </div>`
    : `        <div class="stage-art">
          ${ep.image ? `<img src="${ep.image}" alt="" loading="lazy">` : ''}
        </div>`;

  // Ένα κριτήριο, και το λέει η επικεφαλίδα. Τα ονόματα των εκπομπών
  // έχουν κάθε γένος και αριθμό — «ΕΠΙΚΑΙΡΟΤΗΤΑ», «Παρασκήνιο», «25
  // μαθήματα…» — οπότε «Επόμενο στις X» θα έβγαινε στραβά στα μισά.
  // Τα εισαγωγικά δουλεύουν για κάθε όνομα.
  const rel = relatedEpisodes(ep);
  const queueHead = rel.by === 'show'
    ? `Επόμενο από «${esc(rel.label)}»`
    : `Επόμενο στην κατηγορία «${esc(rel.label)}»`;

  const queue = rel.list.map((x) => `      <a class="queue-row" href="${path.basename(episodeUrl(x))}">
        ${x.image ? `<img src="${x.image}" alt="" loading="lazy">` : '<span class="queue-blank"></span>'}
        <span class="queue-text">
          <span class="queue-title">${esc(decode(x.headline))}</span>
          <span class="queue-meta">${[formatDate(x.date), formatDuration(x.seconds)].filter(Boolean).join(' · ')}</span>
        </span>
      </a>`).join('\n');

  // Ο διακόπτης έχει νόημα μόνο όταν υπάρχουν και τα δύο μέσα.
  //
  // Το «Ακούω» κρατάει το is-on, ώστε να συμφωνεί με το stage πιο
  // πάνω: ο διακόπτης πρέπει να δείχνει τι παίζει ΗΔΗ, αλλιώς το
  // πρώτο πάτημα δεν αλλάζει τίποτα ορατό.
  const toggle = twin
    ? `      <div class="modes">
        <button type="button" class="mode" data-mode="video">Βλέπω</button>
        <button type="button" class="mode is-on" data-mode="audio">Ακούω</button>
      </div>`
    : '';

  const body = `${siteHeader(1)}
${pageHero(ep.image || '')}

${breadcrumb([
    { label: 'Αρχική', href: 'index.html' },
    show ? { label: showName(show), href: showUrl(show) } : null,
    { label: decode(ep.headline) },
  ], 1)}

  <main class="episode" data-pagefind-body
        data-pagefind-meta="image:${ep.image || ''},type:Podcast,date:${formatDate(ep.date)},duration:${formatDuration(ep.seconds)}"
        data-pagefind-filter="Είδος:Podcast${show ? `,Εκπομπή:${esc(showLabel(show))}` : ''}${cats.map((c) => `,Κατηγορία:${esc(c)}`).join('')}">
    <div class="episode-grid">
      <div class="episode-main">
${stage}

        <div class="player" data-player-view
             data-id="${ep.id}"
             data-src="${ep.audio}"
             data-title="${title}"
             data-show="${esc(showLabel(show) || 'Podcast')}"
             data-art="${ep.image || ''}"
             data-href="${path.basename(episodeUrl(ep))}">
          <button type="button" class="player-skip" data-player="skip" data-by="-15" aria-label="15 δευτερόλεπτα πίσω">−15</button>
          <button type="button" class="player-play" data-player="toggle" aria-label="Αναπαραγωγή">▶</button>
          <button type="button" class="player-skip" data-player="skip" data-by="15" aria-label="15 δευτερόλεπτα μπροστά">+15</button>
          <span class="player-now" data-player-now>0:00</span>
          <div class="player-bar" data-player="seek" role="slider" tabindex="0" aria-label="Θέση" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" style="--wave: ${waveMask(ep.id)}">
            <div class="player-fill"></div>
          </div>
          <span class="player-total" data-player-total>--:--</span>
        </div>

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

        <p class="episode-links">
          ${twin ? `<a href="${twin.url}" target="_blank" rel="noopener">Άνοιγμα στο YouTube ↗</a>` : ''}
          ${ep.transcript && !transcriptOf(ep) ? `<a href="${ep.transcript}" target="_blank" rel="noopener">Απομαγνητοφώνηση ↗</a>` : ''}
        </p>

${transcriptSection(ep)}

${/* Η μόνη θέση της σελίδας επεισοδίου, και μπαίνει ΕΔΩ επίτηδες:
     μετά το περιεχόμενο, πριν τις προτάσεις. Ο player κάθεται στην
     κορυφή, οπότε ανάμεσά τους μεσολαβεί ολόκληρη η σελίδα — «καμία
     διαφήμιση μέσα ή πάνω από τον player». */ ''}
${adSlot('episode-mid', 'leaderboard')}

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
    image: ep.image,
    url: episodeUrl(ep),
    type: 'article',
  });
}

function main(){
  // Διαβασμένα, με διορθωμένη ημερομηνία και ταξινομημένα — δες loadEpisodes.
  const episodes = loadEpisodes();

  // Οι ομάδες καλεσμένων πρέπει να υπάρχουν ΠΡΙΝ γραφτεί οτιδήποτε, γιατί
  // από αυτές βγαίνει ο σύνδεσμος που βάζει κάθε επεισόδιο προς τον
  // άνθρωπό του.
  const groups = groupByGuest(episodes);
  indexGuestSlugs(groups);
  indexPeople(groups);
  indexRelated(episodes);


  // Τα 5 banners: ένα μεγάλο και τέσσερα από κάτω. Podcast και ειδήσεις
  // μπαίνουν στην ίδια δεξαμενή — η σημαντικότητα κρίνει, όχι ο τύπος.
  const curation = loadCuration();
  const articles = loadNews();
  const ownArticles = loadOwnArticles();
  const videos = loadVideos();
  const showGroups = buildShows(videos, episodes);

  // Οι ομάδες θεμάτων χρειάζονται ΕΔΩ, πριν γραφτεί η αρχική: από αυτές
  // βγαίνει η λωρίδα-φίλτρο και οι τέσσερις θεματικές λωρίδες.
  const catGroups = buildCategories(videos, episodes, ownArticles);
  indexMenu(showGroups, catGroups);

  // ---- Τι δεν κατατάχθηκε ----
  //
  // Και η κατηγορία και η εκπομπή βγαίνουν με μάντεμα: η πρώτη από
  // λέξεις του τίτλου, η δεύτερη από τη λίστα YouTube του διδύμου
  // βίντεο. Και τα δύο αστοχούν ΣΙΩΠΗΛΑ — το επεισόδιο απλώς δεν
  // εμφανίζεται πουθενά, και κανείς δεν ψάχνει κάτι που δεν ξέρει ότι
  // λείπει. Γι' αυτό μετριούνται δυνατά σε κάθε χτίσιμο.
  //
  // Και τα δύο διορθώνονται από το διαχειριστικό, ένα-ένα.
  const dixosKat = episodes.filter((ep) => !episodeCategories(ep).length);
  const dixosEkp = episodes.filter((ep) => !videoTwin(ep));

  const pos = (n) => `${n} από ${episodes.length}`
    + ` (${(n * 100 / episodes.length).toFixed(1)}%)`;

  console.log(`Χωρίς κατηγορία: ${pos(dixosKat.length)}`);
  console.log(`Χωρίς εκπομπή:   ${pos(dixosEkp.length)}`);

  // Το συνολικό ποσοστό κρύβει το μόνο που μετράει: αν ό,τι ανεβαίνει
  // ΤΩΡΑ κατατάσσεται σωστά. Τα παλιά κενά διορθώνονται μία φορά
  // από το διαχειριστικό — ένα καινούριο που χάνεται είναι βλάβη.
  const edo = Date.now() - 90 * 864e5;
  const fres = episodes.filter((ep) => new Date(ep.date).getTime() > edo);
  if (fres.length) {
    const fk = fres.filter((ep) => !episodeCategories(ep).length).length;
    const fe = fres.filter((ep) => !videoTwin(ep)).length;
    console.log(`  στις τελευταίες 90 μέρες (${fres.length}): `
      + `${fk} χωρίς κατηγορία, ${fe} χωρίς εκπομπή`);
  }

  // Ένα βίντεο μπορεί να υπάρχει σε πολλές λίστες. Κρατάμε μία εγγραφή
  // ανά βίντεο, με την ειδικότερη εκπομπή — αλλιώς η κάρτα θα έγραφε
  // «Συνεντεύξεις» ενώ η σελίδα του «Αναλύσεις».
  const seenVideo = {};
  for (const v of videos) seenVideo[v.id] = moreSpecific(seenVideo[v.id], v);
  const uniqueVideos = Object.values(seenVideo)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const pool = [
    // Τα δικά μας πρώτα: είναι λίγα και γραμμένα με το χέρι, άρα όταν
    // υπάρχουν αξίζουν τουλάχιστον ίση θέση με ό,τι τραβήχτηκε αυτόματα.
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

  // Διάλεξε ο συντάκτης άρθρο που ΔΕΝ έχει σώμα;
  //
  // Τότε δεν θα ανοίξει εδώ — θα φύγει για το newshub.gr, σιωπηλά, και
  // ο συντάκτης θα νομίζει ότι το ανέβασε στο Media channel. Συμβαίνει
  // όταν διαλέξει άρθρο παλιότερο από όσα κρατάει το fetch-news.js.
  // Δεν το διορθώνουμε αυτόματα — το build δεν κατεβάζει από το δίκτυο
  // — αλλά ΔΕΝ το αφήνουμε να περάσει αμίλητο.
  for (const want of [curation.featured, ...(curation.mustRead || [])].filter(Boolean)) {
    const hit = articles.find((a) => sameItem({ id: a.id, href: a.url }, want));
    if (hit && !articleBody(hit.id)) {
      console.warn(`ΠΡΟΣΟΧΗ: το επιλεγμένο άρθρο «${hit.title.slice(0, 50)}» δεν έχει κείμενο`);
      console.warn('  Ανοίγει στο newshub.gr αντί για εδώ. Τρέξε «node fetch-news.js» και ξαναχτίσε.');
    }
  }

  const featured = pickFeatured(pool, curation);

  // Οι τέσσερις δευτερεύουσες κάρτες κάτω από το πρωτοσέλιδο βγήκαν:
  // μετά τη μεγάλη κάρτα ακολουθεί κατευθείαν η ροή.
  //
  // ΠΡΟΣΟΧΗ: το claude.md γράφει ότι τα τέσσερα δευτερεύοντα τα ζήτησε
  // ρητά το αφεντικό. Η pickSecondary μένει στον κώδικα και δουλεύει —
  // επαναφέρεται με δύο γραμμές εδώ.
  //
  // Μόνο το πρωτοσέλιδο κρατιέται έξω από τη ροή τώρα· όσα έβγαιναν
  // στα δευτερεύοντα επιστρέφουν κανονικά μέσα της.
  const onTop = new Set([featured.href]);

  // Η ροή κάτω από τα banners. Φαίνονται τα 24 πιο πρόσφατα, αλλά μέσα
  // της κρύβονται και τα 6 πιο πρόσφατα ΚΑΘΕ θέματος. Έτσι όταν κάποιος
  // πατήσει «Tech-Hub» — 33 αντικείμενα συνολικά, κανένα μέσα στα 24 πιο
  // πρόσφατα — υπάρχει τι να δείξουμε, χωρίς να φορτώσει τίποτα.
  const flow = [];
  const inFlow = new Set();
  const pushFlow = (item) => {
    if (inFlow.has(item.href)) return;
    if (onTop.has(item.href)) return;      // μπήκε ήδη στα banners
    inFlow.add(item.href);
    flow.push(item);
  };

  // ΠΡΩΤΑ τα καρφιτσωμένα, με τη σειρά που τα έβαλε ο δημοσιογράφος.
  //
  // Πριν από οτιδήποτε άλλο: αν έμπαιναν μετά τα δικά μας άρθρα, η
  // «σειρά» του διαχειριστικού δεν θα ήταν η σειρά της σελίδας, και
  // αυτό είναι ακριβώς ό,τι ζητήθηκε να ελέγχει.
  const pinned = pinnedFlow(curation, [
    { list: episodes, make: (ep) => itemFromEpisode(ep) },
    { list: uniqueVideos, make: (v) => itemFromVideo(v) },
    { list: ownArticles, make: (a) => itemFromOwnArticle(a) },
    { list: articles, make: (a) => itemFromArticle(a) },
  ]);
  for (const it of pinned) pushFlow(it);

  // Τα δικά μας άρθρα μπαίνουν στη ροή πριν από τα επεισόδια: είναι
  // πρωτότυπο περιεχόμενο που δεν υπάρχει πουθενά αλλού, και αν δεν
  // φαίνεται στην αρχική δεν θα το δει κανείς.
  for (const a of ownArticles) pushFlow(itemFromOwnArticle(a));

  // Τα βίντεο εκπομπών που δεν έχουν podcast.
  //
  // Η ροή έπαιρνε ΜΟΝΟ επεισόδια, και 2.325 βίντεο δεν έχουν επεισόδιο:
  // μια ολόκληρη εκπομπή που βγήκε μόνο στο YouTube δεν υπήρχε πουθενά
  // στην αρχική — ούτε στη ροή, ούτε στη σελίδα «Όλα τα επεισόδια».
  // Την έβρισκες μόνο αν πατούσες το θέμα της ή τη σελίδα της εκπομπής.
  //
  // Δεν μπαίνουν όλα: χωρίς λίστα δεν είναι εκπομπή, και η ΕΠΙΚΑΙΡΟΤΗΤΑ
  // μένει απέξω (δες FLOW_SKIP_SHOWS). Μένει περίπου ένα την ημέρα.
  const soloShows = uniqueVideos.filter((v) =>
    v.show && !FLOW_SKIP_SHOWS.has(v.show) && !videoHasTwin(v));

  // Ανακατεμένα με τα επεισόδια και ταξινομημένα μαζί: αλλιώς το
  // χθεσινό βίντεο θα έμπαινε κάτω από προχθεσινό podcast.
  const recent = [
    ...episodes.slice(0, 40).map(itemFromEpisode),
    ...soloShows.slice(0, 40).map(itemFromVideo),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  // Το αυτόματο γέμισμα. Αν τα καρφιτσωμένα είναι περισσότερα από τις
  // εννιά θέσεις, τα κρατάμε ΟΛΑ: είναι ρητή επιλογή ανθρώπου, και δεν
  // κόβουμε σιωπηλά ό,τι ζήτησε να φαίνεται.
  const room = Math.max(FLOW_VISIBLE, flow.length);
  for (const it of recent) {
    pushFlow(it);
    if (flow.length >= room) break;
  }

  for (const key of Object.keys(catGroups)) {
    for (const it of catGroups[key].items.slice(0, FLOW_PER_TOPIC)) {
      pushFlow({ ...it, extra: true });    // κρυμμένο όσο δείχνουμε «Όλα»
    }
  }

  // Η χρονολογική θέση κάθε κάρτας, γραμμένη πάνω της ως data-rank.
  //
  // Η σειρά του DOM είναι «καρφιτσωμένα πρώτα, μετά ημερομηνία» — αυτό
  // θέλουμε στο «Όλα». Μέσα σε μια ΚΑΤΗΓΟΡΙΑ όμως δεν το θέλουμε: όποιος
  // πατάει «Κρήτη» ζητάει τα πιο πρόσφατα της Κρήτης, και ένα παλιό
  // καρφιτσωμένο στην κορυφή μοιάζει με σφάλμα, όχι με επιλογή. Το
  // καρφίτσωμα σημαίνει «κράτα το ψηλά στην αρχική ροή», τίποτα άλλο.
  //
  // Το player.js βάζει style.order = data-rank όταν πατηθεί κατηγορία,
  // και το αφαιρεί στο «Όλα». Η ροή είναι grid, οπότε το order αναδιατάσσει
  // χωρίς να κουνηθεί τίποτα στο DOM.
  const seira = flow.slice()
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const rank = new Map(seira.map((it, i) => [it, i]));

  const list = flow.map((it) => card(it, 0, rank.get(it))).join('\n');

  const html = page({
    title: 'NewsHub Media',
    // Μόνο εδώ: το πλαίσιο της ροής υπάρχει μόνο στην αρχική, και δεν
    // φορτώνουμε σενάρια σε 4.696 σελίδες που δεν τα χρειάζονται.
    scripts: ['roi.js'],
    body: `${siteHeader()}

${heroBanner(featured)}

  <section class="band band--latest">
${bandMark('Lat', 'est', '      <h1 data-flow-head>Τελευταία επεισόδια</h1>')}

${topicStrip(catGroups)}

    <div class="flow" data-topic="all">
      <div class ="grid">
    ${list}
      </div>
      <p class="flow-all"><a data-flow-all href="episodes.html">Όλα τα επεισόδια →</a></p>
    </div>
  </section>

${adSlot('home-top', 'billboard')}

${/* Οι εκπομπές βγαίνουν ΕΞΩ από τις δύο στήλες, επίτηδες: μέσα στην
     αριστερή στήλη το πλαίσιο έπιανε 1.044px και οι αφίσες έβγαιναν
     226px — πολύ μικρές για να διαβαστεί το όνομα της εκπομπής που
     είναι ψημένο μέσα τους. Σε όλο το πλάτος χωρούν τρεις μεγάλες. */ ''}
${showsSection(showGroups)}

${/* Το «Must read» κάθεται ανάμεσα στις εκπομπές και στα θέματα: μετά
     τις εκπομπές το δικό μας υλικό έχει ήδη παρουσιαστεί, και πριν τις
     κατηγορίες ο αναγνώστης κάνει μια παύση με ειδήσεις πριν μπει στο
     βαθύ μέρος της σελίδας. */ ''}
${mustReadSection(articles, curation, onTop)}

${/* Αμέσως μετά το Must read, και πριν τα θέματα: όποιος άφησε κάτι
     στη μέση το βρίσκει πριν μπει στο βαθύ μέρος της σελίδας. Για
     όποιον δεν άφησε τίποτα η ενότητα δεν υπάρχει καθόλου, οπότε η
     εγκεκριμένη διάταξη μένει ανέπαφη για τον καινούριο επισκέπτη. */ ''}
${resumeSection()}

  <div class="page-cols">
    <div class="page-main">
${topicRows(catGroups)}

${namesSection(groups)}

${/* Η δεύτερη θέση της αρχικής. Ανάμεσα στα «Πρόσωπα» και στο «Και
     ακόμα»: εκεί τελειώνει το κυρίως σώμα και αρχίζει η ουρά της
     σελίδας, δηλαδή σημείο παύσης και όχι διακοπή. Η πρώτη θέση
     (home-top) κάθεται πολύ ψηλότερα, οπότε οι δύο δεν γειτονεύουν. */ ''}
${adSlot('home-mid', 'leaderboard')}

${moreTopics(catGroups)}

${spotlightSections(catGroups)}
    </div>

    <div class="page-side">
${/* ΠΑΝΩ από τη ροή, επίτηδες, και είναι η μόνη θέση που δουλεύει.
     Μέχρι τώρα κολλητή ήταν ΟΛΗ η στήλη, δηλαδή ό,τι έμπαινε μέσα
     της ακολουθούσε το σκρολάρισμα — ακριβώς η διαφήμιση που κυνηγάει
     τον αναγνώστη, που απαγόρευσε το αφεντικό. Τώρα κολλητή είναι
     μόνο η ροή (.ticker στο styles.css) και η διαφήμιση μένει στη
     θέση της.

     Κάτω από τη ροή δεν γίνεται: ένα κολλητό στοιχείο κρατάει τον
     χώρο του αλλά ζωγραφίζεται μετατοπισμένο, οπότε κατεβαίνοντας θα
     περνούσε από πάνω της. Πάνω της, η ροή ταξιδεύει προς τα κάτω και
     δεν τη συναντά ποτέ. */ ''}
${adSlot('home-side', 'mpu')}

${newsTicker(articles)}
    </div>
  </div>

${intro(episodes[0], videos[0])}`,
  });

  fs.mkdirSync(PUBLIC_DIR, { recursive: true }); //creation of the public directory if it doesn't exist

  // Τα λογότυπα ζουν στο public/shows/ — ανεβαίνουν στο git, δεν παράγονται.

  writeIfChanged(path.join(PUBLIC_DIR, 'index.html'), html); //writes the generated HTML to the index.html file
  writeIfChanged(path.join(PUBLIC_DIR, 'guests.html'), guestsIndexPage(groups));
  writeIfChanged(path.join(PUBLIC_DIR, 'search.html'), searchPage(episodes, catGroups));
  writeIfChanged(path.join(PUBLIC_DIR, 'shows.html'), showsIndexPage(showGroups));

  // Το αρχείο όλων των επεισοδίων, σελιδοποιημένο.
  const archivePages = pageCount(episodes.length);
  const expectedArchive = new Set();
  for (let p = 1; p <= archivePages; p++) {
    const name = pagedName('episodes', p);
    expectedArchive.add(name);
    writeIfChanged(path.join(PUBLIC_DIR, name), episodesPage(episodes, p));
  }

  // Οι σελίδες επεισοδίου. Συγκρίνουμε με ό,τι υπάρχει ήδη στον δίσκο
  // και γράφουμε μόνο τις αλλαγμένες — αλλιώς κάθε build θα πείραζε και
  // τα 1027 αρχεία χωρίς λόγο.
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
  
  const expected = new Set(episodes.map((ep) => path.basename(episodeUrl(ep))));
  let removed = 0;
  for(const file of fs.readdirSync(EPISODE_DIR)){
    if(!file.endsWith('.html')) continue;
    if(expected.has(file)) continue;
    fs.unlinkSync(path.join(EPISODE_DIR, file));
    removed++;
  }

  // Οι απομαγνητοφωνήσεις, σε ξεχωριστά αρχεία που τα ζητάει ο player
  // μόνο όταν ανοίξει κανείς την ενότητα. Δες το σχόλιο στο
  // transcriptSection για το γιατί δεν είναι μέσα στις σελίδες.
  fs.mkdirSync(TRANSCRIPT_OUT, { recursive: true });
  const expectedTr = new Set();
  let trWritten = 0;
  for (const ep of episodes) {
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
    const name = mostCommon(group.names);   // η γραφή που εμφανίζεται πιο συχνά
    const slug = slugify(name);             // ...και από αυτήν βγαίνει η διεύθυνση

    // Το χαλαρό κλειδί ένωσε, το slug ονομάζει — άρα δύο ομάδες μπορούν
    // θεωρητικά να ζητήσουν το ίδιο αρχείο. Το φωνάζουμε αντί να γράψουμε
    // σιωπηλά τη μία πάνω στην άλλη.
    if (expectedGuests.has(`${slug}.html`)) {
      console.warn(`ΠΡΟΣΟΧΗ: δύο καλεσμένοι ζητούν το guest/${slug}.html — ο «${name}» δεν γράφτηκε`);
      continue;
    }
    expectedGuests.add(`${slug}.html`);

    const file = path.join(GUEST_DIR,`${slug}.html`);
    const next = guestPage(name,group.episodes);
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

  // Σελίδες βίντεο — ίδιο μοτίβο με τα επεισόδια.
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  // Ένα βίντεο μπορεί να υπάρχει σε πολλές λίστες. Κρατάμε μία σελίδα ανά
  // βίντεο, με την ειδικότερη εκπομπή του.
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

  // Σελίδες θεμάτων — ίδιο μοτίβο. Οι ομάδες φτιάχτηκαν πιο πάνω, γιατί
  // τις χρειάστηκε και η αρχική.
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

  // Σελίδες άρθρων — όσα έχουν σώμα στο data/news-bodies/.
  //
  // Γράφονται ΜΕΤΑ τις κατηγορίες επίτηδες: το άρθρο δείχνει τη
  // κατηγορία του, και 4 από τις 16 κατηγορίες των ειδήσεών τους
  // (Sugar, Τα εν οίκω, Έξοδος, Προσωπογραφίες) δεν έχουν δική μας
  // σελίδα. Χωρίς αυτόν τον έλεγχο, το άρθρο έδειχνε σε 404.
  //
  // ΔΕΝ σβήνουμε όσες περισσέψουν. Ένα άρθρο βγαίνει από τα must read
  // μέσα σε ώρες, αλλά η σελίδα του μπορεί να έχει ήδη μοιραστεί ή να
  // έχει μπει στη Google. Αν τη σβήναμε, θα γινόταν 404 — και το 404
  // σε σελίδα που δείχνει το newshub.gr ως πρωτότυπο βλάπτει ακριβώς
  // αυτό που ήρθε να βοηθήσει. Ο φάκελος μεγαλώνει όσο τα σώματα, και
  // εκείνα τα κρατάει μετρημένα το fetch-news.js.
  fs.mkdirSync(ARTICLE_DIR, { recursive: true });
  const hasCatPage = (cat) => !!cat && expectedCats.has(path.basename(categoryUrl(cat)));

  // ΠΡΩΤΑ τα δικά μας. Μοιράζονται φάκελο με τις αναδημοσιεύσεις —
  // για τον αναγνώστη είναι το ίδιο πράγμα — αλλά αν δύο άρθρα πέσουν
  // στο ίδιο όνομα, κερδίζει το δικό μας και το λέμε δυνατά. Σιωπηλό
  // πάτημα σημαίνει ότι ο δημοσιογράφος έγραψε άρθρο που δεν βγήκε
  // ποτέ, και θα το μάθαινε μόνο αν τύχαινε να το ψάξει.
  const ownTaken = new Set();
  let ownWritten = 0;
  for (const a of ownArticles) {
    const file = path.join(ARTICLE_DIR, `${a.id}.html`);
    ownTaken.add(`${a.id}.html`);
    if (writeIfChanged(file, ownArticlePage(a, hasCatPage(a.category)))) ownWritten++;
  }

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

  // Σελίδες εκπομπών — ίδιο μοτίβο: γράψε ό,τι άλλαξε, σβήσε τα ορφανά.
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

  // Τα τρία αρχεία που θέλει κάθε σοβαρό site και δεν είναι σελίδες:
  // η 404, ο κατάλογος για τη Google και οι οδηγίες για τα ρομπότ.
  writeIfChanged(path.join(PUBLIC_DIR, '404.html'), notFoundPage());

  // Ο φάκελος transcript/ μένει έξω. Κανένα link δεν δείχνει εκεί — τα
  // ζητάει ο player με fetch — αλλά το γράφουμε ρητά: είναι αυτόματο
  // κείμενο με λάθος ονόματα, και δεν θέλουμε να γίνει αποτέλεσμα
  // αναζήτησης με λόγια που δεν είπε κανείς.
  writeIfChanged(path.join(PUBLIC_DIR, 'robots.txt'),
    `User-agent: *\nAllow: /\nDisallow: /transcript/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);

  // Κάθε σελίδα με περιεχόμενο μπαίνει στον κατάλογο. Η σελίδα αναζήτησης
  // μένει έξω: δεν έχει τίποτα δικό της να δείξει στη Google.
  const sitemap = [
    { loc: '' },
    { loc: 'shows.html' },
    { loc: 'categories.html' },
    { loc: 'guests.html' },
    ...[...expectedArchive].map((n) => ({ loc: n })),
    ...episodes.map((ep) => ({ loc: episodeUrl(ep), date: ep.date })),
    ...Object.keys(best).map((n) => ({ loc: `video/${n}`, date: best[n].date })),
    // Όλες οι σελίδες, όχι μόνο η πρώτη — αλλιώς φτιάξαμε 85 σελίδες
    // που δεν θα τις βρει ποτέ κανείς.
    ...[...expectedShows].map((n) => ({ loc: `show/${n}` })),
    ...[...expectedCats].map((n) => ({ loc: `category/${n}` })),
    ...[...expectedGuests].map((n) => ({ loc: `guest/${n}` })),
    // ΜΟΝΟ τα δικά μας άρθρα. Οι αναδημοσιεύσεις του newshub.gr μένουν
    // έξω: δηλώνουν αλλού το πρωτότυπό τους, άρα δεν ζητούν
    // ευρετηρίαση για τον εαυτό τους.
    ...ownArticles.map((a) => ({ loc: ownArticleUrl(a), date: a.date })),
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
  console.log(`Απομαγνητοφωνήσεις: ${expectedTr.size} συνολικά, ${trWritten} γράφτηκαν, ${trRemoved} σβήστηκαν`);
console.log(`Σελίδες καλεσμένων: ${guestsWritten} γράφτηκαν, ${guestsRemoved} σβήστηκαν`);

  // ---- το διαχειριστικό ----
  //
  // Ο πηγαίος κώδικάς του ζει στο admin/ και αντιγράφεται εδώ. ΔΕΝ
  // γράφεται κατευθείαν στο public/, γιατί το .gitignore πετάει όλο το
  // public/ ως παραγόμενο — ό,τι έμπαινε εκεί χανόταν στο επόμενο
  // deployment. Αντιγραφή, όχι μετακίνηση: το admin/ μένει η πηγή.
  const ADMIN_SRC = path.join(__dirname, 'admin');
  const ADMIN_OUT = path.join(PUBLIC_DIR, 'admin');
  let adminFiles = 0;

  // Τι κατηγορία ΔΙΝΕΙ ΣΗΜΕΡΑ το site σε κάθε επεισόδιο και βίντεο.
  //
  // Το διαχειριστικό πρέπει να δείχνει στον συντάκτη ποια είναι η
  // αυτόματη πρόταση — χωρίς αυτήν δεν ξέρει τι διορθώνει. Τη λογική
  // την ξέρει ΜΟΝΟ αυτό το αρχείο (suggestCategories), και δεν την
  // αντιγράφουμε στη διεπαφή: δύο αντίγραφα αποκλίνουν και ο
  // συντάκτης θα διόρθωνε κάτι άλλο από αυτό που βλέπει στο site.
  //
  // Γράφεται ΠΑΝΤΑ, δίπλα στα υπόλοιπα αρχεία του διαχειριστικού: από
  // εκεί το σερβίρει το serve.js. Είναι παραγόμενο και μένει έξω από
  // το git — 4.800 εγγραφές δεν έχουν θέση σε κάθε commit.
  if (fs.existsSync(ADMIN_SRC)) {
    const autoCats = {};
    for (const ep of episodes) autoCats[ep.id] = suggestCategories(ep.title);
    for (const v of videos) autoCats[v.id] = suggestCategories(v.title);

    const catsFile = path.join(ADMIN_SRC, 'auto-categories.json');
    const catsText = JSON.stringify(autoCats);
    if (!fs.existsSync(catsFile) || fs.readFileSync(catsFile, 'utf8') !== catsText) {
      fs.writeFileSync(catsFile, catsText, 'utf8');
    }

    // Η απογραφή προσώπων — ίδια λογική, ίδιος λόγος. Παραγόμενο, έξω
    // από το git.
    const peopleFile = path.join(ADMIN_SRC, 'people.json');
    const peopleText = JSON.stringify(peopleForAdmin(episodes));
    if (!fs.existsSync(peopleFile) || fs.readFileSync(peopleFile, 'utf8') !== peopleText) {
      fs.writeFileSync(peopleFile, peopleText, 'utf8');
    }

    // Και η απογραφή του ζευγαρώματος: ποια επεισόδια δεν βρήκαν βίντεο
    // ή καλεσμένο. Παραγόμενο, έξω από το git.
    const todoFile = path.join(ADMIN_SRC, 'pairs-todo.json');
    const todoText = JSON.stringify(pairsForAdmin(episodes));
    if (!fs.existsSync(todoFile) || fs.readFileSync(todoFile, 'utf8') !== todoText) {
      fs.writeFileSync(todoFile, todoText, 'utf8');
    }
  }

  // Το διαχειριστικό ΔΕΝ ανεβαίνει στο site μέχρι να υπάρχει πύλη
  // εισόδου μπροστά του.
  //
  // Μετρημένο στις 4 Νοεμβρίου: το newshubmedia.gr/admin/ απαντούσε
  // 200 σε οποιονδήποτε. Δεν μπορούσε να γράψει τίποτα — το /api/ δεν
  // υπάρχει ακόμα στον αέρα — αλλά η στιγμή που θα έμπαιναν οι
  // Functions θα το άνοιγε διάπλατα.
  //
  // Τοπικά δεν χάνεται τίποτα: το serve.js το σερβίρει κατευθείαν από
  // τον φάκελο admin/. Όταν στηθεί το Cloudflare Access, αυτό ανοίγει
  // με ADMIN_PUBLIC=1 — και ΜΟΝΟ τότε.
  if (!process.env.ADMIN_PUBLIC) {
    // Ό,τι ανέβηκε σε προηγούμενο build φεύγει τώρα.
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

      // Σφραγίδα έκδοσης στο CSS και στο JS του διαχειριστικού.
      //
      // Τα αρχεία εδώ είναι στατικά όπως όλα τα άλλα, άρα το Cloudflare
      // λέει στον browser να τα κρατήσει τέσσερις ώρες. Μια διόρθωση
      // στη διεπαφή δεν έφτανε ποτέ στο κινητό του συντάκτη μέσα στην
      // ίδια βάρδια — και στον υπολογιστή χρειαζόταν Ctrl+Shift+R, που
      // κανείς δεν ξέρει. Ίδιο μοτίβο με το assetVersion() του site.
      if (file === 'index.html') {
        const tag = (name) => crypto.createHash('md5')
          .update(fs.readFileSync(path.join(ADMIN_SRC, name)))
          .digest('hex').slice(0, 8);

        next = Buffer.from(String(next)
          .replace('href="admin.css"', `href="admin.css?v=${tag('admin.css')}"`)
          .replace('src="admin.js"', `src="admin.js?v=${tag('admin.js')}"`));
      }
      // Γράφουμε μόνο ό,τι άλλαξε: αλλιώς το publish.js νομίζει πως
      // πειράχτηκαν σελίδες και ξαναχτίζει το ευρετήριο για το τίποτα.
      if (!fs.existsSync(to) || !fs.readFileSync(to).equals(next)) {
        fs.writeFileSync(to, next);
        adminFiles++;
      }
    }
    console.log(`Διαχειριστικό: ${adminFiles} αρχεία αντιγράφηκαν ΣΤΟ SITE (ADMIN_PUBLIC=1)`);
  }

  // Πόσα αρχεία πειράχτηκαν συνολικά. Το χρειάζεται το publish.js για να
  // αποφασίσει αν αξίζει να ξαναφτιαχτεί το ευρετήριο αναζήτησης.
  // Το «writes» μετράει τις μοναδικές σελίδες — αρχική, θέματα, αρχείο,
  // sitemap. Χωρίς αυτό, μια αλλαγή μόνο στην αρχική δεν θα έφτανε ποτέ
  // στο ευρετήριο αναζήτησης.
  return written + removed + guestsWritten + guestsRemoved
    + showsWritten + showsRemoved + videosWritten + videosRemoved
    + catsWritten + catsRemoved + writes + adminFiles;
}

// Τρέχει μόνο του όταν το καλείς κατευθείαν (node build.js). Όταν το
// φορτώνει άλλο αρχείο, απλώς δίνει τη main για να την καλέσει εκείνο.
if (require.main === module) {
  main();
} else {
  module.exports = { main };
}
