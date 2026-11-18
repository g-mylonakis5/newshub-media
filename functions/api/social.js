// /api/social — ξεκινά ΤΩΡΑ το ανέβασμα της ουράς στο Facebook και στο X.
//
// Το διαχειριστικό πρώτα σώζει το data/social-queue.json (μέσω του
// /api/data/social-queue) και μετά φωνάζει εδώ. Χωρίς αυτό το κουμπί η
// ουρά θα έφευγε στο επόμενο cron — μέχρι ένα τέταρτο αργότερα, που για
// είδηση είναι πολύ.
//
// ΑΣΦΑΛΕΙΑ: όπως όλο το /api, πρέπει να είναι πίσω από Cloudflare Access.
import { whoFrom } from '../../admin-store.js';

const WORKFLOW = 'social.yml';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return json(405, { error: 'Μόνο POST' });
  }

  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) {
    return json(500, { error: 'Λείπουν ρυθμίσεις: GITHUB_TOKEN, GITHUB_REPO' });
  }

  const branch = env.GITHUB_BRANCH || 'main';
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}`
    + `/actions/workflows/${WORKFLOW}/dispatches`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'newshub-media-admin',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: branch }),
  });

  if (res.status === 204) {
    return json(200, { ok: true, who: whoFrom(request) });
  }

  const detail = (await res.text()).slice(0, 200);

  if (res.status === 403) {
    return json(403, {
      error: 'Το token δεν έχει δικαίωμα να ξεκινά εργασίες '
        + '(χρειάζεται «Actions: Read and write»).',
    });
  }
  if (res.status === 404) {
    return json(404, {
      error: `Δεν βρέθηκε το workflow «${WORKFLOW}» στον κλάδο «${branch}». `
        + 'Αν μόλις προστέθηκε, θέλει πρώτα ένα push στο main.',
    });
  }

  return json(502, { error: `GitHub ${res.status}: ${detail}` });
}
