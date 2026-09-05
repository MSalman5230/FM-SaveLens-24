# FM SaveLens 24

A local Football Manager 2024 save reader for desktop and browser. Search and filter players, compare current/potential ability (CA/PA), and inspect attributes, positions, clubs, and nationalities. Saves are read only, and your data stays on your computer.

Supports FM24 internal save format **24.3.0+0**, compressed or uncompressed. Not affiliated with Sports Interactive or SEGA.

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
npm --prefix web run lint
cargo fmt --all -- --check
cargo clippy --locked --workspace --all-targets -- -D warnings
```

See [format notes](docs/FORMAT.md) and [validation results](docs/VALIDATION.md) for parser details.
