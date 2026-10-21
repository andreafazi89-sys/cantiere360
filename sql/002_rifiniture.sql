-- 002_rifiniture.sql
-- Correzioni dal controllo Supabase (advisor) dopo 001.

-- Le funzioni dei trigger non devono essere chiamabili dall'API (/rest/v1/rpc/...).
-- Supabase da' EXECUTE ad authenticated in automatico sulle funzioni nuove: va tolto esplicitamente.
revoke execute on function
  public.registra_storico_pratica(),
  public.tocca_aggiornato_il(),
  public.tocca_aggiornato_il_studio(),
  public.tocca_fatta_il()
  from authenticated, anon, public;

-- Restano chiamabili di proposito: crea_studio (registrazione), mio_studio_id e sono_titolare (usate dalle RLS).

-- Indici sulle chiavi esterne mancanti
create index on public.pratiche (studio_id, responsabile_id);
create index on public.pratiche (studio_id, stato_id);
create index on public.pratiche (studio_id, tipo_id);
create index on public.scadenze (studio_id, responsabile_id);
