// /uploads/<αρχείο> — σερβίρει τις φωτογραφίες από το R2.
//
// ΔΗΜΟΣΙΑ διαδρομή, επίτηδες: οι φωτογραφίες εμφανίζονται μέσα στα
// άρθρα που διαβάζει ο κόσμος. ΔΕΝ μπαίνει πίσω από το Access —
// αλλιώς κάθε εικόνα του site θα ζητούσε σύνδεση.
//
// Μόνο GET: το ανέβασμα γίνεται από το /api/images, που είναι
// προστατευμένο.
export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Μόνο GET', { status: 405 });
  }

  if (!env.UPLOADS) return new Response('Δεν υπάρχει χώρος φωτογραφιών', { status: 404 });

  const parts = Array.isArray(params.file) ? params.file : [params.file];
  // Μόνο το όνομα: κανένα ../ δεν βγάζει έξω από τον κάδο.
  const key = String(parts[parts.length - 1] || '');
  if (!key || !/^[\w.-]+$/.test(key)) return new Response('Δεν βρέθηκε', { status: 404 });

  const obj = await env.UPLOADS.get(key);
  if (!obj) return new Response('Δεν βρέθηκε', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  // Τα ονόματα έχουν χρονοσφραγίδα και δεν ξαναγράφονται ποτέ, οπότε
  // μπορούν να μείνουν στη μνήμη του browser για πάντα.
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');

  return new Response(request.method === 'HEAD' ? null : obj.body, { headers });
}
