// Cantiere 360° - rubrica ditte dello studio e ditte al lavoro in una commessa (incarichi). Richiede comune.js.
// I dati della ditta stanno solo in rubrica; la commessa sceglie la ditta e aggiunge lavorazioni e contratto.
// L'importo del contratto si vede e si scrive solo se si e' titolari (controllo anche sul database).

const SEL_INCARICO = 'id, commessa_id, ditta_id, lavorazioni, ditte(id, nome, mestiere, referente, telefono, email, cf_piva)';
const MESTIERI = ['Impresa edile', 'Muratore', 'Falegname', 'Pittore', 'Idraulico', 'Elettricista', 'Serramentista', 'Piastrellista', 'Cartongessista', 'Fabbro'];

function sonoTitolare() { return C360.membro && C360.membro.ruolo === 'titolare'; }

async function caricaIncarichi(commessaId) {
  const { data, error } = await sb.from('incarichi').select(SEL_INCARICO).eq('commessa_id', commessaId).eq('eliminato', false).order('creato_il');
  if (error) { mostraErrore(error); return []; }
  return data;
}
// Importi contratto per incarico (vuoto se non titolare)
async function caricaImportiIncarichi(ids) {
  if (!sonoTitolare() || !ids.length) return {};
  const { data, error } = await sb.from('importi_incarico').select('incarico_id, importo_contratto').in('incarico_id', ids);
  if (error) { mostraErrore(error); return {}; }
  const out = {}; data.forEach(r => { out[r.incarico_id] = r.importo_contratto; });
  return out;
}

// ---------- Rubrica ditte (pagina Ditte) ----------
let _dlgRubrica = null;
function _creaDialogRubrica() {
  const d = document.createElement('dialog');
  d.id = 'dlg-rubrica-ditta';
  d.innerHTML =
    '<div class="testa"><h2></h2><button type="button" class="btn-link" data-chiudi>Chiudi</button></div>' +
    '<form class="modulo" method="dialog">' +
    '<label class="campo">Nome ditta<input name="nome" required maxlength="200" placeholder="Es. Falegnameria Bianchi"></label>' +
    '<div class="griglia"><label class="campo">Mestiere<input name="mestiere" list="lista-mestieri" maxlength="60"></label>' +
    '<label class="campo">Referente<input name="referente" maxlength="120"></label></div>' +
    '<div class="griglia"><label class="campo">Telefono (per WhatsApp)<input name="telefono" type="tel" maxlength="40"></label>' +
    '<label class="campo">Email<input name="email" type="email" maxlength="200"></label></div>' +
    '<label class="campo">Codice fiscale o partita IVA<input name="cf_piva" maxlength="20" autocapitalize="characters"></label>' +
    '<label class="campo">Note<textarea name="note"></textarea></label>' +
    '<datalist id="lista-mestieri">' + MESTIERI.map(m => '<option value="' + m + '">').join('') + '</datalist>' +
    '<div class="piccolo" data-commesse></div>' +
    '<div class="azioni"><button type="button" class="btn2 nascosto" data-elimina>Elimina ditta</button><button type="submit" class="btn">Salva</button></div></form>';
  document.body.appendChild(d);
  d.querySelector('[data-chiudi]').addEventListener('click', () => d.close());
  return d;
}

// ditta: esistente (con .incarichi) o null per nuova; alSalvataggio(id)
function apriFormRubricaDitta(ditta, alSalvataggio) {
  if (!_dlgRubrica) _dlgRubrica = _creaDialogRubrica();
  const d = _dlgRubrica, form = d.querySelector('form');
  d.querySelector('h2').textContent = ditta ? 'Modifica ditta' : 'Nuova ditta';
  if (ditta) riempiForm(form, ditta); else form.reset();
  const comm = ditta ? (ditta.incarichi || []).filter(i => !i.eliminato && i.commesse && !i.commesse.eliminato) : [];
  d.querySelector('[data-commesse]').innerHTML = comm.length ? 'Lavora in: ' + comm.map(i =>
    '<a href="commessa.html?id=' + i.commesse.id + '">' + esc(i.commesse.codice || i.commesse.titolo) + '</a>').join(', ') : '';
  const bEl = form.querySelector('[data-elimina]');
  bEl.classList.toggle('nascosto', !ditta);
  bEl.onclick = async () => {
    if (!confirm('Eliminare la ditta "' + ditta.nome + '" dalla rubrica? Resta nelle commesse dove ha gia\' lavorato.')) return;
    const { error } = await sb.from('ditte').update({ eliminato: true }).eq('id', ditta.id);
    if (error) { mostraErrore(error); return; }
    d.close();
    toast('Ditta eliminata');
    if (alSalvataggio) alSalvataggio(null);
  };
  form.onsubmit = async e => {
    e.preventDefault();
    const v = datiForm(form);
    const res = ditta
      ? await sb.from('ditte').update(v).eq('id', ditta.id).select('id').single()
      : await sb.from('ditte').insert(Object.assign(v, { studio_id: C360.studio.id })).select('id').single();
    if (res.error) { mostraErrore(res.error); return; }
    d.close();
    toast('Ditta salvata');
    if (alSalvataggio) alSalvataggio(res.data.id);
  };
  d.showModal();
}

