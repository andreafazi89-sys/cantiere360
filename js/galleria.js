// Cantiere 360° - pannello foto e note vocali di un sopralluogo o di un SAL. Richiede comune.js e allegati.js.
// opz: { el, elAudio, rif: { commessa_id, sopralluogo_id | sal_id }, cartella, incarichi (solo sopralluogo: foto per ditta) }

function creaGalleria(opz) {
  const G = { allegati: [], ditte: {}, link: {} };
  const campoRif = opz.rif.sopralluogo_id ? 'sopralluogo_id' : 'sal_id';
  const idRif = opz.rif[campoRif];
  const incarichi = opz.incarichi || [];

  opz.el.innerHTML =
    '<div class="foto-azioni">' +
    '<button type="button" class="btn2" data-a="scatta">Scatta foto</button>' +
    '<button type="button" class="btn2" data-a="raffica">Scatto a raffica</button>' +
    '<button type="button" class="btn2" data-a="galleria">Dalla galleria</button>' +
    '<button type="button" class="btn2" data-a="schizzo">Schizzo</button></div>' +
    '<input type="file" accept="image/*" capture="environment" multiple class="nascosto" data-in="scatta">' +
    '<input type="file" accept="image/*" multiple class="nascosto" data-in="galleria">' +
    '<div class="piccolo" data-stato></div>' +
    '<div class="foto-elenco" data-elenco></div>';
  const $g = s => opz.el.querySelector(s);

  G.foto = () => G.allegati.filter(a => a.tipo !== 'audio');
  G.audio = () => G.allegati.filter(a => a.tipo === 'audio');
  // Foto assegnate a una ditta (incarico), nell'ordine della scheda
  G.fotoPerDitta = incId => G.foto().filter(a => (G.ditte[a.id] || new Set()).has(incId));

  G.carica = async function () {
    const [{ data, error }, ass] = await Promise.all([
      sb.from('allegati').select('*').eq(campoRif, idRif).eq('eliminato', false).order('ordine').order('creato_il'),
      incarichi.length ? sb.from('allegati_ditte').select('allegato_id, incarico_id').eq('commessa_id', opz.rif.commessa_id).eq('eliminato', false) : Promise.resolve({ data: [] })
    ]);
    if (error) { mostraErrore(error); return; }
    G.allegati = data;
    G.ditte = {};
    (ass.data || []).forEach(r => { (G.ditte[r.allegato_id] = G.ditte[r.allegato_id] || new Set()).add(r.incarico_id); });
    G.link = await linkFirmati(data.map(a => a.percorso));
    disegna();
    if (opz.elAudio) disegnaAudio();
  };

  function disegna() {
    const foto = G.foto();
    $g('[data-elenco]').innerHTML = foto.length ? foto.map((a, i) => {
      const chips = incarichi.map(inc => {
        const on = (G.ditte[a.id] || new Set()).has(inc.id);
        return '<button type="button" class="chip' + (on ? ' on' : '') + '" aria-pressed="' + on + '" data-ditta="' + inc.id + '">' + esc(inc.ditte.mestiere || inc.ditte.nome) + '</button>';
      }).join('');
      return '<div class="foto" data-id="' + a.id + '">' +
        '<div class="img"><img loading="lazy" alt="Foto ' + (i + 1) + '" src="' + esc(G.link[a.percorso] || '') + '"><span class="num">' + (i + 1) + (a.tipo === 'schizzo' ? ' schizzo' : '') + '</span></div>' +
        '<div class="corpo"><input data-didascalia placeholder="Didascalia" maxlength="200" value="' + esc(a.didascalia || '') + '">' +
        (chips ? '<div class="chips" title="Ditte a cui mandare la foto">' + chips + '</div>' : '') +
        '<div class="comandi">' +
        (i > 0 ? '<button type="button" data-sposta="-1" aria-label="Sposta prima">&larr;</button>' : '') +
        (i < foto.length - 1 ? '<button type="button" data-sposta="1" aria-label="Sposta dopo">&rarr;</button>' : '') +
        '<button type="button" data-disegna>Disegna</button><button type="button" data-elimina>Elimina</button></div></div></div>';
    }).join('') : '<div class="piccolo">Nessuna foto.</div>';
    const conteggi = incarichi.map(inc => esc(inc.ditte.mestiere || inc.ditte.nome) + ': ' + G.fotoPerDitta(inc.id).length).join(' &middot; ');
    $g('[data-stato]').innerHTML = foto.length + ' foto' + (conteggi ? ' &middot; ' + conteggi : '');
    if (opz.onCambio) opz.onCambio();
  }

  function disegnaAudio() {
    const au = G.audio();
    opz.elAudio.innerHTML = au.length ? au.map((a, i) =>
      '<div class="audio" data-id="' + a.id + '"><span class="piccolo">Nota ' + (i + 1) + (a.durata_s ? ' (' + Math.floor(a.durata_s / 60) + ':' + String(a.durata_s % 60).padStart(2, '0') + ')' : '') + '</span>' +
      '<audio controls preload="none" src="' + esc(G.link[a.percorso] || '') + '"></audio>' +
      '<button type="button" class="btn-link" data-elimina-audio>Elimina</button></div>').join('') : '<div class="piccolo">Nessuna nota vocale.</div>';
  }

  async function caricaBlobs(blobs, tipo) {
    let fatte = 0, errori = 0;
    const base = G.allegati.reduce((m, a) => Math.max(m, a.ordine), 0);
    for (const b of blobs) {
      $g('[data-stato]').textContent = 'Caricamento ' + (fatte + errori + 1) + ' di ' + blobs.length + '...';
      try {
        // i file scelti dal telefono si riducono; scatti a raffica e schizzi sono gia' ridotti
        const blob = b instanceof File ? await riduciFoto(b) : b;
        await caricaAllegato(blob, opz.rif, opz.cartella, { tipo, ordine: base + fatte + 1 });
        fatte++;
      } catch (e) { errori++; console.error(e); }
    }
    if (errori) toast(errori + ' file non caricati: controlla la connessione');
    else toast(fatte === 1 ? 'Foto salvata' : fatte + ' foto salvate');
    await G.carica();
  }
  G.caricaBlobs = caricaBlobs;

  opz.el.addEventListener('click', async e => {
    const az = e.target.closest('[data-a]');
    if (az) {
      const a = az.dataset.a;
      if (a === 'scatta' || a === 'galleria') $g('[data-in="' + a + '"]').click();
      if (a === 'raffica') apriRaffica(blobs => caricaBlobs(blobs, 'foto'));
      if (a === 'schizzo') apriSchizzo(null, b => caricaBlobs([b], 'schizzo'));
      return;
    }
    const card = e.target.closest('.foto'); if (!card) return;
    const a = G.allegati.find(x => x.id === card.dataset.id); if (!a) return;
    const chip = e.target.closest('[data-ditta]');
    if (chip) {
      const inc = chip.dataset.ditta;
      const on = !(G.ditte[a.id] || new Set()).has(inc);
      const { error } = await sb.from('allegati_ditte').upsert({ studio_id: C360.studio.id, commessa_id: a.commessa_id, allegato_id: a.id, incarico_id: inc, eliminato: !on }, { onConflict: 'allegato_id,incarico_id' });
      if (error) { mostraErrore(error); return; }
      const s = G.ditte[a.id] = G.ditte[a.id] || new Set();
      on ? s.add(inc) : s.delete(inc);
      disegna();
      return;
    }
    const sp = e.target.closest('[data-sposta]');
    if (sp) {
      const foto = G.foto(), i = foto.indexOf(a), j = i + Number(sp.dataset.sposta);
      if (j < 0 || j >= foto.length) return;
      // Riassegna un ordine pulito a tutte, poi scambia le due
      const ordinate = foto.slice(); [ordinate[i], ordinate[j]] = [ordinate[j], ordinate[i]];
      const cambi = ordinate.map((f, k) => ({ f, k: k + 1 })).filter(x => x.f.ordine !== x.k);
      for (const c of cambi) {
        const { error } = await sb.from('allegati').update({ ordine: c.k }).eq('id', c.f.id);
        if (error) { mostraErrore(error); break; }
        c.f.ordine = c.k;
      }
      G.allegati.sort((x, y) => x.ordine - y.ordine);
      disegna();
      return;
    }
    if (e.target.closest('[data-disegna]')) { apriSchizzo(G.link[a.percorso], b => caricaBlobs([b], 'schizzo')); return; }
    if (e.target.closest('[data-elimina]')) {
      if (!confirm('Eliminare questa foto dalla scheda?')) return;
      const { error } = await sb.from('allegati').update({ eliminato: true }).eq('id', a.id);
      if (error) { mostraErrore(error); return; }
      await G.carica();
    }
  });
  opz.el.addEventListener('change', async e => {
    if (e.target.matches('[data-in]')) {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (files.length) caricaBlobs(files, 'foto');
      return;
    }
    if (e.target.matches('[data-didascalia]')) {
      const id = e.target.closest('.foto').dataset.id;
      const v = e.target.value.trim() || null;
      const { error } = await sb.from('allegati').update({ didascalia: v }).eq('id', id);
      if (error) { mostraErrore(error); return; }
      const a = G.allegati.find(x => x.id === id); if (a) a.didascalia = v;
      toast('Didascalia salvata');
    }
  });
  if (opz.elAudio) {
    opz.elAudio.addEventListener('click', async e => {
      const r = e.target.closest('[data-elimina-audio]'); if (!r) return;
      if (!confirm('Eliminare questa nota vocale?')) return;
      const { error } = await sb.from('allegati').update({ eliminato: true }).eq('id', r.closest('.audio').dataset.id);
      if (error) { mostraErrore(error); return; }
      await G.carica();
    });
  }
  // Pulsante registra: bottone esterno passato dalla pagina
  G.collegaRegistra = function (btn) {
    btn.addEventListener('click', async () => {
      const attiva = await registraNota(async (blob, secondi) => {
        btn.classList.remove('attiva'); btn.textContent = 'Registra nota vocale';
        if (!blob.size) return;
        try { await caricaAllegato(blob, opz.rif, opz.cartella, { tipo: 'audio', durata_s: secondi }); toast('Nota vocale salvata'); }
        catch (err) { mostraErrore(err); }
        G.carica();
      });
      if (attiva) { btn.classList.add('attiva'); btn.textContent = 'Ferma e salva'; }
    });
  };
  return G;
}
