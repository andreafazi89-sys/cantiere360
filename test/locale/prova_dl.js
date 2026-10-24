// Prova Playwright della direzione lavori (migrazione 003): ditte, sopralluogo con foto per ditta,
// schizzo, nota vocale, PDF e Word, SAL con importi solo per il titolare, isolamento tra studi.
// Uso: SBJS=<supabase.js> JSPDF=<jspdf.umd.min.js> DOCX=<docx index.iife.js> IMG=<cartella con foto1..4.jpg>
//      SHOTS=<cartella screenshot> OUT=<cartella file scaricati> node test/locale/prova_dl.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const LIB = { 'supabase-js': fs.readFileSync(process.env.SBJS, 'utf8'), jspdf: fs.readFileSync(process.env.JSPDF, 'utf8'), docx: fs.readFileSync(process.env.DOCX, 'utf8') };
const { SHOTS, OUT, IMG } = process.env;
const BASE = 'http://localhost:54331/';
const errori = [];
const ok = (cond, msg) => { if (!cond) throw new Error('CONTROLLO FALLITO: ' + msg); console.log('ok -', msg); };

async function nuovaPagina(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, permissions: ['camera', 'microphone', 'geolocation'], geolocation: { latitude: 41.9028, longitude: 12.4964 } });
  const page = await ctx.newPage();
  await page.route('https://cdn.jsdelivr.net/**', r => {
    const u = r.request().url();
    const k = Object.keys(LIB).find(x => u.includes('/' + x + '@'));
    return k ? r.fulfill({ body: LIB[k], contentType: 'text/javascript' }) : r.abort();
  });
  await page.route('https://fonts.googleapis.com/**', r => r.abort());
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  await page.route('https://wblgaanxwirmxsawvnjm.supabase.co/**', async r => {
    const u = new URL(r.request().url());
    const resp = await r.fetch({ url: 'http://localhost:54331' + u.pathname + u.search });
    await r.fulfill({ response: resp });
  });
  page.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_FAILED/.test(m.text())) errori.push(page.url() + ' | ' + m.text()); });
  page.on('pageerror', e => errori.push(page.url() + ' | PAGEERROR ' + e.message));
  page.on('dialog', d => d.accept());
  return page;
}
const foto = (p, n) => p.screenshot({ path: SHOTS + '/' + n + '.png', fullPage: true });

