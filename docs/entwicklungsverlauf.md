# Entwicklungsverlauf

Chronologisches Protokoll der Arbeitspakete, der Probleme und der
Entscheidungen. Geschrieben als Gedächtnisstütze, nicht als Werbetext —
deshalb stehen hier auch die Fehler und die Sackgassen.

Stand: 22 gemergte Pull Requests, 91 Commits, 11 Migrationen, 219 Tests.

---

## Phase 1: der Kern

### AP1 — Notebooks anlegen und auflisten (PR #1)

Startseite als Server Component, Anlegen über Server Action, Detailseite mit
`not-found`.

**Probleme:**

- **Supabase antwortete auf jede Abfrage mit `42501 permission denied`.**
  `0001_init.sql` legte die Tabellen an, vergab aber keine Rechte. Behoben mit
  `0002_grants.sql`. Dabei die Entscheidung: **nur `service_role` bekommt
  Rechte**, `anon` bewusst nicht — der Publishable Key liegt im Client-Bundle,
  und der Browser soll nie direkt mit Supabase sprechen. Zusätzlich RLS an,
  ohne Policies, als zweite Schranke.
- **`"use server"`-Datei exportierte ein Objekt.** Eine solche Datei darf
  ausschließlich async Funktionen exportieren. Der Build war grün, der Fehler
  kam erst beim Absenden des Formulars — die Prüfung greift erst bei der
  Modulauswertung.
- **`export const dynamic = "force-dynamic"`** nötig, sonst hätte Next die
  Supabase-Abfragen zur Build-Zeit ausgeführt und das Ergebnis statisch
  ausgeliefert.
- **`lib/notebook-limits.ts` entstand als eigenes Modul**, weil ein Import der
  Längenkonstante aus `lib/notebooks.ts` in eine Client-Komponente den
  Supabase-Server-Client in den Browser-Bundle gezogen hätte.

### AP2 — Quellen hinzufügen (PR #2)

Datei-Upload nach Supabase Storage, URL-Eingabe, Statusanzeige.

**Entscheidungen:**

- Privater Bucket, Upload durch eine Server Action. Kostet das Body-Limit als
  Obergrenze (`bodySizeLimit: "4.4mb"`, Vercel deckelt bei 4,5 MB), hält aber
  den Secret-Key serverseitig.
- Größe und Dateityp werden **dreifach** geprüft: Formular, Server Action,
  Bucket (`file_size_limit`, `allowed_mime_types`).
- Der Objektname im Bucket ist eine frische UUID unter `notebook_id/`, die
  Endung kommt aus dem Mime-Type. Der Dateiname des Nutzers landet nur im Titel
  und kann den Pfad nicht beeinflussen.
- Erst hochladen, dann die Zeile schreiben; scheitert das Insert, wird die Datei
  wieder entfernt.
- Check-Constraint `sources_location_check`: `type = 'url'` braucht `url` und
  kein `storage_path`, bei `pdf`/`text` umgekehrt.

**Beim Testen gefunden:** React setzt das Formular nach jeder Action zurück,
auch bei Fehlern — eine vertippte URL war weg. Behoben, indem die Action die
abgelehnte Adresse zurückgibt und ein `key` am Input das Neumounten erzwingt.

### AP3 — Ingestion (PR #3)

PDF über `unpdf` seitenweise, Textdateien direkt, Webseiten über
`@mozilla/readability`. Chunking mit Überlappung, Embedding, Statuspflege.

**Der wichtigste Fund: gemessene Kontingente statt geratener.**

```
quotaId    EmbedContentRequestsPerMinutePerUserPerProjectPerModel-FreeTier
quotaValue 100        (jedes Element eines Batches zaehlt einzeln)
retryDelay 14s
```

Daraus folgen drei Zahlen im Code: Batchgröße 100, Wartebudget 45 s,
`MAX_CHUNKS_PER_SOURCE = 200`. Ein Lauf über 120 Texte dauerte gemessen
22,9 Sekunden, weil die zweite Hälfte auf das nächste Minutenfenster wartet.
Deshalb `maxDuration = 60` auf der Route.

**Zwei Fehler, die ein Eigenschaftstest des Chunkers fand** — beide hätten
nicht gekracht, sondern still die Retrieval-Qualität ruiniert:

1. **Die Überlappung griff nie.** Sie war absatzweise gebaut und übertrug nur
   Absätze unter 200 Zeichen; reale Absätze sind länger. 0 von 9 Übergängen.
   Jetzt wird das Ende des letzten Blocks an einer Satzgrenze übernommen.
