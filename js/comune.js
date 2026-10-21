// Cantiere 360° - funzioni comuni a tutte le pagine
// Richiede supabase-js caricato prima (window.supabase).

// Solo la publishable key: e' pubblica per natura, i dati sono protetti dalle RLS.
const SUPABASE_URL = 'https://wblgaanxwirmxsawvnjm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_0WbVyyOMiYrVHw7KWGI-Gg_S1NwIeNB';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Stato della sessione, riempito da avvia()
const C360 = { utente: null, membro: null, studio: null };

// ---------- Avvio pagina protetta ----------
// Controlla login e studio; se manca qualcosa rimanda a index.html.
async function avvia(paginaNav) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { location.replace('index.html'); return false; }
  C360.utente = session.user;
  const { data: membro, error } = await sb.from('membri')
    .select('id, nome, ruolo, studio_id, studi!membri_studio_id_fkey(id, nome)')
    .eq('utente_id', session.user.id).eq('attivo', true).maybeSingle();
  if (error) { mostraErrore(error); return false; }
  if (!membro) { location.replace('index.html#crea'); return false; }
  C360.membro = membro;
  C360.studio = membro.studi;
  if (paginaNav) disegnaNav(paginaNav);
  return true;
}

async function esci() {
  await sb.auth.signOut();
  location.replace('index.html');
}

function disegnaNav(attiva) {
  const voci = [
    ['scadenze', 'Scadenze', 'scadenze.html'],
    ['commesse', 'Commesse', 'commesse.html'],
    ['clienti', 'Clienti', 'clienti.html'],
    ['studio', 'Studio', 'studio.html']
  ];
  const nav = document.createElement('nav');
  nav.className = 'nav';
  nav.innerHTML = voci.map(([k, t, h]) =>
    '<a href="' + h + '"' + (k === attiva ? ' class="attivo" aria-current="page"' : '') + '>' + t + '</a>').join('');
  document.body.appendChild(nav);
}

// ---------- Date (gg/mm/aaaa) ----------
function oggiISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function fmtData(iso) {
  if (!iso) return '';
  const [a, m, g] = iso.slice(0, 10).split('-');
  return g + '/' + m + '/' + a;
}
function fmtDataOra(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
// Giorni da oggi a una data ISO (negativo = passata)
function giorniDa(iso) {
  const [a, m, g] = iso.split('-').map(Number);
  const [oa, om, og] = oggiISO().split('-').map(Number);
  return Math.round((Date.UTC(a, m - 1, g) - Date.UTC(oa, om - 1, og)) / 86400000);
}
function quando(iso) {
  const n = giorniDa(iso);
  if (n < -1) return 'scaduta da ' + (-n) + ' giorni';
  if (n === -1) return 'scaduta ieri';
  if (n === 0) return 'oggi';
  if (n === 1) return 'domani';
  return 'tra ' + n + ' giorni';
}
function classeData(iso, fatta) {
  if (fatta) return 'd-ok';
  const n = giorniDa(iso);
  if (n < 0) return 'd-scaduta';
  if (n <= 7) return 'd-vicina';
  return 'd-ok';
}

// ---------- Utilita' ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function $(sel) { return document.querySelector(sel); }
function param(nome) { return new URLSearchParams(location.search).get(nome); }

function etichettaCommessa(c) {
  if (!c) return '';
  return '<span class="etichetta"><i style="background:' + esc(c.colore) + '"></i>' + esc(c.codice || c.titolo) + '</span>';
}

function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.remove('nascosto');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('nascosto'), 2500);
}

function mostraErrore(err) {
  console.error(err);
  toast('Errore: ' + (err.message || err));
}

// Legge i campi di un form in un oggetto; stringhe vuote diventano null
function datiForm(form) {
  const o = {};
  new FormData(form).forEach((v, k) => { o[k] = (typeof v === 'string' && v.trim() === '') ? null : v; });
  return o;
}
// Riempie un form da un oggetto
function riempiForm(form, o) {
  form.reset();
  Object.entries(o || {}).forEach(([k, v]) => {
    const el = form.elements[k];
    if (el) el.value = v ?? '';
  });
}

// Preferenze locali (filtri): mai dati importanti qui
function leggiPref(chiave, def) {
  try { const v = localStorage.getItem('c360.' + chiave); return v === null ? def : JSON.parse(v); } catch (e) { return def; }
}
function salvaPref(chiave, v) {
  try { localStorage.setItem('c360.' + chiave, JSON.stringify(v)); } catch (e) { /* niente */ }
}

const COLORI_COMMESSA = ['#2563eb', '#c2410c', '#15803d', '#7c3aed', '#b91c1c', '#0f766e', '#a16207', '#be185d'];
