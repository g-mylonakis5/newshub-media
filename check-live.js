// Δικλείδα: ανανεώνεται όντως το ΖΩΝΤΑΝΟ site;
//
// ΓΙΑΤΙ ΔΕΝ ΑΡΚΕΙ ΤΟ check-fresh.js
//
// Εκείνο ρωτάει «μπαίνουν ειδήσεις στα δεδομένα μας;». Μέχρι τις 11
// Νοεμβρίου 2026 ήταν το ίδιο ερώτημα με το «ανανεώνεται το site;»,
// γιατί το Cloudflare έχτιζε μόνο του σε κάθε push.
//
// Από τότε το χτίσιμο και το ανέβασμα τα κάνει το GitHub Action. Αν
// σπάσει ΕΚΕΙΝΟ — ληγμένο CLOUDFLARE_API_TOKEN, αλλαγή στο wrangler,
// βλάβη του Cloudflare — τα δεδομένα συνεχίζουν να μπαίνουν κανονικά,
// το check-fresh.js μένει ΠΡΑΣΙΝΟ, και το site παγώνει χωρίς να το
// πάρει κανείς είδηση. Αυτό ακριβώς είναι το είδος της βλάβης που μας
// τρώει: σιωπηλή, και φαίνεται μόνο όταν παραπονεθεί κάποιος.
//
// Γι' αυτό εδώ δεν κοιτάμε τα δικά μας αρχεία. Ρωτάμε το ίδιο το site.
//
// Το build.json το γράφει το build.js σε κάθε χτίσιμο, με την ώρα του.
// Αν η ώρα εκείνη είναι παλιά, κάτι στη διαδρομή
// «χτίσιμο -> ανέβασμα -> Cloudflare» έχει σπάσει.
//
// Έξοδος 0 = το site ανανεώνεται. Έξοδος 1 = έχει παγώσει.
//
//   node check-live.js

const SITE = process.env.SITE_URL || 'https://newshubmedia.gr';

// Πόσες ώρες χωρίς χτίσιμο θεωρούνται βλάβη.
//
// Το ρολόι χτυπάει κάθε λεπτό και χτίζει μόνο όταν βγει κάτι — τη νύχτα
// σωστά δεν βγαίνει τίποτα. Το μεγαλύτερο φυσιολογικό κενό είναι η
// νύχτα, γι' αυτό ο έλεγχος τρέχει μόνο μέσα στη μέρα και το όριο
// είναι γενναιόδωρο: 3 ώρες είναι πολύ πάνω από το φυσιολογικό
// (6 λεπτά) και πολύ κάτω από μια νύχτα.
const ORIO_ORES = 3;

// Οι ώρες που ΠΕΡΙΜΕΝΟΥΜΕ κίνηση, σε UTC. Ίδιο παράθυρο με το ρολόι
// (roloi/wrangler.toml): 04:00-22:59 UTC καλύπτει 07:00-24:00 Ελλάδας
// χειμώνα και καλοκαίρι.
const APO_ORA = 4;
const OS_ORA = 22;

async function main(){
  const ora = new Date().getUTCHours();

  if (ora < APO_ORA || ora > OS_ORA) {
    console.log(`Νύχτα (${ora}:00 UTC) — δεν ελέγχω, δεν βγαίνει ύλη.`);
    return 0;
  }

  let res;
  try {
    // Χωρίς μνήμη: μας νοιάζει τι υπάρχει ΤΩΡΑ στο site, όχι τι είχε
    // κρατήσει κάποιος ενδιάμεσος.
    res = await fetch(`${SITE}/build.json?t=${Date.now()}`, {
      headers: { 'Cache-Control': 'no-cache' },
    });
  } catch (err) {
    console.error(`Το site δεν απάντησε καθόλου: ${err.message}`);
    return 1;
  }

  if (!res.ok) {
    // 404 σημαίνει ότι το τελευταίο ανέβασμα έγινε με παλιό build.js,
    // πριν μπει αυτό το αρχείο. Δεν είναι βλάβη από μόνο του.
    console.error(`Το ${SITE}/build.json απάντησε ${res.status}.`);
    return res.status === 404 ? 0 : 1;
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    console.error(`Το build.json δεν είναι έγκυρο JSON: ${err.message}`);
    return 1;
  }

  const pote = Date.parse(data && data.pote);
  if (isNaN(pote)) {
    console.error('Το build.json δεν έχει έγκυρη ώρα χτισίματος.');
    return 1;
  }

  const ores = (Date.now() - pote) / 3600e3;
  const pretty = `${ores.toFixed(1)} ώρες`;

  if (ores > ORIO_ORES) {
    console.error(`ΠΑΓΩΣΕ: το site χτίστηκε τελευταία φορά πριν ${pretty}.`);
    console.error(`Τελευταίο χτίσιμο: ${data.pote}`);
    console.error('');
    console.error('Τι να ελέγξεις, με αυτή τη σειρά:');
    console.error('  1. Actions -> «Ανέβασμα»: κοκκίνισε κάποιο τρέξιμο;');
    console.error('  2. Μήπως έληξε το CLOUDFLARE_API_TOKEN στα secrets;');
    console.error('  3. Cloudflare -> Workers & Pages -> newshub-media: ανέβηκε deployment;');
    console.error('');
    console.error('Προσωρινή λύση: από το dashboard του Cloudflare, Create deployment.');
    return 1;
  }

  console.log(`Το site είναι φρέσκο — χτίστηκε πριν ${pretty}.`);
  return 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('Ο έλεγχος απέτυχε:', err.message);
  process.exit(1);
});
