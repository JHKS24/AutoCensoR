# AutoCensor vNext Server Backend

The browser UI uses `backend/autocensor_server.py` for real folder scanning,
model loading, batch processing, current-image processing, region detection,
diagnostics, and manual edit saving. The backend serves `/api/*` endpoints and,
when requested, the built frontend from `dist/`.

There is no auxiliary LLM, telemetry, cloud upload, remote AI API, account login,
or normal-operation model download. Users manually install dependencies and
manually place compatible model files.

## Independent Computer Setup

1. Install Node.js and Python on the target machine.
2. Install frontend dependencies:

```bash
npm install
```

3. Install one backend runtime.

CPU runtime:

```bash
python -m pip install --upgrade pip setuptools wheel
python -m pip install -r requirements-server-cpu.txt
```

CUDA 12.8 runtime:

```bash
python -m pip install --upgrade pip setuptools wheel
python -m pip install --force-reinstall -r requirements-server-gpu-cu128.txt
```

CUDA mode requires a CUDA-enabled Torch wheel. If diagnostics show a CPU-only
Torch build, reinstall the CUDA runtime in a clean environment.

4. Place a compatible trusted model at `models/autocensor_model.pt` or provide a
trusted local model path in Settings > Model.

5. Build and run:

```bash
npm run build
python backend/autocensor_server.py --host 127.0.0.1 --port 8765 --static-dir dist
```

Open `http://127.0.0.1:8765`.

If the frontend is served from a different origin, point it at the backend when
building and allow that origin on the backend:

```bash
VITE_AC_BACKEND_URL=http://127.0.0.1:8765 npm run build
AC_ALLOWED_ORIGINS=http://127.0.0.1:5173 python backend/autocensor_server.py --host 127.0.0.1 --port 8765 --static-dir dist
```

Use a comma-separated `AC_ALLOWED_ORIGINS` list for multiple trusted local or
private frontend origins. API requests also validate the HTTP `Host` header.
By default only loopback hosts such as `127.0.0.1`, `localhost`, `::1`, and the
server bind host are accepted; add trusted reverse-proxy hostnames with
`AC_ALLOWED_HOSTS`. Do not use a public wildcard on an exposed backend. DNS
rebinding style Host/Origin requests are rejected unless explicitly allowlisted.

## Server Safety

The default bind host is `127.0.0.1`. The API can read image paths that the
server process can access, so do not expose it directly to the public internet.
For remote use, bind only to a private interface or place the backend behind
your own authentication and reverse proxy.

Output-folder open/copy behavior is local to the server. If the browser is on a
different computer, an output action refers to the server machine, not the
browser user's machine. Do not add public endpoints that open arbitrary file
paths.

## Model Policy

- No model weights are bundled.
- No model file is downloaded during normal app operation.
- Users must manually provide compatible trusted Ultralytics segmentation `.pt`
  files.
- Do not publish private, unlicensed, personal, or non-public model files.
- Public docs and reports should refer to neutral paths such as
  `models/autocensor_model.pt`.

## Connected Backend Features

- Recursive folder scanning for supported image types.
- Model load/unload and diagnostics.
- Batch processing through the same Python censor path used by current-image
  processing.
- Single-current-image processing through `/api/batch/start` with one selected
  image ID.
- CPU, CUDA, Auto, and Hybrid device modes.
- Region detection using loaded model masks when available, with local fallback
  behavior.
- Manual edit saving from the browser canvas.
- Output formats: original extension, JPEG, PNG, WebP, and BMP.
- JPEG/WebP quality control.
- EXIF preservation option, off by default.
- Clean-image output in server batch mode.
- CLI `--skip-clean` and `--dry-run` workflows.

## Output Convention

Server batch output follows:

```text
<output>/<input-folder-name><suffix>/<relative-image-path>
```

The default suffix is `_censored`. Manual edit saving uses the configured output
format and suffix for the edit path. The CLI writes to the selected output
directory and can skip clean files with `--skip-clean`.

## Device Modes

- Auto: chooses CUDA only when CUDA-enabled Torch is available; otherwise CPU.
- CPU Only: uses CPU model pool entries.
- GPU Acceleration (CUDA): requires CUDA and fails clearly if unavailable.
- Hybrid: uses CUDA+CPU pools when CUDA is available and reports truthful
  fallback behavior when not.

## Worker Settings

Diagnostics report requested, normalized, and applied worker settings.

- `gpu_workers`: CUDA model-pool entries when CUDA is active.
- `cpu_workers`: CPU model-pool entries when CPU is active.
- `cpu_threads`: applied to Torch, OpenCV, and common BLAS variables where
  supported.
- `save_threads`: concurrency for copying the primary output into additional
  output directories. Primary image save remains synchronous.
- `postprocess_workers`: can raise the active image worker pool size when
  postprocess is enabled. Model inference remains per image, and diagnostics
  report that truthfully.
- `batch_size`: backend queue chunking. Model inference remains per image.

## Diagnostics And Benchmarking

Model load performs warmup on loaded pools and diagnostics report active devices,
loaded pool counts, worker settings, postprocess implementation, warmup state,
and benchmark status. Before sample images or real batches exist, benchmark
status may truthfully report that sample images or recent timing data are
missing. After real batch processing, recent timing data can be reported.

## API Notes

- `GET /api/health` returns backend status.
- `POST /api/scan` scans an input folder.
- `POST /api/model/load` loads model pools according to device and worker
  settings.
- `POST /api/model/unload` unloads the active model.
- `POST /api/model/diagnose` reports model/runtime diagnostics.
- `POST /api/workers/optimize` returns host-specific worker recommendations.
- `POST /api/batch/start` starts full-folder or selected-image batch work.
- `POST /api/batch/stop` requests cancellation.
- `GET /api/batch/status` returns progress and batch context.
- `POST /api/region/detect` returns detected regions and mask data.
- `POST /api/manual/save` stores a composed manual edit.

## CLI

Dry-run check:

```bash
python backend/autocensor_cli.py --input <image-or-folder> --output <output-folder> --model models/autocensor_model.pt --device cpu --dry-run
```

CPU processing example:

```bash
python backend/autocensor_cli.py --input <image-or-folder> --output <output-folder> --model models/autocensor_model.pt --device cpu --mode mosaic --output-format original --json
```

Common options:

- `--target-mode`: `selected` or `all`. Use `all` only when every model label should be censored.
- `--targets`: comma-separated model labels used when `--target-mode=selected`.
  Empty CLI targets use the fixed NTD defaults. Use `--target-mode=all` only
  when every model label should be censored.
- `--threshold`: confidence threshold.
- `--mode`: `color`, `mosaic`, or `blur`.
- `--fill`: `black` or `white`.
- `--fill-color`: `#RRGGBB`, overriding `--fill`.
- `--opacity`: censor opacity.
- `--mosaic-block-size`, `--blur-radius`, `--supersample`,
  `--brush-hardness`.
- `--no-postprocess`, `--no-retina-masks`.
- `--output-format`: `original`, `jpeg`, `png`, `webp`, or `bmp`.
- `--quality`: JPEG/WebP quality.
- `--preserve-exif`: preserve metadata. This can leak private metadata.
- `--copy-clean-originals`: copy clean originals byte-for-byte when
  `--output-format=original`. This can preserve source metadata.
- `--cpu-threads`: apply CPU thread limits where supported.
- `--no-recursive`: disable recursive directory scan.
- `--skip-clean`: do not write images with no matching detections.
- `--dry-run`: check inputs/model and list image count without loading ML
  runtime.
- `--json`: print a JSON summary.
