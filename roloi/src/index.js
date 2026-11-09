// Το ρολόι.
//
// Δουλειά του: μία και μόνη. Να πατάει το κουμπί «Φέρε τα νέα τώρα»
// στην ώρα του, χωρίς να το θυμάται άνθρωπος — και ΜΟΝΟ όταν υπάρχει
// λόγος.
//
// ΓΙΑΤΙ ΥΠΑΡΧΕΙ
//
// Το GitHub Actions έχει δικό του χρονοδιάγραμμα (cron) και το
// χρησιμοποιούσαμε. Δεν είναι ρολόι — είναι παράκληση. Το ίδιο το
// GitHub γράφει ότι σε φόρτο τα προγραμματισμένα τρεξίματα καθυστερούν
// ή ΠΕΤΙΟΥΝΤΑΙ, και τα πυκνά θυσιάζονται πρώτα.
//
// Μετρημένο στις 7 Νοεμβρίου 2026: ζητήσαμε 31 τρεξίματα, έγιναν 4.
// Το site ξημέρωσε με τις χθεσινοβραδινές ειδήσεις, δέκα ώρες στάσιμο,
// και κανένα σφάλμα πουθενά — όλα τα τρεξίματα ήταν πράσινα. Απλώς δεν
// έγιναν. Σιωπηλή βλάβη, η χειρότερη που υπάρχει.
//
// Το cron της Cloudflare είναι αληθινό ρολόι. Οπότε το χρονοδιάγραμμα
// το κρατάει αυτό, και η δουλειά μένει στο GitHub, που έχει το git.
//
// ΓΙΑΤΙ ΚΟΙΤΑΖΕΙ ΠΡΩΤΑ
//
// Το GitHub χρεώνει ΑΝΑ ΤΡΕΞΙΜΟ, στρογγυλεμένο σε ολόκληρο λεπτό. Το
// τρέξιμό μας κρατά 15-30 δευτερόλεπτα και πληρώνεται σαν ένα λεπτό.
// Χτυπώντας στα τυφλά κάθε 5 λεπτά, βγαίναμε 6.840 λεπτά τον μήνα από
// τα 2.000 δωρεάν — και τα τρία τέταρτα για το τίποτα.
//
// Οπότε κατεβάζουμε πρώτα το sitemap, που δεν κοστίζει τίποτα σε
// κανέναν, και ξεκινάμε το Action μόνο αν όντως βγήκε κάτι.
//
// ΤΙ ΔΕΝ ΚΑΝΕΙ
//
// Δεν κατεβάζει άρθρα, δεν αγγίζει δεδομένα, δεν κάνει commit. Αυτά
// ανήκουν στο GitHub, που έχει το git. Εμείς κοιτάμε και πατάμε.
//
// Το παλιό cron του GitHub ΔΕΝ το σβήσαμε: μένει από κάτω σαν δίχτυ,
// για την περίπτωση που πέσει αυτό εδώ. Δωρεάν είναι.

const SITEMAP = 'https://www.newshub.gr/sitemap_google_news.php';
const WORKFLOW = 'fetch.yml';

// Το σημειωματάριο στο KV: τι είδαμε την προηγούμενη φορά, και πότε
// πατήσαμε τελευταία φορά το κουμπί.
const APOTYPOMA = 'sitemap-apotypoma';
const TELEFTAIO = 'teleftaio-patima';

// Πότε κατεβάσαμε τελευταία φορά βίντεο και απομαγνητοφωνήσεις.
const TELEFTAIO_VARIA = 'teleftaio-varia';

// Κάθε πόσο κατεβαίνουν τα βαριά, σε λεπτά.
//
// Τα βίντεο είχαν δικό τους ρολόι μέσα στο fetch.yml — cron 40 4,10,16.
// Στα χαρτιά τρεις φορές τη μέρα· στην πράξη ποτέ. Στις 9 Νοεμβρίου
// 2026 μετρήθηκε: σε 91 τρεξίματα, μόνο 10 ξεκίνησαν από το ρολόι του
// GitHub, και καμία τους στις ώρες που ζητούσε το cron. Αποτέλεσμα:
// επεισόδιο ανεβασμένο στο YouTube στις 8/11 18:13 έλειπε ακόμα από
// το site 18 ώρες μετά.
//
// Ο Worker είναι το ρολόι που δουλεύει — χτυπάει κάθε λεπτό. Οπότε
// αυτός κρατάει και το ρολόι των βαριών, αντί να το εμπιστεύεται στο
// GitHub. Το fetch.yml δεν άλλαξε: δέχεται ήδη inputs.varia.
//
// Γιατί 60' και όχι λιγότερο: το YouTube έχει ΗΜΕΡΗΣΙΟ όριο 10.000
// μονάδων. Ένα πλήρες πέρασμα των 15 λιστών κοστίζει ~91. Στην ώρα
// κάνει ~2.200 τη μέρα — άνετα μέσα. Στα δέκα λεπτά θα έφτανε 13.000
// και θα σταματούσαν όλα μέχρι το επόμενο εικοσιτετράωρο.
const VARIA_LEPTA = 60;

