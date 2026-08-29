# Entwicklungsverlauf

Chronologisches Protokoll der Arbeitspakete, der Probleme und der
Entscheidungen. Geschrieben als Gedaechtnisstuetze, nicht als Werbetext —
deshalb stehen hier auch die Fehler und die Sackgassen.

Stand: 21 gemergte Pull Requests, 87 Commits, 11 Migrationen, 219 Tests.

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

## Vorzeigbar machen

### CI (PR #12)

Lint, `tsc --noEmit`, Tests und Build bei jedem Push.

**Der erste Lauf war rot:** `Cannot find name 'LayoutProps'` und `'PageProps'`.
Next erzeugt diese Typen selbst nach `.next/types`, und auf einem frischen
Checkout gibt es die noch nicht. Lokal war es unsichtbar, weil ein alter
`.next`-Ordner herumlag, den der laufende Dev-Server immer wieder auffuellte.
Behoben mit `npx next typegen` vor dem Typecheck.

### README und Deployment (PR #13, #14)

**Die Live-URL lieferte die Vercel-Anmeldeseite** — 302 auf `vercel.com/sso-api`.
Ursache war "Require Log In" in den Projekteinstellungen. Danach fehlte
`LLM_API_KEY` in Vercel, und der Health-Check hat es nicht gemeldet, weil er
nur vier von sechs Variablen prueft. Beides behoben, der Health-Check deckt
jetzt alle sechs ab.

---

## Phase 2: Naeher an NotebookLM

### Quellenauswahl (PR #15)

Quellen an- und abwaehlen, das Retrieval sucht nur in den ausgewaehlten.

**Zwei Anlaeufe fuer die Kaestchen.** Der erste haengte den Zustand an einen
`useEffect`, was `react-hooks/set-state-in-effect` zu Recht abgelehnt hat.
Der zweite nimmt `useOptimistic`: das Kaestchen kippt sofort, der Server zieht
nach. Dieselbe Lint-Regel schlug spaeter im Audio-Panel wieder zu; dort wird
die Abspieladresse jetzt beim Rendern abgeleitet statt im Effekt gesetzt.

**Irrefuehrender Platzhalter.** Waren Quellen da, aber alle abgewaehlt, stand
im Chat "Erst eine Quelle hinzufuegen" — und schickte den Nutzer damit in die
falsche Richtung. Es gibt jetzt drei Zustaende statt zwei.

### Quellen beschreiben sich selbst (PR #16)

Kurzfassung und Kernthemen je Quelle, erzeugt am Ende der Ingestion. Die
Abschnitte werden gleichmaessig ueber das Dokument verteilt gezogen, nicht von
vorn: sonst beschriebe die Zusammenfassung eines langen Dokuments nur das
Vorwort.

Bewusst kein eigener Aufruf pro Seitenaufruf. Quellen kommen selten hinzu,
Fragen oft — und das Tageskontingent ist knapp.

### Notizen (PR #17)

Antworten sichern oder selbst schreiben. Gesicherte Antworten behalten ihre
Belege, aber nur die tatsaechlich zitierten: alle acht Auszuege mitzuspeichern
waere Ballast, den niemand liest.

### Gesprochene Zusammenfassung (PR #18)

Zwei Stimmen, rund 30 Sekunden, in einem Durchgang erzeugt und als WAV im
Bucket abgelegt.

**Gemessen statt geschaetzt:** die Sprachausgabe braucht etwa 0,76 Sekunden je
Sekunde Audio. Daraus folgt die Laenge — eine Serverless-Function hat 60
Sekunden, und laenger als eine halbe Minute geht sich darin nicht aus.

**Beim Anhoeren gefunden:** das Skript endete auf einer Frage von Ben, die
niemand mehr beantwortete. `trimScript` schneidet nachlaufende Ben-Zeilen ab.

### Themenlandkarte (PR #19)

Knoten und Kanten aus strukturierter Ausgabe, aber mit Belegen: jeder Knoten
traegt die Nummern der Abschnitte, aus denen er stammt, und ein Klick oeffnet
denselben Belegdialog wie im Chat.

