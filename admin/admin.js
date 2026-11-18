
'use strict';

// How many we show at once. There are 1,094 episodes and 3,823 videos:
// all of them on screen would hang the browser.
var PAGE = 24;

var state = {
  curation: null,
  items: [],        // everything available, merged and sorted
  // The sources as they arrived. Kept so the list above can be rebuilt
  // when an article changes, without re-downloading 5 MB.
  raw: { episodes: [], videos: [], news: [] },
  // The homepage flow as the last build left it — see ltFlow().
  flow: null,
  shown: PAGE,
  find: '',
  kind: '',
  dirty: false,
};

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

function $(sel, root){ return (root || document).querySelector(sel); }
function $$(sel, root){ return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

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

// For search: drops accents and punctuation, so "Συριγος" finds
// "Συρίγος".
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

// The status message. Journalists come from a tool where saving is
// instant; without a clear message they will press the button again.
var stateEl = $('[data-state]');

function say(text, kind){
  if (!text) { stateEl.hidden = true; return; }
  stateEl.hidden = false;
  stateEl.textContent = text;
  if (kind) stateEl.setAttribute('data-kind', kind);
  else stateEl.removeAttribute('data-kind');
}

var LOST = 'Η σύνδεσή σου έληξε ή χάθηκε το δίκτυο. '
  + 'ΜΗΝ ανανεώσεις τη σελίδα — το κείμενό σου είναι εδώ. '
  + 'Άνοιξε το διαχειριστικό σε ΝΕΑ καρτέλα, συνδέσου, '
  + 'γύρνα εδώ και ξαναπάτα Αποθήκευση.';

// Is what came back actually JSON? If not, someone else answered — almost
// always the Access sign-in page.
function readJson(res){
  var type = res.headers.get('Content-Type') || '';
  if (type.indexOf('json') === -1) throw new Error(LOST);

  return res.json().then(function (data) {
    if (!res.ok) throw new Error(data && data.error ? data.error : 'Σφάλμα ' + res.status);
    return data;
  });
}

// fetch rejects ONLY on a network failure or a blocked redirect — never
// for a 404 or a 500. So what lands here is exactly "the request never
// left".
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
// Available content
// ---------------------------------------------------------------------

// Episodes, videos and news merged into ONE list with a common shape. The
// editor does not want to think about which tab something is in — they
// want to type two words and find it.
function normalize(episodes, videos, news, articles){
  var out = [];

  (episodes || []).forEach(function (e) {
    out.push({
      kind: 'podcast',
      id: e.id,
      // The id is what the build understands — see sameItem().
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
      ref: v.id,
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
      // For news the build accepts the newshub.gr URL.
      ref: a.url,
      title: unent(a.title),
      who: unent(a.category),
      image: a.image_large || a.image_thumb || '',
      date: a.date,
    });
  });

  (articles || []).forEach(function (a) {
    if (a.status !== 'published') return;
    out.push({
      kind: 'article',
      id: a.id,
      // What the build understands for one of our articles — see sameItem().
      ref: 'arthro/' + a.id + '.html',
      title: unent(a.title),
      who: unent(a.category),
      image: a.image || '',
      date: a.date,
    });
  });

  out.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });

  var once = [];
  var seenId = {};
  out.forEach(function (it) {
    var key = it.kind + ':' + it.id;
    if (seenId[key]) return;
    seenId[key] = true;
    once.push(it);
  });

  // The search key is computed ONCE: otherwise flat() would run over 4,800
  // entries on every keystroke.
  once.forEach(function (it) { it.key = flat(it.title + ' ' + it.who); });

  return once;
}

function matches(it){
  if (state.kind && it.kind !== state.kind) return false;
  if (!state.find) return true;
  return it.key.indexOf(state.find) !== -1;
}

// Does this item match what curation says? The same loose logic as
// build.js: accepts an id or a URL.
function isChosen(it, want){
  if (!want) return false;

  // Same stripping as strip() in sameItem() in build.js.
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

  var num = id.replace(/^buzzsprout-/, '');
  return !!num && (t === num || t.indexOf(num + '-') === 0);
}

