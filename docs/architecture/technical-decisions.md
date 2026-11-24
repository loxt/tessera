# Technical Decision Record

## TDR-1 Desktop runtime: **Electron** (over Tauri)

| Criterion | Electron | Tauri |
|---|---|---|
| DB drivers | Mature pure-JS drivers: `pg`, `mysql2`, built-in `node:sqlite`, `tedious` (MSSQL). No native builds needed | Rust `sqlx`/`tokio-postgres`; every engine needs Rust glue |
| Toolchain on this machine | Node 24 present | **Rust not installed** (no `cargo`/`rustc`) |
| Rendering consistency | One Chromium everywhere, so Monaco and the grid behave identically | WKWebView / WebView2 / WebKitGTK differences |
| Secrets | `safeStorage` → macOS Keychain, DPAPI, libsecret | Plugins / keyring crate |
| Size / memory | ~100 MB+ bundle | ~10 MB bundle |
| Packaging | electron-builder (dmg, nsis, AppImage) | tauri bundler |

**Decision: Electron.** A database IDE is driver-bound. Mature JS drivers for all major
engines, plus one rendering engine for a heavy editor and grid, outweigh the bundle size.
DataGrip itself is ~2.6 GB, so size is not this category's differentiator.

## TDR-2 UI: React 19 + TypeScript + Zustand

React has the largest ecosystem for Monaco. Zustand provides a small global store with
selectors, which avoids context re-render storms in a dense UI. No component library: the
IDE look needs custom high-density styling (`src/renderer/src/styles.css`, CSS variables
per theme).

## TDR-3 SQL editor: Monaco

Monaco comes with multi-cursor, folding, bracket matching, find/replace, minimap and
completion/marker APIs. CodeMirror 6 is lighter, but Monaco's IDE keyboard model is
closer to DataGrip's. Completion is a custom provider fed by the metadata cache. The
local `monaco-editor` package is used offline (no CDN).

## TDR-4 Process boundary

```
renderer (React, Monaco, grid)  ──  window.tessera (typed preload API, contextIsolation)  ──  main (Node)
                                                                             ├─ ConnectionStore + safeStorage
                                                                             ├─ SessionManager (one session per console/editor)
                                                                             ├─ adapters/{postgres,mysql,sqlite}
                                                                             └─ prefs/session/history persistence
```

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` for the renderer. All
  database access happens in main.
- Passwords never cross into the renderer. The renderer sees `hasPassword: boolean` only.
- The IPC contract lives in `src/shared/api.ts`. Every channel is typed once.

## TDR-5 Adapter interface

`src/main/db/types.ts` defines `Adapter` (open session, introspect children, DDL, explain,
cancel). Each engine implements it in one file. Adding an engine means one adapter file
plus one registry entry. The normalized model is `DbNode` (tree), `ResultSet`
(columns + rows of `CellValue`), `TableInfo` (columns, pk, fks, indexes).

## TDR-6 Sessions

DataGrip gives each console its own session. Tessera
does the same: one dedicated connection per console/table editor, opened lazily and
closed on tab close. Manual-transaction mode is per session. Cancellation uses a
side-channel connection (PG `pg_cancel_backend(pid)`, MySQL `KILL QUERY id`). SQLite runs
in a `worker_thread`, so a runaway query can be terminated without freezing main.

## TDR-7 Result fetching

Console results fetch at most `pageSize` rows (default 500, configurable): a `pg-cursor`
read for PostgreSQL, a stream read for MySQL, and an iterator for SQLite. "Fetch all"
re-runs without a limit. Table editors page server-side with `LIMIT/OFFSET` +
user WHERE/ORDER BY.

## TDR-8 Values over IPC

Cells are normalized in main to JSON-safe values: `null`, string, number, boolean, or
`{ $type: 'bigint' | 'date' | 'binary' | 'json', … }`. Binary is sent as truncated hex
with its full length. Lossless numbers (bigint/numeric) are sent as strings.

## TDR-9 Data editing

Editing is only allowed when a table has a primary key (SQLite: rowid fallback). Pending
changes are stored as `{ updates: Map<rowKey, {col: value}>, inserts: rows[], deletes: Set<rowKey> }`.
Submit generates **parameterized** DML per dialect, shows a preview and executes it in one
transaction (or inside the open manual transaction).

## TDR-10 Persistence

JSON files in Electron `userData`: `connections.json` (profiles, encrypted secrets),
`prefs.json`, `session.json` (open tabs + console text), `history.json` (capped
per connection). Writes are atomic: write to a temp file, then rename.

## TDR-11 Testing

Vitest. Pure logic (statement splitter, parameter detection, DML generation, exporters,
URL parsing) has unit tests. Adapters have integration tests against real databases:
SQLite in a temp file, PostgreSQL 17 and MySQL 8 in Docker (`docker-compose.yml`). The
integration suites skip when their database is unreachable, and say so.

## TDR-12 Versions

Dependencies are pinned to exact releases at least two weeks old as of 2026-10-15:
Electron 43.7.7 (Node 24.21, built-in `node:sqlite`), electron-vite 5.0.0, Vite 7.3.6
(electron-vite 5 supports Vite ≤ 7), React 19.3.0, Monaco 0.57.0, pg 8.23.1,
mysql2 3.24.5, Playwright 1.63.0 (e2e only).

## TDR-13 E2E verification without OS screen permissions

REA's native UI capture needs macOS Accessibility and Screen Recording grants, and this
session has neither. Tessera's own UI is verified with Playwright's Electron driver
(`e2e/smoke.e2e.ts`) instead. It renders screenshots from inside the app's Chromium, so it
needs no OS permission, and it drives the real built app against real SQLite and
PostgreSQL databases.