// ---------- Ditta in una commessa: si sceglie dalla rubrica ----------
let _dlgDitta = null;
function _creaDialogDitta() {
  const d = document.createElement('dialog');
  d.id = 'dlg-ditta';
  d.innerHTML =
    '<div class="testa"><h2></h2><button type="button" class="btn-link" data-chiudi>Chiudi</button></div>' +
    '<form class="modulo" method="dialog">' +
    '<div class="riga" data-scelta style="align-items:flex-end"><label class="campo" style="flex:1;min-width:180px">Ditta dalla rubrica<select name="ditta_id"></select></label>' +
    '<button type="button" class="btn2" data-nuova>+ Nuova in rubrica</button></div>' +
    '<div class="card" data-scheda style="background:var(--tenue)"></div>' +
    '<label class="campo">Lavorazioni in questa commessa<textarea name="lavorazioni" placeholder="Es. Porte interne e armadio a muro"></textarea></label>' +
    '<label class="campo" data-solo-titolare>Importo del contratto (euro, visibile solo al titolare)<input name="importo_contratto" type="number" min="0" step="0.01" inputmode="decimal"></label>' +
    '<div class="azioni"><button type="button" class="btn2 nascosto" data-togli>Togli dalla commessa</button><button type="submit" class="btn">Salva</button></div></form>';
  document.body.appendChild(d);
  d.querySelector('[data-chiudi]').addEventListener('click', () => d.close());
  return d;
}
function _schedaDitta(x) {
  if (!x) return '<div class="piccolo">Scegli una ditta: i suoi dati arrivano dalla rubrica.</div>';
  return '<div><b>' + esc(x.nome) + '</b>' + (x.mestiere ? ' <span class="badge">' + esc(x.mestiere) + '</span>' : '') + '</div>' +
    '<div class="piccolo">' + [x.referente, x.telefono, x.email, x.cf_piva].filter(Boolean).map(esc).join(' &middot; ') + '</div>' +
    '<div class="piccolo">I dati si modificano nella <a href="ditte.html#' + x.id + '">rubrica ditte</a>.</div>';
}

// incarico: esistente (con .ditte) o null per aggiungere una ditta; importo: importo contratto attuale
async function apriFormDitta(incarico, commessaId, importo, alSalvataggio) {
  if (!_dlgDitta) _dlgDitta = _creaDialogDitta();
  const d = _dlgDitta, form = d.querySelector('form');
  form.reset();
  d.querySelector('h2').textContent = incarico ? 'Ditta in commessa' : 'Aggiungi ditta';
  form.querySelector('[data-solo-titolare]').classList.toggle('nascosto', !sonoTitolare());
  const sel = form.elements.ditta_id, scheda = form.querySelector('[data-scheda]');
  form.querySelector('[data-scelta]').classList.toggle('nascosto', !!incarico);
  let rubrica = [];

  async function riempiScelta(daScegliere) {
    const [{ data }, gia] = await Promise.all([
      sb.from('ditte').select('id, nome, mestiere, referente, telefono, email, cf_piva').eq('eliminato', false).order('nome'),
      caricaIncarichi(commessaId)
    ]);
    const usate = new Set(gia.map(i => i.ditta_id));
    rubrica = (data || []).filter(x => !usate.has(x.id));
    sel.innerHTML = '<option value="">' + (rubrica.length ? 'Scegli...' : 'Rubrica vuota: aggiungi una ditta') + '</option>' +
      rubrica.map(x => '<option value="' + x.id + '">' + esc(x.nome + (x.mestiere ? ' (' + x.mestiere + ')' : '')) + '</option>').join('');
    sel.value = daScegliere || '';
    scheda.innerHTML = _schedaDitta(rubrica.find(x => x.id === sel.value));
  }
  if (incarico) {
    riempiForm(form, { lavorazioni: incarico.lavorazioni, importo_contratto: importo });
    scheda.innerHTML = _schedaDitta(incarico.ditte);
  } else {
    await riempiScelta();
    sel.onchange = () => { scheda.innerHTML = _schedaDitta(rubrica.find(x => x.id === sel.value)); };
    // Ditta nuova: si crea in rubrica e torna gia' scelta
    form.querySelector('[data-nuova]').onclick = () => apriFormRubricaDitta(null, id => { if (id) riempiScelta(id); });
  }

  const bTogli = form.querySelector('[data-togli]');
  bTogli.classList.toggle('nascosto', !incarico);
  bTogli.onclick = async () => {
    if (!confirm('Togliere ' + incarico.ditte.nome + ' da questa commessa? SAL e foto restano in archivio.')) return;
    const { error } = await sb.from('incarichi').update({ eliminato: true }).eq('id', incarico.id);
    if (error) { mostraErrore(error); return; }
    d.close();
    if (alSalvataggio) alSalvataggio();
  };

  form.onsubmit = async e => {
    e.preventDefault();
    const v = datiForm(form);
    if (!incarico && !v.ditta_id) { toast('Scegli una ditta dalla rubrica'); return; }
    const b = form.querySelector('[type=submit]'); b.disabled = true;
    try {
      let incId = incarico && incarico.id;
      if (incarico) {
        const r = await sb.from('incarichi').update({ lavorazioni: v.lavorazioni }).eq('id', incId); if (r.error) throw r.error;
      } else {
        const r = await sb.from('incarichi').insert({ studio_id: C360.studio.id, commessa_id: commessaId, ditta_id: v.ditta_id, lavorazioni: v.lavorazioni }).select('id').single();
        if (r.error) throw r.error;
        incId = r.data.id;
      }
      if (sonoTitolare() && (v.importo_contratto != null || importo != null)) {
        const r = await sb.from('importi_incarico').upsert({ incarico_id: incId, studio_id: C360.studio.id, importo_contratto: v.importo_contratto }, { onConflict: 'incarico_id' });
        if (r.error) throw r.error;
      }
      d.close();
      toast('Ditta salvata');
      if (alSalvataggio) alSalvataggio(incId);
    } catch (err) { mostraErrore(err); }
    b.disabled = false;
  };
  d.showModal();
}
