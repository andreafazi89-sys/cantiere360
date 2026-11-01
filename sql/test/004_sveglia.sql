-- Test per 004 (sveglia): la funzione e' chiamabile da anon, risponde solo 'ok',
-- e anon continua a non poter leggere ne' scrivere nessuna tabella.
-- Si esegue come postgres dopo 001-004, in una sola transazione (SQL editor o psql -1): il TEST_OK finale la annulla.
-- Esito: errore "TEST_OK ..." = tutto superato; qualsiasi altro errore = test fallito.


insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-a000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test-a@esempio.invalid');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select public.crea_studio('Studio A', 'Titolare A');
reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

do $$
declare t record; ok boolean;
begin
  if public.sveglia() is distinct from 'ok' then
    raise exception 'FALLITO: sveglia() non risponde ok';
  end if;

  -- anon non deve leggere nessuna tabella di public
  for t in select tablename from pg_tables where schemaname = 'public' loop
    ok := false;
    begin
      execute format('select 1 from public.%I limit 1', t.tablename);
    exception when insufficient_privilege then ok := true;
    end;
    if not ok then raise exception 'FALLITO: anon legge la tabella %', t.tablename; end if;
  end loop;

  -- anon non deve poter chiamare le altre funzioni dell'app
  ok := false;
  begin perform public.crea_studio('Intruso', 'X');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FALLITO: anon chiama crea_studio'; end if;

  ok := false;
  begin perform public.mio_studio_id();
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'FALLITO: anon chiama mio_studio_id'; end if;

  raise exception 'TEST_OK sveglia: risponde ok, anon non vede tabelle ne'' altre funzioni';
end $$;

