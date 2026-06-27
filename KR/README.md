# AutoCensor vNext

AutoCensor vNext는 로컬 웹/서버 이미지 검열 애플리케이션입니다. 브라우저 UI는
사용자 컴퓨터 또는 서버의 Python 백엔드와 통신하며, 백엔드는 사용자가 직접
제공한 호환 가능한 신뢰 Ultralytics segmentation 모델을 사용합니다.

모델 가중치는 포함하지 않습니다. 보조 LLM, 텔레메트리, 원격 API 업로드, 계정
로그인, 일반 실행 중 모델 다운로드도 없습니다. 사용자가 직접 의존성을 설치하고
모델 파일을 배치해야 합니다.

프로젝트가 도움이 되었다면 GitHub 저장소에 star를 남기거나 MIT License 조건에
따라 프로젝트를 표기해 주세요.

## 빠른 시작

```bash
npm install
npm run build
python -m pip install -r requirements-server-cpu.txt
python backend/autocensor_server.py --host 127.0.0.1 --port 8765 --static-dir dist
```

브라우저에서 `http://127.0.0.1:8765`를 엽니다.

CUDA 12.8 런타임:

```bash
python -m pip install --force-reinstall -r requirements-server-gpu-cu128.txt
```

호환 모델은 `models/autocensor_model.pt`에 두거나 설정 > 모델에서 신뢰할 수
있는 로컬 경로를 입력합니다. 앱은 모델을 자동 다운로드하지 않습니다.

## 주요 기능 이름

- 상단 바: 입력 폴더, 출력 폴더, 모델 상태, 가속 장치, 모델 로드, 언로드,
  일괄 처리 시작, 일괄 처리 중지, 현재 이미지만 검열, 설정, SFW 프라이버시
  보호 모드.
- 이미지 목록: 이미지 목록, 검색, 전체/검열됨/정상/대기 중/실패 필터,
  썸네일 크기, 범례.
- 캔버스/편집기: 브러시 검열, 복구/지우개, 영역 감지, 스탬프 도구,
  퀵마스크, 실행 취소, 다시 실행, 현재 이미지 초기화, 전체 초기화, 편집 저장,
  확대/축소, Space+드래그 이동.
- 설정 탭: 저장, 검열, 성능, 모델, UI, 단축키, 개인정보.
- 개인정보: SFW 프라이버시 보호 모드, 파일명 숨김, 처리 완료 알림,
  EXIF 메타데이터 보존 경고.

## 런타임 주의사항

- 자동 모드는 현재 Python 환경에 CUDA 지원 Torch가 있을 때만 CUDA를 사용하고,
  그렇지 않으면 CPU를 사용합니다.
- CUDA 전용 모드는 CUDA를 사용할 수 없으면 명확한 오류를 냅니다.
- 하이브리드 모드는 CUDA 가능 시 CUDA+CPU 풀을 사용하며, 불가능한 경우의
  동작을 진단 정보에 사실대로 표시합니다.
- `postprocess_workers`는 이 릴리스에서 GPU 또는 독립 후처리 동시성이 아닙니다.
  후처리는 CPU/OpenCV로 이미지별 인프로세스 실행됩니다.
- `batch_size`는 큐 청크 크기이며, 다중 이미지 모델 추론이 아닙니다.
- `save_threads`는 추가 출력 폴더 복사 동시성입니다. 기본 출력 저장은
  동기적으로 수행됩니다.

자세한 사용법은 [USER_GUIDE.md](USER_GUIDE.md)와
[../docs/SERVER_BACKEND.md](../docs/SERVER_BACKEND.md)를 참고하세요.
