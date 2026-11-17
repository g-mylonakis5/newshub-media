
(function () {
  'use strict';

  var KLEIDI = 'synainesi';

  function diavase(){
    try { return localStorage.getItem(KLEIDI); } catch (e) { return null; }
  }

  function grapse(timi){
    try { localStorage.setItem(KLEIDI, timi); } catch (e) { /* ιδιωτικό παράθυρο */ }
  }

  // The answer to Google. If gtag is missing — blocked by an extension,
  // or it did not load in time — nothing breaks: the choice is already
  // written and applies from the next page on.
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

    // Already answered: the banner never appears. A "no" is not asked
    // again — a question that keeps coming back is pressure, not a
    // question. It is changed from the Privacy page.
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

  // The Privacy page's "change your choice" button. Withdrawing has to be
  // as easy as consenting — the law says so, and it is right anyway.
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
