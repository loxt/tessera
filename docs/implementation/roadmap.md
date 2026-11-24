# Implementation Roadmap

Status as of 2026-10-15. "Verified" means covered by automated tests (unit, integration
against real databases, or the e2e run on the built app) or observed in e2e screenshots
(`docs/screenshots/`).

## Milestone 1 — Desktop foundation ✅

| Item | State | Verified by |
|---|---|---|
| Electron app, sandboxed renderer, typed preload bridge | ✅ | e2e launches the built app |
| Main shell: toolbar, explorer, tab bar, status bar | ✅ | screenshots 03, 07 |
| Resizable panels (explorer width, results height), persisted | ✅ | prefs persistence |
| Database Explorer with lazy tree, filter, keyboard navigation, context menus | ✅ | e2e "browse the explorer tree" |
| Query editor tabs (console / table / DDL), close, cycle, recent | ✅ | e2e session-restore step |
| Light/dark/system themes (UI + Monaco) | ✅ | screenshots 10 (dark), 11 (light) |
| Persistent preferences, window bounds, open tabs + console text (sync flush on close) | ✅ | e2e restart restores tabs |
| Keyboard infrastructure: one action catalog → native menu, palette, handlers | ✅ | `src/shared/actions.ts` |
| Configurable keymap with IntelliJ-style contexts (global / SQL editor / data grid), Settings → Keymap (record, remove, conflicts, reset) | ✅ | `src/shared/keymap.ts` unit tests; e2e records a shortcut and uses it |
| DataGrip keymap import: active keymap + parent chain + `$default` Ctrl↔Cmd swap on macOS + plugin shortcuts + `use-shortcut-of`; auto-import on first run | ✅ | integration test against the installed DataGrip; e2e presses the imported "Duplicate Line" |
| Split editor (right/down), move tab to opposite split, focus per split, persisted layout, tabs never remount when moved | ✅ | `layout.ts` unit tests; e2e split/move/unsplit |
| Search Everywhere (⇧⇧), Find Action, Go to Table, Recent Tabs | ✅ | screenshot 10 |
| Notifications (toasts + history), error boundaries per panel | ✅ | screenshots 05, 07 |

## Milestone 2 — Real connectivity ✅

| Item | State | Verified by |
|---|---|---|
| PostgreSQL adapter (pg + pg-cursor) | ✅ | integration tests vs postgres:17 + e2e |
| SQLite adapter (`node:sqlite` in a worker thread) | ✅ | integration tests + e2e |
| MySQL adapter (mysql2) | ✅ | integration tests vs mysql:8.4 |
| Connection dialog: per-engine fields, URL paste, Test Connection, color, folder, read-only, SSL | ✅ | e2e (SQLite via file, PostgreSQL via pasted URL) |
| Credentials in the macOS Keychain (safeStorage); the renderer never sees secrets | ✅ | `ConnectionStore` review |
| Server-enforced read-only sessions | ✅ | integration tests |
| Introspection: schemas, tables, views, routines, sequences, columns, keys, FKs, indexes | ✅ | integration tests |

## Milestone 3 — Editor & execution ✅

| Item | State |
|---|---|
| Monaco SQL editor with dialect language per engine | ✅ |
| Schema-aware completion with alias resolution (unit-tested, e2e screenshot 06) | ✅ |
| Execute statement at caret / selection / script (dialect-aware splitter, unit-tested) | ✅ |
| Bind parameters `:name`, `$n`, `?` with prompt dialog (unit-tested) | ✅ |
| Cancel (PG `pg_cancel_backend`, MySQL `KILL QUERY`, SQLite worker termination) | ✅ |
| Transactions: Auto/Manual per console, Commit/Rollback, close-with-open-tx guard | ✅ |
| Server error output + editor marker (PG error position) | ✅ |
| Reformat (⌘⌥L), duplicate line, delete line, comment | ✅ |
| Query history per data source (⌘⌥E) | ✅ |
| Persistent named consoles per data source (`console`, `console_1`…): survive closing, ⌘⇧L picker, explorer "consoles" folder, rename/delete, remembered schema (e2e) | ✅ |
| Explain / Explain Analyse as a tree with cost bars (analyse wrapped in a rollback on PG) | ✅ |

