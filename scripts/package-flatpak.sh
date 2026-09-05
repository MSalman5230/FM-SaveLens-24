#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user --noninteractive flathub org.gnome.Platform//50 org.gnome.Sdk//50
sdk_branch=$(flatpak info --user --show-metadata org.gnome.Sdk//50 | awk -F ' *= *' '/^\[Extension org.freedesktop.Sdk.Extension\]/{inside=1;next} /^\[/{inside=0} inside && $1=="version" {print $2;exit}')
test -n "$sdk_branch"
flatpak install --user --noninteractive flathub "org.freedesktop.Sdk.Extension.rust-stable//$sdk_branch"
node scripts/stage-flatpak.mjs
# Generate the catalog and icons on the host. Running the GNOME SDK's image
# loader in a build sandbox requires a nested Flatpak portal that is not there.
# Compose before assembly: Ubuntu's builder renames metainfo to legacy appdata.
stage=packaging/stage/flatpak-source
metadata=packaging/stage/flatpak-metadata
app_id=io.github.MSalman5230.FMSaveLens24
install -Dm644 "$stage/fm-savelens.metainfo.xml" "$metadata/share/metainfo/$app_id.metainfo.xml"
install -Dm644 "$stage/fm-savelens.desktop" "$metadata/share/applications/$app_id.desktop"
install -Dm644 "$stage/src-tauri/icons/128x128@2x.png" "$metadata/share/icons/hicolor/256x256/apps/$app_id.png"
appstreamcli compose --no-net --print-report=full --prefix=/ \
  --origin=fm-savelens-24 --result-root="$stage" \
  --data-dir="$stage/share/app-info/xmls" \
  --icons-dir="$stage/share/app-info/icons/flatpak" "$metadata"
gzip -dc "$stage/share/app-info/xmls/fm-savelens-24.xml.gz" | grep -F "<id>$app_id</id>"
test -s "$stage/share/app-info/icons/flatpak/64x64/$app_id.png"
cargo vendor --locked "$stage/vendor" > /dev/null
flatpak-builder --user --force-clean --repo=flatpak-repo flatpak-build packaging/io.github.MSalman5230.FMSaveLens24.yml
mkdir -p dist
version=$(node -p "require('./package.json').version")
flatpak build-bundle flatpak-repo "dist/FM-SaveLens-24-v${version}-linux-x86_64.flatpak" io.github.MSalman5230.FMSaveLens24 --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo
