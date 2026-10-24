# Piano Cantiere 360°

Aggiornato il 20/10/2026.

## Decisioni prese

- Progetto separato da CommessaPro: repo `cantiere360` (pubblico), progetto Supabase dedicato in UE.
- Tutto gratis: GitHub Free + Pages, Supabase Free (verificato il 20/10/2026 sulla documentazione Supabase: 2 progetti gratuiti attivi per account, 500 MB database per progetto, 1 GB file, 5 GB egress, 50.000 utenti attivi al mese, pausa dopo 7 giorni di bassa attivita' e ripristino entro 90 giorni, backup non scaricabili). Confrontati Firebase, Appwrite, PocketBase: resta Supabase.
- Stack come CommessaPro: HTML single-file, JS vanilla, supabase-js da CDN.
- Multi-studio da subito, RLS su ogni tabella, bucket privato, cancellazioni logiche.
- Centro dell'app: la commessa.

## Primo modulo

Commesse, pratiche con stati e storico, scadenze, rubrica clienti, registrazione "crea il tuo studio".

### Tabelle

- `studi`: id, nome, partita_iva, indirizzo, logo_path, creato_il
- `membri`: id, studio_id, utente_id (auth.users), nome, ruolo (`titolare`, `collaboratore`), attivo
- `clienti`: id, studio_id, nome, cf_piva, email, telefono, indirizzo, note, eliminato
- `commesse`: id, studio_id, cliente_id, codice, titolo, colore, comune, indirizzo, foglio, particella, sub, stato, note, eliminato, aggiornato_il
- `pratiche`: id, studio_id, commessa_id, tipo, oggetto, protocollo, data_presentazione, stato, responsabile_id (membri), note, eliminato, aggiornato_il
- `scadenze`: id, studio_id, commessa_id, pratica_id (facoltativo), descrizione, data, responsabile_id, fatta, fatta_il, eliminato
- `storico_pratica`: id, studio_id, pratica_id, da_stato, a_stato, data, utente_id, nota (scritto da trigger)
- `tipi_pratica`, `stati_pratica`: liste modificabili per studio, precaricate alla creazione dello studio

Differenze rispetto alla bozza iniziale:
- `scadenze` ha sempre `commessa_id`; `pratica_id` e' facoltativo. Serve per scadenze di commessa non legate a una pratica e per raggruppare il riepilogo per commessa senza join.
- Cliente e dati catastali stanno sulla commessa; la pratica li eredita (niente doppioni da tenere allineati).
- `commesse.colore`: un colore per commessa, usato nel riepilogo scadenze.

### Tipi di pratica (precaricati, modificabili)
CILA, SCIA, SCIA alternativa al permesso, Permesso di costruire, Segnalazione certificata di agibilita', Autorizzazione paesaggistica, Deposito sismico, DOCFA, Accesso agli atti, Altro.

### Stati pratica (precaricati, modificabili)
In preparazione, Presentata, Integrazioni richieste, Efficace/rilasciata, Lavori in corso, Fine lavori, Chiusa, Archiviata.

## Riepilogo scadenze multi-commessa

E' la pagina principale. Le scadenze di commesse diverse si mescolano: va bene, perche' l'ordine che conta e' quello temporale, ma ogni riga deve dire subito a quale commessa appartiene.

- Vista predefinita "Per data": gruppi Scadute (non fatte), Questa settimana, Prossimi 30 giorni, Piu' avanti. Ogni riga: data, descrizione, etichetta commessa (codice + colore), pratica collegata, responsabile.
- Interruttore "Per commessa": stesse scadenze raggruppate per commessa, commesse ordinate per scadenza piu' vicina; ogni gruppo comprimibile con conteggio (es. "3 aperte, 1 scaduta").
- Filtri: commessa (scelta multipla), responsabile ("solo le mie"), tipo pratica, mostra fatte. I filtri restano memorizzati sul dispositivo.
- Dalla scheda commessa: stesso componente, filtrato su quella commessa.
- Spunta "fatta" direttamente dalla riga.

## Pagine
1. `index.html`: login, registrazione, crea il tuo studio
2. `scadenze.html`: riepilogo scadenze (pagina iniziale dopo il login)
3. `commesse.html` e `commessa.html`: elenco e scheda con pratiche, scadenze, storico
4. `clienti.html`: rubrica
5. `studio.html`: dati studio e collaboratori (solo titolare)

## Direzione lavori (migrazione 003, ottobre 2026)

Decisioni con Andrea del 24/10/2026:
- Rubrica Ditte a parte (pagina Ditte nel menu): una ditta lavora su piu' commesse anche in periodi diversi. Nella commessa si sceglie la ditta dalla rubrica e si aggiungono solo lavorazioni e contratto; i dati della ditta si modificano solo in rubrica.
- Nella commessa: ditte al lavoro, sopralluoghi, SAL.
- Sopralluogo: data, ora, tipo, responsabile, pratica collegata, presenti, osservazioni, disposizioni generali, posizione GPS; foto (scatto, raffica, galleria), schizzi anche sopra una foto, note vocali; niente meteo e firme.
- Ogni foto si assegna a una o piu' ditte; il PDF per una ditta contiene solo le sue foto, le disposizioni generali e le sue note.
- SAL classico per ditta, numerato in automatico; importi (contratto, lavori eseguiti, SAL precedenti, ritenuta % e IVA % inserite a mano) visibili e scrivibili solo dal titolare, controllo nel database.
- Invio: PDF con pulsanti Email e WhatsApp. Sul telefono si apre la condivisione con il PDF allegato; sul computer il PDF si scarica e si apre la mail o WhatsApp Web con il testo pronto (una pagina web non puo' allegare file a mailto o wa.me).
- Word con sole foto (griglia 2x2, 8x6 cm), anche filtrato per ditta.
- Foto ridotte a 1600 px, qualita' 0,75. File mai cancellati dall'app (solo marcati eliminati).

## Fuori dal primo modulo
Documenti e tavole, giornale dei lavori, parcelle e incassi, promemoria via email, scadenze calcolate dal tipo di pratica (solo con riferimenti normativi verificati), collegamento con i cantieri delle imprese.

## Punti aperti
- Email di conferma registrazione: il server email integrato di Supabase ha un limite orario basso; per la prova con un solo studio basta, prima di aprire ad altri serve un SMTP proprio (gratuito) o va valutato.
- Pausa per inattivita': se l'app non viene usata per una settimana il progetto si ferma e va riattivato dalla dashboard.
- Backup: export SQL manuale periodico, da definire.

## Passi
1. Repo `cantiere360` con CLAUDE.md e questo piano.
2. Progetto Supabase Free in UE.
3. Migrazioni SQL con RLS, test di isolamento con due studi finti (lettura e scrittura incrociata, sia da UI sia chiamando il DB).
4. Pagine del primo modulo.
5. Prova con l'amica architetta, parere settimanale.
