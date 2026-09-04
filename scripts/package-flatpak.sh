#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user --noninteractive flathub org.gnome.Platform//50 org.gnome.Sdk//50
sdk_branch=$(flatpak info --user --show-metadata org.gnome.Sdk//50 | awk -F ' *= *' '/^\[Extension org.freedesktop.Sdk.Extension\]/{inside=1;next} /^\[/{inside=0} inside && $1=="version" {print $2;exit}')
test -n "$sdk_branch"
flatpak install --user --noninteractive flathub "org.freedesktop.Sdk.Extension.rust-stable//$sdk_branch"
node scripts/stage-flatpak.mjs
cargo vendor --locked packaging/stage/flatpak-source/vendor > /dev/null
flatpak-builder --user --force-clean --repo=flatpak-repo flatpak-build packaging/io.github.MSalman5230.FMSaveLens24.yml
mkdir -p dist
version=$(node -p "require('./package.json').version")
flatpak build-bundle flatpak-repo "dist/FM-SaveLens-24-v${version}-linux-x86_64.flatpak" io.github.MSalman5230.FMSaveLens24 --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo
