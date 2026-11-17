
const SITEMAP = 'https://www.newshub.gr/sitemap_google_news.xml';
const WORKFLOW = 'fetch.yml';

const SIMEIOMA = 'simeiomatario';

const PALIA = {
  apotyposi: 'sitemap-apotypoma',
  patima: 'teleftaio-patima',
  varia: 'teleftaio-varia',
};

const VARIA_LEPTA = 60;

// Ο παλμός: κάθε πόσα λεπτά πατάμε το κουμπί ΑΚΟΜΑ ΚΙ ΑΝ δεν άλλαξε
// τίποτα στο sitemap. Δες το σχόλιο στο koitaKaiPata για το γιατί.
const KARDIA_LEPTA = 5;

const PATOMA_LEPTA = 1;

function apotyposi(xml) {
  let h = 0x811c9dc5;
  const re = /<loc>([^<]+)<\/loc>/g;
  let m;
  let plithos = 0;

  while ((m = re.exec(xml)) !== null) {
    const loc = m[1];
    plithos++;
    for (let i = 0; i < loc.length; i++) {
      h ^= loc.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }

  // Το πλήθος μπαίνει δίπλα στο άθροισμα: δύο διαφορετικές λίστες με
  // το ίδιο άθροισμα είναι απίθανες, αλλά αν συμβεί, το πλήθος τις
  // ξεχωρίζει — και δεν κοστίζει τίποτα.
  return `${plithos}:${(h >>> 0).toString(16)}`;
}

async function diavase(env) {
  const raw = await env.ROI.get(SIMEIOMA);

  if (raw) {
    try {
      const s = JSON.parse(raw);
      return {
        apotyposi: s.apotyposi || '',
        patima: Number(s.patima) || 0,
        varia: Number(s.varia) || 0,
      };
    } catch (err) {
      // Χαλασμένο σημείωμα. Δεν σταματάμε γι' αυτό — συνεχίζουμε στα
      // παλιά, και το επόμενο πάτημα το ξαναγράφει σωστά.
    }
  }

  const [apotyposi, patima, varia] = await Promise.all([
    env.ROI.get(PALIA.apotyposi),
    env.ROI.get(PALIA.patima),
    env.ROI.get(PALIA.varia),
  ]);

  return {
    apotyposi: apotyposi || '',
    patima: Number(patima) || 0,
    varia: Number(varia) || 0,
  };
}

async function pataToKoumpi(env, varia = false) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    throw new Error('Λείπουν ρυθμίσεις: GITHUB_TOKEN, GITHUB_REPO');
  }

  const url = `https://api.github.com/repos/${env.GITHUB_REPO}`
    + `/actions/workflows/${WORKFLOW}/dispatches`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'newshub-media-roloi',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(varia
      ? { ref: env.GITHUB_BRANCH || 'main', inputs: { varia: 'true' } }
      : { ref: env.GITHUB_BRANCH || 'main' }),
  });

  // Επιτυχία = 204 χωρίς σώμα.
  if (res.status === 204) return;

  const detail = (await res.text()).slice(0, 300);
  throw new Error(`GitHub ${res.status}: ${detail}`);
}

