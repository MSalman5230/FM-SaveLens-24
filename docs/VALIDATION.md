# Validation results

## Rust migration acceptance — 5 September 2026

Parser: **fm24-rust-1**, application version **1.0.0**.

- Compared the complete deterministic Rust parse result against the TypeScript reference for all 62 local saves: all 61 FM24 saves matched, including every player's identities, names, clubs, nationalities, dates, raw and displayed attributes, positions, source offsets, warnings, and structural diagnostics. Runtime and memory measurements are deliberately excluded from equality checks.
- The remaining FM23 save produced the same expected unsupported-format error.
- SHA-256 hashes before and after parsing matched for all 62 source files.
- Six portable synthetic Rust parser and API tests passed on Windows and Ubuntu 22.04, including foreign ownership exclusion, directional sorting, simultaneous imports, and cancellation cleanup. Frontend production build/lint and workspace Clippy passed.
- The reference API test now targets the Rust server and passed with the private Tactics Creator fixture. The retained TypeScript reference tests also passed, including the screenshot/FMRTE reference values and edited single-name players.
- Release Please's actual version updaters passed first-release, patch, minor, major, Cargo workspace, npm lockfile, and Tauri metadata synchronization tests. Workflow YAML passed actionlint.
- The Windows NSIS installer built successfully; the portable ZIP passed its extracted standalone-server check in a path containing spaces. The desktop loaded WebView2 from that ZIP and exposed the complete interface through Windows accessibility. PE dependency inspection confirmed the final server uses the static Visual C++ runtime.
- Through the Rust browser interface, imported the 67,547-player Salford save, filtered to Abu Suleiman, and opened his full reference profile.
- The Ubuntu 22.04 AppImage passed browser-server smoke checks both through FUSE and through extraction. A graphical launch under Xvfb rendered the branded interface and first-run folder settings.

Reproduce collection parity with `npm run test:parity -- /path/to/private/saves`. The detailed migration report is written to ignored `.cache/rust-parity.json`; private saves are not included in CI.

## Historical TypeScript validation

The results below were obtained with the **TypeScript fm24-7** implementation on this Windows PC, 5 September 2026 (local time). Its import performance and browser checks are historical evidence, not measurements of the Rust implementation.

## Real saves

- 62 source saves checked. All 61 FM24 saves parsed successfully: 53 uncompressed and 8 compressed.
- The remaining compressed FM23 save (`Masood Salman - Leeds FM23.fm`, internal format `23.4.0+0`) produced the expected unsupported-version error.
- Every detected player attribute block in all 61 supported saves resolved to an unambiguous player identity. No excluded/ambiguous player blocks remained.
- Each file was SHA-256 hashed before and after reading. **All 62 source files were unchanged.**
- Save dates span 3 July 2023 to 4 March 2054. Coverage includes generated players, edited-database source IDs, single-name players, duplicate names, accents, goalkeepers, and long careers.
- The final collection run used three isolated validation processes. The application itself permits only one import worker at a time. Per-file parser times in the attached JSON include contention during that validation run.

## Independent references

- `Salford - Masood.fm`: **67,547 players**.
- All 18 screenshot rows matched names (using the saved full name for the shortened Enol), ages, CA/PA, clubs, primary nationalities, and visible secondary nationalities.
- All 14 readable attribute columns matched across those rows: **252 attribute comparisons**.
- Both supplied FMRTE exports matched **all 62 attributes each**: another **124 attribute comparisons**. Public IDs, CA/PA, birth dates, and all 14 exported position ratings also matched.
- The two screenshot players with CA/PA 200 were verified. The JSON reference players were Aaron Nattermann and Abu Suleiman.

## Import performance

Measured on the largest save, **Salford - EU Realism Mod - Masood (v03).fm** (1.284 GB):

- 68,965 players imported and indexed in SQLite.
- Worker import plus cache creation: **7.30 seconds**; request-to-completion observation: 7.51 seconds.
- Peak resident memory reported by Node for the app process: **773 MiB**.
- Slowest health request while importing: **1.08 ms**.
- Slowest combined-filter search of an existing cached save during import: **156.4 ms**.
- Results depend on disk cache, antivirus activity, hardware, and save size; these are measured observations, not guarantees.

