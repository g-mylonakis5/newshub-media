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

function api(name, method, body){
  return fetch('/api/data/' + name, {
    method: method || 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).then(function (res) {
    return res.json().then(function (data) {
      if (!res.ok) throw new Error(data && data.error ? data.error : 'Σφάλμα ' + res.status);
      return data;
    });
  });
}

// ---------------------------------------------------------------------
// Τα διαθέσιμα κομμάτια περιεχομένου
// ---------------------------------------------------------------------

// Ενώνουμε επεισόδια, βίντεο και ειδήσεις σε ΜΙΑ λίστα με κοινή μορφή.
// Ο συντάκτης δεν θέλει να σκεφτεί «σε ποια καρτέλα είναι αυτό που
// ψάχνω» — θέλει να γράψει δυο λέξεις και να το βρει.
function normalize(episodes, videos, news){
  var out = [];

  (episodes || []).forEach(function (e) {
    out.push({
      kind: 'podcast',
      id: e.id,
      // Ο κωδικός είναι ό,τι καταλαβαίνει το build — δες sameItem().
      ref: e.id,
      title: e.headline || e.title || '',
      who: e.guest || '',
      image: e.image || '',
      date: e.date,
    });
  });

  (videos || []).forEach(function (v) {
    out.push({
      kind: 'video',
      id: v.id,
      ref: v.url || v.id,
      title: v.title || '',
      who: v.show || '',
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
      title: a.title || '',
      who: a.category || '',
      image: a.image_large || a.image_thumb || '',
      date: a.date,
    });
  });

  out.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });

  // Το κλειδί αναζήτησης υπολογίζεται ΜΙΑ φορά: αλλιώς το flat() θα
  // έτρεχε πάνω σε 4.800 εγγραφές σε κάθε πάτημα πλήκτρου.
  out.forEach(function (it) { it.key = flat(it.title + ' ' + it.who); });

  return out;
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
  var w = String(want).trim().toLowerCase();
  if (!w) return false;
  if (String(it.id).toLowerCase() === w) return true;
  if (it.ref && String(it.ref).toLowerCase() === w) return true;
  // Τελευταία ευκαιρία: μόνο το τελευταίο κομμάτι της διεύθυνσης.
  var tail = w.replace(/[?#].*$/, '').split('/').pop();
  return tail && String(it.ref || '').toLowerCase().indexOf(tail) !== -1;
}

// ---------------------------------------------------------------------
// Ζωγραφική
// ---------------------------------------------------------------------

var TAGS = { podcast: 'Podcast', video: 'Βίντεο', news: 'Είδηση' };

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

function upload(files){
  var list = Array.prototype.slice.call(files).filter(function (f) {
    return /^image\//.test(f.type);
  });
  if (!list.length) { sayUpload('Μόνο φωτογραφίες.', 'bad'); return; }

  var done = 0;
  var failed = [];

  // Μία-μία και όχι όλες μαζί: σε αδύναμο σήμα, δέκα παράλληλα
  // ανεβάσματα μπλοκάρουν το ένα το άλλο και κόβονται όλα μαζί.
  function next(i){
    if (i >= list.length) {
      sayUpload(
        failed.length
          ? done + ' ανέβηκαν, ' + failed.length + ' απέτυχαν: ' + failed.join(', ')
          : (done === 1 ? 'Η φωτογραφία ανέβηκε.' : done + ' φωτογραφίες ανέβηκαν.'),
        failed.length ? 'bad' : 'ok'
      );
      loadShots();
      return;
    }

    var file = list[i];
    sayUpload('Ανεβαίνει ' + (i + 1) + ' από ' + list.length + '…');

    shrink(file).then(function (blob) {
      return fetch('/api/images', {
        method: 'POST',
        headers: {
          'Content-Type': 'image/jpeg',
          'X-File-Name': encodeURIComponent(file.name),
        },
        body: blob,
      });
    }).then(function (res) {
      return res.json().then(function (d) {
        if (!res.ok) throw new Error(d.error || 'σφάλμα');
        done++;
      });
    }).catch(function (err) {
      failed.push(file.name + ' (' + err.message + ')');
    }).then(function () {
      next(i + 1);
    });
  }

  next(0);
}

function loadShots(){
  var box = $('[data-shots]');

  fetch('/api/images').then(function (r) { return r.json(); }).then(function (files) {
    if (!files.length) {
      box.innerHTML = '<p class="muted">Καμία φωτογραφία ακόμα.</p>';
      return;
    }
    box.innerHTML = files.map(function (f) {
      // Το αποθηκευμένο όνομα ξεκινά με χρονοσφραγίδα 14 ψηφίων. Δείχνοντάς
      // τη, η λεζάντα κοβόταν στο «20261103102706…» και δύο φωτογραφίες
      // της ίδιας μέρας ήταν αδιάκριτες. Σπάμε τα δύο μέρη: η ημερομηνία
      // μικρή, το όνομα ολόκληρο.
      var m = f.name.match(/^(\d{8})(\d{6})-(.+)\.\w+$/);
      var label = m ? m[3].replace(/-/g, ' ') : f.name;
      var day = m ? m[1].slice(6, 8) + '/' + m[1].slice(4, 6) : '';

      return '<figure class="shot">'
        + '<img src="' + esc(f.url) + '" alt="" loading="lazy">'
        + '<button type="button" class="shot-copy" data-copy="' + esc(f.url) + '">Αντιγραφή</button>'
        + '<figcaption class="shot-name" title="' + esc(f.name) + '">'
        + (day ? '<span class="shot-day">' + day + '</span> ' : '')
        + esc(label) + '</figcaption>'
        + '</figure>';
    }).join('');
  }).catch(function (err) {
    box.innerHTML = '<p class="muted">Δεν φόρτωσαν: ' + esc(err.message) + '</p>';
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

  $('[data-shots]').addEventListener('click', function (e) {
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

  $('[data-art="title"]').value = art.open.title || '';
  $('[data-art="summary"]').value = art.open.summary || '';
  $('[data-art="category"]').value = art.open.category || CATS[0];
  $('[data-art="author"]').value = art.open.author || '';
  $('[data-art="date"]').value = toLocalInput(art.open.date);
  $('[data-art="status"]').value = art.open.status || 'draft';
  $('[data-art="image"]').value = art.open.image || '';
  $('[data-art="imageCaption"]').value = art.open.imageCaption || '';

  drawSlug();
  drawThumb();
  drawBlocks();
  artDirty(false);
  artSay('');
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
      inner = '<input type="text" data-bx="id" value="' + esc(b.id || '') + '" placeholder="Κωδικός ή σύνδεσμος YouTube">'
        + '<p class="hint">Κόλλησε τον σύνδεσμο — κρατάμε μόνο τον κωδικό.</p>';
    } else {
      inner = '<input type="text" data-bx="id" value="' + esc(b.id || '') + '" placeholder="Buzzsprout-19907711">'
        + '<p class="hint">Ο κωδικός του επεισοδίου, όπως στο πρωτοσέλιδο.</p>';
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
  a.body = (a.body || []).filter(function (b) {
    if (b.type === 'p' || b.type === 'h') return String(b.text || '').trim();
    if (b.type === 'image') return String(b.src || '').trim();
    if (b.type === 'embed') return String(b.id || '').trim();
    return false;
  });

  return a;
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
    artSay(a.status === 'published'
      ? 'Αποθηκεύτηκε. Φαίνεται στο site μόλις ξαναχτιστεί (~2 λεπτά).'
      : 'Αποθηκεύτηκε ως πρόχειρο.', 'ok');
    drawArtList();
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
    artDirty(false);
    closeArticle();
  }).catch(function (err) {
    artSay('Δεν διαγράφηκε: ' + err.message, 'bad');
  });
}

// ---- επιλογή φωτογραφίας από τη βιβλιοθήκη ----
//
// Αντί για δεύτερο παράθυρο: στέλνουμε τον συντάκτη στην καρτέλα
// «Φωτογραφίες», όπου κάθε φωτογραφία έχει ήδη κουμπί αντιγραφής.
function pickImage(target){
  artSay('Πήγαινε στις «Φωτογραφίες», πάτησε «Αντιγραφή» και κόλλησέ το εδώ.', 'warn');
  var tab = $('.tab[data-tab="fotos"]');
  if (tab) tab.click();
  art.pending = target;
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
  });

  // Τα μπλοκ — επίσης ένας listener.
  var blocks = $('[data-art-blocks]');

  blocks.addEventListener('input', function (e) {
    var field = e.target.closest('[data-bx]');
    var box = e.target.closest('[data-bi]');
    if (!field || !box) return;

    var b = art.open.body[Number(box.dataset.bi)];
    if (!b) return;

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
    if (pick) pickImage({ block: i });
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
    $$('.chip').forEach(function (c) { c.classList.toggle('is-on', c === chip); });
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
  wireArticles();

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
  ]).then(function (r) {
    state.curation = r[0] || {};
    state.items = normalize(r[1], r[2], r[3]);
    // Το αρχείο δεν υπάρχει μέχρι να γραφτεί το πρώτο άρθρο — τότε το
    // API επιστρέφει null, όχι σφάλμα.
    art.list = Array.isArray(r[4]) ? r[4] : [];
    $('[data-until]').value = state.curation.featuredUntil || '';
    drawNow();
    drawPicks();
    drawArtList();
    loadShots();
    say('');
  }).catch(function (err) {
    say('Δεν φόρτωσαν τα δεδομένα: ' + err.message, 'bad');
  });
}

boot();
