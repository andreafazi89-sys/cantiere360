const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const SBJS = fs.readFileSync(process.env.SBJS, 'utf8');
const SHOTS = process.env.SHOTS;
const BASE = 'http://localhost:54331/';
const errori = [];

async function nuovaPagina(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ body: SBJS, contentType: 'text/javascript' }));
  await page.route('https://fonts.googleapis.com/**', r => r.abort());
  await page.route('https://fonts.gstatic.com/**', r => r.abort());
  await page.route('https://wblgaanxwirmxsawvnjm.supabase.co/**', async r => {
    const u = new URL(r.request().url());
    const resp = await r.fetch({ url: 'http://localhost:54331' + u.pathname + u.search });
    await r.fulfill({ response: resp });
  });
  page.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_FAILED/.test(m.text())) errori.push(page.url() + ' | ' + m.text()); });
  page.on('pageerror', e => errori.push(page.url() + ' | PAGEERROR ' + e.message));
  page.on('dialog', d => d.accept(d.defaultValue ? 'CILA (modificata)' : undefined));
  return page;
}
const foto = (p, n) => p.screenshot({ path: SHOTS + '/' + n + '.png', fullPage: true });
function data(giorni) { const d = new Date(); d.setDate(d.getDate() + giorni); return d.toISOString().slice(0, 10); }

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
  await page.waitForSelector('#elenco .vuoto');
}

async function nuovaScadenza(page, descr, giorni) {
  await page.click('#b-scadenza, #b-nuova');
  const d = page.locator('#dlg-scadenza');
  await d.locator('[name=descrizione]').fill(descr);
  await d.locator('[name=data]').fill(data(giorni));
  await d.locator('button[type=submit]').click();
  await page.waitForSelector('#dlg-scadenza:not([open])', { state: 'attached' });
}

