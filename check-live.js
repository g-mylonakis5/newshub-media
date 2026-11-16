// Watchdog: is the LIVE site still being rebuilt?
//
// check-fresh.js asks whether articles reach our data. Since the build and
// deploy moved into GitHub Actions, that is a different question: if the
// deploy breaks (expired CLOUDFLARE_API_TOKEN, wrangler change, Cloudflare
// outage) the data keeps arriving, check-fresh.js stays green, and the site
// quietly freezes.
//
// So this one asks the site itself. build.js writes build.json on every
// build, with its timestamp; a stale timestamp means something along
// build -> deploy -> Cloudflare is broken.
//
// Exit 0 = fresh. Exit 1 = frozen.
//
//   node check-live.js

const SITE = process.env.SITE_URL || 'https://newshubmedia.gr';

// Hours without a build that count as a fault. The clock fires every minute
// and builds only when something new arrives, so the longest normal gap is
// the night. Generous on purpose: typical is 6 minutes.
const ORIO_ORES = 3;

// Hours we expect traffic, UTC. Same window as the clock in
// roloi/wrangler.toml: 04:00-22:59 UTC covers 07:00-24:00 Greek time in
// both winter and summer.
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
    // No caching: what matters is what the site serves right now, not what
    // some intermediary kept.
    res = await fetch(`${SITE}/build.json?t=${Date.now()}`, {
      headers: { 'Cache-Control': 'no-cache' },
    });
  } catch (err) {
    console.error(`Το site δεν απάντησε καθόλου: ${err.message}`);
    return 1;
  }

  if (!res.ok) {
    // 404 means the last deploy ran an older build.js, from before this
    // file existed. Not a fault in itself.
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
