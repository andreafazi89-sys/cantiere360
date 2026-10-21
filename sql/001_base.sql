-- 001_base.sql
-- Cantiere 360°: tabelle del primo modulo, RLS, creazione studio.
-- Regole: ogni tabella ha studio_id; RLS attiva ovunque; nessuna DELETE (cancellazione = eliminato).
-- I riferimenti tra tabelle usano chiavi composte (studio_id, id): una riga non puo' puntare a dati di un altro studio.

-- =========================================================
-- TABELLE
-- =========================================================

create table public.studi (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (length(trim(nome)) > 0),
  partita_iva text,
  indirizzo   text,
  email       text,
  telefono    text,
  logo_path   text,
  creato_il   timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);

create table public.membri (
  id         uuid primary key default gen_random_uuid(),
  studio_id  uuid not null references public.studi(id),
  utente_id  uuid not null unique references auth.users(id),  -- per ora un utente = un solo studio
  nome       text,
  ruolo      text not null default 'collaboratore' check (ruolo in ('titolare', 'collaboratore')),
  attivo     boolean not null default true,
  creato_il  timestamptz not null default now(),
  unique (studio_id, id)
);

create table public.clienti (
  id          uuid primary key default gen_random_uuid(),
  studio_id   uuid not null references public.studi(id),
  nome        text not null check (length(trim(nome)) > 0),
  cf_piva     text,
  email       text,
  telefono    text,
  indirizzo   text,
  note        text,
  eliminato   boolean not null default false,
  eliminato_il timestamptz,
  creato_il   timestamptz not null default now(),
  aggiornato_il timestamptz not null default now(),
  unique (studio_id, id)
);

create table public.commesse (
  id          uuid primary key default gen_random_uuid(),
  studio_id   uuid not null references public.studi(id),
  cliente_id  uuid,
  codice      text,
  titolo      text not null check (length(trim(titolo)) > 0),
  colore      text not null default '#2563eb' check (colore ~ '^#[0-9a-fA-F]{6}$'),
  comune      text,
  indirizzo   text,
  foglio      text,
  particella  text,
  sub         text,
  stato       text not null default 'attiva' check (stato in ('attiva', 'sospesa', 'chiusa')),
  note        text,
  eliminato   boolean not null default false,
  eliminato_il timestamptz,
  creato_il   timestamptz not null default now(),
  aggiornato_il timestamptz not null default now(),
  unique (studio_id, id),
  foreign key (studio_id, cliente_id) references public.clienti(studio_id, id)
);

-- Liste modificabili dallo studio (precaricate da crea_studio)
create table public.tipi_pratica (
  id         uuid primary key default gen_random_uuid(),
  studio_id  uuid not null references public.studi(id),
  nome       text not null check (length(trim(nome)) > 0),
  ordine     int not null default 0,
  attivo     boolean not null default true,
  unique (studio_id, id),
  unique (studio_id, nome)
);

create table public.stati_pratica (
  id         uuid primary key default gen_random_uuid(),
  studio_id  uuid not null references public.studi(id),
  nome       text not null check (length(trim(nome)) > 0),
  ordine     int not null default 0,
  chiuso     boolean not null default false,  -- true: la pratica e' conclusa (Chiusa, Archiviata)
  attivo     boolean not null default true,
  unique (studio_id, id),
  unique (studio_id, nome)
);

create table public.pratiche (
  id                 uuid primary key default gen_random_uuid(),
  studio_id          uuid not null references public.studi(id),
  commessa_id        uuid not null,
  tipo_id            uuid,
  stato_id           uuid not null,
  oggetto            text not null check (length(trim(oggetto)) > 0),
  codice_interno     text,
  protocollo         text,
  data_presentazione date,
  responsabile_id    uuid,
  note               text,
  eliminato          boolean not null default false,
  eliminato_il       timestamptz,
  creato_il          timestamptz not null default now(),
  aggiornato_il      timestamptz not null default now(),
  unique (studio_id, id),
  foreign key (studio_id, commessa_id)     references public.commesse(studio_id, id),
  foreign key (studio_id, tipo_id)         references public.tipi_pratica(studio_id, id),
  foreign key (studio_id, stato_id)        references public.stati_pratica(studio_id, id),
  foreign key (studio_id, responsabile_id) references public.membri(studio_id, id)
);

