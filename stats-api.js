// stats-api.js — οι μετρήσεις του site, ΜΙΑ φορά.
//
// Ίδια λογική με το admin-api.js: τη δουλειά την ξέρει αυτό το αρχείο,
// και τη φωνάζουν και ο τοπικός serve.js και η Cloudflare Function.
// Ό,τι δοκιμάζεται τοπικά δουλεύει και στον αέρα χωρίς αλλαγή γραμμής.
//
// ΑΠΟ ΠΟΥ ΕΡΧΟΝΤΑΙ ΤΑ ΝΟΥΜΕΡΑ
//
// Από το Cloudflare Web Analytics, που μετράει ήδη από τις 12 Νοε 2026
// με το beacon στο build.js. Μετράει ΧΩΡΙΣ cookies — γι' αυτό το site
// δεν έχει μπάνερ συγκατάθεσης.
//
// ΓΙΑΤΙ ΔΕΝ ΜΙΛΑΕΙ Ο BROWSER ΚΑΤΕΥΘΕΙΑΝ ΣΤΟ CLOUDFLARE
//
// Θα χρειαζόταν το κλειδί μέσα στη σελίδα. Ένα κλειδί που φαίνεται
// στον κώδικα της σελίδας είναι δοσμένο κλειδί, όσο «μόνο ανάγνωση»
// κι αν είναι. Ζει στις ρυθμίσεις του Cloudflare Pages, το διαβάζει
// ο διακομιστής, και στη σελίδα φτάνουν μόνο νούμερα.
//
// ΤΙ ΧΡΕΙΑΖΕΤΑΙ
//
//   CF_ANALYTICS_TOKEN  κλειδί με Account Analytics -> Read
//   CF_ACCOUNT_ID       ο λογαριασμός (32 χαρακτήρες, από το URL)
//   CF_SITE_TAG         ποιο site· προαιρετικό, δες παρακάτω
//
// Το CF_SITE_TAG ξεχωρίζει site όταν ο λογαριασμός έχει πολλά. Με ένα
// site δεν χρειάζεται: χωρίς φίλτρο έρχονται τα πάντα, που είναι και
// το σωστό. ΠΡΟΣΟΧΗ: ΔΕΝ είναι το ίδιο με το token του beacon στο
// build.js — εκείνο λέει στον browser πού να στείλει, αυτό λέει στο
// API ποιο να διαβάσει.

'use strict';

const GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';

// Πόσο πίσω κοιτάμε. Το δωρεάν πλάνο κρατάει λίγες μέρες ιστορικό,
// οπότε δεν ζητάμε χρόνια: θα γύριζε άδειο και θα φαινόταν χαλασμένο.
const PERIODOI = {
  '24h': { ores: 24, titlos: 'τελευταίο 24ωρο' },
  '7d': { ores: 24 * 7, titlos: 'τελευταίες 7 μέρες' },
  '30d': { ores: 24 * 30, titlos: 'τελευταίες 30 μέρες' },
};

// Μία ερώτηση για όλα. Έξι ξεχωριστά αιτήματα θα ήταν έξι φορές η
// καθυστέρηση, για δεδομένα που έρχονται από το ίδιο σημείο.
//
// Το φίλτρο γράφεται ΜΕΣΑ στο κείμενο της ερώτησης και δεν περνάει ως
// μεταβλητή: το Cloudflare θέλει το ακριβές όνομα τύπου του φίλτρου,
// που αλλάζει ανά dataset. Οι τιμές μένουν μεταβλητές — εκεί είναι που
// θα είχε σημασία.
function query(meSiteTag){
  const f = meSiteTag
    ? 'filter:{datetime_geq:$since, siteTag:$tag}'
    : 'filter:{datetime_geq:$since}';

  return `query($acct:String!,$since:Time!${meSiteTag ? ',$tag:string!' : ''}){
    viewer {
      accounts(filter:{accountTag:$acct}) {
        synolo: rumPageloadEventsAdaptiveGroups(limit:1, ${f}) {
          count
          sum { visits }
        }
        meres: rumPageloadEventsAdaptiveGroups(limit:100, orderBy:[date_ASC], ${f}) {
          count
          sum { visits }
          dimensions { date }
        }
        selides: rumPageloadEventsAdaptiveGroups(limit:15, orderBy:[count_DESC], ${f}) {
          count
          dimensions { requestPath }
        }
        apo: rumPageloadEventsAdaptiveGroups(limit:10, orderBy:[count_DESC], ${f}) {
          count
          dimensions { refererHost }
        }
        xores: rumPageloadEventsAdaptiveGroups(limit:10, orderBy:[count_DESC], ${f}) {
          count
          dimensions { countryName }
        }
        syskeves: rumPageloadEventsAdaptiveGroups(limit:5, orderBy:[count_DESC], ${f}) {
          count
          dimensions { deviceType }
        }
      }
    }
  }`;
}

