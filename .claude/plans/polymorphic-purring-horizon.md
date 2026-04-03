# Barcode Scan-Modus Überarbeitung

## Context

Der Barcode-Scanmodus ist eine der wichtigsten Funktionen der App — damit werden Bags eingescannt und zwischen Standorten verschoben. Aktuell ist das Modal zu klein (420px), die Logs sind unübersichtlich (180px Höhe, nur Text), es gibt kein Undo für einzelne Scans, und nach einer Session fehlt ein Überblick. Die Überarbeitung soll den Scan-Modus robuster, übersichtlicher und fehlertoleranter machen.

## Aktuelle Architektur

- **Gesamter JS-Code** liegt inline in `index.html` (Zeilen ~1030-5527)
- **`app.js`** wird NICHT von index.html geladen — ist veraltet/Backup
- Scan-Modal HTML: `index.html` Zeilen ~202-224
- Scan-Logik: `processScan()`, `setFb()`, `_addLogEntry()`, `updateSD()` in index.html
- CSS: `styles.css` Zeilen 130-199
- Backend: `db.js` (scan_log Schema), `server.js` (API-Routen)
- `scanLog[]` und `movements[]` werden parallel gepflegt — bei Undo müssen BEIDE aktualisiert werden
- API gibt SQLite-Row-IDs zurück, aber Frontend ignoriert sie aktuell

---

## Phase 1: Größeres Scan-Modal mit besserem Layout

**Ziel:** Geräumiges, informationsreiches Scan-Interface

- Modal von 420px auf 620px verbreitern, max-height auf 92vh
- **Mobile: Fullscreen** (100vw/100vh, kein Border-Radius) — wichtig für Farm-Einsatz mit Handys
- Status-Chips von einzeiliger Flex-Row zu 2x2-Grid umbauen
- Neuer Chip "Letzter Scan" zeigt zuletzt gescannte Bag-ID mit Species-Farbpunkt
- Bei MOVE: From/To als kombinierter Chip "INC → TENT2"
- **Farbige Header-Leiste** je nach Aktion (grün=ADD, blau=MOVE, rot=REMOVE, gelb=HARVEST)
- "Session beenden"-Button im Button-Bereich
- Toast-Bereich mit größerer Schrift (16px statt 14px)

**Dateien:** `styles.css`, `index.html` (HTML + JS)

---

## Phase 2: Strukturierter Scan-Log im Modal

**Ziel:** Statt einfacher Textzeilen → strukturierte Karten mit Batch-Kontext

- `_addLogEntry()` erweitern: akzeptiert jetzt `entryData`-Objekt
- Jede Karte zeigt: Species-Farbpunkt, Bag-ID (Monospace, fett), Action-Badge, Standort-Info, Timestamp
- Karten haben farbige linke Bordüre nach Aktionstyp
- **Undo-Button** auf jeder Karte (per Hover sichtbar)
- `data-scan-id` Attribut auf jeder Karte für späteres Undo
- Log-Bereich füllt verfügbaren Platz (`flex:1`, min ~300px statt fix 180px)
- **Server-IDs speichern:** `apiPost` Return-Wert nutzen um `entry.id` zu setzen

**Dateien:** `styles.css`, `index.html`

---

## Phase 3: Individuelles Undo für einzelne Scans

**Ziel:** Einzelne Scans rückgängig machen — per Button oder Ctrl+Z

### Backend
- `db.js`: Neue Funktion `deleteScanEntryById(db, id)` → DELETE by ID
- `server.js`: Neue Route `DELETE /api/scan-log/:id`

### Frontend
- `sessionEntries[]` Array — nur Scans der aktuellen Session sind undo-fähig
- `undoScanEntry(id)`: API-Call → aus `scanLog[]` + `movements[]` entfernen → DOM-Element entfernen → Count reduzieren → Views neu rendern
- **Ctrl+Z** wenn Modal offen: Letzten Session-Eintrag undo'en (Doppeldruck-Bestätigung innerhalb 2s)

