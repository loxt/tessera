# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Electron desktop app for macOS; the renderer is a React web UI.)

## Users

A mixed team. Developers and DBAs write SQL, inspect plans and change schemas. Ops and
business people (analysts, support, operations) browse tables, filter, and edit records
without necessarily writing SQL. Both groups share the same data sources.

## Product Purpose

Tessera is a desktop database IDE for PostgreSQL, MySQL/MariaDB and SQLite: a Database
Explorer, query consoles with schema-aware completion, a fast editable result grid, and
transactions under the user's control. Success means a developer gets DataGrip-grade speed
and a non-developer can find, filter and safely edit data without fear.

## Positioning

DataGrip workflows (keymap import, consoles, explicit transactions, DML preview before
submit) in a tool approachable enough for the non-SQL half of the team.

## Operating Context

Daily work against local, staging and production databases. Credentials live in the macOS
Keychain. Data sources can be marked read-only (enforced server-side). Edits go through a
parameterized DML preview and an atomic submit.

## Capabilities and Constraints

- Shipped: explorer tree, Monaco consoles with completion, bind parameters, cancel,
  Auto/Manual transactions, explain plan tree, virtualized editable grid, FK navigation,
  export (CSV/TSV/JSON/SQL/Markdown), DDL view, split editor, Search Everywhere, query
  history, persistent named consoles, theme system (Tessera, Catppuccin, Hardhacker).
- Must preserve: the DataGrip keymap import and full keyboard-driven workflow.
- AI provider: the locally installed Claude Code (decided 2026-10-21), driven headless from the
  main process with the user's own login; no API key stored by Tessera. AI writes, explains and
  suggests SQL but never executes it on its own.
- Undecided: collaboration/sync backend, any team accounts.

## Evidence on Hand

Screenshots of the current build in `docs/screenshots/`. Fixture data in `fixtures/`
(Shop: customers, orders, order_items, products, audit_log). No customers, testimonials
or usage metrics exist; do not fabricate them.

## Product Principles

1. Keyboard first, never keyboard only: every action reachable by shortcut and by a visible control.
2. Safe by default: changes to data are previewed, reversible until submitted, and production is unmistakable.
3. One tool, two fluencies: SQL power for developers, visual equivalents for everyone else, over the same data.
4. Show the database as it is: no invented abstractions that hide what will run.