// Το πάτωμα: ελάχιστη απόσταση δύο τρεξιμάτων, σε λεπτά.
//
// Ήταν 15, και ΔΕΝ ήταν τεχνικός περιορισμός — ήταν λογαριασμός. Το
// newshub.gr βγάζει ~93 άρθρα τη μέρα· ένα τρέξιμο ανά άρθρο κάνει
// ~2.790 λεπτά τον μήνα, πάνω από τα 2.000 δωρεάν που έδινε το
// ιδιωτικό repo.
//
// Στις 9 Νοεμβρίου 2026 το repo έγινε δημόσιο. Τα λεπτά του Actions
// είναι πλέον απεριόριστα και δωρεάν, οπότε ο λόγος έπαψε να υπάρχει
// και το πάτωμα κατεβαίνει στο 1 — όπως έγραφε εδώ ότι θα γίνει.
//
// Δεν σημαίνει «τρέξιμο κάθε λεπτό». Το workflow έχει
// concurrency: group fetch με cancel-in-progress: false, άρα τα
// τρεξίματα μπαίνουν σε ουρά και δεν επικαλύπτονται ποτέ. Ο πραγματικός
// ρυθμός γίνεται όσο κρατάει το χτίσιμο, ~4 λεπτά.
const PATOMA_LEPTA = 1;

// Αποτύπωμα του sitemap: αλλάζει μόλις μπει, φύγει ή μετακινηθεί άρθρο.
//
// Κρατάμε ΜΟΝΟ τις διευθύνσεις, όχι ολόκληρο το XML: οι τίτλοι
// διορθώνονται ορθογραφικά μετά τη δημοσίευση και θα μας ξυπνούσαν
// τζάμπα. Η διεύθυνση δεν αλλάζει ποτέ.
//
// Δεν κοιτάμε «ποιο είναι πρώτο»: στις 7 Νοεμβρίου 2026 το sitemap
// είχε στην κορυφή άρθρο με ημερομηνία ΑΥΡΙΟ. Ένα τέτοιο κολλάει εκεί
// για ώρες, και όποιος κοιτάζει μόνο την κορυφή δεν ξυπνά ποτέ ξανά.
//
// FNV-1a, 32 bit: ο φθηνότερος κατακερματισμός που υπάρχει. Έχει
// σημασία — το δωρεάν πλάνο δίνει 10 χιλιοστά του δευτερολέπτου
// επεξεργαστή ανά κλήση, και το SHA-256 θα τα έτρωγε.
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
    // ΠΡΟΣΟΧΗ στο «varia: false» — δεν το στέλνουμε ΠΟΤΕ. Οι επιλογές
    // boolean του GitHub, όταν φτάνουν από API, ταξιδεύουν ως κείμενο,
    // και το κείμενο «false» μετράει ως αληθές στις συνθήκες του. Η
    // σιωπή δεν παρερμηνεύεται· το ψεύτικο ψέμα ναι.
    //
    // Οπότε το κλειδί μπαίνει μόνο όταν όντως τα θέλουμε.
    body: JSON.stringify(varia
      ? { ref: env.GITHUB_BRANCH || 'main', inputs: { varia: 'true' } }
      : { ref: env.GITHUB_BRANCH || 'main' }),
  });

  // Επιτυχία = 204 χωρίς σώμα.
  if (res.status === 204) return;

  const detail = (await res.text()).slice(0, 300);
  throw new Error(`GitHub ${res.status}: ${detail}`);
}

