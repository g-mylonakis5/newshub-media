// Η ροή ειδήσεων στο KV.
//
// ΓΙΑΤΙ ΥΠΑΡΧΕΙ
//
// Μέχρι σήμερα, για να αλλάξει μία γραμμή στη ροή ειδήσεων, ξαναχτίζαμε
// 4.697 σελίδες. Το χτίσιμο θέλει ~4 λεπτά και το δωρεάν Cloudflare
// Pages δίνει 500 τον μήνα — δηλαδή 16 τη μέρα, ενώ το newshub.gr βγάζει
// ~93 άρθρα. Τα μαθηματικά δεν έβγαιναν ποτέ.
//
// Οπότε η ροή παύει να περνάει από χτίσιμο. Μπαίνει σε KV, η σελίδα τη
// διαβάζει από την άκρη του δικτύου, και το χτίσιμο μένει για ό,τι
// αλλάζει πραγματικά σπάνια: επεισόδια, σελίδες, άρθρα.
//
// ΤΙ ΔΕΝ ΑΛΛΑΖΕΙ
//
// Το HTML της ροής ΜΕΝΕΙ μέσα στη σελίδα, όπως ήταν. Είναι το δίχτυ:
// τα ρομπότ του Facebook και του Viber δεν εκτελούν JavaScript ποτέ,
// και η σύνδεση κόβεται. Χωρίς το δίχτυ, το χειρότερο σενάριο είναι
// άδειο κουτί· με αυτό, είναι ειδήσεις λίγων ωρών.
//
// Τρέχει μέσα στο GitHub Action, αμέσως μετά τη λήψη των ειδήσεων.
//
//   node roi-se-kv.js
//
// Δεν μιλάει στην Cloudflare κατευθείαν: στέλνει τους τίτλους στον
// Worker (roloi/), που έχει ΗΔΗ δικαίωμα γραψίματος στο KV από το
// binding του. Ένα δεύτερο token, με δική του λήξη και δική του
// διαρροή, για να κάνει το ίδιο ακριβώς πράγμα, είναι σκέτο βάρος.
//
// Θέλει δύο μεταβλητές περιβάλλοντος. Αν λείπει έστω μία, βγαίνει
// ΗΣΥΧΑ με επιτυχία: η ζωντανή ροή είναι βελτίωση, όχι προϋπόθεση. Αν
// δεν στηθεί, το site δουλεύει ακριβώς όπως πριν.
//
//   ROLOI_URL     η διεύθυνση του Worker
//   ROLOI_KLEIDI  το μυστικό του — το ίδιο που έχει ο Worker

const fs = require('fs');
const path = require('path');

const NEWS = path.join(__dirname, 'data', 'news.json');
const BLOCK = require('./data/roi-apokleismena.json');

// Όσα δείχνει το πλαίσιο, συν λίγα παραπάνω: αν αύριο ζητήσει το
// αφεντικό δέκα αντί για οκτώ, δεν θέλουμε να ξαναστηθεί τίποτα.
const POSA = 12;


function xorismaTonon(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Ίδιος έλεγχος με το build.js, ίδια λίστα, ίδιο αποτέλεσμα. Μόνο στον
// τίτλο — δες το data/roi-apokleismena.json για το γιατί.
function apokleietai(a) {
  if (BLOCK.katigories.some((c) => c === a.category)) return true;

  const t = xorismaTonon(a.title || '');
  return BLOCK.lexeis.some((w) => t.includes(xorismaTonon(w)));
}

function diale() {
  const list = JSON.parse(fs.readFileSync(NEWS, 'utf8'));

  return list
    .filter((a) => !apokleietai(a))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, POSA);
}

function roi(diales) {
  return diales
    // ΜΟΝΟ τα τρία πεδία που δείχνει το πλαίσιο. Όχι περιλήψεις, όχι
    // εικόνες: ο αναγνώστης θα κατεβάσει αυτό το JSON σε κάθε άνοιγμα
    // της αρχικής, και ό,τι δεν φαίνεται είναι καθαρή καθυστέρηση.
    .map((a) => ({ t: a.title, u: a.url, k: a.category || '' }));
}

async function main() {
  const { ROLOI_URL, ROLOI_KLEIDI } = process.env;

  if (!ROLOI_URL || !ROLOI_KLEIDI) {
    console.log('Ζωντανή ροή: δεν είναι στημένη (λείπουν ρυθμίσεις) — προσπερνώ.');
    return;
  }

  if (!fs.existsSync(NEWS)) {
    console.log('Ζωντανή ροή: δεν υπάρχει data/news.json — προσπερνώ.');
    return;
  }

  const diales = diale();
  const items = roi(diales);
  if (!items.length) {
    // Ποτέ άδεια ροή στο KV: θα έσβηνε το πλαίσιο σε όλους, και μια
    // στιγμιαία αστοχία της λήψης θα γινόταν ορατή βλάβη. Καλύτερα να
    // μείνει η προηγούμενη ροή.
    console.warn('ΠΡΟΣΟΧΗ: η ροή βγήκε άδεια — ΔΕΝ γράφω στο KV.');
    return;
  }

  // Το «proto» είναι η ώρα της πρώτης είδησης, όχι η ώρα που γράψαμε.
  // Με αυτό η σελίδα αποφασίζει αν αξίζει να αντικαταστήσει ό,τι έχει
  // ήδη γραμμένο μέσα της: το KV και το χτίσιμο γεμίζουν από
  // διαφορετικά μέρη και δεν προλαβαίνουν πάντα με την ίδια σειρά.
  const soma = JSON.stringify({
    pote: new Date().toISOString(),
    proto: diales[0].date || '',
    items,
  });

  // Το κλειδί πάει στη διεύθυνση, όχι σε κεφαλίδα: έτσι το δέχεται ο
  // Worker και στη χειροκίνητη δοκιμή από browser, με έναν τρόπο αντί
  // για δύο.
  const url = `${ROLOI_URL.replace(/\/+$/, '')}/?kleidi=${encodeURIComponent(ROLOI_KLEIDI)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: soma,
  });

  const apantisi = (await res.text()).trim();

  if (!res.ok) {
    throw new Error(`Ο Worker απάντησε ${res.status}: ${apantisi.slice(0, 200)}`);
  }

  console.log(`Ζωντανή ροή: ${apantisi} Πρώτος: ${items[0].t}`);
}

main().catch((err) => {
  console.error(`Η ζωντανή ροή δεν ενημερώθηκε: ${err.message}`);
  process.exit(1);
});
