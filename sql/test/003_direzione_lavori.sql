-- Test di isolamento per 003 (direzione lavori): due studi finti, piu' un collaboratore nello studio A.
-- Si esegue come postgres dopo 001-003. Tutto in una transazione annullata alla fine: nel database non resta nulla.
-- Esito: errore "TEST_OK ..." = tutto superato; qualsiasi altro errore = test fallito (il messaggio dice quale).

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-a000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test-a@esempio.invalid'),
  ('00000000-0000-4000-a000-0000000000ac', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test-a-collab@esempio.invalid'),
  ('00000000-0000-4000-a000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test-b@esempio.invalid');

-- ===== Studio A (titolare): dati completi =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_studio uuid; v_com uuid; v_dit uuid; v_inc uuid; v_inc2 uuid; v_sop uuid; v_sal uuid; v_sal2 uuid; v_all uuid; n int;
begin
  v_studio := public.crea_studio('Studio A', 'Titolare A');
  insert into public.commesse (studio_id, titolo) values (v_studio, 'Commessa di A') returning id into v_com;
  insert into public.ditte (studio_id, nome, mestiere) values (v_studio, 'Falegnameria di A', 'falegname') returning id into v_dit;
  insert into public.incarichi (studio_id, commessa_id, ditta_id) values (v_studio, v_com, v_dit) returning id into v_inc;
  insert into public.ditte (studio_id, nome, mestiere) values (v_studio, 'Pittore di A', 'pittore') returning id into v_dit;
  insert into public.incarichi (studio_id, commessa_id, ditta_id) values (v_studio, v_com, v_dit) returning id into v_inc2;
  insert into public.importi_incarico (incarico_id, studio_id, importo_contratto) values (v_inc, v_studio, 12000);

  insert into public.sopralluoghi (studio_id, commessa_id, oggetto) values (v_studio, v_com, 'Sopralluogo di A') returning id into v_sop;
  insert into public.sopralluogo_ditte (studio_id, commessa_id, sopralluogo_id, incarico_id, note) values (v_studio, v_com, v_sop, v_inc, 'Note per il falegname');
  insert into public.allegati (studio_id, commessa_id, sopralluogo_id, percorso, didascalia)
    values (v_studio, v_com, v_sop, 'studi/' || v_studio || '/commesse/' || v_com || '/foto1.jpg', 'Foto di A') returning id into v_all;
  insert into public.allegati_ditte (studio_id, commessa_id, allegato_id, incarico_id) values (v_studio, v_com, v_all, v_inc);

  insert into public.sal (studio_id, commessa_id, incarico_id, descrizione) values (v_studio, v_com, v_inc, 'SAL 1 di A') returning id into v_sal;
  insert into public.sal (studio_id, commessa_id, incarico_id, descrizione) values (v_studio, v_com, v_inc, 'SAL 2 di A') returning id into v_sal2;
  insert into public.importi_sal (sal_id, studio_id, lavori_eseguiti, sal_precedenti, ritenuta_perc, iva_perc)
    values (v_sal2, v_studio, 7200, 4000, 10, 22);
  insert into storage.objects (bucket_id, name) values ('documenti', 'studi/' || v_studio || '/commesse/' || v_com || '/foto1.jpg');

  -- Numerazione automatica: 1 e 2 per il falegname, 1 per il pittore
  select numero into n from public.sal where id = v_sal2; if n <> 2 then raise exception 'FALLITO 0a: secondo SAL numero %', n; end if;
  insert into public.sal (studio_id, commessa_id, incarico_id) values (v_studio, v_com, v_inc2) returning numero into n;
  if n <> 1 then raise exception 'FALLITO 0b: primo SAL del pittore numero %', n; end if;
  -- Importi calcolati: 3200 di SAL, 320 di ritenuta, 2880 imponibile, 633,60 IVA, 3513,60 totale
  if (select (importo_sal, ritenuta, imponibile, iva, totale) <> (3200.00, 320.00, 2880.00, 633.60, 3513.60) from public.importi_sal where sal_id = v_sal2)
    then raise exception 'FALLITO 0c: importi calcolati sbagliati'; end if;
  -- Il numero non si cambia, nemmeno dal titolare
  begin
    update public.sal set numero = 9 where id = v_sal;
    raise exception 'FALLITO 0d: numero SAL modificabile';
  exception when insufficient_privilege then null;
  end;
  -- Una ditta non si aggiunge due volte alla stessa commessa
  begin
    insert into public.incarichi (studio_id, commessa_id, ditta_id) values (v_studio, v_com, v_dit);
    raise exception 'FALLITO 0e: ditta doppia nella commessa';
  exception when unique_violation then null;
  end;
end;
$$;

reset role;
select set_config('test.a_studio',    (select id::text from public.studi where nome = 'Studio A'), true);
select set_config('test.a_commessa',  (select id::text from public.commesse where titolo = 'Commessa di A'), true);
select set_config('test.a_ditta',     (select id::text from public.ditte where nome = 'Falegnameria di A'), true);
select set_config('test.a_incarico',  (select i.id::text from public.incarichi i join public.ditte d on d.id = i.ditta_id where d.nome = 'Falegnameria di A'), true);
select set_config('test.a_sopr',      (select id::text from public.sopralluoghi where oggetto = 'Sopralluogo di A'), true);
select set_config('test.a_sal',       (select id::text from public.sal where descrizione = 'SAL 2 di A'), true);
select set_config('test.a_allegato',  (select id::text from public.allegati where didascalia = 'Foto di A'), true);

-- Collaboratore dello studio A (gli inviti arriveranno con un modulo successivo: qui si inserisce a mano)
insert into public.membri (studio_id, utente_id, nome, ruolo)
values (current_setting('test.a_studio')::uuid, '00000000-0000-4000-a000-0000000000ac', 'Collaboratore A', 'collaboratore');

-- ===== Collaboratore di A: lavora su tutto, ma non vede e non scrive importi =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000000ac","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  a_studio uuid := current_setting('test.a_studio')::uuid;
  a_com    uuid := current_setting('test.a_commessa')::uuid;
  a_inc    uuid := current_setting('test.a_incarico')::uuid;
  a_sal    uuid := current_setting('test.a_sal')::uuid;
  v_sal uuid; n int; bloccato boolean;
begin
  select count(*) into n from public.sal;          if n <> 3 then raise exception 'FALLITO C1a: collaboratore vede % SAL', n; end if;
  select count(*) into n from public.allegati;     if n <> 1 then raise exception 'FALLITO C1b: collaboratore vede % allegati', n; end if;
  select count(*) into n from public.incarichi;    if n <> 2 then raise exception 'FALLITO C1c: collaboratore vede % incarichi', n; end if;
  select count(*) into n from storage.objects where bucket_id = 'documenti'; if n <> 1 then raise exception 'FALLITO C1d: collaboratore vede % file', n; end if;

  -- importi: invisibili
  select count(*) into n from public.importi_sal;      if n <> 0 then raise exception 'FALLITO C2a: collaboratore vede importi SAL'; end if;
  select count(*) into n from public.importi_incarico; if n <> 0 then raise exception 'FALLITO C2b: collaboratore vede importi contratto'; end if;
  -- importi: non modificabili ne' inseribili
  update public.importi_sal set lavori_eseguiti = 1 where sal_id = a_sal; get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLITO C2c: collaboratore modifica importi SAL'; end if;
  insert into public.sal (studio_id, commessa_id, incarico_id, descrizione) values (a_studio, a_com, a_inc, 'SAL del collaboratore') returning id into v_sal;
  bloccato := false;
  begin insert into public.importi_sal (sal_id, studio_id, lavori_eseguiti) values (v_sal, a_studio, 1); exception when insufficient_privilege then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO C2d: collaboratore inserisce importi SAL'; end if;
  bloccato := false;
  begin insert into public.importi_incarico (incarico_id, studio_id, importo_contratto)
        select id, a_studio, 1 from public.incarichi where id <> a_inc limit 1;
  exception when insufficient_privilege then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO C2e: collaboratore inserisce importo contratto'; end if;
end;
$$;

reset role;

-- ===== Studio B: prova a leggere e toccare i dati di A =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000b","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  a_studio uuid := current_setting('test.a_studio')::uuid;
  a_com    uuid := current_setting('test.a_commessa')::uuid;
  a_dit    uuid := current_setting('test.a_ditta')::uuid;
  a_inc    uuid := current_setting('test.a_incarico')::uuid;
  a_sop    uuid := current_setting('test.a_sopr')::uuid;
  a_sal    uuid := current_setting('test.a_sal')::uuid;
  a_all    uuid := current_setting('test.a_allegato')::uuid;
  v_studio uuid; v_com uuid; v_dit uuid; v_inc uuid; v_sop uuid; v_sal uuid; v_all uuid;
  n int; bloccato boolean;
begin
  v_studio := public.crea_studio('Studio B', 'Titolare B');
  insert into public.commesse (studio_id, titolo) values (v_studio, 'Commessa di B') returning id into v_com;
  insert into public.ditte (studio_id, nome) values (v_studio, 'Ditta di B') returning id into v_dit;
  insert into public.incarichi (studio_id, commessa_id, ditta_id) values (v_studio, v_com, v_dit) returning id into v_inc;
  insert into public.sopralluoghi (studio_id, commessa_id) values (v_studio, v_com) returning id into v_sop;
  insert into public.sal (studio_id, commessa_id, incarico_id) values (v_studio, v_com, v_inc) returning id into v_sal;

  -- 1. Lettura: niente di A, nemmeno per id
  select count(*) into n from public.ditte;             if n <> 1 then raise exception 'FALLITO 1a: B vede % ditte', n; end if;
  select count(*) into n from public.incarichi;         if n <> 1 then raise exception 'FALLITO 1b: B vede % incarichi', n; end if;
  select count(*) into n from public.sopralluoghi;      if n <> 1 then raise exception 'FALLITO 1c: B vede % sopralluoghi', n; end if;
  select count(*) into n from public.sopralluogo_ditte; if n <> 0 then raise exception 'FALLITO 1d: B vede % note per ditta', n; end if;
  select count(*) into n from public.sal;               if n <> 1 then raise exception 'FALLITO 1e: B vede % SAL', n; end if;
  select count(*) into n from public.allegati;          if n <> 0 then raise exception 'FALLITO 1f: B vede % allegati', n; end if;
  select count(*) into n from public.allegati_ditte;    if n <> 0 then raise exception 'FALLITO 1g: B vede % assegnazioni', n; end if;
  select count(*) into n from public.importi_incarico;  if n <> 0 then raise exception 'FALLITO 1h: B vede importi contratto di A'; end if;
  select count(*) into n from public.importi_sal;       if n <> 0 then raise exception 'FALLITO 1i: B vede importi SAL di A'; end if;
  select count(*) into n from storage.objects;          if n <> 0 then raise exception 'FALLITO 1l: B vede % file', n; end if;
  select numero into n from public.sal where id = v_sal; if n <> 1 then raise exception 'FALLITO 1m: numerazione di B parte da %', n; end if;

  -- 2. Modifica righe di A: nessuna riga toccata
  update public.ditte        set nome = 'x'          where id = a_dit;  get diagnostics n = row_count; if n <> 0 then raise exception 'FALLITO 2a'; end if;
  update public.incarichi    set lavorazioni = 'x'   where id = a_inc;  get diagnostics n = row_count; if n <> 0 then raise exception 'FALLITO 2b'; end if;
  update public.sopralluoghi set oggetto = 'x'       where id = a_sop;  get diagnostics n = row_count; if n <> 0 then raise exception 'FALLITO 2c'; end if;
  update public.sal          set descrizione = 'x'   where id = a_sal;  get diagnostics n = row_count; if n <> 0 then raise exception 'FALLITO 2d'; end if;
  update public.allegati     set didascalia = 'x'    where id = a_all;  get diagnostics n = row_count; if n <> 0 then raise exception 'FALLITO 2e'; end if;
  update public.allegati_ditte set eliminato = true  where allegato_id = a_all; get diagnostics n = row_count; if n <> 0 then raise exception 'FALLITO 2f'; end if;
  update public.importi_sal  set lavori_eseguiti = 0 where sal_id = a_sal; get diagnostics n = row_count; if n <> 0 then raise exception 'FALLITO 2g'; end if;
  update public.sopralluogo_ditte set note = 'x'     where sopralluogo_id = a_sop; get diagnostics n = row_count; if n <> 0 then raise exception 'FALLITO 2h'; end if;

  -- 3. Inserire con lo studio_id di A: bloccato
  bloccato := false;
  begin insert into public.ditte (studio_id, nome) values (a_studio, 'intrusa'); exception when others then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO 3a: ditta nello studio A'; end if;
  bloccato := false;
  begin insert into public.sopralluoghi (studio_id, commessa_id) values (a_studio, a_com); exception when others then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO 3b: sopralluogo nello studio A'; end if;
  bloccato := false;
  begin insert into public.importi_sal (sal_id, studio_id) values (a_sal, a_studio); exception when others then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO 3c: importi sul SAL di A'; end if;

  -- 4. Collegare righe proprie a dati di A: bloccato dalle chiavi composte
  bloccato := false;
  begin insert into public.incarichi (studio_id, commessa_id, ditta_id) values (v_studio, v_com, a_dit); exception when others then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO 4a: ditta di A in commessa di B'; end if;
  bloccato := false;
  begin insert into public.sal (studio_id, commessa_id, incarico_id) values (v_studio, v_com, a_inc); exception when others then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO 4b: SAL di B su incarico di A'; end if;
  bloccato := false;
  begin insert into public.allegati (studio_id, commessa_id, sopralluogo_id, percorso) values (v_studio, v_com, a_sop, 'studi/' || v_studio || '/x.jpg'); exception when others then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO 4c: foto di B su sopralluogo di A'; end if;
  bloccato := false;
  begin insert into public.allegati_ditte (studio_id, commessa_id, allegato_id, incarico_id) values (v_studio, v_com, a_all, v_inc); exception when others then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO 4d: foto di A assegnata a ditta di B'; end if;
  bloccato := false;
  begin insert into public.sopralluogo_ditte (studio_id, commessa_id, sopralluogo_id, incarico_id) values (v_studio, v_com, v_sop, a_inc); exception when others then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO 4e: nota per ditta di A'; end if;
  bloccato := false;
  begin insert into public.importi_sal (sal_id, studio_id) values (a_sal, v_studio); exception when others then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO 4f: importi di B sul SAL di A'; end if;

  -- 5. Allegato che punta alla cartella di A: bloccato
  bloccato := false;
  begin insert into public.allegati (studio_id, commessa_id, sopralluogo_id, percorso) values (v_studio, v_com, v_sop, 'studi/' || a_studio || '/rubata.jpg'); exception when check_violation then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO 5a: allegato con percorso di A'; end if;

  -- 6. File: B non carica nella cartella di A; carica nella sua
  bloccato := false;
  begin insert into storage.objects (bucket_id, name) values ('documenti', 'studi/' || a_studio || '/intruso.jpg'); exception when insufficient_privilege then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO 6a: file nella cartella di A'; end if;
  bloccato := false;
  begin insert into storage.objects (bucket_id, name) values ('documenti', 'intruso.jpg'); exception when insufficient_privilege then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO 6b: file fuori dalle cartelle degli studi'; end if;
  insert into storage.objects (bucket_id, name) values ('documenti', 'studi/' || v_studio || '/mia.jpg');
  select count(*) into n from storage.objects; if n <> 1 then raise exception 'FALLITO 6c: B vede % file dopo il suo caricamento', n; end if;

  -- 7. Niente cancellazioni, ne' righe ne' file
  begin
    delete from public.sal where id = v_sal; get diagnostics n = row_count;
    if n <> 0 then raise exception 'FALLITO 7a: delete SAL permessa'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.allegati; get diagnostics n = row_count;
    if n <> 0 then raise exception 'FALLITO 7b: delete allegati permessa'; end if;
  exception when insufficient_privilege then null;
  end;
  -- su Supabase un trigger puo' rifiutare la cancellazione diretta: anche quello vale come bloccato
  begin
    delete from storage.objects where bucket_id = 'documenti'; get diagnostics n = row_count;
    if n <> 0 then raise exception 'FALLITO 7c: B cancella % file', n; end if;
  exception when others then
    if sqlerrm like 'FALLITO%' then raise; end if;
  end;
end;
$$;

reset role;

-- ===== Dati di A intatti =====
do $$
begin
  if (select count(*) from public.allegati_ditte where allegato_id = current_setting('test.a_allegato')::uuid and not eliminato) <> 1 then raise exception 'FALLITO 8a: assegnazioni di A alterate'; end if;
  if (select lavori_eseguiti from public.importi_sal where sal_id = current_setting('test.a_sal')::uuid) <> 7200 then raise exception 'FALLITO 8b: importi di A alterati'; end if;
  if (select oggetto from public.sopralluoghi where id = current_setting('test.a_sopr')::uuid) <> 'Sopralluogo di A' then raise exception 'FALLITO 8c: sopralluogo di A alterato'; end if;
  if (select count(*) from storage.objects where bucket_id = 'documenti') <> 2 then raise exception 'FALLITO 8d: file alterati'; end if;
end;
$$;

-- ===== Anonimo: nessun accesso =====
set local role anon;
do $$
declare bloccato boolean := false; n int;
begin
  begin perform count(*) from public.sopralluoghi; exception when insufficient_privilege then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO 9a: anon legge sopralluoghi'; end if;
  select count(*) into n from storage.objects where bucket_id = 'documenti';
  if n <> 0 then raise exception 'FALLITO 9b: anon vede % file', n; end if;
end;
$$;
reset role;

do $$ begin raise exception 'TEST_OK: tutti i controlli superati, transazione annullata'; end; $$;
