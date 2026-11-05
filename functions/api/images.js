// /api/images — η βιβλιοθήκη φωτογραφιών.
//
//   GET   λίστα ό,τι υπάρχει
//   POST  ανέβασμα· το σώμα είναι η ΙΔΙΑ η εικόνα, όχι φόρμα
//
// Ο browser τη στέλνει ήδη σμικρυσμένη — δες τη shrink() στο admin.js.
//
// ΑΣΦΑΛΕΙΑ: πίσω από Cloudflare Access, όπως και το /api/data/.
import admin from '../../admin-api.js';
import { gitStore } from '../../admin-store.js';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (!env.UPLOADS) {
    return json(500, { error: 'Δεν έχει ρυθμιστεί ο χώρος φωτογραφιών (R2 binding «UPLOADS»).' });
  }

  const store = gitStore(env);

  if (request.method === 'GET') {
    const r = await admin.listImages(store);
    return json(r.status, r.body);
  }

  if (request.method === 'POST') {
    const type = (request.headers.get('content-type') || '').split(';')[0];

    // Διαβάζουμε ΜΕΧΡΙ το όριο και όχι ό,τι σταλεί: χωρίς αυτό, ένα
    // κακόβουλο αίτημα θα μας έβαζε να κατεβάσουμε γιγαμπάιτ πριν καν
    // ελέγξουμε το μέγεθος.
    const len = Number(request.headers.get('content-length') || 0);
    if (len > admin.MAX_IMAGE) {
      return json(400, { error: 'Η φωτογραφία είναι πολύ μεγάλη.' });
    }

    const bytes = new Uint8Array(await request.arrayBuffer());

    const r = await admin.saveImage(store, {
      bytes,
      type,
      name: decodeURIComponent(request.headers.get('x-file-name') || ''),
    });
    return json(r.status, r.body);
  }

  if (request.method === 'DELETE') {
    // Το όνομα έρχεται στη διεύθυνση: /api/images?name=<αρχείο>
    const name = new URL(request.url).searchParams.get('name');
    const r = await admin.deleteImage(store, name);
    return json(r.status, r.body);
  }

  return json(405, { error: 'Μόνο GET, POST και DELETE' });
}
