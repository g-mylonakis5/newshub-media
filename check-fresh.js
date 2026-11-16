// Watchdog: are articles still arriving?
//
// Everything that can stop the flow does so SILENTLY — a broken or empty
// sitemap, an expired token, a schedule GitHub disabled, a redesign on
// newshub.gr. None of them raises an error; the site just stops updating.
//
// So we check the result, not the errors: how long since the newest
// article. One check covers every cause.
//
// It matters because their sitemap is a rolling THREE-DAY window. Anything
// we fail to save is gone for good. If the flow breaks and we notice ten
// days later, a week of news is missing permanently.
//
// Exit 0 = fine. Exit 1 = frozen.
//
//   node check-fresh.js

const fs = require('fs');
const path = require('path');

const NEWS = path.join(__dirname, 'data', 'news.json');

// Measured on the real data: newshub.gr publishes 07:00-24:00 Greek time,
// roughly every 11 minutes. The largest normal gap is 7.8 hours and it is
// always the night. So we only check during the day, with a 3-hour limit:
// far above daytime normal, far below the nightly silence.
const MAX_HOURS = 3;

// Greek hours we check. Starting at 10:00 rather than 07:00 gives the
// first wave of the day time to appear.
const FROM_HOUR = 10;
const TO_HOUR = 23;

// Greece is UTC+2 in winter, UTC+3 in summer. We don't work that out
// ourselves — Node answers "what time is it in Athens", and daylight saving
// changes without asking us.
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
