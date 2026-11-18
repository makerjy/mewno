# 배포물의 구성과 라이선스

| 구성 | 출처 및 조건 |
|---|---|
| Mewno에서 작성한 코드 | MIT. LICENSE 참조 |
| 원본 UI와 브랜드 이미지 | Mewno의 Figma Make 디자인에서 가져옴. 브랜드 일러스트와 워드마크를 다른 프로젝트에 사용하려면 권리자에게 재사용 조건을 문의해야 한다. |
| whisper-cli 및 GGML | [whisper.cpp v1.9.5](https://github.com/ggml-org/whisper.cpp/tree/v1.9.5), MIT. 고정 커밋과 빌드 옵션은 scripts/engines.sh에 있다. |
| 모델 가중치 | [변환 모델](https://huggingface.co/ggerganov/whisper.cpp) 및 [OpenAI Whisper](https://github.com/openai/whisper). MIT, 앱 밖에서 사용자가 다운로드한다. |
| UI와 데스크톱 런타임 | React, React DOM과 TanStack Virtual은 MIT, Tauri는 MIT 또는 Apache-2.0. 버전은 package-lock.json과 src-tauri/Cargo.lock에 고정한다. SQLite는 public domain이다. |
| 서체 | DM Sans와 Noto Sans KR, SIL Open Font License 1.1. 원본 라이선스는 public/fonts에 있다. |
| 공개 한국어 테스트 음원 | HappyMidnight, CC BY-SA 4.0. tests/fixtures/README.md 참조. 앱에 포함하지 않는다. |

패키징할 때 scripts/notices.py가 잠긴 의존성의 버전·라이선스·고지를 수집한다. 앱의 Contents/Resources/notices에서 읽을 수 있다. macOS의 AVFoundation, Metal, Accelerate 및 시스템 curl을 사용한다. 개발용 테스트 파일 변환에는 FFmpeg를 쓸 수 있다. 설치본에는 FFmpeg가 들어가지 않는다.
