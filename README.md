# FM SaveLens 24

A local Football Manager 2024 save reader with a Rust backend, a Tauri desktop interface, and a browser interface. Search players by name or public ID, combine scouting filters, and inspect CA/PA, clubs, nationalities, dates, all 62 attributes, and 15 position ratings.

Saves are read only. Extracted data and settings stay on your computer. Packaged downloads require neither Node.js nor Rust.

## Downloads

Get published builds from [GitHub Releases](https://github.com/MSalman5230/FM-SaveLens-24/releases). Development packages are attached to successful [Actions runs](https://github.com/MSalman5230/FM-SaveLens-24/actions). The initial release version is **1.0.0**.

| Platform | Download (version 1.0.0 example) | How to run |
| --- | --- | --- |
| Windows x64 | `FM-SaveLens-24-v1.0.0-windows-x64-portable.zip` | Extract and run `fm-savelens-24.exe`; no installer |
| Windows x64 | `FM-SaveLens-24-v1.0.0-windows-x64-setup.exe` | Run the setup wizard |
| Linux x86_64 | `FM-SaveLens-24-v1.0.0-linux-x86_64.AppImage` | Make executable and run; no installer |
| Linux x86_64 | `FM-SaveLens-24-v1.0.0-linux-x86_64.flatpak` | Install with Flatpak |

Portable means the application runs without installation. Settings and snapshots use normal per-user storage, not the extracted application directory. Releases include `SHA256SUMS` for all four downloads.

### Windows

Extract the entire portable ZIP before opening the executable. Keep the bundled `WebView2Runtime` directory beside it: this fixed runtime is resolved relative to the executable, including paths containing spaces. It does not install WebView2. Windows 10/11 x64 is the intended platform.

Extract to a local disk. Microsoft does not support fixed runtimes on network/UNC paths. On Windows 10, the app prepares the bundled runtime folder's read/execute permissions for the WebView2 sandbox; settings and saves are unaffected.

The installer creates application shortcuts and handles the WebView2 prerequisite; downloading the prerequisite can require Internet access. Initial builds are unsigned.

For browser mode, run `Start-Browser.cmd` and stop its background server with `Stop-Browser.cmd`. The `Start-FM-SaveLens-24.cmd` and `Stop-FM-SaveLens-24.cmd` launcher aliases are also available in the repository. The ZIP also contains `fm-savelens-24-server.exe`, which runs directly in a terminal.

### Linux AppImage

```sh
chmod +x FM-SaveLens-24-v1.0.0-linux-x86_64.AppImage
./FM-SaveLens-24-v1.0.0-linux-x86_64.AppImage
# Browser mode, using the same embedded frontend and backend:
./FM-SaveLens-24-v1.0.0-linux-x86_64.AppImage --browser
# Systems without FUSE:
./FM-SaveLens-24-v1.0.0-linux-x86_64.AppImage --appimage-extract-and-run
```

You can append `--browser` to the extraction command. Alternatively, run `--appimage-extract`, then `./squashfs-root/AppRun`. The AppImage is built on Ubuntu 22.04 (glibc 2.35 baseline), bundling WebKitGTK and application resources. A compatible graphical Linux system is still required. See [Tauri's compatibility guidance](https://v2.tauri.app/distribute/appimage/) and the [AppImage FUSE fallback](https://docs.appimage.org/user-guide/troubleshooting/fuse.html).

### Linux Flatpak

```sh
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user ./FM-SaveLens-24-v1.0.0-linux-x86_64.flatpak
flatpak run io.github.MSalman5230.FMSaveLens24
# Standalone browser server:
flatpak run --command=fm-savelens-24-server io.github.MSalman5230.FMSaveLens24
```

The bundle uses the GNOME 50 runtime, downloaded by Flatpak when necessary. It has display access, networking for localhost browser access, and read-only home-directory access for saves. Snapshots remain in private application storage. To read saves on another drive:

```sh
flatpak override --user --filesystem=/path/to/saves:ro io.github.MSalman5230.FMSaveLens24
```

Choose that folder in Settings. Flatpak treats a few home subdirectories specially; grant a specific read-only override if a save directory is hidden by the sandbox. Flathub publication is not part of this release.

## Using the app

1. Finish saving in Football Manager.
2. Launch FM SaveLens 24. On first use, configure the save folder in **Settings** if the platform's usual folder does not exist.
3. Choose a save and select **Read save**. Reopening an unchanged save loads its cached snapshot.

Desktop mode uses an available loopback port. **Open in Browser** in the application menu opens the same running service. Closing the desktop application stops its service and cancels unfinished imports.

Standalone browser mode defaults to port 4242:

```sh
fm-savelens-24-server --port 4242 --no-open
```

Omit `--no-open` to open the browser automatically. `FM_SAVELENS_24_PORT` and `FM_SAVELENS_24_DATA_DIR` are supported. Ctrl+C (or SIGTERM on Linux) gracefully stops the server. Only one process may write to a data directory at a time.

Imports run off the HTTP/UI thread, one at a time, with cooperative cancellation. Changed source files invalidate cache selections. Failed or cancelled imports never publish a partial snapshot.

Search preserves Unicode and supports unaccented queries. Filters include secondary nationalities, accomplished/natural positions (rating at least 15), age, CA/PA, clubs, and minimum attributes. Sort columns and paginate up to 250 players per page. An unavailable club means no verified link was resolved; it does not assert the player is a free agent. Raw attributes and source offsets are retained.

## Storage and migration

| Platform | Default settings and snapshot directory |
| --- | --- |
| Windows | `%LOCALAPPDATA%\io.github.MSalman5230.FMSaveLens24` |
| Linux | `$XDG_DATA_HOME/io.github.MSalman5230.FMSaveLens24`, normally `~/.local/share/io.github.MSalman5230.FMSaveLens24` |
| Flatpak | `~/.var/app/io.github.MSalman5230.FMSaveLens24/data/io.github.MSalman5230.FMSaveLens24` |

`FM_SAVELENS_24_DATA_DIR` overrides this location. On Windows, the existing `%LOCALAPPDATA%\FM-SaveLens-24\settings.json` save-folder setting is migrated when no new settings exist. Old files are preserved. Snapshots are rebuilt under the distinct Rust parser version `fm24-rust-1`; historical TypeScript caches are not reused.

## Supported saves and validation

The verified boundary is FM24 internal format **24.3.0+0**, compressed with Zstandard or uncompressed. Unsupported formats, including FM23, return explicit errors. This is an independently implemented reader, not a general decoder for every Football Manager archive revision. It is not affiliated with Sports Interactive or SEGA.

See [format evidence](docs/FORMAT.md) and [validation results](docs/VALIDATION.md). Rust migration acceptance compares complete deterministic results with the retained TypeScript reference over the local save collection, including raw ratings, identities, diagnostics, and warnings. Private saves are never required by public CI or committed to the repository.

## Development

Install Node.js 24.14+ and the pinned Rust toolchain from `rust-toolchain.toml`. Desktop builds also need [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/): MSVC on Windows; WebKitGTK 4.1 and the listed development libraries on Linux.

```sh
npm ci
npm --prefix web ci
npm run build:web
npm test
npm run test:web
npm --prefix web run lint
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
npm run build
npm start
```

`npm start` runs the Rust browser server without opening a tab. For frontend hot reload, also run `npm --prefix web run dev` and use port 5173; its API proxy targets port 4242.

The root Cargo package contains the reusable library and standalone server. `src-tauri` is the desktop workspace member. Production frontend assets are embedded at compilation. `server/` contains the historical TypeScript parser/API as a development reference; it is not shipped as the application backend.

### Tests

`npm test` runs portable synthetic Rust parser and API tests on either platform: compressed/plain and malformed archives, ownership, Unicode, attributes, queries, cancellation, source changes, cache reopening, and data-directory locking.

`npm run test:web` runs the frontend focus-refresh regression tests with Node's built-in test runner, including save switches, overlapping requests, cancellation, and cleanup. Both platform CI jobs run these tests.

For optional local reference checks, set `FM_SAVELENS_24_FIXTURE_DIR` to your private save directory and run `npm run test:reference` after building the Rust server. To compare every save's full deterministic parser result and verify before/after source hashes:

```sh
cargo build --release --locked --example parse-save
npm run test:parity -- /path/to/private/saves
```

Results go to ignored `.cache/rust-parity.json`. Historical TypeScript benchmarks are labelled separately in the validation document; they are not Rust performance measurements.

### Packaging

Build the frontend and release server first (`npm run build`), then:

```powershell
# Windows: NSIS installer, then fixed-runtime portable ZIP
npm run tauri -- build --bundles nsis -- --locked
./scripts/package-windows.ps1
```

```sh
# Ubuntu 22.04 AppImage
npm run tauri -- build --bundles appimage -- --locked
# Separate GNOME 50 SDK build; requires Flatpak, flatpak-builder and appstream-compose
bash scripts/package-flatpak.sh
```

The fixed WebView2 download and SHA-256 are pinned in `packaging/webview2.json`. Update both together from [Microsoft's fixed runtime distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution#the-fixed-version-runtime-distribution-mode) when maintaining the package. Linux SDK builds use vendored, locked Cargo dependencies with no network access during compilation.

## Releases

Release Please manages one Rust product, starting at **1.0.0**, and updates Cargo manifests/lockfile, npm metadata/lockfiles, and Tauri metadata together. Use Conventional Commits on `master`:

| Commit | Version change after 1.0.0 |
| --- | --- |
| `fix: correct a filter` | Patch |
| `feat: add a filter` | Minor |
| `feat!: change the API` or a `BREAKING CHANGE:` footer | Major |

Enable **Settings → Actions → General → Workflow permissions → Allow GitHub Actions to create and approve pull requests**. The current repository setting could not be verified with available permissions.

Merging a Release Please PR creates its changelog, `vX.Y.Z` tag, and GitHub release. The release workflow immediately builds both platforms from the exact tagged commit, validates all four expected packages, and uploads them with `SHA256SUMS` only after both builds succeed. Build failures can leave the release without downloads until a successful rebuild.

PRs, pushes to `master`, and manual CI runs build both platforms. Because `GITHUB_TOKEN` events generally do not trigger other workflows, the release workflow explicitly dispatches CI for its bot-created PR branches and calls the reusable build workflow directly for releases. See [GitHub's trigger restrictions](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

To rebuild an existing release, run **Release** manually with its existing `vX.Y.Z` tag. It resolves the tagged commit and checks that all versions agree before replacing release assets. No personal access token is required by the workflows.

Initial architecture support is Windows x64 and Linux x86_64. Automatic application updates, Flathub publication, and Windows code signing are outside this release.