async function koitaKaiPata(env, anagkastika = false) {
  const res = await fetch(SITEMAP, {
    headers: { 'User-Agent': 'newshub-media-roloi' },
    // Χωρίς αυτό, η Cloudflare μπορεί να μας σερβίρει δική της
    // αποθηκευμένη αντιγραφή — και θα κοιτάζαμε χθεσινό sitemap
    // νομίζοντας ότι δεν βγήκε τίποτα.
    cf: { cacheTtl: 0, cacheEverything: false },
  });

  if (!res.ok) throw new Error(`Το sitemap απάντησε ${res.status}`);

  const tora = apotyposi(await res.text());

  // Ένα διάβασμα για όλα όσα θυμόμαστε.
  const simeioma = await diavase(env);
  const prin = simeioma.apotyposi;

  const perasanVaria = (Date.now() - simeioma.varia) / 60000;
  const thelouneVaria = perasanVaria >= VARIA_LEPTA;

  // Πόση ώρα από το τελευταίο πάτημα. Διαβάζεται ΠΡΙΝ από τον έλεγχο
  // αλλαγής, γιατί το χρειάζεται και ο παλμός παρακάτω.
  const perasan = (Date.now() - simeioma.patima) / 60000;

  const kardia = perasan >= KARDIA_LEPTA;

  if (!anagkastika && tora === prin && !thelouneVaria && !kardia) {
    return 'Τίποτα καινούριο — δεν ξύπνησα κανέναν.';
  }

  // Το πάτωμα, μόνο για τις ειδήσεις. Τα βαριά και ο παλμός το
  // ΠΡΟΣΠΕΡΝΟΥΝ: έρχονται ούτως ή άλλως πολύ πιο αραιά από αυτό.
  if (!anagkastika && !thelouneVaria && !kardia && perasan < PATOMA_LEPTA) {
    const meno = (PATOMA_LEPTA - perasan).toFixed(1);
    return `Υπάρχει καινούριο, αλλά πάτησα πριν ${perasan.toFixed(1)}'`
      + ` — περιμένω άλλα ${meno}'.`;
  }

  await pataToKoumpi(env, thelouneVaria);

  // Σώζουμε ΜΟΝΟ μετά από επιτυχημένο πάτημα. Αν το GitHub αρνηθεί, το
  // αποτύπωμα μένει παλιό και ξαναπροσπαθούμε στο επόμενο λεπτό —
  // αλλιώς μια στιγμιαία άρνηση θα έθαβε τα άρθρα για πάντα.
  const stigmi = Date.now();
  await env.ROI.put(SIMEIOMA, JSON.stringify({
    apotyposi: tora,
    patima: stigmi,
    varia: thelouneVaria ? stigmi : simeioma.varia,
  }));

  if (thelouneVaria) {
    return `Το πάτησα ΜΕ βίντεο (πέρασαν ${perasanVaria.toFixed(0)}').`
      + ` Αποτύπωμα: ${tora}`;
  }
  if (tora === prin) return `Παλμός — πάτησα χωρίς αλλαγή στο sitemap.`;
  return `Το πάτησα. Αποτύπωμα: ${tora}`;
}

async function grapseRoi(request, env) {
  if (!env.ROI) {
    return new Response('Δεν υπάρχει σύνδεση με το KV.\n', { status: 500 });
  }

  let data;
  try {
    data = await request.json();
  } catch (err) {
    return new Response('Το σώμα δεν είναι JSON.\n', { status: 400 });
  }

  if (!data || !Array.isArray(data.items) || !data.items.length) {
    // Ποτέ άδεια ροή: θα έσβηνε το πλαίσιο σε όλους, και μια στιγμιαία
    // αστοχία της λήψης θα γινόταν ορατή βλάβη. Η προηγούμενη ροή,
    // όσο παλιά κι αν είναι, είναι καλύτερη από το τίποτα.
    return new Response('Άδεια ροή — δεν γράφω.\n', { status: 400 });
  }

  for (const it of data.items) {
    if (!it || typeof it.t !== 'string' || typeof it.u !== 'string') {
      return new Response('Στοιχείο χωρίς τίτλο ή διεύθυνση.\n', { status: 400 });
    }
    // Η διεύθυνση μπαίνει σε href. Μόνο newshub.gr, και μόνο https:
    // ένα «javascript:» εκεί μέσα θα έτρεχε στον browser του αναγνώστη.
    if (!it.u.startsWith('https://www.newshub.gr/')) {
      return new Response(`Ξένη διεύθυνση: ${it.u.slice(0, 60)}\n`, { status: 400 });
    }
  }

  const perioxomeno = {
    proto: typeof data.proto === 'string' ? data.proto : '',
    items: data.items.map((it) => ({
      t: it.t,
      u: it.u,
      k: typeof it.k === 'string' ? it.k : '',
    })),
  };

  const palio = await env.ROI.get('roi');
  if (palio) {
    try {
      const p = JSON.parse(palio);
      if (JSON.stringify({ proto: p.proto, items: p.items }) === JSON.stringify(perioxomeno)) {
        return new Response('Ίδιοι τίτλοι — δεν ξαναέγραψα.\n');
      }
    } catch (err) {
      // Χαλασμένο· το ξαναγράφουμε από την αρχή.
    }
  }

  await env.ROI.put('roi', JSON.stringify({
    pote: new Date().toISOString(),
    ...perioxomeno,
  }));

  return new Response(`Γράφτηκαν ${data.items.length} τίτλοι.\n`);
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(koitaKaiPata(env).then((ti) => console.log(ti)));
  },

  async fetch(request, env) {
    const q = new URL(request.url).searchParams;

    if (!env.KLEIDI || q.get('kleidi') !== env.KLEIDI) {
      return new Response('Λάθος ή απόν κλειδί.\n', { status: 403 });
    }

    if (request.method === 'POST') {
      return grapseRoi(request, env);
    }

    try {
      const ti = await koitaKaiPata(env, q.get('tora') === '1');
      return new Response(`${ti}\n`);
    } catch (err) {
      return new Response(`Δεν έγινε: ${err.message}\n`, { status: 502 });
    }
  },
};
