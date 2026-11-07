// admin.js — η διεπαφή του διαχειριστικού.
//
// Vanilla, όπως όλο το site: κανένα framework, κανένα build βήμα. Ό,τι
// βλέπεις εδώ τρέχει όπως γράφτηκε.
//
// Μιλάει ΜΟΝΟ με δύο διευθύνσεις:
//   GET  /api/data/<όνομα>   διάβασε
//   PUT  /api/data/<όνομα>   γράψε
//
// Ποιος απαντά — ο τοπικός serve.js ή μια Cloudflare Function που κάνει
// commit — δεν την αφορά. Γι' αυτό ό,τι δοκιμάζεται τοπικά δουλεύει και
// στον αέρα χωρίς αλλαγή γραμμής.

'use strict';

// Πόσα δείχνουμε με τη μία. Τα επεισόδια είναι 1.059 και τα βίντεο
// 3.759: όλα μαζί στην οθόνη θα κρέμαγαν τον browser.
var PAGE = 24;

var state = {
  curation: null,
  items: [],        // όλα τα διαθέσιμα, ενωμένα και ταξινομημένα
  // Οι πηγές όπως ήρθαν. Τις κρατάμε για να ξαναφτιαχτεί η παραπάνω
  // λίστα όταν αλλάξει άρθρο, χωρίς να ξανακατέβουν 5 MB δεδομένων.
  raw: { episodes: [], videos: [], news: [] },
  shown: PAGE,
  find: '',
  kind: '',
  dirty: false,
};

// ---------------------------------------------------------------------
// Μικρά βοηθητικά
// ---------------------------------------------------------------------

function $(sel, root){ return (root || document).querySelector(sel); }
function $$(sel, root){ return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

// Ξεκωδικοποιεί ό,τι ήρθε ήδη ως HTML από την πηγή.
//
// 83 από τα 1.068 επεισόδια έχουν τίτλο με «&quot;» μέσα — έτσι τα δίνει
// το RSS του Buzzsprout. Στο site δεν φαίνεται: ο τίτλος μπαίνει σε HTML
// και ο browser τα ξεκωδικοποιεί μόνος του. Εδώ όμως τα περνάμε από
// esc() για ασφάλεια, οπότε το «&» γίνεται «&amp;» και ο συντάκτης
// διαβάζει «Το &quot;ιστορικό&quot; πλαίσιο».
//
// Το textarea είναι ο ασφαλής τρόπος: ό,τι μπει μέσα του μένει κείμενο,
// δεν εκτελείται τίποτα.
function unent(s){
  var t = String(s == null ? '' : s);
  if (t.indexOf('&') === -1) return t;
  var box = document.createElement('textarea');
  box.innerHTML = t;
  return box.value;
}

function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Για την αναζήτηση: πετάει τόνους και σημεία στίξης, ώστε το «Συριγος»
// να βρίσκει τον «Συρίγος».
function flat(s){
  return String(s == null ? '' : s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zα-ω0-9]+/g, ' ')
    .trim();
}

function when(iso){
  var d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('el-GR', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Το μήνυμα κατάστασης. Οι δημοσιογράφοι έρχονται από εργαλείο όπου η
// αποθήκευση είναι ακαριαία — χωρίς σαφές μήνυμα θα ξαναπατούν το κουμπί.
var stateEl = $('[data-state]');

function say(text, kind){
  if (!text) { stateEl.hidden = true; return; }
  stateEl.hidden = false;
  stateEl.textContent = text;
  if (kind) stateEl.setAttribute('data-kind', kind);
  else stateEl.removeAttribute('data-kind');
}

// Όταν λήξει η συνεδρία του Cloudflare Access.
//
// Το αίτημα δεν φτάνει ποτέ στη Function: το Access το ανακατευθύνει
// στη σελίδα σύνδεσης, που ζει σε ΑΛΛΟ domain. Ο browser μπλοκάρει την
// ανάγνωση και το fetch σκάει με σκέτο «Failed to fetch» — ή, αν η
// ανακατεύθυνση περάσει, φτάνει HTML εκεί που περιμέναμε JSON και το
// JSON.parse βγάζει «Unexpected token '<'».
//
// Και τα δύο είναι ακατανόητα για τον συντάκτη, και το χειρότερο: τον
// σπρώχνουν να ανανεώσει τη σελίδα — που είναι ακριβώς η κίνηση που
// χάνει το μισογραμμένο άρθρο. Το κείμενο ως εκείνη τη στιγμή είναι
// ασφαλές στη μνήμη.
var LOST = 'Η σύνδεσή σου έληξε ή χάθηκε το δίκτυο. '
  + 'ΜΗΝ ανανεώσεις τη σελίδα — το κείμενό σου είναι εδώ. '
  + 'Άνοιξε το διαχειριστικό σε ΝΕΑ καρτέλα, συνδέσου, '
  + 'γύρνα εδώ και ξαναπάτα Αποθήκευση.';

// Είναι όντως JSON αυτό που ήρθε; Αν όχι, μας απάντησε κάποιος άλλος —
// σχεδόν πάντα η σελίδα σύνδεσης του Access.
function readJson(res){
  var type = res.headers.get('Content-Type') || '';
  if (type.indexOf('json') === -1) throw new Error(LOST);

  return res.json().then(function (data) {
    if (!res.ok) throw new Error(data && data.error ? data.error : 'Σφάλμα ' + res.status);
    return data;
  });
}

// Το fetch απορρίπτει ΜΟΝΟ σε δικτυακή αποτυχία ή μπλοκαρισμένη
// ανακατεύθυνση — ποτέ για 404 ή 500. Άρα εδώ φτάνει ακριβώς η
// περίπτωση «δεν έφυγε το αίτημα».
function netFail(err){
  if (err instanceof TypeError) throw new Error(LOST);
  throw err;
}

function api(name, method, body){
  return fetch('/api/data/' + name, {
    method: method || 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).then(readJson, netFail);
}

// ---------------------------------------------------------------------
// Τα διαθέσιμα κομμάτια περιεχομένου
// ---------------------------------------------------------------------

// Ενώνουμε επεισόδια, βίντεο και ειδήσεις σε ΜΙΑ λίστα με κοινή μορφή.
// Ο συντάκτης δεν θέλει να σκεφτεί «σε ποια καρτέλα είναι αυτό που
// ψάχνω» — θέλει να γράψει δυο λέξεις και να το βρει.
function normalize(episodes, videos, news, articles){
  var out = [];

  (episodes || []).forEach(function (e) {
    out.push({
      kind: 'podcast',
      id: e.id,
      // Ο κωδικός είναι ό,τι καταλαβαίνει το build — δες sameItem().
      ref: e.id,
      title: unent(e.headline || e.title),
      who: unent(e.guest),
      image: e.image || '',
      date: e.date,
    });
  });

  (videos || []).forEach(function (v) {
    out.push({
      kind: 'video',
      id: v.id,
      ref: v.url || v.id,
      title: unent(v.title),
      who: unent(v.show),
      image: v.image || '',
      date: v.date,
    });
  });

  (news || []).forEach(function (a) {
    out.push({
      kind: 'news',
      id: a.id,
      // Για τις ειδήσεις το build δέχεται τη διεύθυνση του newshub.gr.
      ref: a.url,
      title: unent(a.title),
      who: unent(a.category),
      image: a.image_large || a.image_thumb || '',
      date: a.date,
    });
  });

  // Τα δικά μας άρθρα. Έλειπαν εντελώς από εδώ, οπότε δεν υπήρχε
  // κανένας τρόπος να μπει δικό μας άρθρο στο πρωτοσέλιδο.
  //
  // Μόνο τα δημοσιευμένα: ένα πρόχειρο στο πρωτοσέλιδο θα έστελνε τον
  // κόσμο σε σελίδα που δεν υπάρχει.
  (articles || []).forEach(function (a) {
    if (a.status !== 'published') return;
    out.push({
      kind: 'article',
      id: a.id,
      // Ό,τι καταλαβαίνει το build για δικό μας άρθρο — δες sameItem().
      ref: 'arthro/' + a.id + '.html',
      title: unent(a.title),
      who: unent(a.category),
      image: a.image || '',
      date: a.date,
    });
  });

  out.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });

  // ΜΙΑ γραμμή ανά αντικείμενο.
  //
  // 560 βίντεο υπάρχουν στο videos.json πολλές φορές, επειδή ανήκουν
  // σε πολλές λίστες του YouTube. Ο συντάκτης τα έβλεπε διπλά: στο
  // πρωτοσέλιδο διάλεγε «ποιο από τα δύο ίδια;» και στις κατηγορίες
  // διόρθωνε το ένα και το άλλο φαινόταν ακόμα λάθος — ενώ είναι το
  // ίδιο βίντεο με τον ίδιο κωδικό. Το site κάνει το ίδιο (moreSpecific
  // στο build.js), απλώς εκεί δεν φαινόταν.
  var once = [];
  var seenId = {};
  out.forEach(function (it) {
    var key = it.kind + ':' + it.id;
    if (seenId[key]) return;
    seenId[key] = true;
    once.push(it);
  });

  // Το κλειδί αναζήτησης υπολογίζεται ΜΙΑ φορά: αλλιώς το flat() θα
  // έτρεχε πάνω σε 4.800 εγγραφές σε κάθε πάτημα πλήκτρου.
  once.forEach(function (it) { it.key = flat(it.title + ' ' + it.who); });

  return once;
}

function matches(it){
  if (state.kind && it.kind !== state.kind) return false;
  if (!state.find) return true;
  return it.key.indexOf(state.find) !== -1;
}

// Ταιριάζει η εγγραφή με ό,τι είναι γραμμένο στο curation; Η ίδια
// χαλαρή λογική με το build.js: δέχεται κωδικό ή διεύθυνση.
function isChosen(it, want){
  if (!want) return false;

  // Ίδιο ξεφλούδισμα με το strip() της sameItem στο build.js.
  var strip = function (s){
    return String(s == null ? '' : s).trim().toLowerCase()
      .replace(/^https?:\/\/[^/]+\//, '')
      .replace(/^\/+/, '')
      .replace(/[?#].*$/, '');
  };
  var tail = function (s){ return s.split('/').pop().replace(/\.html?$/, ''); };

  var w = strip(want);
  if (!w) return false;

  var id = String(it.id == null ? '' : it.id).toLowerCase();
  if (id && id === w) return true;

  var mine = strip(it.ref);
  if (mine && mine === w) return true;

  var t = tail(w);
  if (!t) return false;
  if (id && t === id) return true;
  if (mine && tail(mine) === t) return true;

  if (id && t.indexOf(id + '-') === 0) return true;

  // Το επεισόδιο έχει κωδικό «Buzzsprout-20060479», αλλά η σελίδα του
  // είναι «episode/20060479-ο-τίτλος.html» — ο κωδικός μπαίνει εκεί
  // ΧΩΡΙΣ το πρόθεμα.
  //
  // Χωρίς αυτό, ό,τι κολλούσε ο δημοσιογράφος από τον browser έδειχνε
  // «δεν βρέθηκε», ενώ το build το έβρισκε κανονικά — γιατί εκεί η
  // sameItem συγκρίνει με το href της σελίδας, που εμείς εδώ δεν το
  // έχουμε. Η πιο μπερδευτική μορφή σφάλματος: το site υπακούει και
  // το διαχειριστικό λέει ότι δεν ξέρει τι του ζήτησες.
  var num = id.replace(/^buzzsprout-/, '');
  return !!num && (t === num || t.indexOf(num + '-') === 0);
}

// ---------------------------------------------------------------------
// Ζωγραφική
// ---------------------------------------------------------------------

var TAGS = { podcast: 'Podcast', video: 'Βίντεο', news: 'Είδηση', article: 'Άρθρο' };

function drawNow(){
  var box = $('[data-now-body]');
  var want = state.curation && state.curation.featured;

  if (!want) {
    box.innerHTML = '<p class="muted">Καμία χειροκίνητη επιλογή — το site βάζει μόνο του '
      + 'το πιο πρόσφατο με εικόνα.</p>';
    return;
  }

  var hit = null;
  for (var i = 0; i < state.items.length; i++) {
    if (isChosen(state.items[i], want)) { hit = state.items[i]; break; }
  }

  if (!hit) {
    box.innerHTML = '<p class="muted">Επιλεγμένο: <code>' + esc(want) + '</code><br>'
      + 'Δεν το βρήκα στη λίστα — μπορεί να είναι παλιό ή σβησμένο. '
      + 'Το site θα γυρίσει στην αυτόματη επιλογή.</p>';
    return;
  }

  box.innerHTML =
    (hit.image ? '<img src="' + esc(hit.image) + '" alt="">' : '<img alt="">')
    + '<div>'
    + '<p class="now-title">' + esc(hit.title) + '</p>'
    + '<p class="now-meta">'
    + '<span class="tag tag--' + hit.kind + '">' + TAGS[hit.kind] + '</span>'
    + (hit.who ? esc(hit.who) + ' · ' : '') + when(hit.date)
    + '</p></div>';
}

function drawPicks(){
  var box = $('[data-picks]');
  var want = state.curation && state.curation.featured;

  var hits = state.items.filter(matches);
  var slice = hits.slice(0, state.shown);

  if (!hits.length) {
    box.innerHTML = '<p class="muted">Τίποτα δεν ταιριάζει.</p>';
    $('[data-more]').hidden = true;
    return;
  }

  box.innerHTML = slice.map(function (it) {
    return '<button type="button" class="pick' + (isChosen(it, want) ? ' is-on' : '') + '"'
      + ' data-ref="' + esc(it.ref) + '">'
      + (it.image ? '<img src="' + esc(it.image) + '" alt="" loading="lazy">' : '<img alt="">')
      + '<span>'
      + '<span class="pick-title">' + esc(it.title) + '</span>'
      + '<span class="pick-meta">'
      + '<span class="tag tag--' + it.kind + '">' + TAGS[it.kind] + '</span>'
      + (it.who ? esc(it.who) + ' · ' : '') + when(it.date)
      + '</span></span></button>';
  }).join('');

  $('[data-more]').hidden = hits.length <= state.shown;
}

function markDirty(on){
  state.dirty = on;
  $('[data-save="curation"]').disabled = !on;
  if (on) say('Μη αποθηκευμένες αλλαγές');
}

// ---------------------------------------------------------------------
// Ενέργειες
// ---------------------------------------------------------------------

function choose(ref){
  state.curation.featured = ref;

  // Αν δεν υπάρχει ημερομηνία λήξης, βάζουμε μία εβδομάδα μπροστά.
  // Ο έλεγχος στο admin-api.js θα απέρριπτε την αποθήκευση χωρίς αυτήν,
  // και ο συντάκτης δεν έχει λόγο να μάθει γιατί.
  if (!state.curation.featuredUntil || new Date(state.curation.featuredUntil) < new Date()) {
    var d = new Date();
    d.setDate(d.getDate() + 7);
    state.curation.featuredUntil = d.toISOString().slice(0, 10);
    $('[data-until]').value = state.curation.featuredUntil;
  }

  // Η χειροκίνητη εικόνα ανήκει στην ΠΡΟΗΓΟΥΜΕΝΗ επιλογή. Αν μείνει,
  // η καινούρια είδηση θα εμφανιστεί με ξένη φωτογραφία.
  if (state.curation.featuredHero) state.curation.featuredHero = '';

  drawNow();
  drawPicks();
  markDirty(true);
}

function save(){
  var btn = $('[data-save="curation"]');
  btn.disabled = true;
  say('Αποθήκευση…');

  api('curation', 'PUT', state.curation).then(function () {
    markDirty(false);
    say('Αποθηκεύτηκε. Το site ανανεώνεται σε ~2 λεπτά.', 'ok');
  }).catch(function (err) {
    btn.disabled = false;
    say(err.message, 'bad');
  });
}

// ---------------------------------------------------------------------
// Φωτογραφίες
// ---------------------------------------------------------------------

// Το μεγαλύτερο πλάτος που κρατάμε. Η πιο φαρδιά θέση του site είναι
// 1.384px· σε οθόνη με διπλή πυκνότητα θέλει 2.000 για να μη φαίνεται
// θολή. Παραπάνω είναι σκέτο βάρος.
var MAX_W = 2000;

// Σμίκρυνση ΣΤΟΝ BROWSER, πριν ανέβει τίποτα.
//
// Γιατί εδώ και όχι στον server: ο δημοσιογράφος ανεβάζει φωτογραφία
// 5MB κατευθείαν από το κινητό. Στέλνοντάς την ωμή, το ανέβασμα από
// ρεπορτάζ με αδύναμο σήμα κρατάει λεπτά και συχνά κόβεται. Σμικρυσμένη
// γίνεται 200-400KB. Επιπλέον, η συμπίεση στον server θα απαιτούσε
// βιβλιοθήκη και χρόνο επεξεργασίας που στο δωρεάν Cloudflare μετράει.
//
// Το canvas υπάρχει σε κάθε browser εδώ και χρόνια — μηδέν εξάρτηση.
function shrink(file){
  return new Promise(function (resolve, reject) {
    var url = URL.createObjectURL(file);
    var img = new Image();

    img.onload = function () {
      URL.revokeObjectURL(url);

      var w = img.naturalWidth;
      var h = img.naturalHeight;
      if (w > MAX_W) { h = Math.round(h * MAX_W / w); w = MAX_W; }

      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);

      // 0.82: πάνω από αυτό το αρχείο μεγαλώνει χωρίς ορατό κέρδος,
      // κάτω από αυτό αρχίζουν να φαίνονται τετράγωνα στα πρόσωπα.
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error('Δεν έγινε η σμίκρυνση'));
      }, 'image/jpeg', 0.82);
    };

    img.onerror = function () {
      URL.revokeObjectURL(url);
      reject(new Error('Δεν διαβάζεται η εικόνα'));
    };

    img.src = url;
  });
}

function sayUpload(text, kind){
  var el = $('[data-upload]');
  if (!text) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = text;
  if (kind) el.setAttribute('data-kind', kind); else el.removeAttribute('data-kind');
}

