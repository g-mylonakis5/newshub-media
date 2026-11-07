// Το ρολόι.
//
// Δουλειά του: μία και μόνη. Να πατάει το κουμπί «Φέρε τα νέα τώρα»
// στην ώρα του, χωρίς να το θυμάται άνθρωπος.
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
// ΤΙ ΔΕΝ ΚΑΝΕΙ
//
// Δεν κατεβάζει τίποτα. Δεν διαβάζει sitemap, δεν αγγίζει δεδομένα.
// Ένα αίτημα στο GitHub και τελείωσε — γι' αυτό χωράει άνετα στα όρια
// του δωρεάν πλάνου, που είναι αυστηρά σε χρόνο επεξεργαστή.
//
// Το παλιό cron του GitHub ΔΕΝ το σβήσαμε: μένει από κάτω σαν δίχτυ,
// για την περίπτωση που πέσει αυτό εδώ. Δωρεάν είναι.

const WORKFLOW = 'fetch.yml';

// Τα βαριά (YouTube, απομαγνητοφωνήσεις) ΠΟΤΕ από εδώ: έχουν δικό τους
// ρολόι τρεις φορές τη μέρα μέσα στο fetch.yml. Αν τα ζητούσαμε σε κάθε
// κλήση, το ημερήσιο όριο του YouTube θα τελείωνε μέσα σε μία ώρα.
//
// Γι' αυτό δεν στέλνουμε «varia: false» — δεν στέλνουμε ΤΙΠΟΤΑ. Οι
// επιλογές boolean του GitHub, όταν φτάνουν από API, ταξιδεύουν ως
// κείμενο, και το κείμενο «false» μετράει ως αληθές στις συνθήκες του.
// Η σιωπή δεν παρερμηνεύεται.

async function pataToKoumpi(env) {
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
    body: JSON.stringify({ ref: env.GITHUB_BRANCH || 'main' }),
  });

  // Επιτυχία = 204 χωρίς σώμα.
  if (res.status === 204) return;

  const detail = (await res.text()).slice(0, 300);
  throw new Error(`GitHub ${res.status}: ${detail}`);
}

export default {
  // Το ρολόι. Οι ώρες ορίζονται στο wrangler.toml.
  //
  // Αν πέσει, το αφήνουμε να πέσει φωναχτά: η Cloudflare καταγράφει το
  // σφάλμα και φαίνεται στα Workers → Logs. Ένα ρολόι που καταπίνει τα
  // σφάλματά του είναι ακριβώς η βλάβη που ήρθαμε να διορθώσουμε.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(pataToKoumpi(env));
  },

  // Και με το χέρι, για δοκιμή: άνοιξε τη διεύθυνση του Worker στον
  // browser. Χωρίς αυτό, ο μόνος τρόπος να δεις αν δουλεύει είναι να
  // περιμένεις το επόμενο χτύπημα.
  async fetch(request, env) {
    try {
      await pataToKoumpi(env);
      return new Response('Το πάτησα. Δες το GitHub → Actions.\n');
    } catch (err) {
      return new Response(`Δεν έγινε: ${err.message}\n`, { status: 502 });
    }
  },
};
