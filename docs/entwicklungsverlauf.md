# Entwicklungsverlauf

Chronologisches Protokoll der Arbeitspakete, der Probleme und der
Entscheidungen. Geschrieben als Gedaechtnisstuetze, nicht als Werbetext —
deshalb stehen hier auch die Fehler und die Sackgassen.

Stand: 11 gemergte Pull Requests, 48 Commits, 5 Migrationen, 135 Tests.

---

## Phase 1: der Kern

### AP1 — Notebooks anlegen und auflisten (PR #1)

Startseite als Server Component, Anlegen ueber Server Action, Detailseite mit
`not-found`.

**Probleme:**

- **Supabase antwortete auf jede Abfrage mit `42501 permission denied`.**
  `0001_init.sql` legte die Tabellen an, vergab aber keine Rechte. Behoben mit
  `0002_grants.sql`. Dabei die Entscheidung: **nur `service_role` bekommt
  Rechte**, `anon` bewusst nicht — der Publishable Key liegt im Client-Bundle,
  und der Browser soll nie direkt mit Supabase sprechen. Zusaetzlich RLS an,
  ohne Policies, als zweite Schranke.
- **`"use server"`-Datei exportierte ein Objekt.** Eine solche Datei darf
  ausschliesslich async Funktionen exportieren. Der Build war gruen, der Fehler
  kam erst beim Absenden des Formulars — die Pruefung greift erst bei der
  Modulauswertung.
- **`export const dynamic = "force-dynamic"`** noetig, sonst haette Next die
  Supabase-Abfragen zur Build-Zeit ausgefuehrt und das Ergebnis statisch
  ausgeliefert.
- **`lib/notebook-limits.ts` entstand als eigenes Modul**, weil ein Import der
  Laengenkonstante aus `lib/notebooks.ts` in eine Client-Komponente den
  Supabase-Server-Client in den Browser-Bundle gezogen haette.

### AP2 — Quellen hinzufuegen (PR #2)

Datei-Upload nach Supabase Storage, URL-Eingabe, Statusanzeige.

**Entscheidungen:**

- Privater Bucket, Upload durch eine Server Action. Kostet das Body-Limit als
  Obergrenze (`bodySizeLimit: "4.4mb"`, Vercel deckelt bei 4,5 MB), haelt aber
  den Secret-Key serverseitig.
- Groesse und Dateityp werden **dreifach** geprueft: Formular, Server Action,
  Bucket (`file_size_limit`, `allowed_mime_types`).
- Der Objektname im Bucket ist eine frische UUID unter `notebook_id/`, die
  Endung kommt aus dem Mime-Type. Der Dateiname des Nutzers landet nur im Titel
  und kann den Pfad nicht beeinflussen.
- Erst hochladen, dann die Zeile schreiben; scheitert das Insert, wird die Datei
  wieder entfernt.
- Check-Constraint `sources_location_check`: `type = 'url'` braucht `url` und
  kein `storage_path`, bei `pdf`/`text` umgekehrt.

**Beim Testen gefunden:** React setzt das Formular nach jeder Action zurueck,
auch bei Fehlern — eine vertippte URL war weg. Behoben, indem die Action die
abgelehnte Adresse zurueckgibt und ein `key` am Input das Neumounten erzwingt.

### AP3 — Ingestion (PR #3)

PDF ueber `unpdf` seitenweise, Textdateien direkt, Webseiten ueber
`@mozilla/readability`. Chunking mit Ueberlappung, Embedding, Statuspflege.

**Der wichtigste Fund: gemessene Kontingente statt geratener.**

```
quotaId    EmbedContentRequestsPerMinutePerUserPerProjectPerModel-FreeTier
quotaValue 100        (jedes Element eines Batches zaehlt einzeln)
retryDelay 14s
```

Daraus folgen drei Zahlen im Code: Batchgroesse 100, Wartebudget 45 s,
`MAX_CHUNKS_PER_SOURCE = 200`. Ein Lauf ueber 120 Texte dauerte gemessen
22,9 Sekunden, weil die zweite Haelfte auf das naechste Minutenfenster wartet.
Deshalb `maxDuration = 60` auf der Route.

**Zwei Fehler, die ein Eigenschaftstest des Chunkers fand** — beide haetten
nicht gekracht, sondern still die Retrieval-Qualitaet ruiniert:

1. **Die Ueberlappung griff nie.** Sie war absatzweise gebaut und uebertrug nur
   Absaetze unter 200 Zeichen; reale Absaetze sind laenger. 0 von 9 Uebergaengen.
   Jetzt wird das Ende des letzten Blocks an einer Satzgrenze uebernommen.