// Το ανέβασμα γίνεται από δύο σημεία: την καρτέλα «Φωτογραφίες» και τον
// επιλογέα μέσα στο άρθρο. Αλλάζει μόνο πού γράφεται το μήνυμα και τι
// γίνεται στο τέλος — όχι η ίδια η δουλειά.
function upload(files, ctx){
  ctx = ctx || {};
  var say = ctx.say || sayUpload;
  // Μετά το ανέβασμα πάμε στον φάκελο της ΣΗΜΕΡΙΝΗΣ μέρας: εκεί μόλις
  // μπήκαν. Χωρίς αυτό, ο συντάκτης ανεβάζει δέκα φωτογραφίες και
  // κοιτάζει μια λίστα φακέλων, χωρίς καμία απόδειξη ότι έγινε κάτι.
  var after = ctx.after || function () {
    loadShots().then(function () { goTo('lib', 'day:' + todayYmd()); });
  };

  var list = Array.prototype.slice.call(files).filter(function (f) {
    return /^image\//.test(f.type);
  });
  if (!list.length) { say('Μόνο φωτογραφίες.', 'bad'); return; }

  var done = 0;
  var failed = [];
  var last = '';    // η διεύθυνση της τελευταίας που ανέβηκε

  // Μία-μία και όχι όλες μαζί: σε αδύναμο σήμα, δέκα παράλληλα
  // ανεβάσματα μπλοκάρουν το ένα το άλλο και κόβονται όλα μαζί.
  function next(i){
    if (i >= list.length) {
      say(
        failed.length
          ? done + ' ανέβηκαν, ' + failed.length + ' απέτυχαν: ' + failed.join(', ')
          : (done === 1 ? 'Η φωτογραφία ανέβηκε.' : done + ' φωτογραφίες ανέβηκαν.'),
        failed.length ? 'bad' : 'ok'
      );
      after(last, done);
      return;
    }

    var file = list[i];
    say('Ανεβαίνει ' + (i + 1) + ' από ' + list.length + '…');

    shrink(file).then(function (blob) {
      return fetch('/api/images', {
        method: 'POST',
        headers: {
          'Content-Type': 'image/jpeg',
          'X-File-Name': encodeURIComponent(file.name),
        },
        body: blob,
      });
    }).then(readJson, netFail).then(function (d) {
      done++;
      last = d.url || '';
    }).catch(function (err) {
      failed.push(file.name + ' (' + err.message + ')');
    }).then(function () {
      next(i + 1);
    });
  }

  next(0);
}

// ---------------------------------------------------------------------
// Η ΒΙΒΛΙΟΘΗΚΗ ΩΣ ΦΑΚΕΛΟΙ
// ---------------------------------------------------------------------
//
// Οι φάκελοι είναι ΥΠΟΛΟΓΙΣΜΕΝΟΙ, δεν υπάρχουν στο R2.
//
// Κάθε φωτογραφία αποθηκεύεται ως «20261106102706-dimarcheio.jpg» — τα
// πρώτα οκτώ ψηφία είναι η ημερομηνία. Άρα μήνας και μέρα βγαίνουν από
// το όνομα, χωρίς να μετακινηθεί τίποτα.
//
// ΓΙΑΤΙ ΟΧΙ ΑΛΗΘΙΝΟΙ ΦΑΚΕΛΟΙ: η διεύθυνση κάθε φωτογραφίας είναι
// «/uploads/<όνομα>» και κάθεται μέσα σε ήδη δημοσιευμένα άρθρα. Ένας
// φάκελος θα την έκανε «/uploads/2026-11/<όνομα>» και κάθε τέτοιο
// άρθρο θα έδειχνε σπασμένη εικόνα. Οι φωτογραφίες δεν είναι στο git
// — δεν υπάρχει τίποτα να τις γυρίσει πίσω.

var lib = {
  files: [],        // ό,τι γύρισε το /api/images
  standard: [],     // τα ονόματα που έχουν αστεράκι
  // Το υπόλοιπο περιεχόμενο του data/photos.json, όπως ήρθε. Το
  // ξαναστέλνουμε αυτούσιο σε κάθε αποθήκευση: αλλιώς η πρώτη χρήση
  // του αστερακιού έσβηνε τις οδηγίες που είναι γραμμένες μέσα στο
  // αρχείο, και το επόμενο άτομο που θα το άνοιγε δεν θα είχε ιδέα
  // γιατί υπάρχει.
  rest: {},
  loaded: false,
  // Πού βρίσκεται το καθένα από τα δύο πλέγματα. null = η ρίζα.
  at: { lib: null, pick: null },
  find: { lib: '', pick: '' },
};

// Η χρονοσφραγίδα του ονόματος. Χωρίς αυτή, η φωτογραφία πάει στον
// φάκελο «Χωρίς ημερομηνία» — μπορεί να ανέβηκε με άλλο εργαλείο.
function shotStamp(name){
  var m = String(name || '').match(/^(\d{4})(\d{2})(\d{2})\d{6}-/);
  if (!m) return null;
  return { ym: m[1] + m[2], ymd: m[1] + m[2] + m[3], y: m[1], mo: m[2], d: m[3] };
}

var MONTHS = ['Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου',
  'Ιουνίου', 'Ιουλίου', 'Αυγούστου', 'Σεπτεμβρίου', 'Οκτωβρίου',
  'Νοεμβρίου', 'Δεκεμβρίου'];
var MONTHS_NOM = ['Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος',
  'Ιούνιος', 'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος',
  'Νοέμβριος', 'Δεκέμβριος'];
var WEEK = ['Κυρ', 'Δευ', 'Τρί', 'Τετ', 'Πέμ', 'Παρ', 'Σάβ'];

function monthLabel(ym){
  return MONTHS_NOM[Number(ym.slice(4, 6)) - 1] + ' ' + ym.slice(0, 4);
}

function dayLabel(ymd){
  var d = new Date(ymd.slice(0, 4) + '-' + ymd.slice(4, 6) + '-' + ymd.slice(6, 8) + 'T12:00:00');
  return WEEK[d.getDay()] + ' ' + Number(ymd.slice(6, 8)) + ' '
    + MONTHS[Number(ymd.slice(4, 6)) - 1];
}

function todayYmd(){
  var d = new Date();
  return String(d.getFullYear())
    + String(d.getMonth() + 1).padStart(2, '0')
    + String(d.getDate()).padStart(2, '0');
}

function isStandard(name){ return lib.standard.indexOf(name) > -1; }

// Ποιες φωτογραφίες ανήκουν σε μια θέση του δέντρου.
function shotsAt(at){
  if (!at) return [];
  if (at.kind === 'std') {
    return lib.files.filter(function (f) { return isStandard(f.name); });
  }
  if (at.kind === 'none') {
    return lib.files.filter(function (f) { return !shotStamp(f.name); });
  }
  return lib.files.filter(function (f) {
    var s = shotStamp(f.name);
    if (!s) return false;
    return at.kind === 'month' ? s.ym === at.ym : s.ymd === at.ymd;
  });
}

// ---- οι κάρτες ----

// Η κάρτα μιας φωτογραφίας. Ίδια στη βιβλιοθήκη και στον επιλογέα —
// αλλάζει μόνο τι κουμπί κουβαλάει: «Αντιγραφή» στη βιβλιοθήκη, ενώ
// στον επιλογέα ολόκληρη η κάρτα είναι το κουμπί.
function shotHTML(f, mode){
  // Το αποθηκευμένο όνομα ξεκινά με χρονοσφραγίδα 14 ψηφίων. Δείχνοντάς
  // τη, η λεζάντα κοβόταν στο «20261103102706…» και δύο φωτογραφίες
  // της ίδιας μέρας ήταν αδιάκριτες. Σπάμε τα δύο μέρη: η ημερομηνία
  // μικρή, το όνομα ολόκληρο.
  var m = f.name.match(/^(\d{8})(\d{6})-(.+)\.\w+$/);
  var label = m ? m[3].replace(/-/g, ' ') : f.name;
  var day = m ? m[1].slice(6, 8) + '/' + m[1].slice(4, 6) : '';
  var pick = mode === 'pick';
  var on = isStandard(f.name);

  return '<figure class="shot"'
    + (pick ? ' tabindex="0" role="button" data-take="' + esc(f.url) + '"' : '') + '>'
    + '<img src="' + esc(f.url) + '" alt="" loading="lazy">'
    // Το αστεράκι μπαίνει ΚΑΙ στον επιλογέα: η στιγμή που καταλαβαίνεις
    // ότι μια φωτογραφία θα τη χρειάζεσαι ξανά είναι όταν τη βάζεις σε
    // άρθρο, όχι όταν περνάς από τη βιβλιοθήκη.
    + '<button type="button" class="shot-star' + (on ? ' is-on' : '') + '"'
    + ' data-star="' + esc(f.name) + '"'
    + ' aria-pressed="' + (on ? 'true' : 'false') + '"'
    + ' title="' + (on ? 'Βγάλ’ τη από τις στάνταρ' : 'Βάλ’ τη στις στάνταρ') + '"'
    + ' aria-label="Στάνταρ φωτογραφία">' + (on ? '★' : '☆') + '</button>'
    + '<button type="button" class="shot-del" data-del="' + esc(f.name) + '"'
    + ' aria-label="Διαγραφή">✕</button>'
    + (pick ? ''
      : '<button type="button" class="shot-copy" data-copy="' + esc(f.url) + '">Αντιγραφή</button>')
    + '<figcaption class="shot-name" title="' + esc(f.name) + '">'
    + (day ? '<span class="shot-day">' + day + '</span> ' : '')
    + esc(label) + '</figcaption>'
    + '</figure>';
}

// Το πλακίδιο ενός φακέλου: εξώφυλλο, όνομα, πλήθος.
//
// Το εξώφυλλο δεν είναι στολίδι. Χωρίς αυτό η οθόνη είναι κουτιά με
// ημερομηνίες, και κανείς δεν θυμάται τι ανέβασε στις 14 Αυγούστου.
function folderHTML(go, title, sub, cover, extra){
  return '<button type="button" class="folder' + (extra || '') + '"'
    + ' data-go="' + esc(go) + '">'
    + '<span class="folder-art">'
    + (cover ? '<img src="' + esc(cover) + '" alt="" loading="lazy">' : '')
    + '</span>'
    + '<span class="folder-name">' + esc(title) + '</span>'
    + '<span class="folder-n">' + esc(sub) + '</span>'
    + '</button>';
}

function countLabel(n){ return n === 1 ? '1 φωτογραφία' : n + ' φωτογραφίες'; }

// ---- η ζωγραφική ----

function drawCrumbs(mode){
  var box = $(mode === 'pick' ? '[data-pick-crumbs]' : '[data-shot-crumbs]');
  var at = lib.at[mode];

  if (lib.find[mode]) {
    box.innerHTML = '<span class="crumb-now">Αναζήτηση σε όλους τους φακέλους</span>';
    return;
  }

  // Στη ρίζα η διαδρομή είναι σκέτο «Βιβλιοθήκη» που δείχνει στον εαυτό
  // της — θόρυβος. Εμφανίζεται μόλις μπεις κάπου.
  if (!at) { box.innerHTML = ''; return; }

  var parts = ['<button type="button" class="crumb" data-go="">Βιβλιοθήκη</button>'];

  if (at && at.kind === 'std') {
    parts.push('<span class="crumb-now">★ Στάνταρ</span>');
  } else if (at && at.kind === 'none') {
    parts.push('<span class="crumb-now">Χωρίς ημερομηνία</span>');
  } else if (at && at.kind === 'month') {
    parts.push('<span class="crumb-now">' + esc(monthLabel(at.ym)) + '</span>');
  } else if (at && at.kind === 'day') {
    parts.push('<button type="button" class="crumb" data-go="month:'
      + at.ymd.slice(0, 6) + '">' + esc(monthLabel(at.ymd.slice(0, 6))) + '</button>');
    parts.push('<span class="crumb-now">' + esc(dayLabel(at.ymd)) + '</span>');
  }

  box.innerHTML = parts.join('<span class="crumb-sep">/</span>');
}

function drawShotsBox(mode){
  var box = $(mode === 'pick' ? '[data-pick-shots]' : '[data-shots]');
  var at = lib.at[mode];
  var find = lib.find[mode];

  drawCrumbs(mode);

  if (!lib.files.length) {
    box.innerHTML = '<p class="muted">Καμία φωτογραφία ακόμα.</p>';
    return;
  }

  // Η αναζήτηση αγνοεί τους φακέλους: ψάχνει σε όλα μαζί. Αυτός είναι
  // ο λόγος που υπάρχει — ο φάκελος βοηθάει όταν ξέρεις πότε, και
  // εμποδίζει όταν δεν ξέρεις.
  if (find) {
    var hits = lib.files.filter(function (f) {
      return flat(f.name).indexOf(find) > -1;
    });
    box.innerHTML = hits.length
      ? hits.map(function (f) { return shotHTML(f, mode); }).join('')
      : '<p class="muted">Καμία φωτογραφία δεν ταιριάζει.</p>';
    return;
  }

  // Μέσα σε φάκελο: οι φωτογραφίες του.
  if (at) {
    var inside = shotsAt(at);
    box.innerHTML = inside.length
      ? inside.map(function (f) { return shotHTML(f, mode); }).join('')
      : '<p class="muted">Άδειος φάκελος.</p>';
    return;
  }

  // Η ρίζα: ★ Στάνταρ, μετά οι μήνες από τον νεότερο.
  var std = lib.files.filter(function (f) { return isStandard(f.name); });
  var out = [folderHTML('std', '★ Στάνταρ',
    std.length ? countLabel(std.length) : 'κενό — σημάδεψε με ☆',
    std.length ? std[0].url : '', ' folder--std')];

  var months = {};
  var undated = [];
  lib.files.forEach(function (f) {
    var s = shotStamp(f.name);
    if (!s) { undated.push(f); return; }
    if (!months[s.ym]) months[s.ym] = [];
    months[s.ym].push(f);
  });

  Object.keys(months).sort().reverse().forEach(function (ym) {
    out.push(folderHTML('month:' + ym, monthLabel(ym),
      countLabel(months[ym].length), months[ym][0].url));
  });

  if (undated.length) {
    out.push(folderHTML('none', 'Χωρίς ημερομηνία',
      countLabel(undated.length), undated[0].url));
  }

  box.innerHTML = out.join('');
}

// Μέσα σε μήνα δείχνουμε ΜΕΡΕΣ, όχι φωτογραφίες: ένας μήνας μπορεί να
// έχει διακόσιες, και τότε ο φάκελος δεν βοήθησε σε τίποτα.
function drawMonth(mode, ym){
  var box = $(mode === 'pick' ? '[data-pick-shots]' : '[data-shots]');
  drawCrumbs(mode);

  var days = {};
  lib.files.forEach(function (f) {
    var s = shotStamp(f.name);
    if (s && s.ym === ym) {
      if (!days[s.ymd]) days[s.ymd] = [];
      days[s.ymd].push(f);
    }
  });

  var keys = Object.keys(days).sort().reverse();
  box.innerHTML = keys.length
    ? keys.map(function (ymd) {
      return folderHTML('day:' + ymd, dayLabel(ymd),
        countLabel(days[ymd].length), days[ymd][0].url);
    }).join('')
    : '<p class="muted">Άδειος μήνας.</p>';
}

function drawLib(mode){
  var at = lib.at[mode];
  if (at && at.kind === 'month' && !lib.find[mode]) drawMonth(mode, at.ym);
  else drawShotsBox(mode);
}

function goTo(mode, where){
  if (!where) lib.at[mode] = null;
  else if (where === 'std') lib.at[mode] = { kind: 'std' };
  else if (where === 'none') lib.at[mode] = { kind: 'none' };
  else if (where.indexOf('month:') === 0) lib.at[mode] = { kind: 'month', ym: where.slice(6) };
  else if (where.indexOf('day:') === 0) lib.at[mode] = { kind: 'day', ymd: where.slice(4) };
  drawLib(mode);
}

function fetchShots(){
  return fetch('/api/images').then(readJson, netFail).then(function (files) {
    lib.files = Array.isArray(files) ? files : [];
    lib.loaded = true;
  });
}

function fillShots(box, mode){
  return fetchShots().then(function () {
    drawLib(mode);
  }).catch(function (err) {
    box.innerHTML = '<p class="muted">Δεν φόρτωσαν: ' + esc(err.message) + '</p>';
  });
}

function loadShots(){ return fillShots($('[data-shots]'), 'lib'); }
function loadPickShots(){ return fillShots($('[data-pick-shots]'), 'pick'); }

// Γράφει ΟΛΟ το αρχείο, όχι μόνο τη λίστα: ό,τι άλλο έχει μέσα —
// οδηγίες, μελλοντικά πεδία — επιβιώνει.
function savePhotos(){
  var body = {};
  Object.keys(lib.rest).forEach(function (k) { body[k] = lib.rest[k]; });
  body.standard = lib.standard;
  return api('photos', 'PUT', body);
}

// Το αστεράκι. Γράφεται αμέσως — δεν υπάρχει κουμπί «Αποθήκευση» στις
// φωτογραφίες, και μια σήμανση που χάνεται στην ανανέωση είναι χειρότερη
// από καθόλου σήμανση.
function toggleStandard(name){
  var at = lib.standard.indexOf(name);
  if (at > -1) lib.standard.splice(at, 1);
  else lib.standard.push(name);

  drawLib('lib');
  if (!$('[data-picker]').hidden) drawLib('pick');

  savePhotos().catch(function (err) {
    // Πίσω στην προηγούμενη κατάσταση: αλλιώς η οθόνη λέει ότι σώθηκε
    // κάτι που δεν σώθηκε, και ο συντάκτης το μαθαίνει αύριο.
    if (at > -1) lib.standard.splice(at, 0, name);
    else lib.standard.splice(lib.standard.indexOf(name), 1);
    drawLib('lib');
    sayUpload('Δεν αποθηκεύτηκε η σήμανση: ' + err.message, 'bad');
  });
}

// Μετά από ανέβασμα ή διαγραφή ενημερώνονται και τα δύο πλέγματα —
// αλλιώς ο επιλογέας δείχνει φωτογραφία που μόλις σβήστηκε.
function refreshShots(){
  loadShots();
  if (!$('[data-picker]').hidden) loadPickShots();
}

// ΟΡΙΣΤΙΚΗ: οι φωτογραφίες ζουν σε R2, όχι στο git — δεν υπάρχει
// ιστορικό να τις γυρίσει πίσω. Γι' αυτό και η προειδοποίηση για τα
// άρθρα: δεν μπορούμε να ξέρουμε ποιο άρθρο δείχνει πού, και μια
// σβησμένη φωτογραφία αφήνει σπασμένη εικόνα μέσα στο κείμενο.
function delShot(name){
  var ok = window.confirm(
    'Να διαγραφεί οριστικά η «' + name + '»;\n\n'
    + 'Αν χρησιμοποιείται σε άρθρο, η εικόνα εκεί θα σπάσει.'
  );
  if (!ok) return;

  fetch('/api/images?name=' + encodeURIComponent(name), { method: 'DELETE' })
    .then(readJson, netFail)
    .then(function () {
      sayUpload('Η φωτογραφία διαγράφηκε.', 'ok');

      // Φεύγει και από τις στάνταρ, αλλιώς ο φάκελος κουβαλάει για
      // πάντα το όνομα ενός αρχείου που δεν υπάρχει.
      var at = lib.standard.indexOf(name);
      if (at > -1) {
        lib.standard.splice(at, 1);
        savePhotos().catch(function () { /* σιωπηλά */ });
      }

      refreshShots();
    })
    .catch(function (err) {
      sayUpload('Δεν διαγράφηκε: ' + err.message, 'bad');
    });
}

