// player.js — ο μόνιμος player και η πλοήγηση που δεν κόβει τον ήχο.
//
// ΔΥΟ ΙΔΕΕΣ ΚΡΑΤΟΥΝ ΤΟ ΑΡΧΕΙΟ ΑΥΤΟ ΜΙΚΡΟ:
//
// 1. Ένας ήχος, πολλές όψεις. Υπάρχει ΕΝΑ <audio>. Η μπάρα στον πάτο και
//    τα χειριστήρια της σελίδας επεισοδίου είναι απλώς δύο παράθυρα στην
//    ίδια κατάσταση — δεν έχουν δικό τους ήχο.
//
// 2. Κανένα κουμπί δεν «δένεται» ξεχωριστά. Ακούμε τα κλικ στο document
//    και κοιτάμε πού έπεσαν. Έτσι, όταν η πλοήγηση αντικαθιστά το
//    περιεχόμενο, τα νέα κουμπιά δουλεύουν αμέσως χωρίς να ξαναστηθεί
//    τίποτα.

(function () {
  'use strict';

  var audio = new Audio();
  audio.preload = 'metadata';

  var track = null;            // { id, src, title, show, art, href }
  var speeds = [1, 1.25, 1.5, 2];
  var speedAt = 0;

  var bar = document.querySelector('.bar');

  // ---------- βοηθητικά ----------

  function clock(s) {
    if (!isFinite(s)) return '--:--';
    var sec = Math.floor(s % 60);
    var min = Math.floor(s / 60) % 60;
    var hrs = Math.floor(s / 3600);
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return hrs ? hrs + ':' + pad(min) + ':' + pad(sec) : min + ':' + pad(sec);
  }

  function posKey() {
    return track ? 'pos:' + track.id : '';
  }

  function remember() {
    if (!track) return;
    try {
      if (audio.currentTime > 5 && audio.currentTime < audio.duration - 10) {
        localStorage.setItem(posKey(), String(Math.floor(audio.currentTime)));
      } else {
        localStorage.removeItem(posKey());
      }
    } catch (e) { /* ιδιωτική περιήγηση */ }
  }

  // ---------- οι όψεις ----------

  // Κάθε όψη είναι ένα στοιχείο: η μπάρα, ή ένα .player μέσα στη σελίδα.
  function views() {
    var list = [];
    if (bar && !bar.hidden) list.push(bar);
    var inPage = document.querySelectorAll('[data-player-view]');
    for (var i = 0; i < inPage.length; i++) list.push(inPage[i]);
    return list;
  }

  function render() {
    var pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    var playing = !audio.paused && !audio.ended;

    views().forEach(function (v) {
      // Η όψη της σελίδας δείχνει μόνο ΤΟ ΔΙΚΟ ΤΗΣ επεισόδιο.
      var mine = !v.dataset.id || (track && v.dataset.id === track.id);

      var fill = v.querySelector('.bar-fill, .player-fill');
      if (fill) fill.style.width = (mine ? pct : 0) + '%';

      var now = v.querySelector('[data-player-now]');
      if (now) now.textContent = mine ? clock(audio.currentTime) : '0:00';

      var total = v.querySelector('[data-player-total]');
      if (total) total.textContent = mine ? clock(audio.duration) : '--:--';

      var btn = v.querySelector('[data-player="toggle"]');
      if (btn) {
        btn.textContent = (mine && playing) ? '❚❚' : '▶';
        btn.setAttribute('aria-label', (mine && playing) ? 'Παύση' : 'Αναπαραγωγή');
      }

      var sp = v.querySelector('[data-player="speed"]');
      if (sp) sp.textContent = speeds[speedAt] + '×';

      v.classList.toggle('is-playing', mine && playing);
    });

    if (bar && !bar.hidden && track) {
      var art = bar.querySelector('.bar-art');
      if (art && art.getAttribute('src') !== track.art) art.src = track.art || '';
      var t = bar.querySelector('.bar-title');
      if (t && t.textContent !== track.title) t.textContent = track.title;
      var sh = bar.querySelector('.bar-show');
      if (sh && sh.textContent !== track.show) sh.textContent = track.show;
      var link = bar.querySelector('.bar-now');
      if (link && track.href) link.setAttribute('href', track.href);

      // Η κυματομορφή του τρέχοντος επεισοδίου πάνω στη μόνιμη μπάρα.
      var seek = bar.querySelector('.bar-seek');
      if (seek && seek.style.getPropertyValue('--wave') !== track.wave) {
        seek.style.setProperty('--wave', track.wave || '');
      }
    }
  }

  // ---------- έλεγχος ----------

  function load(next, andPlay) {
    var same = track && track.id === next.id;
    track = next;

    if (!same) {
      audio.src = next.src;
      audio.load();
      try {
        var saved = Number(localStorage.getItem(posKey()));
        if (saved > 0) {
          audio.addEventListener('loadedmetadata', function once() {
            audio.removeEventListener('loadedmetadata', once);
            if (saved < audio.duration - 10) audio.currentTime = saved;
            render();
          });
        }
      } catch (e) { /* τίποτα */ }
    }

    if (bar) bar.hidden = false;
    if (andPlay) audio.play().catch(function () {});
    render();
  }

  // Πήγαινε τον ήχο σε δευτερόλεπτο — από χρονοσήμανση απομαγνητοφώνησης.
  //
  // Δύο παγίδες: αν ο player παίζει άλλο επεισόδιο, πρέπει πρώτα να
  // φορτώσει αυτό της σελίδας· και το currentTime αγνοείται όσο ο browser
  // δεν ξέρει τη διάρκεια, οπότε περιμένουμε το loadedmetadata.
  function seekTo(seconds) {
    var view = document.querySelector('[data-player-view]');
    if (!view || !view.dataset.id) return;

    var later = function () {
      audio.addEventListener('loadedmetadata', function once() {
        audio.removeEventListener('loadedmetadata', once);
        audio.currentTime = seconds;
        // Όποιος πατάει μια ώρα θέλει να ακούσει, όχι μόνο να μετακινηθεί.
        if (audio.paused) audio.play().catch(function () {});
        render();
      });
    };

    // Το load() βάζει κι αυτό ένα loadedmetadata για την αποθηκευμένη
    // θέση. Το δικό μας μπαίνει μετά, άρα τρέχει μετά, άρα κερδίζει.
    if (!track || view.dataset.id !== track.id) {
      load(trackFrom(view), true);
      later();
      return;
    }

    if (audio.readyState < 1) { later(); return; }

    audio.currentTime = seconds;
    if (audio.paused) audio.play().catch(function () {});
    render();
  }

  // ---------- απομαγνητοφώνηση ----------
  //
  // Το κείμενο δεν είναι μέσα στη σελίδα: έρχεται από ξεχωριστό αρχείο
  // μόλις ανοίξει κανείς την ενότητα. Έτσι η σελίδα μένει 21KB αντί για
  // 76KB, και το αυτόματο κείμενο — που βγάζει ονόματα και λέξεις λάθος
  // — δεν γίνεται δημοσιευμένο κείμενο που θα διάβαζε η Google.

  function fillTranscript(box, data) {
    var frag = document.createDocumentFragment();

    for (var i = 0; i < data.lines.length; i++) {
      var who = data.lines[i][0];
      var at = data.lines[i][1];
      var text = data.lines[i][2];

      var row = document.createElement('p');
      row.className = 'tr-row';
      row.dataset.who = who;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tr-at';
      btn.dataset.seek = at;
      btn.textContent = clock(at);
      btn.setAttribute('aria-label', 'Πήγαινε στο ' + clock(at));

      var said = document.createElement('span');
      said.className = 'tr-text';
      // textContent, όχι innerHTML: το κείμενο έρχεται από το Buzzsprout
      // και δεν το γράφουμε εμείς — ό,τι μοιάζει με ετικέτα μένει γράμματα.
      said.textContent = text;

      row.appendChild(btn);
      row.appendChild(said);
      frag.appendChild(row);
    }

    box.appendChild(frag);
    // Ο πίνακας των γραμμών φτιάχτηκε όταν δεν υπήρχε τίποτα — ξανά.
    trRows = null;
    trNow = -1;
  }

  function openTranscript(details) {
    if (details.dataset.loaded) return;
    details.dataset.loaded = '1';            // μία φορά, ακόμα κι αν αποτύχει

    var box = details.querySelector('[data-transcript-body]');
    var note = box && box.querySelector('.transcript-load');

    fetch(details.dataset.transcript)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (note) note.remove();
        fillTranscript(box, data);
      })
      .catch(function () {
        if (note) note.textContent = 'Η απομαγνητοφώνηση δεν φορτώθηκε. Δοκίμασε ξανά.';
        details.dataset.loaded = '';         // άσε τον να ξαναπροσπαθήσει
      });
  }

  // ---- το πάνελ του πλέγματος ----

  function gridMenu() {
    return document.getElementById('gridmenu');
  }

  function setGrid(open) {
    var panel = gridMenu();
    var btn = document.querySelector('[data-gridmenu]');
    if (!panel || !btn) return;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-gridmenu]');
    if (btn) {
      setGrid(gridMenu() && gridMenu().hidden);
      return;
    }

    // Κλικ έξω από το πάνελ το κλείνει. Μέσα του όχι — αλλιώς δεν θα
    // προλάβαινε να ανοίξει ο σύνδεσμος που μόλις πατήθηκε.
    var panel = gridMenu();
    if (panel && !panel.hidden && !e.target.closest('#gridmenu')) setGrid(false);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var panel = gridMenu();
    if (panel && !panel.hidden) {
      setGrid(false);
      var btn = document.querySelector('[data-gridmenu]');
      if (btn) btn.focus();
    }
  });

  // ---- φίλτρο στη λίστα προσώπων ----
  //
  // 382 ονόματα σε μία σελίδα. Το φίλτρο κρύβει όσα δεν ταιριάζουν
  // καθώς γράφεις, χωρίς να φορτώσει τίποτα.
  //
  // Το κείμενο σύγκρισης είναι ήδη γραμμένο στο data-find από το build:
  // πεζά χωρίς τόνους, ώστε το «Συρίγος» να βρίσκεται με «συριγ».

  function flatten(text) {
    return String(text).toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zα-ω0-9]+/g, ' ')
      .trim();
  }

  // Ποιο γράμμα είναι επιλεγμένο. Κενό = όλα.
  var pickedLetter = '';

  function filterPeople(box) {
    var want = box ? flatten(box.value) : '';
    var list = box ? box.closest('.all-people') : document.querySelector('.all-people');
    if (!list) return;

    var rows = list.querySelectorAll('.plist-row');
    var shown = 0;

    for (var i = 0; i < rows.length; i++) {
      // Δύο φίλτρα μαζί: το γραμμένο όνομα ΚΑΙ το γράμμα. Όποιος
      // γράφει στο κουτί ενώ έχει διαλέξει «Κ» περιμένει να ψάξει
      // μέσα στα Κ, όχι να του αλλάξει κρυφά η επιλογή.
      var okText = !want || rows[i].dataset.find.indexOf(want) !== -1;
      var okLetter = !pickedLetter || rows[i].dataset.letter === pickedLetter;
      var ok = okText && okLetter;
      rows[i].hidden = !ok;
      if (ok) shown++;
    }

    // Τα γράμματα-άγκυρες κρύβονται όταν δεν τους έμεινε κανένα όνομα,
    // αλλιώς μένει ένα «Κ» να δείχνει το κενό.
    var marks = list.querySelectorAll('.plist-mark');
    for (var j = 0; j < marks.length; j++) {
      // Με επιλεγμένο γράμμα όλοι οι δείκτες περισσεύουν: το γράμμα το
      // λέει ήδη το αλφάβητο από πάνω, τονισμένο. Το «Κ» πάνω από μια
      // λίστα μόνο με Κ έτρωγε μια θέση στήλης χωρίς να λέει τίποτα.
      if (pickedLetter) { marks[j].hidden = true; continue; }

      var any = false;
      var el = marks[j].nextElementSibling;
      while (el && !el.classList.contains('plist-mark')) {
        if (el.classList.contains('plist-row') && !el.hidden) { any = true; break; }
        el = el.nextElementSibling;
      }
      marks[j].hidden = !any;
    }

    var none = list.querySelector('.plist-none');
    if (none) none.hidden = shown > 0;

    // Το αλφάβητο ΜΕΝΕΙ ορατό όταν γράφεις: είναι πλέον φίλτρο, όχι
    // σύνολο αγκυρών, και χρειάζεσαι τον δρόμο της επιστροφής στο «Όλα».
  }

  // Το «input» ανεβαίνει στο document, σε αντίθεση με focus/blur — οπότε
  // ένας listener αρκεί και μετά από αλλαγή σελίδας.
  document.addEventListener('input', function (e) {
    var box = e.target.closest('[data-people-filter]');
    if (box) filterPeople(box);
  });

  // Κλικ σε γράμμα: δείχνει μόνο αυτό. Ο ίδιος listener πιάνει και το
  // «Όλα», που καθαρίζει την επιλογή.
  document.addEventListener('click', function (e) {
    var pick = e.target.closest('[data-letter-pick], [data-letter-all]');
    if (!pick) return;

    var abc = pick.closest('.plist-abc');
    if (!abc) return;

    e.preventDefault();
    pickedLetter = pick.dataset.letterPick || '';

    var links = abc.querySelectorAll('a');
    for (var i = 0; i < links.length; i++) {
      links[i].classList.toggle('is-on', links[i] === pick);
    }

    filterPeople(document.querySelector('[data-people-filter]'));
  });

  // Η γραμμή που ακούγεται τώρα. Οι γραμμές είναι έως 158, και το
  // timeupdate χτυπάει τέσσερις φορές το δευτερόλεπτο, οπότε δεν ψάχνουμε
  // από την αρχή: σχεδόν πάντα προχωράμε μία γραμμή μπροστά.
  var trRows = null;
  var trNow = -1;

  function markLine() {
    if (trRows === null) {
      trRows = Array.prototype.slice.call(document.querySelectorAll('.tr-row [data-seek]'));
    }
    if (!trRows.length) return;

    var t = audio.currentTime;
    var i = trNow;
    if (i < 0 || Number(trRows[i].dataset.seek) > t) i = 0;
    while (i + 1 < trRows.length && Number(trRows[i + 1].dataset.seek) <= t) i++;
    if (i === trNow) return;

    if (trNow >= 0 && trRows[trNow]) trRows[trNow].parentNode.classList.remove('is-now');
    trNow = i;
    trRows[i].parentNode.classList.add('is-now');
  }

  function trackFrom(el) {
    return {
      id: el.dataset.id,
      src: el.dataset.src,
      title: el.dataset.title || '',
      show: el.dataset.show || '',
      art: el.dataset.art || '',
      href: el.dataset.href || location.pathname,
      // Η κυματομορφή του επεισοδίου. Τη γράφει το build μέσα στη
      // σελίδα, πάνω στο .player-bar, ως μεταβλητή --wave. Η μόνιμη
      // μπάρα την κουβαλάει μαζί της όταν αλλάξεις σελίδα, αλλιώς θα
      // γύριζε σε σκέτη γραμμή ενώ παίζει το ίδιο επεισόδιο.
      wave: waveOf(el),
    };
  }

  // Το --wave κάθεται στο .player-bar μέσα στην όψη. Αν λείπει — παλιά
  // σελίδα, ή όψη χωρίς μπάρα — γυρίζουμε κενό και ο CSS κανόνας
  // αφήνει την απλή γραμμή, που δουλεύει μια χαρά.
  function waveOf(el) {
    var seek = el.querySelector ? el.querySelector('.player-bar') : null;
    return (seek && seek.style.getPropertyValue('--wave')) || '';
  }

  function seekFrom(el, event) {
    var box = el.getBoundingClientRect();
    var ratio = (event.clientX - box.left) / box.width;
    ratio = Math.min(1, Math.max(0, ratio));
    if (audio.duration) {
      audio.currentTime = ratio * audio.duration;
      render();
    }
  }

  // ---------- τα θέματα της αρχικής ----------

  // Πόσες κάρτες δείχνουμε όταν διαλέξει κάποιος θέμα.
  var TOPIC_MAX = 12;

  // Φιλτράρει τη ροή χωρίς να φορτώσει ΤΙΠΟΤΑ: οι κάρτες όλων των θεμάτων
  // είναι ήδη μέσα στη σελίδα, απλώς κρυμμένες. Γι' αυτό η αλλαγή θέματος
  // είναι ακαριαία, όσα επεισόδια κι αν έχει το αρχείο.
  function showTopic(key) {
    var flow = document.querySelector('.flow');
    if (!flow) return;

    var cards = flow.querySelectorAll('.card');
    var shown = 0;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var ok;
      if (key === 'all') {
        // «Όλα» = τα πιο πρόσφατα. Οι κάρτες που μπήκαν για χάρη των
        // θεμάτων μένουν κρυμμένες, αλλιώς η ροή θα τριπλασιαζόταν.
        ok = c.className.indexOf('is-extra') === -1;
      } else {
        var mine = (' ' + (c.getAttribute('data-topics') || '') + ' ')
          .indexOf(' ' + key + ' ') !== -1;
        ok = mine && shown < TOPIC_MAX;
      }
      c.hidden = !ok;
      if (ok) shown++;
    }

    flow.setAttribute('data-topic', key);

    // Ποια ετικέτα είναι αναμμένη, και τι λέει ο τίτλος από πάνω.
    var name = 'Τελευταία επεισόδια';
    var href = 'episodes.html';
    var count = '';
    var chips = document.querySelectorAll('.topic');
    for (var j = 0; j < chips.length; j++) {
      var on = chips[j].getAttribute('data-topic') === key;
      chips[j].classList.toggle('is-on', on);
      if (on && key !== 'all') {
        name = chips[j].getAttribute('data-name');
        href = chips[j].getAttribute('href');
        count = chips[j].getAttribute('data-count');
      }
    }

    // Η ετικέτα κάθε κάρτας δείχνει το ΠΡΩΤΟ θέμα της. Ένα επεισόδιο
    // όμως ανήκει σε πολλά — «geopolitiki kosmos» — οπότε με φίλτρο
    // «Κόσμος» έβγαιναν κάρτες που έγραφαν «Γεωπολιτική».
    //
    // Όσο υπάρχει φίλτρο, η ετικέτα λέει αυτό που διάλεξες. Στο «Όλα»
    // γυρίζει στην αρχική της, που τη φυλάμε την πρώτη φορά.
    for (var k = 0; k < cards.length; k++) {
      var label = cards[k].querySelector('.card-label');
      if (!label) continue;
      if (label.dataset.first === undefined) label.dataset.first = label.textContent;
      label.textContent = key === 'all' ? label.dataset.first : name;
    }

    // Ο τίτλος κάθεται ΕΞΩ από τη ροή, στην κορυφή της κόκκινης λωρίδας,
    // γι' αυτό τον ψάχνουμε σε όλη τη σελίδα και όχι μέσα στη ροή.
    var head = document.querySelector('[data-flow-head]');
    if (head) head.textContent = name;

    // Ο δρόμος προς όλο το θέμα. Δείχνουμε 12 από 1.082 — πρέπει να
    // υπάρχει τρόπος να δει τα υπόλοιπα.
    var foot = flow.querySelector('.flow-all');
    var link = flow.querySelector('[data-flow-all]');
    // Ο σύνδεσμος υπάρχει ΠΑΝΤΑ, αλλάζει μόνο πού δείχνει: στο αρχείο
    // όταν βλέπεις τα πιο πρόσφατα, στο θέμα όταν έχεις διαλέξει θέμα.
    if (foot && link) {
      link.setAttribute('href', href);
      link.textContent = key === 'all'
        ? 'Όλα τα επεισόδια →'
        : 'Όλα τα ' + count + ' →';
    }
  }

  // ---------- κλικ, με έναν ακροατή για όλα ----------

  document.addEventListener('click', function (e) {
    // α) ο ψεύτικος player του YouTube: το πραγματικό βίντεο μπαίνει ΠΑΝΩ
    // από τη μικρογραφία, όχι στη θέση της — ώστε όταν κλείσει, η
    // μικρογραφία να είναι ακόμα εκεί.
    var stage = e.target.closest('[data-embed]');
    if (stage && !stage.querySelector('iframe')) {
      var frame = document.createElement('iframe');
      frame.src = stage.dataset.embed + '?autoplay=1&rel=0';
      frame.title = document.title;
      frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture';
      frame.allowFullscreen = true;
      stage.appendChild(frame);
      audio.pause();
      return;
    }

    // β) ο διακόπτης Βλέπω / Ακούω
    var mode = e.target.closest('.mode');
    if (mode) {
      var wantVideo = mode.dataset.mode === 'video';
      var all = document.querySelectorAll('.mode');
      for (var i = 0; i < all.length; i++) all[i].classList.toggle('is-on', all[i] === mode);

      var media = document.querySelector('.stage-media');
      var art = document.querySelector('.stage-art');
      if (media) media.hidden = !wantVideo;
      if (art) art.hidden = wantVideo;
      if (!wantVideo && media) {
        var frame = media.querySelector('iframe');
        if (frame) frame.remove();
      }
      return;
    }

    // γ) το άνοιγμα της απομαγνητοφώνησης φέρνει το κείμενο.
    //
    // Πιάνουμε το click στην επικεφαλίδα και όχι το «toggle» του
    // <details>, γιατί το toggle δεν ανεβαίνει στο document — άρα δεν
    // δουλεύει με έναν listener, και μετά από αλλαγή σελίδας θα έπρεπε
    // να ξαναδεθεί σε κάθε νέο στοιχείο.
    var head = e.target.closest('.transcript-head');
    if (head) {
      openTranscript(head.closest('.transcript'));
      return;                      // το <details> ανοίγει μόνο του
    }

    // δ) χρονοσήμανση απομαγνητοφώνησης: πήγαινε τον ήχο εκεί
    var at = e.target.closest('[data-seek]');
    if (at) {
      seekTo(Number(at.dataset.seek));
      return;
    }

    // ε) τα χειριστήρια του player
    var ctl = e.target.closest('[data-player]');
    if (ctl) {
      var view = ctl.closest('[data-player-view], .bar');
      var what = ctl.dataset.player;

      if (what === 'toggle') {
        var mineNow = !view.dataset.id || (track && view.dataset.id === track.id);
        if (!mineNow) { load(trackFrom(view), true); return; }
        if (audio.paused) audio.play().catch(function () {}); else audio.pause();
        return;
      }

      if (what === 'skip') {
        if (!track && view.dataset.id) load(trackFrom(view), false);
        audio.currentTime = Math.max(0, audio.currentTime + Number(ctl.dataset.by));
        render();
        return;
      }

      if (what === 'seek') {
        if (!track && view.dataset.id) load(trackFrom(view), false);
        seekFrom(ctl, e);
        return;
      }

      if (what === 'speed') {
        speedAt = (speedAt + 1) % speeds.length;
        audio.playbackRate = speeds[speedAt];
        render();
        return;
      }

      if (what === 'close') {
        audio.pause();
        remember();
        if (bar) bar.hidden = true;
        track = null;
        render();
        return;
      }
    }

    // δ) Κοινοποίηση
    var share = e.target.closest('.act-share');
    if (share) {
      var url = location.href.split('#')[0];
      if (track && audio.currentTime > 10) url += '#t=' + Math.floor(audio.currentTime);
      if (navigator.share) { navigator.share({ title: document.title, url: url }).catch(function () {}); return; }
      navigator.clipboard.writeText(url).then(function () {
        var was = share.textContent;
        share.textContent = 'Αντιγράφηκε';
        setTimeout(function () { share.textContent = was; }, 1600);
      });
      return;
    }

    // ε) Στη λίστα μου
    var save = e.target.closest('.act-save');
    if (save) {
      var view2 = document.querySelector('[data-player-view]');
      var id = view2 ? view2.dataset.id : location.pathname;
      var list = [];
      try { list = JSON.parse(localStorage.getItem('saved') || '[]'); } catch (e2) {}
      var at = list.indexOf(id);
      if (at === -1) list.push(id); else list.splice(at, 1);
      try { localStorage.setItem('saved', JSON.stringify(list)); } catch (e3) {}
      markSaved();
      return;
    }

    // στ) οι ετικέτες θεμάτων στην αρχική. Φιλτράρουν επί τόπου, αλλά
    // μένουν κανονικοί σύνδεσμοι: χωρίς JavaScript, ή με μεσαίο κλικ,
    // ανοίγουν τη σελίδα του θέματος.
    var chip = e.target.closest('.topic');
    if (chip && document.querySelector('.flow')) {
      e.preventDefault();
      showTopic(chip.getAttribute('data-topic'));
      return;
    }
  });

  document.addEventListener('keydown', function (e) {
    var sl = e.target.closest && e.target.closest('[data-player="seek"]');
    if (!sl) return;
    if (e.key === 'ArrowRight') { audio.currentTime += 5; render(); }
    if (e.key === 'ArrowLeft') { audio.currentTime -= 5; render(); }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (audio.paused) audio.play().catch(function () {}); else audio.pause();
    }
  });

  function markSaved() {
    var btn = document.querySelector('.act-save');
    var view = document.querySelector('[data-player-view]');
    if (!btn || !view) return;
    var list = [];
    try { list = JSON.parse(localStorage.getItem('saved') || '[]'); } catch (e) {}
    var on = list.indexOf(view.dataset.id) !== -1;
    btn.classList.toggle('is-on', on);
    btn.textContent = on ? '✓ Στη λίστα μου' : '+ Στη λίστα μου';
  }

  // ---------- συμβάντα του ήχου ----------

  // Ένα πράγμα τη φορά: μόλις ξεκινήσει ο ήχος, κλείνει το βίντεο του
  // YouTube — αλλιώς θα ακούγονταν και τα δύο μαζί.
  function stopVideo() {
    var frames = document.querySelectorAll('.stage-media iframe, .video-frame iframe');
    for (var i = 0; i < frames.length; i++) frames[i].remove();
  }

  audio.addEventListener('play', function () {
    stopVideo();
    render();
  });
  audio.addEventListener('pause', function () { render(); remember(); });
  audio.addEventListener('loadedmetadata', render);

  var lastSave = 0;
  audio.addEventListener('timeupdate', function () {
    render();
    markLine();
    if (Math.abs(audio.currentTime - lastSave) >= 5) { lastSave = audio.currentTime; remember(); }
  });

  window.addEventListener('pagehide', remember);

  // ---------- πλοήγηση χωρίς διακοπή ----------
  //
  // Αντί να αφήσουμε τον browser να πετάξει τη σελίδα — και μαζί τον ήχο —
  // κατεβάζουμε μόνοι μας τη νέα και αλλάζουμε ΜΟΝΟ το #page.

  var pageBox = document.getElementById('page');

  function internal(a) {
    if (!a || !a.getAttribute) return false;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#') return false;
    if (a.target || a.hasAttribute('download')) return false;
    // Σελίδες με δικό τους script πρέπει να φορτώνουν κανονικά: τα script
    // που μπαίνουν με αντικατάσταση περιεχομένου δεν εκτελούνται ποτέ.
    if (a.hasAttribute('data-reload')) return false;
    if (a.origin !== location.origin) return false;
    return true;
  }

  async function go(url, push) {
    var res, html;
    try {
      res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      html = await res.text();
    } catch (err) {
      location.href = url;          // αν κάτι πάει στραβά, κανονική πλοήγηση
      return;
    }

    var doc = new DOMParser().parseFromString(html, 'text/html');
    var next = doc.getElementById('page');
    if (!next) { location.href = url; return; }

    var swap = function () {
      pageBox.replaceChildren.apply(pageBox, Array.prototype.slice.call(next.childNodes));
      document.title = doc.title;
      window.scrollTo(0, 0);
      markSaved();
      // Οι γραμμές της απομαγνητοφώνησης είναι άλλες τώρα: ο παλιός
      // πίνακας δείχνει σε στοιχεία που δεν υπάρχουν πια στη σελίδα.
      trRows = null;
      trNow = -1;
      render();
      // Η σελίδα άλλαξε χωρίς να φορτώσει. Ό,τι άλλο στήθηκε πάνω στο
      // παλιό περιεχόμενο πρέπει να το μάθει — το roi.js, π.χ., έχει
      // μπροστά του καινούριο πλαίσιο ροής και δεν το ξέρει.
      document.dispatchEvent(new CustomEvent('selida:allaxe'));
    };

    if (document.startViewTransition) {
      document.startViewTransition(swap);
    } else {
      swap();
    }

    if (push) history.pushState({}, '', url);
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest('a');
    if (!internal(a)) return;
    e.preventDefault();
    go(a.href, true);
  });

  window.addEventListener('popstate', function () { go(location.href, false); });

  // ---------- ξεκίνημα ----------

  // Αν ο σύνδεσμος κουβαλάει στιγμή (#t=905), ξεκινάμε από εκεί.
  var jump = location.hash.match(/^#t=(\d+)/);
  if (jump) {
    var view = document.querySelector('[data-player-view]');
    if (view && view.dataset.src) {
      load(trackFrom(view), false);
      audio.addEventListener('loadedmetadata', function once() {
        audio.removeEventListener('loadedmetadata', once);
        audio.currentTime = Number(jump[1]);
        render();
      });
    }
  }

  markSaved();
  render();

  // ---------- ο αριθμός του αρχείου που ανεβαίνει ----------
  //
  // Το σωστό νούμερο είναι ΗΔΗ γραμμένο στη σελίδα από το build. Αυτό
  // εδώ απλώς το ανεβάζει από το μηδέν· αν η JavaScript δεν τρέξει ή ο
  // χρήστης θέλει λιγότερη κίνηση, βλέπει κατευθείαν το τελικό.
  (function countUp() {
    var el = document.querySelector('[data-countup]');
    if (!el) return;

    var target = Number(el.dataset.countup);
    if (!target) return;

    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (calm) return;

    var DURATION = 1000;
    var started = 0;

    function step(now) {
      if (!started) started = now;
      var t = Math.min(1, (now - started) / DURATION);
      // Γρήγορα στην αρχή, αργά στο τέλος — ίδια αίσθηση με τις κινήσεις.
      var eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(target * eased).toLocaleString('el');
      if (t < 1) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  })();
})();
