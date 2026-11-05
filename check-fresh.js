// Δικλείδα: μπαίνουν όντως ειδήσεις;
//
// Όλα όσα μπορούν να σταματήσουν τη ροή το κάνουν ΣΙΩΠΗΛΑ — σπασμένο ή
// άδειο sitemap, ληγμένο token, χρονοδιάγραμμα που απενεργοποίησε το
// GitHub, ανασχεδιασμός του newshub.gr. Κανένα δεν βγάζει σφάλμα· απλώς
// μια μέρα το site παύει να ανανεώνεται.
//
// Γι' αυτό δεν κοιτάμε σφάλματα, κοιτάμε ΑΠΟΤΕΛΕΣΜΑ: πόση ώρα έχει να
// μπει καινούρια είδηση. Ένας έλεγχος πιάνει όλες τις αιτίες μαζί.
//
// Γιατί επείγει: το sitemap του newshub.gr είναι κυλιόμενο παράθυρο
// ΤΡΙΩΝ ΗΜΕΡΩΝ. Ό,τι δεν προλάβουμε να σώσουμε χάνεται οριστικά — δεν
// υπάρχει πουθενά αλλού. Αν η ροή σπάσει και το δούμε σε δέκα μέρες,
// λείπει μια βδομάδα ειδήσεων για πάντα.
//
// Έξοδος 0 = όλα καλά. Έξοδος 1 = κάτι πάγωσε.
//
//   node check-fresh.js

const fs = require('fs');
const path = require('path');

const NEWS = path.join(__dirname, 'data', 'news.json');

// Μετρημένο στα πραγματικά δεδομένα: το newshub.gr δημοσιεύει 07:00 με
// 24:00 ώρα Ελλάδας, περίπου κάθε 11 λεπτά. Το μεγαλύτερο φυσιολογικό
// κενό είναι 7,8 ώρες και είναι ΠΑΝΤΑ η νύχτα.
//
// Οπότε ελέγχουμε μόνο μέσα στη μέρα, με όριο 3 ώρες: πολύ πάνω από το
// φυσιολογικό της ημέρας, πολύ κάτω από τη νυχτερινή σιωπή.
const MAX_HOURS = 3;

// Ώρες Ελλάδας που ελέγχουμε. Ξεκινάμε στις 10:00 και όχι στις 07:00
// ώστε να έχει προλάβει να βγει το πρώτο κύμα της ημέρας.
const FROM_HOUR = 10;
const TO_HOUR = 23;

// Ελλάδα = UTC+2 τον χειμώνα, UTC+3 το καλοκαίρι. Δεν το υπολογίζουμε
// μόνοι μας — το ερώτημα «τι ώρα είναι στην Αθήνα» το απαντά η ίδια η
// Node, και η θερινή ώρα αλλάζει χωρίς να μας ρωτήσει κανείς.
function athensHour(date){
  const s = date.toLocaleString('en-GB', {
    timeZone: 'Europe/Athens',
    hour: '2-digit',
    hour12: false,
  });
  return Number(s);
}

function newest(list){
  let top = 0;
  for (const a of list) {
    const t = new Date(a.date).getTime();
    if (!isNaN(t) && t > top) top = t;
  }
  return top;
}

let items;
try {
  items = JSON.parse(fs.readFileSync(NEWS, 'utf8'));
} catch (err) {
  console.error(`ΠΑΓΩΣΕ: το data/news.json δεν διαβάζεται — ${err.message}`);
  process.exit(1);
}

if (!Array.isArray(items) || !items.length) {
  console.error('ΠΑΓΩΣΕ: το data/news.json είναι άδειο.');
  process.exit(1);
}

const top = newest(items);
if (!top) {
  console.error('ΠΑΓΩΣΕ: καμία έγκυρη ημερομηνία στο data/news.json.');
  process.exit(1);
}

const now = new Date();
const hours = (now.getTime() - top) / 3600000;
const when = new Date(top).toISOString().slice(0, 16).replace('T', ' ');
const hour = athensHour(now);

if (hour < FROM_HOUR || hour > TO_HOUR) {
  console.log(`Νύχτα στην Ελλάδα (${hour}:00) — δεν ελέγχω. `
    + `Τελευταία είδηση: ${when} UTC, πριν ${hours.toFixed(1)} ώρες.`);
  process.exit(0);
}

if (hours > MAX_HOURS) {
  console.error(`ΠΑΓΩΣΕ: η τελευταία είδηση είναι από ${when} UTC, `
    + `πριν ${hours.toFixed(1)} ώρες. Το κανονικό μέσα στη μέρα είναι λεπτά.`);
  process.exit(1);
}

console.log(`Εντάξει: τελευταία είδηση πριν ${hours.toFixed(1)} ώρες (${when} UTC).`);
