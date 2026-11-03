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
  ]).then(function (r) {
    state.curation = r[0] || {};
    state.items = normalize(r[1], r[2], r[3]);
    $('[data-until]').value = state.curation.featuredUntil || '';
    drawNow();
    drawPicks();
    loadShots();
    say('');
  }).catch(function (err) {
    say('Δεν φόρτωσαν τα δεδομένα: ' + err.message, 'bad');
  });
}

boot();