2. **Harte Zeilenumbrüche blieben stehen.** `"Satz\nwurde\numbrochen"` ging
   unverändert ins Embedding — genau das Muster, das jede PDF-Extraktion
   erzeugt.

**Weitere Entscheidungen:**

- Ein Chunk gehört immer zu genau einer Seite. Sonst wäre die Seitenzahl im
  Zitat gelogen.
- `claimSource` dreht den Status bedingt (`pending`/`error` → `processing`) und
  bekommt die Zeile nur zurück, wenn das Update gegriffen hat. Das macht den
  Statuswechsel zur Sperre. Test mit fünf parallelen Versuchen: einer gewinnt.
- `embedding` geht als Textform `'[0.1,0.2,...]'` in die Spalte.
- SSRF-Schutz auf Hostnamen-Ebene (später in PR #9 verschärft).

### AP4 — Retrieval und Chat (PR #4)

Erster Route Handler im Projekt — Server Actions können nicht streamen.

**Messungen, die das Design prägten:**

| Messung | Ergebnis |
| --- | --- |
| `gemini-2.5-flash` | für neue Nutzer gesperrt (404) |
| `gemini-3.7-flash` | 35–53 s pro Antwort |
| `gemini-3.5-flash` | 1,6–1,8 s → wurde Standard |
| ohne `thinkingConfig` | erstes Zeichen nach 7246 ms |
| `thinkingBudget: 0` | erstes Zeichen nach **1070 ms**, gleiche Antwortlänge |

**Entscheidungen:**

- **Ohne tragfähigen Kontext wird das Modell gar nicht erst gefragt.** Liegt
  der beste Treffer unter 0,55, gibt es eine feste Absage. Gemessen: passende
  Fragen 0,63–0,83, die unpassende Frage nach einem Kartoffelsalat-Rezept 0,50.
- **NDJSON statt reinem Text** als Streamformat, weil die Zuordnung von `[n]`
  zur Quelle auch im Browser ankommen muss.
- **Zwei Abfragen im Retrieval statt einer.** `match_chunks` gibt weder
  `metadata` noch Quellenangaben zurück. Die Funktion zu erweitern hätte ihre
  Signatur mit `vector(1536)` neu geschrieben — und die Embedding-Dimension an
  einer dritten Stelle geführt. Das verbietet die Projektkonvention.
- **`lib/gemini.ts`** entstand, weil Chat und Embeddings dieselbe Retry- und
  Rate-Limit-Logik brauchen. Zwei Kopien wären auseinandergelaufen.

**Nachbesserungen aus dem Browsertest:**

- Die Antwort kam mit Markdown-Sternchen als Rohtext. Statt eines
  Markdown-Renderers (Abhängigkeit plus XSS-Fläche) verbietet der Prompt
  Markdown.
- Unter der Antwort standen **alle acht** Auszüge, obwohl drei zitiert waren.
  Jetzt werden die `[n]` aus dem Text gelesen und nur die verwendeten gezeigt.

**Nachgezogen im selben Paket:** Folgefragen werden vor der Suche aufgelöst
(„Wofür wird das eingesetzt?" → „Wofür wird Retrieval-Augmented Generation
eingesetzt?"). Dabei der zweite Kontingentfund:

```
quotaId    GenerateRequestsPerDayPerProjectPerModel-FreeTier
quotaValue 20      ← pro TAG, nicht pro Minute
```

Deshalb eine Vorprüfung: umgeschrieben wird nur bei echtem Rückbezug oder sehr
kurzer Frage. Sonst hätte jede Folgefrage das Tagesbudget halbiert.

### AP5 — Klickbare Zitate (PR #5)

Der Kern des Produkts.

**Entscheidungen:**

- Der Chunk-Text geht im Stream mit (rund 8 KB), damit ein Klick keinen
  Netzwerkaufruf kostet.
- Der Bucket bleibt privat; eine Server Action erzeugt bei Bedarf eine signierte
  URL mit 300 s Gültigkeit. Bei PDFs hängt `#page=N` an.
- Eine Nummer ohne zugehörigen Auszug bleibt schlichter Text — ein Knopf, der
  ins Leere führt, wäre schlimmer als keiner.
- Natives `dialog`-Element statt eines Pakets.

**Der Fehler, den nur der Browsertest zeigte:** `onClose` als React-Prop am
`<dialog>` bleibt stumm — das native close-Ereignis steigt nicht auf, und Reacts
Delegation fängt es nicht. Folge: nach dem Schließen blieb die Komponente
eingehängt, **ein zweiter Klick auf dieselbe Nummer bewirkte nichts.** In Build
und Lint unsichtbar.

Der erste Reparaturversuch (Listener auf `close`) half nicht. Ursachensuche
ergab: in der Testumgebung feuert selbst ein frisch erzeugter, blanker Dialog
beim programmatischen `close()` kein Ereignis. Das Schließen läuft deshalb
über einen ausdrücklichen Aufruf, mit `cancel` und `close` zusätzlich für die
Wege, die der Browser selbst auslöst.

**Zwei Dinge blieben damals unverifiziert** (Tageskontingent erschöpft, und die
Browser-Ansicht nimmt keine echten Tastatureingaben an): Escape und der
Durchstich mit einer echten Antwort. Beides wurde später nachgeholt und
bestätigt.

---

## Nachgezogen nach Phase 1

### Löschen (PR #6)

Notebooks und Quellen löschen.

**Der Punkt, um den es ging:** Foreign Keys räumen Chunks und Quellen ab, **der
Storage kennt kein Kaskadieren.** Beim Notebook müssen die Dateipfade
eingesammelt werden, *bevor* die Zeilen gelöscht werden — danach wäre nicht
mehr auffindbar, welche Dateien dazugehörten.

Bei einer einzelnen Quelle: erst die Datei, dann die Zeile. Scheitert der zweite
Schritt, bleibt eine sichtbare Quelle ohne Datei — ein Zustand, den der Nutzer
sieht und durch erneutes Löschen beheben kann. Andersherum bliebe eine
verwaiste Datei im Bucket, die niemand mehr findet.

### Tests (PR #7)

Vitest, 89 Tests zunächst. Bewusst nur reine Logik.

**Der wichtigste Vorgang:** Die Tests wurden **gegen die echten Fehler
geprüft** — beide Chunker-Bugs wieder eingebaut, Testlauf beobachtet, Code
wiederhergestellt.

Der erste Durchlauf blieb dabei **grün**, obwohl der Fehler drin war. Ursache
war der Testdatengenerator: er zog aus zwölf Wörtern und lieferte bei Seed 0
und Seed 12 denselben Absatz. Von 40 Absätzen waren nur 12 verschieden, und die
Wiederholungen ließen die Enthält-Prüfung zufällig durchgehen. **Ohne diese
Gegenprobe wäre ein Test entstanden, der genau den Fehler durchgelassen hätte,
für den er geschrieben wurde.**

Ein weiterer Test fiel durch und zeigte eine echte Grenze: „das" ist im
Deutschen weit häufiger Artikel als Rückbezug. Die Heuristik wurde bewusst
**nicht** entschärft — der Fehlalarm kostet einen Aufruf, die Gegenrichtung
könnte eine Folgefrage ungelöst in die Suche schicken. Die Entscheidung steht
als eigener Test mit Begründung im Repo.

### SSRF über DNS (PR #9)

**Das Problem:** `isBlockedHost` prüft den Namen. Ein Angreifer registriert
einen unauffälligen Namen und lässt ihn per DNS auf `169.254.169.254` zeigen.

**Warum der naheliegende Fix nicht reicht:** Erst auflösen, prüfen, dann
abrufen — die Abrufschicht fragt das DNS erneut, und ein Server mit kurzer TTL
kann beim zweiten Mal etwas anderes liefern (DNS-Rebinding).

**Die Lösung:** Die Prüfung hängt in der `lookup`-Funktion, die `node:https`
beim Verbindungsaufbau ruft. Geprüft wird die Adresse, zu der auch verbunden
wird. Preis: `fetch` wurde für diesen Pfad durch `node:https` ersetzt.

**Zwei Regressionen, die der Umbau einschleppte:**

1. **Wikipedia antwortete mit 403** — `fetch` schickt automatisch einen
   User-Agent, `node:https` nicht.
2. **gzip** — `fetch` entpackt selbst, `node:https` nicht. Ohne
   `accept-encoding: identity` wäre lautlos Binärmüll ins Embedding gelaufen.

Abgedeckt sind auch Carrier-Grade NAT (100.64/10), Benchmarking (198.18/15) und
**IPv4-in-IPv6** (`::ffff:127.0.0.1` — die klassische Umgehung).

### Fehlergrund einer Quelle (PR #10)

Vorher blieb bei einem Fehlschlag nur `status = 'error'`; die Meldung lebte im
React-Zustand und war nach einem Reload weg.

Ein Constraint erlaubt die Meldung nur bei `status = 'error'`. Das zwingt den
Code, sie beim erneuten Verarbeiten wegzuräumen — `claimSource` macht das im
selben Update, mit dem es die Quelle beansprucht.

**Organisatorisches Problem:** Der Branch war gepusht, aber **es wurde nie ein
PR angelegt.** Der `gh pr create`-Befehl lief nicht durch. Dadurch hing die
Arbeit vier Arbeitspakete lang unbemerkt, während die Migration in der
Datenbank bereits gelaufen war. Lehre: nach `gh pr create` mit
`gh pr list --state open` nachsehen.

### Chatverlauf (PR #11)

Tabelle `messages` mit `citations` als jsonb.

**Entscheidungen:**

- Belege als **Momentaufnahme**, nicht als Verweis auf `chunks`. Ein Verweis
  ginge ins Leere, sobald die Quelle gelöscht wird.
- **Der Server ist die einzige Wahrheit über den Verlauf.** Der Browser schickt
  nur die Frage.
- Die Frage wird sofort gespeichert, nicht erst mit der Antwort.
- Auch die Absage „Dazu finde ich nichts in deinen Quellen" landet im Verlauf.

**Der Vorfall, der am meisten Zeit kostete:** Beim Ausprobieren kam auf eine
Frage nur `"Unter Retrieval"` zurück — ein abgebrochener Halbsatz.

Die Diagnose lief in vier Schritten, jeder schloss eine Möglichkeit aus:

| Test | Ergebnis |
| --- | --- |
| Rohdaten des Anbieters | vier Ereignisse, vollständiger Satz |
| `streamAnswer` isoliert | 3 Stücke, vollständig |
| `/api/chat` direkt, ohne Browser | 8 Deltas, 794 Zeichen |
| Browser-Ansicht, ungestört | 956 Zeichen |
| Browser mit `window.stop()` | **abgeschnitten** |

**Ursache: ein Druck auf Escape.** Chrome behandelt das als „Laden stoppen" und
bricht damit auch einen laufenden Antwort-Stream ab.

**Der echte Mangel dahinter:** Der Torso wurde gespeichert, als wäre er die
Antwort. Niemand konnte unterscheiden, ob das Modell knapp war oder ob die
Verbindung wegbrach. Eine abgebrochene Antwort endet jetzt auf
`(Antwort abgebrochen.)`.

**Selbstkorrektur zum Weg dorthin:** Die Reparatur wurde dreimal geschrieben und
dreimal geglaubt, die Datei ließe sich nicht speichern — Python, `sed`, `awk`,
jedes Mal scheinbar erfolgreich und ohne Wirkung. Ursache war jedes Mal das
eigene Escaping: alle drei Werkzeuge machen aus `\\n` selbst einen
Zeilenumbruch und schrieben damit exakt die kaputte Fassung zurück. Lehre:
früher die Bytes ansehen (`od -c`), statt der Erfolgsmeldung zu glauben.


---

## Vorzeigbar machen

### CI (PR #12)

Lint, `tsc --noEmit`, Tests und Build bei jedem Push.

**Der erste Lauf war rot:** `Cannot find name 'LayoutProps'` und `'PageProps'`.
Next erzeugt diese Typen selbst nach `.next/types`, und auf einem frischen
Checkout gibt es die noch nicht. Lokal war es unsichtbar, weil ein alter
`.next`-Ordner herumlag, den der laufende Dev-Server immer wieder auffüllte.
Behoben mit `npx next typegen` vor dem Typecheck.

### README und Deployment (PR #13, #14)

**Die Live-URL lieferte die Vercel-Anmeldeseite** — 302 auf `vercel.com/sso-api`.
Ursache war "Require Log In" in den Projekteinstellungen. Danach fehlte
`LLM_API_KEY` in Vercel, und der Health-Check hat es nicht gemeldet, weil er
nur vier von sechs Variablen prüft. Beides behoben, der Health-Check deckt
jetzt alle sechs ab.

---

## Phase 2: Näher an NotebookLM

### Quellenauswahl (PR #15)

Quellen an- und abwählen, das Retrieval sucht nur in den ausgewählten.

**Zwei Anläufe für die Kästchen.** Der erste hängte den Zustand an einen
`useEffect`, was `react-hooks/set-state-in-effect` zu Recht abgelehnt hat.
Der zweite nimmt `useOptimistic`: das Kästchen kippt sofort, der Server zieht
nach. Dieselbe Lint-Regel schlug später im Audio-Panel wieder zu; dort wird
die Abspieladresse jetzt beim Rendern abgeleitet statt im Effekt gesetzt.

**Irreführender Platzhalter.** Waren Quellen da, aber alle abgewählt, stand
im Chat "Erst eine Quelle hinzufügen" — und schickte den Nutzer damit in die
falsche Richtung. Es gibt jetzt drei Zustände statt zwei.

### Quellen beschreiben sich selbst (PR #16)

Kurzfassung und Kernthemen je Quelle, erzeugt am Ende der Ingestion. Die
Abschnitte werden gleichmäßig über das Dokument verteilt gezogen, nicht von
vorn: sonst beschriebe die Zusammenfassung eines langen Dokuments nur das
Vorwort.

Bewusst kein eigener Aufruf pro Seitenaufruf. Quellen kommen selten hinzu,
Fragen oft — und das Tageskontingent ist knapp.

### Notizen (PR #17)

Antworten sichern oder selbst schreiben. Gesicherte Antworten behalten ihre
Belege, aber nur die tatsächlich zitierten: alle acht Auszüge mitzuspeichern
wäre Ballast, den niemand liest.

### Gesprochene Zusammenfassung (PR #18)

Zwei Stimmen, rund 30 Sekunden, in einem Durchgang erzeugt und als WAV im
Bucket abgelegt.

**Gemessen statt geschätzt:** die Sprachausgabe braucht etwa 0,76 Sekunden je
Sekunde Audio. Daraus folgt die Länge — eine Serverless-Function hat 60
Sekunden, und länger als eine halbe Minute geht sich darin nicht aus.

**Beim Anhören gefunden:** das Skript endete auf einer Frage von Ben, die
niemand mehr beantwortete. `trimScript` schneidet nachlaufende Ben-Zeilen ab.

### Themenlandkarte (PR #19)

Knoten und Kanten aus strukturierter Ausgabe, aber mit Belegen: jeder Knoten
trägt die Nummern der Abschnitte, aus denen er stammt, und ein Klick öffnet
denselben Belegdialog wie im Chat.

Das Layout ist eine **reine Funktion** — Baum rein, Koordinaten raus. Bei
Grafikcode ist das der einzige Weg, eine Überlappung zu finden, ohne
hinzusehen.

**Zwei Fehler, die erst der Browser zeigte:** neun von 22 Beschriftungen waren
abgeschnitten — nicht wegen zu langem Text, sondern weil die Flexbox die
Beschriftung auf eine Zeile zusammendrückte (zwei Zeilen brauchen 28
Bildpunkte, Belegnummern 14, Abstände 16, verfügbar waren 56). Und die Karte
war mit 674 Bildpunkten breiter als die Arbeitsfläche mit 598.

### Umbenennen (PR #20)

Notebooks und Quellen umbenennen, an Ort und Stelle.

**Der eigentliche Fund kam beim Testen.** Nach dem Umbenennen einer Quelle
zeigte die Seitenleiste den neuen Namen, die Themenlandkarte weiter den alten:
Belege werden als Momentaufnahme gespeichert. Richtig für den Wortlaut,
falsch für den Titel — dieselbe Quelle stand unter zwei Namen.
`withCurrentTitles` zieht nur den Titel nach; der wörtliche Abschnitt bleibt
unangetastet, sonst wäre der Beleg gefälscht.

**Und ein älterer Fehler fiel auf, als die Screenshots entstanden:** der
Belegdialog saß in der linken oberen Ecke statt in der Mitte. Tailwinds
Preflight setzt `margin: 0` auf alle Elemente und hebelt damit das
`margin: auto` aus, mit dem der Browser modale Dialoge zentriert. Der
angeschnittene Dialog im alten README-Screenshot war also kein schlecht
gewählter Ausschnitt, sondern der Fehler selbst — über mehrere
Arbeitspakete hinweg übersehen, weil er wie eine unglückliche Bildwahl
aussah und niemand die Position gemessen hat.

### Einstiegsfragen (PR #21)

Vorschläge im leeren Chat, ein Klick stellt die Frage.

**Das Kontingent hat die Bauform bestimmt.** Bei 20 Anfragen am Tag darf so
etwas keinen eigenen Aufruf kosten. Die Fragen entstehen deshalb im *selben*
Aufruf wie Kurzfassung und Kernthemen — erweitert wurde nur das Antwortschema.

Die Vorschläge werden reihum aus den Quellen gemischt, nicht nacheinander:
bei vier Plätzen und drei Fragen je Quelle käme die zweite Quelle sonst
gerade noch vor und jede weitere gar nicht.

**Auf dem Handy gefunden:** im Reiter "Karte" scrollte die ganze Seite
seitwärts statt die Karte in ihrem Kasten. Ein Grid-Element schrumpft ohne
`min-w-0` nicht unter seinen Inhalt, also wuchs die Spalte mit.

---

## Wiederkehrende Muster

**Was Build und Lint nie gefunden haben.** Die stille Überlappung, die
Zeilenumbrüche, das stumme `onClose`, das verschluckte gzip, der abgebrochene
Stream, der Dialog in der Ecke, die abgeschnittenen Beschriftungen, der
veraltete Titel im gespeicherten Beleg, die Seite, die auf dem Handy
seitwärts rutscht — alles grün im Build, alles kaputt in der Sache.

**Wo die Fehler stattdessen herkamen.** Fast jeder Fund dieses Projekts
stammt aus einer von drei Quellen: die Anwendung im Browser bedienen, eine
Zahl nachmessen statt sie zu schätzen, oder einen Test gegen den wieder
eingebauten Fehler gegenprüfen. Lesen allein hat fast nichts gefunden.

**Was geholfen hat.** Gegen die echte Instanz prüfen statt gegen Attrappen.
Eigenschaften testen statt Rückgabewerte. Und Tests gegen echte Fehler
gegenprüfen, statt ihnen zu glauben.

**Wo Vorsicht nötig war.** Zahlen, die aus dem Bauch kamen, waren mehrfach
falsch: das Rate-Limit war ein Tages- und kein Minutenlimit, `gemini-2.5-flash`
war gar nicht verfügbar, und das „schnellere" Lite-Modell brauchte 115 Sekunden.

### Nachziehen und Feinschliff (PR #22, #23)

Dieses Protokoll endete bei PR #11 und behauptete unter "Offene Punkte", CI
sei nicht eingerichtet, das Deployment nicht erfolgt, Mindmap und Audio nicht
gebaut. Alles vier war zu dem Zeitpunkt längst da. Ein Dokument, das das
eigene Projekt kleiner macht, als es ist, kostet mehr Vertrauen als eines, das
fehlt — deshalb steht der Rückstand hier als eigener Eintrag und nicht als
stille Korrektur.

Dazu die Oberfläche auf echte Umlaute umgestellt. Aus `Schliessen` wurde
`Schließen`, aus `Aehnlichkeit` wurde `Ähnlichkeit`, aus
`Gespraech leeren` wurde `Gespräch leeren`.

**Beim Umstellen selbst gestolpert:** die erste Fassung des Ersetzungslaufs
hat `alleAusgewaehlt` und `pruefenderLookup` umbenannt — Bezeichner, keine
Oberflächentexte, und jeweils nur an einer von zwei Stellen. Die Heuristik
hielt die Zeilen `alleAusgewaehlt,` und `lookup: pruefenderLookup,` für
Fließtext zwischen JSX-Tags. Aufgefallen beim Durchlesen des Diffs. Danach
die Regel verschärft: mindestens zwei Wörter, kein Komma am Ende — und der
eine Fall, den die schärfere Regel nicht mehr traf, von Hand.

Eine Ersetzung über Muster wäre hier ohnehin gescheitert: `Quelle`,
`Requests`, `dauerte`, `neue` und `Konsequenz` enthalten `ue` oder `ae`, ohne
einen Umlaut zu meinen. Und `dass`, `muss`, `Adresse` und `durchgelassen`
hätten kein scharfes s vertragen, `ausschliesslich` und `heißt` dagegen schon.

---

## Offene Punkte

| Punkt | Stand |
| --- | --- |
| Mehrere Gespräche je Notebook | nicht gebaut; ein Notebook hat genau einen Verlauf |
| Quellen per Websuche finden | nicht gebaut |
| Video-Overview | nicht gebaut; Audio und Karte decken den Zweck ab |
| Study Guide, Zeitleiste | nicht gebaut |
| Hybride Suche (Volltext neben Vektoren) | nicht gebaut; bei Eigennamen und Zahlen wäre sie besser |
| 20 Anfragen/Tag | Grenze des Anbieters, nicht behebbar — gespeicherte Verläufe federn es ab |
