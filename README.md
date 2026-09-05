# FM SaveLens 24

A local Football Manager 2024 save reader for desktop and browser. Search and filter players, compare current/potential ability (CA/PA), and inspect attributes, positions, clubs, and nationalities. Saves are read only, and your data stays on your computer.

Supports FM24 internal save format **24.3.0+0**, compressed or uncompressed. Not affiliated with Sports Interactive or SEGA.

Select multiple **Positions** in the left filters. **AND — All selected** (the default) requires a rating of **15+ in every selected position**; **OR — Any selected** requires 15+ in at least one. Remove individual chips or choose **Clear positions** to remove the restriction. Clearing all positions or using **Reset** restores AND. See [position filter query parameters and examples](docs/POSITION_FILTERS.md).

Rate players for all **45 FM24 roles / 85 role-and-duty profiles**. Select a role in search to rank and filter players, or open **Role ratings** on a profile for the key/preferable attribute breakdown. SaveLens scores are out of 100, with key attributes weighted twice as much as preferable attributes; position familiarity remains separate. Existing imports work immediately and ratings work offline. See the [complete role catalog and scoring research](docs/ROLE_RATINGS.md).

Use **Edit columns** above the player list to tick player details and any number of role ratings, including multiple duties for the same role. Click a role heading to sort, or a score to open its attribute breakdown. Player names stay visible while scrolling sideways, and your column view is remembered on this device. **Reset view** restores the default columns.

In **Settings → Rating systems**, copy the protected **Role Highlighted Rating** preset to create a named system with your own attribute weights. Include standard attributes, both foot strengths, and Consistency; use zero to exclude an attribute. Save edited roles as new roles, then choose **Use system** to apply your weights to player ratings, filters, sorting, and columns. Systems stay saved locally across imports and restarts. See [custom rating systems](docs/RATING_SYSTEMS.md).

## How to run

Download a build from [GitHub Releases](https://github.com/MSalman5230/FM-SaveLens-24/releases). Packaged builds need neither Node.js nor Rust.

### Windows 10/11 (x64)

- **Portable ZIP:** Extract everything to a local folder and run `fm-savelens-24.exe`. Keep the bundled `WebView2Runtime` folder beside it.
- **Installer:** Run the Windows setup `.exe` and follow the prompts.
- **Browser mode:** In the portable folder, run `Start-Browser.cmd`; use `Stop-Browser.cmd` to stop it.

### Linux (x86_64)

Download the AppImage, then run these commands from its folder:

```sh
chmod +x FM-SaveLens-24-*.AppImage
./FM-SaveLens-24-*.AppImage
```

Append `--browser` for browser mode or `--appimage-extract-and-run` if FUSE is unavailable. The AppImage requires a graphical system with glibc 2.35 or newer (Ubuntu 22.04 or equivalent).

Alternatively, download the Flatpak bundle and install it:

```sh
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user ./FM-SaveLens-24-*.flatpak
flatpak run io.github.MSalman5230.FMSaveLens24
```

After launching, finish saving in Football Manager, set your save folder in **Settings**, choose a save, and click **Read save**.

## Contributing

Open an issue for bugs or ideas, or fork the repository and submit a pull request. Keep changes focused, use Conventional Commits (`fix:`, `feat:`), and never commit private save files.

Use a Conventional Commit PR title, such as `fix: preserve fractional snapshot timestamps` or `feat(ui): add app branding`. The **PR title** check fails invalid titles with format guidance; edit the title manually to correct it. **Squash and merge using the validated title as the commit subject** so Release Please can detect the change. See [PR title rules and setup](docs/PR_TITLES.md).

To develop on Windows or Linux, install Node.js **24.14+**, Rust via rustup (the toolchain is pinned in `rust-toolchain.toml`), and the [Tauri build prerequisites](https://v2.tauri.app/start/prerequisites/). Then:

```sh
git clone https://github.com/MSalman5230/FM-SaveLens-24.git
cd FM-SaveLens-24
npm ci
npm --prefix web ci
npm run build:web
npm start
```

Open [localhost:4242](http://localhost:4242). For frontend hot reload, also run `npm --prefix web run dev` and open [localhost:5173](http://localhost:5173). For the desktop app, run `npm run tauri -- dev`.

Before submitting a pull request, run:

```sh
npm test
npm run test:web
node --test tests/pr-title.test.mjs
npm --prefix web run lint
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
```

See [format notes](docs/FORMAT.md) and [validation results](docs/VALIDATION.md) for parser details.