async function registra(page, studio, nome, email) {
  await page.goto(BASE + 'index.html');
  await page.click('text=Crea il tuo studio');
  const f = page.locator('#f-registra');
  await f.locator('[name=nome_studio]').fill(studio);
  await f.locator('[name=nome]').fill(nome);
  await f.locator('[name=email]').fill(email);
  await f.locator('[name=password]').fill('password123');
  await f.locator('button[type=submit]').click();
  await page.waitForURL('**/scadenze.html');
}
async function accedi(page, email) {
  await page.goto(BASE + 'index.html');
  await page.fill('#f-accedi [name=email]', email);
  await page.fill('#f-accedi [name=password]', 'password123');
  await page.click('#f-accedi button[type=submit]');
  await page.waitForURL('**/scadenze.html');
}
// Ditta in commessa: scelta dalla rubrica; con nuova:{...} la crea in rubrica dalla finestra stessa
async function aggiungiDitta(a, ditta, campi = {}, nuova = null) {
  await a.click('#b-ditta');
  const d = a.locator('#dlg-ditta');
  if (nuova) {
    await d.locator('[data-nuova]').click();
    const r = a.locator('#dlg-rubrica-ditta');
    for (const [k, v] of Object.entries(nuova)) await r.locator('[name=' + k + ']').fill(v);
    await r.locator('button[type=submit]').click();
    await a.waitForFunction(() => document.querySelector('#dlg-ditta [name=ditta_id]').value !== '');
  } else await d.locator('[name=ditta_id]').selectOption({ label: ditta });
  for (const [k, v] of Object.entries(campi)) await d.locator('[name=' + k + ']').fill(v);
  const n = await a.locator('#ditte .card').count();
  await d.locator('button[type=submit]').click();
  await a.waitForFunction(n => document.querySelectorAll('#ditte .card').length === n + 1, n);
}
async function scarica(page, sel) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
  const f = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(f);
  return f;
}
const testoPdf = f => execSync('pdftotext -layout ' + JSON.stringify(f) + ' -').toString();
const pagine = f => Number(/Pages:\s+(\d+)/.exec(execSync('pdfinfo ' + JSON.stringify(f)).toString())[1]);
const fotoNelPdf = f => (execSync('pdfimages -list ' + JSON.stringify(f)).toString().trim().split('\n').length - 2);

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const a = await nuovaPagina(browser);
  await registra(a, 'Studio Rossi Architetti', 'Giulia Rossi', 'giulia@prova.invalid');

  await a.click('nav >> text=Clienti');
  await a.click('#b-nuovo');
  await a.fill('#f-cliente [name=nome]', 'Laura Bianchi');
  await a.fill('#f-cliente [name=email]', 'laura@prova.invalid');
  await a.click('#f-cliente button[type=submit]');
  await a.waitForSelector('#elenco .card');
  await a.click('nav >> text=Commesse');
  await a.click('#b-nuova');
  const dc = a.locator('#dlg-commessa');
  await dc.locator('[name=titolo]').fill('Ristrutturazione appartamento');
  await dc.locator('[name=cliente_id]').selectOption({ label: 'Laura Bianchi' });
  await dc.locator('[name=comune]').fill('Roma');
  await dc.locator('[name=indirizzo]').fill('Via Roma 10');
  await dc.locator('button[type=submit]').click();
  await a.waitForURL('**/commessa.html?id=*');
  const idCommessa = new URL(a.url()).searchParams.get('id');
  await a.waitForSelector('#ditte .vuoto');

  // ===== Ditte =====
  // Rubrica ditte, fuori dalle commesse
  await a.click('nav >> text=Ditte');
  await a.waitForSelector('#elenco .vuoto');
  await a.click('#b-nuova');
  const r = a.locator('#dlg-rubrica-ditta');
  for (const [k, v] of Object.entries({ nome: 'Falegnameria Bianchi', mestiere: 'Falegname', referente: 'Mario', telefono: '333 1234567', email: 'falegname@prova.invalid' })) await r.locator('[name=' + k + ']').fill(v);
  await r.locator('button[type=submit]').click();
  await a.waitForSelector('#elenco .card');
  ok((await a.textContent('#elenco')).includes('Nessuna commessa'), 'rubrica ditte: ditta creata fuori dalle commesse');
  await a.goto(BASE + 'commessa.html?id=' + idCommessa);
  await a.waitForSelector('#ditte .vuoto');
  await aggiungiDitta(a, 'Falegnameria Bianchi (Falegname)', { lavorazioni: 'Porte interne e armadio', importo_contratto: '12000' });
  await aggiungiDitta(a, null, {}, { nome: 'Pittore Verdi', mestiere: 'Pittore', telefono: '+39 347 7654321' });
  ok((await a.textContent('#ditte')).includes('Pittore Verdi'), 'ditta nuova creata in rubrica dalla commessa e scelta');
  ok((await a.textContent('#ditte')).includes('contratto 12.000,00 euro'), 'il titolare vede il contratto della ditta');
  await foto(a, 'dl-01-commessa-ditte');

  // ===== Sopralluogo =====
  await a.click('#b-sopralluogo');
  await a.waitForURL('**/sopralluogo.html?id=*');
  const idSop = new URL(a.url()).searchParams.get('id');
  await a.waitForSelector('#galleria [data-elenco]');
  await a.fill('#f-sop [name=tipo]', 'Visita di direzione lavori');
  await a.fill('#f-sop [name=oggetto]', 'Verifica tracce e misure porte');
  await a.fill('#f-sop [name=presenti]', 'Arch. Giulia Rossi, Mario (falegname), committente');
  await a.fill('#f-sop [name=disposizioni]', 'Liberare il corridoio entro venerdi\'.');
  await a.waitForFunction(() => /Salvato/.test(document.querySelector('#salvataggio').textContent));
  ok(true, 'salvataggio automatico del sopralluogo');
  await a.click('#b-gps');
  await a.waitForFunction(() => /Posizione:/.test(document.querySelector('#posizione').textContent));
  ok(true, 'posizione registrata');

  // 4 foto dal telefono (2,1 MB l'una, 3000x2000) -> ridotte
  await a.setInputFiles('#galleria [data-in=galleria]', [1, 2, 3, 4].map(i => path.join(IMG, 'foto' + i + '.jpg')));
  await a.waitForFunction(() => document.querySelectorAll('#galleria .foto').length === 4, null, { timeout: 30000 });
  // 2 scatti a raffica con la fotocamera finta
  await a.click('#galleria [data-a=raffica]');
  await a.waitForSelector('.sovra video');
  await a.waitForFunction(() => document.querySelector('.sovra video').videoWidth > 0);
  await a.click('.sovra [data-scatta]'); await a.waitForTimeout(300);
  await a.click('.sovra [data-scatta]'); await a.waitForTimeout(300);
  await a.click('.sovra [data-fine]');
  await a.waitForFunction(() => document.querySelectorAll('#galleria .foto').length === 6, null, { timeout: 20000 });
  ok(true, 'scatto a raffica: 2 foto');
  // Schizzo sopra la foto 1
  await a.locator('#galleria .foto').first().locator('[data-disegna]').click();
  await a.waitForSelector('.sovra canvas');
  await a.waitForTimeout(500);
  const box = await a.locator('.sovra canvas').boundingBox();
  await a.mouse.move(box.x + 60, box.y + 60); await a.mouse.down();
  await a.mouse.move(box.x + 200, box.y + 160, { steps: 8 }); await a.mouse.up();
  await foto(a, 'dl-02-schizzo');
  await a.click('.sovra [data-salva]');
  await a.waitForFunction(() => document.querySelectorAll('#galleria .foto').length === 7, null, { timeout: 20000 });
  ok(true, 'schizzo sulla foto salvato come nuova immagine');

  // Didascalia e foto per ditta
  const card = i => a.locator('#galleria .foto').nth(i);
  await card(0).locator('[data-didascalia]').fill('Vano porta camera');
  await card(0).locator('[data-didascalia]').press('Tab');
  await a.waitForTimeout(300);
  const chip = async (i, ditta) => { await card(i).locator('[data-ditta]', { hasText: ditta }).click(); await a.waitForTimeout(250); };
  await chip(0, 'Falegname'); await chip(1, 'Falegname'); await chip(1, 'Pittore'); await chip(2, 'Pittore'); await chip(6, 'Falegname');
  await chip(3, 'Falegname'); await chip(3, 'Falegname');   // messa e tolta
  ok((await a.textContent('#galleria [data-stato]')).includes('Falegname: 3') && (await a.textContent('#galleria [data-stato]')).includes('Pittore: 2'), 'conteggio foto per ditta: falegname 3, pittore 2');
  // Sposta la foto 2 al primo posto
  await card(1).locator('[data-sposta="-1"]').click();
  await a.waitForTimeout(500);
  ok(await card(0).locator('[data-didascalia]').inputValue() === '', 'riordino foto');
  // Elimina la foto 5
  await card(4).locator('[data-elimina]').click();
  await a.waitForFunction(() => document.querySelectorAll('#galleria .foto').length === 6);
  ok(true, 'foto eliminata (marcata eliminata)');

  // Nota vocale (microfono finto)
  await a.click('#b-registra');
  await a.waitForTimeout(2200);
  await a.click('#b-registra');
  await a.waitForSelector('#audio .audio', { timeout: 15000 });
  ok(true, 'nota vocale salvata');

  // Note per la falegnameria
  const notaF = a.locator('#ditte [data-inc]', { hasText: 'Falegnameria' }).locator('[data-nota]');
  await notaF.fill('Rifare la misura del vano bagno, attesa conferma colore.');
  await notaF.press('Tab');
  await a.waitForTimeout(400);
  await foto(a, 'dl-03-sopralluogo');

  // PDF per la falegnameria: solo le sue 3 foto
  await a.selectOption('#destinatario', { label: 'Falegnameria Bianchi (Falegname)' });
  await a.click('#b-pdf');
  await a.waitForSelector('#pronto:not(.nascosto)', { timeout: 30000 });
  const pdfF = await scarica(a, '#b-scarica');
  const tF = testoPdf(pdfF);
  ok(tF.includes('Verbale di sopralluogo') && tF.includes('Rifare la misura') && tF.includes('Liberare il corridoio'), 'PDF ditta: verbale con disposizioni generali e note della ditta');
  ok(!tF.includes('Pittore Verdi'), 'PDF ditta: niente note di altre ditte');
  ok(fotoNelPdf(pdfF) === 3, 'PDF ditta: esattamente 3 foto (trovate ' + fotoNelPdf(pdfF) + ')');
  // WhatsApp sul computer: scarica il PDF e apre wa.me con il numero della ditta
  await a.evaluate(() => { window.open = u => { window.__aperto = u; return null; }; });
  await Promise.all([a.waitForEvent('download'), a.click('#b-whatsapp')]);
  const wa = await a.evaluate(() => window.__aperto);
  ok(wa.startsWith('https://wa.me/393331234567?text='), 'WhatsApp: PDF scaricato e wa.me con il numero della ditta (' + decodeURIComponent(wa).slice(0, 80) + '...)');
  // PDF completo per lo studio
  await a.selectOption('#destinatario', '');
  await a.click('#b-pdf');
  await a.waitForSelector('#pronto:not(.nascosto)', { timeout: 30000 });
  const pdfS = await scarica(a, '#b-scarica');
  ok(fotoNelPdf(pdfS) === 6 && testoPdf(pdfS).includes('PER FALEGNAMERIA BIANCHI (FALEGNAME)'), 'PDF studio: tutte le 6 foto e le sezioni per ditta');
  console.log('   PDF ditta', pagine(pdfF), 'pagine,', Math.round(fs.statSync(pdfF).size / 1024), 'KB; PDF studio', pagine(pdfS), 'pagine,', Math.round(fs.statSync(pdfS).size / 1024), 'KB');
  // Word solo foto del pittore
  await a.selectOption('#destinatario', { label: 'Pittore Verdi (Pittore)' });
  const word = await scarica(a, '#b-word');
  const media = execSync('unzip -l ' + JSON.stringify(word)).toString().split('\n').filter(r => /word\/media\/.+\.jpg/.test(r)).length;
  ok(media === 2, 'Word pittore: 2 foto (trovate ' + media + ')');

  // Peso reale delle foto ridotte
  const pesi = execSync('psql -h localhost -p 54329 -U postgres -d c360 -At -c "select tipo, count(*), round(avg(byte)/1024) from allegati group by tipo order by tipo"').toString().trim();
  console.log('   peso medio allegati (tipo|n|KB):', pesi.replace(/\n/g, '  '));

  // ===== SAL =====
  await a.click('#link-commessa');
  await a.waitForSelector('#sopralluoghi .card');
  ok((await a.textContent('#sopralluoghi')).includes('6 foto'), 'commessa: sopralluogo con 6 foto');
  const nuovoSal = async ditta => {
    await a.click('#b-sal');
    await a.selectOption('#dlg-nuovo-sal select', { label: ditta });
    await a.click('#dlg-nuovo-sal button[type=submit]');
    await a.waitForURL('**/sal.html?id=*');
    await a.waitForSelector('#galleria [data-elenco]');
  };
  await nuovoSal('Falegnameria Bianchi (Falegname)');
  ok((await a.textContent('#titolo')).startsWith('SAL n. 1'), 'primo SAL numero 1');
  await a.fill('#f-sal [name=descrizione]', 'Posa telai porte');
  await a.fill('#f-sal [name=avanzamento]', '30');
  await a.fill('#f-importi [name=lavori_eseguiti]', '4000');
  await a.locator('#f-importi [name=lavori_eseguiti]').press('Tab');
  await a.waitForTimeout(800);
  await a.setInputFiles('#galleria [data-in=galleria]', [path.join(IMG, 'foto4.jpg')]);
  await a.waitForSelector('#galleria .foto', { timeout: 20000 });
  await a.click('#link-commessa');
  await a.waitForSelector('#sal .card');
  await nuovoSal('Falegnameria Bianchi (Falegname)');
  ok((await a.textContent('#titolo')).startsWith('SAL n. 2'), 'secondo SAL numero 2');
  ok(Number(await a.inputValue('#f-importi [name=sal_precedenti]')) === 4000, 'SAL precedenti proposti dal SAL 1: 4000');
  await a.fill('#f-sal [name=descrizione]', 'Posa porte e armadio');
  await a.fill('#f-sal [name=avanzamento]', '60');
  await a.fill('#f-importi [name=lavori_eseguiti]', '7200');
  await a.fill('#f-importi [name=ritenuta_perc]', '10');
  await a.fill('#f-importi [name=iva_perc]', '22');
  await a.locator('#f-importi [name=iva_perc]').press('Tab');
  await a.waitForTimeout(900);
  const calc = await a.textContent('#calcolo');
  ok(calc.includes('3.200,00 euro') && calc.includes('3.513,60 euro'), 'calcolo SAL: 3.200,00 di SAL, 3.513,60 totale');
  const db = execSync('psql -h localhost -p 54329 -U postgres -d c360 -At -c "select importo_sal, totale from importi_sal order by aggiornato_il desc limit 1"').toString().trim();
  ok(db === '3200.00|3513.60', 'il database calcola gli stessi importi (' + db + ')');
  await foto(a, 'dl-04-sal-titolare');
  await a.click('#b-pdf');
  await a.waitForSelector('#pronto:not(.nascosto)', { timeout: 30000 });
  const pdfSal = await scarica(a, '#b-scarica');
  ok(testoPdf(pdfSal).includes('3.513,60 euro'), 'PDF SAL del titolare con importi');
  await a.selectOption('#destinatario', 'cliente');
  await a.click('#b-pdf');
  await a.waitForSelector('#pronto:not(.nascosto)');
  ok((await a.textContent('#pronto-testo')).includes('Laura Bianchi'), 'PDF SAL per il committente');
  const idSal = new URL(a.url()).searchParams.get('id');
  await a.click('#link-commessa');
  await a.waitForFunction(() => document.querySelectorAll('#sal .card').length === 2);
  ok((await a.textContent('#sal')).includes('totale 3.513,60 euro'), 'elenco SAL con importi per il titolare');
  await foto(a, 'dl-05-commessa-completa');
  await a.click('nav >> text=Ditte');
  await a.waitForSelector('#elenco .card');
  ok((await a.locator('#elenco .card', { hasText: 'Falegnameria' }).textContent()).includes('In 1 commessa'), 'rubrica: la ditta mostra la commessa in cui lavora');
  await foto(a, 'dl-05b-rubrica-ditte');

  // ===== Collaboratore dello stesso studio: niente importi =====
  const c = await nuovaPagina(browser);
  await c.goto(BASE + 'index.html');
  await c.evaluate(async () => { await sb.auth.signUp({ email: 'collab@prova.invalid', password: 'password123' }); await sb.auth.signOut(); });
  execSync('psql -h localhost -p 54329 -U postgres -d c360 -c "insert into membri (studio_id, utente_id, nome, ruolo) select s.id, u.id, \'Luca Collaboratore\', \'collaboratore\' from studi s, auth.users u where s.nome = \'Studio Rossi Architetti\' and u.email = \'collab@prova.invalid\'"');
  await accedi(c, 'collab@prova.invalid');
  await c.goto(BASE + 'commessa.html?id=' + idCommessa);
  await c.waitForFunction(() => document.querySelectorAll('#sal .card').length === 2);
  ok(!(await c.textContent('#ditte')).includes('contratto') && !(await c.textContent('#sal')).includes('euro'), 'collaboratore: niente importi nella commessa');
  await c.goto(BASE + 'sal.html?id=' + idSal);
  await c.waitForSelector('#galleria [data-elenco]');
  ok(await c.locator('#blocco-importi').isHidden() && await c.locator('#riga-con-importi').isHidden(), 'collaboratore: blocco importi nascosto nel SAL');
  const letti = await c.evaluate(async () => { const r = await sb.from('importi_sal').select('*'); const i = await sb.from('importi_incarico').select('*'); return [r.data.length, i.data.length]; });
  ok(letti[0] === 0 && letti[1] === 0, 'collaboratore: il database non restituisce importi neanche chiamandolo direttamente');
  await c.click('#b-pdf');
  await c.waitForSelector('#pronto:not(.nascosto)', { timeout: 30000 });
  const pdfC = await scarica(c, '#b-scarica');
  ok(!testoPdf(pdfC).includes('euro'), 'collaboratore: PDF SAL senza importi');
  await c.click('#link-commessa');
  await c.waitForSelector('#sopralluoghi .card');
  await c.locator('#ditte .card').first().click();
  ok(await c.locator('#dlg-ditta [data-solo-titolare]').isHidden(), 'collaboratore: campo contratto nascosto');
  await c.locator('#dlg-ditta [data-chiudi]').click();
  await foto(c, 'dl-06-commessa-collaboratore');

  // ===== Studio B: non vede nulla di A =====
  const b = await nuovaPagina(browser);
  await registra(b, 'Studio Verdi Geometri', 'Marco Verdi', 'marco@prova.invalid');
  await b.goto(BASE + 'sopralluogo.html?id=' + idSop);
  await b.waitForFunction(() => /non trovato/.test(document.querySelector('#titolo').textContent));
  await b.goto(BASE + 'sal.html?id=' + idSal);
  await b.waitForFunction(() => /non trovato/.test(document.querySelector('#titolo').textContent));
  ok(true, 'B: sopralluogo e SAL di A non trovati');
  const percorsoA = execSync('psql -h localhost -p 54329 -U postgres -d c360 -At -c "select percorso from allegati limit 1"').toString().trim();
  const tentativi = await b.evaluate(async p => {
    const s = await sb.storage.from('documenti').createSignedUrls([p], 60);
    const up = await sb.storage.from('documenti').upload(p.replace(/[^/]+$/, 'intruso.jpg'), new Blob(['x'], { type: 'image/jpeg' }));
    const tab = await Promise.all(['ditte', 'incarichi', 'sopralluoghi', 'sal', 'allegati', 'allegati_ditte', 'sopralluogo_ditte'].map(t => sb.from(t).select('*').then(r => t + ':' + (r.data ? r.data.length : r.error.message))));
    return { firmato: s.data && s.data[0] && s.data[0].signedUrl, caricato: !up.error, tab };
  }, percorsoA);
  ok(!tentativi.firmato, 'B: nessun link firmato per un file di A');
  ok(!tentativi.caricato, 'B: non carica file nella cartella di A');
  ok(tentativi.tab.every(t => t.endsWith(':0')), 'B: tabelle direzione lavori vuote (' + tentativi.tab.join(', ') + ')');

  // Larghezza telefono: niente scorrimento orizzontale
  for (const u of ['commessa.html?id=' + idCommessa, 'sopralluogo.html?id=' + idSop, 'sal.html?id=' + idSal]) {
    await a.goto(BASE + u); await a.waitForTimeout(800);
    const w = await a.evaluate(() => document.documentElement.scrollWidth);
    if (w > 390) console.log('SCROLL ORIZZONTALE su', u, w);
  }
  await a.goto(BASE + 'sopralluogo.html?id=' + idSop); await a.waitForSelector('#galleria .foto');
  await a.setViewportSize({ width: 1280, height: 900 });
  await foto(a, 'dl-07-sopralluogo-desktop');

  console.log('ERRORI CONSOLE:', errori.length ? '\n' + errori.join('\n') : 'nessuno');
  await browser.close();
})().catch(e => { console.error('FALLITO:', e.message); console.log('ERRORI CONSOLE:', errori.join('\n')); process.exit(1); });