create table public.scadenze (
  id              uuid primary key default gen_random_uuid(),
  studio_id       uuid not null references public.studi(id),
  commessa_id     uuid not null,
  pratica_id      uuid,
  descrizione     text not null check (length(trim(descrizione)) > 0),
  data            date not null,
  responsabile_id uuid,
  fatta           boolean not null default false,
  fatta_il        timestamptz,
  note            text,
  eliminato       boolean not null default false,
  eliminato_il    timestamptz,
  creato_il       timestamptz not null default now(),
  aggiornato_il   timestamptz not null default now(),
  foreign key (studio_id, commessa_id)     references public.commesse(studio_id, id),
  foreign key (studio_id, pratica_id)      references public.pratiche(studio_id, id),
  foreign key (studio_id, responsabile_id) references public.membri(studio_id, id)
);

create table public.storico_pratica (
  id          uuid primary key default gen_random_uuid(),
  studio_id   uuid not null references public.studi(id),
  pratica_id  uuid not null,
  da_stato_id uuid,
  a_stato_id  uuid not null,
  utente_id   uuid default auth.uid(),
  data        timestamptz not null default now(),
  nota        text,
  foreign key (studio_id, pratica_id) references public.pratiche(studio_id, id)
);

-- Indici per le query tipiche (tutto filtra per studio)
create index on public.membri (studio_id);
create index on public.clienti (studio_id) where not eliminato;
create index on public.commesse (studio_id) where not eliminato;
create index on public.commesse (studio_id, cliente_id);
create index on public.pratiche (studio_id, commessa_id) where not eliminato;
create index on public.scadenze (studio_id, data) where not eliminato and not fatta;
create index on public.scadenze (studio_id, commessa_id);
create index on public.scadenze (studio_id, pratica_id);
create index on public.storico_pratica (studio_id, pratica_id, data);

-- =========================================================
-- FUNZIONI DI SUPPORTO
-- =========================================================

-- Studio dell'utente loggato (null se non ne ha)
create function public.mio_studio_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.studio_id from public.membri m
  where m.utente_id = auth.uid() and m.attivo
  limit 1
$$;

create function public.sono_titolare()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.membri m
    where m.utente_id = auth.uid() and m.attivo and m.ruolo = 'titolare'
  )
$$;

-- Registrazione "crea il tuo studio": crea studio + titolare + liste predefinite
create function public.crea_studio(p_nome text, p_nome_titolare text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_studio uuid;
begin
  if auth.uid() is null then
    raise exception 'Accesso richiesto';
  end if;
  if exists (select 1 from public.membri where utente_id = auth.uid()) then
    raise exception 'Questo utente appartiene gia'' a uno studio';
  end if;

  insert into public.studi (nome) values (trim(p_nome)) returning id into v_studio;

  insert into public.membri (studio_id, utente_id, nome, ruolo)
  values (v_studio, auth.uid(), p_nome_titolare, 'titolare');

  insert into public.tipi_pratica (studio_id, nome, ordine)
  select v_studio, t.nome, t.ord
  from unnest(array[
    'CILA', 'SCIA', 'SCIA alternativa al permesso', 'Permesso di costruire',
    'Segnalazione certificata di agibilità', 'Autorizzazione paesaggistica',
    'Deposito sismico', 'DOCFA', 'Accesso agli atti', 'Altro'
  ]) with ordinality as t(nome, ord);

  insert into public.stati_pratica (studio_id, nome, ordine, chiuso)
  select v_studio, s.nome, s.ord, s.nome in ('Chiusa', 'Archiviata')
  from unnest(array[
    'In preparazione', 'Presentata', 'Integrazioni richieste', 'Efficace/rilasciata',
    'Lavori in corso', 'Fine lavori', 'Chiusa', 'Archiviata'
  ]) with ordinality as s(nome, ord);

  return v_studio;
end;
$$;

-- aggiornato_il automatico
create function public.tocca_aggiornato_il()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.aggiornato_il := now();
  if new.eliminato and not old.eliminato then
    new.eliminato_il := now();
  end if;
  return new;
end;
$$;

create function public.tocca_aggiornato_il_studio()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.aggiornato_il := now();
  return new;
end;
$$;

create trigger aggiornato_il before update on public.studi    for each row execute function public.tocca_aggiornato_il_studio();
create trigger aggiornato_il before update on public.clienti  for each row execute function public.tocca_aggiornato_il();
create trigger aggiornato_il before update on public.commesse for each row execute function public.tocca_aggiornato_il();
create trigger aggiornato_il before update on public.pratiche for each row execute function public.tocca_aggiornato_il();
create trigger aggiornato_il before update on public.scadenze for each row execute function public.tocca_aggiornato_il();

-- fatta_il automatico
create function public.tocca_fatta_il()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.fatta and (tg_op = 'INSERT' or not old.fatta) then
    new.fatta_il := now();
  elsif not new.fatta then
    new.fatta_il := null;
  end if;
  return new;
end;
$$;

create trigger fatta_il before insert or update on public.scadenze for each row execute function public.tocca_fatta_il();

-- Storico stati: scritto solo dal trigger (gli utenti non possono inserirlo a mano)
create function public.registra_storico_pratica()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.storico_pratica (studio_id, pratica_id, da_stato_id, a_stato_id, utente_id)
    values (new.studio_id, new.id, null, new.stato_id, auth.uid());
  elsif new.stato_id is distinct from old.stato_id then
    insert into public.storico_pratica (studio_id, pratica_id, da_stato_id, a_stato_id, utente_id)
    values (new.studio_id, new.id, old.stato_id, new.stato_id, auth.uid());
  end if;
  return new;
end;
$$;

create trigger storico after insert or update of stato_id on public.pratiche
  for each row execute function public.registra_storico_pratica();

-- =========================================================
-- PERMESSI
-- =========================================================

-- Nessun accesso anonimo; nessuna DELETE per nessuno dall'app
revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update on
  public.clienti, public.commesse, public.pratiche, public.scadenze,
  public.tipi_pratica, public.stati_pratica
  to authenticated;
grant select on public.studi, public.membri to authenticated;
-- Colonne modificabili: niente id, studio_id, utente_id
grant update (nome, partita_iva, indirizzo, email, telefono, logo_path) on public.studi to authenticated;
grant update (nome, ruolo, attivo) on public.membri to authenticated;
grant select on public.storico_pratica to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.mio_studio_id(), public.sono_titolare(), public.crea_studio(text, text) to authenticated;

-- =========================================================
-- RLS
-- =========================================================

alter table public.studi           enable row level security;
alter table public.membri          enable row level security;
alter table public.clienti         enable row level security;
alter table public.commesse        enable row level security;
alter table public.tipi_pratica    enable row level security;
alter table public.stati_pratica   enable row level security;
alter table public.pratiche        enable row level security;
alter table public.scadenze        enable row level security;
alter table public.storico_pratica enable row level security;

-- studi: si vede solo il proprio; lo modifica solo il titolare; si crea solo con crea_studio()
create policy studi_select on public.studi for select to authenticated
  using (id = (select public.mio_studio_id()));
create policy studi_update on public.studi for update to authenticated
  using (id = (select public.mio_studio_id()) and (select public.sono_titolare()))
  with check (id = (select public.mio_studio_id()));

-- membri: si vedono i colleghi; li modifica solo il titolare (inviti: modulo successivo)
create policy membri_select on public.membri for select to authenticated
  using (studio_id = (select public.mio_studio_id()));
create policy membri_update on public.membri for update to authenticated
  using (studio_id = (select public.mio_studio_id()) and (select public.sono_titolare()))
  with check (studio_id = (select public.mio_studio_id()));

-- Tabelle di lavoro: stesso schema per tutte
do $$
declare
  t text;
begin
  foreach t in array array['clienti', 'commesse', 'pratiche', 'scadenze', 'tipi_pratica', 'stati_pratica'] loop
    execute format(
      'create policy %1$s_select on public.%1$I for select to authenticated using (studio_id = (select public.mio_studio_id()))', t);
    execute format(
      'create policy %1$s_insert on public.%1$I for insert to authenticated with check (studio_id = (select public.mio_studio_id()))', t);
    execute format(
      'create policy %1$s_update on public.%1$I for update to authenticated using (studio_id = (select public.mio_studio_id())) with check (studio_id = (select public.mio_studio_id()))', t);
  end loop;
end;
$$;

-- storico: sola lettura
create policy storico_pratica_select on public.storico_pratica for select to authenticated
  using (studio_id = (select public.mio_studio_id()));
