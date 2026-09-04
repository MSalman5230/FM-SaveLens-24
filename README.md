# FM Scout 24

A local Football Manager 2024 save reader and scouting database for this Windows PC. It reads player names, exact CA/PA, positions, clubs, nationalities, dates of birth, and 62 visible and hidden ratings directly from `.fm` saves.

## Open the app

1. Finish saving and close Football Manager.
2. Double-click **Start-FMScout.cmd**.
3. Choose a save and select **Read save**. Previously imported saves open from the local cache.

The app opens at **http://127.0.0.1:4242/**. The supplied `Salford - Masood.fm` is the default on first use. Subsequent launches restore the last loaded snapshot. **Stop-FMScout.cmd** stops the background server started by the launcher.

Node.js **24.14 or newer** must be installed. The production build is already present on this PC. If the build is missing, the launcher installs the frontend dependencies when necessary and builds it automatically. Normal use needs no Internet connection.

## Scouting

- Search by name or public player ID. Accents are preserved in names; the name search also accepts unaccented text.
- Combine club, nationality, position, age, CA/PA ranges, and minimum attribute filters. A nationality filter includes secondary nationalities.
- Position filters include accomplished and natural positions, rated 15 or higher.
- Click a sortable column heading again to reverse its order. The initial order is PA descending, then CA descending.
- Choose 25, 50, 100, or 250 players per page. Select a player to open the full profile.
- Technical, mental, physical, goalkeeping, foot strength, and hidden/personality groups are included. Ratings use 1–20; CA/PA use 1–200. The raw saved ratings remain in the cache.
- An unavailable club means that no verified club link was resolved; it does not assert that the player is a free agent.

Change the save directory in **Settings**. Imports run one at a time and can be cancelled. Files changing during import produce a retry error. A source-file or parser-version change invalidates the cached selection; an open older snapshot is marked out of date.

## Local storage

Source saves are opened read-only. The app does not edit or write into the games directory. All extracted data stays on this PC:

```text
%LOCALAPPDATA%\FMScout24\settings.json
%LOCALAPPDATA%\FMScout24\snapshots\<snapshot-id>.sqlite
%LOCALAPPDATA%\FMScout24\server.log
%LOCALAPPDATA%\FMScout24\server-error.log
```

There are no accounts, hosting, CSV exports, or dependencies on running FM, Genie Scout, or FMRTE. The FMRTE JSON files supplied in `players-crosscheck` are independent test references only.

## Supported saves and validation

The reader supports the FM24 archive/database layout with internal version `24.3.0+0`, including compressed and uncompressed saves. Other versions fail with an explicit error. The FM23 save in the supplied folder is intentionally unsupported.

The integration tests check all 18 rows of the supplied Salford screenshot, including the two CA/PA 200 players. They also compare all 62 attributes, public IDs, CA/PA, birth dates, and 14 position ratings for both supplied FMRTE exports. See **docs/VALIDATION.md** for collection results and measured performance, and **docs/FORMAT.md** for parser evidence and boundaries.

## Development

```powershell
npm --prefix web ci
npm test
npm --prefix web run lint
npm run build
npm start
```

For frontend development, run `npm start` in one terminal and `npm --prefix web run dev` in another. The development browser is at `http://127.0.0.1:5173/`; API requests are proxied to port 4242. The production app serves the static frontend and API together on port 4242. Both servers bind to `127.0.0.1`.

The frontend uses the React/TypeScript Sites starter, Vinext/Vite, Tailwind, and its shadcn/Base UI components. The backend has no third-party runtime dependencies: Node provides Zstandard, worker threads, HTTP, and SQLite. `web/scripts/build.mjs` lets successful builds exit naturally to avoid an observed Windows native-worker shutdown assertion; build failures still exit with a nonzero status. Lint covers application code; the generated component catalog is excluded.

Environment overrides for isolated development/test servers: `FMSCOUT_PORT` and `FMSCOUT_DATA_DIR`. The Windows launcher uses the standard port and data directory. Real-save integration tests skip when their source fixture is absent. The collection check is an explicit, longer read-only run: `node research/check-collection.ts`.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | App and parser version |
| `GET /api/settings`, `PUT /api/settings` | Read or change the save folder |
| `GET /api/saves` | File names, sizes, modified dates, snapshot IDs and cache state |
| `GET /api/attributes` | Attribute keys and position order |
| `POST /api/imports` | Start/open a save using `{ "saveId": "…" }` |
| `GET /api/imports/:job`, `DELETE /api/imports/:job` | Progress and cancellation |
| `GET /api/snapshots/:snapshot` | Metadata, clubs, countries and stale status |
| `GET /api/snapshots/:snapshot/players` | Filtered, sorted, paginated results |
| `GET /api/snapshots/:snapshot/players/:entityId` | Player details and raw attributes |

Search parameters: `q`, `club`, `nation`, `position`, `ageMin/Max`, `caMin/Max`, `paMin/Max`, `attr_<key>`, `sort`, `direction`, `page`, `limit`. Club/nation IDs come from snapshot metadata; position is a zero-based index from the attribute catalog. All filters combine with AND. Players are identified by **snapshot ID plus entity ID**, so names and public IDs from different saves cannot collide.

Where supported, the browser exposes `search_players` and `open_player` tools through `document.modelContext`. They operate on the same visible table and profile panel.