function wireShots(){
  var drop = $('[data-drop]');
  var input = $('[data-file]');

  drop.addEventListener('click', function () { input.click(); });
  drop.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });

  input.addEventListener('change', function () {
    upload(input.files);
    input.value = '';   // ώστε η ίδια φωτογραφία να ξαναδέχεται επιλογή
  });

  // Χωρίς preventDefault ο browser ΑΝΟΙΓΕΙ τη φωτογραφία σε νέα καρτέλα
  // και χάνεται η δουλειά της σελίδας.
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
  });
  drop.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files) upload(e.dataTransfer.files);
  });

  // Το ίδιο και σε ΟΛΗ τη σελίδα: αν κάποιος αφήσει φωτογραφία δίπλα
  // από τη ζώνη, να μη φύγει από το διαχειριστικό.
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { e.preventDefault(); });

  // Η πλοήγηση στους φακέλους — και στα δύο πλέγματα, με τον ίδιο κώδικα.
  ['lib', 'pick'].forEach(function (mode) {
    var grid = $(mode === 'pick' ? '[data-pick-shots]' : '[data-shots]');
    var crumbs = $(mode === 'pick' ? '[data-pick-crumbs]' : '[data-shot-crumbs]');
    var find = $(mode === 'pick' ? '[data-pick-find]' : '[data-shot-find]');

    crumbs.addEventListener('click', function (e) {
      var go = e.target.closest('[data-go]');
      if (go) goTo(mode, go.dataset.go);
    });

    // Στο πλέγμα ο φάκελος και το αστεράκι πιάνονται ΠΡΙΝ από τα
    // υπόλοιπα: η κάρτα του επιλογέα είναι ολόκληρη κουμπί, οπότε
    // χωρίς αυτό το αστεράκι θα διάλεγε τη φωτογραφία.
    grid.addEventListener('click', function (e) {
      var go = e.target.closest('[data-go]');
      if (go) { goTo(mode, go.dataset.go); return; }

      var star = e.target.closest('[data-star]');
      if (star) {
        e.preventDefault();
        e.stopPropagation();
        toggleStandard(star.dataset.star);
      }
    }, true);

    find.addEventListener('input', function (e) {
      lib.find[mode] = flat(e.target.value);
      drawLib(mode);
    });
  });

  $('[data-shots]').addEventListener('click', function (e) {
    if (e.target.closest('[data-go]') || e.target.closest('[data-star]')) return;

    var del = e.target.closest('[data-del]');
    if (del) { delShot(del.dataset.del); return; }

    var btn = e.target.closest('[data-copy]');
    if (!btn) return;

    function flash(word){
      btn.textContent = word;
      setTimeout(function () { btn.textContent = 'Αντιγραφή'; }, 1600);
    }

    // Το navigator.clipboard θέλει ασφαλή σύνδεση ΚΑΙ άδεια του browser.
    // Όταν αρνηθεί, χωρίς το δεύτερο σκέλος ο συντάκτης πατάει και δεν
    // γίνεται απολύτως τίποτα — ούτε μήνυμα. Η εφεδρεία διαλέγει το
    // κείμενο ώστε να μπορεί να το αντιγράψει με Ctrl+C.
    var url = btn.dataset.copy;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url)
        .then(function () { flash('Αντιγράφηκε'); })
        .catch(function () { fallback(); });
    } else {
      fallback();
    }

    function fallback(){
      var box = document.createElement('input');
      box.value = url;
      box.style.cssText = 'position:fixed;top:-100px';
      document.body.appendChild(box);
      box.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      document.body.removeChild(box);
      flash(ok ? 'Αντιγράφηκε' : 'Πάτησε Ctrl+C');
    }
  });
}

// ---------------------------------------------------------------------
// Κατηγορίες — διόρθωση εκεί που η αυτόματη πέφτει έξω
// ---------------------------------------------------------------------
//
// Το site μαντεύει την κατηγορία από λέξεις του τίτλου. Πέφτει έξω
// αρκετά συχνά, και σε 1.368 από τα 4.160 δεν βρίσκει τίποτα.
//
// Την αυτόματη πρόταση ΔΕΝ την υπολογίζουμε εδώ: τη γράφει το build
// στο auto-categories.json. Δύο αντίγραφα της ίδιας λογικής θα
// απέκλιναν, και ο συντάκτης θα διόρθωνε κάτι άλλο από αυτό που
// βλέπει στο site.

var cat = {
  auto: {},        // id -> [κατηγορίες] όπως τις βγάζει το site
  shown: PAGE,
  find: '',
  filter: '',
  openId: null,    // ποια γραμμή είναι ανοιχτή για επεξεργασία
};

// Μόνο δικό μας περιεχόμενο. Οι ειδήσεις παίρνουν κατηγορία από το
// newshub.gr και δεν την αλλάζουμε εμείς.
function catItems(){
  return state.items.filter(function (it) { return it.kind !== 'news'; });
}

function catsOf(id){
  var manual = state.curation.categories && state.curation.categories[id];
  if (manual) return { list: Array.isArray(manual) ? manual : [manual], manual: true };
  return { list: cat.auto[id] || [], manual: false };
}

function drawCats(){
  var box = $('[data-cat-rows]');

  var hits = catItems().filter(function (it) {
    // Η ανοιχτή γραμμή μένει ΠΑΝΤΑ ορατή.
    //
    // Χωρίς αυτό, στο φίλτρο «Χωρίς κατηγορία» η γραμμή εξαφανιζόταν
    // μόλις ο συντάκτης έβαζε την πρώτη κατηγορία — δεν προλάβαινε να
    // βάλει δεύτερη, ούτε να δει τι έκανε.
    if (cat.openId === it.id) return true;

    if (cat.find && flat(it.title + ' ' + it.who).indexOf(cat.find) < 0) return false;

    var c = catsOf(it.id);
    if (cat.filter === 'none') return !c.list.length && !c.manual;
    if (cat.filter === 'fixed') return c.manual;
    if (cat.filter === 'podcast') return it.kind === 'podcast';
    if (cat.filter === 'video') return it.kind === 'video';
    return true;
  });

  $('[data-cat-count]').textContent = hits.length
    ? hits.length.toLocaleString('el') + ' αντικείμενα'
    : '';

  if (!hits.length) {
    box.innerHTML = '<p class="muted">Τίποτα δεν ταιριάζει.</p>';
    $('[data-cat-more]').hidden = true;
    return;
  }

  box.innerHTML = hits.slice(0, cat.shown).map(function (it) {
    var c = catsOf(it.id);
    var open = cat.openId === it.id;

    var chips = c.list.length
      ? c.list.map(function (name) {
        return '<span class="catchip' + (c.manual ? ' catchip--manual' : '') + '">'
          + esc(name) + '</span>';
      }).join('')
      : '<span class="catchip catchip--none">καμία</span>';

    var editor = open
      ? '<div class="catpick">'
        + CATS.map(function (name) {
          var on = c.list.indexOf(name) > -1;
          return '<label class="catopt' + (on ? ' is-on' : '') + '">'
            + '<input type="checkbox" data-cat-set="' + esc(name) + '"' + (on ? ' checked' : '') + '>'
            + esc(name) + '</label>';
        }).join('')
        + (c.manual
          ? '<button type="button" class="btn btn--ghost catreset" data-cat-reset>Πίσω στην αυτόματη</button>'
          : '')
        + '</div>'
      : '';

    return '<div class="catrow' + (open ? ' is-open' : '') + '" data-cid="' + esc(it.id) + '">'
      + '<div class="catrow-head">'
      + (it.image ? '<img src="' + esc(it.image) + '" alt="" loading="lazy">' : '<img alt="">')
      + '<span class="catrow-text">'
      + '<span class="catrow-title">' + esc(it.title) + '</span>'
      + '<span class="catrow-meta">'
      + '<span class="tag tag--' + it.kind + '">' + TAGS[it.kind] + '</span>'
      + (it.who ? esc(it.who) + ' · ' : '') + when(it.date)
      + '</span></span>'
      + '<span class="catrow-cats">' + chips + '</span>'
      + '</div>' + editor + '</div>';
  }).join('');

  $('[data-cat-more]').hidden = hits.length <= cat.shown;
}

function catSet(id, name, on){
  var c = catsOf(id);
  // Η πρώτη αλλαγή ξεκινά από ό,τι δείχνει ΤΩΡΑ το site, όχι από το
  // μηδέν: αλλιώς ο συντάκτης που προσθέτει μία κατηγορία θα έσβηνε
  // άθελά του τη σωστή που είχε βρει το site.
  var list = c.list.slice();

  var at = list.indexOf(name);
  if (on && at < 0) list.push(name);
  if (!on && at > -1) list.splice(at, 1);

  if (!state.curation.categories) state.curation.categories = {};
  state.curation.categories[id] = list;

  drawCats();
  catDirty(true);
}

function catReset(id){
  if (state.curation.categories) delete state.curation.categories[id];
  drawCats();
  catDirty(true);
}

function catDirty(on){
  state.dirty = on;
  $('[data-save="categories"]').disabled = !on;
}

function saveCats(){
  say('Αποθηκεύεται…');
  api('curation', 'PUT', state.curation).then(function () {
    catDirty(false);
    say('Αποθηκεύτηκε. Φαίνεται στο site μόλις ξαναχτιστεί (~2 λεπτά).', 'ok');
  }).catch(function (err) {
    say('Δεν αποθηκεύτηκε: ' + err.message, 'bad');
  });
}

function wireCats(){
  $('[data-cat-rows]').addEventListener('click', function (e) {
    var row = e.target.closest('[data-cid]');
    if (!row) return;
    var id = row.dataset.cid;

    if (e.target.closest('[data-cat-reset]')) { catReset(id); return; }
    if (e.target.closest('.catpick')) return;      // τα κουτάκια τα πιάνει το change

    // Κλικ στη γραμμή: ανοίγει ή κλείνει.
    cat.openId = cat.openId === id ? null : id;
    drawCats();
  });

  $('[data-cat-rows]').addEventListener('change', function (e) {
    var box = e.target.closest('[data-cat-set]');
    var row = e.target.closest('[data-cid]');
    if (!box || !row) return;
    catSet(row.dataset.cid, box.dataset.catSet, box.checked);
  });

  $('[data-cat-find]').addEventListener('input', function (e) {
    cat.find = flat(e.target.value);
    cat.shown = PAGE;
    drawCats();
  });

  $('[data-cat-filter]').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    cat.filter = chip.dataset.cf;
    cat.shown = PAGE;
    $$('[data-cat-filter] .chip').forEach(function (c) { c.classList.toggle('is-on', c === chip); });
    drawCats();
  });

  $('[data-cat-more]').addEventListener('click', function () {
    cat.shown += PAGE;
    drawCats();
  });

  $('[data-save="categories"]').addEventListener('click', saveCats);
}

// Οι αυτόματες προτάσεις. Αν λείπει το αρχείο — πρώτο τρέξιμο πριν
// χτιστεί το site — η καρτέλα δουλεύει, απλώς δείχνει «καμία» παντού.
function loadAutoCats(){
  return fetch('auto-categories.json').then(function (r) {
    return r.ok ? r.json() : {};
  }).catch(function () { return {}; });
}

// ---------------------------------------------------------------------
// Must read — ποια άρθρα του newshub.gr ανοίγουν ΕΔΩ
// ---------------------------------------------------------------------
//
// Τα τέσσερα άρθρα στο κόκκινο πλαίσιο της αρχικής. Από εδώ κρίνεται
// ΚΑΙ πού ανοίγουν: όσα μπουν εδώ παίρνουν δική μας σελίδα με πλήρες
// κείμενο και σύνδεσμο πίσω στο newshub.gr — ρητή οδηγία του
// αφεντικού. Η ροή ειδήσεων στο πλάι δεν επηρεάζεται· εκείνη οδηγεί
// πάντα στο newshub.gr.
//
// Κενό = το site διαλέγει μόνο του τα 4 πιο πρόσφατα, ένα ανά
// κατηγορία. Γι' αυτό οι θέσεις δείχνουν ΠΑΝΤΑ τι θα βγει, είτε το
// διάλεξε άνθρωπος είτε όχι.

// ---------------------------------------------------------------------
// ΤΕΛΕΥΤΑΙΑ — η σειρά της ροής στην αρχική
// ---------------------------------------------------------------------
//
// Η ροή είναι χρονολογική, και μια καλή συνέντευξη πέφτει κάτω σε δύο
// μέρες. Εδώ ο δημοσιογράφος καρφιτσώνει ό,τι αξίζει να μείνει πάνω.
//
// Αντιστοιχεί στο curation.latest και στην pinnedFlow() του build.js.

// Όσες θέσεις δείχνει η ροή πριν το «Όλα τα επεισόδια →».
// Ίδιος αριθμός με το FLOW_VISIBLE στο build.js.
var LATEST_SLOTS = 9;

// Πάνω από τόσες μέρες, το καρφιτσωμένο θεωρείται ξεχασμένο και το
// λέμε. Δεν το σβήνουμε — μπορεί να είναι σκόπιμο. Απλώς δεν αφήνουμε
// κανέναν να ανακαλύψει σε έξι μήνες ότι η αρχική κουβαλάει τον Ιούλιο.
var LATEST_STALE_DAYS = 30;

var lt = {
  shown: PAGE,
  find: '',
  kind: '',
};

function ltList(){
  return (state.curation.latest || []).slice();
}

function daysOld(iso){
  var d = new Date(iso);
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function drawLatest(){
  var box = $('[data-lt-slots]');
  var refs = ltList();

  var rows = refs.map(function (ref) {
    var hit = null;
    for (var i = 0; i < state.items.length; i++) {
      if (isChosen(state.items[i], ref)) { hit = state.items[i]; break; }
    }
    return { ref: ref, item: hit };
  });

  var html = rows.map(function (r, i) {
    var it = r.item;

    if (!it) {
      return '<div class="slot">'
        + '<span class="slot-no">' + String(i + 1).padStart(2, '0') + '</span>'
        + '<img alt=""><div class="slot-text">'
        + '<p class="slot-title">' + esc(r.ref) + '</p>'
        + '<p class="slot-meta">Δεν βρέθηκε — μπορεί να είναι παλιό ή σβησμένο. '
        + 'Το site θα το προσπεράσει.</p></div>'
        // Τα βελάκια μπαίνουν ΚΑΙ εδώ: μια γραμμή που δεν αναγνωρίστηκε
        // πρέπει να μπορεί να μετακινηθεί, αλλιώς μπλοκάρει τη σειρά
        // όλων των από κάτω.
        + '<span class="slot-acts">'
        + '<button type="button" data-lt-up="' + i + '" aria-label="Πάνω"'
        + (i === 0 ? ' disabled' : '') + '>↑</button>'
        + '<button type="button" data-lt-down="' + i + '" aria-label="Κάτω"'
        + (i === refs.length - 1 ? ' disabled' : '') + '>↓</button>'
        + '<button type="button" data-lt-del="' + esc(r.ref) + '" aria-label="Αφαίρεση">✕</button>'
        + '</span></div>';
    }

    var age = daysOld(it.date);
    var note = (it.who ? esc(it.who) + ' · ' : '') + when(it.date);
    if (age !== null && age >= LATEST_STALE_DAYS) {
      note += ' · <strong>' + age + ' μέρες παλιό</strong>';
    }

    // Το πρωτοσέλιδο δεν ξαναμπαίνει στη ροή — θα έβγαινε δύο φορές
    // στην ίδια οθόνη. Αν δεν το πούμε εδώ, ο δημοσιογράφος θα
    // καρφιτσώνει κάτι που δεν εμφανίζεται ποτέ και θα νομίζει ότι
    // χάλασε το διαχειριστικό.
    var isHero = state.curation.featured && isChosen(it, state.curation.featured);
    if (isHero) {
      note += ' · <strong>είναι ήδη το πρωτοσέλιδο, δεν ξαναβγαίνει εδώ</strong>';
    }

    return '<div class="slot">'
      + '<span class="slot-no">' + String(i + 1).padStart(2, '0') + '</span>'
      + (it.image ? '<img src="' + esc(it.image) + '" alt="">' : '<img alt="">')
      + '<div class="slot-text">'
      + '<p class="slot-title">' + esc(it.title) + '</p>'
      + '<p class="slot-meta">'
      + '<span class="tag tag--' + it.kind + '">' + TAGS[it.kind] + '</span>'
      + note + '</p></div>'
      + '<span class="slot-acts">'
      + '<button type="button" data-lt-up="' + i + '" aria-label="Πάνω"'
      + (i === 0 ? ' disabled' : '') + '>↑</button>'
      + '<button type="button" data-lt-down="' + i + '" aria-label="Κάτω"'
      + (i === rows.length - 1 ? ' disabled' : '') + '>↓</button>'
      + '<button type="button" data-lt-del="' + esc(r.ref) + '" aria-label="Αφαίρεση">✕</button>'
      + '</span></div>';
  }).join('');

  // Οι αυτόματες θέσεις ΔΕΝ ζωγραφίζονται μία-μία, επίτηδες.
  //
  // Θα έπρεπε να μαντέψουμε ποια θα διαλέξει το build — και η επιλογή
  // του αγνοεί τα βίντεο που έχουν δίδυμο podcast, κάτι που εδώ δεν το
  // ξέρουμε. Μια πρόβλεψη που πέφτει έξω είναι χειρότερη από καθόλου
  // πρόβλεψη: ο δημοσιογράφος θα έψαχνε γιατί η αρχική «δεν υπακούει».
  var free = Math.max(0, LATEST_SLOTS - rows.length);
  if (free) {
    html += '<div class="slot slot--auto">'
      + '<span class="slot-no">' + String(rows.length + 1).padStart(2, '0')
      + '–' + LATEST_SLOTS + '</span>'
      + '<img alt=""><div class="slot-text">'
      + '<p class="slot-title">' + free + (free === 1 ? ' θέση' : ' θέσεις')
      + ' με τα πιο πρόσφατα</p>'
      + '<p class="slot-meta">Τις γεμίζει το site μόνο του, με σειρά ημερομηνίας.</p>'
      + '</div><span class="slot-acts">'
      + '<span class="pill pill--draft">αυτόματο</span></span></div>';
  }

  box.innerHTML = html;

  var n = rows.length;
  var stale = rows.filter(function (r) {
    var a = r.item && daysOld(r.item.date);
    return a !== null && a >= LATEST_STALE_DAYS;
  }).length;

  var note = n === 0
    ? 'Κανένα καρφιτσωμένο — η ροή δείχνει τα πιο πρόσφατα, όπως πάντα.'
    : n + (n === 1 ? ' καρφιτσωμένο' : ' καρφιτσωμένα') + ' στην κορυφή, με αυτή τη σειρά.';

  if (n > LATEST_SLOTS) {
    note += ' Είναι περισσότερα από τις ' + LATEST_SLOTS
      + ' θέσεις — θα βγουν όλα, η ροή απλώς θα μακρύνει.';
  }
  if (stale) {
    note += ' ' + (stale === 1 ? 'Ένα είναι' : stale + ' είναι')
      + ' πάνω από ' + LATEST_STALE_DAYS + ' ημερών — σκόπιμο ή ξεχασμένο;';
  }

  $('[data-lt-note]').textContent = note;
}

function drawLtPicks(){
  var box = $('[data-lt-picks]');
  var chosen = ltList();

  var hits = state.items.filter(function (it) {
    if (lt.kind && it.kind !== lt.kind) return false;
    if (!lt.find) return true;
    return it.key.indexOf(lt.find) > -1;
  });

  if (!hits.length) {
    box.innerHTML = '<p class="muted">Τίποτα δεν ταιριάζει.</p>';
    $('[data-lt-more]').hidden = true;
    return;
  }

  box.innerHTML = hits.slice(0, lt.shown).map(function (it) {
    var on = chosen.some(function (ref) { return isChosen(it, ref); });
    return '<button type="button" class="pick' + (on ? ' is-on' : '') + '"'
      + ' data-lt-add="' + esc(it.ref) + '">'
      + (it.image ? '<img src="' + esc(it.image) + '" alt="" loading="lazy">' : '<img alt="">')
      + '<span><span class="pick-title">' + esc(it.title) + '</span>'
      + '<span class="pick-meta">'
      + '<span class="tag tag--' + it.kind + '">' + TAGS[it.kind] + '</span>'
      + (it.who ? esc(it.who) + ' · ' : '') + when(it.date)
      + '</span></span></button>';
  }).join('');

  $('[data-lt-more]').hidden = hits.length <= lt.shown;
}

function ltToggle(ref){
  var list = ltList();
  var at = -1;
  list.forEach(function (r, i) { if (r === ref) at = i; });

  if (at > -1) list.splice(at, 1);
  else list.push(ref);

  state.curation.latest = list;
  drawLatest();
  drawLtPicks();
  ltDirty(true);
}

function ltMove(i, step){
  var list = ltList();
  var to = i + step;
  if (i < 0 || i >= list.length || to < 0 || to >= list.length) return;
  var tmp = list[i];
  list[i] = list[to];
  list[to] = tmp;
  state.curation.latest = list;
  drawLatest();
  ltDirty(true);
}

function ltDirty(on){
  state.dirty = on;
  $('[data-save="latest"]').disabled = !on;
}

function saveLatest(){
  say('Αποθηκεύεται…');
  api('curation', 'PUT', state.curation).then(function () {
    ltDirty(false);
    say('Αποθηκεύτηκε. Φαίνεται στο site μόλις ξαναχτιστεί (~2 λεπτά).', 'ok');
  }).catch(function (err) {
    say('Δεν αποθηκεύτηκε: ' + err.message, 'bad');
  });
}

function wireLatest(){
  $('[data-lt-slots]').addEventListener('click', function (e) {
    var del = e.target.closest('[data-lt-del]');
    if (del) { ltToggle(del.dataset.ltDel); return; }

    var up = e.target.closest('[data-lt-up]');
    if (up) { ltMove(Number(up.dataset.ltUp), -1); return; }

    var down = e.target.closest('[data-lt-down]');
    if (down) ltMove(Number(down.dataset.ltDown), 1);
  });

  $('[data-lt-picks]').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-lt-add]');
    if (btn) ltToggle(btn.dataset.ltAdd);
  });

  $('[data-lt-find]').addEventListener('input', function (e) {
    lt.find = flat(e.target.value);
    lt.shown = PAGE;
    drawLtPicks();
  });

  $('[data-lt-kind]').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    lt.kind = chip.dataset.kind;
    lt.shown = PAGE;
    $$('[data-lt-kind] .chip').forEach(function (c) {
      c.classList.toggle('is-on', c === chip);
    });
    drawLtPicks();
  });

  $('[data-lt-more]').addEventListener('click', function () {
    lt.shown += PAGE;
    drawLtPicks();
  });

  $('[data-save="latest"]').addEventListener('click', saveLatest);
}