// The reverse: which item hides behind an id or link in curation. The same
// lookup used to be written out by hand in three places.
function findItemByRef(ref){
  for (var i = 0; i < state.items.length; i++) {
    if (isChosen(state.items[i], ref)) return state.items[i];
  }
  return null;
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

var TAGS ={ podcast: 'Podcast', video: 'Βίντεο', news: 'Είδηση', article: 'Άρθρο' };

var PROTO_VATHOS = 5;

function heroIstoria(){
  if (!Array.isArray(state.curation.featuredPrev)) state.curation.featuredPrev = [];
  return state.curation.featuredPrev;
}

function metaApo(meres){
  var d = new Date();
  d.setDate(d.getDate() + meres);
  return d.toISOString().slice(0, 10);
}

function heroPush(ref, hero){
  if (!ref) return;
  var ist = heroIstoria().filter(function (p) { return p && p.ref !== ref; });
  ist.unshift({ ref: ref, hero: hero || '' });
  state.curation.featuredPrev = ist.slice(0, PROTO_VATHOS);
}

// The most recent history entry that STILL exists. An article turned back
// to draft or deleted is not a candidate: we would point the homepage at
// a page that is not there.
function heroPrevIndex(){
  var ist = heroIstoria();
  for (var i = 0; i < ist.length; i++) {
    if (ist[i] && ist[i].ref && findItemByRef(ist[i].ref)) return i;
  }
  return -1;
}

function heroPrev(){
  var i = heroPrevIndex();
  return i === -1 ? null : heroIstoria()[i];
}

function heroRestore(){
  var i = heroPrevIndex();
  if (i === -1) return null;

  var prev = heroIstoria()[i];
  state.curation.featuredPrev = heroIstoria().slice(i + 1);
  state.curation.featured = prev.ref;
  state.curation.featuredHero = prev.hero || '';
  state.curation.featuredUntil = metaApo(7);
  return prev;
}

function heroTitlos(prev){
  if (!prev) return '';
  var it = findItemByRef(prev.ref);
  return it ? it.title : prev.ref;
}

function nowActs(){
  var prev = heroPrev();
  var out = '';

  if (state.curation.featured) {
    out += '<button type="button" class="btn btn--ghost now-auto" data-auto>'
      + (prev ? 'Βγάλε το — πίσω στο προηγούμενο' : 'Πίσω στο αυτόματο') + '</button>'
      + '<button type="button" class="btn btn--ghost now-auto" data-newest>'
      + 'Βάλε το πιο πρόσφατο</button>';
  } else if (prev) {
    out += '<button type="button" class="btn btn--ghost now-auto" data-auto>'
      + 'Βάλε πίσω το προηγούμενο</button>';
  }

  if (!out) return '';

  // The name goes ON screen, not only in the message after the click: if
  // you cannot see what will come back, the button is a lottery.
  if (prev) out += '<p class="now-prev">Προηγούμενο: ' + esc(heroTitlos(prev)) + '</p>';

  return '<div class="now-acts">' + out + '</div>';
}

function drawNow(){
  var box = $('[data-now-body]');
  var want = state.curation && state.curation.featured;

  if (!want) {
    box.innerHTML = '<p class="muted">Καμία χειροκίνητη επιλογή — το site βάζει μόνο του '
      + 'το πιο πρόσφατο με εικόνα.</p>' + nowActs();
    return;
  }

  var hit = findItemByRef(want);

  if (!hit) {
    // The button is needed here more than anywhere: the pick points at
    // something that does not exist, and without it the editor has no way
    // to clear a row they cannot see.
    box.innerHTML = '<p class="muted">Επιλεγμένο: <code>' + esc(want) + '</code><br>'
      + 'Δεν το βρήκα στη λίστα — μπορεί να είναι παλιό ή σβησμένο. '
      + 'Το site θα γυρίσει στην αυτόματη επιλογή.</p>' + nowActs();
    return;
  }

  box.innerHTML =
    (hit.image ? '<img src="' + esc(hit.image) + '" alt="">' : '<img alt="">')
    + '<div>'
    + '<p class="now-title">' + esc(hit.title) + '</p>'
    + '<p class="now-meta">'
    + '<span class="tag tag--' + hit.kind + '">' + TAGS[hit.kind] + '</span>'
    + (hit.who ? esc(hit.who) + ' · ' : '') + when(hit.date)
    + '</p></div>' + nowActs();
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
// Actions
// ---------------------------------------------------------------------

function choose(ref){
  // Whatever the new pick displaced goes into history — that is where the
  // hero returns when this one expires. Its image goes with it, before we
  // clear it below.
  if (state.curation.featured && state.curation.featured !== ref) {
    heroPush(state.curation.featured, state.curation.featuredHero);
  }

  state.curation.featured = ref;

  // With no expiry date we set one a week out. admin-api.js would reject
  // the save without it, and the editor has no reason to learn why.
  if (!state.curation.featuredUntil || new Date(state.curation.featuredUntil) < new Date()) {
    state.curation.featuredUntil = metaApo(7);
    $('[data-until]').value = state.curation.featuredUntil;
  }

  // A manual image belongs to the PREVIOUS pick. Left behind, the new
  // story would appear with someone else's photo.
  if (state.curation.featuredHero) state.curation.featuredHero = '';

  drawNow();
  drawPicks();
  markDirty(true);
}

function autoAgain(){
  var prev = heroRestore();

  if (!prev) { autoNewest(); return; }

  $('[data-until]').value = state.curation.featuredUntil;
  drawNow();
  drawPicks();
  markDirty(true);
  say('Γύρισε το προηγούμενο πρωτοσέλιδο: «' + heroTitlos(prev)
    + '». Πάτα Αποθήκευση για να ισχύσει.');
}

function autoNewest(){
  heroPush(state.curation.featured, state.curation.featuredHero);

  state.curation.featured = '';
  state.curation.featuredUntil = '';
  state.curation.featuredHero = '';
  $('[data-until]').value = '';

  drawNow();
  drawPicks();
  markDirty(true);
  say('Γύρισε στο αυτόματο — μπαίνει το πιο πρόσφατο με εικόνα. '
    + 'Πάτα Αποθήκευση για να ισχύσει.');
}

var KATHARISMA = {
  latest: {
    poso: function (){ return ltList().length + kryRefs('latest', 'latest').length; },
    ti: function (){ return 'τη ροή «Τελευταία»'; },
    svise: function (){
      state.curation.latest = [];
      kryOla('latest');
      drawLatest();
      drawLtPicks();
      ltDirty(true);
    },
  },

  mustread: {
    poso: function (){ return mrList().length + kryRefs('mustRead', 'mustRead').length; },
    ti: function (){ return 'το Must read'; },
    svise: function (){
      state.curation.mustRead = [];
      kryOla('mustRead');
      drawMustRead();
      drawMrPicks();
      mrDirty(true);
    },
  },

  apopseis: {
    poso: function (){ return opList().length + kryRefs('opinions', 'opinions').length; },
    ti: function (){ return 'τις Απόψεις'; },
    svise: function (){
      state.curation.opinions = [];
      kryOla('opinions');
      drawOpinions();
      drawOpPicks();
      opDirty(true);
    },
  },

  // Only the topic that is open. Clearing all fifteen at once was never
  // asked for, and would be the most expensive mistake on the screen.
  themata: {
    poso: function (){
      if (!th.open) return 0;
      return thPicks(th.open).length
        + kryRefs('topics', pinKey('topics', th.open)).length;
    },
    ti: function (){ return 'το θέμα «' + th.open + '»'; },
    svise: function (){
      kryOla(pinKey('topics', th.open));
      thSetPicks(th.open, []);
    },
  },
};

function autoAll(what){
  var k = KATHARISMA[what];
  if (!k) return;

  var n = k.poso();
  if (!n) return;

  // The prompt states HOW MANY and FROM WHERE: a bare "are you sure?"
  // tells nobody what they are about to lose.
  var ok = confirm(
    (n === 1 ? 'Θα αφαιρεθεί το 1 καρφιτσωμένο' : 'Θα αφαιρεθούν και τα ' + n + ' καρφιτσωμένα')
    + ' από ' + k.ti() + ', και θα ξαναδιαλέγει το site μόνο του.\n\n'
    + 'Σίγουρα;'
  );
  if (!ok) return;

  k.svise();
  say('Καθαρίστηκε. Πάτα Αποθήκευση για να ισχύσει.');
}

// The button is always in the HTML and only hides when there is nothing
// to clear. The label is passed in only where it needs a name inside
// it — that is, topics.
function autoAllButton(what, label){
  var btn = $('[data-auto-all="' + what + '"]');
  if (!btn) return;
  var n = KATHARISMA[what].poso();
  btn.hidden = !n;
  if (label) btn.textContent = label;
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
// Images
// ---------------------------------------------------------------------

// Widest we keep. The site's widest slot is 1,384px; a 2x screen needs
// 2,000 not to look blurry. Beyond that is pure weight.
var MAX_W = 2000;

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

      // 0.82: above it the file grows with no visible gain, below it
      // blocking artefacts start to show on faces.
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

// ---- the mp4 pre-flight ----
//
// A partner's video ad fails in ways nobody sees until it is live, so we
// read the file itself before it goes anywhere.

// Over this, a phone on a slow connection shows an empty frame for seconds.
var AD_MAX_MB = 5;

// Containers we walk into; everything else we step over.
var MP4_IN = { moov: 1, trak: 1, mdia: 1, minf: 1, stbl: 1 };

// The tracks of an mp4: one { handler, format } per trak.
//
// handler is 'vide' or 'soun', format the codec's four letters ('avc1',
// 'mp4a'). No library: the boxes are [size][type][payload] all the way
// down, and we need two fields out of them.
function mp4Tracks(buf){
  var dv = new DataView(buf);
  var tracks = [];
  var cur = null;

  function tag(p){
    return String.fromCharCode(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2), dv.getUint8(p + 3));
  }

  function walk(from, to){
    var p = from;

    while (p + 8 <= to) {
      var size = dv.getUint32(p);
      var type = tag(p + 4);
      var head = 8;

      // size 1 means a 64-bit length follows. We read the low half only —
      // a 4GB advert is not a thing.
      if (size === 1) { size = dv.getUint32(p + 12); head = 16; }
      // size 0 means "to the end of the file".
      if (size === 0) size = to - p;
      if (size < head || p + size > to) return;   // corrupt; stop here

      var body = p + head;

      if (type === 'trak') { cur = { handler: '', format: '' }; tracks.push(cur); }

      if (type === 'hdlr' && cur) {
        // version/flags (4) + pre_defined (4), then the handler.
        if (body + 12 <= to) cur.handler = tag(body + 8);
      }

      if (type === 'stsd' && cur) {
        // version/flags (4) + entry_count (4), then the first entry:
        // its own size (4) and then the format.
        if (body + 16 <= to) cur.format = tag(body + 12);
      }

      if (MP4_IN[type]) walk(body, p + size);

      p += size;
    }
  }

  walk(0, dv.byteLength);
  return tracks;
}

// What is wrong with this file — in the words of someone who will have to
// go back to the advertiser and ask for another one.
function adVideoProblems(file, tracks){
  var out = [];
  var video = null;
  var sound = null;

  tracks.forEach(function (t) {
    if (t.handler === 'vide' && !video) video = t;
    if (t.handler === 'soun' && !sound) sound = t;
  });

  if (!video) {
    out.push('Δεν βρέθηκε εικόνα μέσα στο αρχείο — μάλλον δεν είναι βίντεο.');
    return out;
  }

  // An advert plays by itself, muted. A file with a sound track is
  // blocked by the browser and stays frozen on its first frame.
  if (sound) {
    out.push('Έχει ήχο. Οι διαφημίσεις ξεκινούν μόνες τους, και ο browser '
      + 'μπλοκάρει ό,τι έχει ήχο — θα μείνει κολλημένο στο πρώτο καρέ. '
      + 'Ζήτησέ το χωρίς ηχητικό κανάλι.');
  }

  // avc1/avc3 is H.264. Everything else is a gamble on Safari, which is
  // most of the phones in Greece.
  if (video.format && !/^avc[13]$/.test(video.format)) {
    out.push('Η κωδικοποίηση είναι «' + video.format + '», όχι H.264. '
      + 'Στο Safari μπορεί να μην παίξει καθόλου. Ζήτησέ το σε H.264.');
  }

  var mb = file.size / 1048576;
  if (mb > AD_MAX_MB) {
    out.push('Είναι ' + mb.toFixed(1) + ' MB. Πάνω από ' + AD_MAX_MB
      + ' MB, σε κινητό με αδύναμο σήμα η θέση μένει άδεια για δευτερόλεπτα.');
  }

  return out;
}

// Reads the file and asks before an advert with a known fault goes up.
// A warning and not a block: the file may be the only one the advertiser
// sent, and the campaign starts tomorrow.
function adVideoOk(file){
  return file.arrayBuffer().then(function (buf) {
    var problems;

    try {
      problems = adVideoProblems(file, mp4Tracks(buf));
    } catch (err) {
      // An unreadable container is itself the answer.
      problems = ['Το αρχείο δεν διαβάζεται ως mp4 (' + err.message + ').'];
    }

    if (!problems.length) return true;

    return window.confirm(
      'Το «' + file.name + '» έχει πρόβλημα:\n\n'
      + problems.map(function (p, i) { return (i + 1) + '. ' + p; }).join('\n\n')
      + '\n\nΝα ανέβει έτσι;'
    );
  });
}

function sayUpload(text, kind){
  var el = $('[data-upload]');
  if (!text) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = text;
  if (kind) el.setAttribute('data-kind', kind); else el.removeAttribute('data-kind');
}

// Upload runs from two places: the Images tab and the picker inside an
// article. Only the message target and the final step differ — not the
// work itself.
function upload(files, ctx){
  ctx = ctx || {};
  var say = ctx.say || sayUpload;
  // After upload, jump to TODAY's folder: that is where they landed.
  // Without it the editor uploads ten images and stares at a list of
  // folders with no proof anything happened.
  var after = ctx.after || function () {
    loadShots().then(function () { goTo('lib', 'day:' + todayYmd()); });
  };

  // Images and mp4. The file input has said video/mp4 all along, but this
  // filter did not, so an advert picked from the screen was turned away
  // with "images only" — the mp4 path had only ever been used through the
  // API.
  var list = Array.prototype.slice.call(files).filter(function (f) {
    return /^image\//.test(f.type) || f.type === 'video/mp4';
  });
  if (!list.length) { say('Μόνο φωτογραφίες ή mp4.', 'bad'); return; }

  var done = 0;
  var failed = [];
  var skipped = 0;  // said no at the mp4 prompt
  var last = '';    // the URL of the last one that went up

  // One at a time: on a weak connection ten parallel uploads block each
  // other and all time out together.
  function next(i){
    if (i >= list.length) {
      var word = done === 1 ? 'Το αρχείο ανέβηκε.' : done + ' αρχεία ανέβηκαν.';
      if (skipped) word += ' ' + (skipped === 1 ? '1 δεν ανέβηκε.' : skipped + ' δεν ανέβηκαν.');

      say(
        failed.length
          ? done + ' ανέβηκαν, ' + failed.length + ' απέτυχαν: ' + failed.join(', ')
          : word,
        failed.length ? 'bad' : 'ok'
      );
      after(last, done);
      return;
    }

    var file = list[i];
    say('Ανεβαίνει ' + (i + 1) + ' από ' + list.length + '…');

    var raw = /^(image\/gif|video\/)/.test(file.type);

    // An mp4 is read and checked first. Said no at the prompt? It is
    // skipped, not failed — the editor decided, nothing went wrong.
    var pass = file.type === 'video/mp4' ? adVideoOk(file) : Promise.resolve(true);

    pass.then(function (go) {
      if (!go) { skipped++; return null; }
      return raw ? file : shrink(file);
    }).then(function (blob) {
      if (!blob) return null;
      return fetch('/api/images', {
        method: 'POST',
        headers: {
          'Content-Type': raw ? file.type : 'image/jpeg',
          'X-File-Name': encodeURIComponent(file.name),
        },
        body: blob,
      }).then(readJson, netFail);
    }).then(function (d) {
      if (!d) return;            // skipped at the prompt
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

var lib = {
  files: [],        // whatever /api/images returned
  standard: [],     // the names that carry a star
  rest: {},
  loaded: false,
  // Where each of the two grids is. null = the root.
  at: { lib: null, pick: null },
  find: { lib: '', pick: '' },
};

// Timestamp from the filename. Without one the image goes to the
// "no date" folder — it may have been uploaded by another tool.
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

// Which images belong to a node of the tree.
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

// ---- the cards ----

// One image card. Same in the library and the picker — only the button
// differs: "Copy" in the library, while in the picker the whole card is
// the button.
function shotHTML(f, mode){
  var m = f.name.match(/^(\d{8})(\d{6})-(.+)\.\w+$/);
  var label = m ? m[3].replace(/-/g, ' ') : f.name;
  var day = m ? m[1].slice(6, 8) + '/' + m[1].slice(4, 6) : '';
  var pick = mode === 'pick';
  var on = isStandard(f.name);

  // Library video needs <video>: an <img> would show a broken image and
  // the editor would think the upload failed.
  return '<figure class="shot"'
    + (pick ? ' tabindex="0" role="button" data-take="' + esc(f.url) + '"' : '') + '>'
    + (adIsVideo(f.url)
      ? '<video src="' + esc(f.url) + '" muted loop playsinline preload="metadata"></video>'
      : '<img src="' + esc(f.url) + '" alt="" loading="lazy">')
    // The star shows in the picker TOO: the moment you realise an image
    // will be needed again is when you put it in an article, not when
    // you pass through the library.
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

// ---- drawing ----

function drawCrumbs(mode){
  var box = $(mode === 'pick' ? '[data-pick-crumbs]' : '[data-shot-crumbs]');
  var at = lib.at[mode];

  if (lib.find[mode]) {
    box.innerHTML = '<span class="crumb-now">Αναζήτηση σε όλους τους φακέλους</span>';
    return;
  }

  // At the root the trail is a bare "Library" pointing at itself —
  // noise. It appears once you are inside something.
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

  // Search ignores folders and looks at everything. That is why it
  // exists — a folder helps when you know when, and gets in the way
  // when you do not.
  if (find) {
    var hits = lib.files.filter(function (f) {
      return flat(f.name).indexOf(find) > -1;
    });
    box.innerHTML = hits.length
      ? hits.map(function (f) { return shotHTML(f, mode); }).join('')
      : '<p class="muted">Καμία φωτογραφία δεν ταιριάζει.</p>';
    return;
  }

  // Inside a folder: its images.
  if (at) {
    var inside = shotsAt(at);
    box.innerHTML = inside.length
      ? inside.map(function (f) { return shotHTML(f, mode); }).join('')
      : '<p class="muted">Άδειος φάκελος.</p>';
    return;
  }

  // The root: ★ Standard, then months newest first.
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

// Inside a month we show DAYS, not images: a month can hold two hundred,
// and then the folder helped with nothing.
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

// Writes the WHOLE file, not just the list: anything else in there —
// notes, future fields — survives.
function savePhotos(){
  var body = {};
  Object.keys(lib.rest).forEach(function (k) { body[k] = lib.rest[k]; });
  body.standard = lib.standard;
  return api('photos', 'PUT', body);
}

// The star. Written immediately — images have no Save button, and a mark
// that disappears on refresh is worse than no mark at all.
function toggleStandard(name){
  var at = lib.standard.indexOf(name);
  if (at > -1) lib.standard.splice(at, 1);
  else lib.standard.push(name);

  drawLib('lib');
  if (!$('[data-picker]').hidden) drawLib('pick');

  savePhotos().catch(function (err) {
    // Back to the previous state: otherwise the screen claims something
    // was saved that was not, and the editor finds out tomorrow.
    if (at > -1) lib.standard.splice(at, 0, name);
    else lib.standard.splice(lib.standard.indexOf(name), 1);
    drawLib('lib');
    sayUpload('Δεν αποθηκεύτηκε η σήμανση: ' + err.message, 'bad');
  });
}

// After an upload or a delete both grids refresh — otherwise the picker
// shows an image that was just deleted.
function refreshShots(){
  loadShots();
  if (!$('[data-picker]').hidden) loadPickShots();
}

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

      // Drops out of the standard set too, or the folder carries the
      // name of a file that no longer exists forever.
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
    input.value = '';   // so the same image can be picked again
  });

  // Without preventDefault the browser OPENS the image in a new tab and
  // the page's work is lost.
  ['dragenter', 'dragover'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
  });
  drop.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files) upload(e.dataTransfer.files);
  });

  // Same for the WHOLE page: if someone drops an image next to the zone,
  // it must not navigate away from the admin.
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { e.preventDefault(); });

  // Folder navigation — both grids, same code.
  ['lib', 'pick'].forEach(function (mode) {
    var grid = $(mode === 'pick' ? '[data-pick-shots]' : '[data-shots]');
    var crumbs = $(mode === 'pick' ? '[data-pick-crumbs]' : '[data-shot-crumbs]');
    var find = $(mode === 'pick' ? '[data-pick-find]' : '[data-shot-find]');

    crumbs.addEventListener('click', function (e) {
      var go = e.target.closest('[data-go]');
      if (go) goTo(mode, go.dataset.go);
    });

    // In the grid the folder and the star are caught BEFORE the rest:
    // the picker card is one big button, so without this the star
    // would pick the image.
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

var pin = {
  life: { mustRead: 3, latest: 7, opinions: 7, topics: 30 },
};

// Days before an expired pick leaves the file. Far enough out that
// someone can still see it and renew it.
var PIN_KATHARISMA = 60;

function pinKey(lista, onoma){
  return lista === 'topics' ? 'cat:' + slugify(onoma) : lista;
}

function pinStamps(key){
  var all = state.curation.pinnedAt || {};
  return all[key] || {};
}

// Days left. null = no date (an old pick, from before the mechanism) —
// the build treats it as fresh.
function pinMeres(lista, key, ref){
  var t = Date.parse(pinStamps(key)[ref] || '');
  if (isNaN(t)) return null;
  var meres = pin.life[lista];
  if (!meres) return null;
  return (t + meres * 864e5 - Date.now()) / 864e5;
}

// Expired? Then the site no longer shows it, and its slot in the admin
// must look dimmed — otherwise the "01" numbering claims it is first on
// the homepage while something else sits there.
function pinLixe(lista, key, ref){
  var left = pinMeres(lista, key, ref);
  return left !== null && left <= 0;
}

// The label next to a slot: how long is left, or that it expired.
function pinSima(lista, key, ref){
  var left = pinMeres(lista, key, ref);
  if (left === null) return '';

  if (left <= 0) {
    return '<span class="pinx">έληξε</span>'
      + '<button type="button" class="pinagain" data-pin-again="' + esc(ref) + '"'
      + ' data-pin-key="' + esc(key) + '">Ξανακράτα το</button>';
  }

  var t = left < 1
    ? 'λήγει σήμερα'
    : 'λήγει σε ' + Math.ceil(left) + (Math.ceil(left) === 1 ? ' μέρα' : ' μέρες');

  return '<span class="pinok">' + t + '</span>';
}

// Stamps the list before saving: whatever went in now gets its time,
// whatever came out loses its, and whatever aged out is dropped.
function pinSfragida(key, refs){
  if (!state.curation.pinnedAt) state.curation.pinnedAt = {};

  var tora = new Date().toISOString();
  var palia = state.curation.pinnedAt[key] || {};
  var nea = {};

  refs.forEach(function (ref) {
    nea[ref] = palia[ref] || tora;
  });

  // Expired picks still in the list keep their old time, so they show as
  // expired. They leave for good only once enough time passes.
  Object.keys(nea).forEach(function (ref) {
    var t = Date.parse(nea[ref]);
    if (!isNaN(t) && Date.now() - t > PIN_KATHARISMA * 864e5) delete nea[ref];
  });

  if (Object.keys(nea).length) state.curation.pinnedAt[key] = nea;
  else delete state.curation.pinnedAt[key];
}

// "Renew": the pick starts counting from today again.
function pinAgain(key, ref){
  if (!state.curation.pinnedAt) state.curation.pinnedAt = {};
  if (!state.curation.pinnedAt[key]) state.curation.pinnedAt[key] = {};
  state.curation.pinnedAt[key][ref] = new Date().toISOString();

  drawMustRead();
  drawLatest();
  drawOpinions();
  drawThCat();
  state.dirty = true;
  $$('[data-save]').forEach(function (b) { b.disabled = false; });
}

function kryMap(key){
  return (state.curation.hidden || {})[key] || {};
}

// Only what still applies. Expired entries stay in the file until the
// next save — kryKatharise() clears them.
function kryRefs(lista, key){
  var map = kryMap(key);
  var meres = pin.life[lista];
  var orio = meres ? Date.now() - meres * 864e5 : null;

  return Object.keys(map).filter(function (ref) {
    var t = Date.parse(map[ref] || '');
    if (orio === null || isNaN(t)) return true;
    return t >= orio;
  });
}

function kryvo(key, ref){
  if (!state.curation.hidden) state.curation.hidden = {};
  if (!state.curation.hidden[key]) state.curation.hidden[key] = {};
  state.curation.hidden[key][ref] = new Date().toISOString();
}

function kryXana(key, ref){
  var map = (state.curation.hidden || {})[key];
  if (!map) return;
  delete map[ref];
  if (!Object.keys(map).length) delete state.curation.hidden[key];
  if (!Object.keys(state.curation.hidden).length) delete state.curation.hidden;
}

function kryXanaOles(key, ref){
  var map = (state.curation.hidden || {})[key];
  if (!map) return;

  var it = findItemByRef(ref);
  Object.keys(map).forEach(function (k) {
    if (k === ref || (it && isChosen(it, k))) delete map[k];
  });

  if (!Object.keys(map).length) kryXana(key, '');
}

function kryOla(key){
  if (state.curation.hidden) delete state.curation.hidden[key];
}

// Hidden? Goes through isChosen, because the same thing is written
// sometimes as an id and sometimes as a page URL.
function kryfoIt(lista, key, it, ref){
  return kryRefs(lista, key).some(function (k) {
    if (it) return isChosen(it, k);
    return ref ? isChosen({ id: '', ref: ref }, k) : false;
  });
}

// Expired entries go on save: they have no effect any more, and we do
// not want curation.json filling up with blocklists from June.
function kryKatharise(lista, key){
  var map = (state.curation.hidden || {})[key];
  if (!map) return;
  var zonta = kryRefs(lista, key);
  Object.keys(map).forEach(function (ref) {
    if (zonta.indexOf(ref) < 0) delete map[ref];
  });
  if (!Object.keys(map).length) kryXana(key, '');
}

// The "hidden: 3 — restore" line. It exists so nothing disappears
// silently: what ✕ removed is visible, and comes back in one click.
function kryGrammi(lista, key, poio){
  var refs = kryRefs(lista, key);
  if (!refs.length) return '';

  return '<p class="krynote">Κρυμμένα με το ✕: <strong>' + refs.length + '</strong>'
    + ' — δεν τα ξαναβάζει το site μόνο του. '
    + refs.map(function (ref) {
      var it = findItemByRef(ref);
      return '<button type="button" class="pinagain" data-kry-back="' + esc(ref) + '"'
        + ' data-kry-poio="' + esc(poio) + '">↩ '
        + esc(it ? it.title.slice(0, 40) : ref) + '</button>';
    }).join(' ')
    + '</p>';
}

// The line goes BELOW the slots, as a footer of the list: it is not a
// homepage slot, it is the account of what was taken out.
function kryfaMeta(box, lista, key, poio){
  var old = box.parentNode.querySelector('.krynote');
  if (old) old.remove();

  var html = kryGrammi(lista, key, poio);
  if (html) box.insertAdjacentHTML('afterend', html);
}

// Restore. "poio" says which list the button belongs to — for topics it
// carries the topic name too, since each topic has its own.
function kryEpanafora(poio, ref){
  var p = String(poio || '');

  if (p.indexOf('topics:') === 0) {
    kryXana(pinKey('topics', p.slice(7)), ref);
    drawThCat();
    thDirty(true);
    return;
  }

  kryXana(p, ref);

  if (p === 'latest') { drawLatest(); drawLtPicks(); ltDirty(true); }
  else if (p === 'mustRead') { drawMustRead(); drawMrPicks(); mrDirty(true); }
  else if (p === 'opinions') { drawOpinions(); drawOpPicks(); opDirty(true); }
}

var cat = {
  auto: {},        // id -> [categories] as the site derives them
  shown: PAGE,
  find: '',
  filter: '',
  openId: null,    // which row is open for editing
};

function catItems(){
  return state.items.filter(function (it) {
    return it.kind !== 'news' && it.kind !== 'article';
  });
}

function catsOf(id){
  var manual = state.curation.categories && state.curation.categories[id];
  if (manual) return { list: Array.isArray(manual) ? manual : [manual], manual: true };
  return { list: cat.auto[id] || [], manual: false };
}

function drawCats(){
  var box = $('[data-cat-rows]');

  var hits = catItems().filter(function (it) {
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
  // The first change starts from what the site shows NOW, not from
  // empty: otherwise an editor adding one category would silently wipe
  // the correct ones the site had found.
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
    if (e.target.closest('.catpick')) return;      // the boxes are handled by change

    // Click on the row: open or close.
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

// The automatic suggestions. If the file is missing — first run before
// the site is built — the tab still works, it just shows "none".
function loadAutoCats(){
  return fetch('auto-categories.json').then(function (r) {
    return r.ok ? r.json() : {};
  }).catch(function () { return {}; });
}

var TH_ROWS = 4;      // rows the homepage shows
var TH_SPOTS = 2;     // sections in a spotlight

var th = {
  list: [],                                  // [{name, key, n}] descending
  defaults: { featured: [], spotlight: [] }, // the code's defaults
  open: '',                                  // which topic is open for pinning
  find: '',
  shown: PAGE,
};

function thReady(file){
  var f = file && typeof file === 'object' ? file : {};
  th.list = Array.isArray(f.list) ? f.list : [];
  // Each list's lifetime in days, as the build knows it.
  if (f.pinLife && typeof f.pinLife === 'object') pin.life = f.pinLife;

  var d = f.defaults && typeof f.defaults === 'object' ? f.defaults : {};
  th.defaults = {
    featured: Array.isArray(d.featured) ? d.featured : [],
    spotlight: Array.isArray(d.spotlight) ? d.spotlight : [],
  };
}

// Did anyone pick, or does the code's default still stand?
function thChosen(key){
  var v = state.curation[key];
  return Array.isArray(v) && v.length ? v : null;
}

// What the site shows NOW — picked by a human or not.
function thNow(key, fallback, max){
  return (thChosen(key) || fallback).slice(0, max);
}

function thRows(){ return thNow('featuredTopics', th.defaults.featured, TH_ROWS); }

// Anything that already has a row is not put in a spotlight too — it
// would appear twice on one page. Same rule as the build's spotlightTopics().
function thSpots(){
  var pano = thRows();
  return thNow('spotlightTopics', th.defaults.spotlight, TH_SPOTS)
    .filter(function (name) { return pano.indexOf(name) < 0; });
}

function thCount(name){
  var hit = null;
  th.list.forEach(function (t) { if (!hit && t.name === name) hit = t; });
  return hit ? hit.n : 0;
}

// One slot. No image: a topic has no photo of its own, and an empty
// frame next to every row would be pure noise.
function thSlot(name, i, total, auto, up, del){
  var n = thCount(name);

  return '<div class="slot' + (auto ? ' slot--auto' : '') + '">'
    + '<span class="slot-no">' + String(i + 1).padStart(2, '0') + '</span>'
    + '<div class="slot-text">'
    + '<p class="slot-title">' + esc(name) + '</p>'
    + '<p class="slot-meta">' + (n ? n.toLocaleString('el') + ' κομμάτια' : 'άδειο — δεν θα βγει καθόλου') + '</p>'
    + '</div>'
    + '<span class="slot-acts">'
    + (auto
      ? '<span class="pill pill--draft">προεπιλογή</span>'
      : '<button type="button" data-th-' + up + '="' + i + '" aria-label="Πάνω"'
        + (i === 0 ? ' disabled' : '') + '>↑</button>'
        + '<button type="button" data-th-' + up + 'down="' + i + '" aria-label="Κάτω"'
        + (i === total - 1 ? ' disabled' : '') + '>↓</button>'
        + '<button type="button" data-th-' + del + '="' + i + '" aria-label="Αφαίρεση">✕</button>')
    + '</span></div>';
}

// The pick chips. Same shape as the Categories tab's boxes — the editor
// has seen them already.
function thPicker(box, chosen, attr, full){
  box.innerHTML = th.list.map(function (t) {
    var on = chosen.indexOf(t.name) > -1;
    return '<button type="button" class="catopt' + (on ? ' is-on' : '') + '"'
      + (!on && full ? ' disabled' : '')
      + ' data-' + attr + '="' + esc(t.name) + '">'
      + esc(t.name) + ' <span class="thnum">' + t.n.toLocaleString('el') + '</span>'
      + '</button>';
  }).join('');
}

function drawThemata(){
  var rows = thRows();
  var autoRows = !thChosen('featuredTopics');

  $('[data-th-rows]').innerHTML = rows.length
    ? rows.map(function (name, i) {
      return thSlot(name, i, rows.length, autoRows, 'up', 'del');
    }).join('')
    : '<p class="muted">Καμία λωρίδα — η αρχική πάει κατευθείαν στο «Και ακόμα».</p>';

  $('[data-th-note]').textContent = autoRows
    ? 'Ισχύει η προεπιλογή του site. Μόλις αλλάξεις κάτι, κλειδώνει όπως το βλέπεις.'
    : rows.length + ' από ' + TH_ROWS + ' θέσεις.';

  var spots = thSpots();
  var autoSpots = !thChosen('spotlightTopics');

  $('[data-th-spots]').innerHTML = spots.length
    ? spots.map(function (name, i) {
      return thSlot(name, i, spots.length, autoSpots, 'sup', 'sdel');
    }).join('')
    : '<p class="muted">Καμία ενότητα σε πλαίσιο — η αρχική τελειώνει στο «Και ακόμα».</p>';

  $('[data-th-spot-note]').textContent = autoSpots
    ? 'Ισχύει η προεπιλογή του site.'
    : spots.length + ' από ' + TH_SPOTS + ' θέσεις.';

  thPicker($('[data-th-pick-row]'), rows, 'th-add', rows.length >= TH_ROWS);
  thPicker($('[data-th-pick-spot]'), spots, 'th-sadd', spots.length >= TH_SPOTS);

  // The lower half is redrawn with it: if where a topic sits changes, so
  // does how many slots it has.
  drawThCat();
}

// Writes a list into curation. The FIRST change starts from what the
// site shows now, not from empty — otherwise an editor adding one topic
// would silently wipe the four that applied.
function thSave(key, list){
  state.curation[key] = list;
  drawThemata();
  thDirty(true);
}

function thToggle(key, now, max, name){
  var list = now.slice();
  var at = list.indexOf(name);

  if (at > -1) {
    list.splice(at, 1);
  } else {
    if (list.length >= max) {
      say('Οι θέσεις είναι γεμάτες. Αφαίρεσε μία πρώτα.', 'bad');
      return;
    }
    list.push(name);
  }

  thSave(key, list);
}

function thMove(key, now, i, step){
  var list = now.slice();
  var to = i + step;
  if (to < 0 || to >= list.length) return;
  var moved = list.splice(i, 1)[0];
  list.splice(to, 0, moved);
  thSave(key, list);
}

function thRemove(key, now, i){
  var list = now.slice();
  list.splice(i, 1);
  thSave(key, list);
}

// How many slots the homepage gives a topic. Depends on WHERE it sits:
// row, spotlight, or "More". The numbers are build.js's —
// TOPIC_ROW, SPOTLIGHT_CARDS, MORE_CARDS.
function thPosesTheseis(name){
  if (thRows().indexOf(name) > -1) return 4;
  if (thSpots().indexOf(name) > -1) return 3;
  return 2;
}

function thPouVgainei(name){
  if (thRows().indexOf(name) > -1) return 'μεγάλη λωρίδα';
  if (thSpots().indexOf(name) > -1) return 'ενότητα σε πλαίσιο';
  return '«Και ακόμα»';
}

// One item's categories. Our own articles carry their own — they do not
// go through auto-categories.json, which the build writes only for
// episodes and videos.
function thKatigoriesTou(it){
  if (it.kind === 'article') return it.who ? [it.who] : [];
  return catsOf(it.id).list;
}

function thTouThematos(name){
  return catItems().filter(function (it) {
    return thKatigoriesTou(it).indexOf(name) > -1;
  });
}

function thPicks(name){
  var all = state.curation.categoryPicks || {};
  var list = all[slugify(name)];
  return Array.isArray(list) ? list : [];
}

function thSetPicks(name, list){
  if (!state.curation.categoryPicks) state.curation.categoryPicks = {};

  // Empty list = no manual pick. We drop the key entirely instead of
  // leaving an empty box in the file — curation.json is also read by
  // eye.
  if (list.length) state.curation.categoryPicks[slugify(name)] = list;
  else delete state.curation.categoryPicks[slugify(name)];

  drawThCat();
  thDirty(true);
}

// What the homepage will show: pinned first, then the automatic fill.
// Mirrors build.js's homeItems().
function thProvoli(name){
  var pinned = thPicks(name);
  var pool = thTouThematos(name);
  var rows = [];
  var taken = {};

  pinned.forEach(function (ref) {
    var hit = null;
    pool.forEach(function (it) { if (!hit && !taken[it.ref] && isChosen(it, ref)) hit = it; });
    if (hit) { taken[hit.ref] = true; rows.push({ item: hit, ref: ref, auto: false }); }
    else rows.push({ item: null, ref: ref, auto: false });
  });

  var key = pinKey('topics', name);
  for (var i = 0; i < pool.length && rows.length < thPosesTheseis(name); i++) {
    if (taken[pool[i].ref]) continue;
    // What ✕ removed from THIS topic does not come back on its own.
    if (kryfoIt('topics', key, pool[i])) continue;
    taken[pool[i].ref] = true;
    rows.push({ item: pool[i], ref: pool[i].ref, auto: true });
  }

  return rows;
}

function drawThCat(){
  var box = $('[data-th-cat-box]');
  var name = th.open;

  // Topic chips, always visible.
  var chips = $('[data-th-pick-cat]');
  chips.innerHTML = th.list.map(function (t) {
    var n = thPicks(t.name).length;
    return '<button type="button" class="catopt' + (t.name === name ? ' is-on' : '') + '"'
      + ' data-th-cat="' + esc(t.name) + '">'
      + esc(t.name)
      + (n ? ' <span class="thnum">' + n + ' καρφιτσωμένα</span>'
           : ' <span class="thnum">αυτόματο</span>')
      + '</button>';
  }).join('');

  if (!name) { box.hidden = true; return; }
  box.hidden = false;

  var theseis = thPosesTheseis(name);
  var rows = thProvoli(name);

  $('[data-th-cat-slots]').innerHTML = rows.map(function (r, i) {
    var it = r.item;

    var body = it
      ? (it.image ? '<img src="' + esc(it.image) + '" alt="">' : '<img alt="">')
        + '<div class="slot-text">'
        + '<p class="slot-title">' + esc(it.title) + '</p>'
        + '<p class="slot-meta">' + (it.who ? esc(it.who) + ' · ' : '') + when(it.date) + '</p>'
        + '</div>'
      : '<img alt=""><div class="slot-text"><p class="slot-title">' + esc(r.ref) + '</p>'
        + '<p class="slot-meta">Δεν βρέθηκε — ίσως άλλαξε θέμα. Το site θα βάλει άλλο.</p></div>';

    return '<div class="slot' + (r.auto ? ' slot--auto' : '') + (i >= theseis ? ' slot--extra' : '')
      + (!r.auto && pinLixe('topics', pinKey('topics', name), r.ref) ? ' slot--lixe' : '') + '">'
      + '<span class="slot-no">' + String(i + 1).padStart(2, '0') + '</span>'
      + body
      + '<span class="slot-acts">'
      + (r.auto ? '' : pinSima('topics', pinKey('topics', name), r.ref))
      + (r.auto
        ? '<span class="pill pill--draft">αυτόματο</span>'
        : '<button type="button" data-thc-up="' + i + '" aria-label="Πάνω"'
          + (i === 0 ? ' disabled' : '') + '>↑</button>'
          + '<button type="button" data-thc-down="' + i + '" aria-label="Κάτω"'
          + (i === thPicks(name).length - 1 ? ' disabled' : '') + '>↓</button>')
      // ✕ on the automatic ones TOO: "not this, not in this topic" is
      // why anyone opens the tab.
      + '<button type="button" data-thc-del="' + i + '" aria-label="Αφαίρεση">✕</button>'
      + '</span></div>';
  }).join('');

  var n = thPicks(name).length;
  $('[data-th-cat-note]').textContent = 'Το «' + name + '» βγαίνει ως ' + thPouVgainei(name)
    + ' με ' + theseis + (theseis === 1 ? ' θέση' : ' θέσεις') + '. '
    + (n === 0
      ? 'Καμία χειροκίνητη επιλογή — μπαίνουν τα πιο πρόσφατα.'
      : n + (n === 1 ? ' καρφιτσωμένο' : ' καρφιτσωμένα')
        + (n > theseis ? ' — τα πέρα από τη ' + theseis + 'η θέση δεν θα φανούν.' : '.'));

  kryfaMeta($('[data-th-cat-slots]'), 'topics', pinKey('topics', name), 'topics:' + name);
  autoAllButton('themata', 'Καθάρισε το «' + name + '» — πίσω στο αυτόματο');

  drawThCatPicks();
}

function drawThCatPicks(){
  var name = th.open;
  var box = $('[data-th-cat-picks]');
  var pinned = thPicks(name);

  var hits = thTouThematos(name).filter(function (it) {
    if (!th.find) return true;
    return it.key.indexOf(th.find) > -1;
  });

  if (!hits.length) {
    box.innerHTML = '<p class="muted">Τίποτα δεν ταιριάζει σε αυτό το θέμα.</p>';
    $('[data-th-cat-more]').hidden = true;
    return;
  }

  box.innerHTML = hits.slice(0, th.shown).map(function (it) {
    var on = pinned.some(function (ref) { return isChosen(it, ref); });
    return '<button type="button" class="pick' + (on ? ' is-on' : '') + '"'
      + ' data-thc-add="' + esc(it.ref) + '">'
      + (it.image ? '<img src="' + esc(it.image) + '" alt="" loading="lazy">' : '<img alt="">')
      + '<span><span class="pick-title">' + esc(it.title) + '</span>'
      + '<span class="pick-meta">'
      + '<span class="tag tag--' + it.kind + '">' + TAGS[it.kind] + '</span>'
      + (it.who ? esc(it.who) + ' · ' : '') + when(it.date)
      + '</span></span></button>';
  }).join('');

  $('[data-th-cat-more]').hidden = hits.length <= th.shown;
}

function thcToggle(ref){
  var name = th.open;
  var key = pinKey('topics', name);
  var list = thPicks(name).slice();
  var at = -1;

  list.forEach(function (r, i) { if (r === ref) at = i; });

  if (at > -1) {
    list.splice(at, 1);
    kryvo(key, ref);
  } else {
    kryXanaOles(key, ref);              // they picked it themselves, they mean it
    list.push(ref);
  }

  thSetPicks(name, list);
}

function thcMove(i, step){
  var list = thPicks(th.open).slice();
  var to = i + step;
  if (to < 0 || to >= list.length) return;
  list.splice(to, 0, list.splice(i, 1)[0]);
  thSetPicks(th.open, list);
}

// ✕ on a topic slot — pinned or automatic. The index counts SCREEN
// rows, not list positions: it has to go through thProvoli() to find
// what that row actually shows.
function thcRemove(i){
  var name = th.open;
  var r = thProvoli(name)[i];
  if (!r) return;

  kryvo(pinKey('topics', name), r.ref);

  var list = thPicks(name).slice();
  var at = -1;
  list.forEach(function (ref, n) { if (ref === r.ref) at = n; });
  if (at > -1) list.splice(at, 1);

  thSetPicks(name, list);
}

function thDirty(on){
  state.dirty = on;
  $('[data-save="themata"]').disabled = !on;
}

function saveThemata(){
  // Every pin gets a time, so the build knows when it expires.
  th.list.forEach(function (t) {
    pinSfragida(pinKey('topics', t.name), thPicks(t.name));
    kryKatharise('topics', pinKey('topics', t.name));
  });

  say('Αποθηκεύεται…');
  api('curation', 'PUT', state.curation).then(function () {
    thDirty(false);
    say('Αποθηκεύτηκε. Φαίνεται στο site μόλις ξαναχτιστεί (~2 λεπτά).', 'ok');
  }).catch(function (err) {
    say('Δεν αποθηκεύτηκε: ' + err.message, 'bad');
  });
}

function wireThemata(){
  // The four rows: move and remove.
  $('[data-th-rows]').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.thUp !== undefined) thMove('featuredTopics', thRows(), +b.dataset.thUp, -1);
    else if (b.dataset.thUpdown !== undefined) thMove('featuredTopics', thRows(), +b.dataset.thUpdown, 1);
    else if (b.dataset.thDel !== undefined) thRemove('featuredTopics', thRows(), +b.dataset.thDel);
  });

  $('[data-th-spots]').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.thSup !== undefined) thMove('spotlightTopics', thSpots(), +b.dataset.thSup, -1);
    else if (b.dataset.thSupdown !== undefined) thMove('spotlightTopics', thSpots(), +b.dataset.thSupdown, 1);
    else if (b.dataset.thSdel !== undefined) thRemove('spotlightTopics', thSpots(), +b.dataset.thSdel);
  });

  $('[data-th-pick-row]').addEventListener('click', function (e) {
    var b = e.target.closest('[data-th-add]');
    if (!b) return;
    var name = b.dataset.thAdd;
    // One topic cannot be both a row and a spotlight.
    if (thSpots().indexOf(name) > -1) {
      say('Το «' + name + '» είναι ήδη ενότητα σε πλαίσιο. Βγάλ\' το από εκεί πρώτα.', 'bad');
      return;
    }
    thToggle('featuredTopics', thRows(), TH_ROWS, name);
  });

  $('[data-th-pick-spot]').addEventListener('click', function (e) {
    var b = e.target.closest('[data-th-sadd]');
    if (!b) return;
    var name = b.dataset.thSadd;
    if (thRows().indexOf(name) > -1) {
      say('Το «' + name + '» έχει ήδη δική του λωρίδα. Βγάλ\' το από εκεί πρώτα.', 'bad');
      return;
    }
    thToggle('spotlightTopics', thSpots(), TH_SPOTS, name);
  });

  // ---- what shows under each topic ----

  $('[data-th-pick-cat]').addEventListener('click', function (e) {
    var b = e.target.closest('[data-th-cat]');
    if (!b) return;
    // A second click on the same topic closes it.
    th.open = th.open === b.dataset.thCat ? '' : b.dataset.thCat;
    th.find = '';
    th.shown = PAGE;
    $('[data-th-cat-find]').value = '';
    drawThCat();
  });

  $('[data-th-cat-slots]').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.thcUp !== undefined) thcMove(+b.dataset.thcUp, -1);
    else if (b.dataset.thcDown !== undefined) thcMove(+b.dataset.thcDown, 1);
    else if (b.dataset.thcDel !== undefined) thcRemove(+b.dataset.thcDel);
  });

  $('[data-th-cat-picks]').addEventListener('click', function (e) {
    var b = e.target.closest('[data-thc-add]');
    if (b) thcToggle(b.dataset.thcAdd);
  });

  $('[data-th-cat-find]').addEventListener('input', function (e) {
    th.find = flat(e.target.value);
    th.shown = PAGE;
    drawThCatPicks();
  });

  $('[data-th-cat-more]').addEventListener('click', function () {
    th.shown += PAGE;
    drawThCatPicks();
  });

  $('[data-save="themata"]').addEventListener('click', saveThemata);
}

