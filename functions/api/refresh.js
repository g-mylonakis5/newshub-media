// /api/refresh — «Φέρε τα νέα τώρα».
//
// Ξεκινά με το χέρι το workflow που κατεβάζει ειδήσεις, επεισόδια,
// βίντεο και απομαγνητοφωνήσεις. Το ίδιο workflow τρέχει μόνο του κάθε
// μισή ώρα· αυτό εδώ είναι για όταν κάποιος ΞΕΡΕΙ ότι μόλις ανέβηκε
// κάτι και δεν θέλει να περιμένει ως το επόμενο μισάωρο.
//
// Γιατί δεν κατεβάζουμε εμείς εδώ τα δεδομένα: το data/news.json είναι
// συσσωρευτικό και οι απομαγνητοφωνήσεις 20 MB — ο δίσκος του
// Cloudflare σβήνεται μετά από κάθε αίτημα. Η δουλειά ανήκει στο
// GitHub, που έχει το git. Εμείς απλώς πατάμε το κουμπί.
//
// ΑΣΦΑΛΕΙΑ: πίσω από Cloudflare Access, όπως όλο το /api/.
import { whoFrom } from '../../admin-store.js';

const WORKFLOW = 'fetch.yml';

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

  // Επιτυχία = 204 χωρίς σώμα. Οτιδήποτε άλλο θέλει εξήγηση στα
  // ελληνικά: ο συντάκτης δεν ξέρει τι είναι «403 Resource not
  // accessible by integration».
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
      error: `Δεν βρέθηκε το workflow «${WORKFLOW}» στον κλάδο «${branch}».`,
    });
  }

  return json(502, { error: `GitHub ${res.status}: ${detail}` });
}
