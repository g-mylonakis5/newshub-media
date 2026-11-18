// serve.js — small local server, so the site behaves like the real one.
//
// Opened by double-click the address is file:///C:/... which breaks
// anything needing a real origin: YouTube refuses to play embeds (Error
// 153) and Pagefind search does not work.
//
// Nothing to install — only what Node already ships.
//
//   node serve.js      ->  http://localhost:8080

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const admin = require('./admin-api.js');
const { stats } = require('./stats-api.js');

const ROOT = path.join(__dirname, 'public');
const ENV_FILE = path.join(__dirname, '.env');

// Reads .env without a library: one NAME=value per line. Same as in
// fetch-videos.js.
//
// In production there is no .env — the secrets live in Cloudflare Pages
// settings and are handed to the Function. This is the local stand-in so
// testing resembles reality.
function readEnv() {
  if (!fs.existsSync(ENV_FILE)) return {};
  const out = {};
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const clean = line.trim();
    if (!clean || clean.startsWith('#')) continue;
    const at = clean.indexOf('=');
    if (at === -1) continue;
    out[clean.slice(0, at).trim()] = clean.slice(at + 1).trim();
  }
  return out;
}

// Override with PORT=8090 node serve.js — useful for running two copies
// at once, e.g. the site you are looking at and one for testing.
const PORT = Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',

// The two ad formats. They were missing, and without them the browser
// got application/octet-stream: unknown bytes, which do not play in
// <video> and do not show in <img>. Cloudflare sets the type correctly
// in production, so the gap only showed here — exactly where we test
// before selling a slot to a partner.
  '.mp4': 'video/mp4',
  '.gif': 'image/gif',
};

// ---- the admin store, local version ----
//
// Writes straight into data/. In production its place is taken by one
// that commits to git — see functions/api/. Neither the UI nor
// admin-api.js knows which of the two is running.
const DATA = path.join(__dirname, 'data');

// Images do NOT go into git — see the comment in admin-api.js. Locally
// they live here, in production in Cloudflare R2. Both are served from
// /uploads/, so an article written locally displays correctly in
// production without changing a line.
const UPLOADS = path.join(__dirname, 'uploads');

