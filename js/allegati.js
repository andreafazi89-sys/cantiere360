// Cantiere 360° - allegati di sopralluoghi e SAL: foto, scatto a raffica, schizzi, note vocali,
// link firmati, PDF e Word, invio via email e WhatsApp. Richiede comune.js.
// I file vanno nel bucket privato `documenti` sotto studi/<studio_id>/; non si cancellano mai dall'app.

const BUCKET = 'documenti';
const FOTO_LATO = 1600;      // lato lungo in px dopo la riduzione
const FOTO_QUALITA = 0.75;   // qualita' JPEG
const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js';
const DOCX_URL = 'https://cdn.jsdelivr.net/npm/docx@9.7.2/dist/index.iife.js';

// ---------- Percorsi e caricamento ----------

// cartella: es. 'commesse/<id>/sopralluoghi/<id>'
function percorsoNuovo(cartella, estensione) {
  return 'studi/' + C360.studio.id + '/' + cartella + '/' + Date.now() + '-' + crypto.randomUUID().slice(0, 8) + '.' + estensione;
}

// Carica il file e registra la riga in allegati. rif: { commessa_id, sopralluogo_id | sal_id }
async function caricaAllegato(blob, rif, cartella, opz = {}) {
  const tipoFile = (blob.type || 'image/jpeg').split(';')[0];
  const est = { 'image/jpeg': 'jpg', 'image/png': 'png', 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg' }[tipoFile] || 'bin';
  const percorso = percorsoNuovo(cartella, est);
  const up = await sb.storage.from(BUCKET).upload(percorso, blob, { contentType: tipoFile, upsert: false });
  if (up.error) throw up.error;
  const riga = Object.assign({
    studio_id: C360.studio.id, commessa_id: rif.commessa_id,
    sopralluogo_id: rif.sopralluogo_id || null, sal_id: rif.sal_id || null,
    tipo: opz.tipo || 'foto', percorso, byte: blob.size, ordine: opz.ordine || 0
  }, opz.durata_s != null ? { durata_s: opz.durata_s } : {});
  const ins = await sb.from('allegati').insert(riga).select('*').single();
  if (ins.error) throw ins.error;
  return ins.data;
}

// Riduce una foto a FOTO_LATO px e la ricomprime in JPEG
async function riduciFoto(file) {
  let sorgente, w, h;
  if (window.createImageBitmap) {
    sorgente = await createImageBitmap(file, { imageOrientation: 'from-image' });
    w = sorgente.width; h = sorgente.height;
  } else {
    sorgente = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = URL.createObjectURL(file); });
    w = sorgente.naturalWidth; h = sorgente.naturalHeight;
  }
  const k = Math.min(1, FOTO_LATO / Math.max(w, h));
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * k); cv.height = Math.round(h * k);
  cv.getContext('2d').drawImage(sorgente, 0, 0, cv.width, cv.height);
  return await new Promise(ok => cv.toBlob(ok, 'image/jpeg', FOTO_QUALITA));
}

// ---------- Link firmati (file privati) ----------

const _firmati = {};
async function linkFirmati(percorsi) {
  const mancanti = percorsi.filter(p => !_firmati[p] || _firmati[p].scade < Date.now());
  if (mancanti.length) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(mancanti, 3600);
    if (error) { mostraErrore(error); return {}; }
    (data || []).forEach(r => { if (r.signedUrl) _firmati[r.path] = { url: r.signedUrl, scade: Date.now() + 50 * 60000 }; });
  }
  const out = {};
  percorsi.forEach(p => { if (_firmati[p]) out[p] = _firmati[p].url; });
  return out;
}

async function scaricaBlob(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('File non scaricato (' + r.status + ')');
  return await r.blob();
}
function blobInDataUrl(blob) {
  return new Promise((ok, ko) => { const f = new FileReader(); f.onload = () => ok(f.result); f.onerror = ko; f.readAsDataURL(blob); });
}
function misureImmagine(src) {
  return new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok({ w: i.naturalWidth, h: i.naturalHeight, img: i }); i.onerror = ko; i.src = src; });
}

