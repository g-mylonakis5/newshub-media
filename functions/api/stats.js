// /api/stats — οι μετρήσεις του site, για το διαχειριστικό.
//
// Λεπτό περιτύλιγμα: τη δουλειά την κάνει το stats-api.js, που το
// φωνάζει και ο τοπικός serve.js. Εδώ μόνο διαβάζουμε την περίοδο από
// τη διεύθυνση και δίνουμε τις ρυθμίσεις του Cloudflare Pages.
//
// ΑΣΦΑΛΕΙΑ: πίσω από Cloudflare Access, όπως όλο το /api/. Το κλειδί
// των μετρήσεων δεν φεύγει ποτέ από εδώ — στη σελίδα πάνε νούμερα.
import { stats } from '../../stats-api.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const url = new URL(request.url);
  const period = url.searchParams.get('period') || '7d';

  const r = await stats(env, period);

  return new Response(JSON.stringify(r.body), {
    status: r.status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Οι μετρήσεις αλλάζουν συνέχεια. Μια καρτέλα που δείχνει
      // χθεσινά νούμερα είναι χειρότερη από καθόλου καρτέλα.
      'Cache-Control': 'no-store',
    },
  });
}
