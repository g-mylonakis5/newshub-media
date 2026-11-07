// /roi — η ζωντανή ροή ειδήσεων, για τη σελίδα.
//
// ΓΙΑΤΙ ΔΕΝ ΕΙΝΑΙ ΣΤΟ /api/
//
// Όλο το /api/ είναι πίσω από Cloudflare Access: ζητάει email και
// κωδικό. Σωστά — από εκεί γράφουν οι δημοσιογράφοι. Αυτό εδώ όμως το
// διαβάζει ΚΑΘΕ επισκέπτης της αρχικής, και κανείς δεν συνδέεται για
// να δει τίτλους ειδήσεων.
//
// Γι' αυτό κάθεται στη ρίζα, δίπλα στο /uploads/ που είναι επίσης
// δημόσιο για τον ίδιο λόγο.
//
// Δεν γράφει ΤΙΠΟΤΑ. Μόνο διαβάζει. Το γράψιμο το κάνει το roi-se-kv.js
// μέσα από το GitHub Action, με δικό του token.

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
      // Μισό λεπτό στην άκρη του δικτύου. Η ροή ανανεώνεται το πολύ
      // κάθε λεπτό, οπότε παραπάνω φρεσκάδα δεν υπάρχει να κερδηθεί —
      // ενώ η διαφορά σε αιτήματα είναι τεράστια σε ώρα αιχμής.
      //
      // stale-while-revalidate: ο επισκέπτης παίρνει αμέσως ό,τι
      // υπάρχει και η ανανέωση γίνεται από πίσω. Καμία αναμονή, ποτέ.
      'Cache-Control': 'public, max-age=30, stale-while-revalidate=120',
      // Η ροή δείχνει σε newshub.gr· κανείς άλλος δεν τη χρειάζεται,
      // αλλά δεν υπάρχει και λόγος να την κρύψουμε.
      'Access-Control-Allow-Origin': '*',
    },
  };
}
