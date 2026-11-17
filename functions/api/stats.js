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
      // The stats change constantly. A tab showing yesterday's numbers
      // is worse than no tab at all.
      'Cache-Control': 'no-store',
    },
  });
}
