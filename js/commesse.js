// Cantiere 360° - finestra commessa (nuova o modifica). Richiede comune.js.

let _dlgCommessa = null;

function _creaDialogCommessa() {
  const d = document.createElement('dialog');
  d.id = 'dlg-commessa';
  d.innerHTML =
    '<div class="testa"><h2></h2><button type="button" class="btn-link" data-chiudi>Chiudi</button></div>' +
    '<form class="modulo" method="dialog">' +
    '<div class="griglia"><label class="campo">Codice<input name="codice" maxlength="40"></label>' +
    '<label class="campo">Stato<select name="stato"><option value="attiva">Attiva</option><option value="sospesa">Sospesa</option><option value="chiusa">Chiusa</option></select></label></div>' +
    '<label class="campo">Titolo<input name="titolo" required maxlength="200" placeholder="Es. Ristrutturazione appartamento"></label>' +
    '<label class="campo">Cliente<select name="cliente_id"></select></label>' +
    '<fieldset class="campo" style="border:0;padding:0;margin:0"><legend style="padding:0;margin-bottom:6px">Colore nel riepilogo scadenze</legend><div class="riga" style="justify-content:flex-start" data-colori></div></fieldset>' +
    '<div class="griglia"><label class="campo">Comune<input name="comune" maxlength="120"></label>' +
    '<label class="campo">Indirizzo<input name="indirizzo" maxlength="200"></label></div>' +
    '<div class="griglia"><label class="campo">Foglio<input name="foglio" maxlength="20"></label>' +
    '<label class="campo">Particella<input name="particella" maxlength="20"></label>' +
    '<label class="campo">Sub<input name="sub" maxlength="20"></label></div>' +
    '<label class="campo">Note<textarea name="note"></textarea></label>' +
    '<div class="azioni"><button type="button" class="btn2 nascosto" data-elimina>Elimina commessa</button><button type="submit" class="btn">Salva</button></div></form>';
  document.body.appendChild(d);
  d.querySelector('[data-chiudi]').addEventListener('click', () => d.close());
  d.querySelector('[data-colori]').innerHTML = COLORI_COMMESSA.map((c, i) =>
    '<label style="display:inline-flex;align-items:center;gap:4px;min-height:44px"><input type="radio" name="colore" value="' + c + '"' + (i === 0 ? ' checked' : '') + '>' +
    '<span style="width:22px;height:22px;border-radius:50%;background:' + c + '" aria-label="Colore ' + (i + 1) + '"></span></label>').join('');
  return d;
}

// Proposta di codice: C-<anno>-<progressivo a 3 cifre>
async function _prossimoCodice() {
  const anno = new Date().getFullYear();
  const { data } = await sb.from('commesse').select('codice').like('codice', 'C-' + anno + '-%');
  let max = 0;
  (data || []).forEach(r => { const n = parseInt(String(r.codice).split('-')[2], 10); if (n > max) max = n; });
  return 'C-' + anno + '-' + String(max + 1).padStart(3, '0');
}

// commessa: oggetto esistente oppure null per nuova; alSalvataggio(id)
async function apriFormCommessa(commessa, alSalvataggio) {
  if (!_dlgCommessa) _dlgCommessa = _creaDialogCommessa();
  const d = _dlgCommessa;
  const form = d.querySelector('form');
  d.querySelector('h2').textContent = commessa ? 'Modifica commessa' : 'Nuova commessa';

  const { data: clienti } = await sb.from('clienti').select('id, nome').eq('eliminato', false).order('nome');
  form.elements.cliente_id.innerHTML = '<option value="">Nessun cliente</option>' +
    (clienti || []).map(c => '<option value="' + c.id + '">' + esc(c.nome) + '</option>').join('');

  if (commessa) {
    riempiForm(form, commessa);
  } else {
    form.reset();
    form.elements.codice.value = await _prossimoCodice();
    // Colore: il primo meno usato
    const { data: usati } = await sb.from('commesse').select('colore').eq('eliminato', false).neq('stato', 'chiusa');
    const conta = c => (usati || []).filter(u => u.colore === c).length;
    const colore = COLORI_COMMESSA.slice().sort((a, b) => conta(a) - conta(b))[0];
    form.querySelector('input[name=colore][value="' + colore + '"]').checked = true;
  }
  if (commessa) {
    const r = form.querySelector('input[name=colore][value="' + commessa.colore + '"]');
    if (r) r.checked = true;
  }

  const bElimina = form.querySelector('[data-elimina]');
  bElimina.classList.toggle('nascosto', !commessa);
  bElimina.onclick = async () => {
    if (!confirm('Eliminare la commessa "' + commessa.titolo + '"? Sparirà dagli elenchi insieme alle sue scadenze nel riepilogo.')) return;
    const { error } = await sb.from('commesse').update({ eliminato: true }).eq('id', commessa.id);
    if (error) { mostraErrore(error); return; }
    d.close();
    location.href = 'commesse.html';
  };

  form.onsubmit = async e => {
    e.preventDefault();
    const v = datiForm(form);
    const b = form.querySelector('[type=submit]'); b.disabled = true;
    let res;
    if (commessa) {
      res = await sb.from('commesse').update(v).eq('id', commessa.id).select('id').single();
    } else {
      v.studio_id = C360.studio.id;
      res = await sb.from('commesse').insert(v).select('id').single();
    }
    b.disabled = false;
    if (res.error) { mostraErrore(res.error); return; }
    d.close();
    toast('Commessa salvata');
    if (alSalvataggio) alSalvataggio(res.data.id);
  };
  d.showModal();
}