function rows(list, key){
  return (list || [])
    .map((r) => ({ name: (r.dimensions && r.dimensions[key]) || '', n: r.count || 0 }))
    .filter((r) => r.n > 0);
}

// Τα νούμερα, έτοιμα για την οθόνη.
//
// Το `env` είναι ό,τι δίνει ο καλών: process.env τοπικά, context.env
// στην Function. Το `fetch` το δίνει κι αυτό ο καλών, ώστε το αρχείο
// να μην ξέρει αν τρέχει σε Node ή σε Worker.
async function stats(env, period){
  const token = env.CF_ANALYTICS_TOKEN;
  const acct = env.CF_ACCOUNT_ID;

  if (!token || !acct) {
    return {
      status: 500,
      body: { error: 'Λείπουν ρυθμίσεις: CF_ANALYTICS_TOKEN, CF_ACCOUNT_ID' },
    };
  }

  const p = PERIODOI[period] || PERIODOI['7d'];
  const since = new Date(Date.now() - p.ores * 3600000).toISOString();

  const tag = env.CF_SITE_TAG || '';
  const variables = { acct, since };
  if (tag) variables.tag = tag;

  let res;
  try {
    res = await fetch(GRAPHQL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: query(!!tag), variables }),
    });
  } catch (err) {
    return { status: 502, body: { error: `Δεν απάντησε το Cloudflare: ${err.message}` } };
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    return { status: 502, body: { error: 'Το Cloudflare απάντησε κάτι που δεν είναι JSON.' } };
  }

  // Το GraphQL απαντάει 200 ακόμα και όταν αποτυγχάνει — το λάθος
  // κάθεται μέσα στο σώμα. Χωρίς αυτόν τον έλεγχο η οθόνη θα έδειχνε
  // μηδενικά και ο συντάκτης θα νόμιζε ότι δεν τον διαβάζει κανείς.
  if (data.errors && data.errors.length) {
    const first = data.errors[0];
    return { status: 502, body: { error: `Cloudflare: ${first.message || 'άγνωστο σφάλμα'}` } };
  }

  const acc = data.data
    && data.data.viewer
    && data.data.viewer.accounts
    && data.data.viewer.accounts[0];

  if (!acc) {
    return { status: 502, body: { error: 'Το Cloudflare δεν γύρισε δεδομένα για αυτόν τον λογαριασμό.' } };
  }

  const synolo = (acc.synolo && acc.synolo[0]) || { count: 0, sum: { visits: 0 } };

  return {
    status: 200,
    body: {
      period,
      titlos: p.titlos,
      // «Προβολές» = φορτώματα σελίδας, «επισκέψεις» = ξεχωριστές
      // επισκέψεις. Τα λέμε ελληνικά γιατί τα διαβάζει δημοσιογράφος.
      provoles: synolo.count || 0,
      episkepseis: (synolo.sum && synolo.sum.visits) || 0,
      meres: (acc.meres || []).map((r) => ({
        date: r.dimensions && r.dimensions.date,
        provoles: r.count || 0,
        episkepseis: (r.sum && r.sum.visits) || 0,
      })),
      selides: rows(acc.selides, 'requestPath'),
      // Το κενό refererHost σημαίνει «ήρθε κατευθείαν» — όχι άγνωστο.
      apo: rows(acc.apo, 'refererHost').map((r) => ({
        name: r.name || 'απευθείας',
        n: r.n,
      })),
      xores: rows(acc.xores, 'countryName'),
      syskeves: rows(acc.syskeves, 'deviceType'),
    },
  };
}

module.exports = { stats, PERIODOI };