// ---------- Scatto a raffica ----------
// Apre la fotocamera a schermo intero; alla fine chiama alFine(blob[])
async function apriRaffica(alFine) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('Fotocamera non disponibile: usa "Scatta foto"'); return; }
  const div = document.createElement('div');
  div.className = 'sovra';
  div.innerHTML = '<video playsinline muted autoplay></video>' +
    '<div class="barra"><button type="button" data-annulla>Annulla</button>' +
    '<button type="button" class="scatta" data-scatta aria-label="Scatta"></button>' +
    '<button type="button" data-fine>Fine (0)</button></div>';
  document.body.appendChild(div);
  const video = div.querySelector('video');
  const scatti = [];
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } }, audio: false });
  } catch (e) { div.remove(); toast('Fotocamera non disponibile: ' + e.message); return; }
  video.srcObject = stream;
  const chiudi = () => { stream.getTracks().forEach(t => t.stop()); div.remove(); };
  div.querySelector('[data-annulla]').onclick = chiudi;
  div.querySelector('[data-scatta]').onclick = () => {
    if (!video.videoWidth) return;
    const k = Math.min(1, FOTO_LATO / Math.max(video.videoWidth, video.videoHeight));
    const cv = document.createElement('canvas');
    cv.width = Math.round(video.videoWidth * k); cv.height = Math.round(video.videoHeight * k);
    cv.getContext('2d').drawImage(video, 0, 0, cv.width, cv.height);
    cv.toBlob(b => { scatti.push(b); div.querySelector('[data-fine]').textContent = 'Fine (' + scatti.length + ')'; }, 'image/jpeg', FOTO_QUALITA);
    video.style.opacity = '.3'; setTimeout(() => { video.style.opacity = '1'; }, 120);
  };
  div.querySelector('[data-fine]').onclick = () => { chiudi(); if (scatti.length) alFine(scatti); };
}

// ---------- Schizzo (a mano libera, anche sopra una foto) ----------
// sfondoUrl: link della foto o null; alSalvataggio(blob JPEG)
async function apriSchizzo(sfondoUrl, alSalvataggio) {
  const div = document.createElement('div');
  div.className = 'sovra';
  div.innerHTML = '<div class="barra"><button type="button" data-annulla>Chiudi</button>' +
    '<span class="chips" data-colori></span>' +
    '<button type="button" data-indietro>Annulla tratto</button><button type="button" data-salva>Salva schizzo</button></div><canvas></canvas>';
  document.body.appendChild(div);
  const cv = div.querySelector('canvas');
  const ctx = cv.getContext('2d');
  let sfondo = null;
  if (sfondoUrl) {
    try { const blob = await scaricaBlob(sfondoUrl); sfondo = (await misureImmagine(URL.createObjectURL(blob))).img; }
    catch (e) { toast('Foto non caricata, schizzo su foglio bianco'); }
  }
  cv.width = sfondo ? sfondo.naturalWidth : 1600;
  cv.height = sfondo ? sfondo.naturalHeight : 1200;
  const colori = ['#d11f1f', '#18222d', '#1d4f7a', '#f2c200'];
  let colore = colori[0];
  const tratti = [];
  let corrente = null;
  const spessore = () => Math.max(4, Math.round(cv.width / 250));
  function disegna() {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    if (sfondo) ctx.drawImage(sfondo, 0, 0, cv.width, cv.height);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    tratti.concat(corrente ? [corrente] : []).forEach(t => {
      ctx.strokeStyle = t.colore; ctx.lineWidth = t.spessore;
      ctx.beginPath();
      t.punti.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
      if (t.punti.length === 1) ctx.lineTo(t.punti[0][0] + 0.1, t.punti[0][1]);
      ctx.stroke();
    });
  }
  // Coordinate del canvas tenendo conto di object-fit: contain
  function punto(e) {
    const r = cv.getBoundingClientRect();
    const k = Math.min(r.width / cv.width, r.height / cv.height);
    const ox = (r.width - cv.width * k) / 2, oy = (r.height - cv.height * k) / 2;
    return [(e.clientX - r.left - ox) / k, (e.clientY - r.top - oy) / k];
  }
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); corrente = { colore, spessore: spessore(), punti: [punto(e)] }; disegna(); });
  cv.addEventListener('pointermove', e => { if (!corrente) return; corrente.punti.push(punto(e)); disegna(); });
  const fine = () => { if (corrente) { tratti.push(corrente); corrente = null; disegna(); } };
  cv.addEventListener('pointerup', fine);
  cv.addEventListener('pointercancel', fine);
  const elColori = div.querySelector('[data-colori]');
  elColori.innerHTML = colori.map((c, i) => '<button type="button" data-colore="' + c + '"' + (i === 0 ? ' class="on"' : '') +
    ' style="background:' + c + ';min-width:40px" aria-label="Colore ' + (i + 1) + '"></button>').join('');
  elColori.onclick = e => {
    const b = e.target.closest('[data-colore]'); if (!b) return;
    colore = b.dataset.colore;
    elColori.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  };
  div.querySelector('[data-indietro]').onclick = () => { tratti.pop(); disegna(); };
  div.querySelector('[data-annulla]').onclick = () => { if (!tratti.length || confirm('Chiudere senza salvare lo schizzo?')) div.remove(); };
  div.querySelector('[data-salva]').onclick = () => {
    if (!tratti.length) { toast('Nessun tratto da salvare'); return; }
    disegna();
    cv.toBlob(b => { div.remove(); alSalvataggio(b); }, 'image/jpeg', 0.8);
  };
  disegna();
}

