#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
scripts/engines.sh
cargo fetch --locked --manifest-path src-tauri/Cargo.toml --target aarch64-apple-darwin
python3 scripts/notices.py
cp LICENSE THIRD_PARTY_NOTICES.md src-tauri/notices/
npm run tauri -- build --bundles app
app=src-tauri/target/release/bundle/macos/Mewno.app
identity="${MEWNO_SIGN_IDENTITY:--}"
for helper in whisper-cli mewno-decode; do
    codesign --force --sign "$identity" --options runtime "$app/Contents/MacOS/$helper"
done
codesign --force --sign "$identity" --options runtime "$app"
codesign --verify --deep --strict "$app"
mkdir -p release .build
stage="$(mktemp -d "$PWD/.build/package.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
ditto "$app" "$stage/Mewno.app"
ln -s /Applications "$stage/Applications"
version="$(node -p "require('./package.json').version")"
dmg="Mewno-${version}-macOS-arm64.dmg"
hdiutil create -quiet -ov -fs HFS+ -format UDZO -volname Mewno -srcfolder "$stage" "release/$dmg"
(cd release && shasum -a 256 "$dmg" > SHA256SUMS)