2. **Harte Zeilenumbrueche blieben stehen.** `"Satz\nwurde\numbrochen"` ging
   unveraendert ins Embedding — genau das Muster, das jede PDF-Extraktion
   erzeugt.

**Weitere Entscheidungen:**

- Ein Chunk gehoert immer zu genau einer Seite. Sonst waere die Seitenzahl im
  Zitat gelogen.
- `claimSource` dreht den Status bedingt (`pending`/`error` → `processing`) und
  bekommt die Zeile nur zurueck, wenn das Update gegriffen hat. Das macht den
  Statuswechsel zur Sperre. Test mit fuenf parallelen Versuchen: einer gewinnt.
- `embedding` geht als Textform `'[0.1,0.2,...]'` in die Spalte.
- SSRF-Schutz auf Hostnamen-Ebene (spaeter in PR #9 verschaerft).

### AP4 — Retrieval und Chat (PR #4)

Erster Route Handler im Projekt — Server Actions koennen nicht streamen.

**Messungen, die das Design praegten:**

| Messung | Ergebnis |
| --- | --- |
| `gemini-2.5-flash` | fuer neue Nutzer gesperrt (404) |
| `gemini-3.7-flash` | 35–53 s pro Antwort |
| `gemini-3.5-flash` | 1,6–1,8 s → wurde Standard |
| ohne `thinkingConfig` | erstes Zeichen nach 7246 ms |
| `thinkingBudget: 0` | erstes Zeichen nach **1070 ms**, gleiche Antwortlaenge |

**Entscheidungen:**

- **Ohne tragfaehigen Kontext wird das Modell gar nicht erst gefragt.** Liegt
  der beste Treffer unter 0,55, gibt es eine feste Absage. Gemessen: passende
  Fragen 0,63–0,83, die unpassende Frage nach einem Kartoffelsalat-Rezept 0,50.
- **NDJSON statt reinem Text** als Streamformat, weil die Zuordnung von `[n]`
  zur Quelle auch im Browser ankommen muss.
- **Zwei Abfragen im Retrieval statt einer.** `match_chunks` gibt weder
  `metadata` noch Quellenangaben zurueck. Die Funktion zu erweitern haette ihre
  Signatur mit `vector(1536)` neu geschrieben — und die Embedding-Dimension an
  einer dritten Stelle gefuehrt. Das verbietet die Projektkonvention.
- **`lib/gemini.ts`** entstand, weil Chat und Embeddings dieselbe Retry- und
  Rate-Limit-Logik brauchen. Zwei Kopien waeren auseinandergelaufen.

**Nachbesserungen aus dem Browsertest:**

- Die Antwort kam mit Markdown-Sternchen als Rohtext. Statt eines
  Markdown-Renderers (Abhaengigkeit plus XSS-Flaeche) verbietet der Prompt
  Markdown.
- Unter der Antwort standen **alle acht** Auszuege, obwohl drei zitiert waren.
  Jetzt werden die `[n]` aus dem Text gelesen und nur die verwendeten gezeigt.

**Nachgezogen im selben Paket:** Folgefragen werden vor der Suche aufgeloest
(„Wofuer wird das eingesetzt?" → „Wofuer wird Retrieval-Augmented Generation
eingesetzt?"). Dabei der zweite Kontingentfund:

```
quotaId    GenerateRequestsPerDayPerProjectPerModel-FreeTier
quotaValue 20      ← pro TAG, nicht pro Minute
```

Deshalb eine Vorpruefung: umgeschrieben wird nur bei echtem Rueckbezug oder sehr
kurzer Frage. Sonst haette jede Folgefrage das Tagesbudget halbiert.

### AP5 — Klickbare Zitate (PR #5)

Der Kern des Produkts.

**Entscheidungen:**

- Der Chunk-Text geht im Stream mit (rund 8 KB), damit ein Klick keinen
  Netzwerkaufruf kostet.
- Der Bucket bleibt privat; eine Server Action erzeugt bei Bedarf eine signierte
  URL mit 300 s Gueltigkeit. Bei PDFs haengt `#page=N` an.
- Eine Nummer ohne zugehoerigen Auszug bleibt schlichter Text — ein Knopf, der
  ins Leere fuehrt, waere schlimmer als keiner.
- Natives `dialog`-Element statt eines Pakets.

**Der Fehler, den nur der Browsertest zeigte:** `onClose` als React-Prop am
`<dialog>` bleibt stumm — das native close-Ereignis steigt nicht auf, und Reacts
Delegation faengt es nicht. Folge: nach dem Schliessen blieb die Komponente
eingehaengt, **ein zweiter Klick auf dieselbe Nummer bewirkte nichts.** In Build
und Lint unsichtbar.

Der erste Reparaturversuch (Listener auf `close`) half nicht. Ursachensuche
ergab: in der Testumgebung feuert selbst ein frisch erzeugter, blanker Dialog
beim programmatischen `close()` kein Ereignis. Das Schliessen laeuft deshalb
ueber einen ausdruecklichen Aufruf, mit `cancel` und `close` zusaetzlich fuer die
Wege, die der Browser selbst ausloest.

**Zwei Dinge blieben damals unverifiziert** (Tageskontingent erschoepft, und die
Browser-Ansicht nimmt keine echten Tastatureingaben an): Escape und der
Durchstich mit einer echten Antwort. Beides wurde spaeter nachgeholt und
bestaetigt.

---

## Nachgezogen nach Phase 1

### Loeschen (PR #6)

Notebooks und Quellen loeschen.

**Der Punkt, um den es ging:** Foreign Keys raeumen Chunks und Quellen ab, **der
Storage kennt kein Kaskadieren.** Beim Notebook muessen die Dateipfade
eingesammelt werden, *bevor* die Zeilen geloescht werden — danach waere nicht
mehr auffindbar, welche Dateien dazugehoerten.

Bei einer einzelnen Quelle: erst die Datei, dann die Zeile. Scheitert der zweite
Schritt, bleibt eine sichtbare Quelle ohne Datei — ein Zustand, den der Nutzer
sieht und durch erneutes Loeschen beheben kann. Andersherum bliebe eine
verwaiste Datei im Bucket, die niemand mehr findet.

### Tests (PR #7)

Vitest, 89 Tests zunaechst. Bewusst nur reine Logik.

**Der wichtigste Vorgang:** Die Tests wurden **gegen die echten Fehler
geprueft** — beide Chunker-Bugs wieder eingebaut, Testlauf beobachtet, Code
wiederhergestellt.

Der erste Durchlauf blieb dabei **gruen**, obwohl der Fehler drin war. Ursache
war der Testdatengenerator: er zog aus zwoelf Woertern und lieferte bei Seed 0
und Seed 12 denselben Absatz. Von 40 Absaetzen waren nur 12 verschieden, und die
Wiederholungen liessen die Enthaelt-Pruefung zufaellig durchgehen. **Ohne diese
Gegenprobe waere ein Test entstanden, der genau den Fehler durchgelassen haette,
fuer den er geschrieben wurde.**

Ein weiterer Test fiel durch und zeigte eine echte Grenze: „das" ist im
Deutschen weit haeufiger Artikel als Rueckbezug. Die Heuristik wurde bewusst
**nicht** entschaerft — der Fehlalarm kostet einen Aufruf, die Gegenrichtung
koennte eine Folgefrage ungeloest in die Suche schicken. Die Entscheidung steht
als eigener Test mit Begruendung im Repo.

### SSRF ueber DNS (PR #9)

**Das Problem:** `isBlockedHost` prueft den Namen. Ein Angreifer registriert
einen unauffaelligen Namen und laesst ihn per DNS auf `169.254.169.254` zeigen.

**Warum der naheliegende Fix nicht reicht:** Erst aufloesen, pruefen, dann
abrufen — die Abrufschicht fragt das DNS erneut, und ein Server mit kurzer TTL
kann beim zweiten Mal etwas anderes liefern (DNS-Rebinding).

**Die Loesung:** Die Pruefung haengt in der `lookup`-Funktion, die `node:https`
beim Verbindungsaufbau ruft. Geprueft wird die Adresse, zu der auch verbunden
wird. Preis: `fetch` wurde fuer diesen Pfad durch `node:https` ersetzt.

**Zwei Regressionen, die der Umbau einschleppte:**

1. **Wikipedia antwortete mit 403** — `fetch` schickt automatisch einen
   User-Agent, `node:https` nicht.
2. **gzip** — `fetch` entpackt selbst, `node:https` nicht. Ohne
   `accept-encoding: identity` waere lautlos Binaermuell ins Embedding gelaufen.

Abgedeckt sind auch Carrier-Grade NAT (100.64/10), Benchmarking (198.18/15) und
**IPv4-in-IPv6** (`::ffff:127.0.0.1` — die klassische Umgehung).

### Fehlergrund einer Quelle (PR #10)

Vorher blieb bei einem Fehlschlag nur `status = 'error'`; die Meldung lebte im
React-Zustand und war nach einem Reload weg.

Ein Constraint erlaubt die Meldung nur bei `status = 'error'`. Das zwingt den
Code, sie beim erneuten Verarbeiten wegzuraeumen — `claimSource` macht das im
selben Update, mit dem es die Quelle beansprucht.

**Organisatorisches Problem:** Der Branch war gepusht, aber **es wurde nie ein
PR angelegt.** Der `gh pr create`-Befehl lief nicht durch. Dadurch hing die
Arbeit vier Arbeitspakete lang unbemerkt, waehrend die Migration in der
Datenbank bereits gelaufen war. Lehre: nach `gh pr create` mit
`gh pr list --state open` nachsehen.

### Chatverlauf (PR #11)

Tabelle `messages` mit `citations` als jsonb.

**Entscheidungen:**

- Belege als **Momentaufnahme**, nicht als Verweis auf `chunks`. Ein Verweis
  ginge ins Leere, sobald die Quelle geloescht wird.
- **Der Server ist die einzige Wahrheit ueber den Verlauf.** Der Browser schickt
  nur die Frage.
- Die Frage wird sofort gespeichert, nicht erst mit der Antwort.
- Auch die Absage „Dazu finde ich nichts in deinen Quellen" landet im Verlauf.

**Der Vorfall, der am meisten Zeit kostete:** Beim Ausprobieren kam auf eine
Frage nur `"Unter Retrieval"` zurueck — ein abgebrochener Halbsatz.

Die Diagnose lief in vier Schritten, jeder schloss eine Moeglichkeit aus:

| Test | Ergebnis |
| --- | --- |
| Rohdaten des Anbieters | vier Ereignisse, vollstaendiger Satz |
| `streamAnswer` isoliert | 3 Stuecke, vollstaendig |
| `/api/chat` direkt, ohne Browser | 8 Deltas, 794 Zeichen |
| Browser-Ansicht, ungestoert | 956 Zeichen |
| Browser mit `window.stop()` | **abgeschnitten** |

**Ursache: ein Druck auf Escape.** Chrome behandelt das als „Laden stoppen" und
bricht damit auch einen laufenden Antwort-Stream ab.

**Der echte Mangel dahinter:** Der Torso wurde gespeichert, als waere er die
Antwort. Niemand konnte unterscheiden, ob das Modell knapp war oder ob die
Verbindung wegbrach. Eine abgebrochene Antwort endet jetzt auf
`(Antwort abgebrochen.)`.

**Selbstkorrektur zum Weg dorthin:** Die Reparatur wurde dreimal geschrieben und
dreimal geglaubt, die Datei liesse sich nicht speichern — Python, `sed`, `awk`,
jedes Mal scheinbar erfolgreich und ohne Wirkung. Ursache war jedes Mal das
eigene Escaping: alle drei Werkzeuge machen aus `\\n` selbst einen
Zeilenumbruch und schrieben damit exakt die kaputte Fassung zurueck. Lehre:
frueher die Bytes ansehen (`od -c`), statt der Erfolgsmeldung zu glauben.

---

## Wiederkehrende Muster

**Was Build und Lint nie gefunden haben.** Die stille Ueberlappung, die
Zeilenumbrueche, das stumme `onClose`, das verschluckte gzip, der abgebrochene
Stream — alles gruen im Build, alles kaputt in der Sache.

**Was geholfen hat.** Gegen die echte Instanz pruefen statt gegen Attrappen.
Eigenschaften testen statt Rueckgabewerte. Und Tests gegen echte Fehler
gegenpruefen, statt ihnen zu glauben.

**Wo Vorsicht noetig war.** Zahlen, die aus dem Bauch kamen, waren mehrfach
falsch: das Rate-Limit war ein Tages- und kein Minutenlimit, `gemini-2.5-flash`
war gar nicht verfuegbar, und das „schnellere" Lite-Modell brauchte 115 Sekunden.

---

## Offene Punkte

| Punkt | Stand |
| --- | --- |
| Screenshot fuer die README | fehlt — `docs/screenshot-chat.png` |
| CI (GitHub Actions) | nicht eingerichtet |
| Deployment | nicht erfolgt; 20 Anfragen/Tag begrenzen eine oeffentliche Demo |
| Mindmap (Phase 2) | entschieden, nicht gebaut; strukturiertes JSON verifiziert |
| Audio Overview, Video | nicht begonnen |