// ---------- Note vocali ----------
let _registrazione = null;
// Avvia o ferma; alFine(blob, secondi). Restituisce true se sta registrando.
async function registraNota(alFine) {
  if (_registrazione) { _registrazione.rec.stop(); return false; }
  if (!window.MediaRecorder || !navigator.mediaDevices) { toast('Registrazione non disponibile su questo dispositivo'); return false; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { toast('Microfono non disponibile: ' + e.message); return false; }
  const tipo = ['audio/webm', 'audio/mp4', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  const rec = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
  const pezzi = [];
  const inizio = Date.now();
  rec.ondataavailable = e => { if (e.data.size) pezzi.push(e.data); };
  rec.onstop = () => {
    stream.getTracks().forEach(t => t.stop());
    _registrazione = null;
    const blob = new Blob(pezzi, { type: (rec.mimeType || tipo || 'audio/webm').split(';')[0] });
    alFine(blob, Math.round((Date.now() - inizio) / 1000));
  };
  rec.start();
  _registrazione = { rec };
  return true;
}

// ---------- Librerie su richiesta ----------
const _librerie = {};
function caricaScript(url) {
  if (!_librerie[url]) _librerie[url] = new Promise((ok, ko) => {
    const s = document.createElement('script'); s.src = url; s.onload = ok;
    s.onerror = () => { delete _librerie[url]; ko(new Error('Libreria non caricata, controlla la connessione')); };
    document.head.appendChild(s);
  });
  return _librerie[url];
}

// ---------- PDF ----------
// doc: { titolo, sottotitolo, righe: [[etichetta, valore]], sezioni: [{ titolo, testo }], importi: [[etichetta, valore, grassetto]], foto: [{ percorso, didascalia }] }
async function creaPdf(doc) {
  await caricaScript(JSPDF_URL);
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const M = 15, L = 210 - 2 * M, ALT = 297 - M;
  let y = M;
  const spazio = h => { if (y + h > ALT) { pdf.addPage(); y = M; } };
  const testo = (t, dim, stile, colore) => {
    pdf.setFont('helvetica', stile || 'normal'); pdf.setFontSize(dim); pdf.setTextColor(colore || '#18222d');
    pdf.splitTextToSize(String(t || ''), L).forEach(r => { spazio(dim * 0.45); pdf.text(r, M, y); y += dim * 0.45; });
  };
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor('#56616d');
  pdf.text(C360.studio.nome || '', M, y); y += 6;
  testo(doc.titolo, 16, 'bold'); y += 1;
  if (doc.sottotitolo) { testo(doc.sottotitolo, 10, 'normal', '#3d4a57'); }
  pdf.setDrawColor('#1d4f7a'); pdf.setLineWidth(0.6); pdf.line(M, y, M + L, y); y += 6;

  (doc.righe || []).filter(r => r[1]).forEach(([k, v]) => {
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10);
    const righe = pdf.splitTextToSize(String(v), L - 38);
    spazio(righe.length * 4.6);
    pdf.setTextColor('#56616d'); pdf.text(k, M, y);
    pdf.setTextColor('#18222d'); pdf.text(righe, M + 38, y);
    y += righe.length * 4.6 + 0.8;
  });
  (doc.sezioni || []).filter(s => s.testo).forEach(s => {
    y += 3; spazio(12);
    testo(s.titolo.toUpperCase(), 9, 'bold', '#1d4f7a'); y += 0.5;
    testo(s.testo, 10.5);
  });
  if (doc.importi && doc.importi.length) {
    y += 3; spazio(12);
    testo('IMPORTI', 9, 'bold', '#1d4f7a'); y += 1;
    doc.importi.forEach(([k, v, forte]) => {
      spazio(6);
      pdf.setFont('helvetica', forte ? 'bold' : 'normal'); pdf.setFontSize(10.5); pdf.setTextColor('#18222d');
      pdf.text(k, M, y); pdf.text(v, M + L, y, { align: 'right' });
      if (forte) { pdf.setDrawColor('#c5ccd4'); pdf.setLineWidth(0.2); pdf.line(M, y - 4.2, M + L, y - 4.2); }
      y += 5.6;
    });
  }
  const foto = doc.foto || [];
  if (foto.length) {
    y += 4; spazio(14);
    testo('FOTO (' + foto.length + ')', 9, 'bold', '#1d4f7a'); y += 1;
    const link = await linkFirmati(foto.map(f => f.percorso));
    const W = (L - 6) / 2, H = W * 0.75;
    let saltate = 0;
    for (let i = 0; i < foto.length; i += 2) {
      spazio(H + 12);
      for (let j = 0; j < 2 && i + j < foto.length; j++) {
        const f = foto[i + j], x = M + j * (W + 6);
        try {
          const dataUrl = await blobInDataUrl(await scaricaBlob(link[f.percorso]));
          const m = await misureImmagine(dataUrl);
          const k = Math.min(W / m.w, H / m.h), w = m.w * k, h = m.h * k;
          pdf.addImage(dataUrl, 'JPEG', x + (W - w) / 2, y + (H - h) / 2, w, h);
        } catch (e) { saltate++; pdf.setDrawColor('#c5ccd4'); pdf.rect(x, y, W, H); }
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor('#3d4a57');
        pdf.text(pdf.splitTextToSize('Foto ' + (i + j + 1) + (f.didascalia ? ' - ' + f.didascalia : ''), W).slice(0, 2), x, y + H + 4);
      }
      y += H + 12;
    }
    if (saltate) toast(saltate + ' foto non inserite nel PDF');
  }
  const n = pdf.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    pdf.setPage(p); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor('#56616d');
    pdf.text('Pagina ' + p + ' di ' + n + ' - ' + fmtData(oggiISO()), M + L, 297 - 8, { align: 'right' });
  }
  return pdf.output('blob');
}

// ---------- Word con sole foto (griglia 2x2, 8x6 cm) ----------
async function creaWordFoto(titolo, foto) {
  await caricaScript(DOCX_URL);
  const { Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType } = window.docx;
  const link = await linkFirmati(foto.map(f => f.percorso));
  const immagini = [];
  for (const f of foto) {
    try { immagini.push({ buf: await ritaglia43(link[f.percorso]), didascalia: f.didascalia }); } catch (e) { /* saltata */ }
  }
  if (!immagini.length) throw new Error('Nessuna foto esportabile');
  const CM = 567, NB = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const bordi = { top: NB, bottom: NB, left: NB, right: NB };
  const cella = (im, n) => new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, borders: bordi, children: im ? [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'jpg', data: im.buf, transformation: { width: 302, height: 227 } })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: 'Foto ' + n + (im.didascalia ? ' - ' + im.didascalia : ''), font: 'Arial', size: 16 })] })
  ] : [new Paragraph({ children: [] })] });
  const figli = [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: titolo, bold: true, font: 'Arial', size: 28 })] })];
  for (let p = 0; p < immagini.length; p += 4) {
    if (p > 0) figli.push(new Paragraph({ pageBreakBefore: true, children: [] }));
    const righe = [];
    for (let r = p; r < Math.min(p + 4, immagini.length); r += 2) {
      righe.push(new TableRow({ children: [cella(immagini[r], r + 1), cella(r + 1 < p + 4 ? immagini[r + 1] : null, r + 2)] }));
    }
    figli.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: Object.assign({ insideHorizontal: NB, insideVertical: NB }, bordi), rows: righe }));
  }
  const d = new Document({ sections: [{ properties: { page: { margin: { top: CM, right: 2 * CM, bottom: 2 * CM, left: 2 * CM } } }, children: figli }] });
  return await Packer.toBlob(d);
}
// Ritaglio centrale 4:3 (come object-fit: cover nel riquadro 8x6 cm)
async function ritaglia43(url) {
  const m = await misureImmagine(URL.createObjectURL(await scaricaBlob(url)));
  const cv = document.createElement('canvas'); cv.width = 800; cv.height = 600;
  const k = Math.max(800 / m.w, 600 / m.h), w = m.w * k, h = m.h * k;
  cv.getContext('2d').drawImage(m.img, (800 - w) / 2, (600 - h) / 2, w, h);
  const b = await new Promise(ok => cv.toBlob(ok, 'image/jpeg', 0.85));
  return await b.arrayBuffer();
}

