
(function () {
  'use strict';

  var audio = new Audio();
  audio.preload = 'metadata';

  var track = null;            // { id, src, title, show, art, href }
  var speeds = [1, 1.25, 1.5, 2];
  var speedAt = 0;

  var bar = document.querySelector('.bar');

  // ---------- helpers ----------

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
        synVale(false);
      } else {
        localStorage.removeItem(posKey());
        synVale(true);
      }
    } catch (e) { /* ιδιωτική περιήγηση */ }
  }

  var SYN_KEY = 'synexeia';
  var SYN_MAX = 6;            // how many we remember
  var SYN_DEIXNE = 4;         // how many the homepage shows

  function synApolyto(href) {
    try {
      var u = new URL(href, location.href);
      return u.pathname + u.search;
    } catch (e) {
      return href;
    }
  }

  var SYN_SOSTO = /^\/(episode|video)\//;

  function synDiavase() {
    try {
      var l = JSON.parse(localStorage.getItem(SYN_KEY) || '[]');
      if (!Array.isArray(l)) return [];
      return l.filter(function (x) { return x && x.h && SYN_SOSTO.test(x.h); });
    } catch (e) { return []; }
  }

  // The keys are SHORT on purpose (t, s, a, h, p, d, w): localStorage is
  // a few MB and everything we keep shares it.
  function synVale(sviseMono) {
    if (!track) return;

    var list = synDiavase().filter(function (x) {
      return x && x.id !== track.id;
    });

    if (!sviseMono) {
      list.unshift({
        id: track.id,
        t: track.title,
        s: track.show,
        a: track.art,
        h: track.href,
        p: Math.floor(audio.currentTime),
        d: Math.floor(audio.duration) || 0,
        w: Date.now()
      });
    }

    try {
      localStorage.setItem(SYN_KEY, JSON.stringify(list.slice(0, SYN_MAX)));
    } catch (e) { /* γεμάτος χώρος ή ιδιωτική περιήγηση */ }
  }

  // ---------- the views ----------

  // Each view is one element: the bar, or a .player inside the page.
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
      // A page view shows ITS OWN episode only.
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

      // The current episode's waveform on the persistent bar.
      var seek = bar.querySelector('.bar-seek');
      if (seek && seek.style.getPropertyValue('--wave') !== track.wave) {
        seek.style.setProperty('--wave', track.wave || '');
      }
    }
  }

  // ---------- control ----------

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

  function seekTo(seconds) {
    var view = document.querySelector('[data-player-view]');
    if (!view || !view.dataset.id) return;

    var later = function () {
      audio.addEventListener('loadedmetadata', function once() {
        audio.removeEventListener('loadedmetadata', once);
        audio.currentTime = seconds;
        // Anyone clicking a timestamp wants to listen, not just to seek.
        if (audio.paused) audio.play().catch(function () {});
        render();
      });
    };

    // load() also adds a loadedmetadata for the stored position. Ours is
    // added after, so it runs after, so it wins.
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
      // textContent, not innerHTML: the text comes from Buzzsprout and we
      // do not write it — anything that looks like a tag stays letters.
      said.textContent = text;

      row.appendChild(btn);
      row.appendChild(said);
      frag.appendChild(row);
    }

    box.appendChild(frag);
    // The line index was built when there was nothing — again.
    trRows = null;
    trNow = -1;
  }

  function openTranscript(details) {
    if (details.dataset.loaded) return;
    details.dataset.loaded = '1';            // once, even if it fails

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
        details.dataset.loaded = '';         // let it try again
      });
  }

  // ---- the grid panel ----

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

    // A click outside the panel closes it. Inside it does not — otherwise
    // the link just clicked would not have time to open.
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

  function flatten(text) {
    return String(text).toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zα-ω0-9]+/g, ' ')
      .trim();
  }

  // Which letter is selected. Empty = all.
  var pickedLetter = '';

  function filterPeople(box) {
    var want = box ? flatten(box.value) : '';
    var list = box ? box.closest('.all-people') : document.querySelector('.all-people');
    if (!list) return;

    var rows = list.querySelectorAll('.plist-row');
    var shown = 0;

    for (var i = 0; i < rows.length; i++) {
      // Two filters together: the typed name AND the letter. Someone
      // typing in the box while "Κ" is selected expects to search within
      // the Κ, not to have their choice silently changed.
      var okText = !want || rows[i].dataset.find.indexOf(want) !== -1;
      var okLetter = !pickedLetter || rows[i].dataset.letter === pickedLetter;
      var ok = okText && okLetter;
      rows[i].hidden = !ok;
      if (ok) shown++;
    }

    // The letter anchors hide when no name is left under them, or a "Κ"
    // is left pointing at nothing.
    var marks = list.querySelectorAll('.plist-mark');
    for (var j = 0; j < marks.length; j++) {
      // With a letter selected all the markers are redundant: the
      // alphabet above already says it, highlighted. A "Κ" above a list
      // of nothing but Κ ate a column slot and said nothing.
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

    // The alphabet STAYS visible while you type: it is now a filter, not
    // a set of anchors, and you need the way back to "all".
  }

  // "input" bubbles to the document, unlike focus/blur — so one listener
  // is enough, even after a page change.
  document.addEventListener('input', function (e) {
    var box = e.target.closest('[data-people-filter]');
    if (box) filterPeople(box);
  });

  // Click on a letter: show only that one. The same listener catches
  // "all", which clears the selection.
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

  // The line playing now. There are up to 158 lines, and timeupdate fires
  // four times a second, so we do not search from the start: almost
  // always we move one line forward.
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
      href: synApolyto(el.dataset.href || location.pathname),
      wave: waveOf(el),
    };
  }

  // --wave sits on the .player-bar inside the view. If it is missing — an
  // old page, or a view with no bar — we return empty and the CSS rule
  // leaves the plain line, which works fine.
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

  // ---------- the homepage topics ----------

  // How many cards we show once someone picks a topic.
  var TOPIC_MAX = 12;

  // Filters the flow without loading ANYTHING: the cards for every topic
  // are already in the page, just hidden. That is why changing topic is
  // instant, however many episodes the archive holds.
  function showTopic(key) {
    var flow = document.querySelector('.flow');
    if (!flow) return;

    var cards = flow.querySelectorAll('.card');
    var shown = 0;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var ok;
      if (key === 'all') {
        // "All" = the most recent. The cards added for the topics' sake
        // stay hidden, or the flow would triple.
        ok = c.className.indexOf('is-extra') === -1;
      } else {
        var mine = (' ' + (c.getAttribute('data-topics') || '') + ' ')
          .indexOf(' ' + key + ' ') !== -1;
        ok = mine && shown < TOPIC_MAX;
      }
      c.hidden = !ok;
      if (ok) shown++;

      c.style.order = key === 'all' ? '' : (c.dataset.rank || '');
    }

    flow.setAttribute('data-topic', key);

    // Which chip is lit, and what the title above says. The same wording
    // as the build (the "Latest" strip): the flow holds articles and
    // videos too, not only episodes.
    var name = 'Τελευταία';
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

    for (var k = 0; k < cards.length; k++) {
      var label = cards[k].querySelector('.card-label');
      if (!label) continue;
      if (label.dataset.first === undefined) label.dataset.first = label.textContent;
      label.textContent = key === 'all' ? label.dataset.first : name;
    }

    // The title sits OUTSIDE the flow, at the top of the red strip, which
    // is why we look for it across the page and not inside the flow.
    var head = document.querySelector('[data-flow-head]');
    if (head) head.textContent = name;

    // The way through to the whole topic. We show 12 of 1,082 — there has
    // to be a way to see the rest.
    var foot = flow.querySelector('.flow-all');
    var link = flow.querySelector('[data-flow-all]');
    // The link is ALWAYS there, only its target changes: the archive when
    // you are seeing the most recent, the topic when you have picked one.
    if (foot && link) {
      link.setAttribute('href', href);
      link.textContent = key === 'all'
        ? 'Όλα τα επεισόδια →'
        : 'Όλα τα ' + count + ' →';
    }
  }

  // Τα Reels είναι role="button" με tabindex, άρα πρέπει να ανοίγουν και
  // με Enter ή κενό. Ένα div δεν το κάνει μόνο του, όπως το <button>.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;

    var reel = e.target.closest && e.target.closest('.reel-stage[data-embed]');
    if (!reel || reel.querySelector('iframe')) return;

    e.preventDefault();
    reel.click();
  });

  // ---------- clicks, with one listener for everything ----------

  document.addEventListener('click', function (e) {
    // a) YouTube's fake player: the real video goes ON TOP of the
    // thumbnail, not in its place — so when it closes, the thumbnail is
    // still there.
    var stage = e.target.closest('[data-embed]');
    if (stage && !stage.querySelector('iframe')) {
      var frame = document.createElement('iframe');
      // Τα Facebook Reels φέρνουν ήδη ?href=..., το YouTube όχι. Χωρίς
      // αυτό θα έβγαινε δεύτερο ερωτηματικό και το embed δεν θα άνοιγε.
      var xorismos = stage.dataset.embed.indexOf('?') < 0 ? '?' : '&';
      frame.src = stage.dataset.embed + xorismos + 'autoplay=1&rel=0';
      frame.title = document.title;
      // Το fullscreen θέλει ΚΑΙ τα δύο: το allow, που είναι ο σημερινός
      // τρόπος, και το allowFullscreen, που είναι ο παλιός. Χωρίς το
      // πρώτο, το κουμπί πλήρους οθόνης του Facebook δεν κάνει τίποτα.
      frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen';
      frame.allowFullscreen = true;
      stage.appendChild(frame);
      audio.pause();
      return;
    }

    // b) the Watch / Listen toggle
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

    var head = e.target.closest('.transcript-head');
    if (head) {
      openTranscript(head.closest('.transcript'));
      return;                      // the <details> opens by itself
    }

    // d) a transcript timestamp: move the audio there
    var at = e.target.closest('[data-seek]');
    if (at) {
      seekTo(Number(at.dataset.seek));
      return;
    }

    // e) the player controls
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

    // d) Share
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

    // e) My list
    var save = e.target.closest('.act-save');
    if (save) {
      listaAllaxe(save);
      return;
    }

    // e2) The ✕ on a card in the list. It is inside an <a>, so without
    // preventDefault the press would also open the episode.
    var vgale = e.target.closest('[data-lista-vgale]');
    if (vgale) {
      e.preventDefault();
      listaGrapse(listaDiavase().filter(function (x) {
        return x.id !== vgale.getAttribute('data-lista-vgale');
      }));
      listaDeixe();
      markSaved();
      return;
    }

    // f) the topic chips on the homepage. They filter in place, but stay
    // ordinary links: with no JavaScript, or on a middle click, they open
    // the topic's page.
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

  var LISTA_KEY = 'lista';
  var LISTA_MAX = 50;

  function listaDiavase() {
    try {
      var l = JSON.parse(localStorage.getItem(LISTA_KEY) || '[]');
      return Array.isArray(l) ? l.filter(function (x) { return x && x.id; }) : [];
    } catch (e) { return []; }
  }

  function listaGrapse(list) {
    try {
      localStorage.setItem(LISTA_KEY, JSON.stringify(list.slice(0, LISTA_MAX)));
    } catch (e) { /* γεμάτος χώρος ή ιδιωτική περιήγηση */ }
  }

  function listaOpsi(btn) {
    var kouti = btn && btn.closest('.episode-main, .art-embed-play, .strip');
    return (kouti && kouti.querySelector('[data-player-view]'))
      || (kouti && kouti.parentNode && kouti.parentNode.querySelector('[data-player-view]'))
      || document.querySelector('[data-player-view]');
  }

  function listaAllaxe(btn) {
    var view = listaOpsi(btn);
    if (!view || !view.dataset.id) return;

    var id = view.dataset.id;
    var list = listaDiavase();
    var meta = list.filter(function (x) { return x.id !== id; });

    // It was already in — the press takes it out.
    if (meta.length !== list.length) {
      listaGrapse(meta);
    } else {
      meta.unshift({
        id: id,
        t: view.dataset.title || '',
        s: view.dataset.show || '',
        a: view.dataset.art || '',
        h: synApolyto(view.dataset.href || location.pathname),
        w: Date.now()
      });
      listaGrapse(meta);
    }

    markSaved();
    listaDeixe();
  }

  function listaDeixe() {
    var box = document.querySelector('[data-lista]');
    if (!box) return;                       // we are not on the homepage

    var grid = box.querySelector('[data-lista-grid]');
    if (!grid) return;

    var list = listaDiavase().filter(function (x) { return x.h; });
    if (!list.length) { box.hidden = true; return; }

    grid.replaceChildren.apply(grid, list.map(listaKarta));
    box.hidden = false;
  }

  // The same card as "Continue", without the progress bar — there is no
  // position to show here — and with a ✕ to drop it from the list.
  function listaKarta(x) {
    var a = document.createElement('a');
    a.className = 'syn-card';
    a.href = x.h;

    var media = document.createElement('span');
    media.className = 'syn-media';

    if (x.a) {
      var img = document.createElement('img');
      img.className = 'syn-art';
      img.src = x.a;
      img.alt = '';
      img.loading = 'lazy';
      img.width = 300;
      img.height = 300;
      media.appendChild(img);
    } else {
      var kena = document.createElement('span');
      kena.className = 'syn-art syn-art--empty';
      media.appendChild(kena);
    }

    a.appendChild(media);

    var text = document.createElement('span');
    text.className = 'syn-text';

    if (x.s) {
      var show = document.createElement('span');
      show.className = 'syn-show';
      show.textContent = x.s;
      text.appendChild(show);
    }

    var tit = document.createElement('span');
    tit.className = 'syn-name';
    tit.textContent = x.t || 'Χωρίς τίτλο';
    text.appendChild(tit);

    a.appendChild(text);

    var vgale = document.createElement('button');
    vgale.type = 'button';
    vgale.className = 'syn-vgale';
    vgale.setAttribute('data-lista-vgale', x.id);
    vgale.setAttribute('aria-label', 'Αφαίρεση από τη λίστα μου');
    vgale.textContent = '✕';
    a.appendChild(vgale);

    return a;
  }

  function markSaved() {
    var btns = document.querySelectorAll('.act-save');
    var list = listaDiavase();

    for (var i = 0; i < btns.length; i++) {
      var view = listaOpsi(btns[i]);
      if (!view) continue;

      var id = view.dataset.id;
      var on = list.some(function (x) { return x.id === id; });
      btns[i].classList.toggle('is-on', on);
      btns[i].textContent = on ? '✓ Στη λίστα μου' : '+ Στη λίστα μου';
    }
  }

  // ---------- audio events ----------

  // One thing at a time: as soon as the audio starts, the YouTube video
  // closes — otherwise both would play together.
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

  var pageBox = document.getElementById('page');

  function internal(a) {
    if (!a || !a.getAttribute) return false;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) === '#') return false;
    if (a.target || a.hasAttribute('download')) return false;
    // Pages with a script of their own have to load normally: scripts
    // inserted by replacing content never execute.
    if (a.hasAttribute('data-reload')) return false;
    if (a.origin !== location.origin) return false;
    return true;
  }

  function ekdosi(root) {
    var map = {};
    var links = root.querySelectorAll('link[rel="stylesheet"], script[src]');
    for (var i = 0; i < links.length; i++) {
      var src = links[i].getAttribute('href') || links[i].getAttribute('src') || '';
      var at = src.indexOf('?v=');
      if (at < 0) continue;
      map[src.slice(0, at).split('/').pop()] = src.slice(at + 3);
    }
    return map;
  }

  function alliExdosi(a, b) {
    for (var name in a) {
      if (Object.prototype.hasOwnProperty.call(a, name)
        && Object.prototype.hasOwnProperty.call(b, name)
        && a[name] !== b[name]) return true;
    }
    return false;
  }

  async function go(url, push) {
    var res, html;
    try {
      res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      html = await res.text();
    } catch (err) {
      location.href = url;          // if anything goes wrong, navigate normally
      return;
    }

    var doc = new DOMParser().parseFromString(html, 'text/html');
    var next = doc.getElementById('page');
    if (!next) { location.href = url; return; }

    if (alliExdosi(ekdosi(doc), ekdosi(document))) { location.href = url; return; }

    var swap = function () {
      pageBox.replaceChildren.apply(pageBox, Array.prototype.slice.call(next.childNodes));
      document.title = doc.title;
      window.scrollTo(0, 0);
      markSaved();
      // The transcript's lines are different now: the old index points at
      // elements that are no longer in the page.
      trRows = null;
      trNow = -1;
      render();
      // The page changed without loading. Anything else built on the old
      // content has to find out — roi.js, for instance, is facing a new
      // ticker box and does not know it.
      document.dispatchEvent(new CustomEvent('selida:allaxe'));
    };

    if (document.startViewTransition) {
      document.startViewTransition(swap);
    } else {
      swap();
    }

    if (push) history.pushState({}, '', url);

    // Where we are now, without the anchor. The popstate check below
    // keeps it current — otherwise, after two clicks, it would think
    // "back" was just an anchor and would not go back.
    edo = String(url).split('#')[0];
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest('a');
    if (!internal(a)) return;
    e.preventDefault();
    go(a.href, true);
  });

  var edo = location.href.split('#')[0];

  window.addEventListener('popstate', function () {
    var tora = location.href.split('#')[0];
    if (tora === edo) return;     // only the anchor changed — leave it to the browser
    edo = tora;
    go(location.href, false);
  });

  function synLeipoun(sec) {
    var m = Math.round(sec / 60);
    if (m < 1) return 'απομένει λιγότερο από 1′';
    if (m === 1) return 'απομένει 1 λεπτό';
    return 'απομένουν ' + m + '′';
  }

  function synKarta(x) {
    var pct = Math.max(2, Math.min(100, (x.p / x.d) * 100));

    var a = document.createElement('a');
    a.className = 'syn-card';
    a.href = x.h;

    var media = document.createElement('span');
    media.className = 'syn-media';

    if (x.a) {
      var img = document.createElement('img');
      img.className = 'syn-art';
      img.src = x.a;
      img.alt = '';
      img.loading = 'lazy';
      img.width = 300;
      img.height = 300;
      media.appendChild(img);
    } else {
      var kena = document.createElement('span');
      kena.className = 'syn-art syn-art--empty';
      media.appendChild(kena);
    }

    // The progress bar. It sits INSIDE the poster, at the bottom edge —
    // the same mark people know from every other player.
    var bar = document.createElement('span');
    bar.className = 'syn-bar';
    var fill = document.createElement('span');
    fill.className = 'syn-fill';
    fill.style.width = pct.toFixed(1) + '%';
    bar.appendChild(fill);
    media.appendChild(bar);

    a.appendChild(media);

    var text = document.createElement('span');
    text.className = 'syn-text';

    if (x.s) {
      var show = document.createElement('span');
      show.className = 'syn-show';
      show.textContent = x.s;
      text.appendChild(show);
    }

    var tit = document.createElement('span');
    tit.className = 'syn-name';
    tit.textContent = x.t || 'Χωρίς τίτλο';
    text.appendChild(tit);

    var left = document.createElement('span');
    left.className = 'syn-left';
    left.textContent = synLeipoun(x.d - x.p);
    text.appendChild(left);

    a.appendChild(text);
    return a;
  }

  function synDeixe() {
    var box = document.querySelector('[data-synexeia]');
    if (!box) return;                       // we are not on the homepage

    var grid = box.querySelector('[data-synexeia-grid]');
    if (!grid) return;

    // We keep only what has BOTH a position AND a duration: with no
    // duration there is no percentage, so there is no graphic. And
    // anything that reached the end is not "continue", it is "finished".
    var list = synDiavase().filter(function (x) {
      return x && x.id && x.h && x.d > 0 && x.p > 0 && x.p < x.d;
    }).slice(0, SYN_DEIXNE);

    if (!list.length) { box.hidden = true; return; }

    grid.replaceChildren.apply(grid, list.map(synKarta));
    box.hidden = false;
  }

  // And after navigation without a load: the homepage may come back in
  // front of us with different content and a different (hidden) box.
  document.addEventListener('selida:allaxe', synDeixe);
  document.addEventListener('selida:allaxe', listaDeixe);
  document.addEventListener('selida:allaxe', markSaved);

  window.addEventListener('pageshow', function (e) {
    if (e.persisted) { synDeixe(); listaDeixe(); }
  });

  // ---------- startup ----------

  // If the link carries a moment (#t=905), we start from there.
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
  synDeixe();
  listaDeixe();

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
      // Fast at the start, slow at the end — the same feel as the motion.
      var eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(target * eased).toLocaleString('el');
      if (t < 1) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  })();
})();
