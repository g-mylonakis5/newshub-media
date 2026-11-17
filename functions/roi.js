
export async function onRequestGet(context) {
  const { env } = context;

  // Αν λείπει η σύνδεση με το KV, δεν είναι σφάλμα του επισκέπτη: η
  // σελίδα έχει ήδη τη ροή γραμμένη μέσα της και απλώς θα κρατήσει
  // εκείνη. Απαντάμε «άδειο» και η σελίδα δεν αγγίζει τίποτα.
  if (!env.ROI) {
    return apantisi({ items: [] });
  }

  const raw = await env.ROI.get('roi');
  if (!raw) return apantisi({ items: [] });

  // Περνάει αυτούσιο: ό,τι γράψαμε εμείς, αυτό διαβάζουμε. Δεν το
  // ξαναφτιάχνουμε με JSON.parse και JSON.stringify για το τίποτα.
  return new Response(raw, kefalides());
}

function apantisi(obj) {
  return new Response(JSON.stringify(obj), kefalides());
}

function kefalides() {
  return {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=30, stale-while-revalidate=120',
      // Η ροή δείχνει σε newshub.gr· κανείς άλλος δεν τη χρειάζεται,
      // αλλά δεν υπάρχει και λόγος να την κρύψουμε.
      'Access-Control-Allow-Origin': '*',
    },
  };
}
