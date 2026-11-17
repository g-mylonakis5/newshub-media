
const API = 'https://api.github.com';

// Το GitHub θέλει User-Agent, αλλιώς απαντά 403 χωρίς εξήγηση.
function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'newshub-media-admin',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  // Σε κομμάτια: με 600 άρθρα το news.json ξεπερνά το όριο ορισμάτων
  // του apply() και ρίχνει «Maximum call stack size exceeded».
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP));
  }
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function dataPath(name) {
  return `data/${name}.json`;
}

async function readFile(env, path) {
  const url = `${API}/repos/${env.GITHUB_REPO}/contents/${encodeURI(path)}`
    + `?ref=${encodeURIComponent(env.GITHUB_BRANCH || 'main')}`;

  const res = await fetch(url, { headers: ghHeaders(env) });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const body = await res.json();

  if (body.content) return { text: fromBase64(body.content), sha: body.sha };

  // Άδειο content και μηδενικό μέγεθος σημαίνει πράγματι άδειο αρχείο.
  if (!body.size) return { text: '', sha: body.sha };

  const raw = await fetch(url, {
    headers: { ...ghHeaders(env), Accept: 'application/vnd.github.raw' },
  });
  if (!raw.ok) {
    throw new Error(`GitHub ${raw.status} στο μεγάλο αρχείο ${path}: `
      + `${(await raw.text()).slice(0, 200)}`);
  }

  return { text: await raw.text(), sha: body.sha };
}

const RETRIES = 3;

async function writeFile(env, path, text, message) {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const current = await readFile(env, path);

    // Ίδιο περιεχόμενο — μην κάνεις άδειο commit.
    if (current && current.text === text) return;

    const res = await fetch(`${API}/repos/${env.GITHUB_REPO}/contents/${encodeURI(path)}`, {
      method: 'PUT',
      headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        content: toBase64(text),
        branch: env.GITHUB_BRANCH || 'main',
        ...(current ? { sha: current.sha } : {}),
      }),
    });

    if (res.ok) return;

    // 409 ή 422 = κάποιος πρόλαβε. Ξαναπροσπαθούμε με φρέσκο sha.
    if ((res.status === 409 || res.status === 422) && attempt < RETRIES - 1) {
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      continue;
    }

    throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  throw new Error('Κάποιος άλλος σώζει την ίδια στιγμή — δοκίμασε ξανά.');
}

// Ο store που περιμένει το admin-api.js. Ίδιες τέσσερις μέθοδοι με
// τον τοπικό του serve.js, ώστε η λογική από πάνω να μην ξέρει ποιος
// από τους δύο τρέχει.
export function gitStore(env) {
  return {
    read: async (name) => {
      const hit = await readFile(env, dataPath(name));
      if (!hit) {
        // Το admin-api.js περιμένει σφάλμα ENOENT για «δεν υπάρχει».
        const err = new Error('δεν υπάρχει');
        err.code = 'ENOENT';
        throw err;
      }
      return hit.text;
    },

    write: (name, text, message) => writeFile(env, dataPath(name), text, message),

    putImage: async (file, bytes, type) => {
      if (!env.UPLOADS) throw new Error('Δεν έχει ρυθμιστεί ο χώρος φωτογραφιών (R2).');
      await env.UPLOADS.put(file, bytes, {
        httpMetadata: { contentType: type, cacheControl: 'public, max-age=31536000, immutable' },
      });
    },

    listImages: async () => {
      if (!env.UPLOADS) return [];
      const out = [];
      let cursor;
      // Το R2 δίνει 1.000 τη φορά· η βιβλιοθήκη θα τα ξεπεράσει.
      do {
        const page = await env.UPLOADS.list({ limit: 1000, cursor });
        for (const o of page.objects) {
          if (/\.(jpg|jpeg|webp|png)$/i.test(o.key)) out.push(o.key);
        }
        cursor = page.truncated ? page.cursor : null;
      } while (cursor);

      // Νεότερα πρώτα: το όνομα ξεκινά με χρονοσφραγίδα, οπότε η
      // ανάποδη αλφαβητική σειρά είναι και χρονολογική.
      return out.sort().reverse();
    },

    delImage: async (file) => {
      if (!env.UPLOADS) throw new Error('Δεν έχει ρυθμιστεί ο χώρος φωτογραφιών (R2).');
      // Το R2 δεν σφάλλει για αρχείο που δεν υπάρχει. Μας βολεύει: δύο
      // συντάκτες που πατούν διαγραφή στο ίδιο δεν βλέπουν σφάλμα.
      await env.UPLOADS.delete(file);
    },
  };
}

function emailFromJwt(token){
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return '';

    // base64url -> base64, και συμπλήρωμα που το atob απαιτεί.
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const full = b64 + '='.repeat((4 - (b64.length % 4)) % 4);

    const bin = atob(full);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    const data = JSON.parse(new TextDecoder().decode(bytes));
    return String(data.email || '');
  } catch (err) {
    return '';
  }
}

function cookieFrom(request, name){
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return '';
}

export function whoFrom(request) {
  return request.headers.get('Cf-Access-Authenticated-User-Email')
    || emailFromJwt(request.headers.get('Cf-Access-Jwt-Assertion'))
    || emailFromJwt(cookieFrom(request, 'CF_Authorization'))
    || '';
}

// Δικλείδα: αν λείπει κάτι από τις ρυθμίσεις, το λέμε ΚΑΘΑΡΑ αντί να
// σκάσουμε με «undefined» στη μέση ενός commit.
export function missingConfig(env) {
  const missing = [];
  if (!env.GITHUB_TOKEN) missing.push('GITHUB_TOKEN');
  if (!env.GITHUB_REPO) missing.push('GITHUB_REPO');
  return missing;
}
