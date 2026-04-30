# Meisterpilze Tracker — Extensive Audit Plan

Working doc for the next audit pass. Date: 2026-04-29.

## Already covered — do NOT re-walk

| Source | Scope |
|---|---|
| Sections 1–3 audit (pre-#319) | Silent API failures, stale CSS, hardcoded i18n, dead-end UX |
| `pain-points.md` | hp-flush input type, inventory clamp, MOVE step indicator, lineage gaps |
| `i18n-report.md` + #366 | Orphan i18n keys purged, residual DE/PT gaps documented |
| #364, #367, #361, #337 | N+1 bags query, render-batches guard, zone-by-id memo, scanLog map |
| #365, backup section in `DEPLOYMENT.md` | Backup random tempname, encrypted restore, sqlite3 `.backup` for WAL |
| Mobile-UX wave (#317, #318, #332, #334–358, #363) | Tap targets, modal scroll, sticky-hover, cardified tables |
| #339, #341–346, #369, #372 | Contamination report MVP through photo annotations + auto-MOVE |

## Codebase shape (informs depth per area)

| File | LOC | Notes |
|---|---|---|
| `app.js` | 17,284 | Monolithic SPA; ~736 KB shipped to every client |
| `server.js` | 7,093 | HTTP+HTTPS+CalDAV+printer+MCP routing in one file |
| `db.js` | 4,429 | SQLite schema, queries, sessions, KPI snapshots |
| `index.html` | 3,933 | SPA shell with inline templates |
| `styles.css` | 4,711 | One stylesheet, no preprocessor |
| `mcp-server.js` | 2,072 | MCP tool surface |
| `sw.js` | 255 | PWA service worker |
| `test/` | 2 files | `db.test.js`, `mcp-server.test.js` — frontend untested |

## Proposed audit phases

Each phase produces a markdown report with severity-tagged findings (`HIGH` / `MED` / `LOW`) and `file:line` citations so fixes can be applied immediately. Phases are independent — we can drop, reorder, or merge them.

### Phase 1 — Security
**Why first**: Anything broken here blocks shipping; everything else is cosmetic by comparison.

Checks:
- Authn/authz coverage on every route in `server.js` (especially `/api/data` POST, MCP transport, CalDAV)
- Session cookies: `Secure`, `HttpOnly`, `SameSite`, rotation on privilege change
- SQL parameterization sweep across `db.js` (look for `${` interpolation in queries)
- HTML escaping: every `innerHTML` / template-string-into-DOM in `app.js`
- Command injection: `PRINTER_NAME` validation, ZPL passthrough, every `execFile`/`spawn` call site
- CSRF posture given cookie auth (any state-changing GET? Same-origin only?)
- Brute-force protection on `/api/auth/login` (rate limit? lockout?)
- Token strength + storage: print-bridge token, MCP bearer, OAuth clients table
- Backup encryption: KDF cost, AEAD vs encrypt-then-MAC, salt handling
- TLS posture: cert generation defaults, HSTS, redirect HTTP→HTTPS

**Deliverable**: `security-audit.md`.

### Phase 2 — Data integrity & domain correctness
**Why second**: Cheap to fix during audit, painful to fix after corruption ships.

Checks:
- Transaction boundaries on multi-row writes: batch creation (batches+bags+inventory deltas), MOVE, contam auto-MOVE, harvest, restore
- Inventory ledger consistency (the `Math.max(0, stock - used)` clamp from `pain-points.md` — is the server-side fix in?)
- FK cascade choices: `ON DELETE CASCADE` vs `SET NULL` — any orphan rows possible?
- Lineage integrity in `cultures.parent_id` (orphans, cycles, type mismatch parent→child)
- Scan-log replay: offline queue idempotency, dedup keys, ordering on reconnect
- KPI snapshot correctness across DST/timezone edges + the periodic 4h refresh path
- Domain math: grain hydration 52% (just fixed in #324), recipe ratios, BE / yield-per-bag, harvest flush attribution
- Soft-delete consistency: any tombstoned rows referenced by live FKs?
- CalDAV ETag/sequence correctness for series + occurrence deletes

**Deliverable**: `integrity-audit.md`.

### Phase 3 — Reliability & ops
**Why third**: Backups working = "we can sleep at night".

Checks:
- Verified restore drill: take a real backup, restore to scratch, diff row counts, time it, document gotchas in `DEPLOYMENT.md`
- Error handling sweep: silent `catch {}`, swallowed rejections, error-shape consistency from API
- Health endpoint completeness: what's in `/api/health` vs what would actually catch outages
- PM2 crash-loop behavior + log retention
- Logging: structured fields, accidental PII (usernames? barcode IDs? assignee names?), JSON-line consistency
- Print-bridge: TLS verification, retry/timeout, failure-mode UX
- Service worker offline queue: does it actually replay correctly after a 12-hour offline window?

**Deliverable**: `ops-audit.md` + an updated runbook section.

### Phase 4 — Performance
**Why fourth**: Real ROI but only after correctness is solid.

Checks:
- Cold-load on a Pi 4 / mid-range Android: parse+exec time for `app.js` (736 KB)
- `EXPLAIN QUERY PLAN` sweep on dashboard + batch-list + scan-log queries
- Index coverage vs actual hot queries (the recent N+1 fix added some — what's left?)
- Render hot paths beyond what `#367`/`#361` fixed
- Memory pressure on long-lived tabs (chart instances, scanner instances, listener leaks)
- Service worker cache eviction behavior

**Deliverable**: `perf-audit.md` with measured numbers (ms / KB), not just smell findings.

### Phase 5 — API surface & testing
Checks:
- `openapi.yaml` ↔ `server.js` route diff (is the spec accurate?)
- MCP tool surface: coverage, error shapes, idempotency, auth
- Test gap: frontend has zero tests — propose a minimum unit set for the scan state machine, inventory math, lineage walks
- Property/fuzz tests on scan-log replay and inventory deltas

**Deliverable**: `api-audit.md` + a minimum test plan.

### Phase 6 — Frontend code quality
Checks:
- Map a module boundary inside `app.js` (not a rewrite — just identify cut lines)
- Event-listener leaks (workers leave tabs open all shift)
- Dead code post-orphan-i18n purge (any other unreachable UI?)
- Duplication: render helpers, modal helpers, fetch helpers
- DOM-string XSS surface (overlaps with Phase 1 but viewed through code-quality lens)

**Deliverable**: `frontend-audit.md` with a refactor priority list.

### Phase 7 — UX, a11y, i18n
Checks:
- Empty / error / loading states across every list and modal
- Outdoor-light contrast (lab is bright; tablet glare matters)
- Keyboard nav + screen-reader on the scan flow specifically
- DE/PT translation completeness deltas (extend `i18n-report.md`)
- Reduced-motion + audio-cue toggles (touched in #368, sweep the rest)

**Deliverable**: `ux-audit.md`.

### Phase 8 — Schema, deploy, dependencies
Checks:
- Schema-level review: index list vs query list, denorm sanity, migration story (there's no real migration framework — what's the upgrade path?)
- `DEPLOYMENT.md` vs reality (recent fresh-install rewrite in #325 — is anything stale?)
- `START.bat` ↔ `update_server.sh` parity (touched in #328 — re-verify)
- Vendored libs in `lib/` — versions, known CVEs (Chart.js, html5-qrcode, JsBarcode, qrcode)
- npm deps: `@modelcontextprotocol/sdk`, `zod` — pinning, audit warnings

**Deliverable**: `schema-deploy-audit.md`.

## Method

- Each phase dispatches as a focused agent with a tight brief; agents return punch-lists with `file:line` cites
- I review and consolidate so the master doc isn't 8 disconnected reports
- Final consolidation into `audit-2026-04.md` with a single sorted punch-list
- Top findings spawn implementation PRs (one PR per finding cluster, not per finding)

## Suggested execution order

1. **Phase 1** Security
2. **Phase 2** Data integrity
3. **Phase 3** Reliability
4. **Phase 4** Performance
5. **Phase 5** API + testing
6. **Phase 6** Frontend quality
7. **Phase 7** UX / a11y / i18n
8. **Phase 8** Schema / deploy / deps

## Decisions (locked 2026-04-29)

1. **Scope** — all 8 phases
2. **Order** — security-first order as proposed; nothing burning
3. **Output** — one consolidated master doc: `audit-2026-04.md`
4. **Cadence** — phase-by-phase: audit → discuss → PR → next phase
5. **No personal-pain jumpers**

## Workflow per phase

1. Dispatch a focused agent with a tight brief; it writes a draft `phase-N-<name>.md`
2. I review the draft, dedupe vs already-fixed items, and append a clean section to `audit-2026-04.md`
3. Show you the consolidated section, get sign-off on which findings to fix
4. One PR (or a small cluster of PRs) for the agreed fixes
5. Move to next phase
