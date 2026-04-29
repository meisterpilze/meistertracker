# Lab pain-point findings (post-audit)

Investigation triggered after the Section 1–3 audit cleanup landed. Looks for friction the original audit didn't flag — workflow gaps, foot-guns, and small one-liners with disproportionate impact.

## Top 3 quick wins

| # | Title | File:line | Why it hurts | Fix sketch |
|---|---|---|---|---|
| 1 | `hp-flush` input still `type="number"` | [index.html:1248](index.html:1248) | The native spinner buttons on the flush counter are ~16 px wide and easily mis-tapped with lab gloves, sending the number to 99 by accident. PR #347 fixed `hp-grams` but missed this sibling. | `type="text" inputmode="numeric" enterkeyhint="done"`. **Shipped in PR 35.** |
| 2 | Silent inventory drain on batch creation | [app.js:6856–6868](app.js:6856) | `Math.max(0, stock - used)` silently clamps to zero with no warning. Worker creates a 10-bag batch that needs 30 kg hardwood when only 15 kg is in stock — UI shows everything went fine, then they run out mid-week. | Pre-flight `confirm()` listing each material's available vs needed. **Shipped in PR 35.** |
| 3 | MOVE flow has no step indicator | [app.js:13450–13495](app.js:13450) | MOVE requires: tap action → tap from-zone → scan from-zone → tap to-zone → scan zone → scan bags. Workers forget the "to" tap and the zone-picker pops mid-flow with no recovery. | Visual "Step 1/3 · 2/3 · 3/3" indicator below the action chip that updates in real time. **Held — see Other findings.** |

## Other findings (reference)

These are observations from reading the codebase + scanning the recent commit history. Each is plausible but not all are clear wins — flagging for awareness.

### Workflow / UX
- **MOVE step indicator** (above #3). Real friction but the fix is opinionated and could complicate the otherwise terse scan-modal HUD. Worth a design pass before shipping.
- **REMOVE session safety gate** — currently each REMOVE requires a double-scan within 5 s. No upper-bound check on a single session, so a worker could accidentally batch-REMOVE 50 bags. The agent suggested gating > 5 in a session; tradeoff is annoying legitimate disposal sweeps. Defer until you have a real incident.
- **`apiPost` failure path on batch creation** ([app.js:6800–6810](app.js:6800)) — local state is rolled back on server error and the form data is lost. Workers re-type everything. Better UX: keep the form populated so they can retry without re-typing.
- **No paste-from-clipboard for barcode IDs** — Bluetooth scanner output goes through the existing HW-keyboard buffer, but if a worker has a code in the OS clipboard there's no way to inject it without retyping. Low frequency, low priority.

### Performance
- The audit caught the big perf items (`renderBatches` fp-guard, N+1 fix, `lastScanByBag` map, zone-by-id memo). Spot-checked the rest of the dashboard render path; nothing else is hot enough to matter on a phone.

### Data integrity
- The inventory clamp (#2) is a real consistency bug, not just a UX issue: stock goes to 0 but the inventory log records the FULL `hwUsed` amount including the over-commit. So `sum(deltas)` doesn't equal the running stock balance. Pre-flight warning (shipped) fixes the user-side; the log accuracy is a separate cleanup that needs `min(used, stock)` clamping in `appendInventoryDelta` server-side.
- Backups appear robust (sqlite3 `.backup` for WAL-consistency on Linux, file copy fallback, photo `tar.gz` since #339, encrypted backup-restore). No new findings.

### Lab-specific gaps
- **No automated transfer between cultures** — the data model has parent/child lineage but transferring (e.g. MC → PD) requires manual entry. Could likely be automated when the cultures table records a "transferred-from" event. Out of scope for this PR.
- **Harvest doesn't compute a flush-average per batch** — workers eyeball it from the harvest table. Adding `avg_grams_per_flush` to the batch detail would help yield analysis. Feature, not a bug.
- **Auto-task creation on contam reports** — audit Section 2.6 mentioned this in the lifecycle proposal but it was deferred. Now that auto-MOVE is wired (#369), creating a "Inspect bag X reported as Y" manual_task with `due_date = today + 1` would close the loop.

### Things deliberately not flagged
- Service worker / offline queue — covered by PR #344 (contam) and the existing scan-log queue. Solid.
- Backup/restore endpoint — covered by audit Section 3.3 + PR #365 (random tempname). Reviewed.
- i18n coverage — orphan keys purged (#366); residual missing-from-DE/PT items are pre-existing translations the team hasn't needed.
- Modal scrolling / touch — covered by PR #355 (touch-action fix, mobile padding).
- `renderCultures` perf — already O(n × constants), no hot inner loops, fine.

---

This doc is a snapshot. As of the time of writing, the audit's punchlist is essentially cleared. The remaining work is feature/polish, not bug-fixing.
