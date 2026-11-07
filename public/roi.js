// Η ζωντανή ροή ειδήσεων.
//
// Το πλαίσιο «Ροή ειδήσεων» στην αρχική είναι ήδη γραμμένο μέσα στη
// σελίδα, από το χτίσιμο. Αυτό εδώ το αντικαθιστά με τη φρέσκια ροή,
// αν υπάρχει φρεσκότερη.
//
// ΓΙΑΤΙ ΔΕΝ ΑΔΕΙΑΖΟΥΜΕ ΠΟΤΕ ΤΟ ΠΛΑΙΣΙΟ
//
// Ό,τι είναι γραμμένο στο HTML το βλέπουν όλοι: τα ρομπότ του Facebook
// και του Viber, που δεν εκτελούν JavaScript ΠΟΤΕ, η Google στο πρώτο
// της πέρασμα, και όποιος έχασε τη σύνδεση αφού κατέβηκε η σελίδα.
//
// Άρα το χειρότερο που επιτρέπεται να συμβεί εδώ είναι «δεν άλλαξε
// τίποτα». Κάθε αποτυχία βγαίνει σιωπηλά και αφήνει τα γραμμένα στη
// θέση τους.

(function () {
  'use strict';

  var POSA = 8;            // όσα δείχνει το πλαίσιο· το /roi στέλνει 12

  function grapse(ul, items) {
    var frag = document.createDocumentFragment();

    items.slice(0, POSA).forEach(function (it) {
      if (!it || !it.t || !it.u) return;

      // Με createElement και textContent, όχι innerHTML: οι τίτλοι
      // έρχονται από ξένη σελίδα και δεν τους εμπιστευόμαστε να
      // μπουν αυτούσιοι μέσα στη δική μας.
      var a = document.createElement('a');
      a.href = it.u;
      a.target = '_blank';
      a.rel = 'noopener';

      var cat = document.createElement('span');
      cat.className = 'ticker-cat';
      cat.textContent = it.k || 'Είδηση';

      var tit = document.createElement('span');
      tit.className = 'ticker-title';
      tit.textContent = it.t;

      a.appendChild(cat);
      a.appendChild(tit);

      var li = document.createElement('li');
      li.appendChild(a);
      frag.appendChild(li);
    });

    // Μόνο αν βγήκε κάτι. Άδειο fragment σημαίνει ότι το /roi μας
    // έδωσε σκουπίδια — και τότε τα γραμμένα είναι καλύτερα.
    if (!frag.childNodes.length) return;

    ul.replaceChildren(frag);
  }

  async function anaveosi() {
    var ul = document.querySelector('[data-roi]');
    if (!ul) return;                      // δεν είμαστε στην αρχική

    try {
      var res = await fetch('/roi', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;

      var data = await res.json();
      if (!data || !Array.isArray(data.items) || !data.items.length) return;

      // Ποιος είναι πιο φρέσκος; Το KV το γράφει το GitHub Action, τη
      // σελίδα το χτίσιμο — δύο δρόμοι που δεν τερματίζουν με σειρά.
      // Αν το KV έχει μείνει πίσω, τα γραμμένα είναι τα καλά και δεν
      // τα πειράζουμε. Όταν δεν υπάρχει ημερομηνία να συγκρίνουμε,
      // προχωράμε: η σύγκριση είναι ασφάλεια, όχι προϋπόθεση.
      var edo = Date.parse(ul.getAttribute('data-roi') || '');
      var ekei = Date.parse(data.proto || '');

      if (edo && ekei && ekei < edo) return;

      grapse(ul, data.items);
    } catch (err) {
      // Σιωπή. Η σελίδα έχει ήδη ροή· δεν υπάρχει τίποτα να πει στον
      // αναγνώστη, και μια κόκκινη γραμμή στην κονσόλα δεν τον βοηθά.
    }
  }

  // Στο φόρτωμα, και ξανά σε κάθε αλλαγή σελίδας χωρίς φόρτωμα: ο
  // player.js αλλάζει το περιεχόμενο με View Transitions, οπότε
  // γυρνώντας στην αρχική το πλαίσιο είναι καινούριο και άγραφο.
  anaveosi();
  document.addEventListener('selida:allaxe', anaveosi);

  // Και όταν ο αναγνώστης ξαναγυρίζει στην καρτέλα. Ένα κινητό που
  // έμεινε ανοιχτό από το πρωί δείχνει πρωινές ειδήσεις το βράδυ.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) anaveosi();
  });
}());
