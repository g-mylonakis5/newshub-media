// /api/images — the image library.
//
//   GET   list what is there
//   POST  upload; the body IS the image, not a form
//
// The browser sends it already shrunk — see shrink() in admin.js.
//
// SECURITY: behind Cloudflare Access, like /api/data/.
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

    // We read UP TO the limit and not whatever is sent: without this a
    // malicious request would have us download gigabytes before we even
    // check the size.
    const len = Number(request.headers.get('content-length') || 0);
    if (len > admin.maxFor(type)) {
      return json(400, {
        error: admin.VIDEO_TYPES[type]
          ? 'Το βίντεο είναι πολύ μεγάλο.'
          : 'Η φωτογραφία είναι πολύ μεγάλη.',
      });
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
    // The name comes in the URL: /api/images?name=<file>
    const name = new URL(request.url).searchParams.get('name');
    const r = await admin.deleteImage(store, name);
    return json(r.status, r.body);
  }

  return json(405, { error: 'Μόνο GET, POST και DELETE' });
}
