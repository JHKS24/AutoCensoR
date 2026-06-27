# AutoCensor vNext

AutoCensor vNext is a local web/server image-censoring application. The browser
UI talks to a Python backend on your own computer or server, and the backend uses
a compatible trusted Ultralytics segmentation model supplied by the user.

No model weights are bundled. There is no auxiliary LLM, no telemetry, no remote
API upload, no account login, and no normal-operation model download. The user
manually installs dependencies and manually places model files.

If the project helps you, please star the GitHub repository or credit the
project under the MIT License terms.

## Quick Start

```bash
npm install
npm run build
python -m pip install -r requirements-server-cpu.txt
python backend/autocensor_server.py --host 127.0.0.1 --port 8765 --static-dir dist
```

Open `http://127.0.0.1:8765`.

For CUDA 12.8:

```bash
python -m pip install --force-reinstall -r requirements-server-gpu-cu128.txt
```

Place a compatible trusted model at `models/autocensor_model.pt`, or enter a
trusted local path in Settings > Model. The app does not download a model for
you.

## Main Feature Names

- Top bar: Input Folder, Output Folder, Model State, Device, Load Model, Unload,
  Start Batch, Stop Batch, Censor Current, Settings, SFW Privacy Mode.
- Image list: Images, search, All/Censored/Clean/Pending/Failed filters,
  thumbnail zoom, status legend.
- Canvas/editor: Brush, Restore Eraser, Detect Region, Stamp Tool, Quick Mask,
  Undo, Redo, Reset Image, Reset All, Save Edit, zoom controls, Space+drag pan.
- Settings tabs: Save, Censor, Performance, Model, UI, Shortcuts, Privacy.
- Privacy: SFW Privacy Mode, Hide filenames, Completion Notification, EXIF
  preservation warning.

## Runtime Notes

- Auto mode uses CUDA only when the active Python environment has CUDA-capable
  Torch; otherwise it uses CPU.
- CUDA-only mode fails clearly when CUDA is unavailable.
- Hybrid mode uses CUDA+CPU pools when CUDA is available and reports truthful
  fallback behavior otherwise.
- `postprocess_workers` is not GPU or independent postprocess concurrency in
  this release. Postprocess is CPU/OpenCV in-process per image.
- `batch_size` is queue chunking, not multi-image model inference.
- `save_threads` copies extra output directories concurrently; primary saving is
  synchronous.

More detail is in [USER_GUIDE.md](USER_GUIDE.md) and
[../docs/SERVER_BACKEND.md](../docs/SERVER_BACKEND.md).
