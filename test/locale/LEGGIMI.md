# Prova locale delle pagine

Ambiente usa e getta per provare le pagine con due studi finti, senza toccare il progetto Supabase vero.
Il segreto JWT in `server.js` e `postgrest.conf` vale solo per questo ambiente locale.

Serve: PostgreSQL 16, PostgREST 12 (binario da GitHub releases), Node 22 con `pg`, Playwright.

1. Avvia Postgres sulla porta 54329, crea il database `c360`.
2. `psql -d c360 -f test/locale/bootstrap.sql` (ruoli e schema `auth` come Supabase), poi tutte le `sql/0*.sql` in ordine.
3. `postgrest test/locale/postgrest.conf` (porta 54330).
4. `node test/locale/server.js <cartella repo>` (porta 54331): auth finta, proxy REST, file statici.
5. `SBJS=<supabase.js UMD 2.117.3> SHOTS=<cartella screenshot> node test/locale/prova.js`

`prova.js` registra lo studio A, crea cliente, commesse, pratica, scadenze, prova le due viste del riepilogo,
poi registra lo studio B e verifica che non veda nulla di A (anche aprendo una commessa di A per id).
Stampa gli errori della console del browser.

`bootstrap.sql` imita anche Supabase Storage (`storage.buckets`, `storage.objects`, `storage.foldername`) e `server.js` risponde
a caricamento e link firmati applicando le policy di `storage.objects` come utente loggato. Le librerie si prendono da npm
(`npm pack`), servono anche jsPDF 4.2.1 e docx 9.7.2.

`prova_dl.js` (migrazione 003): ditte in commessa, sopralluogo con foto per ditta, raffica, schizzo, nota vocale (fotocamera e
microfono finti di Chromium), PDF per ditta e per lo studio, Word, SAL con importi, collaboratore senza importi, studio B senza accesso.
`SBJS=... JSPDF=... DOCX=... IMG=<cartella con foto1..4.jpg> SHOTS=... OUT=... node test/locale/prova_dl.js`
