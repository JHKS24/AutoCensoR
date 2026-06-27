# SPDX-FileCopyrightText: 2026 AutoCensor Project Owner and contributors
# SPDX-License-Identifier: MIT

"""Local HTTP bridge for the AutoCensor vNext web UI.

The browser UI cannot load local Python/Torch models directly. This server keeps
the existing headless engine in Python and exposes a small localhost API for
folder scanning, model loading, batch processing, region detection, and manual
edit saving.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import filecmp
import gc
import hashlib
import io
import json
import mimetypes
import os
import platform
import queue
import shutil
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable
from urllib.parse import parse_qs, unquote, urlparse

import autocensor_cli


SERVER_VERSION = "0.1.0"
SUPPORTED_EXTS = autocensor_cli.SUPPORTED_EXTS
LEGACY_RESTORE_EXT_ORDER = (".jpg", ".jpeg", ".png", ".webp", ".bmp")
APP_CONFIG_DIR_NAME = "AutoCensor"
SETTINGS_SCHEMA_VERSION = 1
WORKER_FIELDS = ("gpu_workers", "cpu_workers", "cpu_threads", "save_threads", "postprocess_workers", "batch_size")
# Keep in sync with the frontend MAX_GPU_WORKERS cap in src/settings/SettingsContext.tsx.
# The release UI exposes the legacy 1-300 GPU worker range. Oversized values are
# rejected before model-pool allocation so a malformed request cannot allocate an
# unbounded number of model instances.
# Actual allocation still depends on CUDA memory; out-of-memory failures are
# reported by model loading instead of silently clamping the user's setting.
MAX_GPU_WORKERS = 300
# Admission limits prevent accidental browser/API payloads from forcing the
# server to materialize unbounded request bodies or image files in memory.
MAX_JSON_BODY_BYTES = 192 * 1024 * 1024
MAX_MANUAL_EDIT_BYTES = 144 * 1024 * 1024
MAX_SERVED_IMAGE_BYTES = 256 * 1024 * 1024
MAX_SCAN_IMAGES = 50000
CPU_THREAD_APPLY_REPORT: dict[str, Any] = {
    "requested": None,
    "applied": None,
    "libraries": {},
    "status": "not_applied",
}
DESKTOP_WINDOW_CONTROLLER: Callable[[str], dict[str, Any]] | None = None
DESKTOP_FILE_CONTROLLER: Callable[[str, dict[str, Any]], dict[str, Any]] | None = None


class RequestBodyTooLarge(ValueError):
    """Raised before reading a request body that exceeds the local API limit."""


class BadRequestBody(ValueError):
    """Raised for structurally invalid request framing before JSON parsing."""


def set_desktop_window_controller(controller: Callable[[str], dict[str, Any]] | None) -> None:
    """Register native window controls for the packaged desktop launcher only."""
    global DESKTOP_WINDOW_CONTROLLER
    DESKTOP_WINDOW_CONTROLLER = controller


def set_desktop_file_controller(controller: Callable[[str, dict[str, Any]], dict[str, Any]] | None) -> None:
    """Register native file/folder bridge operations for the packaged desktop launcher only."""
    global DESKTOP_FILE_CONTROLLER
    DESKTOP_FILE_CONTROLLER = controller


def _now_ms() -> int:
    return int(time.time() * 1000)


def _json_bytes(payload: Any) -> bytes:
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")


def _safe_storage_id(value: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in value.strip())
    return cleaned[:80] or "AutoCensor"


def _app_storage_id(root: Path) -> str:
    configured = os.environ.get("AUTOCENSOR_APP_STORAGE_ID", "")
    if configured.strip():
        return _safe_storage_id(configured)
    return _safe_storage_id(f"AutoCensor-{root.name}")


def _user_config_dir(root: Path) -> Path:
    if os.name == "nt":
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
    elif sys.platform == "darwin":
        base = str(Path.home() / "Library" / "Application Support")
    else:
        base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(base) / APP_CONFIG_DIR_NAME / _app_storage_id(root)


def _settings_path(root: Path) -> Path:
    return _user_config_dir(root) / "settings.json"


def _corrupt_settings_path(path: Path) -> Path:
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    base = path.with_name(f"{path.stem}.corrupt-{stamp}{path.suffix}")
    if not base.exists():
        return base
    for index in range(2, 100):
        candidate = path.with_name(f"{path.stem}.corrupt-{stamp}-{index}{path.suffix}")
        if not candidate.exists():
            return candidate
    return path.with_name(f"{path.stem}.corrupt-{stamp}-{int(time.time() * 1000)}{path.suffix}")


def _read_user_settings(root: Path) -> tuple[dict[str, Any], Path]:
    path = _settings_path(root)
    if not path.exists():
        return {}, path
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        quarantine = _corrupt_settings_path(path)
        try:
            shutil.move(str(path), str(quarantine))
        except OSError:
            pass
        return {}, path
    if isinstance(payload, dict) and isinstance(payload.get("settings"), dict):
        return dict(payload["settings"]), path
    if isinstance(payload, dict):
        return payload, path
    return {}, path


def _write_user_settings(root: Path, settings: dict[str, Any]) -> Path:
    path = _settings_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    document = {
        "schema_version": SETTINGS_SCHEMA_VERSION,
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "settings": settings,
    }
    temp_path = path.with_suffix(".json.tmp")
    temp_path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp_path.replace(path)
    return path


PUBLIC_PATH_KEYS = {
    "path",
    "result_path",
    "source_path",
    "output_path",
    "input_path",
    "input_root",
    "model_path",
}


def _redact_public_text(value: Any) -> Any:
    if value is None:
        return None
    if not isinstance(value, str):
        return value
    text = value
    state = globals().get("STATE")
    root = getattr(state, "root", None)
    if root:
        text = text.replace(str(root), "<PROJECT_ROOT>")
    lower_text = text.lower()
    if "\\" in text or ":/" in text or any(ext in lower_text for ext in (".pt", ".pth", ".onnx", ".engine")):
        return "<REDACTED_MESSAGE>"
    return text


def _public_api_value(value: Any, key: str = "") -> Any:
    key_lower = key.lower()
    if key_lower in PUBLIC_PATH_KEYS:
        return ""
    if key_lower in {"runtime", "torch"}:
        return {"redacted": True}
    if key_lower in {"error", "last_error", "message", "current_file"}:
        return _redact_public_text(value)
    if isinstance(value, dict):
        return {item_key: _public_api_value(item_value, str(item_key)) for item_key, item_value in value.items()}
    if isinstance(value, list):
        return [_public_api_value(item, key) for item in value]
    if isinstance(value, tuple):
        return [_public_api_value(item, key) for item in value]
    return _redact_public_text(value)


def _safe_id(path: Path) -> str:
    raw = str(path.resolve()).encode("utf-8", errors="ignore")
    return hashlib.sha256(raw).hexdigest()[:24]


def _resolve_path(value: str | None, base_dir: Path) -> Path:
    if not value:
        return base_dir
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        candidate = base_dir / candidate
    return candidate.resolve()


def _model_candidates(root: Path) -> list[Path]:
    candidates: list[Path] = []
    for models_dir in (root / "models", root / "backend" / "models"):
        if models_dir.exists():
            candidates.extend(sorted(models_dir.glob("*.pt"), key=lambda p: p.stat().st_mtime, reverse=True))
    return candidates


def _resolve_model_path(model_arg: str | None, root: Path) -> Path:
    if model_arg:
        raw = Path(model_arg).expanduser()
        if raw.is_absolute():
            return raw.resolve()
        for base in (root, root / "models", root / "backend", root / "backend" / "models"):
            candidate = (base / raw).resolve()
            if candidate.exists():
                return candidate
        return (root / raw).resolve()

    default_path = root / "models" / autocensor_cli.DEFAULT_MODEL_BASENAME
    if default_path.exists():
        return default_path.resolve()
    candidates = _model_candidates(root)
    if candidates:
        return candidates[0].resolve()
    return default_path.resolve()


def _format_bytes(value: int | None) -> str:
    if value is None:
        return "unknown"
    size = float(value)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


def _clamp_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except Exception:
        parsed = default
    return max(minimum, min(maximum, parsed))


def _clamp_quality(value: Any, default: int = 95) -> int:
    """Clamp a requested save quality to the encoder-valid 1-100 range."""
    return _clamp_int(value, default, 1, 100)


def _sanitize_output_suffix(value: Any, fallback: str) -> str:
    """Sanitize a user-provided output folder suffix.

    The suffix is concatenated onto the input folder name to form the output
    subfolder. Strip drive prefixes, path separators, reserved/control characters
    and directory-traversal sequences so a crafted suffix cannot escape the
    chosen output directory. Empty/unsafe values fall back to a safe default.
    Mirrors the frontend coerceOutputSuffix sanitizer.
    """
    raw = str(value or "").strip()
    # Strip a leading drive prefix such as "C:" or "d:".
    if len(raw) >= 2 and raw[1] == ":" and raw[0].isalpha():
        raw = raw[2:]
    # Drop path separators, reserved characters and control bytes outright.
    cleaned = "".join(
        ch for ch in raw if ch not in '<>:"/\\|?*' and ord(ch) >= 0x20
    )
    # Neutralize any directory-traversal sequences.
    while ".." in cleaned:
        cleaned = cleaned.replace("..", "")
    cleaned = cleaned.strip().strip(".").strip()
    return cleaned or fallback


def _target_mode(config: dict[str, Any]) -> str:
    return "all" if str(config.get("target_mode") or "selected").strip().lower() == "all" else "selected"


def _targets_for_config(config: dict[str, Any]) -> set[str] | None:
    if _target_mode(config) == "all":
        return None
    if "targets" not in config:
        return set(autocensor_cli.DEFAULT_NTD_TARGETS)
    targets = {str(item).strip() for item in config.get("targets") or [] if str(item).strip()}
    return targets


def _validate_targets_for_processing(config: dict[str, Any]) -> None:
    targets = _targets_for_config(config)
    if targets is not None and len(targets) == 0:
        raise RuntimeError("No detection targets are selected. Select at least one target or switch target_mode to all.")


def _worker_config(config: dict[str, Any]) -> dict[str, int]:
    raw = config.get("worker_config") or {}
    cores = os.cpu_count() or 2
    return {
        "gpu_workers": _clamp_int(raw.get("gpu_workers"), 1, 1, MAX_GPU_WORKERS),
        "cpu_workers": _clamp_int(raw.get("cpu_workers"), max(1, cores // 2), 1, max(1, cores)),
        "cpu_threads": _clamp_int(raw.get("cpu_threads"), max(1, cores // 2), 1, max(1, cores)),
        "save_threads": _clamp_int(raw.get("save_threads"), min(4, cores), 1, max(1, cores)),
        "postprocess_workers": _clamp_int(raw.get("postprocess_workers"), max(1, cores // 3), 1, max(1, cores)),
        "batch_size": _clamp_int(raw.get("batch_size"), 1, 1, 64),
    }


def _requested_worker_config(config: dict[str, Any]) -> dict[str, Any]:
    raw = config.get("worker_config") or {}
    applied_defaults = _worker_config(config)
    return {field: raw.get(field, applied_defaults[field]) for field in WORKER_FIELDS}


def _apply_cpu_threads(cpu_threads: int) -> dict[str, Any]:
    """Apply CPU thread settings to libraries that expose runtime controls."""
    global CPU_THREAD_APPLY_REPORT
    requested = max(1, int(cpu_threads))
    os.environ["OMP_NUM_THREADS"] = str(requested)
    os.environ["OPENBLAS_NUM_THREADS"] = str(requested)
    os.environ["MKL_NUM_THREADS"] = str(requested)
    report: dict[str, Any] = {
        "requested": requested,
        "applied": requested,
        "libraries": {
            "environment": {
                "OMP_NUM_THREADS": str(requested),
                "OPENBLAS_NUM_THREADS": str(requested),
                "MKL_NUM_THREADS": str(requested),
            }
        },
        "status": "applied_where_supported",
    }

    try:
        import torch

        before = int(torch.get_num_threads())
        torch.set_num_threads(requested)
        torch_report: dict[str, Any] = {
            "available": True,
            "before": before,
            "applied_num_threads": int(torch.get_num_threads()),
        }
        try:
            interop_before = int(torch.get_num_interop_threads())
            torch.set_num_interop_threads(max(1, min(requested, interop_before)))
            torch_report["before_interop_threads"] = interop_before
            torch_report["applied_interop_threads"] = int(torch.get_num_interop_threads())
        except Exception as exc:
            torch_report["interop_note"] = f"not changed: {exc}"
        report["libraries"]["torch"] = torch_report
    except Exception as exc:
        report["libraries"]["torch"] = {"available": False, "note": str(exc)}

    try:
        import cv2

        before_cv = int(cv2.getNumThreads()) if hasattr(cv2, "getNumThreads") else None
        if hasattr(cv2, "setNumThreads"):
            cv2.setNumThreads(requested)
        after_cv = int(cv2.getNumThreads()) if hasattr(cv2, "getNumThreads") else requested
        report["libraries"]["opencv"] = {
            "available": True,
            "before": before_cv,
            "applied_num_threads": after_cv,
        }
    except Exception as exc:
        report["libraries"]["opencv"] = {"available": False, "note": str(exc)}

    CPU_THREAD_APPLY_REPORT = report
    return report


def _runtime_settings_report(config: dict[str, Any], output_dir_count: int | None = None) -> dict[str, Any]:
    workers = _worker_config(config)
    devices = _devices_for_config(config)
    cuda_ready = _cuda_available()
    output_count = max(1, int(output_dir_count or len(config.get("output_dirs") or ["output"])))
    postprocess_enabled = bool(config.get("postprocess_enabled", True))
    applied = {
        "gpu_workers": workers["gpu_workers"] if "cuda" in devices and cuda_ready else 0,
        "cpu_workers": workers["cpu_workers"] if "cpu" in devices else 0,
        "cpu_threads": CPU_THREAD_APPLY_REPORT.get("applied") or workers["cpu_threads"],
        "save_threads": min(workers["save_threads"], max(0, output_count - 1)),
        "postprocess_workers": workers["postprocess_workers"] if postprocess_enabled else 0,
        "batch_size": workers["batch_size"],
    }
    return {
        "requested": _requested_worker_config(config),
        "normalized": workers,
        "applied": applied,
        "active_devices": devices,
        "cpu_thread_application": CPU_THREAD_APPLY_REPORT,
        "truthfulness": {
            "gpu_workers": "applies to CUDA model pool entries when CUDA is active",
            "cpu_workers": "applies to CPU model pool entries when CPU is active",
            "cpu_threads": "applied to Torch, OpenCV, and common BLAS environment variables where available",
            "save_threads": "applies only to concurrent copying into additional output directories; primary image save is synchronous",
            "postprocess_workers": "when postprocess is enabled, this can raise the active image worker pool size; model inference is still per image",
            "batch_size": "applies to backend queue chunking; model inference is still performed per image",
        },
        "postprocess": {
            "enabled": postprocess_enabled,
            "device": "cpu",
            "implementation": "OpenCV/NumPy mask refinement",
            "gpu_supported": False,
        },
    }


def _torch_info() -> dict[str, Any]:
    info: dict[str, Any] = {
        "available": False,
        "version": None,
        "cuda_version": None,
        "cuda_available": False,
        "cuda_device_count": 0,
        "cuda_devices": [],
    }
    try:
        import torch

        info["available"] = True
        info["version"] = getattr(torch, "__version__", None)
        info["cuda_version"] = getattr(getattr(torch, "version", None), "cuda", None)
        cuda_available = bool(torch.cuda.is_available())
        info["cuda_available"] = cuda_available
        if cuda_available:
            count = int(torch.cuda.device_count())
            info["cuda_device_count"] = count
            devices = []
            for idx in range(count):
                props = torch.cuda.get_device_properties(idx)
                devices.append(
                    {
                        "index": idx,
                        "name": f"cuda:{idx}",
                        "total_memory": _format_bytes(int(getattr(props, "total_memory", 0) or 0)),
                        "allocated": _format_bytes(int(torch.cuda.memory_allocated(idx))),
                        "reserved": _format_bytes(int(torch.cuda.memory_reserved(idx))),
                    }
                )
            info["cuda_devices"] = devices
    except Exception as exc:
        info["error"] = str(exc)
    return info


def _cuda_available() -> bool:
    return bool(_torch_info().get("cuda_available"))


def _requested_device_mode(config: dict[str, Any] | None) -> str:
    raw = str((config or {}).get("device_mode") or "auto").strip().lower()
    if raw in {"auto", "automatic", "default"}:
        return "auto"
    if raw in {"cuda", "gpu", "cuda:0"}:
        return "cuda"
    if raw in {"hybrid", "gpu+cpu", "cuda+cpu"}:
        return "hybrid"
    return "cpu"


def _cuda_unavailable_message() -> str:
    torch_info = _torch_info()
    return (
        "CUDA mode was requested, but this Python environment cannot use CUDA. "
        f"torch={torch_info.get('version') or 'not installed'}, "
        f"torch_cuda={torch_info.get('cuda_version') or 'none'}, "
        f"cuda_available={torch_info.get('cuda_available')}. "
        "Install the GPU requirements in a clean venv, or force-reinstall them with "
        "`python -m pip install --force-reinstall -r requirements-server-gpu-cu128.txt`."
    )


def _ensure_cuda_available_for_config(config: dict[str, Any]) -> None:
    if _requested_device_mode(config) == "cuda" and not _cuda_available():
        raise RuntimeError(_cuda_unavailable_message())


def _normalize_device_name(value: str | None) -> str:
    raw = str(value or "cpu").strip().lower()
    if raw in {"auto", "automatic", "default"}:
        return "cuda" if _cuda_available() else "cpu"
    if raw in {"cuda", "gpu", "cuda:0"}:
        return "cuda"
    if raw in {"hybrid", "gpu+cpu", "cuda+cpu"}:
        return "cuda" if _cuda_available() else "cpu"
    return "cpu"


def _devices_for_config(config: dict[str, Any]) -> list[str]:
    mode = _requested_device_mode(config)
    if mode == "auto":
        return ["cuda"] if _cuda_available() else ["cpu"]
    if mode == "hybrid":
        return ["cuda", "cpu"] if _cuda_available() else ["cpu"]
    if mode == "cuda":
        return ["cuda"]
    return ["cpu"]


def _pool_sizes_for_config(config: dict[str, Any]) -> dict[str, int]:
    workers = _worker_config(config)
    postprocess_workers = workers["postprocess_workers"] if bool(config.get("postprocess_enabled", True)) else 0
    sizes: dict[str, int] = {}
    for device in _devices_for_config(config):
        base_workers = workers["gpu_workers"] if device == "cuda" else workers["cpu_workers"]
        sizes[device] = max(base_workers, postprocess_workers)
    return sizes


def _device_from_config(config: dict[str, Any]) -> str:
    device = _devices_for_config(config)[0]
    return "cuda:0" if device == "cuda" else "cpu"


def _censor_args(config: dict[str, Any], device: str | None = None) -> SimpleNamespace:
    mode = str(config.get("censor_mode") or "mosaic").lower()
    if mode in {"solid", "blackwhite"}:
        cli_mode = "color"
    elif mode == "blur":
        cli_mode = "blur"
    else:
        cli_mode = "mosaic"

    fill_color = str(config.get("fill_color") or "#000000").lower()
    fill = "white" if mode == "blackwhite" or fill_color in {"#fff", "#ffffff", "white"} else "black"
    solid_fill_color = "#ffffff" if mode == "blackwhite" else fill_color
    output_format = str(config.get("output_format") or "original").lower()
    if output_format not in {"original", "jpeg", "png", "webp", "bmp"}:
        output_format = "original"
    preserve_exif = bool(config.get("preserve_exif", False))
    copy_clean_originals = bool(config.get("copy_clean_originals", output_format == "original"))

    return SimpleNamespace(
        threshold=float(config.get("threshold", 0.25)),
        device="cuda:0" if _normalize_device_name(device) == "cuda" else _device_from_config(config),
        imgsz=int(config.get("imgsz", 1280)),
        no_retina_masks=False,
        preserve_exif=preserve_exif,
        fill=fill,
        fill_color=solid_fill_color,
        blur_sigma=float(config.get("edge_blur", 0.0)),
        supersample=4 if bool(config.get("supersample", True)) else 1,
        no_postprocess=not bool(config.get("postprocess_enabled", True)),
        brush_hardness=float(config.get("brush_hardness", 1.0)),
        mode=cli_mode,
        mosaic_block_size=int(config.get("mosaic_block", 10)),
        blur_radius=float(config.get("blur_radius", 15)),
        opacity=float(config.get("opacity", 1.0)),
        output_format=output_format,
        quality=_clamp_quality(config.get("quality")),
        copy_clean_originals=copy_clean_originals,
        skip_clean=False,
    )


def _output_path(input_path: Path, input_root: Path, output_dir: Path, output_format: str, suffix: str) -> Path:
    rel = autocensor_cli.safe_relpath(input_path, input_root)
    ext = autocensor_cli.output_ext(input_path, output_format)
    suffix = "".join(ch for ch in str(suffix or "").strip() if ch not in '<>:"/\\|?*')
    folder_name = input_root.name or input_root.parent.name or "output"
    out = output_dir / f"{folder_name}{suffix}" / rel
    return out.with_suffix(ext)


def _find_existing_result_path(input_path: Path, input_root: Path, config: dict[str, Any]) -> Path | None:
    """Find a previously written output using the legacy GUI/server lookup contract."""
    return _first_existing_result_candidate(_existing_result_candidates(input_path, input_root, config), input_path)


def _first_existing_result_candidate(candidates: list[Path], input_path: Path) -> Path | None:
    for candidate in candidates:
        if _same_resolved_path(candidate, input_path):
            continue
        if candidate.exists() and candidate.is_file() and candidate.suffix.lower() in SUPPORTED_EXTS:
            return candidate
    return None


def _iter_images_bounded(input_path: Path, recursive: bool, limit: int) -> list[Path]:
    if input_path.is_file():
        return [input_path] if input_path.suffix.lower() in SUPPORTED_EXTS else []
    pattern = "**/*" if recursive else "*"
    images: list[Path] = []
    for path in input_path.glob(pattern):
        if not path.is_file() or path.suffix.lower() not in SUPPORTED_EXTS:
            continue
        images.append(path)
        if len(images) > limit:
            raise RuntimeError(
                f"Input folder contains more than {limit} supported images. "
                "Split the folder or add paging before processing."
            )
    return sorted(images)


def _same_resolved_path(left: Path, right: Path) -> bool:
    try:
        return left.resolve() == right.resolve()
    except OSError:
        return left.absolute() == right.absolute()


def _legacy_restore_extensions(input_path: Path) -> list[str]:
    extensions: list[str] = []
    for ext in (input_path.suffix.lower(), *LEGACY_RESTORE_EXT_ORDER):
        if ext and ext not in extensions:
            extensions.append(ext)
    return extensions


def _existing_result_candidates(input_path: Path, input_root: Path, config: dict[str, Any]) -> list[Path]:
    """Return previous-result candidates in legacy priority order.

    Legacy GUI restore checks the first configured output root, the suffixed
    input-folder layout, the original extension first, then a fixed fallback
    extension list. It does not use newest mtime or the current save format.
    """
    output_dirs = config.get("output_dirs") or ["output"]
    first_output_dir = _resolve_path(str(output_dirs[0]), STATE.root)
    suffix = _sanitize_output_suffix(config.get("output_suffix"), "_censored")
    rel = autocensor_cli.safe_relpath(input_path, input_root)
    folder_name = input_root.name or input_root.parent.name or "output"
    base = first_output_dir / f"{folder_name}{suffix}" / rel
    return [base.with_suffix(ext) for ext in _legacy_restore_extensions(input_path)]


def _existing_result_status(input_path: Path, result_path: Path) -> str:
    try:
        if input_path.stat().st_size == result_path.stat().st_size and filecmp.cmp(input_path, result_path, shallow=False):
            return "clean"
    except OSError:
        pass
    return "censored"


def _mark_restored_image(image: dict[str, Any], image_id: str, restored_result: Path) -> None:
    image["status"] = "censored"
    image["restored"] = True
    image["result_path"] = str(restored_result)
    image["thumbnail"] = f"/api/image?id={image_id}&result=1&v={_now_ms()}"


@dataclass
class ModelPool:
    device: str
    models: list[Any] = field(default_factory=list)
    requested: int = 0
    load_errors: list[str] = field(default_factory=list)
    loaded_at: float = field(default_factory=time.time)
    _available: queue.Queue[int] = field(default_factory=queue.Queue)

    def add(self, model: Any) -> None:
        index = len(self.models)
        self.models.append(model)
        self._available.put(index)

    def acquire(self, timeout: float = 300.0) -> tuple[int, Any]:
        index = self._available.get(timeout=timeout)
        return index, self.models[index]

    def release(self, index: int) -> None:
        self._available.put(index)

    def as_diagnostic(self) -> dict[str, Any]:
        return {
            "device": self.device,
            "requested": self.requested,
            "loaded": len(self.models),
            "available": self._available.qsize(),
            "load_errors": list(self.load_errors),
            "loaded_at": self.loaded_at,
        }


def _release_model_pools(pools: dict[str, ModelPool] | None) -> None:
    if not pools:
        return
    for pool in pools.values():
        pool.models.clear()
        while True:
            try:
                pool._available.get_nowait()
            except queue.Empty:
                break
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def _benchmark_report(state: Any) -> dict[str, Any]:
    recent = list(getattr(state, "recent_timings", [])[-10:])
    image_count = len(getattr(state, "images", []) or [])
    if recent:
        total = sum(float(item.get("duration_seconds") or 0.0) for item in recent)
        processed = max(1, len(recent))
        return {
            "status": "recent_batch_timing_available",
            "sample_count": processed,
            "average_seconds_per_image": round(total / processed, 4),
            "images_per_second": round(processed / max(0.001, total), 4),
            "source": "recent real batch processing",
        }
    if image_count <= 0:
        return {
            "status": "needs_sample_images",
            "reason": "Scan input images before benchmark timing can be measured.",
        }
    return {
        "status": "not_run",
        "reason": "Run a batch or current-image censor to collect real timing samples.",
        "available_sample_images": image_count,
    }


@dataclass
class ServerState:
    root: Path
    static_dir: Path | None = None
    model: Any = None
    model_path: Path | None = None
    model_loaded_at: float | None = None
    model_pools: dict[str, ModelPool] = field(default_factory=dict)
    active_config: dict[str, Any] = field(default_factory=dict)
    lock: threading.RLock = field(default_factory=threading.RLock)
    images: list[dict[str, Any]] = field(default_factory=list)
    images_by_id: dict[str, dict[str, Any]] = field(default_factory=dict)
    input_root: Path | None = None
    progress: dict[str, Any] = field(default_factory=dict)
    batch_thread: threading.Thread | None = None
    cancel_event: threading.Event = field(default_factory=threading.Event)
    run_started_at: float = 0.0
    run_finished: bool = False
    last_error: str | None = None
    last_batch_context: dict[str, Any] = field(default_factory=dict)
    recent_timings: list[dict[str, Any]] = field(default_factory=list)
    warmup_report: dict[str, Any] = field(default_factory=dict)

    def model_state(self) -> dict[str, Any]:
        with self.lock:
            loaded = self.model is not None
            workers = _worker_config(self.active_config)
            pools = {device: pool.as_diagnostic() for device, pool in self.model_pools.items()}
            effective_gpu_workers = int(pools.get("cuda", {}).get("loaded", workers["gpu_workers"]))
            effective_cpu_workers = int(pools.get("cpu", {}).get("loaded", workers["cpu_workers"]))
            active_devices = sorted(pools) if pools else _devices_for_config(self.active_config)
            torch_info = _torch_info()
            pool_summary = ", ".join(
                f"{device.upper()} {pool['loaded']}/{pool['requested']}" for device, pool in pools.items()
            )
            if not pool_summary:
                pool_summary = "Model loaded" if loaded else "Model not loaded"
            return {
                "loaded": loaded,
                "loading": False,
                "model_name": self.model_path.name if self.model_path else "not loaded",
                "devices": ["CPU"] + (["CUDA"] if torch_info.get("cuda_available") else ["CUDA unavailable"]),
                "cpu_workers": effective_cpu_workers,
                "gpu_workers": effective_gpu_workers,
                "memory_summary": pool_summary,
                "worker_summary": {
                    "active_devices": active_devices,
                    "pools": pools,
                    "torch": torch_info,
                    "workers": workers,
                    "workers_requested": _requested_worker_config(self.active_config),
                    "workers_applied": _runtime_settings_report(self.active_config)["applied"],
                    "runtime_settings": _runtime_settings_report(self.active_config),
                    "warmup": dict(self.warmup_report),
                    "benchmark": _benchmark_report(self),
                    "recent_timings": list(self.recent_timings[-10:]),
                },
                "error": self.last_error,
            }

    def status(self) -> dict[str, Any]:
        with self.lock:
            running = self.batch_thread is not None and self.batch_thread.is_alive()
            return {
                "running": running,
                "finished": self.run_finished and not running,
                "progress": dict(self.progress),
                "images": [dict(img) for img in self.images],
                "model_state": self.model_state(),
                "batch_context": dict(self.last_batch_context),
                "error": self.last_error,
            }


STATE: ServerState


def shutdown_runtime(timeout: float = 5.0) -> dict[str, Any]:
    state = globals().get("STATE")
    if state is None:
        return {"ok": True, "had_state": False}
    state.cancel_event.set()
    with state.lock:
        batch_thread = state.batch_thread
        old_pools = state.model_pools
        state.model = None
        state.model_path = None
        state.model_loaded_at = None
        state.model_pools = {}
        state.warmup_report = {}
        state.progress["message"] = "Application shutting down"
    joined = False
    if batch_thread is not None and batch_thread.is_alive():
        batch_thread.join(timeout=max(0.1, float(timeout)))
        joined = not batch_thread.is_alive()
    elif batch_thread is not None:
        joined = True
    _release_model_pools(old_pools)
    with state.lock:
        if batch_thread is not None and not batch_thread.is_alive():
            state.batch_thread = None
        state.run_finished = True
    return {
        "ok": batch_thread is None or joined,
        "had_state": True,
        "batch_thread_present": batch_thread is not None,
        "batch_thread_joined": joined,
        "model_pools_released": True,
    }


COMPLETED_BATCH_STATUSES = {"clean", "censored"}


def _split_batch_images(
    selected_images: list[dict[str, Any]],
    force_reprocess: bool,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if force_reprocess:
        return list(selected_images), []
    processable: list[dict[str, Any]] = []
    skipped_completed: list[dict[str, Any]] = []
    for image in selected_images:
        if str(image.get("status") or "").lower() in COMPLETED_BATCH_STATUSES:
            skipped_completed.append(image)
        else:
            processable.append(image)
    return processable, skipped_completed


def _apply_client_batch_state_overrides(
    selected_images: list[dict[str, Any]],
    client_statuses: Any,
) -> dict[str, Any]:
    """Honor explicit UI resets before the backend skip-completed split.

    The backend keeps authoritative image objects between runs. A UI reset is a
    deliberate user action, but older clients only sent image ids when starting
    a batch. Without this small status echo, reset images can still be skipped
    as backend-side "clean" or "censored" and stale output can look fresh.
    """
    if not isinstance(client_statuses, list):
        return {"received": 0, "pending_reset_count": 0, "pending_reset_image_ids": []}

    status_by_id: dict[str, str] = {}
    for item in client_statuses:
        if not isinstance(item, dict):
            continue
        image_id = str(item.get("id") or "")
        status = str(item.get("status") or "").lower()
        if image_id:
            status_by_id[image_id] = status

    reset_ids: list[str] = []
    for image in selected_images:
        image_id = str(image.get("id") or "")
        if status_by_id.get(image_id) != "pending":
            continue
        if (
            str(image.get("status") or "").lower() != "pending"
            or image.get("result_path")
            or image.get("warnings")
        ):
            reset_ids.append(image_id)
        image["status"] = "pending"
        image.pop("result_path", None)
        image.pop("warnings", None)

    return {
        "received": len(status_by_id),
        "pending_reset_count": len(reset_ids),
        "pending_reset_image_ids": reset_ids,
    }


def _batch_is_active() -> bool:
    """True while the background batch worker thread is still running."""
    state = globals().get("STATE")
    if state is None:
        return False
    with state.lock:
        return state.batch_thread is not None and state.batch_thread.is_alive()


def _validate_gpu_worker_request(config: dict[str, Any]) -> None:
    """Reject obviously unsafe gpu_workers before any model pool is allocated.

    The frontend already clamps gpu_workers to MAX_GPU_WORKERS, so any request
    above that cap (or a non-integer) is malformed/hostile. Refusing it here keeps
    the model pool from allocating an unbounded number of model instances.
    """
    raw = (config.get("worker_config") or {}).get("gpu_workers")
    if raw is None:
        return
    try:
        requested = int(raw)
    except (TypeError, ValueError):
        raise RuntimeError("worker_config.gpu_workers must be an integer")
    if requested < 1:
        raise RuntimeError("worker_config.gpu_workers must be at least 1")
    if requested > MAX_GPU_WORKERS:
        raise RuntimeError(
            f"Requested gpu_workers={requested} exceeds the safe maximum of {MAX_GPU_WORKERS}"
        )


def _load_model_pools(model_path: Path, config: dict[str, Any]) -> dict[str, ModelPool]:
    _validate_gpu_worker_request(config)
    _ensure_cuda_available_for_config(config)
    _apply_cpu_threads(_worker_config(config)["cpu_threads"])
    rt = autocensor_cli._runtime()
    YOLO = rt["YOLO"]
    pools: dict[str, ModelPool] = {}
    for device, requested in _pool_sizes_for_config(config).items():
        pool = ModelPool(device=device, requested=max(1, int(requested or 1)))
        for _index in range(pool.requested):
            try:
                pool.add(YOLO(str(model_path)))
            except Exception as exc:
                pool.load_errors.append(str(exc))
                break
        pools[device] = pool
    if not any(pool.models for pool in pools.values()):
        _release_model_pools(pools)
        raise RuntimeError("No model instances could be loaded")
    return pools


def _warmup_pools(pools: dict[str, ModelPool], config: dict[str, Any]) -> dict[str, Any]:
    rt = autocensor_cli._runtime()
    np = rt["np"]
    dummy = np.zeros((64, 64, 3), dtype=np.uint8)
    started = time.time()
    entries: list[dict[str, Any]] = []
    for device, pool in pools.items():
        for index, model in enumerate(pool.models):
            item_started = time.time()
            try:
                model.predict(
                    dummy,
                    conf=float(config.get("threshold", 0.25)),
                    verbose=False,
                    device="cuda:0" if device == "cuda" else "cpu",
                    imgsz=64,
                    retina_masks=True,
                )
                entries.append(
                    {
                        "device": device,
                        "slot": index,
                        "status": "ok",
                        "duration_ms": int((time.time() - item_started) * 1000),
                    }
                )
            except Exception as exc:
                entries.append(
                    {
                        "device": device,
                        "slot": index,
                        "status": "failed",
                        "error": str(exc),
                        "duration_ms": int((time.time() - item_started) * 1000),
                    }
                )
    failed = [entry for entry in entries if entry.get("status") != "ok"]
    return {
        "automatic": True,
        "status": "partial" if failed else "ok",
        "duration_ms": int((time.time() - started) * 1000),
        "entries": entries,
        "note": "Warmup uses a generated blank 64x64 image; it does not read private sample files.",
    }


def _assert_loaded_pools_ready(pools: dict[str, ModelPool], config: dict[str, Any], warmup_report: dict[str, Any]) -> None:
    desired = _pool_sizes_for_config(config)
    failures: list[str] = []
    if set(pools.keys()) != set(desired.keys()):
        failures.append(f"requested devices {sorted(desired)} but loaded devices {sorted(pools)}")
    for device, requested in desired.items():
        pool = pools.get(device)
        expected = max(1, int(requested or 1))
        loaded = len(pool.models) if pool else 0
        if pool is None or loaded != expected:
            failures.append(f"{device} pool loaded {loaded}/{expected}")
    failed_warmups = [entry for entry in warmup_report.get("entries", []) if entry.get("status") != "ok"]
    warmup_entries = warmup_report.get("entries", [])
    if failed_warmups:
        failures.append(f"warmup failed for {len(failed_warmups)}/{len(warmup_entries)} model instance(s)")
    if failures:
        raise RuntimeError("Model load did not satisfy the requested runtime settings: " + " | ".join(failures))


def _primary_model_from_pools(pools: dict[str, ModelPool]) -> Any:
    for preferred in ("cuda", "cpu"):
        pool = pools.get(preferred)
        if pool and pool.models:
            return pool.models[0]
    for pool in pools.values():
        if pool.models:
            return pool.models[0]
    return None


def _pools_satisfy_config(pools: dict[str, ModelPool], config: dict[str, Any]) -> bool:
    try:
        _validate_gpu_worker_request(config)
    except RuntimeError:
        return False
    desired = _pool_sizes_for_config(config)
    if set(pools.keys()) != set(desired.keys()):
        return False
    for device, requested in desired.items():
        pool = pools.get(device)
        expected = max(1, int(requested or 1))
        loaded = len(pool.models) if pool else 0
        if pool is None or pool.requested != expected or loaded != expected:
            return False
    return True


def _acquire_model(device: str) -> tuple[ModelPool | None, int | None, Any]:
    wanted = _normalize_device_name(device)
    with STATE.lock:
        pool = STATE.model_pools.get(wanted)
        fallback = STATE.model
    if pool and pool.models:
        slot, model = pool.acquire()
        return pool, slot, model
    if wanted == "cuda":
        return None, None, None
    return None, None, fallback


def _release_model(pool: ModelPool | None, slot: int | None) -> None:
    if pool is not None and slot is not None:
        pool.release(slot)


def _worker_recommendation(config: dict[str, Any]) -> dict[str, Any]:
    cores = os.cpu_count() or 2
    torch_info = _torch_info()
    cuda_available = bool(torch_info.get("cuda_available"))
    cuda_devices = torch_info.get("cuda_devices") or []
    first_cuda = cuda_devices[0] if cuda_devices else {}
    gpu_workers = 1
    if cuda_available:
        total_label = str(first_cuda.get("total_memory") or "")
        try:
            amount = float(total_label.split(" ", 1)[0])
            unit = total_label.split(" ", 1)[1]
            if unit == "GB" and amount >= 16:
                gpu_workers = 2
        except Exception:
            gpu_workers = 1
    cpu_workers = max(1, min(4, cores // 2 if cores > 1 else 1))
    cpu_threads = max(1, min(4, cores // max(1, cpu_workers)))
    requested_mode = _requested_device_mode(config)
    recommended_mode = requested_mode if requested_mode != "auto" else "auto"
    if recommended_mode == "cuda" and not cuda_available:
        recommended_mode = "auto"
    if recommended_mode == "hybrid" and not cuda_available:
        recommended_mode = "cpu"
    return {
        "device_mode": recommended_mode,
        "worker_config": {
            "gpu_workers": gpu_workers,
            "cpu_workers": cpu_workers,
            "cpu_threads": cpu_threads,
            "save_threads": max(1, min(8, cores)),
            "postprocess_workers": max(1, min(8, cores)),
            "batch_size": 4 if cuda_available else 1,
        },
        "runtime": {
            "cpu_cores": cores,
            "python": sys.version.split()[0],
            "platform": platform.platform(),
            "torch": torch_info,
        },
        "truthfulness": {
            "postprocess_workers": "Can raise the active image worker pool size when postprocess is enabled; model inference remains per image.",
            "batch_size": "Batch size controls backend queue chunking, not multi-image model inference.",
            "save_threads": "Save threads control extra output-directory copies only.",
        },
    }


def _mask_to_data_url(mask_np) -> str:
    rt = autocensor_cli._runtime()
    np = rt["np"]
    Image = rt["Image"]
    mask_f = autocensor_cli.ensure_mask_f32(mask_np)
    alpha = np.clip(mask_f * 255.0, 0, 255).astype(np.uint8)
    rgba = np.zeros((alpha.shape[0], alpha.shape[1], 4), dtype=np.uint8)
    rgba[:, :, 0:3] = 255
    rgba[:, :, 3] = alpha
    output = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(output, format="PNG")
    return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode("ascii")


def _mask_bbox(mask_np, full_offset: tuple[int, int], full_size: tuple[int, int]) -> dict[str, float] | None:
    rt = autocensor_cli._runtime()
    np = rt["np"]
    mask_f = autocensor_cli.ensure_mask_f32(mask_np)
    ys, xs = np.nonzero(mask_f > 0.0)
    if ys.size == 0:
        return None
    x0, y0 = int(xs.min()), int(ys.min())
    x1, y1 = int(xs.max()) + 1, int(ys.max()) + 1
    off_x, off_y = full_offset
    full_w, full_h = full_size
    return {
        "x": max(0.0, (off_x + x0) / full_w),
        "y": max(0.0, (off_y + y0) / full_h),
        "w": min(1.0, max(1, x1 - x0) / full_w),
        "h": min(1.0, max(1, y1 - y0) / full_h),
    }


def _crop_mask_to_bbox(mask_np):
    rt = autocensor_cli._runtime()
    np = rt["np"]
    mask_f = autocensor_cli.ensure_mask_f32(mask_np)
    ys, xs = np.nonzero(mask_f > 0.0)
    if ys.size == 0:
        return None, (0, 0, 0, 0)
    x0, y0 = int(xs.min()), int(ys.min())
    x1, y1 = int(xs.max()) + 1, int(ys.max()) + 1
    return mask_f[y0:y1, x0:x1], (x0, y0, x1, y1)


def _legacy_grabcut_region_fallback(crop, args: SimpleNamespace):
    """Return the legacy right-drag GrabCut fallback mask for model-empty regions."""
    rt = autocensor_cli._runtime()
    cv2 = rt["cv2"]
    np = rt["np"]
    width, height = crop.size
    if width < 12 or height < 12:
        return None

    img_rgb = np.asarray(crop.convert("RGB"))
    img_cv = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
    mask = np.zeros(img_cv.shape[:2], np.uint8)
    margin_x = min(5, max(1, width // 10))
    margin_y = min(5, max(1, height // 10))
    rect = (
        margin_x,
        margin_y,
        max(1, width - margin_x * 2),
        max(1, height - margin_y * 2),
    )
    if rect[2] < 2 or rect[3] < 2:
        return None

    bgd_model = np.zeros((1, 65), np.float64)
    fgd_model = np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(img_cv, mask, rect, bgd_model, fgd_model, 5, cv2.GC_INIT_WITH_RECT)
    except cv2.error:
        return None

    fallback = np.where((mask == 2) | (mask == 0), 0.0, 1.0).astype(np.float32)
    if int(np.count_nonzero(fallback > 0.01)) < 10:
        return None
    return autocensor_cli.refine_mask(
        fallback,
        crop.size,
        blur_sigma=float(args.blur_sigma),
        supersample=int(args.supersample),
        enable_postprocess=not bool(args.no_postprocess),
        brush_hardness=float(args.brush_hardness),
    )


class AutoCensorHandler(BaseHTTPRequestHandler):
    server_version = "AutoCensorHTTP/" + SERVER_VERSION

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")

    def _request_hostname(self) -> str:
        host = (self.headers.get("Host", "") or "").strip().lower()
        if host.startswith("[") and "]" in host:
            return host[1:].split("]", 1)[0]
        return host.split(":", 1)[0]

    def _api_host_allowed(self) -> bool:
        hostname = self._request_hostname()
        if not hostname:
            return False
        allowed = {"127.0.0.1", "localhost", "::1"}
        try:
            bound_host = str(self.server.server_address[0]).strip().lower()
            if bound_host and bound_host not in {"0.0.0.0", "::", ""}:
                allowed.add(bound_host)
        except Exception:
            pass
        allowed.update(
            item.strip().lower()
            for item in os.environ.get("AC_ALLOWED_HOSTS", "").split(",")
            if item.strip()
        )
        return hostname in allowed

    def _allowed_origin(self) -> str | None:
        origin = self.headers.get("Origin", "")
        if not origin:
            return None
        if not self._api_host_allowed():
            return None
        host = self.headers.get("Host", "")
        allowed = {f"http://{host}", f"https://{host}"}
        allowed.update(
            item.strip()
            for item in os.environ.get("AC_ALLOWED_ORIGINS", "").split(",")
            if item.strip()
        )
        if origin in allowed:
            return origin
        return None

    def _api_origin_allowed(self) -> bool:
        return self._api_host_allowed() and (not self.headers.get("Origin") or self._allowed_origin() is not None)

    def _send_headers(
        self,
        status: int,
        content_type: str,
        length: int | None = None,
        cache_control: str | None = None,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        if length is not None:
            self.send_header("Content-Length", str(length))
        if cache_control:
            self.send_header("Cache-Control", cache_control)
        origin = self._allowed_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def _send_json(self, payload: Any, status: int = HTTPStatus.OK) -> None:
        body = _json_bytes(_public_api_value(payload))
        self._send_headers(status, "application/json; charset=utf-8", len(body))
        self.wfile.write(body)

    def _send_private_json(self, payload: Any, status: int = HTTPStatus.OK) -> None:
        body = _json_bytes(payload)
        self._send_headers(status, "application/json; charset=utf-8", len(body))
        self.wfile.write(body)

    def _send_error_json(self, status: int, message: str) -> None:
        self._send_json({"ok": False, "error": message}, status)

    def _read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError as exc:
            raise BadRequestBody("Invalid Content-Length header") from exc
        if length <= 0:
            return {}
        if length > MAX_JSON_BODY_BYTES:
            raise RequestBodyTooLarge(f"JSON request body exceeds {_format_bytes(MAX_JSON_BODY_BYTES)}")
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def do_OPTIONS(self) -> None:
        if self.headers.get("Origin") and not self._api_origin_allowed():
            self._send_headers(HTTPStatus.FORBIDDEN, "text/plain; charset=utf-8", 0)
            return
        self._send_headers(HTTPStatus.NO_CONTENT, "text/plain; charset=utf-8", 0)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/") and not self._api_origin_allowed():
            self._send_error_json(HTTPStatus.FORBIDDEN, "Origin is not allowed")
            return
        if parsed.path == "/api/health":
            self._send_json({"ok": True, "version": SERVER_VERSION, "model_state": STATE.model_state()})
            return
        if parsed.path == "/api/settings":
            self._api_settings_get()
            return
        if parsed.path == "/api/batch/status":
            self._send_json({"ok": True, **STATE.status()})
            return
        if parsed.path == "/api/image":
            self._serve_image(parsed.query)
            return
        if parsed.path.startswith("/api/"):
            self._send_error_json(HTTPStatus.NOT_FOUND, "Unknown API endpoint")
            return
        self._serve_static(parsed.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/") and not self._api_origin_allowed():
            self._send_error_json(HTTPStatus.FORBIDDEN, "Origin is not allowed")
            return
        try:
            if parsed.path == "/api/scan":
                self._api_scan()
            elif parsed.path == "/api/settings":
                self._api_settings_save()
            elif parsed.path == "/api/model/load":
                self._api_model_load()
            elif parsed.path == "/api/model/unload":
                self._api_model_unload()
            elif parsed.path == "/api/model/diagnose":
                self._api_model_diagnose()
            elif parsed.path == "/api/workers/optimize":
                self._api_workers_optimize()
            elif parsed.path == "/api/batch/start":
                self._api_batch_start()
            elif parsed.path == "/api/batch/stop":
                self._api_batch_stop()
            elif parsed.path == "/api/region/detect":
                self._api_region_detect()
            elif parsed.path == "/api/manual/save":
                self._api_manual_save()
            elif parsed.path == "/api/desktop/window":
                self._api_desktop_window()
            elif parsed.path == "/api/desktop/picker":
                self._api_desktop_picker()
            elif parsed.path == "/api/desktop/open-path":
                self._api_desktop_open_path()
            else:
                self._send_error_json(HTTPStatus.NOT_FOUND, "Unknown API endpoint")
        except RequestBodyTooLarge as exc:
            self._send_error_json(HTTPStatus(413), str(exc))
        except BadRequestBody as exc:
            self._send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
        except json.JSONDecodeError:
            self._send_error_json(HTTPStatus.BAD_REQUEST, "Invalid JSON body")
        except Exception as exc:
            with STATE.lock:
                STATE.last_error = str(exc)
            self._send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, str(exc))

    def _api_settings_get(self) -> None:
        settings, path = _read_user_settings(STATE.root)
        self._send_private_json({"ok": True, "settings": settings, "settings_path": str(path)})

    def _api_settings_save(self) -> None:
        payload = self._read_json()
        settings = payload.get("settings")
        if not isinstance(settings, dict):
            self._send_error_json(HTTPStatus.BAD_REQUEST, "settings must be a JSON object")
            return
        path = _write_user_settings(STATE.root, settings)
        self._send_private_json({"ok": True, "settings_path": str(path)})

    def _api_desktop_window(self) -> None:
        payload = self._read_json()
        action = str(payload.get("action") or "state").strip().lower()
        controller = DESKTOP_WINDOW_CONTROLLER
        if controller is None:
            self._send_error_json(HTTPStatus.NOT_FOUND, "Desktop window controls are not available")
            return
        if action not in {"state", "minimize", "toggle-maximize", "close", "drag"}:
            self._send_error_json(HTTPStatus.BAD_REQUEST, "Unknown desktop window action")
            return
        result = controller(action)
        self._send_json(result, HTTPStatus.OK if result.get("ok") else HTTPStatus.BAD_REQUEST)

    def _api_desktop_picker(self) -> None:
        payload = self._read_json()
        action = str(payload.get("action") or "").strip().lower()
        controller = DESKTOP_FILE_CONTROLLER
        if controller is None:
            self._send_error_json(HTTPStatus.NOT_FOUND, "Desktop picker controls are not available")
            return
        if action not in {"pick-folder", "pick-model-file"}:
            self._send_error_json(HTTPStatus.BAD_REQUEST, "Unknown desktop picker action")
            return
        result = controller(action, payload)
        self._send_private_json(result, HTTPStatus.OK if result.get("ok") or result.get("cancelled") else HTTPStatus.BAD_REQUEST)

    def _api_desktop_open_path(self) -> None:
        payload = self._read_json()
        controller = DESKTOP_FILE_CONTROLLER
        if controller is None:
            self._send_error_json(HTTPStatus.NOT_FOUND, "Desktop open-path controls are not available")
            return
        result = controller("open-path", payload)
        self._send_private_json(result, HTTPStatus.OK if result.get("ok") else HTTPStatus.BAD_REQUEST)

    def _api_scan(self) -> None:
        payload = self._read_json()
        input_dir = _resolve_path(str(payload.get("input_dir") or ""), STATE.root)
        recursive = bool(payload.get("recursive", True))
        config = payload.get("config") or {}
        if not input_dir.exists():
            self._send_error_json(HTTPStatus.BAD_REQUEST, f"Input path not found: {input_dir}")
            return

        try:
            image_paths = _iter_images_bounded(input_dir, recursive=recursive, limit=MAX_SCAN_IMAGES)
        except RuntimeError as exc:
            self._send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        input_root = input_dir if input_dir.is_dir() else input_dir.parent
        images: list[dict[str, Any]] = []
        for path in image_paths:
            image_id = _safe_id(path)
            original_thumbnail = f"/api/image?id={image_id}&v={_now_ms()}"
            restored_result = _find_existing_result_path(path, input_root, config)
            image = {
                "id": image_id,
                "path": str(path),
                "filename": path.name,
                "status": "pending",
                "thumbnail": original_thumbnail,
                "original_thumbnail": original_thumbnail,
            }
            if restored_result is not None:
                _mark_restored_image(image, image_id, restored_result)
            images.append(image)

        processed_count = sum(1 for image in images if image["status"] in COMPLETED_BATCH_STATUSES)
        censored_count = sum(1 for image in images if image["status"] == "censored")
        clean_count = sum(1 for image in images if image["status"] == "clean")
        restored_count = sum(1 for image in images if image.get("result_path"))

        with STATE.lock:
            STATE.images = images
            STATE.images_by_id = {img["id"]: img for img in images}
            STATE.input_root = input_root
            STATE.progress = {
                "total": len(images),
                "processed": processed_count,
                "censored": censored_count,
                "clean": clean_count,
                "failed": 0,
                "restored": restored_count,
                "eta_text": "",
                "current_file": "",
                "message": f"Scanned {len(images)} images; restored {restored_count} existing outputs",
            }
            STATE.run_finished = False
            STATE.last_error = None
        self._send_json({"ok": True, "images": images, "progress": STATE.progress})

    def _api_model_load(self) -> None:
        if _batch_is_active():
            self._send_error_json(HTTPStatus.CONFLICT, "Cannot load a model while a batch run is active")
            return
        payload = self._read_json()
        config = payload.get("config") or {}
        model_path = _resolve_model_path(str(payload.get("model_path") or ""), STATE.root)
        if not model_path.exists():
            self._send_error_json(
                HTTPStatus.BAD_REQUEST,
                f"Model file not found: {model_path}. Place a trusted compatible .pt file under models/ or pass a model path.",
            )
            return

        try:
            pools = _load_model_pools(model_path, config)
        except RuntimeError as exc:
            self._send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        model = _primary_model_from_pools(pools)
        warmup_report = _warmup_pools(pools, config)
        try:
            _assert_loaded_pools_ready(pools, config, warmup_report)
        except RuntimeError as exc:
            _release_model_pools(pools)
            self._send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        old_pools: dict[str, ModelPool] = {}
        with STATE.lock:
            old_pools = STATE.model_pools
            STATE.model = model
            STATE.model_path = model_path
            STATE.model_loaded_at = time.time()
            STATE.model_pools = pools
            STATE.active_config = dict(config)
            STATE.warmup_report = warmup_report
            STATE.last_error = None
        _release_model_pools(old_pools)
        self._send_json({"ok": True, "model_state": STATE.model_state()})

    def _api_model_unload(self) -> None:
        if _batch_is_active():
            self._send_error_json(HTTPStatus.CONFLICT, "Cannot unload the model while a batch run is active")
            return
        with STATE.lock:
            old_pools = STATE.model_pools
            STATE.model = None
            STATE.model_path = None
            STATE.model_loaded_at = None
            STATE.model_pools = {}
            STATE.warmup_report = {}
            STATE.last_error = None
        _release_model_pools(old_pools)
        self._send_json({"ok": True, "model_state": STATE.model_state()})

    def _api_model_diagnose(self) -> None:
        payload = self._read_json()
        payload_config = payload.get("config") or {}
        model_path = _resolve_model_path(str(payload.get("model_path") or ""), STATE.root)
        exists = model_path.exists()
        stat = model_path.stat() if exists else None
        with STATE.lock:
            loaded = STATE.model is not None and STATE.model_path == model_path
            names = getattr(STATE.model, "names", None) if loaded else None
            pools = {device: pool.as_diagnostic() for device, pool in STATE.model_pools.items()}
            active_config = dict(STATE.active_config)
            last_error = STATE.last_error
        effective_config = dict(active_config)
        effective_config.update(payload_config)
        _apply_cpu_threads(_worker_config(effective_config)["cpu_threads"])
        runtime_settings = _runtime_settings_report(effective_config)
        runtime = {
            "python": sys.version.split()[0],
            "platform": platform.platform(),
            "cpu_cores": os.cpu_count() or 1,
            "torch": _torch_info(),
        }
        self._send_json(
            {
                "ok": True,
                "diagnostic": {
                    "model_path": model_path.name,
                    "model_name": model_path.name,
                    "exists": exists,
                    "size": _format_bytes(stat.st_size if stat else None),
                    "loaded": loaded,
                    "labels": names,
                    "runtime": runtime,
                    "worker_config": _worker_config(effective_config),
                    "requested_worker_config": _requested_worker_config(effective_config),
                    "applied_worker_config": runtime_settings["applied"],
                    "runtime_settings": runtime_settings,
                    "requested_pools": _pool_sizes_for_config(effective_config),
                    "pools": pools,
                    "active_devices": runtime_settings["active_devices"],
                    "loaded_pool_counts": {
                        device: {"loaded": pool.get("loaded", 0), "requested": pool.get("requested", 0)}
                        for device, pool in pools.items()
                    },
                    "warmup": dict(STATE.warmup_report),
                    "benchmark": _benchmark_report(STATE),
                    "recent_timings": list(STATE.recent_timings[-10:]),
                    "last_error": last_error,
                    "note": "Only load trusted Ultralytics segmentation .pt files.",
                },
            }
        )

    def _api_workers_optimize(self) -> None:
        payload = self._read_json()
        config = payload.get("config") or {}
        with STATE.lock:
            model_loaded = STATE.model is not None
            benchmark = _benchmark_report(STATE)
        if not model_loaded:
            self._send_error_json(
                HTTPStatus.CONFLICT,
                "Load a model before running worker optimization. Hardware-only estimates are available from model diagnostics.",
            )
            return
        recommendation = _worker_recommendation(config)
        recommended_config = dict(config)
        recommended_config["worker_config"] = recommendation["worker_config"]
        recommended_config["device_mode"] = recommendation["device_mode"]
        self._send_json(
            {
                "ok": True,
                "proof_mode": "hardware_runtime_heuristic_requires_loaded_model",
                "recommendation_basis": "hardware/runtime heuristic; loaded model is an admission gate only, not a timed benchmark input",
                "benchmark": benchmark,
                "recommendation": recommendation,
                "requested_worker_config": _requested_worker_config(config),
                "applied_worker_config_if_accepted": _runtime_settings_report(recommended_config)["applied"],
                "runtime_settings_if_accepted": _runtime_settings_report(recommended_config),
            }
        )

    def _api_batch_start(self) -> None:
        payload = self._read_json()
        config = payload.get("config") or {}
        try:
            _validate_targets_for_processing(config)
        except RuntimeError as exc:
            self._send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        try:
            _validate_gpu_worker_request(config)
        except RuntimeError as exc:
            self._send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        force_reprocess = bool(payload.get("force_reprocess") or config.get("force_reprocess"))
        requested_ids = [str(item) for item in payload.get("image_ids") or []]
        with STATE.lock:
            model_path = STATE.model_path
            pools_ready = _pools_satisfy_config(STATE.model_pools, config)
            batch_running = STATE.batch_thread is not None and STATE.batch_thread.is_alive()
        if not batch_running and model_path is not None and not pools_ready:
            try:
                pools = _load_model_pools(model_path, config)
            except RuntimeError as exc:
                self._send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
                return
            warmup_report = _warmup_pools(pools, config)
            try:
                _assert_loaded_pools_ready(pools, config, warmup_report)
            except RuntimeError as exc:
                _release_model_pools(pools)
                self._send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
                return
            old_pools: dict[str, ModelPool] = {}
            with STATE.lock:
                old_pools = STATE.model_pools
                STATE.model_pools = pools
                STATE.model = _primary_model_from_pools(pools)
                STATE.active_config = dict(config)
                STATE.warmup_report = warmup_report
            _release_model_pools(old_pools)
        _apply_cpu_threads(_worker_config(config)["cpu_threads"])
        with STATE.lock:
            if STATE.model is None:
                self._send_error_json(HTTPStatus.BAD_REQUEST, "Model is not loaded")
                return
            if STATE.batch_thread is not None and STATE.batch_thread.is_alive():
                self._send_error_json(HTTPStatus.CONFLICT, "A batch run is already active")
                return
            selected = [img for img in STATE.images if not requested_ids or img["id"] in requested_ids]
            if not selected:
                self._send_error_json(HTTPStatus.BAD_REQUEST, "No images selected for processing")
                return
            client_state_report = _apply_client_batch_state_overrides(
                selected,
                payload.get("image_statuses"),
            )
            processable, skipped_completed = _split_batch_images(selected, force_reprocess)
            output_dir_count = max(1, len(config.get("output_dirs") or ["output"]))
            runtime_settings = _runtime_settings_report(config, output_dir_count=output_dir_count)
            batch_context = {
                "endpoint": "/api/batch/start",
                "real_backend_batch_path": True,
                "requested_image_count": len(requested_ids),
                "selected_image_count": len(selected),
                "selected_image_ids": [img["id"] for img in selected],
                "processable_image_count": len(processable),
                "processable_image_ids": [img["id"] for img in processable],
                "skipped_completed_count": len(skipped_completed),
                "skipped_completed_image_ids": [img["id"] for img in skipped_completed],
                "force_reprocess": force_reprocess,
                "skip_completed": not force_reprocess,
                "client_state_overrides": client_state_report,
                "single_image_batch": len(processable) == 1,
                "requested_worker_config": _requested_worker_config(config),
                "applied_worker_config": runtime_settings["applied"],
                "runtime_settings": runtime_settings,
                "output_dir_count": output_dir_count,
                "started_at": time.time(),
            }
            for img in processable:
                img["status"] = "pending"
                img.pop("result_path", None)
                img.pop("warnings", None)
            STATE.cancel_event.clear()
            STATE.run_started_at = time.time()
            STATE.run_finished = False
            STATE.last_error = None
            STATE.active_config = dict(config)
            STATE.last_batch_context = batch_context
            STATE.progress = {
                "total": len(processable),
                "processed": 0,
                "censored": 0,
                "clean": 0,
                "failed": 0,
                "eta_text": "",
                "current_file": "",
                "message": "Single-image batch started" if len(processable) == 1 else "Batch started",
            }
            if not processable:
                STATE.run_finished = True
                STATE.last_batch_context["finished_at"] = time.time()
                STATE.last_batch_context["duration_seconds"] = 0.0
                STATE.last_batch_context["processed"] = 0
                STATE.last_batch_context["recent_timing_count"] = len(STATE.recent_timings)
                STATE.progress.update(
                    {
                        "message": "Batch complete - skipped already processed images",
                        "duration_seconds": 0.0,
                        "throughput_text": "",
                    }
                )
                self._send_json({"ok": True, **STATE.status()})
                return
            worker = threading.Thread(target=_run_batch, args=(processable, config), daemon=True)
            STATE.batch_thread = worker
            worker.start()
        self._send_json({"ok": True, **STATE.status()})

    def _api_batch_stop(self) -> None:
        STATE.cancel_event.set()
        with STATE.lock:
            STATE.progress["message"] = "Stopping after the current image"
        self._send_json({"ok": True, **STATE.status()})

    def _api_region_detect(self) -> None:
        payload = self._read_json()
        image_id = str(payload.get("image_id") or "")
        rect = payload.get("normalized_rect") or {}
        threshold = float(payload.get("threshold", 0.25))
        config = payload.get("config") or {}
        requested_device = str(
            payload.get("device")
            or config.get("region_device_mode")
            or config.get("device_mode")
            or "cpu"
        )
        device = _normalize_device_name(requested_device)
        target_config = {
            **config,
            "targets": payload.get("targets", config.get("targets")),
            "target_mode": payload.get("target_mode", config.get("target_mode")),
        }
        try:
            _validate_targets_for_processing(target_config)
        except RuntimeError as exc:
            self._send_error_json(HTTPStatus.BAD_REQUEST, str(exc))
            return
        targets = _targets_for_config(target_config)
        with STATE.lock:
            image = STATE.images_by_id.get(image_id)
        if not image:
            self._send_error_json(HTTPStatus.BAD_REQUEST, "Image id not found")
            return
        pool, slot, model = _acquire_model(device)
        if model is None:
            self._send_error_json(HTTPStatus.BAD_REQUEST, "Model is not loaded")
            return

        path = Path(image["path"])
        rt = autocensor_cli._runtime()
        Image = rt["Image"]
        with Image.open(path).convert("RGB") as pil_img:
            w_img, h_img = pil_img.size
            nx0 = max(0.0, min(1.0, float(rect.get("x", 0.0))))
            ny0 = max(0.0, min(1.0, float(rect.get("y", 0.0))))
            nx1 = max(nx0, min(1.0, nx0 + float(rect.get("w", 1.0))))
            ny1 = max(ny0, min(1.0, ny0 + float(rect.get("h", 1.0))))
            px0 = max(0, min(w_img - 1, int(round(nx0 * w_img))))
            py0 = max(0, min(h_img - 1, int(round(ny0 * h_img))))
            px1 = max(px0 + 1, min(w_img, int(round(nx1 * w_img))))
            py1 = max(py0 + 1, min(h_img, int(round(ny1 * h_img))))
            crop = pil_img.crop((px0, py0, px1, py1))

        args = _censor_args(config, device=device)
        masks: list[dict[str, Any]] = []
        try:
            results = model.predict(
                crop,
                conf=threshold,
                verbose=False,
                device="cuda:0" if device == "cuda" else "cpu",
                imgsz=int(args.imgsz),
                retina_masks=True,
            )
            names = getattr(model, "names", {}) or {}
            for result in results:
                result_masks = getattr(result, "masks", None)
                boxes = getattr(result, "boxes", None)
                if boxes is None:
                    continue
                mask_items = autocensor_cli.mask_data_items(result_masks)
                for index, box in enumerate(boxes):
                    class_id = int(box.cls[0])
                    label = autocensor_cli.safe_label_name(names, class_id)
                    if not autocensor_cli.target_matches(label, targets):
                        continue
                    mask_tensor = mask_items[index] if index < len(mask_items) else None
                    mask_np = mask_tensor.cpu().numpy() if mask_tensor is not None else autocensor_cli.box_to_mask(box, crop.size)
                    if mask_np is None:
                        continue
                    mask_np = autocensor_cli.refine_mask(
                        mask_np,
                        crop.size,
                        blur_sigma=float(args.blur_sigma),
                        supersample=int(args.supersample),
                        enable_postprocess=not bool(args.no_postprocess),
                        brush_hardness=float(args.brush_hardness),
                    )
                    cropped_mask, local_box = _crop_mask_to_bbox(mask_np)
                    if cropped_mask is None:
                        continue
                    lx0, ly0, lx1, ly1 = local_box
                    box_norm = {
                        "x": max(0.0, (px0 + lx0) / w_img),
                        "y": max(0.0, (py0 + ly0) / h_img),
                        "w": min(1.0, max(1, lx1 - lx0) / w_img),
                        "h": min(1.0, max(1, ly1 - ly0) / h_img),
                    }
                    conf = float(box.conf[0]) if getattr(box, "conf", None) is not None else threshold
                    masks.append(
                        {
                            "label": label,
                            "confidence": conf,
                            "box": box_norm,
                            "mask": _mask_to_data_url(cropped_mask),
                            "source": "model-mask",
                        }
                    )
            if not masks:
                fallback_mask = _legacy_grabcut_region_fallback(crop, args)
                if fallback_mask is not None:
                    cropped_mask, local_box = _crop_mask_to_bbox(fallback_mask)
                    if cropped_mask is not None:
                        lx0, ly0, lx1, ly1 = local_box
                        masks.append(
                            {
                                "label": "manual-region",
                                "confidence": 0.0,
                                "box": {
                                    "x": max(0.0, (px0 + lx0) / w_img),
                                    "y": max(0.0, (py0 + ly0) / h_img),
                                    "w": min(1.0, max(1, lx1 - lx0) / w_img),
                                    "h": min(1.0, max(1, ly1 - ly0) / h_img),
                                },
                                "mask": _mask_to_data_url(cropped_mask),
                                "source": "manual-grabcut-fallback",
                            }
                        )

        finally:
            _release_model(pool, slot)

        message = (
            f"Model detected {len(masks)} regions"
            if masks and not any(mask.get("source") == "manual-grabcut-fallback" for mask in masks)
            else "No selected model target detected; used legacy region fallback"
            if masks
            else "No selected model target detected in the selected region"
        )
        self._send_json({"ok": True, "masks": masks, "message": message})

    def _api_manual_save(self) -> None:
        payload = self._read_json()
        image_id = str(payload.get("image_id") or "")
        data_url = str(payload.get("edited_image") or "")
        config = payload.get("config") or {}
        with STATE.lock:
            image = STATE.images_by_id.get(image_id)
        if not image:
            self._send_error_json(HTTPStatus.BAD_REQUEST, "Image id not found")
            return
        if "," not in data_url or not data_url.startswith("data:image/"):
            self._send_error_json(HTTPStatus.BAD_REQUEST, "Edited image must be a data:image URL")
            return

        image_path = Path(image["path"])
        input_root = STATE.input_root or image_path.parent
        output_dirs = config.get("output_dirs") or ["output"]
        first_output_dir = _resolve_path(str(output_dirs[0]), STATE.root)
        suffix = _sanitize_output_suffix(config.get("output_suffix"), "_manual")
        save_quality = _clamp_quality(config.get("quality"))
        output_format = str(config.get("output_format") or "png").lower()
        if output_format not in {"original", "jpeg", "png", "webp", "bmp"}:
            output_format = "png"
        out_path = _output_path(image_path, input_root, first_output_dir, output_format, suffix)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        encoded = data_url.split(",", 1)[1]
        estimated_size = (len(encoded) * 3) // 4
        if estimated_size > MAX_MANUAL_EDIT_BYTES:
            self._send_error_json(HTTPStatus(413), f"Manual edit payload exceeds {_format_bytes(MAX_MANUAL_EDIT_BYTES)}")
            return
        try:
            edited_bytes = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError):
            self._send_error_json(HTTPStatus.BAD_REQUEST, "Edited image payload is not valid base64")
            return
        if len(edited_bytes) > MAX_MANUAL_EDIT_BYTES:
            self._send_error_json(HTTPStatus(413), f"Manual edit payload exceeds {_format_bytes(MAX_MANUAL_EDIT_BYTES)}")
            return
        preserve_exif_requested = bool(config.get("preserve_exif", False))
        out_ext = out_path.suffix.lower()
        source_exif = None
        rt = autocensor_cli._runtime()
        Image = rt["Image"]
        try:
            with Image.open(io.BytesIO(edited_bytes)) as probe:
                probe.verify()
        except Exception:
            self._send_error_json(HTTPStatus.BAD_REQUEST, "Edited image payload is not a valid readable image")
            return
        if preserve_exif_requested and out_ext in {".jpg", ".jpeg", ".webp"}:
            try:
                with Image.open(image_path) as source_image:
                    source_exif = source_image.info.get("exif")
            except Exception:
                source_exif = None
        with Image.open(io.BytesIO(edited_bytes)) as edited:
            save_kw = autocensor_cli.save_kwargs(out_ext, save_quality)
            if source_exif:
                save_kw["exif"] = source_exif
            if out_ext in {".jpg", ".jpeg", ".bmp"}:
                edited.convert("RGB").save(out_path, **save_kw)
            else:
                edited.save(out_path, **save_kw)
        extra_dirs = [_resolve_path(str(item), STATE.root) for item in output_dirs]
        save_threads = _worker_config(config)["save_threads"]
        extra_output_paths: list[Path] = []
        if len(extra_dirs) > 1:
            extra_output_paths = _copy_extra_outputs(
                str(out_path),
                image_path,
                input_root,
                extra_dirs,
                output_format,
                suffix,
                save_threads,
            )
        manual_save = {
            "primary_output": str(out_path),
            "extra_outputs": [str(item) for item in extra_output_paths],
            "output_format": output_format,
            "quality": save_quality,
            "save_threads": save_threads,
            "preserve_exif_requested": preserve_exif_requested,
            "metadata_policy": "source EXIF preserved for manual JPEG/WebP saves when requested and present",
            "exif_preserved": bool(source_exif),
        }
        with STATE.lock:
            image["status"] = "censored"
            image["result_path"] = str(out_path)
            image.setdefault("original_thumbnail", f"/api/image?id={image_id}")
            image["thumbnail"] = f"/api/image?id={image_id}&result=1&v={_now_ms()}"
        self._send_json({"ok": True, "image": dict(image), "manual_save": manual_save})

    def _serve_image(self, query: str) -> None:
        params = parse_qs(query)
        image_id = (params.get("id") or [""])[0]
        use_result = (params.get("result") or ["0"])[0] == "1"
        with STATE.lock:
            image = STATE.images_by_id.get(image_id)
        if not image:
            self._send_error_json(HTTPStatus.NOT_FOUND, "Image id not found")
            return
        path = Path(image.get("result_path") if use_result and image.get("result_path") else image["path"])
        if not path.exists() or path.suffix.lower() not in SUPPORTED_EXTS:
            self._send_error_json(HTTPStatus.NOT_FOUND, "Image file not available")
            return
        try:
            size = path.stat().st_size
        except OSError:
            self._send_error_json(HTTPStatus.NOT_FOUND, "Image file not available")
            return
        if size > MAX_SERVED_IMAGE_BYTES:
            self._send_error_json(HTTPStatus(413), f"Image file exceeds {_format_bytes(MAX_SERVED_IMAGE_BYTES)}")
            return
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        body = path.read_bytes()
        self._send_headers(HTTPStatus.OK, content_type, len(body))
        self.wfile.write(body)

    def _serve_static(self, path_value: str) -> None:
        static_dir = STATE.static_dir
        if not static_dir or not static_dir.exists():
            self._send_error_json(HTTPStatus.NOT_FOUND, "Static build not found. Run npm run build first or use Vite dev server.")
            return
        rel = unquote(path_value.lstrip("/")) or "index.html"
        candidate = (static_dir / rel).resolve()
        try:
            if os.path.commonpath([str(candidate), str(static_dir.resolve())]) != str(static_dir.resolve()):
                raise ValueError("Static path escaped root")
        except Exception:
            self._send_error_json(HTTPStatus.FORBIDDEN, "Forbidden")
            return
        if not candidate.exists() or candidate.is_dir():
            candidate = static_dir / "index.html"
        content_type = mimetypes.guess_type(candidate.name)[0] or "text/html"
        if candidate.suffix == ".html":
            content_type = "text/html; charset=utf-8"
        body = candidate.read_bytes()
        if candidate.name == "index.html" and DESKTOP_WINDOW_CONTROLLER is not None:
            if b"data-desktop-window=" not in body[:512]:
                body = body.replace(b"<html ", b'<html data-desktop-window="true" ', 1)
            marker = (
                b"<script>window.__AUTOCENSOR_DESKTOP__=true;"
                b"document.documentElement.dataset.desktopWindow='true';</script>"
            )
            body = body.replace(b"<head>", b"<head>" + marker, 1)
        self._send_headers(HTTPStatus.OK, content_type, len(body), cache_control="no-store")
        self.wfile.write(body)


def _copy_extra_outputs(
    source_path: str,
    image_path: Path,
    input_root: Path,
    output_dirs: list[Path],
    output_format: str,
    suffix: str,
    save_threads: int,
) -> list[Path]:
    if len(output_dirs) <= 1:
        return []

    source = Path(source_path)

    def _copy_one(extra_dir: Path) -> Path:
        extra_output = _output_path(image_path, input_root, extra_dir, output_format, suffix)
        extra_output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, extra_output)
        return extra_output

    with ThreadPoolExecutor(max_workers=max(1, min(save_threads, len(output_dirs) - 1))) as executor:
        futures = [executor.submit(_copy_one, extra_dir) for extra_dir in output_dirs[1:]]
        return [future.result() for future in as_completed(futures)]


def _run_batch(selected_images: list[dict[str, Any]], config: dict[str, Any]) -> None:
    started = time.time()
    workers = _worker_config(config)
    thread_report = _apply_cpu_threads(workers["cpu_threads"])
    targets = _targets_for_config(config)
    output_dirs = [_resolve_path(str(item), STATE.root) for item in (config.get("output_dirs") or ["output"])]
    suffix = _sanitize_output_suffix(config.get("output_suffix"), "_censored")
    input_root = STATE.input_root
    devices = _devices_for_config(config)
    queue_items: queue.Queue[dict[str, Any]] = queue.Queue()
    for image in selected_images:
        queue_items.put(image)

    with STATE.lock:
        pools = {device: STATE.model_pools.get(device) for device in devices}
        fallback_model = STATE.model

    if fallback_model is None and not any(pool and pool.models for pool in pools.values()):
        with STATE.lock:
            STATE.last_error = "Model is not loaded"
            STATE.run_finished = True
        return

    counters = {"processed": 0, "censored": 0, "clean": 0, "failed": 0}
    counter_lock = threading.Lock()

    def _update_progress(message: str) -> None:
        elapsed = max(0.01, time.time() - started)
        with counter_lock:
            processed = counters["processed"]
            remaining = max(0, len(selected_images) - processed)
            eta = int((elapsed / max(1, processed)) * remaining)
            snapshot = dict(counters)
        with STATE.lock:
            STATE.progress.update(
                {
                    "total": len(selected_images),
                    "processed": snapshot["processed"],
                    "censored": snapshot["censored"],
                    "clean": snapshot["clean"],
                    "failed": snapshot["failed"],
                    "eta_text": f"{eta}s",
                    "throughput_text": f"{processed / elapsed:.2f} img/s" if processed else "",
                    "message": message,
                }
            )
            STATE.last_batch_context["applied_worker_config"] = _runtime_settings_report(
                config,
                output_dir_count=len(output_dirs),
            )["applied"]
            STATE.last_batch_context["cpu_thread_application"] = thread_report

    def _finish_image(image: dict[str, Any], status: str, output_path: str | None, warning: str | None = None) -> None:
        with counter_lock:
            counters["processed"] += 1
            if warning:
                counters["failed"] += 1
            elif status == "censored":
                counters["censored"] += 1
            else:
                counters["clean"] += 1
        with STATE.lock:
            image["status"] = "failed" if warning else ("censored" if status == "censored" else "clean")
            if warning:
                image["warnings"] = [warning]
                STATE.last_error = warning
            elif output_path:
                image["result_path"] = str(output_path)
                image.setdefault("original_thumbnail", f"/api/image?id={image['id']}")
                image["thumbnail"] = f"/api/image?id={image['id']}&result=1&v={_now_ms()}"

    def _next_chunk() -> list[dict[str, Any]]:
        chunk: list[dict[str, Any]] = []
        for _ in range(max(1, workers["batch_size"])):
            # Re-check cancellation before every queue get so a stop request does
            # not pull a whole batch_size chunk of fresh work after the stop.
            if STATE.cancel_event.is_set():
                break
            try:
                chunk.append(queue_items.get_nowait())
            except queue.Empty:
                break
        return chunk

    def _worker(device: str, model: Any) -> None:
        args = _censor_args(config, device=device)
        while not STATE.cancel_event.is_set():
            chunk = _next_chunk()
            if not chunk:
                return

            for image in chunk:
                # Check cancellation before each image so a stop takes effect
                # immediately instead of finishing the remaining chunk items.
                if STATE.cancel_event.is_set():
                    break
                image_started = time.time()
                image_path = Path(image["path"])
                root = input_root or image_path.parent
                with STATE.lock:
                    image["status"] = "processing"
                    STATE.progress["current_file"] = image["filename"]
                    STATE.progress["message"] = f"Processing {image['filename']} on {device.upper()}"

                try:
                    first_output = _output_path(image_path, root, output_dirs[0], args.output_format, suffix)
                    record = autocensor_cli.process_image(model, image_path, first_output, args, targets)
                    status = str(record.get("status") or "clean")
                    output_path = record.get("output")
                    if output_path:
                        _copy_extra_outputs(
                            output_path,
                            image_path,
                            root,
                            output_dirs,
                            args.output_format,
                            suffix,
                            workers["save_threads"],
                        )
                    _finish_image(image, status, str(output_path) if output_path else None)
                    timing_status = status
                except Exception as exc:
                    _finish_image(image, "failed", None, str(exc))
                    timing_status = "failed"
                finally:
                    duration = max(0.001, time.time() - image_started)
                    with STATE.lock:
                        STATE.recent_timings.append(
                            {
                                "image_id": image["id"],
                                "device": device,
                                "status": timing_status,
                                "duration_seconds": round(duration, 4),
                                "batch_size_chunk": workers["batch_size"],
                            }
                        )
                        STATE.recent_timings = STATE.recent_timings[-50:]
                    queue_items.task_done()
                    _update_progress("Batch running" if not queue_items.empty() else "Batch complete")

    futures = []
    with ThreadPoolExecutor(max_workers=max(1, sum(max(1, int(_pool_sizes_for_config(config).get(d, 1))) for d in devices))) as executor:
        for device in devices:
            pool = pools.get(device)
            if pool and pool.models:
                for model in pool.models:
                    futures.append(executor.submit(_worker, device, model))
            elif fallback_model is not None:
                futures.append(executor.submit(_worker, device, fallback_model))
        for future in as_completed(futures):
            future.result()

    with STATE.lock:
        if STATE.cancel_event.is_set():
            STATE.progress["message"] = "Batch stopped"
            for image in selected_images:
                if image.get("status") == "processing":
                    image["status"] = "pending"
        else:
            STATE.progress["message"] = "Batch complete"
        STATE.progress["duration_seconds"] = round(time.time() - started, 4)
        STATE.progress["throughput_text"] = (
            f"{counters['processed'] / max(0.001, time.time() - started):.2f} img/s" if counters["processed"] else ""
        )
        STATE.last_batch_context["finished_at"] = time.time()
        STATE.last_batch_context["duration_seconds"] = STATE.progress["duration_seconds"]
        STATE.last_batch_context["processed"] = counters["processed"]
        STATE.last_batch_context["recent_timing_count"] = len(STATE.recent_timings)
        STATE.run_finished = True


def _self_test(root: Path) -> int:
    global STATE
    STATE = ServerState(root=root.resolve(), static_dir=None)
    assert (root / "backend" / "autocensor_cli.py").exists()
    assert _resolve_model_path("", root).name == autocensor_cli.DEFAULT_MODEL_BASENAME
    assert _censor_args({"censor_mode": "mosaic"}).mode == "mosaic"
    assert _censor_args({"censor_mode": "solid", "fill_color": "#ff00cc"}).fill_color == "#ff00cc"
    assert _censor_args({"censor_mode": "blackwhite", "fill_color": "#ff00cc"}).fill_color == "#ffffff"
    assert _requested_device_mode({"device_mode": "auto"}) == "auto"
    assert _devices_for_config({"device_mode": "cpu"}) == ["cpu"]
    assert _devices_for_config({"device_mode": "auto"}) in (["cpu"], ["cuda"])
    assert _devices_for_config({"device_mode": "cuda"}) == ["cuda"]
    assert _normalize_device_name("cuda") == "cuda"
    if not _cuda_available():
        try:
            _ensure_cuda_available_for_config({"device_mode": "cuda"})
            raise AssertionError("CUDA-only mode must not silently fall back to CPU")
        except RuntimeError as exc:
            assert "CUDA mode was requested" in str(exc)
    assert _worker_config({"worker_config": {"cpu_workers": 2}})["cpu_workers"] == 2
    assert _worker_recommendation({"device_mode": "hybrid"})["worker_config"]["cpu_workers"] >= 1
    batch_images = [
        {"id": "clean-id", "status": "clean", "result_path": "keep-clean.png"},
        {"id": "censored-id", "status": "censored", "result_path": "keep-censored.png"},
        {"id": "pending-id", "status": "pending"},
    ]
    processable, skipped_completed = _split_batch_images(batch_images, False)
    assert [item["id"] for item in processable] == ["pending-id"]
    assert [item["id"] for item in skipped_completed] == ["clean-id", "censored-id"]
    assert batch_images[0]["result_path"] == "keep-clean.png"
    reset_report = _apply_client_batch_state_overrides(batch_images, [{"id": "clean-id", "status": "pending"}])
    assert reset_report["pending_reset_image_ids"] == ["clean-id"]
    assert batch_images[0]["status"] == "pending"
    assert "result_path" not in batch_images[0]
    reset_processable, reset_skipped = _split_batch_images(batch_images, False)
    assert [item["id"] for item in reset_processable] == ["clean-id", "pending-id"]
    assert [item["id"] for item in reset_skipped] == ["censored-id"]
    force_processable, force_skipped = _split_batch_images(batch_images, True)
    assert [item["id"] for item in force_processable] == ["clean-id", "censored-id", "pending-id"]
    assert force_skipped == []
    runtime_report = _runtime_settings_report(
        {"device_mode": "cpu", "postprocess_enabled": True, "worker_config": {"postprocess_workers": 4, "batch_size": 3}}
    )
    assert runtime_report["applied"]["postprocess_workers"] == 4
    assert runtime_report["applied"]["batch_size"] == 3
    assert runtime_report["postprocess"]["device"] == "cpu"
    out = _output_path(Path("input_root") / "sample.png", Path("input_root"), Path("output"), "original", "_censored")
    assert out == Path("output") / "input_root_censored" / "sample.png"
    with tempfile.TemporaryDirectory(prefix="autocensor-restore-selftest-") as temp_name:
        fixture_root = Path(temp_name)
        input_root = fixture_root / "input"
        primary_output = fixture_root / "primary-output"
        secondary_output = fixture_root / "secondary-output"
        input_root.mkdir()
        primary_output.mkdir()
        secondary_output.mkdir()
        source = input_root / "sample.png"
        source.write_bytes(b"source")
        nested_source = input_root / "nested" / "frame.webp"
        nested_source.parent.mkdir()
        nested_source.write_bytes(b"nested-source")
        config = {
            "output_dirs": [str(primary_output), str(secondary_output)],
            "output_suffix": "_censored",
            "output_format": "webp",
        }
        expected_png = primary_output / "input_censored" / "sample.png"
        expected_jpg = primary_output / "input_censored" / "sample.jpg"
        expected_png.parent.mkdir(parents=True)
        expected_png.write_bytes(b"png-result")
        expected_jpg.write_bytes(b"newer-jpg-result")
        os.utime(expected_jpg, (time.time() + 10, time.time() + 10))
        assert _find_existing_result_path(source, input_root, config) == expected_png

        expected_png.unlink()
        assert _find_existing_result_path(source, input_root, config) == expected_jpg

        expected_jpg.unlink()
        secondary_only = secondary_output / "input_censored" / "sample.png"
        secondary_only.parent.mkdir(parents=True)
        secondary_only.write_bytes(b"secondary-result")
        assert _find_existing_result_path(source, input_root, config) is None

        direct_layout = primary_output / "sample.png"
        direct_layout.write_bytes(b"direct-result")
        assert _find_existing_result_path(source, input_root, config) is None

        nested_result = primary_output / "input_censored" / "nested" / "frame.webp"
        nested_result.parent.mkdir(parents=True, exist_ok=True)
        nested_result.write_bytes(b"nested-result")
        assert _find_existing_result_path(nested_source, input_root, config) == nested_result

        later_safe = source.with_suffix(".jpg")
        later_safe.write_bytes(b"later-safe")
        assert _first_existing_result_candidate([source, later_safe], source) == later_safe

        restored_image = {"status": "pending", "thumbnail": "/api/image?id=abc"}
        _mark_restored_image(restored_image, "abc", expected_jpg)
        assert restored_image["status"] == "censored"
        assert restored_image["restored"] is True
        assert "result=1" in restored_image["thumbnail"]

    # gpu_workers must preserve the legacy 1-300 user range and reject beyond it.
    assert MAX_GPU_WORKERS == 300
    assert _worker_config({"worker_config": {"gpu_workers": 999}})["gpu_workers"] == MAX_GPU_WORKERS
    assert _worker_config({"worker_config": {"gpu_workers": 0}})["gpu_workers"] == 1
    _validate_gpu_worker_request({"worker_config": {"gpu_workers": MAX_GPU_WORKERS}})
    for unsafe in ({"gpu_workers": MAX_GPU_WORKERS + 1}, {"gpu_workers": 0}, {"gpu_workers": "x"}):
        try:
            _validate_gpu_worker_request({"worker_config": unsafe})
            raise AssertionError(f"unsafe gpu_workers must be rejected: {unsafe}")
        except RuntimeError:
            pass

    # Save quality must be clamped server-side to the encoder-valid range.
    assert _clamp_quality(100000) == 100
    assert _clamp_quality(0) == 1
    assert _clamp_quality("not-a-number") == 95

    # Output suffix sanitizer must strip traversal, separators and drive prefixes.
    for hostile in ("../../etc", "..\\..\\windows", "C:\\evil", "a/b\\c", "..", "<bad>:name"):
        cleaned = _sanitize_output_suffix(hostile, "_safe")
        assert "/" not in cleaned and "\\" not in cleaned and ".." not in cleaned, cleaned
        assert ":" not in cleaned, cleaned
    assert _sanitize_output_suffix("   ", "_fallback") == "_fallback"
    assert _sanitize_output_suffix("", "_fallback") == "_fallback"
    assert _sanitize_output_suffix("_censored", "_fallback") == "_censored"
    # A sanitized hostile suffix must stay a single segment under the output dir.
    hostile_out = _output_path(
        Path("input_root") / "sample.png", Path("input_root"), Path("output"),
        "original", _sanitize_output_suffix("../../etc", "_manual"),
    )
    assert Path("output") in hostile_out.parents
    print("backend self-test ok")
    return 0


def create_http_server(
    host: str,
    port: int,
    static_dir_value: str = "dist",
    root: Path | None = None,
) -> ThreadingHTTPServer:
    """Create a configured backend server for CLI, desktop, or packaged use."""
    resolved_root = (root or Path(__file__).resolve().parent.parent).resolve()
    static_dir = _resolve_path(static_dir_value, resolved_root) if static_dir_value else None
    global STATE
    STATE = ServerState(root=resolved_root, static_dir=static_dir)
    return ThreadingHTTPServer((host, port), AutoCensorHandler)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="AutoCensor vNext local HTTP backend")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host. Use 0.0.0.0 only behind a trusted network boundary.")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--static-dir", default="dist", help="Directory containing the built web UI")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)

    root = Path(__file__).resolve().parent.parent
    if args.self_test:
        return _self_test(root)

    server = create_http_server(args.host, args.port, args.static_dir, root)
    print(f"AutoCensor backend listening on http://{args.host}:{args.port}")
    print(f"Project root: {STATE.root}")
    print(f"Static UI: {STATE.static_dir}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Stopping AutoCensor backend")
    finally:
        shutdown_runtime(timeout=5)
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
