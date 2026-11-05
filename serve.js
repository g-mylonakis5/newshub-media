// serve.js — μικρός τοπικός διακομιστής για να βλέπουμε το site σωστά.
//
// Ανοίγοντας τα αρχεία με διπλό κλικ, η διεύθυνση είναι file:///C:/...
// Αυτό χαλάει πράγματα που απαιτούν κανονική προέλευση: το YouTube αρνείται
// να παίξει ενσωματωμένο βίντεο (Error 153), και αργότερα δεν θα δουλέψει
// ούτε η αναζήτηση με Pagefind.
//
// Δεν χρειάζεται εγκατάσταση — χρησιμοποιεί μόνο ό,τι έχει ήδη ο Node.
//
//   node serve.js      ->  http://localhost:8080

const http = require('http');
const fs = require('fs');
const path = require('path');

const admin = require('./admin-api.js');

const ROOT = path.join(__dirname, 'public');
// Αλλάζει με PORT=8090 node serve.js — χρήσιμο για να τρέχουν δύο
// αντίγραφα μαζί, π.χ. το site που κοιτάς κι ένα για δοκιμή.
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
};

// ---- ο αποθηκευτής του διαχειριστικού, τοπική έκδοση ----
//
// Γράφει κατευθείαν στα αρχεία του data/. Στον αέρα τη θέση του παίρνει
// ένας που κάνει commit στο git — δες functions/api/. Η διεπαφή και το
// admin-api.js δεν ξέρουν ποιος από τους δύο τρέχει.
const DATA = path.join(__dirname, 'data');

// Οι φωτογραφίες ΔΕΝ πάνε στο git — δες το σχόλιο στο admin-api.js.
// Τοπικά ζουν εδώ, στον αέρα σε Cloudflare R2. Και στις δύο περιπτώσεις
// σερβίρονται από το /uploads/, ώστε ένα άρθρο γραμμένο τοπικά να
// δείχνει σωστά και στον αέρα χωρίς να αλλάξει γραμμή.
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
      // Νεότερα πρώτα: το όνομα ξεκινά με χρονοσφραγίδα, οπότε η
      // ανάποδη αλφαβητική σειρά είναι και χρονολογική.
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
      // Αρχείο που δεν υπάρχει δεν είναι σφάλμα — όπως και στο R2.
      if (err.code !== 'ENOENT') throw err;
    }
  },
};

function sendJson(res, status, body){
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

// Διαβάζει το σώμα του αιτήματος. Όριο 5MB: ένα curation.json είναι
// μερικά KB, οπότε οτιδήποτε μεγαλύτερο είναι λάθος ή επίθεση.
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

// Διαβάζει δυαδικό σώμα (φωτογραφία). Ξεχωριστό από το readBody, που
// μαζεύει κείμενο: ενώνοντας bytes σε string χαλάει η εικόνα.
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
    // Το όνομα και ο τύπος έρχονται σε κεφαλίδες, το αρχείο ωμό στο
    // σώμα. Απλούστερο από multipart, και ο browser το στέλνει έτσι
    // χωρίς βιβλιοθήκη — δες το send() στο admin.js.
    const bytes = await readBytes(req, admin.MAX_IMAGE + 1024);
    const r = await admin.saveImage(localStore, {
      bytes,
      type: (req.headers['content-type'] || '').split(';')[0],
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

const server = http.createServer((req, res) => {
  // Κόβουμε το ερωτηματικό και αποκωδικοποιούμε τα ελληνικά στη διεύθυνση.
  let rel = decodeURIComponent(req.url.split('?')[0]);

  if (rel.startsWith('/api/data/')) {
    handleApi(req, res, rel).catch((err) => sendJson(res, 500, { error: String(err.message) }));
    return;
  }

  if (rel === '/api/images') {
    handleImages(req, res).catch((err) => sendJson(res, 500, { error: String(err.message) }));
    return;
  }

  // Οι ανεβασμένες φωτογραφίες. Ζουν ΕΞΩ από το public/ — δες το
  // UPLOADS παραπάνω — οπότε τις σερβίρουμε χωριστά.
  if (rel.startsWith('/uploads/')) {
    const file = path.join(UPLOADS, path.basename(rel));
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end('Δεν βρέθηκε'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
    return;
  }

  if (rel.endsWith('/')) rel += 'index.html';

  // Το διαχειριστικό σερβίρεται από τον ΠΗΓΑΙΟ φάκελο admin/, όχι από
  // το public/.
  //
  // Γιατί: ό,τι μπαίνει στο public/ ανεβαίνει στο site, και μέχρι να
  // στηθεί το Cloudflare Access το /admin/ θα ήταν ανοιχτό σε όλους.
  // Το μετρήσαμε — απαντούσε 200 στο newshubmedia.gr/admin/.
  //
  // Έτσι κερδίζουμε και κάτι καθημερινό: η αλλαγή στο admin/admin.js
  // φαίνεται με απλό refresh, χωρίς να ξανατρέξει το build.
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

  // Δεν αφήνουμε κανέναν να βγει έξω από τον φάκελο public με ../
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Απαγορεύεται');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>404</h1><p>Δεν βρέθηκε: ' + rel + '</p>');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Το site τρέχει στο  http://localhost:${PORT}`);
  console.log('Για να σταματήσει: Ctrl+C');
});