var MUST = 4;

var mr = {
  shown: PAGE,
  find: '',
};

// Μόνο ειδήσεις: στο κόκκινο πλαίσιο δεν μπαίνει podcast ούτε βίντεο.
function newsItems(){
  return state.items.filter(function (it) { return it.kind === 'news'; });
}

function mrList(){
  return (state.curation.mustRead || []).slice(0, MUST);
}

// Τι θα δείξει η αρχική σε κάθε θέση: πρώτα οι χειροκίνητες επιλογές,
// μετά το αυτόματο γέμισμα. Αντιγράφει τη λογική του pickMustRead στο
// build.js — ένα ανά κατηγορία, για να μη βγουν τέσσερα «Οικονομία».
function mrPreview(){
  var chosen = mrList().map(function (ref) {
    var hit = null;
    newsItems().forEach(function (it) { if (!hit && isChosen(it, ref)) hit = it; });
    return { ref: ref, item: hit, auto: false };
  });

  var taken = {};
  var cats = {};
  chosen.forEach(function (c) {
    if (c.item) { taken[c.item.ref] = true; cats[c.item.who] = true; }
  });

  var pool = newsItems();
  for (var pass = 0; pass < 2 && chosen.length < MUST; pass++) {
    for (var i = 0; i < pool.length && chosen.length < MUST; i++) {
      var it = pool[i];
      if (taken[it.ref]) continue;
      if (pass === 0 && cats[it.who]) continue;   // πρώτο πέρασμα: μία ανά κατηγορία
      taken[it.ref] = true;
      cats[it.who] = true;
      chosen.push({ ref: it.ref, item: it, auto: true });
    }
  }

  return chosen.slice(0, MUST);
}

function drawMustRead(){
  var box = $('[data-mr-slots]');
  var rows = mrPreview();

  box.innerHTML = rows.map(function (r, i) {
    var it = r.item;

    var body = it
      ? (it.image ? '<img src="' + esc(it.image) + '" alt="">' : '<img alt="">')
        + '<div class="slot-text">'
        + '<p class="slot-title">' + esc(it.title) + '</p>'
        + '<p class="slot-meta">' + (it.who ? esc(it.who) + ' · ' : '') + when(it.date) + '</p>'
        + '</div>'
      : '<img alt=""><div class="slot-text"><p class="slot-title">' + esc(r.ref) + '</p>'
        + '<p class="slot-meta">Δεν βρέθηκε — μπορεί να είναι παλιό. Το site θα βάλει άλλο.</p></div>';

    return '<div class="slot' + (r.auto ? ' slot--auto' : '') + '">'
      + '<span class="slot-no">' + String(i + 1).padStart(2, '0') + '</span>'
      + body
      + '<span class="slot-acts">'
      + (r.auto
        ? '<span class="pill pill--draft">αυτόματο</span>'
        : '<button type="button" data-mr-up="' + i + '" aria-label="Πάνω"'
          + (i === 0 ? ' disabled' : '') + '>↑</button>'
          + '<button type="button" data-mr-del="' + esc(r.ref) + '" aria-label="Αφαίρεση">✕</button>')
      + '</span></div>';
  }).join('');

  var n = mrList().length;
  $('[data-mr-note]').textContent = n === 0
    ? 'Καμία χειροκίνητη επιλογή — το site βάζει μόνο του τα 4 πιο πρόσφατα, ένα από κάθε κατηγορία.'
    : n + ' από 4 διαλεγμένα με το χέρι· τις υπόλοιπες θέσεις τις γεμίζει το site.';
}

function drawMrPicks(){
  var box = $('[data-mr-picks]');
  var chosen = mrList();

  var hits = newsItems().filter(function (it) {
    if (!mr.find) return true;
    return flat(it.title + ' ' + it.who).indexOf(mr.find) > -1;
  });

  if (!hits.length) {
    box.innerHTML = '<p class="muted">Τίποτα δεν ταιριάζει.</p>';
    $('[data-mr-more]').hidden = true;
    return;
  }

  box.innerHTML = hits.slice(0, mr.shown).map(function (it) {
    var on = chosen.some(function (ref) { return isChosen(it, ref); });
    return '<button type="button" class="pick' + (on ? ' is-on' : '') + '"'
      + ' data-mr-add="' + esc(it.ref) + '">'
      + (it.image ? '<img src="' + esc(it.image) + '" alt="" loading="lazy">' : '<img alt="">')
      + '<span><span class="pick-title">' + esc(it.title) + '</span>'
      + '<span class="pick-meta">'
      + '<span class="tag tag--news">' + TAGS.news + '</span>'
      + (it.who ? esc(it.who) + ' · ' : '') + when(it.date)
      + '</span></span></button>';
  }).join('');

  $('[data-mr-more]').hidden = hits.length <= mr.shown;
}

function mrToggle(ref){
  var list = (state.curation.mustRead || []).slice();
  var at = -1;
  list.forEach(function (r, i) { if (r === ref) at = i; });

  if (at > -1) {
    list.splice(at, 1);                 // ήταν μέσα — βγαίνει
  } else {
    if (list.length >= MUST) {
      say('Οι τέσσερις θέσεις είναι γεμάτες. Αφαίρεσε μία πρώτα.', 'bad');
      return;
    }
    list.push(ref);
  }

  state.curation.mustRead = list;
  drawMustRead();
  drawMrPicks();
  mrDirty(true);
}

function mrDirty(on){
  state.dirty = on;
  $('[data-save="mustread"]').disabled = !on;
}

function saveMustRead(){
  say('Αποθηκεύεται…');
  api('curation', 'PUT', state.curation).then(function () {
    mrDirty(false);
    say('Αποθηκεύτηκε. Φαίνεται στο site μόλις ξαναχτιστεί (~2 λεπτά).', 'ok');
  }).catch(function (err) {
    say('Δεν αποθηκεύτηκε: ' + err.message, 'bad');
  });
}

function wireMustRead(){
  $('[data-mr-slots]').addEventListener('click', function (e) {
    var del = e.target.closest('[data-mr-del]');
    if (del) { mrToggle(del.dataset.mrDel); return; }

    var up = e.target.closest('[data-mr-up]');
    if (up) {
      var i = Number(up.dataset.mrUp);
      var list = state.curation.mustRead || [];
      if (i <= 0 || i >= list.length) return;
      var tmp = list[i]; list[i] = list[i - 1]; list[i - 1] = tmp;
      drawMustRead();
      mrDirty(true);
    }
  });

  $('[data-mr-picks]').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-mr-add]');
    if (btn) mrToggle(btn.dataset.mrAdd);
  });

  $('[data-mr-find]').addEventListener('input', function (e) {
    mr.find = flat(e.target.value);
    mr.shown = PAGE;
    drawMrPicks();
  });

  $('[data-mr-more]').addEventListener('click', function () {
    mr.shown += PAGE;
    drawMrPicks();
  });

  $('[data-save="mustread"]').addEventListener('click', saveMustRead);
}

// ---------------------------------------------------------------------
// Άρθρα — τα ΔΙΚΑ ΜΑΣ, γραμμένα εδώ
// ---------------------------------------------------------------------
//
// Το κείμενο γράφεται μπλοκ-μπλοκ: κάθε παράγραφος, υπότιτλος,
// φωτογραφία ή ενσωμάτωση είναι ξεχωριστό κουτί.
//
// Γιατί όχι ένας επεξεργαστής σαν του Word: ό,τι επικολληθεί από Word
// κουβαλάει HTML που δεν ελέγχουμε, και θα κατέληγε αυτούσιο στη
// σελίδα. Εδώ ό,τι γράφεται είναι ΚΕΙΜΕΝΟ, και η δομή είναι ρητή —
// αδύνατο να σπάσει η σελίδα, και το build δέχεται το αρχείο όπως
// ακριβώς βγαίνει.

// Οι κατηγορίες του site. Ίδιες με του build — αν αλλάξουν εκεί,
// αλλάζουν κι εδώ.
var CATS = ['Κρήτη', 'Ελλάδα', 'Κόσμος', 'Οικονομία', 'Γεωπολιτική', 'Πολιτική',
  'Υγεία', 'Αθλητικά', 'Agronews', 'Tech-Hub', 'Ιστορία', 'Πολιτισμός',
  'Περιβάλλον', 'Απόψεις'];

var GREEK = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th',
  ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p',
  ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
};

