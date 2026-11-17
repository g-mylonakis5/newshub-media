
(function () {
  'use strict';

  var POSA = 8;            // what the box shows; /roi sends 12

  function grapse(ul, items) {
    var frag = document.createDocumentFragment();

    items.slice(0, POSA).forEach(function (it) {
      if (!it || !it.t || !it.u) return;

      // With createElement and textContent, not innerHTML: the titles
      // come from a foreign page and we do not trust them to go into
      // ours verbatim.
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

    // Only if something came out. An empty fragment means our /roi gave
    // us junk — and then what is baked in is better.
    if (!frag.childNodes.length) return;

    ul.replaceChildren(frag);
  }

  async function anaveosi() {
    var ul = document.querySelector('[data-roi]');
    if (!ul) return;                      // we are not on the homepage

    try {
      var res = await fetch('/roi', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;

      var data = await res.json();
      if (!data || !Array.isArray(data.items) || !data.items.length) return;

      var edo = Date.parse(ul.getAttribute('data-roi') || '');
      var ekei = Date.parse(data.proto || '');

      if (edo && ekei && ekei < edo) return;

      grapse(ul, data.items);
    } catch (err) {
      // Silence. The page already has a ticker; there is nothing to tell
      // the reader, and a red line in the console does not help them.
    }
  }

  // On load, and again on every page change without a load: player.js
  // swaps the content with View Transitions, so coming back to the
  // homepage the box is new and unwritten.
  anaveosi();
  document.addEventListener('selida:allaxe', anaveosi);

  // And when the reader returns to the tab. A phone left open since the
  // morning shows morning news in the evening.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) anaveosi();
  });
}());
