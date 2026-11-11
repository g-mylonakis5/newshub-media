// make-share.js — η εικόνα που βλέπει όποιος μοιράζεται έναν σύνδεσμό μας.
//
// Όταν κολλάς το newshubmedia.gr σε Messenger, Viber, Facebook ή Twitter,
// εκείνα διαβάζουν το og:image της σελίδας και δείχνουν μια προεπισκόπηση.
// Μέχρι τώρα έδειχναν το intro.jpg — μια φωτογραφία στούντιο που δεν λέει
// ποιοι είμαστε. Τώρα δείχνουν το λογότυπο.
//
// 1200x630 είναι το μέγεθος που θέλουν όλες οι πλατφόρμες (λόγος 1,91:1).
// Μικρότερη εικόνα βγαίνει θολή, άλλος λόγος βγαίνει κομμένος.
//
// ΤΡΕΧΕΙ ΜΕ ΤΟ ΧΕΡΙ, όχι σε κάθε build: το λογότυπο αλλάζει μια φορά στα
// ποτέ, και δεν έχει νόημα να ανοίγει Chromium κάθε δύο λεπτά.
//
//   node make-share.js
//
// Γιατί Chromium και όχι βιβλιοθήκη εικόνας: υπάρχει ήδη στο project για
// το check-images.js, άρα μηδέν νέα εξάρτηση.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const LOGO = path.join(__dirname, 'public/shows/logo-full-dark.png');
const OUT = path.join(__dirname, 'public/share.jpg');

// Το φόντο του site — ίδιο με το --bg του styles.css.
const BG = '#0A1322';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });

  // Το λογότυπο μπαίνει ΜΕΣΑ στη σελίδα ως δεδομένα, όχι ως file://.
  // Η σελίδα που φτιάχνει το setContent δεν έχει διεύθυνση, οπότε ο
  // Chromium αρνείται να διαβάσει αρχείο του δίσκου από μέσα της — και
  // βγαίνει σκέτο μπλε ορθογώνιο, χωρίς κανένα μήνυμα λάθους.
  const logo = 'data:image/png;base64,' + fs.readFileSync(LOGO).toString('base64');

  // Το λογότυπο πιάνει το 68% του πλάτους. Οι πλατφόρμες κόβουν τις άκρες
  // σε μικρές προεπισκοπήσεις — ο αέρας γύρω του δεν είναι σπατάλη, είναι
  // το περιθώριο ασφαλείας.
  await page.setContent(`<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; height: 100%; }
  body {
    background: ${BG};
    display: flex;
    align-items: center;
    justify-content: center;
  }
  img { width: 68%; height: auto; }
</style></head>
<body><img src="${logo}" alt=""></body></html>`);

  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: OUT, type: 'jpeg', quality: 92 });

  await browser.close();
  console.log(`Η εικόνα κοινοποίησης γράφτηκε: ${OUT}`);
})();
