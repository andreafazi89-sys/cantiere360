-- 004_sveglia.sql
-- Funzione "sveglia" per evitare la pausa del piano Free di Supabase (7 giorni con poca attivita' sul database).
-- La chiama ogni giorno il workflow GitHub .github/workflows/sveglia.yml con la sola publishable key (ruolo anon).
-- Non legge nessuna tabella e non restituisce dati degli studi: risponde solo 'ok'.

create function public.sveglia()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select 'ok'::text
$$;

comment on function public.sveglia() is 'Tiene attivo il progetto Free: nessun accesso ai dati, risponde ok.';

-- Supabase da' EXECUTE in automatico: lo si toglie a tutti e lo si concede solo dove serve.
revoke execute on function public.sveglia() from public, anon, authenticated;
grant execute on function public.sveglia() to anon;