// Η διεύθυνση της σελίδας, από τον τίτλο. Λατινικά: ένα ελληνικό όνομα
// αρχείου ταξιδεύει ως %CF%86%CE%B1… και αρκεί ένα εργαλείο στη μέση
// που δεν το αποκωδικοποιεί για να σπάσει ο σύνδεσμος.
function slugify(s){
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split('').map(function (ch) { return GREEK[ch] || ch; }).join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

// Το <input type="datetime-local"> θέλει «2026-11-04T10:00» σε ΤΟΠΙΚΗ
// ώρα, ενώ εμείς κρατάμε ISO σε UTC. Οι δύο μετατροπές.
function toLocalInput(iso){
  var d = new Date(iso);
  if (isNaN(d)) return '';
  var pad = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

function fromLocalInput(v){
  if (!v) return '';
  var d = new Date(v);
  return isNaN(d) ? '' : d.toISOString();
}

var art = {
  list: [],        // όλα τα άρθρα
  open: null,      // αυτό που συντάσσεται τώρα
  index: -1,       // η θέση του στη list, ή -1 για καινούριο
  dirty: false,
  pending: null,   // πού πάει η φωτογραφία που θα διαλέξει ο επιλογέας
  finding: null,   // ποιο μπλοκ περιμένει επεισόδιο ή βίντεο
  ready: false,    // φόρτωσαν τα άρθρα; πριν από αυτό δεν αγγίζουμε λίστα
};

function artSay(text, kind){
  var el = $('[data-art-state]');
  el.textContent = text || '';
  if (kind) el.setAttribute('data-kind', kind); else el.removeAttribute('data-kind');
}

function artDirty(on){
  art.dirty = on;
  state.dirty = on;      // μπαίνει στην ίδια δικλείδα «μη φύγεις»
  if (on) artSay('Μη αποθηκευμένες αλλαγές', 'warn');

  // Κάθε αλλαγή πάει αμέσως στο αντίγραφο του browser. Δεν κοστίζει
  // τίποτα — ένα άρθρο είναι λίγα κιλομπάιτ — και είναι η διαφορά
  // ανάμεσα στο «ξαναγράψ' το» και στο «να το, συνέχισε».
  if (on) draftSave();
}

// ---- η λίστα ----

function drawArtList(){
  var box = $('[data-art-list]');

  if (!art.list.length) {
    box.innerHTML = '<p class="muted">Κανένα άρθρο ακόμα. Πάτησε «Νέο άρθρο».</p>';
    return;
  }

  // Τα πιο πρόσφατα πρώτα — εκείνα δουλεύει κανείς.
  var rows = art.list.map(function (a, i) {
    return { a: a, i: i };
  }).sort(function (x, y) {
    return new Date(y.a.date || 0) - new Date(x.a.date || 0);
  });

  box.innerHTML = rows.map(function (r) {
    var a = r.a;
    var draft = a.status !== 'published';
    var future = a.date && new Date(a.date) > new Date();

    var tag = draft ? '<span class="pill pill--draft">Πρόχειρο</span>'
      : future ? '<span class="pill pill--later">Προγραμματισμένο</span>'
        : '<span class="pill pill--live">Δημοσιευμένο</span>';

    return '<article class="artrow" data-open="' + r.i + '">'
      + (a.image ? '<img class="artrow-img" src="' + esc(a.image) + '" alt="" loading="lazy">'
        : '<span class="artrow-img artrow-img--empty"></span>')
      + '<span class="artrow-text">'
      + '<span class="artrow-title">' + esc(a.title || '(χωρίς τίτλο)') + '</span>'
      + '<span class="artrow-meta">' + tag
      + (a.category ? ' · ' + esc(a.category) : '')
      + (a.date ? ' · ' + when(a.date) : '')
      + (a.author ? ' · ' + esc(a.author) : '')
      + '</span></span></article>';
  }).join('');
}

// ---- άνοιγμα / κλείσιμο ----

function blankArticle(){
  return {
    id: '', title: '', summary: '', category: CATS[0], author: '',
    date: new Date().toISOString(), image: '', imageCaption: '',
    status: 'draft', body: [{ type: 'p', text: '' }],
  };
}

// ---- αντίγραφο ασφαλείας στον browser ----
//
// Η μόνη αληθινή προστασία του μισογραμμένου άρθρου. Πιάνει ό,τι
// μπορεί να σβήσει τη μνήμη της σελίδας: λήξη συνεδρίας που οδηγεί σε
// ανανέωση, κλείσιμο καρτέλας κατά λάθος, πεσμένο δίκτυο, κολλημένο
// λάπτοπ, διακοπή ρεύματος.
//
// Μένει ΜΟΝΟ σε αυτόν τον browser — δεν φεύγει πουθενά και δεν το
// βλέπει άλλος συντάκτης. Σβήνεται μόλις πετύχει η κανονική
// αποθήκευση, ώστε να μην προτείνει παλιό κείμενο την επόμενη φορά.
var DRAFT = 'newshub-draft';

function draftSave(){
  if (!art.open) return;
  try {
    localStorage.setItem(DRAFT, JSON.stringify({
      at: Date.now(),
      index: art.index,
      article: art.open,
    }));
  } catch (err) {
    // Γεμάτος ή κλειδωμένος αποθηκευτικός χώρος (ιδιωτικό παράθυρο).
    // Δεν είναι λόγος να σταματήσει η σύνταξη — απλώς δεν έχουμε δίχτυ.
  }
}

function draftClear(){
  try { localStorage.removeItem(DRAFT); } catch (err) { /* το ίδιο */ }
}

function draftRead(){
  try {
    var raw = localStorage.getItem(DRAFT);
    if (!raw) return null;
    var d = JSON.parse(raw);
    return d && d.article && d.article.title !== undefined ? d : null;
  } catch (err) {
    return null;
  }
}

// Ρωτάει μία φορά, στο άνοιγμα της καρτέλας Άρθρα.
function draftOffer(){
  // Πριν φορτώσουν τα άρθρα δεν μπορούμε να ανοίξουμε υπάρχον: η
  // art.list είναι ακόμα άδεια και το openArticle θα έσκαγε.
  if (!art.ready) return;

  var d = draftRead();
  if (!d || art.open) return;

  // Το άρθρο που επεξεργαζόταν μπορεί να έχει διαγραφεί στο μεταξύ.
  if (d.index >= 0 && !art.list[d.index]) d.index = -1;

  var name = d.article.title || 'χωρίς τίτλο';
  var mins = Math.round((Date.now() - (d.at || 0)) / 60000);
  var when = mins < 60
    ? 'πριν ' + mins + ' λεπτά'
    : 'πριν ' + Math.round(mins / 60) + ' ώρες';

  var ok = window.confirm(
    'Βρέθηκε άρθρο που δεν προλάβε να αποθηκευτεί:\n\n'
    + '«' + name + '», ' + when + '.\n\n'
    + 'Να το επαναφέρω;'
  );

  if (!ok) { draftClear(); return; }

  openArticle(d.index >= 0 ? d.index : -1);
  art.open = d.article;
  fillArticle();
  artDirty(true);
  artSay('Επαναφέρθηκε. Έλεγξέ το και πάτα Αποθήκευση.', 'warn');
}

function openArticle(i){
  art.index = typeof i === 'number' ? i : -1;
  // Αντίγραφο, όχι το ίδιο αντικείμενο: αν ο συντάκτης φύγει χωρίς
  // αποθήκευση, η λίστα δεν πρέπει να έχει ήδη αλλάξει.
  art.open = art.index >= 0
    ? JSON.parse(JSON.stringify(art.list[art.index]))
    : blankArticle();

  $('[data-art-list]').hidden = true;
  $('[data-new-article]').hidden = true;
  $('[data-art-editor]').hidden = false;
  $('[data-art-delete]').hidden = art.index < 0;

  fillArticle();
  artDirty(false);
  artSay('');
}

// Η φόρμα από το art.open. Ξεχωριστή από το openArticle γιατί τη
// χρειάζεται και η επαναφορά αντιγράφου, που δεν ανοίγει κάτι νέο.
function fillArticle(){
  $('[data-art="title"]').value = art.open.title || '';
  $('[data-art="summary"]').value = art.open.summary || '';
  $('[data-art="category"]').value = art.open.category || CATS[0];
  $('[data-art="author"]').value = art.open.author || '';
  $('[data-art="date"]').value = toLocalInput(art.open.date);
  $('[data-art="status"]').value = art.open.status || 'draft';
  $('[data-art="image"]').value = art.open.image || '';
  $('[data-art="imageCaption"]').value = art.open.imageCaption || '';

  // Τσεκαρισμένο αν αυτό το άρθρο είναι ήδη το μεγάλο της αρχικής.
  $('[data-art-top]').checked =
    !!art.open.id && state.curation.featured === artRef(art.open.id);

  drawSlug();
  drawThumb();
  drawBlocks();
  drawTop();
}

function closeArticle(){
  art.open = null;
  art.index = -1;
  artDirty(false);
  $('[data-art-editor]').hidden = true;
  $('[data-art-list]').hidden = false;
  $('[data-new-article]').hidden = false;
  drawArtList();
}

function drawSlug(){
  var a = art.open;
  var slug = a.id || slugify(a.title);
  $('[data-art-slug]').textContent = slug ? '/arthro/' + slug + '.html' : '—';
}

function drawThumb(){
  var box = $('[data-art-thumb]');
  var url = art.open.image;
  box.hidden = !url;
  if (!url) return;

  var img = box.querySelector('img');
  // Λάθος διαδρομή = σπασμένη εικόνα στο site, με τη λεζάντα να
  // κρέμεται μόνη της. Ο συντάκτης δεν θα το δει ποτέ αν δεν του το
  // πούμε ΕΔΩ: στο διαχειριστικό η εικόνα απλώς δεν εμφανίζεται, και
  // μοιάζει με καθυστέρηση φόρτωσης.
  img.onerror = function () {
    artSay('Η φωτογραφία δεν βρέθηκε: ' + url + ' — διάλεξέ την από τις «Φωτογραφίες».', 'bad');
  };
  img.onload = function () {
    if ($('[data-art-state]').getAttribute('data-kind') === 'bad') artSay('');
  };
  img.src = url;
}

// ---- τα μπλοκ ----

var BLOCK_NAME = {
  p: 'Παράγραφος', h: 'Υπότιτλος', image: 'Φωτογραφία',
  youtube: 'Βίντεο YouTube', episode: 'Επεισόδιο',
};

// Το μπλοκ όπως το κρατάει το αρχείο -> τι είδος κουτί δείχνουμε.
function blockKind(b){
  if (b.type === 'embed') return b.kind === 'episode' ? 'episode' : 'youtube';
  return b.type;
}

function drawBlocks(){
  var box = $('[data-art-blocks]');
  var body = art.open.body || [];

  box.innerHTML = body.map(function (b, i) {
    var kind = blockKind(b);
    var inner;

    if (kind === 'p' || kind === 'h') {
      inner = '<textarea data-bx="text" rows="' + (kind === 'h' ? 1 : 3) + '" placeholder="'
        + (kind === 'h' ? 'Ο υπότιτλος' : 'Γράψε την παράγραφο…') + '">'
        + esc(b.text || '') + '</textarea>';
    } else if (kind === 'image') {
      inner = '<div class="pickline">'
        + '<input type="text" data-bx="src" value="' + esc(b.src || '') + '" placeholder="/uploads/…">'
        + '<button type="button" class="btn btn--ghost" data-bpick="' + i + '">Διάλεξε</button></div>'
        + '<input type="text" data-bx="caption" value="' + esc(b.caption || '') + '" placeholder="Λεζάντα">'
        + (b.src ? '<div class="thumb"><img src="' + esc(b.src) + '" alt=""></div>' : '');
    } else if (kind === 'youtube') {
      inner = '<div class="pickline">'
        + '<input type="text" data-bx="id" value="' + esc(b.id || '') + '" placeholder="Κωδικός ή σύνδεσμος YouTube">'
        + '<button type="button" class="btn btn--ghost" data-bfind="' + i + '" data-bkind="video">Διάλεξε</button></div>'
        + '<p class="hint">Διάλεξε από τα βίντεο του καναλιού, ή κόλλησε σύνδεσμο.</p>';
    } else {
      inner = '<div class="pickline">'
        + '<input type="text" data-bx="id" value="' + esc(b.id || '') + '" placeholder="Buzzsprout-19907711">'
        + '<button type="button" class="btn btn--ghost" data-bfind="' + i + '" data-bkind="podcast">Διάλεξε</button></div>'
        + '<p class="hint">Διάλεξε από τα επεισόδια — ο κωδικός μπαίνει μόνος του.</p>';
    }

    return '<div class="block" data-bi="' + i + '">'
      + '<div class="block-head"><span class="block-kind">' + BLOCK_NAME[kind] + '</span>'
      + '<span class="block-acts">'
      + '<button type="button" data-bmove="-1" aria-label="Πάνω"' + (i === 0 ? ' disabled' : '') + '>↑</button>'
      + '<button type="button" data-bmove="1" aria-label="Κάτω"' + (i === body.length - 1 ? ' disabled' : '') + '>↓</button>'
      + '<button type="button" data-bdel aria-label="Διαγραφή">✕</button>'
      + '</span></div>'
      + '<div class="block-body">' + inner + '</div></div>';
  }).join('');
}

function addBlock(kind){
  var b = kind === 'image' ? { type: 'image', src: '', caption: '' }
    : kind === 'youtube' ? { type: 'embed', kind: 'youtube', id: '' }
      : kind === 'episode' ? { type: 'embed', kind: 'episode', id: '' }
        : { type: kind, text: '' };

  art.open.body.push(b);
  drawBlocks();
  artDirty(true);

  // Ο δρομέας στο καινούριο κουτί: αλλιώς ο συντάκτης πατάει
  // «+ Παράγραφος» και μετά πρέπει να ψάξει πού πήγε.
  var boxes = $$('.block');
  var last = boxes[boxes.length - 1];
  if (last) {
    var f = last.querySelector('textarea, input');
    if (f) f.focus();
    last.scrollIntoView({ block: 'center' });
  }
}

// Από τον σύνδεσμο YouTube κρατάμε ΜΟΝΟ τον κωδικό. Ο συντάκτης
// κολλάει ό,τι του δώσει ο browser — watch?v=, youtu.be/, /embed/ —
// και όλα πρέπει να καταλήγουν στο ίδιο.
function youtubeId(v){
  var s = String(v || '').trim();
  var m = s.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/)([\w-]{6,20})/);
  if (m) return m[1];
  return /^[\w-]{6,20}$/.test(s) ? s : s;
}

// ---- αποθήκευση ----

function collect(){
  var a = art.open;

  a.title = $('[data-art="title"]').value.trim();
  a.summary = $('[data-art="summary"]').value.trim();
  a.category = $('[data-art="category"]').value;
  a.author = $('[data-art="author"]').value.trim();
  a.date = fromLocalInput($('[data-art="date"]').value) || new Date().toISOString();
  a.status = $('[data-art="status"]').value;
  a.image = $('[data-art="image"]').value.trim();
  a.imageCaption = $('[data-art="imageCaption"]').value.trim();

  // Ο κωδικός κλειδώνει στην ΠΡΩΤΗ αποθήκευση και δεν ξανααλλάζει.
  // Αλλιώς μια διόρθωση στον τίτλο θα άλλαζε τη διεύθυνση ενός άρθρου
  // που κυκλοφορεί ήδη — και κάθε σύνδεσμος προς αυτό θα έσπαγε.
  if (!a.id) a.id = slugify(a.title);

  // Τα άδεια μπλοκ φεύγουν. Ο συντάκτης προσθέτει παράγραφο και
  // μετά αλλάζει γνώμη· δεν χρειάζεται να τη σβήσει με το χέρι.
  //
  // ΚΡΙΣΙΜΟ: ο καθαρισμός γίνεται σε ΑΝΤΙΓΡΑΦΟ, όχι πάνω στο art.open.
  //
  // Γράφοντας πίσω στο art.open.body, μια αποθήκευση που κόβεται στον
  // έλεγχο — π.χ. «το άρθρο δεν έχει κείμενο» — έσβηνε τα άδεια μπλοκ
  // από τη μνήμη ενώ αυτά έμεναν στην οθόνη. Ο συντάκτης έγραφε μέσα
  // τους και ο κώδικας έψαχνε body[0], δεν το έβρισκε, και πετούσε
  // σιωπηλά κάθε πλήκτρο. Το άρθρο έδειχνε γεμάτο και αποθηκευόταν
  // άδειο — ή δεν αποθηκευόταν καθόλου, χωρίς εξήγηση.
  var out = JSON.parse(JSON.stringify(a));

  out.body = (a.body || []).filter(function (b) {
    if (b.type === 'p' || b.type === 'h') return String(b.text || '').trim();
    if (b.type === 'image') return String(b.src || '').trim();
    if (b.type === 'embed') return String(b.id || '').trim();
    return false;
  });

  return out;
}

// Η διεύθυνση ενός δικού μας άρθρου, όπως τη γράφει το build.
function artRef(id){ return 'arthro/' + id + '.html'; }

// Δείχνει το κουτάκι μόνο σε δημοσιευμένο άρθρο, και τσεκαρισμένο αν
// αυτό το άρθρο είναι ΗΔΗ το μεγάλο της αρχικής — ώστε να λέει την
// αλήθεια και να μη χρειάζεται ο συντάκτης να πάει να κοιτάξει.
function drawTop(){
  if (!art.open) return;

  var on = $('[data-art="status"]').value === 'published';
  var box = $('[data-art-top]');

  $('[data-art-top-wrap]').hidden = !on;
  if (!on) box.checked = false;

  $('[data-art-top-hint]').hidden = !on || !box.checked;
}

// Κρατάει το πρωτοσέλιδο συμβατό με το άρθρο.
//
// Το κρίσιμο δεν είναι το «βάλ' το»· είναι το ΑΝΤΙΘΕΤΟ. Αν ένα άρθρο
// που είναι μεγάλο στην αρχική γίνει πρόχειρο ή διαγραφεί, η αρχική
// δείχνει σε σελίδα που δεν υπάρχει. Γι' αυτό η συνάρτηση καθαρίζει
// και μόνη της, χωρίς να το ζητήσει κανείς.
function syncFeatured(a, want){
  var ref = artRef(a.id);
  var isNow = state.curation.featured === ref;
  var should = !!want && a.status === 'published';

  if (should === isNow) return Promise.resolve('');

  if (should) {
    state.curation.featured = ref;
    var d = new Date();
    d.setDate(d.getDate() + 7);
    state.curation.featuredUntil = d.toISOString().slice(0, 10);
  } else {
    state.curation.featured = '';
  }

  // Η χειροκίνητη εικόνα ανήκει στην προηγούμενη επιλογή — δες choose().
  state.curation.featuredHero = '';

  return api('curation', 'PUT', state.curation).then(function () {
    $('[data-until]').value = state.curation.featuredUntil || '';
    drawNow();
    drawPicks();
    return should ? ' Μπήκε και στο πρωτοσέλιδο.' : ' Βγήκε από το πρωτοσέλιδο.';
  });
}

function saveArticle(){
  var a = collect();

  if (!a.title) { artSay('Ο τίτλος λείπει.', 'bad'); return; }
  if (!a.id) { artSay('Ο τίτλος δεν δίνει έγκυρη διεύθυνση.', 'bad'); return; }
  if (!a.body.length) { artSay('Το άρθρο δεν έχει κείμενο.', 'bad'); return; }

  // Δύο άρθρα με τον ίδιο κωδικό θα πατούσε το ένα το άλλο.
  var clash = art.list.some(function (other, i) {
    return i !== art.index && other.id === a.id;
  });
  if (clash) { artSay('Υπάρχει ήδη άρθρο με αυτή τη διεύθυνση. Άλλαξε τον τίτλο.', 'bad'); return; }

  if (a.status === 'published' && !a.summary) {
    artSay('Βάλε περίληψη πριν δημοσιεύσεις — φαίνεται στην κάρτα και στη Google.', 'bad');
    return;
  }

  // Το πρωτοσέλιδο ΠΡΕΠΕΙ να έχει εικόνα: χωρίς αυτήν το build αγνοεί
  // την επιλογή και γυρίζει στην αυτόματη, χωρίς να το δει κανείς —
  // ο συντάκτης νομίζει ότι το έβαλε και δεν το έβαλε.
  if ($('[data-art-top]').checked && a.status === 'published' && !a.image) {
    artSay('Το πρωτοσέλιδο θέλει κεντρική φωτογραφία. Βάλε μία ή ξετσέκαρε το κουτάκι.', 'bad');
    return;
  }

  var next = art.list.slice();
  if (art.index >= 0) next[art.index] = a; else next.push(a);

  artSay('Αποθηκεύεται…');
  api('articles', 'PUT', next).then(function () {
    art.list = next;
    art.index = art.index >= 0 ? art.index : next.length - 1;
    // Το άρθρο υπάρχει πια — άρα μπορεί και να διαγραφεί. Χωρίς αυτό,
    // ο συντάκτης έπρεπε να βγει στη λίστα και να το ξανανοίξει.
    $('[data-art-delete]').hidden = false;
    artDirty(false);
    // Σώθηκε αληθινά — το δίχτυ δεν χρειάζεται πια, και αν μείνει θα
    // προτείνει παλιό κείμενο την επόμενη φορά.
    draftClear();
    drawArtList();
    // Η λίστα του πρωτοσέλιδου ξέρει πια το νέο ή αλλαγμένο άρθρο.
    state.items = normalize(state.raw.episodes, state.raw.videos, state.raw.news, art.list);

    return syncFeatured(a, $('[data-art-top]').checked);
  }).then(function (extra) {
    artSay((a.status === 'published'
      ? 'Αποθηκεύτηκε. Φαίνεται στο site μόλις ξαναχτιστεί (~2 λεπτά).'
      : 'Αποθηκεύτηκε ως πρόχειρο.') + (extra || ''), 'ok');
  }).catch(function (err) {
    artSay('Δεν αποθηκεύτηκε: ' + err.message, 'bad');
  });
}

function deleteArticle(){
  if (art.index < 0) return;
  var a = art.list[art.index];
  if (!window.confirm('Να διαγραφεί οριστικά το «' + (a.title || 'χωρίς τίτλο') + '»;')) return;

  var next = art.list.slice();
  next.splice(art.index, 1);

  artSay('Διαγράφεται…');
  api('articles', 'PUT', next).then(function () {
    art.list = next;
    state.items = normalize(state.raw.episodes, state.raw.videos, state.raw.news, art.list);
    // Διαγραμμένο άρθρο δεν γίνεται να μένει μεγάλο στην αρχική: ο
    // σύνδεσμος θα οδηγούσε σε σελίδα που δεν υπάρχει.
    return syncFeatured(a, false);
  }).then(function () {
    artDirty(false);
    draftClear();
    closeArticle();
  }).catch(function (err) {
    artSay('Δεν διαγράφηκε: ' + err.message, 'bad');
  });
}

// ---- επιλογή φωτογραφίας από τη βιβλιοθήκη ----
//
// Ο επιλογέας. Πριν, εδώ υπήρχε μόνο ένα μήνυμα «πήγαινε στις
// Φωτογραφίες και κόλλησε τη διεύθυνση», που πετούσε τον συντάκτη έξω
// από το άρθρο που έγραφε — και η `art.pending` δεν διαβαζόταν ποτέ.
//
// Το target είναι { main: true } για την κεντρική φωτογραφία άρθρου,
// { block: <θέση> } για μπλοκ μέσα στο κείμενο, ή { person: <όνομα> }
// για το πορτρέτο ενός προσώπου.
function pickImage(target){
  art.pending = target;
  sayPick('');
  $('[data-picker]').hidden = false;
  $('[data-pick-find]').value = '';
  lib.find.pick = '';

  // Ανοίγει στη ΣΗΜΕΡΙΝΗ μέρα, όχι στη ρίζα.
  //
  // Όποιος γράφει άρθρο σχεδόν πάντα θέλει κάτι που μόλις ανέβασε. Αν
  // άνοιγε στη ρίζα, κάθε φωτογραφία θα κόστιζε δύο κλικ παραπάνω για
  // να ξαναβρεί το σήμερα. Αν δεν υπάρχει τίποτα σημερινό, η ρίζα
  // είναι η σωστή αφετηρία.
  lib.at.pick = null;
  loadPickShots().then(function () {
    var today = todayYmd();
    if (lib.files.some(function (f) {
      var s = shotStamp(f.name);
      return s && s.ymd === today;
    })) goTo('pick', 'day:' + today);
  });
}

function pickClose(){
  $('[data-picker]').hidden = true;
  art.pending = null;
}

function sayPick(text, kind){
  var el = $('[data-pick-state]');
  if (!text) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = text;
  if (kind) el.setAttribute('data-kind', kind); else el.removeAttribute('data-kind');
}

function applyPick(url){
  var t = art.pending;
  if (!t) { pickClose(); return; }

  // Το πορτρέτο προσώπου ΠΡΙΝ τον έλεγχο του art.open: δεν υπάρχει
  // ανοιχτό άρθρο όταν ο επιλογέας καλείται από την καρτέλα «Πρόσωπα»,
  // και ο παλιός έλεγχος θα έκλεινε το παράθυρο χωρίς να κάνει τίποτα.
  if (t.person) {
    ppSetPhoto(t.person, url);
    pickClose();
    drawPeople();
    return;
  }

  if (!art.open) { pickClose(); return; }

  if (t.main) {
    $('[data-art="image"]').value = url;
    art.open.image = url;
    drawThumb();
  } else {
    var b = art.open.body[t.block];
    if (b) b.src = url;
    drawBlocks();
  }

  artDirty(true);
  pickClose();
}

