
(function () {
  'use strict';

  var KLEIDI = 'synainesi';

  function diavase(){
    try { return localStorage.getItem(KLEIDI); } catch (e) { return null; }
  }

  function grapse(timi){
    try { localStorage.setItem(KLEIDI, timi); } catch (e) { /* ιδιωτικό παράθυρο */ }
  }

  // Η απάντηση στο Google. Αν λείπει το gtag — μπλοκαρισμένο από
  // επέκταση, ή δεν πρόλαβε να φορτώσει — δεν σπάει τίποτα: η επιλογή
  // έχει ήδη γραφτεί και ισχύει από την επόμενη σελίδα.
  function pesStoGoogle(nai){
    if (typeof window.gtag !== 'function') return;
    var t = nai ? 'granted' : 'denied';
    window.gtag('consent', 'update', {
      ad_storage: t,
      ad_user_data: t,
      ad_personalization: t,
      analytics_storage: t,
    });
  }

  function apantise(timi){
    grapse(timi);
    pesStoGoogle(timi === 'nai');
    var bar = document.querySelector('[data-synainesi]');
    if (bar) bar.hidden = true;
  }

  function stise(){
    var bar = document.querySelector('[data-synainesi]');
    if (!bar) return;

    // Ήδη απαντημένο: η λωρίδα δεν εμφανίζεται ποτέ. Το «όχι» δεν
    // ξαναρωτιέται — μια ερώτηση που επανέρχεται είναι πίεση, όχι
    // ερώτηση. Αλλάζει από τη σελίδα «Απόρρητο».
    var exei = diavase();
    if (exei === 'nai' || exei === 'oxi') {
      pesStoGoogle(exei === 'nai');
      return;
    }

    bar.hidden = false;

    bar.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-syn]');
      if (btn) apantise(btn.dataset.syn);
    });
  }

  // Το κουμπί «Άλλαξε την επιλογή σου» της σελίδας Απόρρητο. Η ανάκληση
  // πρέπει να είναι τόσο εύκολη όσο η συγκατάθεση — το λέει ο νόμος,
  // και είναι και το σωστό.
  function stiseAllagi(){
    var box = document.querySelector('[data-syn-allagi]');
    if (!box) return;

    var pou = diavase();
    var txt = box.querySelector('[data-syn-tora]');
    if (txt) {
      txt.textContent = pou === 'nai'
        ? 'Σήμερα: έχεις δεχτεί τις cookies μέτρησης.'
        : (pou === 'oxi'
          ? 'Σήμερα: έχεις αρνηθεί. Δεν μπαίνει καμία cookie.'
          : 'Δεν έχεις απαντήσει ακόμα. Δεν μπαίνει καμία cookie.');
    }

    box.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-syn]');
      if (!btn) return;
      apantise(btn.dataset.syn);
      stiseAllagi();
    });
  }

  function xekina(){
    stise();
    stiseAllagi();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', xekina);
  } else {
    xekina();
  }

  document.addEventListener('selida:allaxe', stiseAllagi);
}());