**Dateien:** `db.js`, `server.js`, `index.html`

---

## Phase 4: Fehlervermeidung & Duplikat-Erkennung

**Ziel:** Häufige Fehler verhindern

- **Duplikat-Erkennung:** Wenn gleiche Bag+Action+Location schon in Session gescannt → Warnung (orange Toast). Nochmal scannen innerhalb 3s = bestätigen
- **REMOVE-Bestätigung:** Bei REMOVE muss Bag nochmal gescannt werden innerhalb 5s
- **Visuelle Hinweise:** Pulsierende Chips wenn Eingabe fehlt (z.B. "To" bei MOVE wenn nur "From" gesetzt)

**Dateien:** `index.html` (JS), `styles.css`

---

## Phase 5: Session-Zusammenfassung

**Ziel:** Überblick nach Abschluss einer Scan-Session

- `sessionStartTime`, `sessionErrors` tracking
- "Session beenden" Button zeigt Summary-Panel:
  - Dauer: "12 Min (14:30 – 14:42)"
  - Gesamtzahl Scans + Aufschlüsselung nach Aktionstyp
  - Berührte Batches mit Species-Farbpunkten
  - Fehlerzahl
  - Standort-Zusammenfassung: "15 Bags → TENT1, 3 Bags INC → TENT2"
- Buttons: "Neue Session" / "Schließen"

**Dateien:** `index.html` (HTML + JS), `styles.css`

---

## Phase 6: Verbesserter Scan-Log in Einstellungen

**Ziel:** Bessere Übersicht über historische Scans

- **Filter-Leiste:** Aktionstyp-Dropdown, Datums-Range, Text-Suche
- Ergebnis-Zähler: "45 von 1.203 Einträge"
- **Spalten-Sortierung** per Klick auf Header
- **Löschen-Button** für Einträge < 24h alt (nutzt gleiche API wie Phase 3)
- Max-Anzeige von 200 auf 500 erhöhen oder "Mehr laden"-Button

**Dateien:** `index.html` (HTML + JS), `styles.css`

---

## Phase 7: Besseres visuelles Feedback

**Ziel:** Befriedigenderes Scan-Erlebnis

- **Count-Animation:** Zahl springt kurz größer bei jedem Scan (`@keyframes count-bump`)
- Farbige Header-Bänder nach Aktionstyp (baut auf Phase 1 auf)
- Optional: Audio-Feedback per Web Audio API (kurzer Ton, kein externes File). Erfolg=800Hz/80ms, Fehler=200Hz/200ms. Hinter Benutzer-Toggle.

**Dateien:** `styles.css`, `index.html`

---

## Entscheidungen (User-Feedback)

- **Modal-Größe:** 620px zentriert (kein Side-Panel)
- **Audio:** Ja, standardmäßig an (Toggle in Einstellungen zum Deaktivieren)
- **Alle 4 Kernphasen** haben hohe Priorität: Undo, Strukturierter Log, Session-Summary, Fehlervermeidung

## Empfohlene Reihenfolge

```
Phase 1 (Modal Layout)         ← Fundament, zuerst
   ↓
Phase 7 (Visuelles Feedback + Audio)  ← Baut auf neuem Modal auf
   ↓
Phase 2 (Strukturierter Log)   ← Braucht größeres Modal
   ↓
Phase 3 (Individuelles Undo)   ← Braucht strukturierte Einträge mit IDs + Backend
   ↓
Phase 4, 5, 6 (parallel möglich nach Phase 3)
```

## Verifizierung

Nach jeder Phase:
1. START.bat manuell starten (Port 3000)
2. Scan-Modal öffnen, verschiedene Barcodes testen
3. Prüfen: ADD, MOVE, REMOVE, HARVEST Flows
4. Mobile-Ansicht testen (Fullscreen-Modal)
5. Undo testen (ab Phase 3)
6. Session beenden und Summary prüfen (ab Phase 5)
