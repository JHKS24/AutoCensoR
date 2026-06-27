# AutoCensor vNext 사용 설명서

## 1. 설치

프론트엔드:

```bash
npm install
```

CPU 백엔드:

```bash
python -m pip install --upgrade pip setuptools wheel
python -m pip install -r requirements-server-cpu.txt
```

CUDA 12.8 백엔드:

```bash
python -m pip install --upgrade pip setuptools wheel
python -m pip install --force-reinstall -r requirements-server-gpu-cu128.txt
```

CUDA 모드는 CUDA 지원 Torch 휠이 필요합니다. 진단 정보에 CPU 전용 Torch가
표시되면 깨끗한 환경에 CUDA requirements를 다시 설치하세요.

## 2. 모델 추가

호환 가능한 신뢰 Ultralytics segmentation 모델을 다음 위치에 둡니다.

```text
models/autocensor_model.pt
```

설정 > 모델에서 신뢰할 수 있는 로컬 모델 경로를 입력할 수도 있습니다. 모델
파일은 저장소에 포함되지 않으며 일반 실행 중 다운로드되지 않습니다.

## 3. 실행

```bash
npm run build
python backend/autocensor_server.py --host 127.0.0.1 --port 8765 --static-dir dist
```

`http://127.0.0.1:8765`를 엽니다.

개발 중에는 백엔드와 `npm run dev`를 함께 실행합니다. UI 전용 mock 모드는
`npm run dev:mock`을 사용합니다.

## 4. 기본 작업 흐름

1. 상단 바에서 입력 폴더를 입력하고 스캔합니다.
2. 모델 상태 또는 설정 > 모델에서 호환 모델을 로드합니다.
3. 가속 장치를 자동, CPU 전용, GPU 가속(CUDA), 하이브리드 중에서 선택합니다.
4. 저장, 검열, 성능, UI, 단축키, 개인정보 설정을 조정합니다.
5. 폴더 전체는 일괄 처리 시작, 선택한 이미지는 현재 이미지만 검열을 사용합니다.
6. 이미지 목록 상태인 대기 중, 검열됨, 정상, 실패를 확인합니다.
7. 수동 보정은 브러시 검열, 복구/지우개, 영역 감지, 스탬프 도구, 퀵마스크,
   실행 취소, 다시 실행, 편집 저장을 사용합니다.

일괄 처리 결과는 다음 경로 규칙으로 저장됩니다.

```text
<출력>/<입력폴더명><접미사>/<상대 이미지 경로>
```

기본 접미사는 `_censored`입니다. 서버 일괄 처리 모드는 정상 이미지도 기본으로
출력하며, CLI 사용자는 `--skip-clean`으로 정상 이미지 출력을 건너뛸 수 있습니다.

## 5. SFW 프라이버시 보호 모드

SFW 프라이버시 보호 모드는 화면 공유, 공개 작업 공간 등 민감한 콘텐츠가 UI에
보이면 안 되는 상황을 위한 표시 보호 기능입니다. 켜져 있을 때 UI는 원본 픽셀,
썸네일, 파일명, 파일명 툴팁, 원본 미리보기, 민감 대상 라벨/클래스/개수, 감지
영역 라벨, 상태바의 현재 파일 텍스트, 모델 진단 라벨 목록을 숨기고 보호된
이미지, 보호된 파일, 보호 대상 범주 같은 중립 표현을 사용해야 합니다.

SFW 모드는 화면 표시만 바꿉니다. 로컬 파일을 업로드, 익명화, 삭제하지 않습니다.

## 6. 수동 편집과 확대/이동

- 캔버스 위 마우스 휠로 확대/축소합니다.
- Home은 확대 초기화, PageUp은 확대, PageDown은 축소입니다.
- 확대 상태에서 Space를 누른 채 드래그하면 화면을 이동합니다.
- `[`와 `]`로 브러시 크기를 조정합니다.
- 옵션이 켜져 있으면 Shift를 누르고 그릴 때 직선 스트로크를 만듭니다.
- 타블릿 필압이 켜져 있고 장치가 PointerEvent pressure 값을 제공하면 브러시
  폭이 필압에 따라 바뀝니다.
- 복구/지우개는 가능한 경우 원본/현재 백업에서 복구합니다.
- 스탬프 도구는 사용자 지정 텍스트/기호, 색상, 회전을 지원합니다.

## 7. 단축키 표

단축키는 설정 > 단축키에서 수정할 수 있습니다. 기본 단축키로 복원은 기본값을
되돌립니다. 충돌 표시는 두 동작이 같은 정규화 단축키를 공유한다는 뜻이므로,
해당 키를 사용하기 전에 충돌을 해소하세요.

| 동작 | 기본값 |
| --- | --- |
| 이전 이미지 | `ArrowLeft` |
| 다음 이미지 | `ArrowRight` |
| 현재 이미지 초기화 | `W` |
| 수동 편집 실행 취소 | `Ctrl+Z` |
| 수동 편집 다시 실행 | `Ctrl+Y` |
| 대체 다시 실행 | `Ctrl+Shift+Z` |
| 취소 / 임시 UI 닫기 | `Escape` |
| 원본 미리보기 | `Tab` |
| 브러시 검열 | `B` |
| 복구/지우개 | `X` |
| 영역 감지 | `D` |
| 스탬프 도구 | `E` |
| 스탬프 시계 방향 회전 | `R` |
| 스탬프 반시계 방향 회전 | `Shift+R` |
| 퀵마스크 | `A` |
| 브러시 크기 줄이기 | `[` |
| 브러시 크기 늘리기 | `]` |
| 확대 초기화 | `Home` |
| 확대 | `PageUp` |
| 축소 | `PageDown` |
| 캔버스 이동 | `Space` + 드래그 |
| 휠 확대/축소 | 마우스 휠 |
| 일괄 처리 시작 | `F5` |
| 현재 이미지만 검열 | `F9` |
| 타블릿 필압 토글 | `1` |
| 브러시 경도 토글 | `2` |
| 확장 단축키 토글 | `3` |
| 직선 그리기 토글 | `4` |
| 퀵마스크 오버레이 토글 | `5` |

## 8. 서버와 CLI

서버는 localhost 또는 사용자 인증/리버스 프록시 뒤에서만 사용하세요. 백엔드는
서버 프로세스가 접근 가능한 이미지 경로를 읽을 수 있습니다. 원격 서버에서 출력
폴더 동작은 브라우저 사용자의 컴퓨터가 아니라 서버 컴퓨터를 기준으로 합니다.

CLI 예시:

```bash
python backend/autocensor_cli.py --input <image-or-folder> --output <output-folder> --model models/autocensor_model.pt --device cpu --dry-run
```

실제 처리는 `--dry-run`을 제거하고 `--mode`, `--fill-color`,
`--output-format`, `--quality`, `--skip-clean`, `--preserve-exif` 같은 옵션을
선택합니다.

## 9. 개인정보와 글꼴

- EXIF 보존은 기본으로 꺼져 있습니다. 켜면 개인 메타데이터가 보존될 수 있습니다.
- 글꼴은 번들하지 않습니다. UI는 한국어 표시가 가능한 운영체제 글꼴 fallback을
  사용합니다.
- 한국어 문서와 UI 텍스트는 반드시 UTF-8로 저장해야 합니다.
- 비공개 모델 파일, 비공개 경로, 시크릿, 계정 식별자, 이메일, 개인 샘플명을
  공개하지 마세요.

## 10. 라이선스

MIT License. Copyright (c) 2026 AutoCensor Contributors.
