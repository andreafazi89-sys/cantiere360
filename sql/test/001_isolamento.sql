-- Test di isolamento tra due studi finti.
-- Si esegue come postgres (SQL editor o MCP). Tutto avviene in una transazione che alla fine
-- viene annullata di proposito: nel database non resta nulla.
-- Esito: errore "TEST_OK ..." = tutto superato; qualsiasi altro errore = test fallito (il messaggio dice quale).

-- Utenti finti
insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-4000-a000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test-a@esempio.invalid'),
  ('00000000-0000-4000-a000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test-b@esempio.invalid');

-- ===== Studio A: crea studio e dati =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_studio uuid; v_cli uuid; v_com uuid; v_pra uuid; v_stato uuid;
begin
  v_studio := public.crea_studio('Studio A', 'Titolare A');
  insert into public.clienti (studio_id, nome) values (v_studio, 'Cliente di A') returning id into v_cli;
  insert into public.commesse (studio_id, cliente_id, titolo, codice) values (v_studio, v_cli, 'Commessa di A', 'A-01') returning id into v_com;
  select id into v_stato from public.stati_pratica where nome = 'In preparazione';
  insert into public.pratiche (studio_id, commessa_id, stato_id, oggetto) values (v_studio, v_com, v_stato, 'Pratica di A') returning id into v_pra;
  insert into public.scadenze (studio_id, commessa_id, pratica_id, descrizione, data) values (v_studio, v_com, v_pra, 'Scadenza di A', current_date + 5);
end;
$$;

reset role;
-- Id di A messi da parte per i tentativi di B
select set_config('test.a_studio',   (select id::text from public.studi where nome = 'Studio A'), true);
select set_config('test.a_cliente',  (select id::text from public.clienti where nome = 'Cliente di A'), true);
select set_config('test.a_commessa', (select id::text from public.commesse where titolo = 'Commessa di A'), true);
select set_config('test.a_pratica',  (select id::text from public.pratiche where oggetto = 'Pratica di A'), true);
select set_config('test.a_stato',    (select s.id::text from public.stati_pratica s join public.studi st on st.id = s.studio_id where st.nome = 'Studio A' and s.nome = 'Presentata'), true);
select set_config('test.a_membro',   (select id::text from public.membri where utente_id = '00000000-0000-4000-a000-00000000000a'), true);

-- ===== Studio B: crea studio e prova a toccare A =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000b","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_studio uuid; v_com uuid; v_pra uuid; v_stato uuid; v_stato2 uuid;
  a_studio   uuid := current_setting('test.a_studio')::uuid;
  a_cliente  uuid := current_setting('test.a_cliente')::uuid;
  a_commessa uuid := current_setting('test.a_commessa')::uuid;
  a_pratica  uuid := current_setting('test.a_pratica')::uuid;
  a_stato    uuid := current_setting('test.a_stato')::uuid;
  a_membro   uuid := current_setting('test.a_membro')::uuid;
  n int;
  bloccato boolean;