function pickUpload(files){
  upload(files, {
    say: sayPick,
    after: function (url, done) {
      loadShots();
      loadPickShots();
      // Μία φωτογραφία = σαφής πρόθεση: μπαίνει κατευθείαν. Πολλές
      // μαζί σημαίνει ότι γεμίζει τη βιβλιοθήκη, οπότε διαλέγει μόνος.
      if (done === 1 && url) applyPick(url);
    },
  });
}

// ---- επιλογή επεισοδίου ή βίντεο ----
//
// Τα μπλοκ «Επεισόδιο» και «YouTube» ζητούσαν κωδικό: «Buzzsprout-19907711»
// ή σύνδεσμο. Κανένας δημοσιογράφος δεν τα ξέρει αυτά, και δεν τα βλέπει
// πουθενά στη δουλειά του — το ίδιο λάθος με το παλιό «Διάλεξε» των
// φωτογραφιών: ζητάμε κάτι μηχανικό από άνθρωπο.
//
// Ψάχνει μέσα στο state.items, που είναι ήδη φορτωμένο για το
// πρωτοσέλιδο: 1.027 επεισόδια και 560 βίντεο, χωρίς νέο αίτημα.

var FINDER_MAX = 60;     // όσα δείχνουμε· παραπάνω δεν τα κοιτάζει κανείς

function findItem(target){
  art.finding = target;

  $('[data-finder-title]').textContent =
    target.kind === 'video' ? 'Διάλεξε βίντεο' : 'Διάλεξε επεισόδιο';

  var find = $('[data-finder-find]');
  find.value = '';
  $('[data-finder]').hidden = false;
  drawFinder();
  find.focus();
}

function findClose(){
  $('[data-finder]').hidden = true;
  art.finding = null;
}

function drawFinder(){
  var t = art.finding;
  if (!t) return;

  var box = $('[data-finder-list]');
  var want = flat($('[data-finder-find]').value);

  var hits = state.items.filter(function (it) {
    if (it.kind !== t.kind) return false;
    return !want || it.key.indexOf(want) !== -1;
  });

  if (!hits.length) {
    box.innerHTML = '<p class="muted">Τίποτα δεν ταιριάζει.</p>';
    return;
  }

  box.innerHTML = hits.slice(0, FINDER_MAX).map(function (it) {
    return '<button type="button" class="pick" data-take-id="' + esc(it.id) + '">'
      + (it.image ? '<img src="' + esc(it.image) + '" alt="" loading="lazy">' : '<img alt="">')
      + '<span>'
      + '<span class="pick-title">' + esc(it.title) + '</span>'
      + '<span class="pick-meta">'
      + (it.who ? esc(it.who) + ' · ' : '') + when(it.date)
      + '</span></span></button>';
  }).join('')
    + (hits.length > FINDER_MAX
      ? '<p class="muted">…και άλλα ' + (hits.length - FINDER_MAX)
        + '. Γράψε κάτι για να στενέψει η λίστα.</p>'
      : '');
}

function applyFind(id){
  var t = art.finding;
  if (!t) { findClose(); return; }

  // Δεύτερος πελάτης: η καρτέλα «Ελλείψεις». Ο επιλογέας δεν ξέρει πού
  // πάει η απάντηση — του το λέει αυτός που τον άνοιξε.
  if (t.take) { t.take(id); findClose(); return; }

  if (!art.open) { findClose(); return; }

  var b = art.open.body[t.block];
  if (b) b.id = id;

  drawBlocks();
  artDirty(true);
  findClose();
}

// «Φέρε τα νέα τώρα».
//
// Το ρολόι φέρνει επεισόδια και ειδήσεις κάθε μισή ώρα. Αυτό είναι για
// όταν κάποιος ΞΕΡΕΙ ότι μόλις ανέβηκε κάτι — συνήθως το ανέβασε ο
// ίδιος — και θέλει να γράψει γι' αυτό τώρα.
//
// Δεν περιμένουμε να τελειώσει: η δουλειά γίνεται στο GitHub και
// κρατάει ένα-δυο λεπτά, μαζί με το χτίσιμο. Λέμε τι θα γίνει και
// κλειδώνουμε το κουμπί για λίγο, ώστε να μην το πατήσει δέκα φορές.
function wireRefresh(){
  var btn = $('[data-refresh]');
  if (!btn) return;

  btn.addEventListener('click', function () {
    btn.disabled = true;
    say('Ζητήθηκαν τα νέα…');

    fetch('/api/refresh', { method: 'POST' }).then(readJson, netFail).then(function () {
      say('Ξεκίνησε. Τα νέα επεισόδια και οι ειδήσεις θα φανούν εδώ σε '
        + '1-2 λεπτά — ανανέωσε τη σελίδα τότε.', 'ok');
      // Όσο τρέχει, δεύτερο πάτημα δεν προσθέτει τίποτα.
      setTimeout(function () { btn.disabled = false; }, 90000);
    }).catch(function (err) {
      say('Δεν ξεκίνησε: ' + err.message, 'bad');
      btn.disabled = false;
    });
  });
}

function wireFinder(){
  var box = $('[data-finder]');

  $$('[data-finder-close]').forEach(function (el) {
    el.addEventListener('click', findClose);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !box.hidden) findClose();
  });

  $('[data-finder-find]').addEventListener('input', drawFinder);

  $('[data-finder-list]').addEventListener('click', function (e) {
    var row = e.target.closest('[data-take-id]');
    if (row) applyFind(row.dataset.takeId);
  });
}

function wirePicker(){
  var box = $('[data-picker]');
  var shots = $('[data-pick-shots]');
  var drop = $('[data-pick-drop]');
  var input = $('[data-pick-file]');

  $$('[data-picker-close]').forEach(function (el) {
    el.addEventListener('click', pickClose);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !box.hidden) pickClose();
  });

  shots.addEventListener('click', function (e) {
    // Η διαγραφή πρώτη: το κουμπί κάθεται ΠΑΝΩ στην κάρτα που επιλέγει,
    // και χωρίς αυτό ένα κλικ στο ✕ θα έβαζε κιόλας τη φωτογραφία.
    var del = e.target.closest('[data-del]');
    if (del) { e.stopPropagation(); delShot(del.dataset.del); return; }

    var take = e.target.closest('[data-take]');
    if (take) applyPick(take.dataset.take);
  });

  shots.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var take = e.target.closest('[data-take]');
    if (!take) return;
    e.preventDefault();
    applyPick(take.dataset.take);
  });

  drop.addEventListener('click', function () { input.click(); });
  drop.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });
  input.addEventListener('change', function () {
    pickUpload(input.files);
    input.value = '';
  });

  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
  });
  drop.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files) pickUpload(e.dataTransfer.files);
  });
}

function wireArticles(){
  $('[data-art="category"]').innerHTML = CATS.map(function (c) {
    return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
  }).join('');

  $('[data-new-article]').addEventListener('click', function () { openArticle(-1); });
  $('[data-art-back]').addEventListener('click', function () {
    if (art.dirty && !window.confirm('Υπάρχουν αλλαγές που δεν αποθηκεύτηκαν. Να χαθούν;')) return;
    closeArticle();
  });

  $('[data-art-list]').addEventListener('click', function (e) {
    var row = e.target.closest('[data-open]');
    if (row) openArticle(Number(row.dataset.open));
  });

  $('[data-art-save]').addEventListener('click', saveArticle);
  $('[data-art-delete]').addEventListener('click', deleteArticle);

  // Τα πεδία της κεφαλίδας — ένας listener για όλα.
  $('[data-art-editor]').addEventListener('input', function (e) {
    var f = e.target.closest('[data-art]');
    if (!f) return;
    artDirty(true);
    if (f.dataset.art === 'title') { art.open.title = f.value; drawSlug(); }
    if (f.dataset.art === 'image') { art.open.image = f.value; drawThumb(); }
    // Πρόχειρο δεν μπαίνει στο πρωτοσέλιδο — το κουτάκι κρύβεται.
    if (f.dataset.art === 'status') drawTop();
  });

  $('[data-art-top]').addEventListener('change', function () {
    drawTop();
    artDirty(true);
  });

  // Τα μπλοκ — επίσης ένας listener.
  var blocks = $('[data-art-blocks]');

  blocks.addEventListener('input', function (e) {
    var field = e.target.closest('[data-bx]');
    var box = e.target.closest('[data-bi]');
    if (!field || !box) return;

    var b = art.open.body[Number(box.dataset.bi)];

    // Δικλείδα: αν η οθόνη δείχνει μπλοκ που δεν υπάρχει πια στη μνήμη,
    // το πλήκτρο θα χανόταν αμίλητα. Καλύτερα να το πούμε.
    if (!b) {
      artSay('Κάτι ξεσυγχρονίστηκε. Πάτησε «Πίσω στη λίστα» και ξανάνοιξε το άρθρο.', 'bad');
      return;
    }

    var key = field.dataset.bx;
    b[key] = key === 'id' && blockKind(b) === 'youtube' ? youtubeId(field.value) : field.value;
    artDirty(true);
  });

  blocks.addEventListener('click', function (e) {
    var box = e.target.closest('[data-bi]');
    if (!box) return;
    var i = Number(box.dataset.bi);
    var body = art.open.body;

    var move = e.target.closest('[data-bmove]');
    if (move) {
      var to = i + Number(move.dataset.bmove);
      if (to < 0 || to >= body.length) return;
      var tmp = body[i]; body[i] = body[to]; body[to] = tmp;
      drawBlocks();
      artDirty(true);
      return;
    }

    if (e.target.closest('[data-bdel]')) {
      body.splice(i, 1);
      drawBlocks();
      artDirty(true);
      return;
    }

    var pick = e.target.closest('[data-bpick]');
    if (pick) { pickImage({ block: i }); return; }

    var find = e.target.closest('[data-bfind]');
    if (find) findItem({ block: i, kind: find.dataset.bkind });
  });

  // Όταν φύγει ο δρομέας από το πεδίο — ΟΧΙ σε κάθε πληκτρολόγηση,
  // γιατί θα χανόταν η θέση του δρομέα στη μέση της λέξης.
  blocks.addEventListener('change', function (e) {
    var box = e.target.closest('[data-bi]');
    if (!box) return;
    var b = art.open.body[Number(box.dataset.bi)];
    if (!b) return;

    // Ο σύνδεσμος YouTube γίνεται κωδικός ΚΑΙ στην οθόνη. Χωρίς αυτό ο
    // συντάκτης βλέπει ακόμα ό,τι κόλλησε και νομίζει ότι δεν πιάστηκε.
    if (e.target.dataset.bx === 'id' && blockKind(b) === 'youtube') {
      e.target.value = b.id;
    }

    // Η προεπισκόπηση της φωτογραφίας θέλει ξαναζωγράφισμα.
    if (e.target.dataset.bx === 'src') drawBlocks();
  });

  $$('[data-add]').forEach(function (btn) {
    btn.addEventListener('click', function () { addBlock(btn.dataset.add); });
  });

  $('[data-art-pickimg]').addEventListener('click', function () { pickImage({ main: true }); });
}

// ---------------------------------------------------------------------
// Πρόσωπα — ένας άνθρωπος, ένα όνομα, μία σελίδα
// ---------------------------------------------------------------------
//
// Τα ονόματα δεν τα γράφει κανείς: βγαίνουν από τους τίτλους των
// επεισοδίων («Άγγελος Συρίγος: η Τουρκία…»). Η σύνταξη γράφει άλλοτε
// «Α. Συρίγος» και άλλοτε ολόκληρο, οπότε ο ίδιος άνθρωπος παίρνει δύο
// σελίδες με μοιρασμένα επεισόδια.
//
// Εδώ γίνονται τρία πράγματα, και τα τρία γράφονται στο ΙΔΙΟ αρχείο,
// το people-aliases.json:
//   · ένωση γραφών        -> aliases
//   · «δεν είναι άνθρωπος» -> not_people
//   · ιδιότητα             -> roles
//
// Ποιος είναι ποιος ΔΕΝ το υπολογίζουμε εδώ: το γράφει το build στο
// people.json, μαζί με τις προτάσεις ένωσης. Ίδιος λόγος με τις
// κατηγορίες — δύο αντίγραφα της λογικής θα απέκλιναν.

var pp = {
  list: [],        // τα πρόσωπα όπως τα βλέπει το site
  out: [],         // όσα έχουν σβηστεί ως «δεν είναι άνθρωπος»
  sug: [],         // προτάσεις ένωσης
  file: null,      // το people-aliases.json, όπως θα σωθεί
  shown: PAGE,
  find: '',
  filter: '',
  openName: null,
  mfind: '',       // η αναζήτηση μέσα στο «ένωσε με…»
};

// Το αρχείο μπορεί να μην έχει ακόμα τα κλειδιά που πειράζουμε.
function ppReady(file){
  var f = file && typeof file === 'object' ? file : {};
  if (!f.aliases || typeof f.aliases !== 'object') f.aliases = {};
  if (!f.roles || typeof f.roles !== 'object') f.roles = {};
  if (!f.photos || typeof f.photos !== 'object') f.photos = {};
  if (!Array.isArray(f.not_people)) f.not_people = [];
  if (!Array.isArray(f.not_aliases)) f.not_aliases = [];
  return f;
}

// Οι συγκρίσεις ονομάτων γίνονται ΠΑΝΤΑ με flat(), ποτέ με ===.
//
// Το ίδιο πρόσωπο γράφεται «Αϋφαντής» και «Αυφαντής», και το όνομα που
// δείχνει το people.json είναι η γραφή που κέρδισε — όχι απαραίτητα
// αυτή που είναι γραμμένη στο αρχείο.
function ppSame(a, b){ return flat(a) === flat(b); }

function ppRole(name){
  var keys = Object.keys(pp.file.roles);
  for (var i = 0; i < keys.length; i++) {
    if (ppSame(keys[i], name)) return pp.file.roles[keys[i]];
  }
  return '';
}

function ppIsOut(name){
  return pp.file.not_people.some(function (n) { return ppSame(n, name); });
}

// Το πορτρέτο. Ίδιο μοτίβο με την ιδιότητα — και με τον ίδιο λόγο να
// μη συγκρίνουμε με ===: η γραφή στο αρχείο μπορεί να μην είναι αυτή
// που δείχνει σήμερα το site.
function ppPhoto(name){
  var keys = Object.keys(pp.file.photos);
  for (var i = 0; i < keys.length; i++) {
    if (ppSame(keys[i], name)) return pp.file.photos[keys[i]];
  }
  return '';
}

function ppSetPhoto(name, url){
  Object.keys(pp.file.photos).forEach(function (k) {
    if (ppSame(k, name)) delete pp.file.photos[k];
  });
  if (url) pp.file.photos[name] = url;
  ppDirty(true);
}

// Με ποιον ενώθηκε αυτό το όνομα ΤΩΡΑ, σε αυτή τη συνεδρία. Ό,τι ήταν
// ήδη ενωμένο δεν φτάνει εδώ: το people.json το δίνει ήδη ενωμένο.
function ppMovedTo(name){
  var a = pp.file.aliases;
  var canon = Object.keys(a);
  for (var i = 0; i < canon.length; i++) {
    if (ppSame(canon[i], name)) continue;
    var list = a[canon[i]] || [];
    for (var j = 0; j < list.length; j++) {
      if (ppSame(list[j], name)) return canon[i];
    }
  }
  return '';
}

// ---- οι ενέργειες ----

function ppSetRole(name, text){
  // Σβήνουμε ό,τι υπάρχει με άλλη γραφή, αλλιώς μένουν δύο εγγραφές
  // για τον ίδιο άνθρωπο και κερδίζει όποια θέλει.
  Object.keys(pp.file.roles).forEach(function (k) {
    if (ppSame(k, name)) delete pp.file.roles[k];
  });
  if (text.trim()) pp.file.roles[name] = text.trim();
  ppDirty(true);
}

function ppOut(name){
  if (!ppIsOut(name)) pp.file.not_people.push(name);
  // Ό,τι δεν είναι άνθρωπος δεν έχει ιδιότητα.
  Object.keys(pp.file.roles).forEach(function (k) {
    if (ppSame(k, name)) delete pp.file.roles[k];
  });
  ppDirty(true);
  drawPeople();
}

function ppIn(name){
  pp.file.not_people = pp.file.not_people.filter(function (n) { return !ppSame(n, name); });
  ppDirty(true);
  drawPeople();
}

// Ένωση: ο «from» γίνεται γραφή του «into».
//
// Μαζί του μεταφέρονται και ΟΙ ΔΙΚΕΣ ΤΟΥ γραφές — αλλιώς θα έμεναν
// ορφανές να δείχνουν σε όνομα που δεν έχει πια σελίδα.
function ppMerge(from, into){
  if (ppSame(from, into)) return;

  var list = pp.file.aliases[into] || [];
  var moving = [from];

  Object.keys(pp.file.aliases).forEach(function (k) {
    if (!ppSame(k, from)) return;
    moving = moving.concat(pp.file.aliases[k] || []);
    delete pp.file.aliases[k];
  });

  moving.forEach(function (n) {
    if (ppSame(n, into)) return;
    var have = list.some(function (v) { return ppSame(v, n); });
    if (!have) list.push(n);
  });

  pp.file.aliases[into] = list;

  // Η ιδιότητα ακολουθεί, αν ο άλλος δεν έχει δική του.
  var role = ppRole(from);
  Object.keys(pp.file.roles).forEach(function (k) {
    if (ppSame(k, from)) delete pp.file.roles[k];
  });
  if (role && !ppRole(into)) pp.file.roles[into] = role;

  pp.openName = null;
  pp.mfind = '';
  ppDirty(true);
  drawPeople();
}

// Ξεχωρίζει μία γραφή από τον άνθρωπο στον οποίο έχει ενωθεί.
function ppSplit(canonical, variant){
  Object.keys(pp.file.aliases).forEach(function (k) {
    if (!ppSame(k, canonical)) return;
    pp.file.aliases[k] = (pp.file.aliases[k] || []).filter(function (v) {
      return !ppSame(v, variant);
    });
    if (!pp.file.aliases[k].length) delete pp.file.aliases[k];
  });
  ppDirty(true);
  drawPeople();
}

// «Όχι, άλλος άνθρωπος». Γράφεται, ώστε η πρόταση να μην ξαναέρθει
// στο επόμενο build — αλλιώς ο συντάκτης θα την απορρίπτει για πάντα.
function ppNotAlias(canonical, other){
  pp.file.not_aliases.push([canonical, other]);
  ppDirty(true);
  drawPeople();
}

function ppDirty(on){
  state.dirty = on;
  $('[data-save="people"]').disabled = !on;
}

function savePeople(){
  say('Αποθηκεύεται…');
  api('people-aliases', 'PUT', pp.file).then(function () {
    ppDirty(false);
    say('Αποθηκεύτηκε. Οι σελίδες ενώνονται μόλις ξαναχτιστεί το site (~2 λεπτά).', 'ok');
  }).catch(function (err) {
    say('Δεν αποθηκεύτηκε: ' + err.message, 'bad');
  });
}

