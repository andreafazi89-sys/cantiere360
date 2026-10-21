// Cantiere 360° - scadenze: lettura, riga, spunta, finestra di inserimento.
// Usato da scadenze.html, commessa.html, pratica.html. Richiede comune.js.

const SEL_SCADENZA = 'id, descrizione, data, fatta, fatta_il, note, commessa_id, pratica_id, responsabile_id,' +
  ' commesse(id, codice, titolo, colore, eliminato), pratiche(id, oggetto, eliminato, tipi_pratica(nome)), membri(id, nome)';

// filtro: { commessa_id, pratica_id, fatteGiorni } - fatteGiorni: quante giornate indietro mostrare le fatte
async function caricaScadenze(filtro = {}) {
  let q = sb.from('scadenze').select(SEL_SCADENZA).eq('eliminato', false).order('data').order('creato_il');
  if (filtro.commessa_id) q = q.eq('commessa_id', filtro.commessa_id);
  if (filtro.pratica_id) q = q.eq('pratica_id', filtro.pratica_id);
  if (filtro.fatteGiorni != null) {
    const d = new Date(); d.setDate(d.getDate() - filtro.fatteGiorni);
    const da = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    q = q.or('fatta.eq.false,fatta_il.gte.' + da);
  }
  const { data, error } = await q;
  if (error) { mostraErrore(error); return []; }
  // Nascoste anche le scadenze di commesse o pratiche eliminate
  return data.filter(s => !(s.commesse && s.commesse.eliminato) && !(s.pratiche && s.pratiche.eliminato));
}

// opz: { commessa: true/false (mostra etichetta commessa), pratica: true/false }
function rigaScadenza(s, opz = {}) {
  const sotto = [];
  if (opz.commessa !== false && s.commesse) sotto.push(etichettaCommessa(s.commesse));
  if (opz.pratica !== false && s.pratiche) {
    const tipo = s.pratiche.tipi_pratica ? s.pratiche.tipi_pratica.nome + ': ' : '';
    sotto.push('<a class="piccolo" href="pratica.html?id=' + s.pratiche.id + '">' + esc(tipo + s.pratiche.oggetto) + '</a>');
  }
  if (s.membri && s.membri.nome) sotto.push('<span class="piccolo">' + esc(s.membri.nome) + '</span>');
  return '<div class="scad' + (s.fatta ? ' fatta' : '') + '" data-id="' + s.id + '">' +
    '<div class="data ' + classeData(s.data, s.fatta) + '">' + fmtData(s.data) +
    '<div class="piccolo">' + (s.fatta ? 'fatta' : quando(s.data)) + '</div></div>' +
    '<div class="corpo"><div class="testo">' + esc(s.descrizione) + '</div>' +
    (sotto.length ? '<div class="riga" style="justify-content:flex-start;gap:8px">' + sotto.join('') + '</div>' : '') +
    (s.note ? '<div class="piccolo">' + esc(s.note) + '</div>' : '') + '</div>' +
    '<label class="spunta" title="Segna come fatta"><span class="nascosto">Fatta</span>' +
    '<input type="checkbox" data-fatta="' + s.id + '"' + (s.fatta ? ' checked' : '') + '></label></div>';
}

// Collega le spunte "fatta" dentro un contenitore; dopo il salvataggio chiama ricarica()
function collegaSpunte(contenitore, ricarica) {
  contenitore.addEventListener('change', async e => {
    const id = e.target.dataset && e.target.dataset.fatta;
    if (!id) return;
    e.target.disabled = true;
    const { error } = await sb.from('scadenze').update({ fatta: e.target.checked }).eq('id', id);
    if (error) { e.target.checked = !e.target.checked; e.target.disabled = false; mostraErrore(error); return; }
    toast(e.target.checked ? 'Scadenza fatta' : 'Scadenza riaperta');
    ricarica();
  });
}

// ---------- Finestra nuova scadenza ----------
let _dlgScadenza = null;

