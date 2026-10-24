-- 003_direzione_lavori.sql
-- Cantiere 360°: direzione lavori dentro la commessa.
-- Ditte (rubrica dello studio) e ditte al lavoro in una commessa, sopralluoghi, SAL per ditta,
-- allegati (foto, schizzi, note vocali) con assegnazione delle foto alle ditte.
-- Importi (contratto della ditta, importi del SAL): tabelle a parte, leggibili e scrivibili solo dal titolare.
-- File: bucket privato `documenti`, percorsi studi/<studio_id>/...; nessuna cancellazione dall'app.
-- Stesse regole di 001: studio_id ovunque, RLS, chiavi composte, niente DELETE.

-- =========================================================
-- TABELLE
-- =========================================================

-- Rubrica ditte e artigiani dello studio
create table public.ditte (
  id          uuid primary key default gen_random_uuid(),
  studio_id   uuid not null references public.studi(id),
  nome        text not null check (length(trim(nome)) > 0),
  mestiere    text,                 -- falegname, pittore, idraulico...
  referente   text,
  telefono    text,
  email       text,
  cf_piva     text,
  note        text,
  eliminato   boolean not null default false,
  eliminato_il timestamptz,
  creato_il   timestamptz not null default now(),
  aggiornato_il timestamptz not null default now(),
  unique (studio_id, id)
);

-- Ditta al lavoro in una commessa (a ogni incarico si legano SAL, foto e note del sopralluogo)
create table public.incarichi (
  id          uuid primary key default gen_random_uuid(),
  studio_id   uuid not null references public.studi(id),
  commessa_id uuid not null,
  ditta_id    uuid not null,
  lavorazioni text,                 -- cosa fa la ditta in questa commessa
  eliminato   boolean not null default false,
  eliminato_il timestamptz,
  creato_il   timestamptz not null default now(),
  aggiornato_il timestamptz not null default now(),
  unique (studio_id, id),
  unique (studio_id, commessa_id, id),
  foreign key (studio_id, commessa_id) references public.commesse(studio_id, id),
  foreign key (studio_id, ditta_id)    references public.ditte(studio_id, id)
);
-- Una ditta compare una sola volta per commessa (finche' non e' eliminata)
create unique index incarichi_ditta_unica on public.incarichi (commessa_id, ditta_id) where not eliminato;

create table public.sopralluoghi (
  id              uuid primary key default gen_random_uuid(),
  studio_id       uuid not null references public.studi(id),
  commessa_id     uuid not null,
  pratica_id      uuid,
  data            date not null default current_date,
  ora             time,
  tipo            text,             -- testo libero con suggerimenti nella pagina
  responsabile_id uuid,
  presenti        text,
  oggetto         text,
  osservazioni    text,
  disposizioni    text,             -- disposizioni generali; quelle per ditta in sopralluogo_ditte
  latitudine      numeric(9,6) check (latitudine between -90 and 90),
  longitudine     numeric(9,6) check (longitudine between -180 and 180),
  creato_da       uuid default auth.uid(),
  eliminato       boolean not null default false,
  eliminato_il    timestamptz,
  creato_il       timestamptz not null default now(),
  aggiornato_il   timestamptz not null default now(),
  unique (studio_id, id),
  unique (studio_id, commessa_id, id),
  foreign key (studio_id, commessa_id)     references public.commesse(studio_id, id),
  foreign key (studio_id, pratica_id)      references public.pratiche(studio_id, id),
  foreign key (studio_id, responsabile_id) references public.membri(studio_id, id)
);

-- Note del sopralluogo rivolte a una sola ditta (vanno nel PDF di quella ditta)
create table public.sopralluogo_ditte (
  id             uuid primary key default gen_random_uuid(),
  studio_id      uuid not null references public.studi(id),
  commessa_id    uuid not null,
  sopralluogo_id uuid not null,
  incarico_id    uuid not null,
  note           text,
  creato_il      timestamptz not null default now(),
  aggiornato_il  timestamptz not null default now(),
  unique (sopralluogo_id, incarico_id),
  foreign key (studio_id, commessa_id, sopralluogo_id) references public.sopralluoghi(studio_id, commessa_id, id),
  foreign key (studio_id, commessa_id, incarico_id)    references public.incarichi(studio_id, commessa_id, id)
);

