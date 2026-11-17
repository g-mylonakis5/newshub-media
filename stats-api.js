
'use strict';

const GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';

// Πόσο πίσω κοιτάμε. Το δωρεάν πλάνο κρατάει λίγες μέρες ιστορικό,
// οπότε δεν ζητάμε χρόνια: θα γύριζε άδειο και θα φαινόταν χαλασμένο.
const PERIODOI = {
  '24h': { ores: 24, titlos: 'τελευταίο 24ωρο' },
  '7d': { ores: 24 * 7, titlos: 'τελευταίες 7 μέρες' },
  '30d': { ores: 24 * 30, titlos: 'τελευταίες 30 μέρες' },
};

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