function _creaDialogScadenza() {
  const d = document.createElement('dialog');
  d.id = 'dlg-scadenza';
  d.innerHTML =
    '<div class="testa"><h2>Nuova scadenza</h2><button type="button" class="btn-link" data-chiudi>Chiudi</button></div>' +
    '<form class="modulo" method="dialog">' +
    '<label class="campo">Commessa<select name="commessa_id" required></select></label>' +
    '<label class="campo">Pratica (facoltativa)<select name="pratica_id"><option value="">Nessuna</option></select></label>' +
    '<label class="campo">Cosa scade<input name="descrizione" required maxlength="200"></label>' +
    '<div class="griglia"><label class="campo">Data<input name="data" type="date" required></label>' +
    '<label class="campo">Responsabile<select name="responsabile_id"><option value="">Nessuno</option></select></label></div>' +
    '<label class="campo">Note<textarea name="note"></textarea></label>' +
    '<div class="azioni"><button type="submit" class="btn">Salva scadenza</button></div></form>';
  document.body.appendChild(d);
  d.querySelector('[data-chiudi]').addEventListener('click', () => d.close());
  d.querySelector('[name=commessa_id]').addEventListener('change', e => _caricaPraticheDialog(e.target.value, null));
  return d;
}

async function _caricaPraticheDialog(commessaId, praticaId) {
  const sel = _dlgScadenza.querySelector('[name=pratica_id]');
  sel.innerHTML = '<option value="">Nessuna</option>';
  if (!commessaId) return;
  const { data } = await sb.from('pratiche').select('id, oggetto, tipi_pratica(nome)')
    .eq('commessa_id', commessaId).eq('eliminato', false).order('creato_il');
  (data || []).forEach(p => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = (p.tipi_pratica ? p.tipi_pratica.nome + ': ' : '') + p.oggetto;
    sel.appendChild(o);
  });
  if (praticaId) sel.value = praticaId;
}

// preset: { commessa_id, pratica_id }; alSalvataggio: callback
async function apriNuovaScadenza(preset = {}, alSalvataggio) {
  if (!_dlgScadenza) _dlgScadenza = _creaDialogScadenza();
  const d = _dlgScadenza;
  const form = d.querySelector('form');
  form.reset();

  const [{ data: commesse }, { data: membri }] = await Promise.all([
    sb.from('commesse').select('id, codice, titolo').eq('eliminato', false).neq('stato', 'chiusa').order('codice'),
    sb.from('membri').select('id, nome').eq('attivo', true).order('nome')
  ]);
  const selC = form.elements.commessa_id;
  selC.innerHTML = '<option value="">Scegli...</option>' + (commesse || []).map(c =>
    '<option value="' + c.id + '">' + esc((c.codice ? c.codice + ' - ' : '') + c.titolo) + '</option>').join('');
  const selM = form.elements.responsabile_id;
  selM.innerHTML = '<option value="">Nessuno</option>' + (membri || []).map(m =>
    '<option value="' + m.id + '">' + esc(m.nome || 'Senza nome') + '</option>').join('');
  selM.value = C360.membro ? C360.membro.id : '';

  if (preset.commessa_id) selC.value = preset.commessa_id;
  await _caricaPraticheDialog(preset.commessa_id, preset.pratica_id);
  // Se arrivo da una commessa o pratica, la commessa e' fissa
  selC.disabled = !!preset.commessa_id;
  form.elements.pratica_id.disabled = !!preset.pratica_id;

  form.onsubmit = async e => {
    e.preventDefault();
    const v = datiForm(form);
    const riga = {
      studio_id: C360.studio.id,
      commessa_id: preset.commessa_id || v.commessa_id,
      pratica_id: preset.pratica_id || v.pratica_id,
      descrizione: v.descrizione,
      data: v.data,
      responsabile_id: v.responsabile_id,
      note: v.note
    };
    const b = form.querySelector('[type=submit]'); b.disabled = true;
    const { error } = await sb.from('scadenze').insert(riga);
    b.disabled = false;
    if (error) { mostraErrore(error); return; }
    d.close();
    toast('Scadenza salvata');
    if (alSalvataggio) alSalvataggio();
  };
  d.showModal();
}