// ---- η λίστα ----

// Αρχικά του ονόματος, όταν δεν υπάρχει φωτογραφία. Πορτρέτα δεν
// έχουμε για κανέναν· η εικόνα είναι το εξώφυλλο του επεισοδίου.
// Το πορτρέτο πρώτο, η αφίσα του επεισοδίου ΠΟΤΕ.
//
// Εδώ στο διαχειριστικό έδειχνε το p.image — το εξώφυλλο του επεισοδίου
// — και φαινόταν σαν να έχει ήδη φωτογραφία κάθε πρόσωπο. Έτσι κανείς
// δεν θα καταλάβαινε ποιανού λείπει. Τώρα: είτε αληθινό πορτρέτο, είτε
// αρχικά, όπως ακριβώς βγαίνει και στο site.
function ppFace(p){
  if (p.photo) return '<img src="' + esc(p.photo) + '" alt="" loading="lazy">';
  var bits = String(p.name).split(/\s+/).filter(Boolean).slice(0, 2)
    .map(function (w) { return w.charAt(0); }).join('');
  return '<span class="pface">' + esc(bits) + '</span>';
}

function ppAll(){
  var rows = pp.list.map(function (p) {
    var moved = ppMovedTo(p.name);
    return {
      name: p.name,
      n: p.n,
      last: p.last,
      image: p.image,
      photo: ppPhoto(p.name),
      writings: p.writings || [],
      role: ppRole(p.name),
      isOut: ppIsOut(p.name),
      moved: moved,
    };
  });

  // Τα σβησμένα δεν υπάρχουν στο people.json ως πρόσωπα — έρχονται
  // χωριστά, ώστε να μπορεί ο συντάκτης να πάρει πίσω ένα λάθος.
  pp.out.forEach(function (r) {
    rows.push({
      name: r.name, n: r.n, last: '', image: '',
      writings: [], role: '', isOut: ppIsOut(r.name), moved: '',
    });
  });

  return rows;
}

function drawPeople(){
  var box = $('[data-pp-rows]');

  if (pp.filter === 'suggest') { drawSuggest(box); return; }

  var hits = ppAll().filter(function (p) {
    if (pp.openName && ppSame(pp.openName, p.name)) return true;
    if (pp.find && flat(p.name).indexOf(pp.find) < 0) return false;

    if (pp.filter === 'out') return p.isOut;
    if (p.isOut) return false;
    if (pp.filter === 'role') return !p.role && !p.moved;
    if (pp.filter === 'many') return p.writings.length > 1;
    return true;
  });

  $('[data-pp-count]').textContent = hits.length
    ? hits.length.toLocaleString('el') + ' πρόσωπα'
    : '';

  if (!hits.length) {
    box.innerHTML = '<p class="muted">Τίποτα δεν ταιριάζει.</p>';
    $('[data-pp-more]').hidden = true;
    return;
  }

  box.innerHTML = hits.slice(0, pp.shown).map(ppRow).join('');
  $('[data-pp-more]').hidden = hits.length <= pp.shown;
}

function ppRow(p){
  var open = pp.openName && ppSame(pp.openName, p.name);

  var flags = '';
  if (p.moved) {
    flags += '<span class="pchip pchip--move">ενώνεται με ' + esc(p.moved) + '</span>';
  }
  if (p.isOut) flags += '<span class="pchip pchip--out">δεν είναι άνθρωπος</span>';
  if (p.writings.length > 1) {
    flags += '<span class="pchip">' + p.writings.length + ' γραφές</span>';
  }

  var meta = [
    p.n ? (p.n === 1 ? '1 εμφάνιση' : p.n.toLocaleString('el') + ' εμφανίσεις') : '',
    p.last ? 'τελευταία ' + when(p.last) : '',
  ].filter(Boolean).join(' · ');

  return '<div class="prow' + (open ? ' is-open' : '')
    + (p.isOut || p.moved ? ' is-pale' : '') + '" data-pname="' + esc(p.name) + '">'
    + '<div class="prow-head">'
    + ppFace(p)
    + '<span class="prow-text">'
    + '<span class="prow-name">' + esc(p.name) + '</span>'
    + (p.role ? '<span class="prow-role">' + esc(p.role) + '</span>' : '')
    + '<span class="prow-meta">' + meta + '</span>'
    + '</span>'
    + '<span class="prow-flags">' + flags + '</span>'
    + '</div>'
    + (open ? ppEditor(p) : '')
    + '</div>';
}

function ppEditor(p){
  var out = '<div class="pedit">';

  if (!p.isOut) {
    out += '<div class="pfield">'
      + '<span>Φωτογραφία — στη σελίδα του, στη λίστα προσώπων και στην αρχική</span>'
      + '<div class="pphoto">'
      + (p.photo
        ? '<img class="pphoto-pic" src="' + esc(p.photo) + '" alt="">'
        : '<span class="pphoto-none">χωρίς φωτογραφία — βγαίνουν τα αρχικά</span>')
      + '<span class="pphoto-acts">'
      + '<button type="button" class="btn btn--ghost" data-pp-pic>'
      + (p.photo ? 'Άλλαξέ τη' : 'Διάλεξε φωτογραφία') + '</button>'
      + (p.photo
        ? '<button type="button" class="btn btn--ghost" data-pp-pic-off>Αφαίρεσέ τη</button>'
        : '')
      + '</span></div></div>';

    out += '<label class="pfield">'
      + '<span>Ιδιότητα — φαίνεται κάτω από το όνομα στη σελίδα του</span>'
      + '<input type="text" data-pp-role value="' + esc(p.role) + '"'
      + ' placeholder="π.χ. καθηγητής διεθνών σχέσεων στο Πάντειο">'
      + '</label>';
  }

  if (p.writings.length > 1) {
    out += '<div class="pfield"><span>Γραφές που έχουν ενωθεί σε αυτόν</span>'
      + '<div class="pwrit">'
      + p.writings.map(function (w) {
        if (ppSame(w, p.name)) {
          return '<span class="pchip pchip--main">' + esc(w) + '</span>';
        }
        return '<span class="pchip">' + esc(w)
          + '<button type="button" class="pchip-x" data-pp-split="' + esc(w) + '"'
          + ' title="Ξεχώρισέ το">×</button></span>';
      }).join('')
      + '</div></div>';
  }

  if (!p.isOut) {
    out += '<div class="pfield"><span>Είναι ο ίδιος με κάποιον άλλο;</span>'
      + '<input type="search" class="find" data-pp-mfind value="' + esc(pp.mfind) + '"'
      + ' placeholder="Γράψε το σωστό του όνομα…">'
      + '<div class="pmhits">' + ppMergeHits(p) + '</div>'
      + '</div>';
  }

  out += '<div class="pacts">';
  if (p.isOut) {
    out += '<button type="button" class="btn btn--ghost" data-pp-in>Είναι άνθρωπος</button>';
  } else {
    out += '<button type="button" class="btn btn--ghost" data-pp-out>Δεν είναι άνθρωπος</button>';
  }
  out += '</div></div>';

  return out;
}

// Σε ποιον μπορεί να ενωθεί. Χωρίς αναζήτηση δεν δείχνουμε τίποτα: 373
// ονόματα σε λίστα δεν βοηθούν κανέναν.
function ppMergeHits(p){
  if (!pp.mfind) return '<p class="muted">Γράψε δύο γράμματα.</p>';

  var hits = pp.list.filter(function (o) {
    if (ppSame(o.name, p.name)) return false;
    if (ppIsOut(o.name)) return false;
    return flat(o.name).indexOf(pp.mfind) > -1;
  }).slice(0, 6);

  if (!hits.length) return '<p class="muted">Κανένα όνομα δεν ταιριάζει.</p>';

  return hits.map(function (o) {
    return '<button type="button" class="pmhit" data-pp-into="' + esc(o.name) + '">'
      + '<span>' + esc(o.name) + '</span>'
      + '<em>' + (o.n === 1 ? '1 εμφάνιση' : o.n + ' εμφανίσεις') + '</em>'
      + '</button>';
  }).join('');
}

// ---- οι προτάσεις ----

function drawSuggest(box){
  // Ό,τι έχει απαντηθεί σε αυτή τη συνεδρία φεύγει αμέσως: η ένωση
  // φαίνεται στα aliases, η απόρριψη στα not_aliases.
  var live = [];
  pp.sug.forEach(function (f) {
    f.others.forEach(function (o) {
      var merged = ppMovedTo(o.name);
      if (merged && ppSame(merged, f.canonical)) return;
      var said = pp.file.not_aliases.some(function (pair) {
        if (!Array.isArray(pair) || pair.length < 2) return false;
        return ppSame(pair[0], f.canonical) && ppSame(pair[1], o.name);
      });
      if (said) return;
      live.push({ canonical: f.canonical, cn: f.cn, other: o.name, on: o.n });
    });
  });

  $('[data-pp-count]').textContent = live.length
    ? live.length.toLocaleString('el') + ' προτάσεις'
    : '';
  $('[data-pp-more]').hidden = true;

  if (!live.length) {
    box.innerHTML = '<p class="muted">Καμία πρόταση — όλα έχουν απαντηθεί.</p>';
    return;
  }

  box.innerHTML = '<p class="hint">Το site υποπτεύεται ότι είναι ο ίδιος άνθρωπος. '
    + 'ΔΕΝ ενώνει τίποτα μόνο του: δύο αδέρφια με το ίδιο επώνυμο μοιάζουν ίδια '
    + 'σε κάθε αυτόματο έλεγχο.</p>'
    + live.map(function (s) {
      return '<div class="psug" data-pcanon="' + esc(s.canonical) + '"'
        + ' data-pother="' + esc(s.other) + '">'
        + '<div class="psug-pair">'
        + '<span class="psug-keep">' + esc(s.canonical)
        + '<em>' + s.cn + '</em></span>'
        + '<span class="psug-arrow">←</span>'
        + '<span class="psug-drop">' + esc(s.other) + '<em>' + s.on + '</em></span>'
        + '</div>'
        + '<div class="pacts">'
        + '<button type="button" class="btn" data-pp-yes>Ο ίδιος — ένωσέ τους</button>'
        + '<button type="button" class="btn btn--ghost" data-pp-no>Άλλος άνθρωπος</button>'
        + '</div></div>';
    }).join('');
}

function wirePeople(){
  var rows = $('[data-pp-rows]');

  rows.addEventListener('click', function (e) {
    // Οι προτάσεις πρώτα: έχουν δικά τους κουμπιά.
    var sug = e.target.closest('[data-pcanon]');
    if (sug) {
      var canon = sug.dataset.pcanon;
      var other = sug.dataset.pother;
      if (e.target.closest('[data-pp-yes]')) ppMerge(other, canon);
      if (e.target.closest('[data-pp-no]')) ppNotAlias(canon, other);
      return;
    }

    var row = e.target.closest('[data-pname]');
    if (!row) return;
    var name = row.dataset.pname;

    var into = e.target.closest('[data-pp-into]');
    if (into) { ppMerge(name, into.dataset.ppInto); return; }

    var split = e.target.closest('[data-pp-split]');
    if (split) { ppSplit(name, split.dataset.ppSplit); return; }

    if (e.target.closest('[data-pp-out]')) { ppOut(name); return; }
    if (e.target.closest('[data-pp-in]')) { ppIn(name); return; }

    // Ο ΙΔΙΟΣ επιλογέας που έχουν τα άρθρα: φάκελοι, αναζήτηση, ★
    // στάνταρ, και ανέβασμα νέας με σύρσιμο. Κανένα νέο εργαλείο.
    if (e.target.closest('[data-pp-pic]')) { pickImage({ person: name }); return; }
    if (e.target.closest('[data-pp-pic-off]')) {
      ppSetPhoto(name, '');
      drawPeople();
      return;
    }

    // Κλικ μέσα στον επεξεργαστή δεν κλείνει τη γραμμή — αλλιώς δεν
    // μπορείς να πατήσεις μέσα στο κουτί της ιδιότητας.
    if (e.target.closest('.pedit')) return;

    pp.openName = pp.openName && ppSame(pp.openName, name) ? null : name;
    pp.mfind = '';
    drawPeople();
  });

  // Η ιδιότητα γράφεται ΧΩΡΙΣ ξαναζωγράφισμα: αλλιώς χάνεται ο δρομέας
  // στο πρώτο γράμμα.
  rows.addEventListener('input', function (e) {
    var row = e.target.closest('[data-pname]');
    if (!row) return;

    if (e.target.matches('[data-pp-role]')) {
      ppSetRole(row.dataset.pname, e.target.value);
      return;
    }

    if (e.target.matches('[data-pp-mfind]')) {
      pp.mfind = flat(e.target.value);
      // Μόνο η λίστα αποτελεσμάτων, για τον ίδιο λόγο.
      var p = ppAll().filter(function (x) { return ppSame(x.name, row.dataset.pname); })[0];
      if (p) $('.pmhits', row).innerHTML = ppMergeHits(p);
    }
  });

  $('[data-pp-find]').addEventListener('input', function (e) {
    pp.find = flat(e.target.value);
    pp.shown = PAGE;
    drawPeople();
  });

  $('[data-pp-filter]').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    pp.filter = chip.dataset.pf;
    pp.shown = PAGE;
    pp.openName = null;
    $$('[data-pp-filter] .chip').forEach(function (c) { c.classList.toggle('is-on', c === chip); });
    drawPeople();
  });

  $('[data-pp-more]').addEventListener('click', function () {
    pp.shown += PAGE;
    drawPeople();
  });

  $('[data-save="people"]').addEventListener('click', savePeople);
}

// Η απογραφή προσώπων. Αν λείπει το αρχείο — πρώτο τρέξιμο πριν χτιστεί
// το site — η καρτέλα δουλεύει, απλώς είναι άδεια.
function loadPeople(){
  return fetch('people.json').then(function (r) {
    return r.ok ? r.json() : null;
  }).catch(function () { return null; });
}

// ---------------------------------------------------------------------
// Εκπομπές
// ---------------------------------------------------------------------
//
// Δύο αρχεία, γιατί έχουν διαφορετική προέλευση και ρυθμό:
//
//   shows.json     περιγραφή και playlist — κείμενο που γράφει η σύνταξη
//   show-art.json  ποια αφίσα ανήκει σε ποια εκπομπή
//
// Το ΟΝΟΜΑ της εκπομπής είναι το κλειδί και στα δύο, και έρχεται από το
// YouTube. Δεν αλλάζει από εδώ: πάνω του δένουν τα επεισόδια, και μια
// μετονομασία θα άδειαζε σιωπηλά τη σελίδα της εκπομπής.

var sh = {
  shows: {},     // ό,τι λέει το shows.json
  art: null,     // ΟΛΟΚΛΗΡΟ το show-art.json, με τα σχόλιά του
  files: [],     // τα διαθέσιμα αρχεία αφίσας
  dirty: false,
};

function shSay(text, kind){
  var el = $('[data-sh-state]');
  el.textContent = text || '';
  if (kind) el.setAttribute('data-kind', kind); else el.removeAttribute('data-kind');
}

function shDirty(on){
  sh.dirty = on;
  state.dirty = on;
  $('[data-save="shows"]').disabled = !on;
  if (on) shSay('Μη αποθηκευμένες αλλαγές', 'warn');
}

function shReady(shows, art){
  sh.shows = shows && typeof shows === 'object' ? shows : {};
  sh.art = art && typeof art === 'object' ? art : {};
  if (!sh.art.art || typeof sh.art.art !== 'object') sh.art.art = {};

  // Οι διαθέσιμες αφίσες: όσες χρησιμοποιούνται ήδη. Καινούρια δεν
  // ανεβαίνει από εδώ — θέλει τρία μεγέθη που τα φτιάχνει το
  // make-shows.js από τα πρωτότυπα του σχεδιαστή.
  var seen = {};
  Object.keys(sh.art.art).forEach(function (name) {
    var f = sh.art.art[name] && sh.art.art[name].file;
    if (f) seen[f] = true;
  });
  sh.files = Object.keys(seen).sort();
}

function drawShows(){
  var box = $('[data-showlist]');
  var names = Object.keys(sh.shows).sort(function (a, b) { return a.localeCompare(b, 'el'); });

  if (!names.length) {
    box.innerHTML = '<p class="muted">Καμία εκπομπή.</p>';
    return;
  }

  box.innerHTML = names.map(function (name) {
    var s = sh.shows[name] || {};
    var a = sh.art.art[name] || {};
    var file = a.file || '';

    var options = ['<option value="">— καμία —</option>']
      .concat(sh.files.map(function (f) {
        return '<option value="' + esc(f) + '"' + (f === file ? ' selected' : '') + '>'
          + esc(f) + '</option>';
      })).join('');

    return '<article class="show" data-show="' + esc(name) + '">'
      + '<header class="show-head">'
      + '<h2 class="show-name">' + esc(name) + '</h2>'
      + (file
        ? '<img class="show-art" src="/shows/' + esc(file) + '-400.webp" alt="" loading="lazy">'
        : '<span class="show-noart">χωρίς αφίσα</span>')
      + '</header>'

      + '<div class="field">'
      + '<label>Περιγραφή</label>'
      + '<textarea rows="3" data-sh="description" placeholder="Τι είναι αυτή η εκπομπή…">'
      + esc(s.description || '') + '</textarea>'
      + '</div>'

      + '<div class="pair">'
      + '<div class="field"><label>Playlist YouTube</label>'
      + '<input type="text" data-sh="playlist" value="' + esc(s.playlist || '') + '" placeholder="PL…"></div>'
      + '<div class="field"><label>Αφίσα</label>'
      + '<select data-sh="file">' + options + '</select></div>'
      + '</div>'

      // Η επεξήγηση μπαίνει ΜΙΑ φορά στην κορυφή της καρτέλας: εδώ θα
      // επαναλαμβανόταν δεκαπέντε φορές και θα έπνιγε τα πεδία.
      + '<label class="check">'
      + '<input type="checkbox" data-sh="titled"' + (a.titled ? ' checked' : '') + '>'
      + '<span>Ο τίτλος είναι ήδη ψημένος μέσα στην εικόνα</span>'
      + '</label>'
      + '</article>';
  }).join('');
}

function wireShows(){
  var box = $('[data-showlist]');

  box.addEventListener('input', function (e) {
    var f = e.target.closest('[data-sh]');
    var card = e.target.closest('[data-show]');
    if (!f || !card) return;

    var name = card.dataset.show;
    var key = f.dataset.sh;

    if (key === 'description' || key === 'playlist') {
      if (!sh.shows[name]) sh.shows[name] = {};
      sh.shows[name][key] = f.value;
    }

    shDirty(true);
  });

  // Τα select και τα checkbox δεν βγάζουν «input» παντού.
  box.addEventListener('change', function (e) {
    var f = e.target.closest('[data-sh]');
    var card = e.target.closest('[data-show]');
    if (!f || !card) return;

    var name = card.dataset.show;
    var key = f.dataset.sh;

    if (key === 'file') {
      if (!f.value) delete sh.art.art[name];
      else {
        if (!sh.art.art[name]) sh.art.art[name] = { file: '', titled: false };
        sh.art.art[name].file = f.value;
      }
      drawShows();        // για να ανανεωθεί η μικρογραφία
    }

    if (key === 'titled') {
      if (!sh.art.art[name]) sh.art.art[name] = { file: '', titled: false };
      sh.art.art[name].titled = f.checked;
    }

    shDirty(true);
  });

  $('[data-save="shows"]').addEventListener('click', saveShows);
}

