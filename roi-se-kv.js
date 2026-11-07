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
// Θέλει τρεις μεταβλητές περιβάλλοντος. Αν λείπει έστω μία, βγαίνει
// ΗΣΥΧΑ με επιτυχία: η ζωντανή ροή είναι βελτίωση, όχι προϋπόθεση. Αν
// δεν στηθεί, το site δουλεύει ακριβώς όπως πριν.
//
//   CF_ACCOUNT_ID   ο λογαριασμός Cloudflare
//   CF_KV_NAMESPACE το ID του χώρου KV
//   CF_KV_TOKEN     token με δικαίωμα «Workers KV Storage: Edit»

const fs = require('fs');
const path = require('path');

const NEWS = path.join(__dirname, 'data', 'news.json');
const BLOCK = require('./data/roi-apokleismena.json');

// Όσα δείχνει το πλαίσιο, συν λίγα παραπάνω: αν αύριο ζητήσει το
// αφεντικό δέκα αντί για οκτώ, δεν θέλουμε να ξαναστηθεί τίποτα.
const POSA = 12;

// Το κλειδί μέσα στο KV. Ένα και μόνο — η ροή γράφεται ολόκληρη κάθε
// φορά. Είναι 2 KB· δεν αξίζει να παίζουμε με διαφορές.
const KLEIDI = 'roi';

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

function roi() {
  const list = JSON.parse(fs.readFileSync(NEWS, 'utf8'));

  return list
    .filter((a) => !apokleietai(a))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, POSA)
    // ΜΟΝΟ τα τρία πεδία που δείχνει το πλαίσιο. Όχι περιλήψεις, όχι
    // εικόνες: ο αναγνώστης θα κατεβάσει αυτό το JSON σε κάθε άνοιγμα
    // της αρχικής, και ό,τι δεν φαίνεται είναι καθαρή καθυστέρηση.
    .map((a) => ({ t: a.title, u: a.url, k: a.category || '' }));
}

async function main() {
  const { CF_ACCOUNT_ID, CF_KV_NAMESPACE, CF_KV_TOKEN } = process.env;

  if (!CF_ACCOUNT_ID || !CF_KV_NAMESPACE || !CF_KV_TOKEN) {
    console.log('Ζωντανή ροή: δεν είναι στημένη (λείπουν ρυθμίσεις) — προσπερνώ.');
    return;
  }

  if (!fs.existsSync(NEWS)) {
    console.log('Ζωντανή ροή: δεν υπάρχει data/news.json — προσπερνώ.');
    return;
  }

  const items = roi();
  if (!items.length) {
    // Ποτέ άδεια ροή στο KV: θα έσβηνε το πλαίσιο σε όλους, και μια
    // στιγμιαία αστοχία της λήψης θα γινόταν ορατή βλάβη. Καλύτερα να
    // μείνει η προηγούμενη ροή.
    console.warn('ΠΡΟΣΟΧΗ: η ροή βγήκε άδεια — ΔΕΝ γράφω στο KV.');
    return;
  }

  const soma = JSON.stringify({ pote: new Date().toISOString(), items });

  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}`
    + `/storage/kv/namespaces/${CF_KV_NAMESPACE}/values/${KLEIDI}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${CF_KV_TOKEN}`,
      'Content-Type': 'text/plain',
    },
    body: soma,
  });

  if (!res.ok) {
    throw new Error(`Cloudflare ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  console.log(`Ζωντανή ροή: ${items.length} τίτλοι στο KV. Πρώτος: ${items[0].t}`);
}

main().catch((err) => {
  console.error(`Η ζωντανή ροή δεν ενημερώθηκε: ${err.message}`);
  process.exit(1);
});
