import { whoFrom } from '../../admin-store.js';

export function onRequestGet({ request }) {
  return new Response(JSON.stringify({ email: whoFrom(request) }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