function saveShows(){
  var btn = $('[data-save="shows"]');
  btn.disabled = true;
  shSay('Αποθηκεύεται…');

  // Δύο αρχεία, δύο αποθηκεύσεις. Σειριακά και όχι παράλληλα: αν το
  // δεύτερο αποτύχει, θέλουμε να ξέρουμε ότι το πρώτο πέρασε.
  api('shows', 'PUT', sh.shows)
    .then(function () { return api('show-art', 'PUT', sh.art); })
    .then(function () {
      shDirty(false);
      shSay('Αποθηκεύτηκε. Φαίνεται στο site μόλις ξαναχτιστεί (~2 λεπτά).', 'ok');
    })
    .catch(function (err) {
      btn.disabled = false;
      shSay('Δεν αποθηκεύτηκε: ' + err.message, 'bad');
    });
}

// ---------------------------------------------------------------------
// Ελλείψεις — βίντεο και καλεσμένοι που δεν βρέθηκαν μόνα τους
// ---------------------------------------------------------------------
//
// Δύο ευρετήρια φτιάχνονται μόνα τους και αστοχούν σιωπηλά:
//
//   βίντεο      δένει με το επεισόδιο ΜΟΝΟ αν ταιριάζει ο τίτλος
//   καλεσμένος  βγαίνει ΜΟΝΟ από το «Όνομα: θέμα» του τίτλου
//
// Όταν αστοχήσουν δεν σπάει τίποτα — λείπει. Το επεισόδιο βγαίνει χωρίς
// βίντεο, ο άνθρωπος δεν αποκτά σελίδα, και κανένα σφάλμα δεν το λέει.
//
// Η λίστα εδώ ΔΕΝ υπολογίζεται στη διεπαφή: τη γράφει το build.js στο
// admin/pairs-todo.json, γιατί μόνο εκείνο ξέρει τους κανόνες. Αντίγραφο
// εδώ θα απέκλινε, και ο συντάκτης θα διόρθωνε φαντάσματα.
//
// Η απάντηση σώζεται στο data/pairs.json και κερδίζει πάντα το αυτόματο.

var PR_PAGE = 20;

var pr = {
  file: null,    // το data/pairs.json, όπως θα σωθεί
  rows: [],      // η απογραφή από το build
  filter: '',
  find: '',
  shown: PR_PAGE,
};

function prReady(file){
  var f = (file && typeof file === 'object' && !Array.isArray(file)) ? file : {};
  if (!f.pairs || typeof f.pairs !== 'object' || Array.isArray(f.pairs)) f.pairs = {};
  return f;
}

function prRec(id){ return pr.file.pairs[id] || {}; }

// Τι ισχύει ΤΕΛΙΚΑ για μια γραμμή: η χειροκίνητη απάντηση πρώτη, μετά
// το αυτόματο. Ίδια σειρά με το build.js — αλλιώς η καρτέλα θα έδειχνε
// άλλα από όσα βγαίνουν στο site.
function prNow(r){
  var rec = prRec(r.id);
  return {
    video: rec.novideo ? '' : (rec.video || r.video),
    guest: rec.noguest ? '' : (rec.guest || r.guest),
    byHand: !!(rec.video || rec.guest || rec.novideo || rec.noguest),
    rec: rec,
  };
}

function prSet(id, patch){
  var rec = pr.file.pairs[id] || {};
  Object.keys(patch).forEach(function (k) { rec[k] = patch[k]; });

  // Ό,τι έμεινε κενό ή ψεύτικο φεύγει. Το αρχείο το διαβάζει και
  // άνθρωπος· μισοάδειες εγγραφές δεν λένε τίποτα.
  Object.keys(rec).forEach(function (k) { if (!rec[k]) delete rec[k]; });

  if (Object.keys(rec).length) pr.file.pairs[id] = rec;
  else delete pr.file.pairs[id];

  prDirty(true);
}

function prDirty(on){
  state.dirty = on;
  $('[data-save="pairs"]').disabled = !on;
}

function savePairs(){
  say('Αποθηκεύεται…');
  api('pairs', 'PUT', pr.file).then(function () {
    prDirty(false);
    say('Αποθηκεύτηκε. Τα βίντεο και οι καλεσμένοι δένουν μόλις '
      + 'ξαναχτιστεί το site (~2 λεπτά).', 'ok');
  }).catch(function (err) {
    say('Δεν αποθηκεύτηκε: ' + err.message, 'bad');
  });
}

// ---- η λίστα ----

// Ο τίτλος ενός βίντεο από τον κωδικό του. Τα βίντεο είναι ήδη
// φορτωμένα για το πρωτοσέλιδο, οπότε δεν κατεβαίνει τίποτα.
function prVideoTitle(id){
  for (var i = 0; i < state.items.length; i++) {
    if (state.items[i].kind === 'video' && state.items[i].id === id) {
      return state.items[i].title;
    }
  }
  return id;
}

function prHits(){
  return pr.rows.filter(function (r) {
    if (pr.find && flat(r.title).indexOf(pr.find) < 0) return false;

    var now = prNow(r);
    if (pr.filter === 'done') return now.byHand;
    // Τα δηλωμένα «δεν υπάρχει» φεύγουν από τις ελλείψεις: γι' αυτό
    // μπήκαν — για να στραγγίζει η λίστα αντί να ρωτάει για πάντα.
    if (pr.filter === 'video') return !now.video && !now.rec.novideo;
    if (pr.filter === 'guest') return !now.guest && !now.rec.noguest;
    return true;
  });
}

function drawPairs(){
  var box = $('[data-pr-rows]');
  var hits = prHits();

  var nv = 0, ng = 0, nd = 0;
  pr.rows.forEach(function (r) {
    var now = prNow(r);
    if (!now.video && !now.rec.novideo) nv++;
    if (!now.guest && !now.rec.noguest) ng++;
    if (now.byHand) nd++;
  });

  $('[data-pr-count]').textContent = nv + ' χωρίς βίντεο · '
    + ng + ' χωρίς καλεσμένο · ' + nd + ' διορθωμένα με το χέρι';

  if (!hits.length) {
    box.innerHTML = '<p class="muted">Τίποτα εδώ. '
      + (pr.filter ? 'Δοκίμασε άλλο φίλτρο.' : 'Όλα δεμένα.') + '</p>';
    $('[data-pr-more]').hidden = true;
    return;
  }

  box.innerHTML = hits.slice(0, pr.shown).map(prRow).join('');

  var more = $('[data-pr-more]');
  more.hidden = hits.length <= pr.shown;
  more.textContent = 'Δείξε περισσότερα (' + (hits.length - pr.shown) + ')';
}

function prRow(r){
  var now = prNow(r);
  var rec = now.rec;

  // ---- η γραμμή του βίντεο ----
  var vid;
  if (rec.novideo) {
    vid = '<span class="pair-no">Δεν υπάρχει βίντεο</span>'
      + '<button type="button" class="btn btn--tiny" data-pr-undo-video>Αναίρεση</button>';
  } else if (rec.video) {
    vid = '<span class="pair-ok">' + esc(prVideoTitle(rec.video)) + '</span>'
      + '<button type="button" class="btn btn--tiny" data-pr-pick>Αλλαγή</button>'
      + '<button type="button" class="btn btn--tiny" data-pr-undo-video>Καθάρισε</button>';
  } else if (r.video) {
    vid = '<span class="pair-auto">αυτόματο: ' + esc(r.vtitle || r.video) + '</span>'
      + '<button type="button" class="btn btn--tiny" data-pr-pick>Άλλο</button>';
  } else {
    vid = '<span class="pair-gap">λείπει</span>'
      + '<button type="button" class="btn btn--tiny btn--pick" data-pr-pick>Διάλεξε βίντεο</button>'
      + '<button type="button" class="btn btn--tiny" data-pr-novideo>Δεν υπάρχει</button>';
  }

  // ---- η γραμμή του καλεσμένου ----
  var guest;
  if (rec.noguest) {
    guest = '<span class="pair-no">Δεν υπάρχει καλεσμένος</span>'
      + '<button type="button" class="btn btn--tiny" data-pr-undo-guest>Αναίρεση</button>';
  } else {
    // Πάντα πεδίο, όχι κουμπί: το όνομα γράφεται, δεν διαλέγεται. Όταν
    // ο αυτόματος βρήκε κάτι, μπαίνει ως υπόδειξη μέσα στο πεδίο —
    // έτσι φαίνεται τι θα ισχύσει αν ο συντάκτης δεν γράψει τίποτα.
    guest = '<input type="text" class="pair-name" data-pr-guest'
      + ' value="' + esc(rec.guest || '') + '"'
      + ' placeholder="' + esc(r.guest || 'Όνομα καλεσμένου') + '"'
      + ' aria-label="Καλεσμένος">'
      + (r.guest && !rec.guest
        ? '<span class="pair-auto">αυτόματο</span>'
        : '<button type="button" class="btn btn--tiny" data-pr-noguest>Δεν υπάρχει</button>');
  }

  return '<div class="pair-row" data-pr-id="' + esc(r.id) + '">'
    + (r.image
      ? '<img class="pair-shot" src="' + esc(r.image) + '" alt="" loading="lazy">'
      : '<span class="pair-shot"></span>')
    + '<div class="pair-body">'
    + '<p class="pair-title">' + esc(r.title) + '</p>'
    + '<p class="pair-date">' + when(r.date) + '</p>'
    + '<div class="pair-line"><span class="pair-what">Βίντεο</span>' + vid + '</div>'
    + '<div class="pair-line"><span class="pair-what">Καλεσμένος</span>' + guest + '</div>'
    + '</div></div>';
}

function wirePairs(){
  $('[data-save="pairs"]').addEventListener('click', savePairs);

  $('[data-pr-find]').addEventListener('input', function (e) {
    pr.find = flat(e.target.value);
    pr.shown = PR_PAGE;
    drawPairs();
  });

  $('[data-pr-filter]').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    pr.filter = chip.dataset.prf;
    pr.shown = PR_PAGE;
    $$('[data-pr-filter] .chip').forEach(function (c) {
      c.classList.toggle('is-on', c === chip);
    });
    drawPairs();
  });

  $('[data-pr-more]').addEventListener('click', function () {
    pr.shown += PR_PAGE;
    drawPairs();
  });

  var box = $('[data-pr-rows]');

  box.addEventListener('click', function (e) {
    var row = e.target.closest('[data-pr-id]');
    if (!row) return;
    var id = row.dataset.prId;

    if (e.target.closest('[data-pr-pick]')) {
      // Ο ίδιος επιλογέας που χρησιμοποιούν τα άρθρα — ψάχνει στα βίντεο
      // που είναι ήδη φορτωμένα.
      findItem({ kind: 'video', take: function (vid) {
        prSet(id, { video: vid, novideo: false });
        drawPairs();
      } });
      return;
    }

    if (e.target.closest('[data-pr-novideo]')) {
      prSet(id, { novideo: true, video: '' });
      drawPairs();
      return;
    }
    if (e.target.closest('[data-pr-undo-video]')) {
      prSet(id, { novideo: false, video: '' });
      drawPairs();
      return;
    }
    if (e.target.closest('[data-pr-noguest]')) {
      prSet(id, { noguest: true, guest: '' });
      drawPairs();
      return;
    }
    if (e.target.closest('[data-pr-undo-guest]')) {
      prSet(id, { noguest: false, guest: '' });
      drawPairs();
    }
  });

  // «change» και όχι «input»: με κάθε πάτημα πλήκτρου θα ξανασχεδιαζόταν
  // η λίστα και το πεδίο θα έχανε την εστίαση στο πρώτο γράμμα.
  box.addEventListener('change', function (e) {
    if (!e.target.matches('[data-pr-guest]')) return;
    var row = e.target.closest('[data-pr-id]');
    if (!row) return;
    prSet(row.dataset.prId, { guest: e.target.value.trim(), noguest: false });
    drawPairs();
  });
}

// Η απογραφή είναι παραγόμενη, δεν περνάει από το /api/data: το build
// τη γράφει δίπλα στα αρχεία του διαχειριστικού. Ίδιο μοτίβο με το
// people.json και το auto-categories.json.
// no-store: το αρχείο είναι στατικό όπως όλα τα άλλα, άρα το Cloudflare
// το κρατά τέσσερις ώρες. Μετά την αποθήκευση η λίστα θα έδειχνε ως
// ελλείψεις γραμμές που έχουν ήδη διορθωθεί — το site σωστό, η καρτέλα
// ψεύτικη. Εδώ ζητάμε ρητά φρέσκο.
function loadPairsTodo(){
  return fetch('pairs-todo.json', { cache: 'no-store' }).then(function (r) {
    return r.ok ? r.json() : {};
  }, function () { return {}; });
}

// ---------------------------------------------------------------------
// Σύνδεση
// ---------------------------------------------------------------------

function wire(){
  // Καρτέλες
  $$('.tab').forEach(function (tab) {
    tab.addEventListener('click', function (e) {
      e.preventDefault();
      $$('.tab').forEach(function (t) { t.classList.toggle('is-on', t === tab); });
      var name = tab.dataset.tab;
      $$('.panel').forEach(function (p) { p.classList.toggle('is-on', p.dataset.panel === name); });
      location.hash = name;
      // Το δίχτυ προτείνεται εδώ και όχι στη φόρτωση: ερώτηση που
      // σκάει μόλις ανοίξει η σελίδα, σε όποια καρτέλα κι αν πήγαινε
      // ο συντάκτης, είναι ενοχλητική.
      if (name === 'arthra') draftOffer();
    });
  });

  // Επιλογή — ένας listener για όλη τη λίστα, όχι ένας ανά κάρτα.
  $('[data-picks]').addEventListener('click', function (e) {
    var pick = e.target.closest('.pick');
    if (pick) choose(pick.dataset.ref);
  });

  $('[data-find]').addEventListener('input', function (e) {
    state.find = flat(e.target.value);
    state.shown = PAGE;
    drawPicks();
  });

  $('[data-kind-filter]').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    state.kind = chip.dataset.kind;
    state.shown = PAGE;
    // Σκοπευμένο στη ΔΙΚΗ του ομάδα: το σκέτο '.chip' έσβηνε το «is-on»
    // από τα φίλτρα των άλλων καρτελών, που έμεναν ενεργά στην πράξη.
    $$('[data-kind-filter] .chip').forEach(function (c) {
      c.classList.toggle('is-on', c === chip);
    });
    drawPicks();
  });

  $('[data-more]').addEventListener('click', function () {
    state.shown += PAGE;
    drawPicks();
  });

  $('[data-until]').addEventListener('change', function (e) {
    state.curation.featuredUntil = e.target.value;
    markDirty(true);
  });

  $('[data-save="curation"]').addEventListener('click', save);

  wireShots();
  wireRefresh();
  wirePicker();
  wireFinder();
  wireArticles();
  wireShows();
  wireLatest();
  wireMustRead();
  wireCats();
  wirePeople();
  wirePairs();

  // Δικλείδα: φεύγει η σελίδα με αναλλοίωτη δουλειά μέσα.
  window.addEventListener('beforeunload', function (e) {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
}

function boot(){
  wire();

  if (location.hash) {
    var tab = $('.tab[data-tab="' + location.hash.slice(1) + '"]');
    if (tab) tab.click();
  }

  Promise.all([
    api('curation'),
    api('episodes'),
    api('videos'),
    api('news'),
    api('articles'),
    loadAutoCats(),
    api('people-aliases'),
    loadPeople(),
    api('shows'),
    api('show-art'),
    api('pairs'),
    loadPairsTodo(),
    // ΑΝΕΚΤΙΚΟ: οι φωτογραφίες-στάνταρ είναι στολίδι μπροστά στο
    // υπόλοιπο διαχειριστικό. Μέσα σε Promise.all, μια αποτυχία εδώ
    // ρίχνει ΟΛΑ τα άλλα και ο συντάκτης βλέπει άδεια σελίδα — μου
    // συνέβη με διακομιστή που δεν είχε ξαναξεκινήσει μετά την
    // προσθήκη του αρχείου. Χωρίς σήμανση δουλεύουμε· χωρίς άρθρα όχι.
    api('photos').catch(function () { return null; }),
  ]).then(function (r) {
    // Το αρχείο μπορεί να μην υπάρχει ακόμα — τότε το API δίνει null.
    var photos = r[12] && typeof r[12] === 'object' ? r[12] : {};
    lib.standard = Array.isArray(photos.standard) ? photos.standard : [];
    lib.rest = {};
    Object.keys(photos).forEach(function (k) {
      if (k !== 'standard') lib.rest[k] = photos[k];
    });
    state.curation = r[0] || {};
    cat.auto = r[5] || {};
    // Το αρχείο δεν υπάρχει μέχρι να γραφτεί το πρώτο άρθρο — τότε το
    // API επιστρέφει null, όχι σφάλμα.
    art.list = Array.isArray(r[4]) ? r[4] : [];
    // Μετά τα άρθρα: η λίστα του πρωτοσέλιδου τα περιλαμβάνει.
    state.raw = { episodes: r[1], videos: r[2], news: r[3] };
    state.items = normalize(r[1], r[2], r[3], art.list);

    pp.file = ppReady(r[6]);
    var census = r[7] || {};
    pp.list = Array.isArray(census.people) ? census.people : [];
    pp.out = Array.isArray(census.rejected) ? census.rejected : [];
    pp.sug = Array.isArray(census.suggest) ? census.suggest : [];

    shReady(r[8], r[9]);

    pr.file = prReady(r[10]);
    pr.rows = Array.isArray(r[11] && r[11].rows) ? r[11].rows : [];

    $('[data-until]').value = state.curation.featuredUntil || '';
    drawNow();
    drawPicks();
    drawArtList();
    drawLatest();
    drawLtPicks();
    drawMustRead();
    drawMrPicks();
    drawCats();
    drawPeople();
    drawShows();
    drawPairs();
    loadShots();
    say('');

    // Από εδώ και πέρα η λίστα άρθρων είναι αληθινή, οπότε το δίχτυ
    // μπορεί να προταθεί. Αν ο συντάκτης ήρθε κατευθείαν στα Άρθρα —
    // π.χ. ανανέωσε ενώ έγραφε — ρωτάμε αμέσως.
    art.ready = true;
    if (location.hash === '#arthra') draftOffer();
  }).catch(function (err) {
    say('Δεν φόρτωσαν τα δεδομένα: ' + err.message, 'bad');
  });
}

boot();
