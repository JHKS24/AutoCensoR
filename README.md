# AutoCensor vNext

AutoCensor vNext is a local image-censoring web application with a Python
backend. It is designed for users who want folder scanning, automatic censoring,
manual correction, and server/headless operation without sending images or
metadata to a remote service.

There is no auxiliary LLM, no remote LLM/API integration, no telemetry, no
remote upload, no account login, and no model download in normal operation.
The user manually installs Python/Node dependencies and manually places any
compatible model files.

If this project is useful, please star the GitHub repository or credit the
project under the MIT License terms.

## Prebuilt Windows Packages

- [CPU-only package](https://github.com/JHKS24/AutoCensoR-CPU-Only/releases/tag/v0.1.0)
- [Full runtime package](https://github.com/JHKS24/AutoCensoR-Full/releases/tag/v0.1.0)

Model weights are not included in either package.

## Features

- React + TypeScript + Vite browser UI with Korean and English labels.
- Python localhost backend for folder scan, model load/unload, batch processing,
  single-current-image processing, model diagnostics, region detection, and
  manual edit saving.
- Automatic censor modes: solid color, black/white fill, mosaic, Gaussian blur,
  opacity, edge blur, high-quality supersampling on/off, and postprocess
  on/off.
- Output format controls for original extension, JPEG, PNG, WebP, and BMP, with
  JPEG/WebP quality.
- Privacy-first EXIF handling: EXIF preservation is off by default.
- Manual editor tools: brush, restore/eraser, stamp text/symbol, stamp color,
  stamp rotation, quick mask overlay, region-detect drag selection, undo, redo,
  Shift straight-line drawing, tablet-pressure-aware brush size, brush hardness,
  high-zoom editing, wheel/shortcut zoom, and Space+drag pan.
- Editable shortcuts with reset-to-default and conflict display.
- SFW privacy mode intended to hide raw pixels, thumbnails, filenames/tooltips,
  original preview, sensitive target labels/classes/counts, detected labels,
  status text, and diagnostic label lists behind neutral wording.
- CPU, CUDA, Auto, and Hybrid device modes with diagnostics.
- Headless CLI for independent-computer and server workflows.
- MIT license, public source release, and no bundled private model weights.

## Install

Frontend:

```bash
npm install
```

CPU backend runtime:

```bash
python -m pip install --upgrade pip setuptools wheel
python -m pip install -r requirements-server-cpu.txt
```

CUDA 12.8 backend runtime:

```bash
python -m pip install --upgrade pip setuptools wheel
python -m pip install --force-reinstall -r requirements-server-gpu-cu128.txt
```

Use the CUDA requirements in a clean virtual environment when possible. CUDA mode
requires a CUDA-enabled Torch wheel; if diagnostics show a CPU-only Torch build,
reinstall the CUDA runtime.

## Model Placement

Put a compatible trusted Ultralytics segmentation model at:

```text
models/autocensor_model.pt
```

You may also enter a trusted local model path in Settings. Model weights are not
bundled, are not downloaded by normal app operation, and must not be committed if
they are private, unlicensed, or derived from non-public data.

## Run As A Desktop App

This is the normal way to use AutoCensor on a workstation. Build the UI once,
install the optional desktop extra, then launch a native application window:

```bash
npm run build
python -m pip install -r requirements-desktop.txt
npm run desktop
```

`npm run desktop` starts the local backend on a free `127.0.0.1` port and opens
it in an OS-native WebView window (Edge WebView2 on Windows, WebKit on
macOS/Linux) — there is no browser tab and nothing is exposed on the network.
The window and the backend share one private origin, and saved settings,
shortcuts, and theme persist between launches. Closing the window stops the
backend.

The application icon is built from `public/app-icon-master.png`. Regenerate
`public/app-icon.png` and `public/app-icon.ico` after changing the artwork with:

```bash
npm run icon
```

## Run As A Local Server

For headless workstations, shared machines, or a separate server, build the
frontend and serve it through the Python backend directly, then open it in a
browser:

```bash
npm run build
python backend/autocensor_server.py --host 127.0.0.1 --port 8765 --static-dir dist
```

Open:

```text
http://127.0.0.1:8765
```

For development with Vite:

```bash
python backend/autocensor_server.py --host 127.0.0.1 --port 8765 --static-dir dist
npm run dev
```

For UI-only mock mode:

```bash
npm run dev:mock
```

## Server Safety

The backend defaults to `127.0.0.1`. The API can read image paths available to
the server process, so do not expose it directly to the public internet. For a
separate workstation or server, bind only to a private interface or put it behind
your own authentication and reverse proxy. Any output-folder open/copy action
refers to the server machine, not the browser user's computer.

Detailed server and CLI notes are in [docs/SERVER_BACKEND.md](docs/SERVER_BACKEND.md).

## CLI

The headless runner can be used without the browser UI:

```bash
python backend/autocensor_cli.py --input <image-or-folder> --output <output-folder> --model models/autocensor_model.pt --device cpu --target-mode selected --targets face,license_plate --json
```

Useful options include `--dry-run`, `--skip-clean`, `--target-mode`, `--targets`,
`--threshold`, `--mode`, `--fill-color`, `--output-format`, `--quality`,
`--preserve-exif`, `--cpu-threads`, and `--no-recursive`. Use
`--target-mode all` only when every model label should be censored.

## Output Convention

Batch output follows:

```text
<output>/<input-folder-name><suffix>/<relative-image-path>
```

The default suffix is `_censored`. Clean images are written by default in server
batch mode; the CLI can skip clean outputs with `--skip-clean`. Preserving EXIF
or copying clean originals can preserve private metadata, so review those options
before public sharing.

## Shortcut Defaults

| Action | Default |
| --- | --- |
| Previous / next image | `ArrowLeft` / `ArrowRight` |
| Reset current image | `W` |
| Undo / redo / alternate redo | `Ctrl+Z` / `Ctrl+Y` / `Ctrl+Shift+Z` |
| Cancel or close transient UI | `Escape` |
| Original preview | `Tab` |
| Restore/eraser | `X` |
| Quick mask | `A` |
| Brush size down/up | `[` / `]` |
| Stamp tool and rotate | `E`, `R`, `Shift+R` |
| Zoom reset/in/out | `Home`, `PageUp`, `PageDown` |
| Pan while zoomed | `Space` + drag |
| Wheel zoom | Mouse wheel over canvas |
| Start batch / censor current only | `F5` / `F9` |
| PS toggles | `1` tablet pressure, `2` brush hardness, `3` extended shortcuts, `4` straight-line drawing, `5` quickmask overlay |

Shortcuts are editable in Settings > Shortcuts. The desktop/server backend
persists user settings as UTF-8 JSON, while browser local storage is used as a
fallback and hydration cache. The UI shows conflicts and can reset to defaults.

Full shortcut documentation is in [docs/SHORTCUTS.md](docs/SHORTCUTS.md).

## Worker Truthfulness

Backend diagnostics distinguish requested, normalized, and applied worker
settings.

- `gpu_workers` applies to CUDA model-pool entries only when CUDA is active.
- `cpu_workers` applies to CPU model-pool entries when CPU is active.
- `cpu_threads` is applied to Torch, OpenCV, and common BLAS settings where the
  libraries support it.
- `save_threads` controls concurrent copies into additional output directories;
  primary image saving is synchronous.
- `postprocess_workers` can raise the active image worker pool size when
  postprocess is enabled. Model inference remains per image.
- `batch_size` controls backend queue chunking. Model inference remains per
  image.
- Stop/cancel is cooperative between queued images. It prevents additional
  queued images from starting after the stop flag is set; it does not claim to
  interrupt an individual CUDA or CPU model inference call already running.

## Font And Encoding Policy

No fonts are bundled. The UI uses OS fonts with Korean-capable fallbacks, and
documentation/source text containing Korean must be saved as UTF-8.

## Checks

```bash
npm run build
npm run lint
python backend/autocensor_server.py --self-test
python backend/autocensor_cli.py --help
```

For real processing checks, use your own trusted compatible model and a clean
test image set. Do not commit model weights, private images, generated outputs,
or local settings.

## Dependency Licenses

This repository is MIT-licensed source code. Runtime dependencies are installed
from their own packages and keep their own licenses. In particular, the optional
Ultralytics backend dependency is distributed under AGPL-3.0 at the time this
release package was prepared; review that dependency license before
redistributing a bundled runtime, hosted service, installer, or container image.

## License

MIT License.

Copyright (c) 2026 AutoCensor Contributors.