-- SAL: uno per ditta della commessa, numerato in automatico per incarico
create table public.sal (
  id            uuid primary key default gen_random_uuid(),
  studio_id     uuid not null references public.studi(id),
  commessa_id   uuid not null,
  incarico_id   uuid not null,
  numero        int not null,
  data          date not null default current_date,
  avanzamento   numeric(5,2) check (avanzamento between 0 and 100),   -- percentuale
  descrizione   text,
  note          text,
  creato_da     uuid default auth.uid(),
  eliminato     boolean not null default false,
  eliminato_il  timestamptz,
  creato_il     timestamptz not null default now(),
  aggiornato_il timestamptz not null default now(),
  unique (studio_id, id),
  unique (studio_id, commessa_id, id),
  unique (incarico_id, numero),
  foreign key (studio_id, commessa_id)              references public.commesse(studio_id, id),
  foreign key (studio_id, commessa_id, incarico_id) references public.incarichi(studio_id, commessa_id, id)
);

-- Foto, schizzi e note vocali di un sopralluogo o di un SAL
create table public.allegati (
  id             uuid primary key default gen_random_uuid(),
  studio_id      uuid not null references public.studi(id),
  commessa_id    uuid not null,
  sopralluogo_id uuid,
  sal_id         uuid,
  tipo           text not null default 'foto' check (tipo in ('foto', 'schizzo', 'audio')),
  percorso       text not null unique,
  didascalia     text,
  ordine         int not null default 0,
  byte           int,
  durata_s       int,               -- solo note vocali
  caricato_da    uuid default auth.uid(),
  eliminato      boolean not null default false,
  eliminato_il   timestamptz,
  creato_il      timestamptz not null default now(),
  aggiornato_il  timestamptz not null default now(),
  unique (studio_id, id),
  unique (studio_id, commessa_id, id),
  check (num_nonnulls(sopralluogo_id, sal_id) = 1),
  -- il file sta sempre nella cartella dello studio
  check (percorso like 'studi/' || studio_id::text || '/%'),
  foreign key (studio_id, commessa_id, sopralluogo_id) references public.sopralluoghi(studio_id, commessa_id, id),
  foreign key (studio_id, commessa_id, sal_id)         references public.sal(studio_id, commessa_id, id)
);