## Application checks

- Automated tests: reference extraction; edited single-name players; truncated files and unsupported name tables; missing clubs; concurrent import rejection; cancellation; files changing before/during import; stale caches; literal search wildcards; accent-insensitive name searches; combined age/ability/position/attribute filters; sorting and non-overlapping pagination; invalid query values; missing player IDs; local-origin restrictions.
- Browser checks against the production build: save discovery with size/date/status, typing in save and club pickers, combined club/PA/hidden-attribute filtering, reset, pagination, ascending/descending name sorting, goalkeeper/outfield profiles, import cancellation, and cached-save loading.
- Browser tool checks: both tools registered; valid calls updated the table/profile; out-of-range potential and nonexistent player IDs failed without corrupting the interface.
- `npm test`, `npm --prefix web run lint`, and `npm run build` passed. TypeScript checks run as part of the configured type-aware lint; a standalone frontend type check also passed.
- Windows launcher start, stop, repeated start, and HTTP health were exercised. The production static assets were loaded in the browser on port 4242.

## Scope of verification

Independent screenshots/exports validate the supplied reference players. Structural collection checks validate ownership and consistency across all detected records; they do not constitute an independent manual comparison of every player. Unknown club links stay unavailable, unsupported layouts fail explicitly, and unverified nonrequested fields are not exposed.

Detailed results: [collection-results.json](collection-results.json), [import-benchmark.json](import-benchmark.json).