// The topic inventory. FORGIVING: if no build has run yet, the tab shows
// an empty list instead of taking the whole admin down.
function loadTopics(){
  return fetch('topics.json').then(function (r) {
    return r.ok ? r.json() : null;
  }).catch(function () { return null; });
}

// Slots the flow shows before "Όλα τα επεισόδια →".
// Same number as FLOW_VISIBLE in build.js.
var LATEST_SLOTS = 9;

// Past this many days a pin counts as forgotten and we say so. We do not
// delete it — it may be deliberate. We just do not let anyone discover
// in six months that the homepage is still carrying July.
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

function ltFlow(){
  var f = state.flow;
  return (f && Array.isArray(f.items)) ? f.items : [];
}

// The build writes it at the site root, hence the absolute path: the
// admin lives in /admin/, flow.json one level up.
function loadFlow(){
  return fetch('/flow.json').then(function (r) {
    return r.ok ? r.json() : null;
  }).catch(function () { return null; });
}

function ltAuto(){
  var out = [];
  var seen = {};

  var vale = function (ref, item){
    var key = item ? item.kind + ':' + item.id : ref;
    if (seen[key]) return;
    seen[key] = true;
    out.push({ ref: ref, item: item, auto: true });
  };

  ltFlow().forEach(function (f) {
    if (f.pinned) return;
    // Pinned BY PAGE URL, exactly as the build writes it: there
    // sameItem() compares like with like, with no guessing.
    vale(f.href, findItemByRef(f.href) || {
      kind: f.kind, title: f.title, who: f.who,
      image: f.image, date: f.date,
    });
  });

  var extra = [];
  var epi = ltEpisodeTitles();
  state.items.forEach(function (it) {
    if (it.kind === 'news') return;
    if (it.kind === 'video' && epi[ltTitleKey(it.title)]) return;   // has a twin
    var key = it.kind + ':' + it.id;
    if (seen[key]) return;
    seen[key] = true;
    extra.push({ ref: it.ref, item: it, auto: true });
  });

  extra.sort(function (a, b) {
    return new Date(b.item.date) - new Date(a.item.date);
  });

  return out.concat(extra);
}

function ltTitleKey(t){
  var s = String(t == null ? '' : t);
  var at = s.indexOf(':');
  if (at > 0 && at < 40) s = s.slice(at + 1);   // drop the name in front
  return flat(s).slice(0, 60);
}

function ltEpisodeTitles(){
  var map = {};
  state.items.forEach(function (it) {
    if (it.kind === 'podcast') map[ltTitleKey(it.title)] = true;
  });
  return map;
}

