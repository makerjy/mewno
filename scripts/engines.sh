#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "$(uname -sm)" == 'Darwin arm64' ]] || { echo "Requires an Apple Silicon Mac"; exit 1; }
rev=d1be6fde11ac6e0407606b4e42fe72d34add8037
dir=.build/whisper.cpp
mkdir -p .build src-tauri/binaries src-tauri/notices
[[ -d "$dir/.git" ]] || git clone --depth 1 --branch v1.9.5 https://github.com/ggml-org/whisper.cpp.git "$dir"
[[ "$(git -C "$dir" rev-parse HEAD)" == "$rev" ]]
export MACOSX_DEPLOYMENT_TARGET=14.0
cmake -S "$dir" -B .build/engine -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_BLAS=OFF -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_DEPLOYMENT_TARGET=14.0
cmake --build .build/engine --target whisper-cli -j 6
suffix=aarch64-apple-darwin
cp .build/engine/bin/whisper-cli "src-tauri/binaries/whisper-cli-$suffix"
clang ${CFLAGS:-} -O2 -fobjc-arc -Wno-deprecated-declarations native/decode.m -framework AVFoundation -framework CoreMedia -framework Foundation -o "src-tauri/binaries/mewno-decode-$suffix"
cp "$dir/LICENSE" src-tauri/notices/whisper.cpp.txt
