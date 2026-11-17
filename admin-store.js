
const API = 'https://api.github.com';

// GitHub wants a User-Agent, or it answers 403 with no explanation.
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
  // In chunks: with 600 articles news.json exceeds apply()'s argument
  // limit and throws "Maximum call stack size exceeded".
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

  // Empty content plus zero size really does mean an empty file.
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

    // Identical content — do not make an empty commit.
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

    // 409 or 422 = someone got there first. We retry with a fresh sha.
    if ((res.status === 409 || res.status === 422) && attempt < RETRIES - 1) {
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      continue;
    }

    throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  throw new Error('Κάποιος άλλος σώζει την ίδια στιγμή — δοκίμασε ξανά.');
}

// The store admin-api.js expects. The same four methods as serve.js's
// local one, so the logic above does not know which of the two is
// running.
export function gitStore(env) {
  return {
    read: async (name) => {
      const hit = await readFile(env, dataPath(name));
      if (!hit) {
        // admin-api.js expects an ENOENT error for "does not exist".
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
      // R2 gives 1,000 at a time; the library will outgrow that.
      do {
        const page = await env.UPLOADS.list({ limit: 1000, cursor });
        for (const o of page.objects) {
          if (/\.(jpg|jpeg|webp|png)$/i.test(o.key)) out.push(o.key);
        }
        cursor = page.truncated ? page.cursor : null;
      } while (cursor);

      // Newest first: the name starts with a timestamp, so reverse
      // alphabetical order is also chronological.
      return out.sort().reverse();
    },

    delImage: async (file) => {
      if (!env.UPLOADS) throw new Error('Δεν έχει ρυθμιστεί ο χώρος φωτογραφιών (R2).');
      // R2 does not error on a file that does not exist. That suits us:
      // two editors deleting the same one see no error.
      await env.UPLOADS.delete(file);
    },
  };
}

function emailFromJwt(token){
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return '';

    // base64url -> base64, plus the padding atob demands.
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

// Safety catch: if something is missing from the settings we say so
// CLEARLY instead of blowing up with "undefined" mid-commit.
export function missingConfig(env) {
  const missing = [];
  if (!env.GITHUB_TOKEN) missing.push('GITHUB_TOKEN');
  if (!env.GITHUB_REPO) missing.push('GITHUB_REPO');
  return missing;
}
