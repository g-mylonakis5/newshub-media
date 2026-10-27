// fetch-weather.js — ο καιρός του Ηρακλείου, στο data/weather.json.
//
// Τον τραβάμε στο build και τον ψήνουμε μέσα στη σελίδα, αντί να φορτώνει
// ο επισκέπτης ξένο widget. Μηδέν JavaScript στον browser, μηδέν κόστος
// ανά επισκέπτη, μηδέν εξάρτηση από τρίτον τη στιγμή που ανοίγει η σελίδα.
//
// Το Open-Meteo είναι δωρεάν και δεν θέλει κλειδί.

const fs = require('fs');
const path = require('path');

const OUT_FILE = path.join(__dirname, 'data/weather.json');

const CITY = 'Ηράκλειο';
const LAT = 35.34;
const LON = 25.13;

// Οι κωδικοί καιρού του WMO, στα ελληνικά.
const CONDITIONS = {
  0: 'Αίθριος', 1: 'Λίγα σύννεφα', 2: 'Αραιή συννεφιά', 3: 'Συννεφιά',
  45: 'Ομίχλη', 48: 'Ομίχλη',
  51: 'Ψιχάλα', 53: 'Ψιχάλα', 55: 'Ψιχάλα',
  61: 'Βροχή', 63: 'Βροχή', 65: 'Δυνατή βροχή',
  66: 'Παγωμένη βροχή', 67: 'Παγωμένη βροχή',
  71: 'Χιόνι', 73: 'Χιόνι', 75: 'Πυκνό χιόνι', 77: 'Χιονόνερο',
  80: 'Μπόρες', 81: 'Μπόρες', 82: 'Δυνατές μπόρες',
  85: 'Χιονοπτώσεις', 86: 'Χιονοπτώσεις',
  95: 'Καταιγίδα', 96: 'Καταιγίδα', 99: 'Καταιγίδα',
};

async function main() {
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${LAT}&longitude=${LON}`
    + '&current=temperature_2m,weather_code'
    + '&daily=temperature_2m_max,temperature_2m_min'
    + '&timezone=Europe%2FAthens&forecast_days=1';

  const res = await fetch(url);
  if (!res.ok) throw new Error('Το Open-Meteo δεν απάντησε: ' + res.status);

  const data = await res.json();

  const out = {
    city: CITY,
    temp: Math.round(data.current.temperature_2m),
    code: data.current.weather_code,          // για να διαλέξει εικονίδιο το build
    condition: CONDITIONS[data.current.weather_code] || '',
    high: Math.round(data.daily.temperature_2m_max[0]),
    low: Math.round(data.daily.temperature_2m_min[0]),
    updated: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), 'utf8');

  console.log(`${out.city} ${out.temp}° · ${out.condition} · ${out.low}°/${out.high}°`);
}

main();