(async () => {
  const browser = await chromium.launch();
  // ===== Studio A =====
  const a = await nuovaPagina(browser);
  await registra(a, 'Studio Rossi Architetti', 'Giulia Rossi', 'giulia@prova.invalid');
  await foto(a, '01-scadenze-vuota');

  // Cliente
  await a.click('nav >> text=Clienti');
  await a.click('#b-nuovo');
  await a.fill('#f-cliente [name=nome]', 'Laura Bianchi');
  await a.fill('#f-cliente [name=telefono]', '333 0000000');
  await a.click('#f-cliente button[type=submit]');
  await a.waitForSelector('#elenco .card');

  // Commessa 1
  await a.click('nav >> text=Commesse');
  await a.click('#b-nuova');
  const dc = a.locator('#dlg-commessa');
  await dc.locator('[name=titolo]').fill('Ristrutturazione appartamento');
  await dc.locator('[name=cliente_id]').selectOption({ label: 'Laura Bianchi' });
  await dc.locator('[name=comune]').fill('Roma');
  await dc.locator('[name=foglio]').fill('412');
  await dc.locator('button[type=submit]').click();
  await a.waitForURL('**/commessa.html?id=*');
  await a.waitForSelector('#dati dt');

  // Pratica
  await a.click('#b-pratica');
  const dp = a.locator('#dlg-pratica');
  await dp.locator('[name=tipo_id]').selectOption({ label: 'CILA' });
  await dp.locator('[name=oggetto]').fill('Diversa distribuzione interna');
  await dp.locator('button[type=submit]').click();
  await a.waitForURL('**/pratica.html?id=*');
  await a.waitForSelector('#passi .passo.ora');
  await a.click('#f-stato button[type=submit]');   // -> Presentata
  await a.waitForFunction(() => document.querySelectorAll('#storico > div').length === 2);
  await nuovaScadenza(a, 'Inizio lavori entro', 5);
  await a.waitForSelector('#scadenze .scad');
  await foto(a, '02-pratica');

  // Torno alla commessa e aggiungo scadenza scaduta senza pratica
  await a.click('#link-commessa');
  await a.waitForSelector('#pratiche .card');
  await nuovaScadenza(a, 'Consegna rilievo al cliente', -3);
  await a.waitForFunction(() => document.querySelectorAll('#scadenze .scad').length === 2);
  await foto(a, '03-commessa');

  // Commessa 2
  await a.click('nav >> text=Commesse');
  await a.click('#b-nuova');
  await dc.locator('[name=titolo]').fill('Frazionamento unita commerciale');
  await dc.locator('[name=comune]').fill('Fiumicino');
  await dc.locator('button[type=submit]').click();
  await a.waitForURL('**/commessa.html?id=*');
  await a.waitForSelector('#dati dt');
  await nuovaScadenza(a, 'Integrazione documentale', 20);
  await nuovaScadenza(a, 'Sopralluogo con tecnico comunale', 45);
  await a.waitForFunction(() => document.querySelectorAll('#scadenze .scad').length === 2);

  // Elenco commesse
  await a.click('nav >> text=Commesse');
  await a.waitForSelector('#elenco .card');
  await foto(a, '04-commesse');

  // Riepilogo scadenze
  await a.click('nav >> text=Scadenze');
  await a.waitForSelector('#elenco .scad');
  const cont = await a.$$eval('.contatori b', bs => bs.map(b => b.textContent));
  console.log('contatori (scadute, 7gg, 30gg):', cont.join(', '));
  await foto(a, '05-scadenze-per-data');
  await a.click('[data-vista=commessa]');
  await a.waitForSelector('details.gruppo');
  console.log('gruppi per commessa:', await a.$$eval('details.gruppo summary', s => s.map(x => x.textContent.replace(/\s+/g, ' ').trim())));
  await foto(a, '06-scadenze-per-commessa');
  // Spunta la scaduta
  await a.click('[data-vista=data]');
  const prima = a.locator('.scad').first();
  await prima.locator('input[type=checkbox]').check();
  await a.waitForFunction(() => document.querySelector('#n-scadute').textContent === '0');
  console.log('dopo spunta, scadute:', await a.textContent('#n-scadute'));
  // Filtro commessa
  const opz = await a.$$eval('#f-commessa option', o => o.map(x => x.value).filter(Boolean));
  await a.selectOption('#f-commessa', opz[0]);
  console.log('righe con filtro commessa:', await a.locator('#elenco .scad').count());
  await a.selectOption('#f-commessa', '');

  // Studio
  await a.click('nav >> text=Studio');
  await a.waitForSelector('#tipi .riga');
  await a.locator('#tipi [data-rinomina]').first().click();
  await a.waitForFunction(() => document.querySelector('#tipi').textContent.includes('CILA (modificata)'));
  await foto(a, '07-studio');

  // ===== Studio B: non deve vedere nulla di A =====
  const b = await nuovaPagina(browser);
  await registra(b, 'Studio Verdi Geometri', 'Marco Verdi', 'marco@prova.invalid');
  console.log('B scadenze:', await b.textContent('#titolo-elenco'));
  await b.click('nav >> text=Commesse');
  await b.waitForSelector('#elenco .vuoto');
  console.log('B commesse:', await b.textContent('#conteggio'));
  await b.click('nav >> text=Clienti');
  await b.waitForSelector('#elenco .vuoto');
  console.log('B clienti:', await b.textContent('#conteggio'));
  // B prova ad aprire una commessa di A per id
  const idA = new URL(a.url()).searchParams.get('id') || (await (async () => { await a.click('nav >> text=Commesse'); await a.waitForSelector('#elenco .card'); return new URL(await a.locator('#elenco .card').first().getAttribute('href'), BASE).searchParams.get('id'); })());
  await b.goto(BASE + 'commessa.html?id=' + idA);
  await b.waitForSelector('#dati dd');
  console.log('B apre commessa di A:', await b.textContent('#dati'));
  await b.click('nav >> text=Studio');
  await b.waitForSelector('#tipi .riga');
  console.log('B primo tipo:', (await b.locator('#tipi .riga span').first().textContent()));

  // Logout e login di A
  await a.click('nav >> text=Studio');
  await a.click('#b-esci');
  await a.waitForURL('**/index.html');
  await a.fill('#f-accedi [name=email]', 'giulia@prova.invalid');
  await a.fill('#f-accedi [name=password]', 'sbagliata');
  await a.click('#f-accedi button[type=submit]');
  await a.waitForSelector('#msg.errore');
  console.log('password errata:', await a.textContent('#msg'));
  await a.fill('#f-accedi [name=password]', 'password123');
  await a.click('#f-accedi button[type=submit]');
  await a.waitForURL('**/scadenze.html');
  console.log('login A ok');

  // Larghezza desktop
  await a.setViewportSize({ width: 1280, height: 800 });
  await a.waitForSelector('#elenco .scad');
  await foto(a, '08-scadenze-desktop');
  // Scroll orizzontale a 390?
  await a.setViewportSize({ width: 390, height: 844 });
  for (const p of ['scadenze', 'commesse', 'clienti', 'studio']) {
    await a.goto(BASE + p + '.html'); await a.waitForTimeout(400);
    const w = await a.evaluate(() => document.documentElement.scrollWidth);
    if (w > 390) console.log('SCROLL ORIZZONTALE su', p, w);
  }
  console.log('ERRORI CONSOLE:', errori.length ? '\n' + errori.join('\n') : 'nessuno');
  await browser.close();
})().catch(e => { console.error('FALLITO:', e.message); console.log('ERRORI CONSOLE:', errori.join('\n')); process.exit(1); });