const localStore = {
  read: (name) => fs.promises.readFile(path.join(DATA, `${name}.json`), 'utf8'),
  write: (name, text) => fs.promises.writeFile(path.join(DATA, `${name}.json`), text, 'utf8'),

  putImage: async (file, bytes) => {
    await fs.promises.mkdir(UPLOADS, { recursive: true });
    await fs.promises.writeFile(path.join(UPLOADS, file), bytes);
  },

  listImages: async () => {
    try {
      const files = await fs.promises.readdir(UPLOADS);
      // Newest first: the filename starts with a timestamp, so reverse
      // alphabetical order is chronological.
      return files.filter((f) => /\.(jpg|webp|png)$/i.test(f)).sort().reverse();
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  },

  delImage: async (file) => {
    try {
      await fs.promises.unlink(path.join(UPLOADS, file));
    } catch (err) {
      // A file that does not exist is not an error — same as in R2.
      if (err.code !== 'ENOENT') throw err;
    }
  },
};

function sendJson(res, status, body){
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

// Reads the request body. 5MB limit: a curation.json is a few KB, so
// anything larger is a mistake or an attack.
function readBody(req){
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 5e6) { req.destroy(); reject(new Error('πολύ μεγάλο')); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handleApi(req, res, rel){
  const name = rel.replace(/^\/api\/data\//, '').replace(/\.json$/, '');

  if (req.method === 'GET') {
    const r = await admin.readData(localStore, name);
    return sendJson(res, r.status, r.body);
  }

  if (req.method === 'PUT') {
    let data;
    try {
      data = JSON.parse(await readBody(req));
    } catch (err) {
      return sendJson(res, 400, { error: `Χαλασμένο JSON: ${err.message}` });
    }
    const r = await admin.writeData(localStore, name, data, 'τοπικά');
    return sendJson(res, r.status, r.body);
  }

  sendJson(res, 405, { error: 'Μόνο GET και PUT' });
}

// Reads a binary body (an image). Separate from readBody, which
// collects text: concatenating bytes into a string corrupts the image.
function readBytes(req, limit){
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { req.destroy(); reject(new Error('πολύ μεγάλο αρχείο')); return; }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

async function handleImages(req, res){
  if (req.method === 'GET') {
    const r = await admin.listImages(localStore);
    return sendJson(res, r.status, r.body);
  }

  if (req.method === 'POST') {
    // Name and type arrive in headers, the file raw in the body.
    // Simpler than multipart, and the browser sends it that way with no
    // library — see send() in admin.js.
    const type = (req.headers['content-type'] || '').split(';')[0];
    const bytes = await readBytes(req, admin.maxFor(type) + 1024);
    const r = await admin.saveImage(localStore, {
      bytes,
      type,
      name: decodeURIComponent(req.headers['x-file-name'] || ''),
    });
    return sendJson(res, r.status, r.body);
  }

  if (req.method === 'DELETE') {
    const name = new URL(req.url, 'http://localhost').searchParams.get('name');
    const r = await admin.deleteImage(localStore, name);
    return sendJson(res, r.status, r.body);
  }

  sendJson(res, 405, { error: 'Μόνο GET, POST και DELETE' });
}

  // "Fetch the news now".
  //
  // In production this starts the GitHub workflow — see
  // functions/api/refresh.js. Locally there is no GitHub: we run the same
  // scripts directly, on the same machine.
  //
  // The heavy ones (videos, transcripts) stay out: YouTube needs a key
  // that is usually missing locally, and the transcripts are 20 MB we
  // already have.
let refreshing = false;

async function handleRefresh(req, res){
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Μόνο POST' });

    // Two at once would write the same files over each other.
  if (refreshing) return sendJson(res, 409, { error: 'Τρέχει ήδη.' });
  refreshing = true;

  const run = (file) => new Promise((resolve, reject) => {
    execFile(process.execPath, [path.join(__dirname, file)], (err, out, errOut) => {
      if (err) reject(new Error(`${file}: ${String(errOut || err.message).slice(0, 200)}`));
      else resolve();
    });
  });

  try {
    await run('fetch-news.js');
    await run('fetch-episodes.js');
    sendJson(res, 200, { ok: true, who: 'τοπικά' });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  } finally {
    refreshing = false;
  }
}

// "Put it up on Facebook and X, now."
//
// In production this starts the social.yml workflow — see
// functions/api/social.js. Locally we run the same script on this
// machine. Without keys in the environment it posts NOTHING and says so,
// which is exactly what we want while testing the buttons.
let posting = false;

async function handleSocial(req, res){
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Μόνο POST' });

  if (posting) return sendJson(res, 409, { error: 'Τρέχει ήδη.' });
  posting = true;

  execFile(process.execPath, [path.join(__dirname, 'post-social.js')], (err, out, errOut) => {
    posting = false;

    // Exit code 1 means "some post failed", not "the script broke". The
    // queue file holds the reason, and the admin reads it from there —
    // so either way the answer is ok, with the log attached.
    sendJson(res, 200, {
      ok: true,
      who: 'τοπικά',
      log: String(out || '') + String(errOut || ''),
    });
  });
}

const server = http.createServer((req, res) => {
  // Strip the query string and decode Greek characters in the path.
  let rel = decodeURIComponent(req.url.split('?')[0]);

  if (rel.startsWith('/api/data/')) {
    handleApi(req, res, rel).catch((err) => sendJson(res, 500, { error: String(err.message) }));
    return;
  }

  if (rel === '/api/images') {
    handleImages(req, res).catch((err) => sendJson(res, 500, { error: String(err.message) }));
    return;
  }

  if (rel === '/api/refresh') {
    handleRefresh(req, res).catch((err) => sendJson(res, 500, { error: String(err.message) }));
    return;
  }

  if (rel === '/api/social') {
    handleSocial(req, res).catch((err) => sendJson(res, 500, { error: String(err.message) }));
    return;
  }

  // Stats — see functions/api/stats.js.
  //
  // Locally the token comes from .env, in production from Cloudflare
  // Pages settings. The logic is identical, so what you see here is
  // exactly what the editor will see.
  if (rel === '/api/stats') {
    const period = (req.url.split('?')[1] || '').match(/period=([\w]+)/);
    stats({ ...readEnv(), ...process.env }, period ? period[1] : '7d')
      .then((r) => sendJson(res, r.status, r.body))
      .catch((err) => sendJson(res, 500, { error: String(err.message) }));
    return;
  }

  // Who is signed in — see functions/api/poios.js.
  //
  // Locally there is no Cloudflare Access, so no email. We return empty,
  // which is the truth: locally the admin is open to whoever sits at the
  // machine. The page expects that and shows the list of known names.
  //
  // DOKIMI_EMAIL exists ONLY to test the automatic byline locally — it
  // does not exist in production, where Access provides the email:
  //
  //   DOKIMI_EMAIL=kapoios@newshub.gr node serve.js
  if (rel === '/api/poios') {
    sendJson(res, 200, { email: process.env.DOKIMI_EMAIL || '' });
    return;
  }

  // Uploaded images. They live OUTSIDE public/ — see UPLOADS above — so
  // we serve them separately.
  if (rel.startsWith('/uploads/')) {
    const file = path.join(UPLOADS, path.basename(rel));
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('Δεν βρέθηκε'); return; }

      const type = TYPES[path.extname(file)] || 'application/octet-stream';

      // Partial responses, for video.
      //
      // A browser does not ask for a whole video: it sends Range and
      // expects 206 with the slice it asked for. Safari REFUSES to play a
      // source that answers 200 to a Range request — and the iPhone is
      // exactly where we want to check that "no ad covers the content"
      // still holds.
      //
      // Ten lines here, so the local test tells the truth.
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (range && data.length) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;

        if (start > end || start >= data.length) {
          res.writeHead(416, { 'Content-Range': `bytes */${data.length}` }).end();
          return;
        }

        res.writeHead(206, {
          'Content-Type': type,
          'Content-Range': `bytes ${start}-${end}/${data.length}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
        });
        res.end(data.subarray(start, end + 1));
        return;
      }

      res.writeHead(200, {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Content-Length': data.length,
      });
      res.end(data);
    });
    return;
  }

  if (rel.endsWith('/')) rel += 'index.html';

  // The admin is served from the SOURCE folder admin/, not from public/.
  //
  // Why: everything in public/ goes to the live site, and until Cloudflare
  // Access was in place /admin/ would have been open to everyone. We
  // measured it — newshubmedia.gr/admin/ answered 200.
  //
  // It also buys something daily: a change in admin/admin.js shows up on
  // a plain refresh, without rerunning the build.
  if (rel.startsWith('/admin/')) {
    const name = path.basename(rel);
    const file = path.join(__dirname, 'admin', name);
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('Δεν βρέθηκε'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
    return;
  }

  // Nobody escapes the public folder with ../
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Απαγορεύεται');
    return;
  }

  send(file, rel, res);
});

// Sends the file — and, if it is missing, retries with .html.
//
// Site links no longer carry .html: Cloudflare Pages serves /episode/x
// from x.html by itself. The local server did not know that and answered
// 404 on every click while production worked fine — the worst kind of
// difference.
function send(file, rel, res){
  fs.readFile(file, (err, data) => {
    if (!err) {
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
      return;
    }

    if (!path.extname(file)) {
      fs.readFile(file + '.html', (err2, html) => {
        if (err2) {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>404</h1><p>Δεν βρέθηκε: ' + rel + '</p>');
          return;
        }
        res.writeHead(200, { 'Content-Type': TYPES['.html'] });
        res.end(html);
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404</h1><p>Δεν βρέθηκε: ' + rel + '</p>');
  });
}

server.listen(PORT, () => {
  console.log(`Το site τρέχει στο  http://localhost:${PORT}`);
  console.log('Για να σταματήσει: Ctrl+C');
});