begin
  v_studio := public.crea_studio('Studio B', 'Titolare B');
  insert into public.commesse (studio_id, titolo) values (v_studio, 'Commessa di B') returning id into v_com;
  select id into v_stato  from public.stati_pratica where nome = 'In preparazione';
  select id into v_stato2 from public.stati_pratica where nome = 'Presentata';
  insert into public.pratiche (studio_id, commessa_id, stato_id, oggetto) values (v_studio, v_com, v_stato, 'Pratica di B') returning id into v_pra;

  -- 1. Lettura: B vede solo le sue righe
  select count(*) into n from public.studi;            if n <> 1 then raise exception 'FALLITO 1a: B vede % studi', n; end if;
  select count(*) into n from public.membri;           if n <> 1 then raise exception 'FALLITO 1b: B vede % membri', n; end if;
  select count(*) into n from public.clienti;          if n <> 0 then raise exception 'FALLITO 1c: B vede % clienti', n; end if;
  select count(*) into n from public.commesse;         if n <> 1 then raise exception 'FALLITO 1d: B vede % commesse', n; end if;
  select count(*) into n from public.pratiche;         if n <> 1 then raise exception 'FALLITO 1e: B vede % pratiche', n; end if;
  select count(*) into n from public.scadenze;         if n <> 0 then raise exception 'FALLITO 1f: B vede % scadenze', n; end if;
  select count(*) into n from public.tipi_pratica;     if n <> 10 then raise exception 'FALLITO 1g: B vede % tipi', n; end if;
  select count(*) into n from public.stati_pratica;    if n <> 8 then raise exception 'FALLITO 1h: B vede % stati', n; end if;
  select count(*) into n from public.storico_pratica;  if n <> 1 then raise exception 'FALLITO 1i: B vede % righe storico', n; end if;
  select count(*) into n from public.commesse where id = a_commessa; if n <> 0 then raise exception 'FALLITO 1l: B legge la commessa di A per id'; end if;

  -- 2. Modifica righe di A: nessuna riga toccata
  update public.commesse set titolo = 'hackerata' where id = a_commessa;  get diagnostics n = row_count; if n <> 0 then raise exception 'FALLITO 2a: update commessa A'; end if;
  update public.clienti  set nome = 'hackerata'   where id = a_cliente;   get diagnostics n = row_count; if n <> 0 then raise exception 'FALLITO 2b: update cliente A'; end if;
  update public.studi    set nome = 'hackerata'   where id = a_studio;    get diagnostics n = row_count; if n <> 0 then raise exception 'FALLITO 2c: update studio A'; end if;
  update public.membri   set ruolo = 'collaboratore' where id = a_membro; get diagnostics n = row_count; if n <> 0 then raise exception 'FALLITO 2d: update membro A'; end if;

  -- 3. Inserire righe con lo studio_id di A: bloccato
  bloccato := false;
  begin insert into public.clienti (studio_id, nome) values (a_studio, 'intruso'); exception when others then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO 3a: insert cliente nello studio A'; end if;

  -- 4. Spostare una propria riga nello studio A: bloccato
  bloccato := false;
  begin update public.commesse set studio_id = a_studio where id = v_com; exception when others then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO 4a: spostamento commessa verso A'; end if;

  -- 5. Collegare righe proprie a dati di A: bloccato dalle chiavi composte
  bloccato := false;
  begin insert into public.scadenze (studio_id, commessa_id, descrizione, data) values (v_studio, a_commessa, 'x', current_date); exception when others then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO 5a: scadenza B su commessa A'; end if;
  bloccato := false;
  begin update public.commesse set cliente_id = a_cliente where id = v_com; exception when others then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO 5b: commessa B con cliente A'; end if;
  bloccato := false;
  begin update public.pratiche set stato_id = a_stato where id = v_pra; exception when others then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO 5c: pratica B con stato di A'; end if;
  bloccato := false;
  begin update public.pratiche set responsabile_id = a_membro where id = v_pra; exception when others then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO 5d: pratica B con responsabile di A'; end if;

  -- 6. Cancellazioni e storico manuale: vietati
  bloccato := false;
  begin delete from public.pratiche where id = v_pra; exception when insufficient_privilege then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO 6a: delete permessa'; end if;
  bloccato := false;
  begin insert into public.storico_pratica (studio_id, pratica_id, a_stato_id) values (v_studio, v_pra, v_stato); exception when insufficient_privilege then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO 6b: storico scrivibile a mano'; end if;

  -- 7. Secondo studio per lo stesso utente: vietato
  bloccato := false;
  begin perform public.crea_studio('Studio B2'); exception when others then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO 7a: secondo studio creato'; end if;

  -- 8. Colonne protette: il titolare non cambia utente_id o studio_id dei membri
  bloccato := false;
  begin update public.membri set utente_id = '00000000-0000-4000-a000-00000000000a' where studio_id = v_studio; exception when insufficient_privilege then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO 8a: utente_id modificabile'; end if;

  -- 9. Funzionamento normale: cambio stato registrato nello storico, eliminazione logica
  update public.pratiche set stato_id = v_stato2 where id = v_pra;
  select count(*) into n from public.storico_pratica where pratica_id = v_pra; if n <> 2 then raise exception 'FALLITO 9a: storico ha % righe', n; end if;
  update public.pratiche set eliminato = true where id = v_pra;
  select count(*) into n from public.pratiche where id = v_pra and eliminato and eliminato_il is not null; if n <> 1 then raise exception 'FALLITO 9b: eliminazione logica'; end if;
end;
$$;

reset role;

-- ===== Dati di A intatti dopo i tentativi di B =====
do $$
begin
  if (select titolo from public.commesse where id = current_setting('test.a_commessa')::uuid) <> 'Commessa di A' then raise exception 'FALLITO 10a: commessa A modificata'; end if;
  if (select count(*) from public.clienti where studio_id = current_setting('test.a_studio')::uuid) <> 1 then raise exception 'FALLITO 10b: clienti A alterati'; end if;
  if (select ruolo from public.membri where id = current_setting('test.a_membro')::uuid) <> 'titolare' then raise exception 'FALLITO 10c: ruolo A cambiato'; end if;
end;
$$;

-- ===== Utente anonimo (senza login): nessun accesso =====
set local role anon;
do $$
declare bloccato boolean := false;
begin
  begin perform count(*) from public.commesse; exception when insufficient_privilege then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO 11a: anon legge commesse'; end if;
  bloccato := false;
  begin perform public.crea_studio('Anonimo'); exception when insufficient_privilege then bloccato := true; end;
  if not bloccato then raise exception 'FALLITO 11b: anon crea studio'; end if;
end;
$$;
reset role;

-- Annulla tutto
do $$ begin raise exception 'TEST_OK: tutti i controlli superati, transazione annullata'; end; $$;