// Η καρδιά: κοίτα, και πάτα μόνο αν αξίζει.
//
// Επιστρέφει τι έγινε, σε μία φράση — τη διαβάζει και ο άνθρωπος στη
// χειροκίνητη δοκιμή και η καταγραφή της Cloudflare.
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
  const prin = await env.ROI.get(APOTYPOMA);

  // Ώρα για τα βαριά; Υπολογίζεται ΠΡΙΝ από τον έλεγχο αλλαγής, γιατί
  // τα βίντεο δεν έχουν καμία σχέση με το sitemap του newshub.gr: ένα
  // επεισόδιο μπορεί να ανέβει στο YouTube μέσα σε μια μέρα χωρίς
  // καμία καινούρια είδηση. Αν περιμέναμε «αλλαγή στο sitemap», τα
  // βίντεο θα κρέμονταν από κάτι άσχετο.
  const poteVaria = Number(await env.ROI.get(TELEFTAIO_VARIA)) || 0;
  const perasanVaria = (Date.now() - poteVaria) / 60000;
  const thelouneVaria = perasanVaria >= VARIA_LEPTA;

  if (!anagkastika && tora === prin && !thelouneVaria) {
    return 'Τίποτα καινούριο — δεν ξύπνησα κανέναν.';
  }

  // Το πάτωμα. Μπαίνει ΜΕΤΑ τον έλεγχο αλλαγής, όχι πριν: θέλουμε να
  // σώσουμε το αποτύπωμα ακόμα κι όταν δεν πατάμε, αλλιώς την επόμενη
  // φορά θα νομίζαμε ξανά ότι υπάρχει αλλαγή.
  //
  // Τα βαριά ΠΡΟΣΠΕΡΝΟΥΝ το πάτωμα: έρχονται μία φορά την ώρα, πολύ πιο
  // αραιά από αυτό, και δεν έχει νόημα να τα καθυστερήσει.
  const pote = Number(await env.ROI.get(TELEFTAIO)) || 0;
  const perasan = (Date.now() - pote) / 60000;

  if (!anagkastika && !thelouneVaria && perasan < PATOMA_LEPTA) {
    const meno = (PATOMA_LEPTA - perasan).toFixed(1);
    return `Υπάρχει καινούριο, αλλά πάτησα πριν ${perasan.toFixed(1)}'`
      + ` — περιμένω άλλα ${meno}'.`;
  }

  await pataToKoumpi(env, thelouneVaria);

  // Σώζουμε ΜΟΝΟ μετά από επιτυχημένο πάτημα. Αν το GitHub αρνηθεί, το
  // αποτύπωμα μένει παλιό και ξαναπροσπαθούμε στο επόμενο λεπτό —
  // αλλιώς μια στιγμιαία άρνηση θα έθαβε τα άρθρα για πάντα.
  await env.ROI.put(APOTYPOMA, tora);
  await env.ROI.put(TELEFTAIO, String(Date.now()));
  if (thelouneVaria) await env.ROI.put(TELEFTAIO_VARIA, String(Date.now()));

  return thelouneVaria
    ? `Το πάτησα ΜΕ βίντεο (πέρασαν ${perasanVaria.toFixed(0)}'). Αποτύπωμα: ${tora}`
    : `Το πάτησα. Αποτύπωμα: ${tora}`;
}

// Η ζωντανή ροή, από το Action στο KV.
//
// Το περιεχόμενο έρχεται από το δικό μας GitHub Action, με το κλειδί —
// αλλά το ελέγχουμε ούτως ή άλλως. Ό,τι γράψουμε εδώ θα το δει κάθε
// επισκέπτης της αρχικής, και ένα σπασμένο σενάριο που γράφει σκουπίδια
// είναι πολύ πιο πιθανό από κάποιον που βρήκε το κλειδί.
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

  await env.ROI.put('roi', JSON.stringify({
    pote: new Date().toISOString(),
    proto: typeof data.proto === 'string' ? data.proto : '',
    items: data.items.map((it) => ({
      t: it.t,
      u: it.u,
      k: typeof it.k === 'string' ? it.k : '',
    })),
  }));

  return new Response(`Γράφτηκαν ${data.items.length} τίτλοι.\n`);
}

export default {
  // Το ρολόι. Οι ώρες ορίζονται στο wrangler.toml.
  //
  // Αν πέσει, το αφήνουμε να πέσει φωναχτά: η Cloudflare καταγράφει το
  // σφάλμα και φαίνεται στα Workers → Logs. Ένα ρολόι που καταπίνει τα
  // σφάλματά του είναι ακριβώς η βλάβη που ήρθαμε να διορθώσουμε.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(koitaKaiPata(env).then((ti) => console.log(ti)));
  },

  // Και με το χέρι, για δοκιμή:
  //
  //   https://<worker>.workers.dev/?kleidi=<το μυστικό>
  //
  // ΜΕ ΚΛΕΙΔΙ. Η διεύθυνση .workers.dev είναι δημόσια — δεν υπάρχει
  // Cloudflare Access από μπροστά, όπως στο διαχειριστικό. Χωρίς
  // κλειδί, όποιος τη μάθει ξεκινά τρεξίματα Actions όσο θέλει, και τα
  // λεπτά τα πληρώνουμε εμείς.
  //
  // Το κλειδί μπαίνει όπως και το token:  npx wrangler secret put KLEIDI
  // Αν δεν οριστεί, το κουμπί είναι κλειστό — σιωπηλά ανοιχτή πόρτα
  // δεν αφήνουμε ποτέ.
  //
  // Με «&tora=1» παρακάμπτει και τον έλεγχο αλλαγής και το πάτωμα, για
  // όταν θες να δεις τρέξιμο ΤΩΡΑ.
  async fetch(request, env) {
    const q = new URL(request.url).searchParams;

    if (!env.KLEIDI || q.get('kleidi') !== env.KLEIDI) {
      return new Response('Λάθος ή απόν κλειδί.\n', { status: 403 });
    }

    // POST = η ζωντανή ροή, από το GitHub Action (roi-se-kv.js).
    //
    // Γιατί περνάει από εδώ και όχι κατευθείαν στο API της Cloudflare:
    // ο Worker έχει ΗΔΗ δικαίωμα γραψίματος στο KV, από το binding.
    // Ένα δεύτερο token, με δική του λήξη και δική του διαρροή, για να
    // κάνει το ίδιο ακριβώς πράγμα, είναι σκέτο βάρος συντήρησης.
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
