// Cantiere 360° - finestra pratica (nuova o modifica). Richiede comune.js.

let _dlgPratica = null;

function _creaDialogPratica() {
  const d = document.createElement('dialog');
  d.id = 'dlg-pratica';
  d.innerHTML =
    '<div class="testa"><h2></h2><button type="button" class="btn-link" data-chiudi>Chiudi</button></div>' +
    '<form class="modulo" method="dialog">' +
    '<div class="griglia"><label class="campo">Tipo<select name="tipo_id"></select></label>' +
    '<label class="campo" data-solo-nuova>Stato iniziale<select name="stato_id"></select></label></div>' +
    '<label class="campo">Oggetto<input name="oggetto" required maxlength="200" placeholder="Es. Diversa distribuzione interna"></label>' +
    '<div class="griglia"><label class="campo">Protocollo<input name="protocollo" maxlength="60"></label>' +
    '<label class="campo">Presentata il<input name="data_presentazione" type="date"></label></div>' +
    '<div class="griglia"><label class="campo">Codice interno<input name="codice_interno" maxlength="40"></label>' +
    '<label class="campo">Responsabile<select name="responsabile_id"></select></label></div>' +
    '<label class="campo">Note<textarea name="note"></textarea></label>' +
    '<div class="azioni"><button type="button" class="btn2 nascosto" data-elimina>Elimina pratica</button><button type="submit" class="btn">Salva</button></div></form>';
  document.body.appendChild(d);
  d.querySelector('[data-chiudi]').addEventListener('click', () => d.close());
  return d;
}

// pratica: oggetto esistente o null; commessaId obbligatorio per la nuova; alSalvataggio(id)
async function apriFormPratica(pratica, commessaId, alSalvataggio) {
  if (!_dlgPratica) _dlgPratica = _creaDialogPratica();
  const d = _dlgPratica;
  const form = d.querySelector('form');
  d.querySelector('h2').textContent = pratica ? 'Modifica pratica' : 'Nuova pratica';

  const [{ data: tipi }, { data: stati }, { data: membri }] = await Promise.all([
    sb.from('tipi_pratica').select('id, nome').eq('attivo', true).order('ordine'),
    sb.from('stati_pratica').select('id, nome').eq('attivo', true).order('ordine'),
    sb.from('membri').select('id, nome').eq('attivo', true).order('nome')
  ]);
  form.elements.tipo_id.innerHTML = '<option value="">Non indicato</option>' + (tipi || []).map(t => '<option value="' + t.id + '">' + esc(t.nome) + '</option>').join('');
  form.elements.stato_id.innerHTML = (stati || []).map(s => '<option value="' + s.id + '">' + esc(s.nome) + '</option>').join('');
  form.elements.responsabile_id.innerHTML = '<option value="">Nessuno</option>' + (membri || []).map(m => '<option value="' + m.id + '">' + esc(m.nome || 'Senza nome') + '</option>').join('');

  // Lo stato di una pratica esistente si cambia dalla scheda (cosi' finisce nello storico)
  form.querySelector('[data-solo-nuova]').classList.toggle('nascosto', !!pratica);
  form.elements.stato_id.disabled = !!pratica;

  if (pratica) riempiForm(form, pratica);
  else { form.reset(); form.elements.responsabile_id.value = C360.membro.id; }

  const bElimina = form.querySelector('[data-elimina]');
  bElimina.classList.toggle('nascosto', !pratica);
  bElimina.onclick = async () => {
    if (!confirm('Eliminare la pratica "' + pratica.oggetto + '"?')) return;
    const { error } = await sb.from('pratiche').update({ eliminato: true }).eq('id', pratica.id);
    if (error) { mostraErrore(error); return; }
    d.close();
    location.href = 'commessa.html?id=' + pratica.commessa_id;
  };

  form.onsubmit = async e => {
    e.preventDefault();
    const v = datiForm(form);
    const b = form.querySelector('[type=submit]'); b.disabled = true;
    let res;
    if (pratica) {
      res = await sb.from('pratiche').update(v).eq('id', pratica.id).select('id').single();
    } else {
      v.studio_id = C360.studio.id;
      v.commessa_id = commessaId;
      res = await sb.from('pratiche').insert(v).select('id').single();
    }
    b.disabled = false;
    if (res.error) { mostraErrore(res.error); return; }
    d.close();
    toast('Pratica salvata');
    if (alSalvataggio) alSalvataggio(res.data.id);
  };
  d.showModal();
}
