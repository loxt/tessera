# Contributing to Tessera

Thanks for helping. Bug reports, feedback from daily use and pull requests are all welcome.

## Report a bug or ask for something

Open an [issue](https://github.com/loxt/tessera/issues) with:

- what you did, what you expected and what happened instead
- the engine and version (PostgreSQL 17, MySQL 8.4, SQLite…) and your OS
- a screenshot when it is visual, the error text when there is one

Never paste connection strings, passwords or real customer data.

## Set up

Requirements: Node.js 22+, npm, and Docker for the PostgreSQL/MySQL test servers.

```bash
git clone https://github.com/loxt/tessera.git
cd tessera
npm install
npm run dev        # the app with hot reload
npm run db:up      # PostgreSQL 17 + MySQL 8.4, seeded from fixtures/ (optional)
```

To try something without touching your own data sources, start a separate profile:
`TESSERA_USER_DATA=/tmp/tessera-dev npm run dev`.

## Where things live

The [README](README.md#architecture) has the map. In short: `src/shared` holds the domain model and the
typed IPC contract (`api.ts`), `src/main` the Electron side and one adapter per engine in `src/main/db`,
`src/renderer` the React UI. The renderer never touches Node; every call goes through `window.tessera`.

- **New IPC call**: add it to `TesseraApi` and `API_METHODS` in `src/shared/api.ts`, then implement it in
  `src/main/ipc.ts`. Validate its arguments there; the renderer is not trusted.
- **New menu action or shortcut**: add it to `ACTIONS` in `src/shared/actions.ts` and a handler in
  `src/renderer/src/actions.ts`. Menu, keymap and command palette pick it up from there.
- **New engine**: implement `Adapter` in `src/main/db/<engine>.ts` and register it in `registry.ts`.

## Before you open a pull request

```bash
npm run typecheck
npm test                       # DB suites skip when the servers are down; run db:up to include them
npm run build && npm run e2e   # drives the real app; needed when you change UI flows
```

- Add or update a test for the behavior you changed. Pure logic gets a unit test next to it
  (`*.test.ts`); a UI flow gets a step in `e2e/smoke.e2e.ts`.
- `npm run e2e` rewrites `docs/screenshots/`. Commit them only when the README should show the change.
- Keep each pull request to one fix or feature, against `main`. It is squash-merged.

## Style

- TypeScript strict; avoid `any`.
- Small focused files and functions. Reuse what is in `src/shared` before writing a new helper.
- Return new objects instead of mutating state (the Zustand store relies on it).
- Every color is a CSS variable from the theme; never hardcode one in a component.
- Comments explain *why*, not what the next line does.
- Commit messages and PR titles follow [Conventional Commits](https://www.conventionalcommits.org):
  `fix: keep the console schema when the data source has no database`.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