| Save | Players | Game date | Compression | Source unchanged |
| --- | ---: | --- | --- | --- |
| James Colin - Luton Town (Manager).fm | 67,714 | 2023-07-03 | Plain | Yes |
| last save overwrite backup.fm | 69,469 | 2046-06-21 | Plain | Yes |
| Masood - Minosota.fm | 59,801 | 2031-02-12 | Plain | Yes |
| Masood - San Jose.fm | 72,178 | 2024-08-19 | Plain | Yes |
| Masood Salman - Everton (v02).fm | 12,710 | 2023-11-15 | Zstandard | Yes |
| Masood Salman - Everton (v03).fm | 12,711 | 2023-10-15 | Zstandard | Yes |
| Masood Salman - Everton 3 (v02).fm | 60,521 | 2025-01-01 | Plain | Yes |
| Masood Salman - Everton 3 (v03).fm | 60,848 | 2024-12-29 | Plain | Yes |
| Masood Salman - Everton 3.fm | 60,141 | 2025-01-21 | Plain | Yes |
| Masood Salman - Everton Legend (v02).fm | 58,192 | 2036-07-21 | Plain | Yes |
| Masood Salman - Everton Legend (v03).fm | 59,650 | 2036-06-01 | Plain | Yes |
| Masood Salman - Everton Legend.fm | 58,192 | 2036-07-22 | Plain | Yes |
| Masood Salman - Everton New (v02) (v02).fm | 63,879 | 2024-05-25 | Zstandard | Yes |
| Masood Salman - Everton New (v02) (v03).fm | 62,190 | 2024-05-11 | Zstandard | Yes |
| Masood Salman - Everton New (v02).fm | 62,397 | 2024-06-19 | Zstandard | Yes |
| Masood Salman - Everton New (v03).fm | 60,027 | 2023-11-04 | Zstandard | Yes |
| Masood Salman - Everton New.fm | 62,397 | 2024-06-19 | Zstandard | Yes |
| Masood Salman - Everton.fm | 12,709 | 2023-12-04 | Zstandard | Yes |
| Masood Salman - Leeds FM23.fm | Unsupported FM23 | — | Zstandard | Yes |
| Masood Salman - Nottm Forest.fm | 59,410 | 2023-07-03 | Plain | Yes |
| Player Dev 1 (v02).fm | 7,499 | 2024-11-05 | Plain | Yes |
| Player Dev 1 (v03).fm | 6,652 | 2023-11-06 | Plain | Yes |
| Player Dev 1.fm | 7,973 | 2026-06-17 | Plain | Yes |
| Player Dev Template.fm | 6,636 | 2023-07-13 | Plain | Yes |
| Salford - EU Realism Mod - Masood (v02).fm | 68,287 | 2041-11-30 | Plain | Yes |
| Salford - EU Realism Mod - Masood (v03).fm | 68,965 | 2041-10-21 | Plain | Yes |
| Salford - EU Realism Mod - Masood.fm | 68,287 | 2041-11-30 | Plain | Yes |
| Salford - Masood (v02).fm | 67,537 | 2049-07-02 | Plain | Yes |
| Salford - Masood (v03).fm | 69,146 | 2049-05-16 | Plain | Yes |
| Salford - Masood.fm | 67,547 | 2049-07-11 | Plain | Yes |
| Tactics Creator (v02).fm | 6,629 | 2023-08-06 | Plain | Yes |
| Tactics Creator (v03).fm | 6,629 | 2023-08-06 | Plain | Yes |
| Tactics Creator.fm | 6,629 | 2023-08-06 | Plain | Yes |
| Test.fm | 9,817 | 2023-07-03 | Plain | Yes |
| Universal Watcher - Eu No Change.fm | 44,133 | 2041-07-03 | Plain | Yes |
| Universal Watcher - EU Realism Mod (v02).fm | 69,707 | 2040-01-06 | Plain | Yes |
| Universal Watcher - EU Realism Mod (v03).fm | 71,631 | 2035-01-07 | Plain | Yes |
| Universal Watcher - EU Realism Mod.fm | 69,816 | 2040-08-02 | Plain | Yes |
| Universal Watcher - Legend Born (v02).fm | 35,911 | 2035-06-30 | Plain | Yes |
| Universal Watcher - Legend Born (v03).fm | 35,819 | 2034-06-30 | Plain | Yes |
| Universal Watcher - Legend Born.fm | 35,777 | 2036-12-23 | Plain | Yes |
| Universal Watcher - Only injury Change (v02).fm | 69,130 | 2045-07-07 | Plain | Yes |
| Universal Watcher - Only injury Change (v03).fm | 73,340 | 2043-04-12 | Plain | Yes |
| Universal Watcher - Only injury Change.fm | 69,469 | 2046-06-21 | Plain | Yes |
| Universal Watcher - Test Award.fm | 24,079 | 2025-07-02 | Plain | Yes |
| Universal Watcher - Unemployed (v02).fm | 59,649 | 2052-10-20 | Plain | Yes |
| Universal Watcher - Unemployed (v03).fm | 59,971 | 2051-10-21 | Plain | Yes |
| Universal Watcher - Unemployed MT.fm | 23,005 | 2023-07-03 | Plain | Yes |
| Universal Watcher - Unemployed.fm | 58,431 | 2054-03-04 | Plain | Yes |
| Universal Watcher - Update (v02).fm | 65,349 | 2023-07-03 | Plain | Yes |
| Universal Watcher - Update.fm | 68,230 | 2024-10-29 | Plain | Yes |
| Universal Watcher - USA 1 (v02).fm | 61,090 | 2029-07-01 | Plain | Yes |
| Universal Watcher - USA 1 (v03).fm | 60,873 | 2028-07-01 | Plain | Yes |
| Universal Watcher - USA 1.fm | 59,801 | 2031-02-12 | Plain | Yes |
| Universal Watcher - USA 2 (v02).fm | 19,962 | 2038-07-13 | Plain | Yes |
| Universal Watcher - USA 2 (v03).fm | 19,788 | 2037-07-13 | Plain | Yes |
| Universal Watcher - USA 2.fm | 19,764 | 2040-02-04 | Plain | Yes |
| Universal Watcher - USA 3 (v02).fm | 64,806 | 2039-06-29 | Plain | Yes |
| Universal Watcher - USA 3 (v03).fm | 65,262 | 2038-06-29 | Plain | Yes |
| Universal Watcher - USA 3.fm | 62,626 | 2041-01-11 | Plain | Yes |
| Watcher Watcher - Unemployed (v02).fm | 69,817 | 2023-07-31 | Plain | Yes |
| Watcher Watcher - Unemployed.fm | 72,180 | 2024-07-30 | Plain | Yes |