-- Foto assegnate a una ditta (togliere l'assegnazione = eliminato)
create table public.allegati_ditte (
  studio_id     uuid not null references public.studi(id),
  commessa_id   uuid not null,
  allegato_id   uuid not null,
  incarico_id   uuid not null,
  eliminato     boolean not null default false,
  eliminato_il  timestamptz,
  aggiornato_il timestamptz not null default now(),
  primary key (allegato_id, incarico_id),
  foreign key (studio_id, commessa_id, allegato_id) references public.allegati(studio_id, commessa_id, id),
  foreign key (studio_id, commessa_id, incarico_id) references public.incarichi(studio_id, commessa_id, id)
);

-- ===== Importi: solo titolare =====

create table public.importi_incarico (
  incarico_id       uuid primary key,
  studio_id         uuid not null references public.studi(id),
  importo_contratto numeric(12,2) check (importo_contratto >= 0),
  note              text,
  aggiornato_il     timestamptz not null default now(),
  foreign key (studio_id, incarico_id) references public.incarichi(studio_id, id)
);

-- Importi del SAL. Ritenuta e IVA: percentuali inserite a mano, nessun valore fisso.
create table public.importi_sal (
  sal_id              uuid primary key,
  studio_id           uuid not null references public.studi(id),
  lavori_eseguiti     numeric(12,2) not null default 0 check (lavori_eseguiti >= 0),     -- progressivo a oggi
  sal_precedenti      numeric(12,2) not null default 0 check (sal_precedenti >= 0),      -- gia' compreso nei SAL precedenti
  ritenuta_perc       numeric(5,2)  not null default 0 check (ritenuta_perc between 0 and 100),
  iva_perc            numeric(5,2)  not null default 0 check (iva_perc between 0 and 100),
  importo_sal  numeric(12,2) generated always as (lavori_eseguiti - sal_precedenti) stored,
  ritenuta     numeric(12,2) generated always as (round((lavori_eseguiti - sal_precedenti) * ritenuta_perc / 100, 2)) stored,
  imponibile   numeric(12,2) generated always as ((lavori_eseguiti - sal_precedenti) - round((lavori_eseguiti - sal_precedenti) * ritenuta_perc / 100, 2)) stored,
  iva          numeric(12,2) generated always as (round(((lavori_eseguiti - sal_precedenti) - round((lavori_eseguiti - sal_precedenti) * ritenuta_perc / 100, 2)) * iva_perc / 100, 2)) stored,
  totale       numeric(12,2) generated always as (
                 ((lavori_eseguiti - sal_precedenti) - round((lavori_eseguiti - sal_precedenti) * ritenuta_perc / 100, 2))
                 + round(((lavori_eseguiti - sal_precedenti) - round((lavori_eseguiti - sal_precedenti) * ritenuta_perc / 100, 2)) * iva_perc / 100, 2)) stored,
  note                text,
  aggiornato_il       timestamptz not null default now(),
  foreign key (studio_id, sal_id) references public.sal(studio_id, id)
);

-- Indici
create index on public.ditte (studio_id) where not eliminato;
create index on public.incarichi (studio_id, commessa_id) where not eliminato;
create index on public.incarichi (studio_id, ditta_id);
create index on public.sopralluoghi (studio_id, commessa_id, data) where not eliminato;
create index on public.sopralluoghi (studio_id, pratica_id);
create index on public.sopralluoghi (studio_id, responsabile_id);
create index on public.sopralluogo_ditte (studio_id, commessa_id, incarico_id);
create index on public.sopralluogo_ditte (studio_id, commessa_id, sopralluogo_id);
create index on public.sal (studio_id, commessa_id, incarico_id) where not eliminato;
create index on public.allegati (studio_id, commessa_id, sopralluogo_id) where not eliminato;
create index on public.allegati (studio_id, commessa_id, sal_id) where not eliminato;
create index on public.allegati_ditte (studio_id, commessa_id, incarico_id) where not eliminato;
create index on public.allegati_ditte (studio_id, commessa_id, allegato_id);
create index on public.importi_incarico (studio_id, incarico_id);
create index on public.importi_sal (studio_id, sal_id);

-- =========================================================
-- TRIGGER
-- =========================================================

create trigger aggiornato_il before update on public.ditte        for each row execute function public.tocca_aggiornato_il();
create trigger aggiornato_il before update on public.incarichi    for each row execute function public.tocca_aggiornato_il();
create trigger aggiornato_il before update on public.sopralluoghi for each row execute function public.tocca_aggiornato_il();
create trigger aggiornato_il before update on public.sal          for each row execute function public.tocca_aggiornato_il();
create trigger aggiornato_il before update on public.allegati     for each row execute function public.tocca_aggiornato_il();
create trigger aggiornato_il before update on public.allegati_ditte for each row execute function public.tocca_aggiornato_il();
create trigger aggiornato_il before update on public.sopralluogo_ditte for each row execute function public.tocca_aggiornato_il_studio();
create trigger aggiornato_il before update on public.importi_incarico  for each row execute function public.tocca_aggiornato_il_studio();
create trigger aggiornato_il before update on public.importi_sal       for each row execute function public.tocca_aggiornato_il_studio();

-- Numero del SAL: progressivo per ditta della commessa, deciso dal database.
-- Security definer per contare anche i SAL eliminati; il lock evita due SAL con lo stesso numero.
create function public.numera_sal()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.incarichi where id = new.incarico_id for update;
  select coalesce(max(s.numero), 0) + 1 into new.numero
  from public.sal s where s.incarico_id = new.incarico_id;
  return new;
end;
$$;

create trigger numero before insert on public.sal for each row execute function public.numera_sal();

-- Il numero e la ditta di un SAL non si cambiano dopo l'inserimento
create function public.blocca_numero_sal()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.numero <> old.numero or new.incarico_id <> old.incarico_id then
    raise exception 'Numero e ditta del SAL non sono modificabili';
  end if;
  return new;
end;
$$;

create trigger numero_fisso before update on public.sal for each row execute function public.blocca_numero_sal();

-- =========================================================
-- PERMESSI
-- =========================================================

-- Supabase da' privilegi larghi in automatico: si parte da zero e si concede il necessario, senza DELETE
revoke all on public.ditte, public.incarichi, public.sopralluoghi, public.sopralluogo_ditte, public.sal,
  public.allegati, public.allegati_ditte, public.importi_incarico, public.importi_sal
  from anon, authenticated;

grant select, insert, update on public.ditte, public.incarichi, public.sopralluoghi, public.sopralluogo_ditte,
  public.allegati, public.allegati_ditte, public.importi_incarico
  to authenticated;
-- sal: numero assegnato dal trigger
grant select on public.sal to authenticated;
grant insert (studio_id, commessa_id, incarico_id, data, avanzamento, descrizione, note) on public.sal to authenticated;
grant update (data, avanzamento, descrizione, note, eliminato) on public.sal to authenticated;
-- importi_sal: le colonne calcolate non si scrivono
grant select on public.importi_sal to authenticated;
grant insert (sal_id, studio_id, lavori_eseguiti, sal_precedenti, ritenuta_perc, iva_perc, note) on public.importi_sal to authenticated;
grant update (lavori_eseguiti, sal_precedenti, ritenuta_perc, iva_perc, note) on public.importi_sal to authenticated;

-- Funzioni dei trigger: non chiamabili dall'API
revoke execute on function public.numera_sal(), public.blocca_numero_sal() from public, anon, authenticated;

-- =========================================================
-- RLS
-- =========================================================

alter table public.ditte             enable row level security;
alter table public.incarichi         enable row level security;
alter table public.sopralluoghi      enable row level security;
alter table public.sopralluogo_ditte enable row level security;
alter table public.sal               enable row level security;
alter table public.allegati          enable row level security;
alter table public.allegati_ditte    enable row level security;
alter table public.importi_incarico  enable row level security;
alter table public.importi_sal       enable row level security;

-- Tabelle di lavoro: tutti i membri attivi dello studio
do $$
declare
  t text;
begin
  foreach t in array array['ditte', 'incarichi', 'sopralluoghi', 'sopralluogo_ditte', 'sal', 'allegati', 'allegati_ditte'] loop
    execute format(
      'create policy %1$s_select on public.%1$I for select to authenticated using (studio_id = (select public.mio_studio_id()))', t);
    execute format(
      'create policy %1$s_insert on public.%1$I for insert to authenticated with check (studio_id = (select public.mio_studio_id()))', t);
    execute format(
      'create policy %1$s_update on public.%1$I for update to authenticated using (studio_id = (select public.mio_studio_id())) with check (studio_id = (select public.mio_studio_id()))', t);
  end loop;
end;
$$;

-- Importi: solo il titolare, in lettura e in scrittura
do $$
declare
  t text;
begin
  foreach t in array array['importi_incarico', 'importi_sal'] loop
    execute format(
      'create policy %1$s_select on public.%1$I for select to authenticated using (studio_id = (select public.mio_studio_id()) and (select public.sono_titolare()))', t);
    execute format(
      'create policy %1$s_insert on public.%1$I for insert to authenticated with check (studio_id = (select public.mio_studio_id()) and (select public.sono_titolare()))', t);
    execute format(
      'create policy %1$s_update on public.%1$I for update to authenticated using (studio_id = (select public.mio_studio_id()) and (select public.sono_titolare())) with check (studio_id = (select public.mio_studio_id()))', t);
  end loop;
end;
$$;

-- =========================================================
-- FILE: bucket privato `documenti`
-- =========================================================
-- Percorsi studi/<studio_id>/...: ogni studio legge e carica solo nella sua cartella.
-- Nessuna policy di UPDATE o DELETE: i file caricati non si sovrascrivono e non si cancellano dall'app.
-- Limite 5 MB a file; tipi ammessi: foto, schizzi, note vocali, PDF.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documenti', 'documenti', false, 5242880,
        array['image/jpeg', 'image/png', 'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'application/pdf']);

create policy documenti_select on storage.objects for select to authenticated
  using (bucket_id = 'documenti'
         and (storage.foldername(name))[1] = 'studi'
         and (storage.foldername(name))[2] = (select public.mio_studio_id())::text);

create policy documenti_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documenti'
              and (storage.foldername(name))[1] = 'studi'
              and (storage.foldername(name))[2] = (select public.mio_studio_id())::text);