## Milestone 4 — Results & data editing ✅

| Item | State |
|---|---|
| Virtualized grid: selection, keyboard nav, column resize, copy TSV, value viewer | ✅ |
| Fetch limit (page size) + "Fetch all" for read-only queries | ✅ |
| Client sort/filter on results; server-side WHERE/ORDER BY/paging in the table editor | ✅ |
| Inline edit, add/clone/delete rows, set NULL, revert, pending-change colors | ✅ |
| Submit → parameterized DML preview → atomic apply with 1-row guard | ✅ (e2e) |
| FK navigation, filter by value, count rows | ✅ |
| Export CSV / TSV / JSON / SQL INSERT / Markdown to clipboard or file | ✅ (unit-tested) |
| DDL view, SQL generator templates, truncate/drop with confirmed SQL preview | ✅ |

## Known limitations (documented, not bugs)

- **Keymap.** Two-keystroke (chord) shortcuts and mouse shortcuts are not supported; the importer
  skips them and reports how many. The native menu only *displays* shortcuts
  (`registerAccelerator: false`) so the renderer can resolve the editor/grid context. Key
  equivalents through the real macOS menu bar could not be exercised in automation, because
  Playwright injects keys below the menu; a de-duplication guard prevents double execution if
  macOS ever delivers both.

- **SQLite cancel.** Terminating the worker returns control immediately, but a single long native
  `sqlite3_step` keeps running on the abandoned thread until it ends. Fix: run SQLite in a killable
  `utilityProcess`.
- **Read-only data sources.** Enforced through the server session setting plus a guard against
  `SET … READ WRITE`. For a hard boundary, connect with a read-only database role.
- **SQLite file path.** The file path comes from the renderer. A compromised renderer could point a
  SQLite profile at any file the user can read. IPC accepts only our own frames, which reduces but
  does not remove this.
- **Binary cells** are previewed up to 4 KB. Clone Row skips truncated values; exports write the preview.
- **MySQL implicit commits.** These are tracked by keyword (DDL, LOCK, GRANT…). Server-side
  autocommit changes made inside routines are not observed.

## Review fixes applied (2026-10-15)

Independent correctness and security reviews were run, and every confirmed finding was fixed:
- **TLS:** `verify-full` mode added; there is no plaintext fallback on certificate errors.
- **Production CSP** is now an injected `<meta>` tag.
- **IPC:** sender-origin check, profile field whitelisting, and sanitized prefs and session.
- **Escaping:** identifiers are now escaped in completions and templates, and PostgreSQL uses `E''` strings.
- **Lost transactions:** a lost transaction is reported instead of a false "committed". Cosmetic
  profile edits no longer drop sessions.
- **MySQL implicit-commit tracking.**
- **Splitter:** `CREATE DEFINER=…` routines and MySQL `--` comments.
- **Grid:** Escape now cancels the edit, ⌘↩ includes the open edit, and no reload drops edits without asking.
- **Sessions:** dead connections reopen automatically, and the schema cache is reset on rollback.
- **Explain** honours the console's schema.
- **Duplicate** keeps the stored password.
- **Corrupt JSON files** are moved aside instead of being overwritten.

## Next (not implemented)

| Priority | Item | Notes |
|---|---|---|
| P1 | SSH tunnels | `ssh2` local port-forward per session; keep secrets in the Keychain |
| P1 | Editing console results from single-table queries | Reuse the table-editor change model when the result maps to one table with a PK |
| P1 | Confirm "probable" UI behaviors with REA `observe_native_ui` | Needs Accessibility + Screen Recording grants (see feasibility.md) |
| P2 | SQL Server adapter (`tedious`) | Adapter interface already engine-agnostic |
| P2 | ER diagrams, schema compare, CSV import, modify-table dialog | Later |
| P2 | Inspections / quick fixes | Out of scope for the MVP |
| P2 | Record view / transpose, aggregates in the grid | |
| P2 | Signed/notarized packaging | `npm run package` builds an unsigned `.app` |
