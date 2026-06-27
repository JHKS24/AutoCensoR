# AutoCensor vNext User Guide

## 1. Install

Frontend:

```bash
npm install
```

CPU backend:

```bash
python -m pip install --upgrade pip setuptools wheel
python -m pip install -r requirements-server-cpu.txt
```

CUDA 12.8 backend:

```bash
python -m pip install --upgrade pip setuptools wheel
python -m pip install --force-reinstall -r requirements-server-gpu-cu128.txt
```

CUDA mode needs a CUDA-enabled Torch wheel. If diagnostics show a CPU-only Torch
build, reinstall the CUDA requirements in a clean environment.

## 2. Add A Model

Put a compatible trusted Ultralytics segmentation model at:

```text
models/autocensor_model.pt
```

You can also enter a trusted local model path in Settings > Model. Model files
are not bundled and are not downloaded during normal operation.

## 3. Run

```bash
npm run build
python backend/autocensor_server.py --host 127.0.0.1 --port 8765 --static-dir dist
```

Open `http://127.0.0.1:8765`.

For development, run the backend and `npm run dev`. For UI-only mock mode, use
`npm run dev:mock`.

## 4. Basic Workflow

1. In the top bar, enter an Input Folder and scan it.
2. Load a compatible model from Model State or Settings > Model.
3. Choose Device: Auto, CPU Only, GPU Acceleration (CUDA), or Hybrid.
4. Configure Save, Censor, Performance, UI, Shortcuts, and Privacy settings.
5. Use Start Batch for the folder or Censor Current for the selected image.
6. Review the image list status: Pending, Censored, Clean, or Failed.
7. Use Brush, Restore Eraser, Detect Region, Stamp Tool, Quick Mask, Undo, Redo,
   and Save Edit for manual cleanup.

Batch output is written as:

```text
<output>/<input-folder-name><suffix>/<relative-image-path>
```

The default suffix is `_censored`. Server batch mode writes clean outputs by
default; CLI users can use `--skip-clean`.

## 5. SFW Privacy Mode

SFW Privacy Mode is for screen sharing, public workspaces, and other situations
where sensitive content should not be visible in the UI. When enabled, the UI is
expected to hide raw image pixels, thumbnails, filenames, filename tooltips,
original preview, sensitive target labels/classes/counts, detected region labels,
status current-file text, and model diagnostic label lists. It uses neutral
wording such as Protected image, Protected file, and Protected categories.

SFW mode changes display privacy only. It does not upload, anonymize, or delete
your local files.

## 6. Manual Editing And Zoom

- Mouse wheel over the canvas zooms the editor.
- Home resets zoom; PageUp zooms in; PageDown zooms out.
- Hold Space and drag to pan while zoomed.
- Use `[` and `]` to change brush size.
- Use Shift while drawing to make straight-line strokes when the option is on.
- Tablet pressure changes brush width when Tablet Pressure is on and the device
  provides PointerEvent pressure values.
- Restore Eraser restores from the original/current backup where available.
- Stamp Tool supports custom text/symbol, color, and rotation.

## 7. Shortcut Table

Shortcuts are editable in Settings > Shortcuts. Reset to Default Shortcuts
restores the defaults. Conflict warnings mean two actions share the same
normalized shortcut; resolve the conflict before relying on the key.

| Action | Default |
| --- | --- |
| Previous image | `ArrowLeft` |
| Next image | `ArrowRight` |
| Reset current image | `W` |
| Undo manual edits | `Ctrl+Z` |
| Redo manual edits | `Ctrl+Y` |
| Alternate redo | `Ctrl+Shift+Z` |
| Cancel / close transient UI | `Escape` |
| Original preview | `Tab` |
| Brush | `B` |
| Restore Eraser | `X` |
| Detect Region | `D` |
| Stamp Tool | `E` |
| Rotate Stamp Clockwise | `R` |
| Rotate Stamp Counterclockwise | `Shift+R` |
| Quick Mask | `A` |
| Brush Size Down | `[` |
| Brush Size Up | `]` |
| Reset zoom | `Home` |
| Zoom in | `PageUp` |
| Zoom out | `PageDown` |
| Pan canvas | `Space` + drag |
| Wheel zoom | Mouse wheel |
| Start Batch | `F5` |
| Censor Current | `F9` |
| Toggle tablet pressure | `1` |
| Toggle brush hardness | `2` |
| Toggle extended shortcuts | `3` |
| Toggle straight-line drawing | `4` |
| Toggle quickmask overlay | `5` |

## 8. Server And CLI

Use the server only on localhost or behind your own authentication and reverse
proxy. The backend can read image paths available to the server process. On a
remote server, output-folder actions refer to the server machine, not the browser
user's computer.

CLI example:

```bash
python backend/autocensor_cli.py --input <image-or-folder> --output <output-folder> --model models/autocensor_model.pt --device cpu --dry-run
```

For real processing, remove `--dry-run` and choose options such as `--mode`,
`--fill-color`, `--output-format`, `--quality`, `--skip-clean`, and
`--preserve-exif`.

## 9. Privacy And Fonts

- EXIF preservation is off by default. Turning it on can preserve private
  metadata.
- No fonts are bundled. The UI uses OS fonts with Korean-capable fallbacks.
- Korean documentation and UI text must be saved as UTF-8.
- Do not publish private model files, private paths, secrets, account
  identifiers, emails, or personal sample names.

## 10. License

MIT License. Copyright (c) 2026 AutoCensor Contributors.