// One row per slot: pinned first, then what the site fills in by itself —
// with its real content, not as "X slots".
function ltRows(){
  var rows = ltList().map(function (ref) {
    return { ref: ref, item: findItemByRef(ref), auto: false };
  });

  // The lead and the four below it do not re-enter the flow — the build
  // keeps them out (onTop). Suggesting them would show the journalist
  // something at slot 03 that never appears there.
  var panw = [state.curation.featured]
    .concat(state.curation.secondary || [])
    .filter(Boolean);

  // A flow.json row does not always carry an id — then it is judged by
  // its URL, which is all we know about it.
  var tairiazei = function (c, ref){
    return c.item && c.item.id
      ? isChosen(c.item, ref)
      : isChosen({ id: '', ref: c.ref }, ref);
  };

  ltAuto().forEach(function (c) {
    if (rows.length >= LATEST_SLOTS) return;
    if (kryfoIt('latest', 'latest', c.item && c.item.id ? c.item : null, c.ref)) return;
    if (panw.some(function (ref) { return tairiazei(c, ref); })) return;

    var already = rows.some(function (r) {
      return r.item ? isChosen(r.item, c.ref) : r.ref === c.ref;
    });
    if (already) return;

    rows.push(c);
  });

  return rows;
}

function ltSlot(r, i, total){
  var it = r.item;

  if (!it) {
    return '<div class="slot">'
      + '<span class="slot-no">' + String(i + 1).padStart(2, '0') + '</span>'
      + '<img alt=""><div class="slot-text">'
      + '<p class="slot-title">' + esc(r.ref) + '</p>'
      + '<p class="slot-meta">Δεν βρέθηκε — μπορεί να είναι παλιό ή σβησμένο. '
      + 'Το site θα το προσπεράσει.</p></div>'
      // Arrows go here TOO: a row that was not recognised must still be
      // movable, otherwise it blocks the ordering of everything below
      // it.
      + '<span class="slot-acts">'
      + '<button type="button" data-lt-up="' + i + '" aria-label="Πάνω"'
      + (i === 0 ? ' disabled' : '') + '>↑</button>'
      + '<button type="button" data-lt-down="' + i + '" aria-label="Κάτω"'
      + (i === total - 1 ? ' disabled' : '') + '>↓</button>'
      + '<button type="button" data-lt-del="' + i + '" aria-label="Αφαίρεση">✕</button>'
      + '</span></div>';
  }

  var age = daysOld(it.date);
  var note = (it.who ? esc(it.who) + ' · ' : '') + when(it.date);
  if (age !== null && age >= LATEST_STALE_DAYS) {
    note += ' · <strong>' + age + ' μέρες παλιό</strong>';
  }

  var isHero = state.curation.featured && isChosen(it, state.curation.featured);
  if (isHero) {
    note += ' · <strong>είναι ήδη το πρωτοσέλιδο, δεν ξαναβγαίνει εδώ</strong>';
  }

  return '<div class="slot' + (r.auto ? ' slot--auto' : '')
    + (!r.auto && pinLixe('latest', 'latest', r.ref) ? ' slot--lixe' : '') + '">'
    + '<span class="slot-no">' + String(i + 1).padStart(2, '0') + '</span>'
    + (it.image ? '<img src="' + esc(it.image) + '" alt="">' : '<img alt="">')
    + '<div class="slot-text">'
    + '<p class="slot-title">' + esc(it.title) + '</p>'
    + '<p class="slot-meta">'
    + '<span class="tag tag--' + it.kind + '">' + TAGS[it.kind] + '</span>'
    + note + '</p></div>'
    + '<span class="slot-acts">'
    + (r.auto ? '<span class="pill pill--draft">αυτόματο</span>' : pinSima('latest', 'latest', r.ref))
    + '<button type="button" data-lt-up="' + i + '" aria-label="Πάνω"'
    + (i === 0 ? ' disabled' : '') + '>↑</button>'
    + '<button type="button" data-lt-down="' + i + '" aria-label="Κάτω"'
    + (i === total - 1 ? ' disabled' : '') + '>↓</button>'
    + '<button type="button" data-lt-del="' + i + '" aria-label="Αφαίρεση">✕</button>'
    + '</span></div>';
}

function drawLatest(){
  var box = $('[data-lt-slots]');
  var rows = ltRows();
  var pinned = ltList().length;

  var html = rows.map(function (r, i) {
    return ltSlot(r, i, rows.length);
  }).join('');

  // Safety net: if flow.json does not exist yet (no build since the
  // change), we do not leave empty slots with no explanation.
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

  var stale = rows.filter(function (r) {
    var a = r.item && daysOld(r.item.date);
    return a !== null && a >= LATEST_STALE_DAYS;
  }).length;

  var auto = rows.filter(function (r) { return r.auto; }).length;

  var note = pinned === 0
    ? 'Αυτά βγαίνουν τώρα στη ροή, με αυτή τη σειρά — όλα αυτόματα.'
    : pinned + (pinned === 1 ? ' καρφιτσωμένο' : ' καρφιτσωμένα') + ' στην κορυφή'
      + (auto ? ' και ' + auto + ' αυτόματα από κάτω' : '') + ', με αυτή τη σειρά.';

  if (auto) {
    note += ' Μόλις μετακινήσεις κάτι, κλειδώνουν όλες οι θέσεις όπως τις '
      + 'βλέπεις. Το ✕ όχι: βγάζει μόνο εκείνο, και η θέση γεμίζει με το '
      + 'επόμενο πιο πρόσφατο.';
  }
  if (pinned > LATEST_SLOTS) {
    note += ' Τα καρφιτσωμένα είναι περισσότερα από τις ' + LATEST_SLOTS
      + ' θέσεις — θα βγουν όλα, η ροή απλώς θα μακρύνει.';
  }
  if (stale) {
    note += ' ' + (stale === 1 ? 'Ένα είναι' : stale + ' είναι')
      + ' πάνω από ' + LATEST_STALE_DAYS + ' ημερών — σκόπιμο ή ξεχασμένο;';
  }

  $('[data-lt-note]').textContent = note;
  kryfaMeta(box, 'latest', 'latest', 'latest');
  autoAllButton('latest');
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

  if (at > -1) {
    list.splice(at, 1);
    kryvo('latest', ref);            // same reason as the ✕ — see kryvo()
  } else {
    // Pinned by hand again: the "not this" no longer applies.
    kryXanaOles('latest', ref);
    list.push(ref);
  }

  state.curation.latest = list;
  drawLatest();
  drawLtPicks();
  ltDirty(true);
}

function ltFix(){
  var rows = ltRows();
  if (!rows.some(function (r) { return r.auto; })) return;
  state.curation.latest = rows.map(function (r) { return r.ref; });
}

function ltRemove(i){
  var rows = ltRows();
  var r = rows[i];
  if (!r) return;

  // The "not this" is written in ALL cases — automatic slots included.
  // Otherwise the next build would put it back in the same place.
  kryvo('latest', r.ref);

  var list = ltList();
  var at = -1;
  list.forEach(function (ref, n) { if (ref === r.ref) at = n; });
  if (at > -1) list.splice(at, 1);
  state.curation.latest = list;

  drawLatest();
  drawLtPicks();
  ltDirty(true);
}

function ltMove(i, step){
  ltFix();
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
  pinSfragida('latest', state.curation.latest || []);
  kryKatharise('latest', 'latest');

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
    if (del) { ltRemove(Number(del.dataset.ltDel)); return; }

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

// News only: no podcast or video goes in the red frame.
function newsItems(){
  return state.items.filter(function (it) { return it.kind === 'news'; });
}

function mrList(){
  return (state.curation.mustRead || []).slice(0, MUST);
}

// What the homepage shows in each slot: manual picks first, then the
// automatic fill. Mirrors pickMustRead in build.js — one per category,
// so four "Οικονομία" do not come out.
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
      // What ✕ removed does not come back on its own — see kryvo().
      if (kryfoIt('mustRead', 'mustRead', it)) continue;
      if (pass === 0 && cats[it.who]) continue;   // first pass: one per category
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

    return '<div class="slot' + (r.auto ? ' slot--auto' : '')
      + (!r.auto && pinLixe('mustRead', 'mustRead', r.ref) ? ' slot--lixe' : '') + '">'
      + '<span class="slot-no">' + String(i + 1).padStart(2, '0') + '</span>'
      + body
      + '<span class="slot-acts">'
      + (r.auto ? '' : pinSima('mustRead', 'mustRead', r.ref))
      + (r.auto
        ? '<span class="pill pill--draft">αυτόματο</span>'
        : '<button type="button" data-mr-up="' + i + '" aria-label="Πάνω"'
          + (i === 0 ? ' disabled' : '') + '>↑</button>')
      // ✕ on the automatic ones TOO: "not this one" is the commonest
      // move, and before, the other three had to be pinned first.
      + '<button type="button" data-mr-del="' + esc(r.ref) + '" aria-label="Αφαίρεση">✕</button>'
      + '</span></div>';
  }).join('');

  var n = mrList().length;
  $('[data-mr-note]').textContent = n === 0
    ? 'Καμία χειροκίνητη επιλογή — το site βάζει μόνο του τα 4 πιο πρόσφατα, ένα από κάθε κατηγορία.'
    : n + ' από 4 διαλεγμένα με το χέρι· τις υπόλοιπες θέσεις τις γεμίζει το site.';

  kryfaMeta(box, 'mustRead', 'mustRead', 'mustRead');
  autoAllButton('mustread');
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
    list.splice(at, 1);                 // it was in — it comes out
    kryvo('mustRead', ref);
  } else {
    if (list.length >= MUST) {
      say('Οι τέσσερις θέσεις είναι γεμάτες. Αφαίρεσε μία πρώτα.', 'bad');
      return;
    }
    kryXanaOles('mustRead', ref);       // they picked it themselves, they mean it
    list.push(ref);
  }

  state.curation.mustRead = list;
  drawMustRead();
  drawMrPicks();
  mrDirty(true);
}

function mrRemove(ref){
  kryvo('mustRead', ref);

  var list = (state.curation.mustRead || []).slice();
  var at = -1;
  list.forEach(function (r, i) { if (r === ref) at = i; });
  if (at > -1) list.splice(at, 1);
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
  pinSfragida('mustRead', state.curation.mustRead || []);
  kryKatharise('mustRead', 'mustRead');

  say('Αποθηκεύεται…');
  api('curation', 'PUT', state.curation).then(function () {
    mrDirty(false);
    say('Αποθηκεύτηκε. Φαίνεται στο site μόλις ξαναχτιστεί (~2 λεπτά).', 'ok');
  }).catch(function (err) {
    say('Δεν αποθηκεύτηκε: ' + err.message, 'bad');
  });
}

var AD_PLACES = [
  { id: 'home-hero', name: 'Αρχική — κάτω από την κύρια είδηση', size: 'Leaderboard' },
  { id: 'home-top', name: 'Αρχική — κάτω από τη ροή', size: 'Billboard' },
  { id: 'home-mid', name: 'Αρχική — ανάμεσα σε Πρόσωπα και «Και ακόμα»', size: 'Leaderboard' },
  { id: 'home-side', name: 'Αρχική — πλαϊνή στήλη', size: 'MPU 300×250' },
  { id: 'article-mid', name: 'Μέσα στο άρθρο', size: 'Leaderboard' },
  { id: 'article-end', name: 'Τέλος άρθρου', size: 'Leaderboard' },
  { id: 'episode-mid', name: 'Σελίδα επεισοδίου', size: 'Leaderboard' },
  { id: 'episode-side', name: 'Σελίδα επεισοδίου — δεύτερη', size: 'MPU 300×250' },
  { id: 'guest-mid', name: 'Σελίδα προσώπου', size: 'Leaderboard' },
  { id: 'video-mid', name: 'Σελίδα βίντεο', size: 'Leaderboard' },
  { id: 'category-list', name: 'Λίστες ενοτήτων — ανά 20 κάρτες', size: 'Leaderboard' },
  { id: 'archive-list', name: 'Αρχείο επεισοδίων — ανά 20 κάρτες', size: 'Leaderboard' },
  { id: 'show-list', name: 'Λίστες εκπομπών — ανά 20 κάρτες', size: 'Leaderboard' },
  { id: 'footer', name: 'Υποσέλιδο — κάθε σελίδα', size: 'Leaderboard' },
];

var ad = { list: [], open: -1 };

// How many images a slideshow takes, and how long each is held.
// THE SAME numbers as build.js and admin-api.js — change them only here
// and the admin accepts what the server rejects.
var AD_SLIDES_MAX = 6;
var AD_EVERY_DEF = 5;

// Video or image? From the extension, as in build.js. A GIF counts as an
// image — it goes in an <img> and animates by itself.
function adIsVideo(src){
  return /\.mp4$/i.test(String(src || ''));
}

// A creative's thumbnail. Video needs <video>: an <img> with an mp4
// source shows a broken image, and the editor would think the upload
// failed.
function adThumb(src, cls){
  if (adIsVideo(src)) {
    return '<video class="' + cls + '" src="' + esc(src) + '"'
      + ' muted loop playsinline autoplay preload="metadata"></video>';
  }
  return '<img class="' + cls + '" src="' + esc(src) + '" alt="">';
}

// An ad's images, always as a list. The old "image" is still read, for
// the ones written before slideshows existed.
function adPics(a){
  if (Array.isArray(a.images) && a.images.length) return a.images.slice();
  return a.image ? [a.image] : [];
}

// And the reverse. ONE image is written as "image" and not as a
// single-item list: that keeps old ads exactly as they were and spares
// the file shapes it does not need.
function adPutPics(a, pics){
  var clean = pics.filter(Boolean).slice(0, AD_SLIDES_MAX);

  if (clean.length > 1) {
    a.images = clean;
    delete a.image;
    if (!a.every) a.every = AD_EVERY_DEF;
  } else {
    a.image = clean[0] || '';
    delete a.images;
    delete a.every;
  }
}

function adReady(file){
  ad.list = (file && Array.isArray(file.ads)) ? file.ads : [];
}

function adDirty(on){
  state.dirty = on;
  $('[data-save="ads"]').disabled = !on;
}

function adSay(text, kind){
  var el = $('[data-ad-state]');
  if (!text) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = text;
  if (kind) el.setAttribute('data-kind', kind); else el.removeAttribute('data-kind');
}

// Running today? Same check as build.js's adFor() — otherwise the screen
// would say "active" for something the site does not show.
function adLive(a){
  var today = new Date().toISOString().slice(0, 10);
  return a.status !== 'off'
    && adPics(a).length > 0
    && (!a.from || a.from <= today)
    && (!a.to || a.to >= today);
}

function adDrawPlaces(){
  var box = $('[data-ad-places]');

  box.innerHTML = AD_PLACES.map(function (p) {
    var here = ad.list.filter(function (a) {
      return adLive(a) && (a.places || []).indexOf(p.id) > -1;
    });

    var who = here.length
      ? here.map(function (a) { return esc(a.partner); }).join(' · ')
      : '<span class="muted">κενή — γράφει «Διαφήμιση»</span>';

    return '<div class="adplace' + (here.length ? ' is-on' : '') + '">'
      + '<div class="adplace-text">'
      + '<p class="adplace-name">' + esc(p.name) + '</p>'
      + '<p class="adplace-meta">' + esc(p.size) + ' · <code>' + esc(p.id) + '</code></p>'
      + '</div>'
      + '<p class="adplace-who">' + who
      + (here.length > 1 ? ' <span class="pill pill--draft">εναλλάξ ανά ημέρα</span>' : '')
      + '</p></div>';
  }).join('');
}

function adDrawList(){
  var box = $('[data-ad-list]');

  if (!ad.list.length) {
    box.innerHTML = '<p class="muted">Καμία διαφήμιση ακόμα. Πάτησε «Νέα διαφήμιση».</p>';
    return;
  }

  box.innerHTML = ad.list.map(function (a, i) {
    var live = adLive(a);
    var places = (a.places || []).map(function (id) {
      var p = null;
      AD_PLACES.forEach(function (x) { if (x.id === id) p = x; });
      return p ? p.name : id;
    });

    var checks = AD_PLACES.map(function (p) {
      var on = (a.places || []).indexOf(p.id) > -1;
      return '<label class="check check--tight">'
        + '<input type="checkbox" data-ad-place="' + esc(p.id) + '"' + (on ? ' checked' : '') + '>'
        + '<span>' + esc(p.name) + ' <small>' + esc(p.size) + '</small></span>'
        + '</label>';
    }).join('');

    var pics = adPics(a);

    return '<article class="adcard' + (live ? '' : ' adcard--off') + '" data-ad-i="' + i + '">'
      + '<header class="adcard-head">'
      + (pics.length
        ? adThumb(pics[0], 'adcard-pic')
        : '<span class="adcard-pic adcard-pic--empty"></span>')
      + '<div class="adcard-id">'
      + '<p class="adcard-name">' + esc(a.partner || '(χωρίς όνομα)') + '</p>'
      + '<p class="adcard-meta">'
      + (live ? '<span class="pill">παίζει τώρα</span>' : '<span class="pill pill--draft">δεν παίζει</span>')
      + (pics.length > 1 ? ' <span class="pill pill--draft">' + pics.length + ' εικόνες</span>' : '')
      + ' ' + esc(places.join(' · ') || 'καμία θέση')
      + '</p>'
      + '</div>'
      + '<span class="adcard-acts">'
      + '<button type="button" class="btn btn--tiny" data-ad-up="' + i + '"'
      + (i === 0 ? ' disabled' : '') + '>↑</button>'
      + '<button type="button" class="btn btn--tiny" data-ad-del="' + i + '">Διαγραφή</button>'
      + '</span>'
      + '</header>'

      + '<div class="row2">'
      + '<div class="field"><label>Συνεργάτης</label>'
      + '<input type="text" data-ad="partner" value="' + esc(a.partner || '') + '"'
      + ' placeholder="Το όνομα της επιχείρησης"></div>'
      + '<div class="field"><label>Σύνδεσμος</label>'
      + '<input type="text" data-ad="url" value="' + esc(a.url || '') + '" placeholder="https://…"></div>'
      + '</div>'

      + '<div class="field">'
      + '<label>Εικόνες</label>'
      + '<div class="adpics">'
      + pics.map(function (src, k) {
        return '<div class="adpic">'
          + adThumb(src, 'adpic-thumb')
          + '<span class="adpic-name">' + esc(src)
          + (adIsVideo(src) ? ' <strong>βίντεο</strong>' : '') + '</span>'
          + '<span class="adpic-acts">'
          + '<button type="button" class="btn btn--tiny" data-ad-slide-up="' + i + '"'
          + ' data-k="' + k + '"' + (k === 0 ? ' disabled' : '') + '>↑</button>'
          + '<button type="button" class="btn btn--tiny" data-ad-pic="' + i + '"'
          + ' data-k="' + k + '">Άλλαξε</button>'
          + '<button type="button" class="btn btn--tiny" data-ad-slide-del="' + i + '"'
          + ' data-k="' + k + '">✕</button>'
          + '</span></div>';
      }).join('')
      + '</div>'
      + '<div class="show-pick">'
      + (pics.some(adIsVideo)
        ? ''
        : '<button type="button" class="btn btn--ghost" data-ad-pic="' + i + '" data-k="-1">'
          + (pics.length ? 'Πρόσθεσε εικόνα' : 'Διάλεξε εικόνα') + '</button>')
      + (pics.some(adIsVideo)
        ? '<span class="hint">Βίντεο: παίζει μόνο του, χωρίς ήχο, σε επανάληψη. '
          + 'Για να γίνει slideshow, σβήσε πρώτα το βίντεο.</span>'
        : pics.length >= AD_SLIDES_MAX
          ? '<span class="hint">Έφτασες τις ' + AD_SLIDES_MAX + ' — το όριο.</span>'
          : '<span class="hint">Δύο ή περισσότερες εναλλάσσονται μόνες τους. '
            + 'Δεκτά: JPG, PNG, WebP, GIF ή ένα βίντεο MP4.</span>')
      + '</div></div>'

      // The interval shows ONLY when there is something to alternate. A
      // field that does nothing is a meaningless question — and video
      // has its own pace, its own duration.
      + (pics.length > 1 && !pics.some(adIsVideo)
        ? '<div class="field"><label>Κάθε πόσα δευτερόλεπτα αλλάζει</label>'
          + '<input type="number" min="3" max="20" step="1" data-ad="every"'
          + ' value="' + esc(String(a.every || AD_EVERY_DEF)) + '"></div>'
        : '')

      + '<div class="row2">'
      + '<div class="field"><label>Από</label>'
      + '<input type="date" data-ad="from" value="' + esc(a.from || '') + '"></div>'
      + '<div class="field"><label>Έως</label>'
      + '<input type="date" data-ad="to" value="' + esc(a.to || '') + '"></div>'
      + '</div>'

      + '<label class="check">'
      + '<input type="checkbox" data-ad="status"' + (a.status === 'off' ? '' : ' checked') + '>'
      + '<span>Ενεργή</span></label>'

      + '<p class="hint">Θέσεις:</p>'
      + '<div class="adchecks">' + checks + '</div>'
      + '</article>';
  }).join('');
}

function drawAds(){
  adDrawPlaces();
  adDrawList();
}

function adNew(){
  ad.list.unshift({
    partner: '',
    image: '',
    url: '',
    places: [],
    from: '',
    to: '',
    status: 'on',
  });
  drawAds();
  adDirty(true);
  adSay('Συμπλήρωσε όνομα, εικόνα, σύνδεσμο και τουλάχιστον μία θέση.');
}

function saveAds(){
  // The same checks as the API, but BEFORE the request leaves: the
  // editor sees which field is wrong instead of a generic error.
  for (var i = 0; i < ad.list.length; i++) {
    var a = ad.list[i];
    var no = 'Διαφήμιση ' + (i + 1) + ': ';
    if (!a.partner || !a.partner.trim()) { adSay(no + 'λείπει το όνομα του συνεργάτη.', 'bad'); return; }
    if (!adPics(a).length) { adSay(no + 'λείπει η εικόνα.', 'bad'); return; }
    if (adPics(a).length > AD_SLIDES_MAX) {
      adSay(no + 'πάνω από ' + AD_SLIDES_MAX + ' εικόνες.', 'bad'); return;
    }
    if (a.every !== undefined && !(Number(a.every) >= 3 && Number(a.every) <= 20)) {
      adSay(no + 'ο ρυθμός εναλλαγής θέλει 3 έως 20 δευτερόλεπτα.', 'bad'); return;
    }
    if (adPics(a).some(adIsVideo) && adPics(a).length > 1) {
      adSay(no + 'το βίντεο μπαίνει μόνο του, όχι μαζί με εικόνες.', 'bad'); return;
    }
    if (!/^https?:\/\//.test(a.url || '')) { adSay(no + 'ο σύνδεσμος θέλει http:// ή https://', 'bad'); return; }
    if (!(a.places || []).length) { adSay(no + 'δεν διάλεξες θέση.', 'bad'); return; }
    if (a.from && a.to && a.from > a.to) { adSay(no + 'τελειώνει πριν αρχίσει.', 'bad'); return; }
  }

  adSay('Αποθηκεύεται…');
  api('ads', 'PUT', { ads: ad.list }).then(function () {
    adDirty(false);
    drawAds();
    adSay('Αποθηκεύτηκε. Φαίνεται στο site μόλις ξαναχτιστεί (~2 λεπτά).', 'ok');
  }).catch(function (err) {
    adSay('Δεν αποθηκεύτηκε: ' + err.message, 'bad');
  });
}

function adMeasure(url){
  return new Promise(function (done) {
    if (adIsVideo(url)) {
      var v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      v.onloadedmetadata = function () {
        done(v.videoWidth && v.videoHeight ? { w: v.videoWidth, h: v.videoHeight } : null);
      };
      v.onerror = function () { done(null); };
      v.src = url;
      return;
    }

    var img = new Image();
    img.onload = function () {
      done(img.naturalWidth && img.naturalHeight
        ? { w: img.naturalWidth, h: img.naturalHeight }
        : null);
    };
    img.onerror = function () { done(null); };
    img.src = url;
  });
}

function adSetImage(i, url, slide){
  var a = ad.list[i];
  if (!a) return;

  var pics = adPics(a);
  if (slide == null || slide < 0) pics.push(url);
  else pics[slide] = url;

  adPutPics(a, pics);
  drawAds();
  adDirty(true);

  adRemeasure(i);
}

function adRemeasure(i){
  var a = ad.list[i];
  if (!a) return;

  var first = adPics(a)[0];
  if (!first) { delete a.w; delete a.h; return; }

  adMeasure(first).then(function (size) {
    if (ad.list[i] !== a) return;          // changed meanwhile
    if (size) { a.w = size.w; a.h = size.h; }
    else { delete a.w; delete a.h; }
    drawAds();
    adDirty(true);
  });
}

function wireAds(){
  $('[data-ad-new]').addEventListener('click', adNew);
  $('[data-save="ads"]').addEventListener('click', saveAds);

  var box = $('[data-ad-list]');

  box.addEventListener('click', function (e) {
    var pic = e.target.closest('[data-ad-pic]');
    if (pic) {
      pickImage({ ad: Number(pic.dataset.adPic), slide: Number(pic.dataset.k) });
      return;
    }

    var sUp = e.target.closest('[data-ad-slide-up]');
    if (sUp) {
      var sa = ad.list[Number(sUp.dataset.adSlideUp)];
      var sk = Number(sUp.dataset.k);
      if (!sa || sk <= 0) return;
      var sp = adPics(sa);
      var keep = sp[sk]; sp[sk] = sp[sk - 1]; sp[sk - 1] = keep;
      adPutPics(sa, sp);
      drawAds();
      adDirty(true);
      adRemeasure(Number(sUp.dataset.adSlideUp));
      return;
    }

    var sDel = e.target.closest('[data-ad-slide-del]');
    if (sDel) {
      var da = ad.list[Number(sDel.dataset.adSlideDel)];
      if (!da) return;
      var dp = adPics(da);
      dp.splice(Number(sDel.dataset.k), 1);
      adPutPics(da, dp);
      drawAds();
      adDirty(true);
      adRemeasure(Number(sDel.dataset.adSlideDel));
      return;
    }

    var up = e.target.closest('[data-ad-up]');
    if (up) {
      var i = Number(up.dataset.adUp);
      if (i <= 0) return;
      var tmp = ad.list[i]; ad.list[i] = ad.list[i - 1]; ad.list[i - 1] = tmp;
      drawAds();
      adDirty(true);
      return;
    }

    var del = e.target.closest('[data-ad-del]');
    if (del) {
      var at = Number(del.dataset.adDel);
      var a = ad.list[at];
      if (!a) return;
      if (!window.confirm('Να διαγραφεί η διαφήμιση «' + (a.partner || 'χωρίς όνομα') + '»;')) return;
      ad.list.splice(at, 1);
      drawAds();
      adDirty(true);
    }
  });

  box.addEventListener('input', function (e) {
    var card = e.target.closest('[data-ad-i]');
    if (!card) return;
    var a = ad.list[Number(card.dataset.adI)];
    if (!a) return;

    var f = e.target.closest('[data-ad]');
    if (f && f.dataset.ad !== 'status') {
      // The interval is a number, not text: a quoted "5" passes the
      // check today but is wrong inside the file.
      a[f.dataset.ad] = f.dataset.ad === 'every'
        ? Number(f.value)
        : f.value.trim();
      adDirty(true);
    }
  });

  // Checkboxes do not fire "input" everywhere.
  box.addEventListener('change', function (e) {
    var card = e.target.closest('[data-ad-i]');
    if (!card) return;
    var a = ad.list[Number(card.dataset.adI)];
    if (!a) return;

    var st = e.target.closest('[data-ad="status"]');
    if (st) { a.status = st.checked ? 'on' : 'off'; drawAds(); adDirty(true); return; }

    var pl = e.target.closest('[data-ad-place]');
    if (pl) {
      var id = pl.dataset.adPlace;
      if (!Array.isArray(a.places)) a.places = [];
      var at = a.places.indexOf(id);
      if (pl.checked && at < 0) a.places.push(id);
      if (!pl.checked && at > -1) a.places.splice(at, 1);
      drawAds();
      adDirty(true);
    }
  });
}

var OPINIONS = 6;

var op = {
  shown: PAGE,
  find: '',
};

function opAll(){
  return (state.raw.news || [])
    .filter(function (a) { return a.category === 'Απόψεις'; })
    .sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
}

function opList(){
  return (state.curation.opinions || []).slice();
}

// The portrait the public sees: what was set here first, then whatever
// came down from newshub.gr. Same order as the build's writerPhoto().
function opFace(a){
  var name = a.author && a.author.name ? a.author.name : '';
  if (name && wr.photos[name]) return wr.photos[name];
  return a.author && a.author.photo ? a.author.photo : '';
}

// What the homepage will show: picked first, then the most recent.
function opPreview(){
  var all = opAll();
  var rows = opList().map(function (ref) {
    var hit = null;
    all.forEach(function (a) { if (!hit && isChosen({ id: a.id, ref: a.url }, ref)) hit = a; });
    return { ref: ref, item: hit, auto: false };
  });

  var taken = {};
  rows.forEach(function (r) { if (r.item) taken[r.item.url] = true; });

  for (var i = 0; i < all.length && rows.length < OPINIONS; i++) {
    if (taken[all[i].url]) continue;
    // What ✕ removed does not come back on its own — see kryvo().
    if (kryfoIt('opinions', 'opinions', { id: all[i].id, ref: all[i].url })) continue;
    taken[all[i].url] = true;
    rows.push({ ref: all[i].url, item: all[i], auto: true });
  }

  return rows.slice(0, OPINIONS);
}

function opSlot(r, i, total){
  var a = r.item;

  var body = a
    ? (opFace(a)
      ? '<img src="' + esc(opFace(a)) + '" alt="">'
      : '<img alt="">')
      + '<div class="slot-text">'
      + '<p class="slot-title">' + esc(a.title) + '</p>'
      + '<p class="slot-meta">'
      + (a.author && a.author.name ? esc(a.author.name) + ' · ' : 'χωρίς υπογραφή · ')
      + when(a.date) + '</p></div>'
    : '<img alt=""><div class="slot-text"><p class="slot-title">' + esc(r.ref) + '</p>'
      + '<p class="slot-meta">Δεν βρέθηκε — μπορεί να έφυγε από τη ροή. '
      + 'Το site θα βάλει άλλη.</p></div>';

  return '<div class="slot' + (r.auto ? ' slot--auto' : '')
    + (!r.auto && pinLixe('opinions', 'opinions', r.ref) ? ' slot--lixe' : '') + '">'
    + '<span class="slot-no">' + String(i + 1).padStart(2, '0') + '</span>'
    + body
    + '<span class="slot-acts">'
    + (r.auto ? '<span class="pill pill--draft">αυτόματο</span>' : pinSima('opinions', 'opinions', r.ref))
    + '<button type="button" data-op-up="' + i + '" aria-label="Πάνω"'
    + (i === 0 ? ' disabled' : '') + '>↑</button>'
    + '<button type="button" data-op-down="' + i + '" aria-label="Κάτω"'
    + (i === total - 1 ? ' disabled' : '') + '>↓</button>'
    + '<button type="button" data-op-del="' + i + '" aria-label="Αφαίρεση">✕</button>'
    + '</span></div>';
}

function drawOpinions(){
  var rows = opPreview();

  $('[data-op-slots]').innerHTML = rows.map(function (r, i) {
    return opSlot(r, i, rows.length);
  }).join('');

  var n = opList().length;
  var all = opAll().length;

  var note = n === 0
    ? 'Καμία χειροκίνητη επιλογή — βγαίνουν οι ' + OPINIONS + ' πιο πρόσφατες.'
    : n + (n === 1 ? ' διαλεγμένη' : ' διαλεγμένες') + ' με το χέρι, με αυτή τη σειρά.';

  note += ' Συνολικά ' + all + ' απόψεις στο αρχείο μας.';
  if (rows.length < 3) {
    note += ' ΠΡΟΣΟΧΗ: κάτω από τρεις, η ενότητα δεν βγαίνει καθόλου στην αρχική.';
  }

  $('[data-op-note]').textContent = note;
  kryfaMeta($('[data-op-slots]'), 'opinions', 'opinions', 'opinions');
  autoAllButton('apopseis');
}

// What it shows becomes an explicit pick as soon as anything is touched —
// same reason as "Τελευταία", see ltFix().
function opFix(){
  var rows = opPreview();
  if (!rows.some(function (r) { return r.auto; })) return;
  state.curation.opinions = rows.map(function (r) { return r.ref; });
}

function opMove(i, step){
  opFix();
  var list = opList();
  var to = i + step;
  if (i < 0 || i >= list.length || to < 0 || to >= list.length) return;
  var tmp = list[i]; list[i] = list[to]; list[to] = tmp;
  state.curation.opinions = list;
  drawOpinions();
  opDirty(true);
}

function opRemove(i){
  var rows = opPreview();
  var r = rows[i];
  if (!r) return;

  kryvo('opinions', r.ref);

  var list = opList();
  var at = list.indexOf(r.ref);
  if (at > -1) list.splice(at, 1);
  state.curation.opinions = list;

  drawOpinions();
  drawOpPicks();
  opDirty(true);
}

function opToggle(url){
  var list = opList();
  var at = list.indexOf(url);
  if (at > -1) {
    list.splice(at, 1);
    kryvo('opinions', url);
  } else {
    kryXanaOles('opinions', url);       // they picked it themselves, they mean it
    list.push(url);
  }
  state.curation.opinions = list;
  drawOpinions();
  drawOpPicks();
  opDirty(true);
}

function drawOpPicks(){
  var box = $('[data-op-picks]');
  var chosen = opList();

  var hits = opAll().filter(function (a) {
    if (!op.find) return true;
    var who = a.author && a.author.name ? a.author.name : '';
    return flat(a.title + ' ' + who).indexOf(op.find) > -1;
  });

  if (!hits.length) {
    box.innerHTML = '<p class="muted">Καμία άποψη δεν ταιριάζει.</p>';
    $('[data-op-more]').hidden = true;
    return;
  }

  box.innerHTML = hits.slice(0, op.shown).map(function (a) {
    var on = chosen.indexOf(a.url) > -1;
    var face = opFace(a);
    return '<button type="button" class="pick' + (on ? ' is-on' : '') + '"'
      + ' data-op-add="' + esc(a.url) + '">'
      + (face ? '<img src="' + esc(face) + '" alt="" loading="lazy">' : '<img alt="">')
      + '<span><span class="pick-title">' + esc(a.title) + '</span>'
      + '<span class="pick-meta">'
      + (a.author && a.author.name ? esc(a.author.name) + ' · ' : '')
      + when(a.date) + '</span></span></button>';
  }).join('');

  $('[data-op-more]').hidden = hits.length <= op.shown;
}

function opDirty(on){
  state.dirty = on;
  $('[data-save="apopseis"]').disabled = !on;
}

function saveOpinions(){
  pinSfragida('opinions', state.curation.opinions || []);
  kryKatharise('opinions', 'opinions');

  say('Αποθηκεύεται…');
  api('curation', 'PUT', state.curation).then(function () {
    opDirty(false);
    say('Αποθηκεύτηκε. Φαίνεται στο site μόλις ξαναχτιστεί (~2 λεπτά).', 'ok');
  }).catch(function (err) {
    say('Δεν αποθηκεύτηκε: ' + err.message, 'bad');
  });
}

var wr = { photos: {}, ipografes: {} };

function wrReady(file){
  wr.photos = (file && typeof file.photos === 'object' && !Array.isArray(file.photos))
    ? file.photos : {};
  wr.ipografes = (file && typeof file.ipografes === 'object' && !Array.isArray(file.ipografes))
    ? file.ipografes : {};
}

var me = { email: '' };

function ipografiMou(){
  return (me.email && wr.ipografes[me.email]) || '';
}

// Names already in circulation: those signing our own articles, and
// those declared by accounts. Clicked instead of typed.
function ipografesGnostes(){
  var seen = {};

  (art.list || []).forEach(function (a) {
    var n = (a.author || '').trim();
    if (n) seen[n] = true;
  });

  Object.keys(wr.ipografes).forEach(function (email) {
    var n = (wr.ipografes[email] || '').trim();
    if (n) seen[n] = true;
  });

  return Object.keys(seen).sort(function (x, y) { return x.localeCompare(y, 'el'); });
}

function drawIpografes(){
  var box = $('[data-art-ipografes]');
  if (!box) return;

  var names = ipografesGnostes();
  var tora = ($('[data-art="author"]').value || '').trim();

  box.innerHTML = names.map(function (n) {
    return '<button type="button" class="chip' + (n === tora ? ' is-on' : '')
      + '" data-ipografi="' + esc(n) + '">' + esc(n) + '</button>';
  }).join('');
}

function thimisouIpografi(onoma){
  var n = (onoma || '').trim();
  if (!me.email || !n || wr.ipografes[me.email]) return Promise.resolve();

  wr.ipografes[me.email] = n;
  return wrSave().catch(function (err) {
    // We do not fail the article save over this. The article is saved;
    // at worst the name is typed again next time.
    delete wr.ipografes[me.email];
    console.warn('Η υπογραφή δεν θυμήθηκε:', err.message);
  });
}

// Everyone who signs an opinion piece, with their counts.
function wrPeople(){
  var seen = {};
  opAll().forEach(function (a) {
    if (!a.author || !a.author.name) return;
    var name = a.author.name;
    if (!seen[name]) seen[name] = { name: name, n: 0, photo: a.author.photo || '', url: a.author.url || '' };
    seen[name].n++;
  });

  return Object.keys(seen)
    .sort(function (x, y) { return seen[y].n - seen[x].n || x.localeCompare(y, 'el'); })
    .map(function (k) { return seen[k]; });
}

function drawWriters(){
  var box = $('[data-writers]');
  var people = wrPeople();

  if (!people.length) {
    box.innerHTML = '<p class="muted">Καμία άποψη με υπογραφή ακόμα.</p>';
    return;
  }

  box.innerHTML = people.map(function (p) {
    var mine = wr.photos[p.name];
    var face = mine || p.photo;

    return '<article class="writer" data-writer="' + esc(p.name) + '">'
      + (face
        ? '<img class="writer-face" src="' + esc(face) + '" alt="" loading="lazy">'
        : '<span class="writer-face writer-face--empty"></span>')
      + '<div class="writer-text">'
      + '<p class="writer-name">' + esc(p.name) + '</p>'
      + '<p class="writer-meta">' + p.n + (p.n === 1 ? ' άποψη' : ' απόψεις')
      + (mine ? ' · δική μας φωτογραφία' : (p.photo ? ' · φωτογραφία του newshub.gr' : ' · χωρίς φωτογραφία'))
      + '</p>'
      + '</div>'
      + '<span class="writer-acts">'
      + '<button type="button" class="btn btn--ghost" data-wr-pick="' + esc(p.name) + '">'
      + (mine ? 'Άλλαξε' : 'Βάλε φωτογραφία') + '</button>'
      + (mine
        ? '<button type="button" class="btn btn--ghost" data-wr-clear="' + esc(p.name) + '">Επαναφορά</button>'
        : '')
      + '</span></article>';
  }).join('');
}

// BOTH together. The file is written whole every time, so sending only
// the portraits would wipe the bylines — and the reverse.
function wrSave(){
  return api('writers', 'PUT', { photos: wr.photos, ipografes: wr.ipografes });
}

function wrSetPhoto(name, url){
  var was = wr.photos[name];
  wr.photos[name] = url;
  drawWriters();
  drawOpinions();
  drawOpPicks();

  wrSave().then(function () {
    say('Η φωτογραφία του «' + name + '» αποθηκεύτηκε.', 'ok');
  }).catch(function (err) {
    // Back to the previous state — otherwise the screen claims a save
    // that did not happen. Same rule as the standard images.
    if (was) wr.photos[name] = was; else delete wr.photos[name];
    drawWriters();
    say('Δεν αποθηκεύτηκε: ' + err.message, 'bad');
  });
}

function wrClearPhoto(name){
  var was = wr.photos[name];
  delete wr.photos[name];
  drawWriters();
  drawOpinions();

  wrSave().then(function () {
    say('Επανήλθε η φωτογραφία του newshub.gr.', 'ok');
  }).catch(function (err) {
    if (was) wr.photos[name] = was;
    drawWriters();
    say('Δεν αποθηκεύτηκε: ' + err.message, 'bad');
  });
}

function wireOpinions(){
  $('[data-op-slots]').addEventListener('click', function (e) {
    var del = e.target.closest('[data-op-del]');
    if (del) { opRemove(Number(del.dataset.opDel)); return; }

    var up = e.target.closest('[data-op-up]');
    if (up) { opMove(Number(up.dataset.opUp), -1); return; }

    var down = e.target.closest('[data-op-down]');
    if (down) opMove(Number(down.dataset.opDown), 1);
  });

  $('[data-op-picks]').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-op-add]');
    if (btn) opToggle(btn.dataset.opAdd);
  });

  $('[data-op-find]').addEventListener('input', function (e) {
    op.find = flat(e.target.value);
    op.shown = PAGE;
    drawOpPicks();
  });

  $('[data-op-more]').addEventListener('click', function () {
    op.shown += PAGE;
    drawOpPicks();
  });

  $('[data-save="apopseis"]').addEventListener('click', saveOpinions);

  $('[data-writers]').addEventListener('click', function (e) {
    var pick = e.target.closest('[data-wr-pick]');
    if (pick) { pickImage({ writer: pick.dataset.wrPick }); return; }

    var clear = e.target.closest('[data-wr-clear]');
    if (clear) wrClearPhoto(clear.dataset.wrClear);
  });
}

function wireMustRead(){
  $('[data-mr-slots]').addEventListener('click', function (e) {
    var del = e.target.closest('[data-mr-del]');
    if (del) { mrRemove(del.dataset.mrDel); return; }

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

// The site's categories. Same as the build's — change them there and
// they change here.
var CATS = ['Κρήτη', 'Ελλάδα', 'Κόσμος', 'Οικονομία', 'Γεωπολιτική', 'Πολιτική',
  'Υγεία', 'Αθλητικά', 'Agronews', 'Tech-Hub', 'Ιστορία', 'Πολιτισμός',
  'Περιβάλλον', 'Απόψεις'];

var GREEK = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th',
  ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p',
  ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
};

// The page URL, from the title. Latin: a Greek filename travels as
// %CF%86%CE%B1… and one tool in the middle that fails to decode it is
// enough to break the link.
function slugify(s){
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split('').map(function (ch) { return GREEK[ch] || ch; }).join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

// <input type="datetime-local"> wants "2026-11-04T10:00" in LOCAL time,
// while we store ISO in UTC. The two conversions.
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
  list: [],        // every article
  open: null,      // the one being written now
  index: -1,       // its place in list, or -1 for a new one
  dirty: false,
  pending: null,   // where the picked image goes
  finding: null,   // which block is waiting for an episode or a video
  ready: false,    // have the articles loaded? before that we do not touch the list
};

function artSay(text, kind){
  var el = $('[data-art-state]');
  el.textContent = text || '';
  if (kind) el.setAttribute('data-kind', kind); else el.removeAttribute('data-kind');
}

function artDirty(on){
  art.dirty = on;
  state.dirty = on;      // goes through the same "do not leave" catch
  if (on) artSay('Μη αποθηκευμένες αλλαγές', 'warn');

  // Every change goes straight to the browser's copy. It costs nothing —
  // an article is a few kilobytes — and it is the difference between
  // "write it again" and "here it is, carry on".
  if (on) draftSave();
}

// ---- the list ----

function drawArtList(){
  var box = $('[data-art-list]');

  if (!art.list.length) {
    box.innerHTML = '<p class="muted">Κανένα άρθρο ακόμα. Πάτησε «Νέο άρθρο».</p>';
    return;
  }

  // Most recent first — those are the ones being worked on.
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

// ---- open / close ----

function blankArticle(){
  return {
    // The byline comes ready from the account. Freely editable — an
    // outside contributor has no account.
    id: '', title: '', summary: '', category: CATS[0], author: ipografiMou(),
    date: new Date().toISOString(), image: '', imageCaption: '',
    status: 'draft', body: [{ type: 'p', text: '' }],
  };
}

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
    // Full or locked storage (private window). Not a reason to stop
    // writing — we just have no safety net.
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

// Asks once, when the Articles tab opens.
function draftOffer(){
  // Before the articles load we cannot open an existing one: art.list is
  // still empty and openArticle would throw.
  if (!art.ready) return;

  var d = draftRead();
  if (!d || art.open) return;

  // The article being edited may have been deleted meanwhile.
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
  // A copy, not the same object: if the editor leaves without saving,
  // the list must not have changed already.
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

// The form, from art.open. Separate from openArticle because the draft
// restore needs it too, and that opens nothing new.
function fillArticle(){
  $('[data-art="title"]').value = art.open.title || '';
  $('[data-art="category"]').value = art.open.category || CATS[0];
  // An old article with no byline gets one filled in as well: the first
  // articles were written before the field existed, and without a byline
  // they never get a journalist page.
  $('[data-art="author"]').value = art.open.author || ipografiMou();
  $('[data-art="date"]').value = toLocalInput(art.open.date);
  $('[data-art="status"]').value = art.open.status || 'draft';
  $('[data-art="image"]').value = art.open.image || '';
  $('[data-art="imageCaption"]').value = art.open.imageCaption || '';

  // Checked if this article is already the homepage lead.
  $('[data-art-top]').checked =
    !!art.open.id && state.curation.featured === artRef(art.open.id);

  drawSlug();
  drawThumb();
  drawBlocks();
  drawTop();
  drawIpografes();
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

function previewHtml(a){
  var esc2 = esc;

  var blocks = (a.body || []).map(function (p) {
    if (p.type === 'h') return '<h2 class="art-sub">' + esc2(p.text || '') + '</h2>';
    if (p.type === 'p') return '<p>' + esc2(p.text || '') + '</p>';

    if (p.type === 'image' && p.src) {
      return '<figure class="art-inline"><img src="' + esc2(p.src) + '" alt="' + esc2(p.alt || '') + '">'
        + (p.caption ? '<figcaption>' + esc2(p.caption) + '</figcaption>' : '')
        + '</figure>';
    }

    if (p.type === 'embed' && p.id) {
      if (p.kind === 'youtube') {
        return '<figure class="art-inline">'
          + '<img src="https://i.ytimg.com/vi/' + esc2(p.id) + '/hqdefault.jpg" alt="">'
          + '<figcaption>Βίντεο YouTube — παίζει στη δημοσιευμένη σελίδα</figcaption>'
          + '</figure>';
      }
      if (p.kind === 'episode') {
        return '<p class="art-sub">🎧 Επεισόδιο ' + esc2(p.id)
          + (p.play ? ' — με player' : ' — ως κάρτα') + '</p>';
      }
    }

    return '';
  }).filter(Boolean).join('\n');

  var words = (a.body || []).reduce(function (n, p) {
    return n + String(p.text || '').split(/\s+/).filter(Boolean).length;
  }, 0);
  var minutes = Math.max(1, Math.round(words / 200));

  var byline = [a.author || '', when(a.date)].filter(Boolean).join(' · ');

  return '<!doctype html><html lang="el"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<link rel="stylesheet" href="/styles.css">'
    + '<style>body{padding:2rem 0}</style>'
    + '</head><body>'
    + '<main class="art"><article class="art-wrap">'
    + '<header class="art-head">'
    + (a.category ? '<p class="card-label">' + esc2(a.category) + '</p>' : '')
    + '<h1 class="art-title">' + esc2(a.title || 'Χωρίς τίτλο') + '</h1>'
    + '<p class="art-meta">' + esc2(byline) + ' · ' + minutes + '′ ανάγνωση</p>'
    + '</header>'
    + (a.image
      ? '<figure class="art-figure"><img src="' + esc2(a.image) + '" alt="">'
        + (a.imageCaption ? '<figcaption>' + esc2(a.imageCaption) + '</figcaption>' : '')
        + '</figure>'
      : '')
    + '<div class="art-body">' + blocks + '</div>'
    + '</article></main>'
    + '</body></html>';
}

function openPreview(){
  // FIRST collect what was typed: otherwise the preview shows the last
  // save and the editor hunts for why "nothing changed".
  if (!art.open) return;
  collect();

  var box = $('[data-preview]');
  var frame = $('[data-preview-frame]');

  box.hidden = false;
  frame.srcdoc = previewHtml(art.open);
}

function closePreview(){
  $('[data-preview]').hidden = true;
  // Emptied, so nothing is left playing inside it.
  $('[data-preview-frame]').srcdoc = '';
}

function drawThumb(){
  var box = $('[data-art-thumb]');
  var url = art.open.image;
  box.hidden = !url;
  if (!url) return;

  var img = box.querySelector('img');
  img.onerror = function () {
    artSay('Η φωτογραφία δεν βρέθηκε: ' + url + ' — διάλεξέ την από τις «Φωτογραφίες».', 'bad');
  };
  img.onload = function () {
    if ($('[data-art-state]').getAttribute('data-kind') === 'bad') artSay('');
  };
  img.src = url;
}

// ---- the blocks ----

var BLOCK_NAME = {
  p: 'Παράγραφος', h: 'Υπότιτλος', image: 'Φωτογραφία',
  youtube: 'Βίντεο YouTube', episode: 'Επεισόδιο',
};

// A block as the file stores it -> which kind of box we show.
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
        + '<label class="blockopt"><input type="checkbox" data-bx="play"'
        + (b.play ? ' checked' : '') + '> Να ακούγεται μέσα στο άρθρο</label>'
        + '<p class="hint">Διάλεξε από τα επεισόδια — ο κωδικός μπαίνει μόνος του. '
        + 'Χωρίς το τσεκ, μπαίνει μόνο κάρτα που οδηγεί στη σελίδα του επεισοδίου.</p>';
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

  // Cursor into the new box: otherwise the editor hits "+ Παράγραφος"
  // and then has to hunt for where it went.
  var boxes = $$('.block');
  var last = boxes[boxes.length - 1];
  if (last) {
    var f = last.querySelector('textarea, input');
    if (f) f.focus();
    last.scrollIntoView({ block: 'center' });
  }
}

// From a YouTube link we keep the id ONLY. The editor pastes whatever
// the browser gives them — watch?v=, youtu.be/, /embed/ — and all of it
// has to end up the same.
function youtubeId(v){
  var s = String(v || '').trim();
  var m = s.match(/(?:v=|youtu\.be\/|\/embed\/|\/shorts\/)([\w-]{6,20})/);
  if (m) return m[1];
  return /^[\w-]{6,20}$/.test(s) ? s : s;
}

// ---- saving ----

function collect(){
  var a = art.open;

  a.title = $('[data-art="title"]').value.trim();
  // The summary is NO longer written here — the site derives it from the
  // first paragraph (ownSummary in build.js). Anything written by hand
  // earlier stays untouched in a.summary and still wins.
  a.category = $('[data-art="category"]').value;
  a.author = $('[data-art="author"]').value.trim();
  a.date = fromLocalInput($('[data-art="date"]').value) || new Date().toISOString();
  a.status = $('[data-art="status"]').value;
  a.image = $('[data-art="image"]').value.trim();
  a.imageCaption = $('[data-art="imageCaption"]').value.trim();

  // The id locks on the FIRST save and never changes again. Otherwise a
  // fix to the title would change the URL of an article already in
  // circulation — and every link to it would break.
  if (!a.id) a.id = slugify(a.title);

  var out = JSON.parse(JSON.stringify(a));

  out.body = (a.body || []).filter(function (b) {
    if (b.type === 'p' || b.type === 'h') return String(b.text || '').trim();
    if (b.type === 'image') return String(b.src || '').trim();
    if (b.type === 'embed') return String(b.id || '').trim();
    return false;
  });

  return out;
}

// The URL of one of our own articles, as the build writes it.
function artRef(id){ return 'arthro/' + id + '.html'; }

// Shows the checkbox only on a published article, and checked if this
// article is ALREADY the homepage lead — so that it tells the truth and
// the editor does not have to go and look.
function drawTop(){
  if (!art.open) return;

  var on = $('[data-art="status"]').value === 'published';
  var box = $('[data-art-top]');

  $('[data-art-top-wrap]').hidden = !on;
  if (!on) box.checked = false;

  $('[data-art-top-hint]').hidden = !on || !box.checked;
}

function syncFeatured(a, want){
  var ref = artRef(a.id);
  var isNow = state.curation.featured === ref;
  var should = !!want && a.status === 'published';

  if (should === isNow) return Promise.resolve('');

  var back = null;

  if (should) {
    // Whatever this article pushed out goes into the history — see choose().
    if (state.curation.featured) {
      heroPush(state.curation.featured, state.curation.featuredHero);
    }
    state.curation.featured = ref;
    state.curation.featuredUntil = metaApo(7);
    // The manual image belongs to the previous pick — see choose().
    state.curation.featuredHero = '';
  } else {
    // It is coming out — so we go back to the previous one, not the most
    // recent. Same rule as the button: see autoAgain().
    state.curation.featured = '';
    state.curation.featuredHero = '';
    back = heroRestore();
    if (!back) state.curation.featuredUntil = '';
  }

  return api('curation', 'PUT', state.curation).then(function () {
    $('[data-until]').value = state.curation.featuredUntil || '';
    drawNow();
    drawPicks();
    if (should) return ' Μπήκε και στο πρωτοσέλιδο.';
    return back
      ? ' Βγήκε από το πρωτοσέλιδο — γύρισε το προηγούμενο: «' + heroTitlos(back) + '».'
      : ' Βγήκε από το πρωτοσέλιδο.';
  });
}

function saveArticle(){
  var a = collect();

  if (!a.title) { artSay('Ο τίτλος λείπει.', 'bad'); return; }
  if (!a.id) { artSay('Ο τίτλος δεν δίνει έγκυρη διεύθυνση.', 'bad'); return; }
  if (!a.body.length) { artSay('Το άρθρο δεν έχει κείμενο.', 'bad'); return; }

  // Two articles with the same id would overwrite each other.
  var clash = art.list.some(function (other, i) {
    return i !== art.index && other.id === a.id;
  });
  if (clash) { artSay('Υπάρχει ήδη άρθρο με αυτή τη διεύθυνση. Άλλαξε τον τίτλο.', 'bad'); return; }

  // Instead of a summary we require TEXT: the summary now comes from it,
  // so an empty article also means an empty snippet in Google.
  if (a.status === 'published' && !a.body.some(function (p) { return p.text && p.text.trim(); })) {
    artSay('Γράψε κείμενο πριν δημοσιεύσεις — από την πρώτη παράγραφο βγαίνει και η περίληψη.', 'bad');
    return;
  }

  // The lead MUST have an image: without one the build ignores the pick
  // and falls back to the automatic choice, with nobody seeing it — the
  // editor thinks they set it and they did not.
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
    // The article now exists — so it can also be deleted. Without this
    // the editor had to go out to the list and reopen it.
    $('[data-art-delete]').hidden = false;
    artDirty(false);
    // Really saved — the safety net is no longer needed, and if it stays
    // it will offer stale text next time.
    draftClear();
    // And the byline, so it is not typed again next time.
    thimisouIpografi(a.author).then(drawIpografes);
    drawArtList();
    // The lead list now knows about the new or changed article.
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
    // A deleted article cannot stay as the homepage lead: the link would
    // lead to a page that does not exist.
    return syncFeatured(a, false);
  }).then(function () {
    artDirty(false);
    draftClear();
    closeArticle();
  }).catch(function (err) {
    artSay('Δεν διαγράφηκε: ' + err.message, 'bad');
  });
}

function pickImage(target){
  art.pending = target;
  sayPick('');
  $('[data-picker]').hidden = false;
  $('[data-pick-find]').value = '';
  lib.find.pick = '';

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

  // The face portrait BEFORE the art.open check: there is no open
  // article when the picker is called from the Faces tab, and the old
  // check closed the window without doing anything.
  if (t.person) {
    ppSetPhoto(t.person, url);
    pickClose();
    drawPeople();
    return;
  }

  // An ad's image, from the Ads tab.
  if (t.ad != null) {
    adSetImage(t.ad, url, t.slide);
    pickClose();
    return;
  }

  // A columnist's portrait, from the Opinion tab.
  if (t.writer) {
    wrSetPhoto(t.writer, url);
    pickClose();
    return;
  }

  // A show's poster, from the Shows tab. Same reason: there is no open
  // article, and the check below would close the window without
  // changing anything.
  if (t.show) {
    shSetArt(t.show, url);
    pickClose();
    drawShows();
    return;
  }

  // Same for an episode photo, from the Pairing tab: no open article
  // there either.
  if (t.episode) {
    prSet(t.episode, { image: url });
    pickClose();
    drawPairs();
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
  // One image = clear intent: it goes straight in. Several at once means
  // they are filling the library, so they pick themselves.
      if (done === 1 && url) applyPick(url);
    },
  });
}

var FINDER_MAX = 60;     // as many as we show; beyond that nobody looks

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

  // Second caller: the Gaps tab. The picker does not know where the
  // answer goes — whoever opened it tells it.
  if (t.take) { t.take(id); findClose(); return; }

  if (!art.open) { findClose(); return; }

  var b = art.open.body[t.block];
  if (b) b.id = id;

  drawBlocks();
  artDirty(true);
  findClose();
}

function wireRefresh(){
  var btn = $('[data-refresh]');
  if (!btn) return;

  btn.addEventListener('click', function () {
    btn.disabled = true;
    say('Ζητήθηκαν τα νέα…');

    fetch('/api/refresh', { method: 'POST' }).then(readJson, netFail).then(function () {
      say('Ξεκίνησε. Τα νέα επεισόδια και οι ειδήσεις θα φανούν εδώ σε '
        + '1-2 λεπτά — ανανέωσε τη σελίδα τότε.', 'ok');
      // While it runs, a second press adds nothing.
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
    // Delete first: the button sits ON the card that selects, and
    // without this a click on ✕ would also insert the image.
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

  $('[data-art-preview]').addEventListener('click', openPreview);

  $$('[data-preview-close]').forEach(function (el) {
    el.addEventListener('click', closePreview);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('[data-preview]').hidden) closePreview();
  });

  // Desktop or phone. Phones are half the site's traffic, and an article
  // that reads comfortably at 1,200 pixels can be a wall of text at
  // 390.
  $('[data-preview] .preview-sizes').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    $('[data-preview-frame]').classList.toggle('preview-frame--phone',
      chip.dataset.prevSize === 'phone');
    $$('[data-preview] .preview-sizes .chip').forEach(function (c) {
      c.classList.toggle('is-on', c === chip);
    });
  });
  $('[data-art-delete]').addEventListener('click', deleteArticle);

  // The header fields — one listener for all of them.
  $('[data-art-editor]').addEventListener('input', function (e) {
    var f = e.target.closest('[data-art]');
    if (!f) return;
    artDirty(true);
    if (f.dataset.art === 'title') { art.open.title = f.value; drawSlug(); }
    if (f.dataset.art === 'image') { art.open.image = f.value; drawThumb(); }
    // A draft cannot be the lead — the checkbox hides.
    if (f.dataset.art === 'status') drawTop();
    // Which chip is lit follows what is being typed.
    if (f.dataset.art === 'author') drawIpografes();
  });

  // The chips with the known names.
  $('[data-art-ipografes]').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ipografi]');
    if (!b) return;

    var pedio = $('[data-art="author"]');
    // A second press on the same one clears it: an article with no
    // byline is legitimate — an announcement, say — and without this
    // there is no way to undo it.
    pedio.value = pedio.value.trim() === b.dataset.ipografi ? '' : b.dataset.ipografi;
    artDirty(true);
    drawIpografes();
  });

  $('[data-art-top]').addEventListener('change', function () {
    drawTop();
    artDirty(true);
  });

  // The blocks — one listener as well.
  var blocks = $('[data-art-blocks]');

  blocks.addEventListener('input', function (e) {
    var field = e.target.closest('[data-bx]');
    var box = e.target.closest('[data-bi]');
    if (!field || !box) return;

    var b = art.open.body[Number(box.dataset.bi)];

    // Safety catch: if the screen shows a block that is no longer in
    // memory, the keystroke would vanish silently. Better to say so.
    if (!b) {
      artSay('Κάτι ξεσυγχρονίστηκε. Πάτησε «Πίσω στη λίστα» και ξανάνοιξε το άρθρο.', 'bad');
      return;
    }

    var key = field.dataset.bx;
    if (field.type === 'checkbox') {
      b[key] = field.checked;
    } else {
      b[key] = key === 'id' && blockKind(b) === 'youtube' ? youtubeId(field.value) : field.value;
    }
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

  // When the cursor leaves the field — NOT on every keystroke, which
  // would lose the caret position mid-word.
  blocks.addEventListener('change', function (e) {
    var box = e.target.closest('[data-bi]');
    if (!box) return;
    var b = art.open.body[Number(box.dataset.bi)];
    if (!b) return;

    // The YouTube link becomes an id ON SCREEN too. Without this the
    // editor still sees what they pasted and thinks it was not taken.
    if (e.target.dataset.bx === 'id' && blockKind(b) === 'youtube') {
      e.target.value = b.id;
    }

    // The image preview needs redrawing.
    if (e.target.dataset.bx === 'src') drawBlocks();
  });

  $$('[data-add]').forEach(function (btn) {
    btn.addEventListener('click', function () { addBlock(btn.dataset.add); });
  });

  $('[data-art-pickimg]').addEventListener('click', function () { pickImage({ main: true }); });
}

var pp = {
  list: [],        // the people as the site sees them
  out: [],         // those struck out as "not a person"
  sug: [],         // merge suggestions
  file: null,      // people-aliases.json, as it will be saved
  shown: PAGE,
  find: '',
  filter: '',
  openName: null,
  mfind: '',       // the search inside "merge with…"
};

// The file may not have the keys we are touching yet.
function ppReady(file){
  var f = file && typeof file === 'object' ? file : {};
  if (!f.aliases || typeof f.aliases !== 'object') f.aliases = {};
  if (!f.roles || typeof f.roles !== 'object') f.roles = {};
  if (!f.photos || typeof f.photos !== 'object') f.photos = {};
  if (!Array.isArray(f.not_people)) f.not_people = [];
  if (!Array.isArray(f.not_aliases)) f.not_aliases = [];
  return f;
}

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

// The portrait. Same pattern as the role — and the same reason not to
// compare with ===: the spelling in the file may not be the one the site
// shows today.
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

// Who this name was merged with NOW, in this session. Anything already
// merged never reaches here: people.json hands it over merged.
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

// ---- the actions ----

function ppSetRole(name, text){
  // We delete whatever exists under another spelling, or two records
  // remain for the same person and whichever wins, wins.
  Object.keys(pp.file.roles).forEach(function (k) {
    if (ppSame(k, name)) delete pp.file.roles[k];
  });
  if (text.trim()) pp.file.roles[name] = text.trim();
  ppDirty(true);
}

function ppOut(name){
  if (!ppIsOut(name)) pp.file.not_people.push(name);
  // Anything that is not a person has no role.
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

  // The role follows, if the other has none of its own.
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

function ppSplit(canonical, variant){
  var itan = false;

  Object.keys(pp.file.aliases).forEach(function (k) {
    if (!ppSame(k, canonical)) return;
    var before = (pp.file.aliases[k] || []).length;
    pp.file.aliases[k] = (pp.file.aliases[k] || []).filter(function (v) {
      return !ppSame(v, variant);
    });
    if (pp.file.aliases[k].length !== before) itan = true;
    if (!pp.file.aliases[k].length) delete pp.file.aliases[k];
  });

  if (!itan) {
    var ipirxe = pp.file.not_aliases.some(function (pair) {
      return pair && ppSame(pair[0], canonical) && ppSame(pair[1], variant);
    });
    if (!ipirxe) pp.file.not_aliases.push([canonical, variant]);
  }

  ppDirty(true);
  drawPeople();
}

// "No, a different person". Written down, so the suggestion does not
// return on the next build — otherwise the editor rejects it forever.
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

// ---- the list ----

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

  // Deleted ones do not exist in people.json as people — they come
  // separately, so the editor can take a mistake back.
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

// Who it can merge into. Without a search we show nothing: 373 names in
// a list help nobody.
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

// ---- the suggestions ----

function drawSuggest(box){
  // Anything answered in this session leaves at once: a merge shows in
  // aliases, a rejection in not_aliases.
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
    // Suggestions first: they have buttons of their own.
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

    // THE SAME picker the articles have: folders, search, ★ standard,
    // and drag-and-drop upload. No new tool.
    if (e.target.closest('[data-pp-pic]')) { pickImage({ person: name }); return; }
    if (e.target.closest('[data-pp-pic-off]')) {
      ppSetPhoto(name, '');
      drawPeople();
      return;
    }

    // A click inside the editor does not close the row — otherwise you
    // cannot click inside the role box.
    if (e.target.closest('.pedit')) return;

    pp.openName = pp.openName && ppSame(pp.openName, name) ? null : name;
    pp.mfind = '';
    drawPeople();
  });

  // The role is written WITHOUT a redraw: otherwise the caret is lost
  // on the first letter.
  rows.addEventListener('input', function (e) {
    var row = e.target.closest('[data-pname]');
    if (!row) return;

    if (e.target.matches('[data-pp-role]')) {
      ppSetRole(row.dataset.pname, e.target.value);
      return;
    }

    if (e.target.matches('[data-pp-mfind]')) {
      pp.mfind = flat(e.target.value);
      // Only the results list, for the same reason.
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

// The people inventory. If the file is missing — first run before the
// site is built — the tab still works, it is just empty.
function loadPeople(){
  return fetch('people.json').then(function (r) {
    return r.ok ? r.json() : null;
  }).catch(function () { return null; });
}

var sh = {
  shows: {},     // whatever shows.json says
  art: null,     // the WHOLE show-art.json, comments and all
  files: [],     // the poster files available
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

  // Posters available: the ones already in use. New ones are not
  // uploaded here — they need three sizes, which make-shows.js builds
  // from the designer's originals.
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

    // The poster comes either from an uploaded image (a.url) or from
    // the ready webp files in public/shows/. The uploaded one WINS: if
    // the journalist just uploaded something, that is what they want.
    var thumb = a.url || (file ? '/shows/' + file + '-400.webp' : '');

    return '<article class="show" data-show="' + esc(name) + '">'
      + '<header class="show-head">'
      + '<h2 class="show-name">' + esc(name) + '</h2>'
      + (thumb
        ? '<img class="show-art" src="' + esc(thumb) + '" alt="" loading="lazy">'
        : '<span class="show-noart">χωρίς αφίσα</span>')
      + '</header>'

      + '<div class="field">'
      + '<label>Φωτογραφία εκπομπής</label>'
      + '<div class="show-pick">'
      + '<button type="button" class="btn btn--ghost" data-sh-pick="' + esc(name) + '">'
      + (a.url ? 'Άλλαξε φωτογραφία' : 'Ανέβασε ή διάλεξε φωτογραφία') + '</button>'
      + (a.url
        ? '<button type="button" class="btn btn--ghost" data-sh-clear="' + esc(name) + '">Αφαίρεση</button>'
        : '')
      + '</div>'
      + (a.url ? '<p class="hint">' + esc(a.url) + '</p>' : '')
      + '</div>'

      + '<div class="field">'
      + '<label>Περιγραφή</label>'
      + '<textarea rows="3" data-sh="description" placeholder="Τι είναι αυτή η εκπομπή…">'
      + esc(s.description || '') + '</textarea>'
      + '</div>'

      + '<div class="pair">'
      + '<div class="field"><label>Playlist YouTube</label>'
      + '<input type="text" data-sh="playlist" value="' + esc(s.playlist || '') + '" placeholder="PL…"></div>'
      + '<div class="field"><label>Έτοιμη αφίσα</label>'
      + '<select data-sh="file"' + (a.url ? ' disabled' : '') + '>' + options + '</select>'
      + (a.url ? '<p class="hint">Χρησιμοποιείται η φωτογραφία που ανέβασες.</p>' : '')
      + '</div>'
      + '</div>'

      // The explanation goes in ONCE at the top of the tab: here it
      // would repeat fifteen times and drown the fields.
      + '<label class="check">'
      + '<input type="checkbox" data-sh="titled"' + (a.titled ? ' checked' : '') + '>'
      + '<span>Ο τίτλος είναι ήδη ψημένος μέσα στην εικόνα</span>'
      + '</label>'
      + '</article>';
  }).join('');
}

function shSetArt(name, url){
  if (!sh.art.art[name]) sh.art.art[name] = { file: '', titled: false };
  sh.art.art[name].url = url;
  shDirty(true);
}

function shClearArt(name){
  var a = sh.art.art[name];
  if (!a) return;
  delete a.url;
  // With no uploaded AND no ready poster, the record says nothing.
  if (!a.file) delete sh.art.art[name];
  shDirty(true);
  drawShows();
}

function wireShows(){
  var box = $('[data-showlist]');

  box.addEventListener('click', function (e) {
    var pick = e.target.closest('[data-sh-pick]');
    if (pick) { pickImage({ show: pick.dataset.shPick }); return; }

    var clear = e.target.closest('[data-sh-clear]');
    if (clear) shClearArt(clear.dataset.shClear);
  });

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

  // Selects and checkboxes do not fire "input" everywhere.
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
      drawShows();        // so the thumbnail refreshes
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

  // Two files, two saves. Sequential, not parallel: if the second
  // fails, we want to know the first went through.
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

var PR_PAGE = 20;

var pr = {
  file: null,    // data/pairs.json, as it will be saved
  rows: [],      // the inventory from the build
  filter: 'gaps',
  find: '',
  year: '',      // '' = every season
  shown: PR_PAGE,
};

// The seasons that actually exist in the episodes, newest first. Not
// hand-written: next year 2027 would be missing.
function prYears(){
  var seen = {};
  pr.rows.forEach(function (r) {
    var y = String(r.date).slice(0, 4);
    if (/^\d{4}$/.test(y)) seen[y] = (seen[y] || 0) + 1;
  });
  return Object.keys(seen).sort().reverse().map(function (y) {
    return { year: y, n: seen[y] };
  });
}

function drawPrYears(){
  var box = $('[data-pr-years]');
  if (!box) return;

  box.innerHTML = '<button type="button" class="chip'
    + (pr.year ? '' : ' is-on') + '" data-pry="">Κάθε χρονιά</button>'
    + prYears().map(function (y) {
      return '<button type="button" class="chip' + (pr.year === y.year ? ' is-on' : '')
        + '" data-pry="' + y.year + '">' + y.year + ' <small>' + y.n + '</small></button>';
    }).join('');
}

function prReady(file){
  var f = (file && typeof file === 'object' && !Array.isArray(file)) ? file : {};
  if (!f.pairs || typeof f.pairs !== 'object' || Array.isArray(f.pairs)) f.pairs = {};
  return f;
}

function prRec(id){ return pr.file.pairs[id] || {}; }

// What FINALLY applies to a row: the manual answer first, then the
// automatic one. Same order as build.js — otherwise the tab would show
// something other than what the site publishes.
function prNow(r){
  var rec = prRec(r.id);
  return {
    video: rec.novideo ? '' : (rec.video || r.video),
    guest: rec.noguest ? '' : (rec.guest || r.guest),
    byHand: !!(rec.video || rec.guest || rec.novideo || rec.noguest
      || rec.title || rec.summary || rec.image),
    rec: rec,
  };
}

function prFeedEpisode(id){
  var all = (state.raw && state.raw.episodes) || [];
  for (var i = 0; i < all.length; i++) {
    if (all[i].id === id) return all[i];
  }
  return null;
}

function prSet(id, patch){
  var rec = pr.file.pairs[id] || {};
  Object.keys(patch).forEach(function (k) { rec[k] = patch[k]; });

  // Anything left empty or bogus is dropped. A human reads this file
  // too; half-empty records say nothing.
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

// ---- the list ----

// A video's title from its id. The videos are already loaded for the
// lead, so nothing is downloaded.
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
    if (pr.year && String(r.date).slice(0, 4) !== pr.year) return false;

    var now = prNow(r);
    // "Needs work": a video or guest is missing and no human has
    // answered. Anything already fixed drops off the list — that is
    // what it is for.
    if (pr.filter === 'gaps') {
      return (!now.video && !now.rec.novideo) || (!now.guest && !now.rec.noguest);
    }
    if (pr.filter === 'done') return now.byHand;
    // Declared "does not exist" leaves the gaps: that is why it was
    // added — so the list drains instead of asking forever.
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
    + ng + ' χωρίς καλεσμένο · ' + nd + ' διορθωμένα με το χέρι · '
    + hits.length + (pr.year ? ' στο ' + pr.year : ' σε αυτό το φίλτρο');

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

  // ---- the video row ----
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

  // ---- the guest row ----
  var guest;
  if (rec.noguest) {
    guest = '<span class="pair-no">Δεν υπάρχει καλεσμένος</span>'
      + '<button type="button" class="btn btn--tiny" data-pr-undo-guest>Αναίρεση</button>';
  } else {
    // Always a field, never a button: the name is typed, not picked.
    // When the automatic pass found something it goes in as the field's
    // placeholder — showing what applies if the editor types nothing.
    guest = '<input type="text" class="pair-name" data-pr-guest'
      + ' value="' + esc(rec.guest || '') + '"'
      + ' placeholder="' + esc(r.guest || 'Όνομα καλεσμένου') + '"'
      + ' aria-label="Καλεσμένος">'
      + (r.guest && !rec.guest
        ? '<span class="pair-auto">αυτόματο</span>'
        : '<button type="button" class="btn btn--tiny" data-pr-noguest>Δεν υπάρχει</button>');
  }

  var feed = prFeedEpisode(r.id) || {};

  var titleRow = '<input type="text" class="pair-name" data-pr-title'
    + ' value="' + esc(rec.title || '') + '"'
    + ' placeholder="' + esc(unent(feed.title || r.title)) + '"'
    + ' aria-label="Τίτλος επεισοδίου">'
    + (rec.title
      ? '<button type="button" class="btn btn--tiny" data-pr-undo-title>Επανάφερε</button>'
      : '<span class="pair-auto">από το Buzzsprout</span>');

  var sumRow = '<textarea class="pair-text" rows="3" data-pr-summary'
    + ' placeholder="' + esc(unent(feed.summary || '').slice(0, 220)) + '…"'
    + ' aria-label="Περιγραφή επεισοδίου">' + esc(rec.summary || '') + '</textarea>'
    + (rec.summary
      ? '<button type="button" class="btn btn--tiny" data-pr-undo-summary>Επανάφερε</button>'
      : '<button type="button" class="btn btn--tiny" data-pr-copy-summary>Ξεκίνα από το υπάρχον</button>');

  var picRow = (rec.image
    ? '<img class="pair-pic" src="' + esc(rec.image) + '" alt="">'
      + '<button type="button" class="btn btn--tiny" data-pr-pic>Αλλαγή</button>'
      + '<button type="button" class="btn btn--tiny" data-pr-undo-image>Επανάφερε</button>'
    : '<span class="pair-auto">από το Buzzsprout</span>'
      + '<button type="button" class="btn btn--tiny" data-pr-pic>Διάλεξε φωτογραφία</button>');

  return '<div class="pair-row" data-pr-id="' + esc(r.id) + '">'
    + (rec.image || r.image
      ? '<img class="pair-shot" src="' + esc(rec.image || r.image) + '" alt="" loading="lazy">'
      : '<span class="pair-shot"></span>')
    + '<div class="pair-body">'
    + '<p class="pair-title">' + esc(rec.title || r.title) + '</p>'
    + '<p class="pair-date">' + when(r.date) + '</p>'
    + '<div class="pair-line"><span class="pair-what">Βίντεο</span>' + vid + '</div>'
    + '<div class="pair-line"><span class="pair-what">Καλεσμένος</span>' + guest + '</div>'
    + '<div class="pair-line"><span class="pair-what">Τίτλος</span>' + titleRow + '</div>'
    + '<div class="pair-line"><span class="pair-what">Περιγραφή</span>' + sumRow + '</div>'
    + '<div class="pair-line"><span class="pair-what">Φωτογραφία</span>' + picRow + '</div>'
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

  $('[data-pr-years]').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    pr.year = chip.dataset.pry;
    pr.shown = PR_PAGE;
    drawPrYears();
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
      // The same picker the articles use — it searches the videos that
      // are already loaded.
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
      return;
    }

    // ---- fixes to the episode itself ----
    if (e.target.closest('[data-pr-undo-title]')) {
      prSet(id, { title: '' });
      drawPairs();
      return;
    }
    if (e.target.closest('[data-pr-undo-summary]')) {
      prSet(id, { summary: '' });
      drawPairs();
      return;
    }
    if (e.target.closest('[data-pr-undo-image]')) {
      prSet(id, { image: '' });
      drawPairs();
      return;
    }
    if (e.target.closest('[data-pr-pic]')) {
      pickImage({ episode: id });
      return;
    }

    // "Start from what is there": copies the Buzzsprout description
    // into the field, to be corrected rather than rewritten. Most
    // changes are one sentence, not new text.
    if (e.target.closest('[data-pr-copy-summary]')) {
      var feed = prFeedEpisode(id);
      if (!feed || !feed.summary) {
        say('Αυτό το επεισόδιο δεν έχει περιγραφή στο Buzzsprout.', 'bad');
        return;
      }
      prSet(id, { summary: unent(feed.summary) });
      drawPairs();
    }
  });

  // "change" and not "input": every keystroke would redraw the list and
  // the field would lose focus on the first letter.
  box.addEventListener('change', function (e) {
    var row = e.target.closest('[data-pr-id]');
    if (!row) return;
    var rid = row.dataset.prId;

    if (e.target.matches('[data-pr-title]')) {
      prSet(rid, { title: e.target.value.trim() });
      drawPairs();
      return;
    }

    // The description keeps its line breaks: they are its paragraphs,
    // and the page turns them back into <p>. Only the edges are
    // trimmed.
    if (e.target.matches('[data-pr-summary]')) {
      prSet(rid, { summary: e.target.value.replace(/[^\S\n]+/g, ' ').trim() });
      drawPairs();
      return;
    }

    if (!e.target.matches('[data-pr-guest]')) return;
    prSet(rid, { guest: e.target.value.trim(), noguest: false });
    drawPairs();
  });
}

