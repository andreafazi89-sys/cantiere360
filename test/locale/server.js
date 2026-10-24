// Server di test locale: auth finta (stile GoTrue) + proxy verso PostgREST + storage finto + file statici.
// Solo per prove in locale, nessun dato reale.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { Client, Pool } = require('pg');
const SEGRETO = 'segreto-solo-per-test-locali-lungo-almeno-32-caratteri';
const RADICE = process.argv[2];
const db = new Client({ connectionString: 'postgres://postgres@localhost:54329/c360' });
const pool = new Pool({ connectionString: 'postgres://postgres@localhost:54329/c360' });
const FILE = process.env.FILE_DIR || '/tmp/c360-file';
fs.mkdirSync(FILE, { recursive: true });

const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function firma(payload) {
  const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(payload);
  return h + '.' + p + '.' + crypto.createHmac('sha256', SEGRETO).update(h + '.' + p).digest('base64url');
}
function verifica(tok) {
  const [h, p, s] = String(tok).split('.');
  if (!s) return null;
  const ok = crypto.createHmac('sha256', SEGRETO).update(h + '.' + p).digest('base64url') === s;
  return ok ? JSON.parse(Buffer.from(p, 'base64url')) : null;
}
const refresh = new Map();
function utenteJson(r) {
  return { id: r.id, aud: 'authenticated', role: 'authenticated', email: r.email, user_metadata: r.raw_user_meta_data || {}, app_metadata: { provider: 'email' }, created_at: r.created_at };
}
function sessione(r) {
  const ora = Math.floor(Date.now() / 1000);
  const rt = crypto.randomUUID();
  refresh.set(rt, r);
  return { access_token: firma({ sub: r.id, role: 'authenticated', aud: 'authenticated', email: r.email, iat: ora, exp: ora + 3600 }),
    token_type: 'bearer', expires_in: 3600, expires_at: ora + 3600, refresh_token: rt, user: utenteJson(r) };
}
const hash = p => crypto.createHash('sha256').update(p).digest('hex');
function invia(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(obj === undefined ? '' : JSON.stringify(obj));
}
const corpo = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });

