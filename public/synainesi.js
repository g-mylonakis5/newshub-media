// synainesi.js — η λωρίδα της συγκατάθεσης.
//
// Γραμμένο με το χέρι, όπως ο player: δεν το παράγει το build.js.
//
// ΤΙ ΚΑΝΕΙ
//
// Δείχνει τη λωρίδα σε όποιον δεν έχει απαντήσει ακόμα, και στέλνει
// την απάντηση στο Google με gtag('consent','update'). Η αρχική
// δήλωση — όλα «denied» — έχει ήδη τρέξει μέσα στη σελίδα, πριν
// κατέβει το gtag.js. Δες metriseis() στο build.js.
//
// ΓΙΑΤΙ ΔΕΝ ΞΑΝΑΦΟΡΤΩΝΕΙ Η ΣΕΛΙΔΑ ΜΕΤΑ ΤΗΝ ΑΠΑΝΤΗΣΗ
//
// Το Consent Mode είναι φτιαγμένο ακριβώς γι' αυτό: το gtag δέχεται
// την αλλαγή εν κινήσει και στέλνει από εκεί και πέρα κανονικά. Μια
// ανανέωση σελίδας θα σταματούσε και τον ήχο που παίζει — ο player
// είναι όλο το νόημα αυτού του site.
//
// ΤΟ localStorage ΜΠΟΡΕΙ ΝΑ ΣΚΑΣΕΙ
//
// Σε ιδιωτικό παράθυρο ή με μπλοκαρισμένα δεδομένα site, η ανάγνωση
// και η εγγραφή πετάνε σφάλμα. Κάθε κλήση είναι τυλιγμένη: χωρίς
// αυτό, μια λωρίδα συγκατάθεσης θα έσπαγε τη σελίδα σε ανθρώπους που
// ακριβώς νοιάζονται για το απόρρητό τους.

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

  // Η πλοήγηση γίνεται χωρίς ξαναφόρτωμα — ο player αλλάζει ΜΟΝΟ το
  // περιεχόμενο του #page και φωνάζει «selida:allaxe».
  //
  // Η λωρίδα ζει ΕΞΩ από το #page, οπότε επιβιώνει μόνη της μαζί με τον
  // listener της. Το κουτί «Άλλαξε την επιλογή σου» όμως είναι μέσα
  // στη σελίδα Απόρρητο: κάθε φορά που φορτώνει, είναι καινούριο
  // στοιχείο και θέλει ξαναστήσιμο.
  document.addEventListener('selida:allaxe', stiseAllagi);
}());
