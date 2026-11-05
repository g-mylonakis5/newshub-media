// admin-store.js — ο «αποθηκευτής» του διαχειριστικού ΣΤΟΝ ΑΕΡΑ.
//
// Τοπικά ο serve.js γράφει κατευθείαν στα αρχεία του data/. Στον αέρα
// δεν υπάρχει δίσκος που να επιβιώνει: το Cloudflare Pages σερβίρει
// στατικά αρχεία, και ό,τι γράψει μια Function χάνεται με το που
// τελειώσει το αίτημα.
//
// Οπότε η αποθήκη είναι το ΙΔΙΟ ΤΟ GIT: κάθε «Αποθήκευση» γίνεται
// commit στο GitHub, το Cloudflare το βλέπει και ξαναχτίζει το site.
// Αυτό δίνει και κάτι που κανένα CMS δεν δίνει δωρεάν — πλήρες
// ιστορικό ποιος άλλαξε τι και πότε, με δυνατότητα αναίρεσης.
//
// Το τίμημα: ~2 λεπτά μέχρι να φανεί η αλλαγή. Η διεπαφή το λέει ρητά.
//
// Οι φωτογραφίες ΔΕΝ πάνε στο git — δες το σχόλιο στο admin-api.js.
// Πάνε σε R2 και σερβίρονται από το /uploads/.

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

// Base64 με ΣΩΣΤΑ ελληνικά.
//
// Το btoa() δέχεται μόνο χαρακτήρες 0-255 και σκάει στο πρώτο «ά».
// Όλα τα αρχεία μας είναι ελληνικά, οπότε περνάμε πρώτα από UTF-8.
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

// Διαβάζει αρχείο από το git. Επιστρέφει { text, sha } ή null.
//
// Το sha το χρειάζεται το γράψιμο: το GitHub το απαιτεί για να
// σιγουρευτεί ότι δεν πατάμε αλλαγή που δεν είδαμε.
async function readFile(env, path) {
  const url = `${API}/repos/${env.GITHUB_REPO}/contents/${encodeURI(path)}`
    + `?ref=${encodeURIComponent(env.GITHUB_BRANCH || 'main')}`;

  const res = await fetch(url, { headers: ghHeaders(env) });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const body = await res.json();
  return { text: fromBase64(body.content || ''), sha: body.sha };
}

// Πόσες φορές ξαναπροσπαθούμε όταν κάποιος άλλος πρόλαβε.
//
// Δύο συντάκτες που σώζουν ταυτόχρονα: ο δεύτερος παίρνει 409 επειδή
// το sha που κρατούσε δεν ισχύει πια. Ξαναδιαβάζουμε και ξαναγράφουμε.
// Χωρίς αυτό ο δεύτερος έβλεπε σφάλμα και έχανε τη δουλειά του.
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
  };
}

// Ποιος έκανε την αλλαγή. Το Cloudflare Access βάζει το email του
// χρήστη σε κεφαλίδα — το γράφουμε στο μήνυμα του commit, ώστε το
// ιστορικό να λέει ποιος άλλαξε τι.
export function whoFrom(request) {
  return request.headers.get('Cf-Access-Authenticated-User-Email') || '';
}

// Δικλείδα: αν λείπει κάτι από τις ρυθμίσεις, το λέμε ΚΑΘΑΡΑ αντί να
// σκάσουμε με «undefined» στη μέση ενός commit.
export function missingConfig(env) {
  const missing = [];
  if (!env.GITHUB_TOKEN) missing.push('GITHUB_TOKEN');
  if (!env.GITHUB_REPO) missing.push('GITHUB_REPO');
  return missing;
}