async function auth(req, res, url) {
  const b = await corpo(req); const j = b ? JSON.parse(b) : {};
  const p = url.pathname.replace('/auth/v1', '');
  if (p === '/signup') {
    const id = crypto.randomUUID();
    try {
      const { rows } = await db.query('insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_user_meta_data) values ($1, $2, $3, $3, $4, $5, $6) returning *',
        [id, '00000000-0000-0000-0000-000000000000', 'authenticated', j.email, hash(j.password), j.data || {}]);
      return invia(res, 200, sessione(rows[0]));
    } catch (e) { return invia(res, 422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' }); }
  }
  if (p === '/token') {
    if (url.searchParams.get('grant_type') === 'password') {
      const { rows } = await db.query('select * from auth.users where email = $1 and encrypted_password = $2', [j.email, hash(j.password)]);
      if (!rows.length) return invia(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return invia(res, 200, sessione(rows[0]));
    }
    const r = refresh.get(j.refresh_token);
    if (!r) return invia(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
    return invia(res, 200, sessione(r));
  }
  const tok = verifica((req.headers.authorization || '').replace(/^Bearer /, ''));
  if (p === '/user') {
    if (!tok) return invia(res, 401, { msg: 'invalid JWT' });
    const { rows } = await db.query('select * from auth.users where id = $1', [tok.sub]);
    return invia(res, 200, utenteJson(rows[0]));
  }
  if (p === '/logout') return invia(res, 204);
  if (p === '/recover') return invia(res, 200, {});
  return invia(res, 404, { msg: 'non gestito: ' + p });
}

function rest(req, res, url) {
  const headers = {};
  ['accept', 'content-type', 'prefer', 'range', 'accept-profile', 'content-profile'].forEach(h => { if (req.headers[h]) headers[h] = req.headers[h]; });
  const tok = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (verifica(tok)) headers.authorization = 'Bearer ' + tok;   // altrimenti: anon
  const prox = http.request({ host: '127.0.0.1', port: 54330, method: req.method, path: url.pathname.replace('/rest/v1', '') + url.search, headers }, r => {
    const h = Object.assign({}, r.headers, { 'access-control-allow-origin': '*' });
    res.writeHead(r.statusCode, h); r.pipe(res);
  });
  req.pipe(prox);
}

// Storage finto: le policy di storage.objects decidono come su Supabase (insert e select come utente loggato).
async function comeUtente(tok, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: tok ? tok.sub : null, role: tok ? 'authenticated' : 'anon' })]);
    await c.query(tok ? 'set local role authenticated' : 'set local role anon');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
function corpoBinario(req) { return new Promise(r => { const p = []; req.on('data', c => p.push(c)); req.on('end', () => r(Buffer.concat(p))); }); }
// Estrae il file da un multipart/form-data (supabase-js manda i Blob cosi')
function fileDaMultipart(buf, ct) {
  const m = /boundary=(.+)$/.exec(ct || ''); if (!m) return { dati: buf, tipo: ct };
  const conf = Buffer.from('--' + m[1]);
  let i = buf.indexOf(conf);
  while (i >= 0) {
    const j = buf.indexOf(conf, i + conf.length); if (j < 0) break;
    const parte = buf.slice(i + conf.length + 2, j - 2);
    const sep = parte.indexOf('\r\n\r\n');
    const testa = parte.slice(0, sep).toString();
    if (/filename=/.test(testa)) {
      const t = /content-type:\s*([^\r\n]+)/i.exec(testa);
      return { dati: parte.slice(sep + 4), tipo: t ? t[1].trim() : 'application/octet-stream' };
    }
    i = j;
  }
  return { dati: Buffer.alloc(0), tipo: null };
}
const firmati = new Map();
async function storage(req, res, url) {
  const tok = verifica((req.headers.authorization || '').replace(/^Bearer /, ''));
  const p = decodeURIComponent(url.pathname.replace('/storage/v1', ''));
  try {
    let m;
    if (req.method === 'POST' && (m = /^\/object\/sign\/([^/]+)$/.exec(p))) {
      const j = JSON.parse((await corpoBinario(req)).toString());
      const out = await comeUtente(tok, async c => {
        const r = await c.query('select name from storage.objects where bucket_id = $1 and name = any($2)', [m[1], j.paths]);
        const visti = new Set(r.rows.map(x => x.name));
        return j.paths.map(path => {
          if (!visti.has(path)) return { path, error: 'Object not found', signedURL: null };
          const t = crypto.randomUUID(); firmati.set(t, { bucket: m[1], path, scade: Date.now() + j.expiresIn * 1000 });
          return { path, error: null, signedURL: '/object/sign/' + m[1] + '/' + path + '?token=' + t };
        });
      });
      return invia(res, 200, out);
    }
    if (req.method === 'GET' && (m = /^\/object\/sign\/([^/]+)\/(.+)$/.exec(p))) {
      const f = firmati.get(url.searchParams.get('token'));
      if (!f || f.path !== m[2] || f.scade < Date.now()) return invia(res, 400, { error: 'InvalidSignature' });
      const r = await db.query('select metadata from storage.objects where bucket_id = $1 and name = $2', [m[1], m[2]]);
      res.writeHead(200, { 'content-type': (r.rows[0] && r.rows[0].metadata && r.rows[0].metadata.mimetype) || 'application/octet-stream', 'access-control-allow-origin': '*' });
      return fs.createReadStream(path.join(FILE, m[1], m[2])).pipe(res);
    }
    if (req.method === 'POST' && (m = /^\/object\/([^/]+)\/(.+)$/.exec(p))) {
      const { dati, tipo } = fileDaMultipart(await corpoBinario(req), req.headers['content-type']);
      const b = (await db.query('select * from storage.buckets where id = $1', [m[1]])).rows[0];
      if (!b) return invia(res, 404, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
      if (b.file_size_limit && dati.length > b.file_size_limit) return invia(res, 413, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
      if (b.allowed_mime_types && !b.allowed_mime_types.includes(tipo)) return invia(res, 415, { statusCode: '415', error: 'invalid_mime_type', message: 'mime type ' + tipo + ' is not supported' });
      try {
        await comeUtente(tok, c => c.query('insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3)', [m[1], m[2], { mimetype: tipo, size: dati.length }]));
      } catch (e) {
        return invia(res, e.code === '23505' ? 409 : 403, { statusCode: e.code === '23505' ? '409' : '403', error: 'Unauthorized', message: e.message });
      }
      fs.mkdirSync(path.dirname(path.join(FILE, m[1], m[2])), { recursive: true });
      fs.writeFileSync(path.join(FILE, m[1], m[2]), dati);
      return invia(res, 200, { Key: m[1] + '/' + m[2], Id: crypto.randomUUID() });
    }
    return invia(res, 404, { message: 'non gestito: ' + req.method + ' ' + p });
  } catch (e) { return invia(res, 500, { message: e.message }); }
}

const TIPI = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
function statico(req, res, url) {
  let f = path.join(RADICE, decodeURIComponent(url.pathname));
  if (url.pathname.endsWith('/')) f = path.join(f, 'index.html');
  if (!f.startsWith(RADICE) || !fs.existsSync(f)) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'content-type': TIPI[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}

db.connect().then(() => http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }); return res.end(); }
  if (url.pathname.startsWith('/auth/v1')) return auth(req, res, url).catch(e => invia(res, 500, { msg: e.message }));
  if (url.pathname.startsWith('/rest/v1')) return rest(req, res, url);
  if (url.pathname.startsWith('/storage/v1')) return storage(req, res, url);
  statico(req, res, url);
}).listen(54331, () => console.log('pronto su 54331')));
