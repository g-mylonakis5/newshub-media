// /api/data/<όνομα>.json — διάβασμα και γράψιμο των δεδομένων.
//
// Η ΙΔΙΑ λογική με τον serve.js: και οι δύο φωνάζουν το admin-api.js
// και του δίνουν έναν store. Αλλάζει μόνο ο store — εδώ γράφει στο
// git αντί στον δίσκο.
//
// ΑΣΦΑΛΕΙΑ: αυτή η διαδρομή πρέπει να είναι ΠΙΣΩ από Cloudflare
// Access. Το Access ελέγχει ταυτότητα πριν φτάσει εδώ το αίτημα.
// Χωρίς αυτό, οποιοσδήποτε γράφει στο site — δες το README.
import admin from '../../../admin-api.js';
import { gitStore, whoFrom, missingConfig } from '../../../admin-store.js';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Ποτέ cache: ο συντάκτης πρέπει να βλέπει ό,τι μόλις έσωσε.
      'Cache-Control': 'no-store',
    },
  });
}

export async function onRequest(context) {
  const { request, env, params } = context;

  const gaps = missingConfig(env);
  if (gaps.length) {
    return json(500, { error: `Λείπουν ρυθμίσεις: ${gaps.join(', ')}` });
  }

  // Το [[name]] δίνει πίνακα κομματιών· κρατάμε το πρώτο χωρίς .json
  const raw = Array.isArray(params.name) ? params.name[0] : params.name;
  const name = String(raw || '').replace(/\.json$/, '');

  const store = gitStore(env);

  if (request.method === 'GET') {
    const r = await admin.readData(store, name);
    return json(r.status, r.body);
  }

  if (request.method === 'PUT') {
    let data;
    try {
      data = await request.json();
    } catch (err) {
      return json(400, { error: 'Το περιεχόμενο δεν είναι έγκυρο JSON.' });
    }

    const r = await admin.writeData(store, name, data, whoFrom(request));
    return json(r.status, r.body);
  }

  return json(405, { error: 'Μόνο GET και PUT' });
}
