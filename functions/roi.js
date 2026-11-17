
export async function onRequestGet(context) {
  const { env } = context;

  // If the KV binding is missing, that is not the visitor's fault: the
  // page already has the ticker written into it and will simply keep
  // that one. We answer "empty" and the page touches nothing.
  if (!env.ROI) {
    return apantisi({ items: [] });
  }

  const raw = await env.ROI.get('roi');
  if (!raw) return apantisi({ items: [] });

  // Passed through verbatim: what we wrote is what we read. We do not
  // rebuild it with JSON.parse and JSON.stringify for nothing.
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
      // The ticker points at newshub.gr; nobody else needs it, but there
      // is no reason to hide it either.
      'Access-Control-Allow-Origin': '*',
    },
  };
}
