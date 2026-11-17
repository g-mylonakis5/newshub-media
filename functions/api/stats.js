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