// ---------- Scarico e invio ----------
function nomeFile(...pezzi) {
  return pezzi.filter(Boolean).join('_').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-').slice(0, 120);
}
function scaricaFile(blob, nome) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
// Numero per wa.me: solo cifre con prefisso internazionale (se manca si assume +39)
function numeroWhatsapp(tel) {
  let n = String(tel || '').replace(/[^\d+]/g, '');
  if (n.startsWith('+')) n = n.slice(1);
  else if (n.startsWith('00')) n = n.slice(2);
  else if (n) n = '39' + n;
  return n;
}
// canale: 'email' | 'whatsapp'; a: { email, telefono }; testo: messaggio.
// Sul telefono si apre il menu di condivisione con il PDF gia' allegato (si sceglie Mail o WhatsApp).
// Dove non si puo' allegare (computer): il PDF si scarica e si apre la mail o WhatsApp Web con il testo pronto.
async function inviaPdf(blob, nome, canale, a, oggetto, testo) {
  const file = new File([blob], nome, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: oggetto, text: testo }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  scaricaFile(blob, nome);
  if (canale === 'email') {
    location.href = 'mailto:' + encodeURIComponent(a.email || '') + '?subject=' + encodeURIComponent(oggetto) +
      '&body=' + encodeURIComponent(testo + '\n\nIn allegato: ' + nome);
  } else {
    window.open('https://wa.me/' + numeroWhatsapp(a.telefono) + '?text=' + encodeURIComponent(testo), '_blank');
  }
  toast('PDF scaricato: allegalo al messaggio');
}

// ---------- Formati ----------
function euro(n) {
  if (n == null || n === '') return '';
  return Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' euro';
}
function nomeDitta(inc) {
  if (!inc || !inc.ditte) return '';
  return inc.ditte.nome + (inc.ditte.mestiere ? ' (' + inc.ditte.mestiere + ')' : '');
}
