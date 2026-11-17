
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
