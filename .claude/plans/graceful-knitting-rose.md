# Barcode Scanning Feature Improvements

## Context
The scan modal is currently a small 420px dialog with limited feedback. The user wants stronger visual/audio feedback on errors, a larger scan UI with better organization, and the ability to undo previous scans.

## Changes

### 1. Overlay background flash on error (styles.css + app.js)
- Add CSS classes on `#scan-overlay` that flash the overlay background **red on error** and **green on success**
- Currently the overlay is always `rgba(0,0,0,.35)` — add `.scan-bg-ok` (green tint) and `.scan-bg-err` (red tint) with a CSS transition that auto-fades back to default after ~1s
- In `setFb()`, apply the matching class to the overlay element

**Files:** `styles.css:130-135`, `app.js:2358` (setFb function)

### 2. Distinctive error sound via Web Audio API (app.js)
- No audio exists currently. Create a `playBeep(type)` function using Web Audio API (no external files needed)
- **Success:** short high-pitched "ding" (800Hz, 120ms)
- **Error:** two-tone "buzz" — louder, lower, harsher (300Hz square wave, 250ms) so it's clearly distinct and attention-grabbing
- Call `playBeep(type)` from `setFb()` for `'ok'` and `'err'` types

**Files:** `app.js` (new function near scan section)

### 3. Redesign scan modal to 80% screen size with 3 tabs (index.html + styles.css + app.js)
Expand `.scan-modal` to `width:80vw; height:80vh` and add **3 tab sections**:

- **Tab "Status"** (default): Current scan state — chips (Action/From/To/Count), toast feedback, harvest panel. This is the "cockpit" view.
- **Tab "Erfolge"** (Recent successes): List of only successful scan entries from current session, each selectable for undo (see #4)
- **Tab "Log"**: Full scan log (all entries: ok, err, info) — the existing `scan-modal-log` content, but now in its own full-height scrollable tab

Tabs use the existing `.stabs/.stab` pattern from the app.

**Files:** `index.html:202-224`, `styles.css:130-195`, `app.js:2346-2369`

### 4. Undo for successful scans (app.js + server.js)
- In the "Erfolge" tab, each successful scan entry gets a clickable row
- Clicking shows a confirmation dialog: "Scan ruckgangig machen? [Action] [Batch/Bag] → [Location]"
- On confirm: remove that entry from `scanLog`, call `DELETE /api/scan-log/last/:n` to remove from DB (or add a new endpoint to delete by ID), then `saveData()` and re-render
- The existing `deleteLastScanEntries` in db.js deletes by position (last N). For individual undo, add `deleteScanEntryById(db, id)` in db.js and a `DELETE /api/scan-log/:id` endpoint in server.js

**Files:** `app.js` (new undo logic), `db.js:727` (new delete-by-id), `server.js:1366` (new endpoint)

## File Summary
| File | Changes |
|------|---------|
| `styles.css` | Overlay bg flash classes, larger modal, tab layout |
| `index.html` | Modal restructure with 3 tabs |
| `app.js` | Web Audio beeps, overlay flash in setFb, tab switching, undo per entry |
| `db.js` | `deleteScanEntryById()` function |
| `server.js` | `DELETE /api/scan-log/:id` endpoint |

## Verification
- User tests manually (no preview tools per memory). Changes can be verified by opening scan modal, scanning barcodes, and checking:
  - Red/green overlay flash
  - Distinctive error vs success sounds
  - 80% modal with 3 working tabs
  - Undo from Erfolge tab with confirmation