Das Layout ist eine **reine Funktion** — Baum rein, Koordinaten raus. Bei
Grafikcode ist das der einzige Weg, eine Ueberlappung zu finden, ohne
hinzusehen.

**Zwei Fehler, die erst der Browser zeigte:** neun von 22 Beschriftungen waren
abgeschnitten — nicht wegen zu langem Text, sondern weil die Flexbox die
Beschriftung auf eine Zeile zusammendrueckte (zwei Zeilen brauchen 28
Bildpunkte, Belegnummern 14, Abstaende 16, verfuegbar waren 56). Und die Karte
war mit 674 Bildpunkten breiter als die Arbeitsflaeche mit 598.

### Umbenennen (PR #20)

Notebooks und Quellen umbenennen, an Ort und Stelle.

**Der eigentliche Fund kam beim Testen.** Nach dem Umbenennen einer Quelle
zeigte die Seitenleiste den neuen Namen, die Themenlandkarte weiter den alten:
Belege werden als Momentaufnahme gespeichert. Richtig fuer den Wortlaut,
falsch fuer den Titel — dieselbe Quelle stand unter zwei Namen.
`withCurrentTitles` zieht nur den Titel nach; der woertliche Abschnitt bleibt
unangetastet, sonst waere der Beleg gefaelscht.

**Und ein aelterer Fehler fiel auf, als die Screenshots entstanden:** der
Belegdialog sass in der linken oberen Ecke statt in der Mitte. Tailwinds
Preflight setzt `margin: 0` auf alle Elemente und hebelt damit das
`margin: auto` aus, mit dem der Browser modale Dialoge zentriert. Der
angeschnittene Dialog im alten README-Screenshot war also kein schlecht
gewaehlter Ausschnitt, sondern der Fehler selbst — ueber mehrere
Arbeitspakete hinweg uebersehen, weil er wie eine unglueckliche Bildwahl
aussah und niemand die Position gemessen hat.

### Einstiegsfragen (PR #21)

Vorschlaege im leeren Chat, ein Klick stellt die Frage.

**Das Kontingent hat die Bauform bestimmt.** Bei 20 Anfragen am Tag darf so
etwas keinen eigenen Aufruf kosten. Die Fragen entstehen deshalb im *selben*
Aufruf wie Kurzfassung und Kernthemen — erweitert wurde nur das Antwortschema.

Die Vorschlaege werden reihum aus den Quellen gemischt, nicht nacheinander:
bei vier Plaetzen und drei Fragen je Quelle kaeme die zweite Quelle sonst
gerade noch vor und jede weitere gar nicht.

**Auf dem Handy gefunden:** im Reiter "Karte" scrollte die ganze Seite
seitwaerts statt die Karte in ihrem Kasten. Ein Grid-Element schrumpft ohne
`min-w-0` nicht unter seinen Inhalt, also wuchs die Spalte mit.

---

## Wiederkehrende Muster

**Was Build und Lint nie gefunden haben.** Die stille Ueberlappung, die
Zeilenumbrueche, das stumme `onClose`, das verschluckte gzip, der abgebrochene
Stream, der Dialog in der Ecke, die abgeschnittenen Beschriftungen, der
veraltete Titel im gespeicherten Beleg, die Seite, die auf dem Handy
seitwaerts rutscht — alles gruen im Build, alles kaputt in der Sache.

**Wo die Fehler stattdessen herkamen.** Fast jeder Fund dieses Projekts
stammt aus einer von drei Quellen: die Anwendung im Browser bedienen, eine
Zahl nachmessen statt sie zu schaetzen, oder einen Test gegen den wieder
eingebauten Fehler gegenpruefen. Lesen allein hat fast nichts gefunden.

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
| Mehrere Gespraeche je Notebook | nicht gebaut; ein Notebook hat genau einen Verlauf |
| Quellen per Websuche finden | nicht gebaut |
| Video-Overview | nicht gebaut; Audio und Karte decken den Zweck ab |
| Study Guide, Zeitleiste | nicht gebaut |
| Hybride Suche (Volltext neben Vektoren) | nicht gebaut; bei Eigennamen und Zahlen waere sie besser |
| 20 Anfragen/Tag | Grenze des Anbieters, nicht behebbar — gespeicherte Verlaeufe federn es ab |