function loadPairsTodo(){
  return fetch('pairs-todo.json', { cache: 'no-store' }).then(function (r) {
    return r.ok ? r.json() : {};
  }, function () { return {}; });
}

var st = { period: '7d', loaded: false, busy: false };

function stSay(text, kind){
  var el = $('[data-st-state]');
  if (!text) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = text;
  if (kind) el.setAttribute('data-kind', kind); else el.removeAttribute('data-kind');
}

function stLoad(){
  if (st.busy) return;
  st.busy = true;
  stSay('Φόρτωση…');

  fetch('/api/stats?period=' + encodeURIComponent(st.period), { headers: { Accept: 'application/json' } })
    .then(readJson, netFail)
    .then(function (data) {
      st.busy = false;
      st.loaded = true;
      stSay('');
      drawStats(data);
    })
    .catch(function (err) {
      st.busy = false;
      stSay(err.message, 'bad');
    });
}

// A "name — count" list, with a bar showing the proportion.
// Numbers alone tell nobody anything: is "60" a lot or a little? The bar
// answers without words.
function stBars(list, kenoTitlos){
  if (!list || !list.length) return '<p class="muted">' + kenoTitlos + '</p>';

  var max = list.reduce(function (m, r) { return Math.max(m, r.n); }, 0) || 1;

  return '<ul class="stbars">' + list.map(function (r) {
    return '<li>'
      + '<span class="stbar-name" title="' + esc(r.name) + '">' + esc(r.name) + '</span>'
      + '<span class="stbar-track"><span class="stbar-fill" style="width:'
      + Math.round((r.n / max) * 100) + '%"></span></span>'
      + '<span class="stbar-n">' + r.n.toLocaleString('el') + '</span>'
      + '</li>';
  }).join('') + '</ul>';
}

function drawStats(d){
  $('[data-st-nums]').innerHTML =
    '<div class="stnum"><span class="stnum-n">' + (d.episkepseis || 0).toLocaleString('el') + '</span>'
    + '<span class="stnum-t">επισκέψεις</span></div>'
    + '<div class="stnum"><span class="stnum-n">' + (d.provoles || 0).toLocaleString('el') + '</span>'
    + '<span class="stnum-t">προβολές σελίδων</span></div>'
    + '<div class="stnum stnum--soft"><span class="stnum-n">' + esc(d.titlos || '') + '</span>'
    + '<span class="stnum-t">περίοδος</span></div>';

  var meres = stFill(d.meres || [], d.period);
  var max = meres.reduce(function (m, r) { return Math.max(m, r.episkepseis); }, 0) || 1;

  $('[data-st-days]').innerHTML = meres.length
    ? meres.map(function (r) {
      var h = Math.round((r.episkepseis / max) * 100);
      return '<div class="stday" title="' + esc(r.date) + ': ' + r.episkepseis + ' επισκέψεις">'
        + '<span class="stday-bar" style="height:' + Math.max(h, 2) + '%"></span>'
        + '<span class="stday-t">' + esc(stMera(r.date)) + '</span>'
        + '</div>';
    }).join('')
    : '<p class="muted">Καμία μέρα με κίνηση σε αυτή την περίοδο.</p>';

  $('[data-st-pages]').innerHTML = stBars(stLabel(d.selides, stSelida), 'Καμία σελίδα ακόμα.');
  $('[data-st-from]').innerHTML = stBars(d.apo, 'Άγνωστο από πού.');
  $('[data-st-geo]').innerHTML = stBars(stLabel(d.xores, stXora), 'Άγνωστη χώρα.');
  $('[data-st-dev]').innerHTML = stBars(stLabel(d.syskeves, stSyskevi), 'Άγνωστη συσκευή.');
}

// Names as a human says them, not as the API does. The editor does not
// read "GR" and "desktop", and a bare "/" tells nobody it is the
// homepage.
function stLabel(list, fn){
  return (list || []).map(function (r) { return { name: fn(r.name), n: r.n }; });
}

function stSelida(path){
  if (path === '/' || path === '') return 'Αρχική';
  return path;
}

var SYSKEVES = { desktop: 'Υπολογιστής', mobile: 'Κινητό', tablet: 'Τάμπλετ' };
function stSyskevi(s){ return SYSKEVES[s] || s || 'Άγνωστη'; }

// Country names come from the browser itself — not hand-written, the
// next one would always be missing. Where it is unsupported the code
// stays, which is understandable anyway.
var xoresNames;
function stXora(code){
  if (!code) return 'Άγνωστη';
  try {
    if (!xoresNames) xoresNames = new Intl.DisplayNames(['el'], { type: 'region' });
    return xoresNames.of(code) || code;
  } catch (err) {
    return code;
  }
}

// The missing days, filled with zero.
function stFill(meres, period){
  var poses = period === '24h' ? 1 : (period === '30d' ? 30 : 7);
  if (poses === 1) return meres;

  var vres = {};
  meres.forEach(function (r) { if (r.date) vres[r.date] = r; });

  var out = [];
  for (var i = poses - 1; i >= 0; i--) {
    var d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    out.push(vres[d] || { date: d, provoles: 0, episkepseis: 0 });
  }
  return out;
}

function stMera(iso){
  var d = new Date(iso);
  if (isNaN(d)) return iso || '';
  return d.toLocaleDateString('el-GR', { day: 'numeric', month: 'short' });
}

// ---------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------

function wire(){
  // Tabs
  $$('.tab').forEach(function (tab) {
    tab.addEventListener('click', function (e) {
      e.preventDefault();
      $$('.tab').forEach(function (t) { t.classList.toggle('is-on', t === tab); });
      var name = tab.dataset.tab;
      $$('.panel').forEach(function (p) { p.classList.toggle('is-on', p.dataset.panel === name); });
      location.hash = name;
      // The safety net is offered here and not on load: a prompt that
      // fires the moment the page opens, whichever tab the editor was
      // heading for, is a nuisance.
      if (name === 'arthra') draftOffer();
      // Stats download the first time the tab opens.
      if (name === 'metriseis' && !st.loaded) stLoad();
    });
  });

  // The periods and the stats refresh.
  $('[data-st-period]').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    $$('[data-st-period] .chip').forEach(function (c) { c.classList.toggle('is-on', c === chip); });
    st.period = chip.dataset.stp;
    stLoad();
  });

  $('[data-st-reload]').addEventListener('click', stLoad);

  // Selection — one listener for the whole list, not one per card.
  $('[data-picks]').addEventListener('click', function (e) {
    var pick = e.target.closest('.pick');
    if (pick) choose(pick.dataset.ref);
  });

  // One listener on the box, not on the button: the button is rewritten
  // on every drawNow() and would lose its own.
  $('[data-now-featured]').addEventListener('click', function (e) {
    if (e.target.closest('[data-auto]')) autoAgain();
    else if (e.target.closest('[data-newest]')) autoNewest();
  });

  // The four tabs' "clear all" buttons, with one listener on the
  // document: the buttons are fixed in the HTML, but they sit in four
  // different panels and do not deserve four listeners.
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-auto-all]');
    if (btn) autoAll(btn.dataset.autoAll);
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
    // Scoped to its OWN group: a bare '.chip' cleared "is-on" from the
    // other tabs' filters, which stayed active in practice.
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
  wireOpinions();
  wireAds();
  // "Renew" — one listener for the whole page, because the button
  // appears in four different tabs.
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-pin-again]');
    if (b) { pinAgain(b.dataset.pinKey, b.dataset.pinAgain); return; }

    // "↩ restore": what ✕ took out goes back into the automatic fill.
    // Same reason for one listener — the button lives in four tabs.
    var k = e.target.closest('[data-kry-back]');
    if (k) kryEpanafora(k.dataset.kryPoio, k.dataset.kryBack);
  });

  wireCats();
  wireThemata();
  wirePeople();
  wirePairs();
  wireDrag();

  // Safety catch: leaving the page with unsaved work in it.
  window.addEventListener('beforeunload', function (e) {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
}

// ---------------------------------------------------------------------
// Moving the dialogs
// ---------------------------------------------------------------------

// Below this the dialogs already fill the screen — see the media query
// in admin.css. There is nowhere to move them to.
var DRAG_MIN_W = 761;

// The dialog stays WHOLE on screen. Keeping only a part of it visible
// was not enough: the ✕ sits at the right end of the header, so dragging
// right pushed the close button off the screen and the only way out of
// the dialog with it. The box is never wider or taller than the viewport
// — width min(900px, 100%), max-height 80vh — so it always fits.

// Every dialog has the same skeleton — .picker-box with a .picker-head —
// so one listener covers the image picker, the episode/video finder and
// the article preview, and anything added later.
//
// Pointer events and not mouse: the same code then works with a finger
// and with a pen, on the touchscreen laptops in the newsroom.
function wireDrag(){
  var box = null;      // what is being moved
  var from = null;     // where the pointer started
  var at = null;       // where the box was when it started
  var base = null;     // where it sits with no transform at all

  function placeOf(el){
    return {
      x: Number(el.dataset.dx || 0),
      y: Number(el.dataset.dy || 0),
    };
  }

  function place(el, x, y){
    el.dataset.dx = x;
    el.dataset.dy = y;
    el.style.transform = x || y ? 'translate(' + x + 'px, ' + y + 'px)' : '';
  }

  document.addEventListener('pointerdown', function (e) {
    if (window.innerWidth < DRAG_MIN_W) return;

    var head = e.target.closest('.picker-head');
    if (!head) return;
    // The ✕ and anything else clickable in the header keeps its job.
    if (e.target.closest('button, a, input, select')) return;

    box = head.closest('.picker-box');
    if (!box) return;

    from = { x: e.clientX, y: e.clientY };
    at = placeOf(box);

    // Measured ONCE, here: the rectangle already carries the offset the
    // box is sitting at, so taking it away leaves the untransformed
    // position. Measuring it again on every move would read a rectangle
    // that has already shifted, and the limits would creep inwards as
    // you dragged.
    var r0 = box.getBoundingClientRect();
    base = { left: r0.left - at.x, top: r0.top - at.y, w: r0.width, h: r0.height };

    head.setPointerCapture(e.pointerId);
    box.classList.add('is-moving');
    // Or the pointer selects the heading's text while dragging.
    e.preventDefault();
  });

  document.addEventListener('pointermove', function (e) {
    if (!box) return;

    var x = at.x + (e.clientX - from.x);
    var y = at.y + (e.clientY - from.y);

    var minX = -base.left;
    var maxX = window.innerWidth - base.left - base.w;
    var minY = -base.top;
    var maxY = window.innerHeight - base.top - base.h;

    place(box, Math.max(minX, Math.min(maxX, x)), Math.max(minY, Math.min(maxY, y)));
  });

  function stop(){
    if (!box) return;
    box.classList.remove('is-moving');
    box = null;
  }

  document.addEventListener('pointerup', stop);
  document.addEventListener('pointercancel', stop);

  // Back to the middle every time a dialog opens. Without this it would
  // reopen wherever it was left — possibly off to one side, looking like
  // it opened in the wrong place.
  $$('.picker').forEach(function (p) {
    new MutationObserver(function () {
      if (p.hidden) return;
      var b = p.querySelector('.picker-box');
      if (b) place(b, 0, 0);
    }).observe(p, { attributes: true, attributeFilter: ['hidden'] });
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
    api('photos').catch(function () { return null; }),
    // The last build's flow. FORGIVING like the images: if no build has
    // run yet we show only the pins — we do not take the whole admin
    // down over a preview.
    loadFlow(),
    // The columnists' portraits. FORGIVING: the file does not exist
    // until someone changes the first photo.
    api('writers').catch(function () { return null; }),
    // The ads. FORGIVING: the file does not exist until the first one
    // is added — and an ads tab does not take the admin down.
    api('ads').catch(function () { return null; }),
    // Who is signed in. FORGIVING: there is no Access locally, and the
    // byline is typed by hand as always.
    fetch('/api/poios')
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; }),
    // The topics with their counts, for the "Θέματα αρχικής" tab.
    // FORGIVING: the build writes this file — before the first run it
    // does not exist.
    loadTopics(),
  ]).then(function (r) {
    // The file may not exist yet — then the API returns null.
    var photos = r[12] && typeof r[12] === 'object' ? r[12] : {};
    lib.standard = Array.isArray(photos.standard) ? photos.standard : [];
    lib.rest = {};
    Object.keys(photos).forEach(function (k) {
      if (k !== 'standard') lib.rest[k] = photos[k];
    });
    state.curation = r[0] || {};
    cat.auto = r[5] || {};
    // The file does not exist until the first article is written — then
    // the API returns null, not an error.
    art.list = Array.isArray(r[4]) ? r[4] : [];
    // After the articles: the lead list includes them.
    state.raw = { episodes: r[1], videos: r[2], news: r[3] };
    state.items = normalize(r[1], r[2], r[3], art.list);
    state.flow = r[13];
    wrReady(r[14]);
    adReady(r[15]);
    me.email = (r[16] && typeof r[16].email === 'string') ? r[16].email : '';
    thReady(r[17]);

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
    drawOpinions();
    drawOpPicks();
    drawWriters();
    drawAds();
    drawCats();
    drawThemata();
    drawPeople();
    drawShows();
    drawPrYears();
    drawPairs();
    loadShots();
    say('');

    // From here on the article list is real, so the safety net can be
    // offered. If the editor came straight to Articles — a refresh
    // mid-write, say — we ask immediately.
    art.ready = true;
    if (location.hash === '#arthra') draftOffer();
  }).catch(function (err) {
    say('Δεν φόρτωσαν τα δεδομένα: ' + err.message, 'bad');
  });
}

boot();
