# macOS 빌드 및 설치

일반 사용자는 DMG 안의 Mewno.app을 응용 프로그램 폴더로 복사합니다. 앱에 whisper-cli, mewno-decode, 웹 UI, 폰트와 고지를 넣고 모델은 사용자가 처음 한 번 받습니다.

## 개발 빌드

Apple Silicon Mac, 정상 설치된 Xcode Command Line Tools/macOS SDK, CMake, Git, Node 24 이상, npm, Rust/Cargo, Python 3이 필요합니다. Python은 릴리스 고지 수집과 시험 데이터 생성에 사용합니다. 디버그 및 릴리스 빌드에는 서로 호환되는 최신 stable Rust와 잠긴 의존성을 사용합니다.

```sh
npm ci
scripts/engines.sh
npm run tauri -- dev
```

엔진 빌드 스크립트는 whisper.cpp v1.9.5의 커밋 d1be6fde11ac6e0407606b4e42fe72d34add8037을 검사합니다. whisper-cli를 정적 GGML, 내장 Metal 셰이더로 빌드하고 CPU 전용 실행도 허용합니다. 두 외부 실행 파일의 소스 접미사는 aarch64-apple-darwin이며 Tauri가 앱의 Contents/MacOS에 접미사 없이 복사합니다. 디코더는 macOS 시스템 프레임워크만 링크합니다.

```sh
scripts/package.sh
(cd release && shasum -a 256 -c SHA256SUMS)
hdiutil verify release/Mewno-0.1.3-macOS-arm64.dmg
codesign --verify --deep --strict src-tauri/target/release/bundle/macos/Mewno.app
```

기본 서명은 ad-hoc입니다. MEWNO_SIGN_IDENTITY에 사용할 Developer ID를 명시할 수 있습니다. 공증과 stapling은 별도 릴리스 작업입니다. 프로젝트의 최소 버전 설정은 macOS 14이며 실제 시험 OS는 시험 보고서를 따릅니다.

검증 Mac의 SDK에는 CarbonCore/Folders.h가 없었습니다. 이번 빌드는 개발용 .build/sdk-include에 공개 Apple SDK 보관본의 해당 헤더를 두고 CFLAGS와 CXXFLAGS의 include 경로를 지정했습니다. CMake의 기존 캐시에도 같은 C/C++/Objective-C 플래그를 사용했습니다. 이 헤더는 설치본에 포함하지 않습니다. 정상 SDK에서는 추가 경로가 필요 없습니다.

## 시험

```sh
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --locked --release --manifest-path src-tauri/Cargo.toml
```

실음성 시험은 별도 실행합니다. 테스트 음원과 FFmpeg 경로를 지정해 파생 녹음을 만들고, src-tauri/models.json의 Base URL에서 받은 파일을 .build/ggml-base.bin에 둡니다. 시험이 크기와 해시를 검사합니다. 디스크에 약 250 MB 이상의 추가 작업 공간이 필요합니다.

```sh
python3 scripts/test-audio.py /path/to/ffmpeg
cargo test --locked --release --manifest-path src-tauri/Cargo.toml real_recordings -- --ignored --nocapture
```

기본 시험은 로컬 패키지의 sidecar를 사용합니다. 설치본 시험은 MEWNO_TEST_BIN=/Applications/Mewno.app/Contents/MacOS로 지정합니다. 네트워크 차단 시험은 컴파일된 Rust 시험 바이너리를 다음 macOS Seatbelt 프로파일 안에서 실행했습니다.

```text
(version 1) (allow default) (deny network-outbound (remote ip "*:*"))
```

## GitHub Releases

[릴리스 페이지](https://github.com/makerjy/mewno/releases)에서 macOS 설치 이미지와 SHA-256 체크섬을 받을 수 있습니다. v0.1.3에는 Apple Silicon Mac에서 빌드하고 실행을 확인한 프리뷰를 배포했습니다.

GitHub Actions는 Apple Silicon macOS 러너에서 패키징과 Rust 테스트를 수행하고 설치 이미지와 체크섬을 아티팩트로 보관합니다. 새 버전의 태그에서 워크플로를 수동 실행하면 빌드 성공 후 검토용 릴리스 초안을 만듭니다.
