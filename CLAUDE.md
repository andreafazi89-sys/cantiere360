# Cantiere 360°

App web per studi tecnici (architetti, geometri, ingegneri): commesse, pratiche edilizie, scadenze; poi sopralluoghi e direzione lavori. Multi-studio: ogni studio si registra e trova la sua app vuota.

Progetto separato da CommessaPro (Pierantoni SRL): repo, database e utenti diversi, nessun dato in comune. Non riusare tabelle, chiavi o bucket di CommessaPro.

## Architettura

- Pagine HTML in root, JS vanilla, supabase-js da CDN jsdelivr con versione esatta (oggi 2.117.3, stessa in tutte le pagine). Codice condiviso in `js/` e `css/`. Nessun build, nessun framework, nessun npm.
- Hosting: GitHub Pages dal branch `main` (repo pubblico).
- Backend: Supabase piano Free, regione UE, progetto dedicato `cantiere360` (ref `wblgaanxwirmxsawvnjm`, eu-west-1, creato il 20/10/2026).
- Nel codice va solo la publishable key (o anon key) di Supabase. Mai service_role, password o token.

### Modello dati

- Il centro e' la **commessa** (cliente, immobile, dati catastali). Pratiche, scadenze, sopralluoghi, DL stanno dentro la commessa.
- Ogni tabella ha `studio_id` (uuid, not null) e RLS attiva. Niente tabelle chiave/valore.
- Cancellazioni: colonna `eliminato boolean default false` (+ `eliminato_il`), mai `delete` dall'app. Le policy non concedono DELETE.
- File: bucket privato `documenti`, percorsi `studi/<studio_id>/...`, accesso con link firmati a scadenza.

### Sicurezza (RLS)

- Funzione `public.mio_studio_id()` (security definer, stable): restituisce lo studio dell'utente loggato da `membri` (attivo = true).
- Policy tipo su ogni tabella: `studio_id = mio_studio_id()` in select/insert/update.
- Creazione studio solo tramite RPC `crea_studio(nome)`: crea `studi` + riga `membri` titolare in un'unica transazione.
- Operazioni riservate al titolare (dati studio, collaboratori) controllate in policy, non solo nella UI.
- Supabase concede in automatico EXECUTE ad `authenticated` su ogni funzione nuova: nelle migrazioni revocarlo sempre per le funzioni dei trigger e per quelle non pensate per l'API. Le tabelle nuove vanno concesse esplicitamente (`grant`), senza DELETE.
- Dopo ogni migrazione: test di isolamento (`sql/test/`) e controllo advisor di sicurezza Supabase.

## Struttura repo

```
index.html        login, registrazione, crea il tuo studio, recupero password
scadenze.html     riepilogo scadenze di tutte le commesse (pagina iniziale)
commesse.html     elenco commesse
commessa.html     scheda commessa (dati, pratiche, scadenze)
pratica.html      scheda pratica (stato, scadenze, storico)
clienti.html      rubrica
studio.html       dati studio, persone, tipi e stati pratica
css/stile.css     stile comune
js/comune.js      client Supabase, sessione, date, helper condivisi
js/scadenze.js    lettura scadenze, riga, spunta, finestra nuova scadenza
js/commesse.js    finestra commessa
js/pratiche.js    finestra pratica
sql/NNN_nome.sql  migrazioni in ordine, mai modificate dopo l'applicazione
sql/test/         test di isolamento SQL con due studi finti
test/locale/      ambiente locale (Postgres + PostgREST + auth finta) e prova Playwright
docs/piano.md     piano e decisioni
```

## Regole

1. Nessuno studio deve mai vedere i dati di un altro. Ogni modifica a tabelle o RLS: nuova migrazione in `sql/` + test con due studi finti (`sql/test/`), sia lettura sia scrittura incrociata.
2. Schema DB, RLS, permessi: branch e PR, con riassunto in parole semplici di cosa cambia e cosa puo' rompersi, poi attendere l'ok di Andrea. Modifiche piccole alle pagine: push diretto su `main`.
3. Restare nei limiti gratuiti (Supabase Free: 500 MB database per progetto, 1 GB file, 5 GB egress, pausa dopo 7 giorni di inattivita', backup non scaricabili). Niente servizi a pagamento.
4. Prima di operazioni distruttive sui dati: dry-run e backup (export SQL manuale, il piano Free non da' backup scaricabili).
5. Non citare norme, termini di legge o articoli senza averli verificati. Le scadenze si inseriscono a mano finche' i riferimenti non sono verificati.
6. Dopo ogni modifica a un HTML controllare la console: niente graffe doppie, apostrofi escapati nelle stringhe italiane tra apici singoli (es. `'l\'agenda'`).
7. Testi in italiano, date gg/mm/aaaa, valuta euro.
