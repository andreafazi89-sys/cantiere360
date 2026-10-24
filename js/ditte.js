// Cantiere 360° - ditte al lavoro in una commessa (incarichi) e rubrica ditte. Richiede comune.js.
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

let _dlgDitta = null;
function _creaDialogDitta() {
  const d = document.createElement('dialog');
  d.id = 'dlg-ditta';
  d.innerHTML =
    '<div class="testa"><h2></h2><button type="button" class="btn-link" data-chiudi>Chiudi</button></div>' +
    '<form class="modulo" method="dialog">' +
    '<label class="campo" data-scelta>Ditta<select name="ditta_id"></select></label>' +
    '<div data-nuova class="modulo">' +
    '<label class="campo">Nome ditta<input name="nome" maxlength="200" placeholder="Es. Falegnameria Bianchi"></label>' +
    '<div class="griglia"><label class="campo">Mestiere<input name="mestiere" list="lista-mestieri" maxlength="60"></label>' +
    '<label class="campo">Referente<input name="referente" maxlength="120"></label></div>' +
    '<div class="griglia"><label class="campo">Telefono (per WhatsApp)<input name="telefono" type="tel" maxlength="40"></label>' +
    '<label class="campo">Email<input name="email" type="email" maxlength="200"></label></div>' +
    '<label class="campo">Codice fiscale o partita IVA<input name="cf_piva" maxlength="20"></label></div>' +
    '<label class="campo">Lavorazioni in questa commessa<textarea name="lavorazioni" placeholder="Es. Porte interne e armadio a muro"></textarea></label>' +
    '<label class="campo" data-solo-titolare>Importo del contratto (euro, visibile solo al titolare)<input name="importo_contratto" type="number" min="0" step="0.01" inputmode="decimal"></label>' +
    '<datalist id="lista-mestieri">' + MESTIERI.map(m => '<option value="' + m + '">').join('') + '</datalist>' +
    '<div class="azioni"><button type="button" class="btn2 nascosto" data-togli>Togli dalla commessa</button><button type="submit" class="btn">Salva</button></div></form>';
  document.body.appendChild(d);
  d.querySelector('[data-chiudi]').addEventListener('click', () => d.close());
  return d;
}

// incarico: esistente (con .ditte) o null per aggiungere una ditta; importo: importo contratto attuale
async function apriFormDitta(incarico, commessaId, importo, alSalvataggio) {
  if (!_dlgDitta) _dlgDitta = _creaDialogDitta();
  const d = _dlgDitta, form = d.querySelector('form');
  form.reset();
  d.querySelector('h2').textContent = incarico ? 'Ditta in commessa' : 'Aggiungi ditta';
  form.querySelector('[data-solo-titolare]').classList.toggle('nascosto', !sonoTitolare());

  const sel = form.elements.ditta_id;
  const scelta = form.querySelector('[data-scelta]'), nuova = form.querySelector('[data-nuova]');
  if (incarico) {
    scelta.classList.add('nascosto');
    nuova.classList.remove('nascosto');
    riempiForm(form, Object.assign({}, incarico.ditte, { lavorazioni: incarico.lavorazioni, importo_contratto: importo }));
  } else {
    // Ditte della rubrica non ancora in questa commessa
    const [{ data: ditte }, gia] = await Promise.all([
      sb.from('ditte').select('id, nome, mestiere').eq('eliminato', false).order('nome'),
      caricaIncarichi(commessaId)
    ]);
    const usate = new Set(gia.map(i => i.ditta_id));
    sel.innerHTML = '<option value="">Nuova ditta</option>' + (ditte || []).filter(x => !usate.has(x.id))
      .map(x => '<option value="' + x.id + '">' + esc(x.nome + (x.mestiere ? ' (' + x.mestiere + ')' : '')) + '</option>').join('');
    scelta.classList.toggle('nascosto', sel.options.length < 2);
    nuova.classList.remove('nascosto');
    sel.onchange = () => nuova.classList.toggle('nascosto', !!sel.value);
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
    const daRubrica = !incarico && v.ditta_id;
    if (!daRubrica && !v.nome) { toast('Scrivi il nome della ditta'); return; }
    const b = form.querySelector('[type=submit]'); b.disabled = true;
    try {
      const datiDitta = { nome: v.nome, mestiere: v.mestiere, referente: v.referente, telefono: v.telefono, email: v.email, cf_piva: v.cf_piva };
      let dittaId = incarico ? incarico.ditta_id : v.ditta_id;
      if (incarico) {
        const r = await sb.from('ditte').update(datiDitta).eq('id', dittaId); if (r.error) throw r.error;
      } else if (!dittaId) {
        const r = await sb.from('ditte').insert(Object.assign({ studio_id: C360.studio.id }, datiDitta)).select('id').single(); if (r.error) throw r.error;
        dittaId = r.data.id;
      }
      let incId = incarico && incarico.id;
      if (incarico) {
        const r = await sb.from('incarichi').update({ lavorazioni: v.lavorazioni }).eq('id', incId); if (r.error) throw r.error;
      } else {
        const r = await sb.from('incarichi').insert({ studio_id: C360.studio.id, commessa_id: commessaId, ditta_id: dittaId, lavorazioni: v.lavorazioni }).select('id').single();
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
