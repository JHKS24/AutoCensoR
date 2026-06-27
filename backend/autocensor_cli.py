# SPDX-FileCopyrightText: 2026 AutoCensor Project Owner and contributors
# SPDX-License-Identifier: MIT

"""Headless AutoCensor command-line runner for servers.

This module intentionally avoids PyQt imports. It can run from source on a
server or be packaged as a console executable with PyInstaller.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path
from typing import Any


SUPPORTED_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
DEFAULT_MODEL_BASENAME = "autocensor_model.pt"
DEFAULT_NTD_TARGETS: set[str] = {
    "anus",
    "anal",
    "ass",
    "asshole",
    "exposed_anus",
    "buttocks",
    "penis",
    "exposed_penis",
    "genitalia",
    "genitals",
    "vulva",
    "vagina",
    "pussy",
    "exposed_vulva",
    "testicles",
    "cunnus",
    "female_genital",
    "nipple",
    "nipples",
    "exposed_nipple",
    "breast",
    "exposed_breast",
}

_RUNTIME: dict[str, Any] = {}


TARGET_ALIASES: dict[str, set[str]] = {
    "face": {"face", "person", "people", "human"},
    "person": {"person", "people", "human", "face"},
    "license_plate": {"license_plate", "license", "licence_plate", "licence", "plate", "number_plate"},
    "license": {"license", "license_plate", "licence", "licence_plate", "plate", "number_plate"},
    "text": {"text", "document", "stamp", "logo", "mark"},
    "document": {"document", "text", "stamp", "logo", "mark"},
    "stamp": {"stamp", "text", "document", "mark"},
    "logo": {"logo", "mark", "text", "document"},
    "anus": {"anus", "anal", "ass", "asshole", "exposed_anus", "buttocks"},
    "anal": {"anus", "anal", "ass", "asshole", "exposed_anus", "buttocks"},
    "ass": {"anus", "anal", "ass", "asshole", "exposed_anus", "buttocks"},
    "asshole": {"anus", "anal", "ass", "asshole", "exposed_anus", "buttocks"},
    "exposed_anus": {"anus", "anal", "ass", "asshole", "exposed_anus", "buttocks"},
    "buttocks": {"anus", "anal", "ass", "asshole", "exposed_anus", "buttocks"},
    "penis": {
        "penis",
        "exposed_penis",
        "genitalia",
        "genitals",
        "vulva",
        "vagina",
        "pussy",
        "exposed_vulva",
        "testicles",
        "cunnus",
        "female_genital",
    },
    "exposed_penis": {
        "penis",
        "exposed_penis",
        "genitalia",
        "genitals",
        "vulva",
        "vagina",
        "pussy",
        "exposed_vulva",
        "testicles",
        "cunnus",
        "female_genital",
    },
    "genitalia": {
        "penis",
        "exposed_penis",
        "genitalia",
        "genitals",
        "vulva",
        "vagina",
        "pussy",
        "exposed_vulva",
        "testicles",
        "cunnus",
        "female_genital",
    },
    "genitals": {
        "penis",
        "exposed_penis",
        "genitalia",
        "genitals",
        "vulva",
        "vagina",
        "pussy",
        "exposed_vulva",
        "testicles",
        "cunnus",
        "female_genital",
    },
    "vulva": {
        "penis",
        "exposed_penis",
        "genitalia",
        "genitals",
        "vulva",
        "vagina",
        "pussy",
        "exposed_vulva",
        "testicles",
        "cunnus",
        "female_genital",
    },
    "vagina": {
        "penis",
        "exposed_penis",
        "genitalia",
        "genitals",
        "vulva",
        "vagina",
        "pussy",
        "exposed_vulva",
        "testicles",
        "cunnus",
        "female_genital",
    },
    "pussy": {
        "penis",
        "exposed_penis",
        "genitalia",
        "genitals",
        "vulva",
        "vagina",
        "pussy",
        "exposed_vulva",
        "testicles",
        "cunnus",
        "female_genital",
    },
    "exposed_vulva": {
        "penis",
        "exposed_penis",
        "genitalia",
        "genitals",
        "vulva",
        "vagina",
        "pussy",
        "exposed_vulva",
        "testicles",
        "cunnus",
        "female_genital",
    },
    "testicles": {
        "penis",
        "exposed_penis",
        "genitalia",
        "genitals",
        "vulva",
        "vagina",
        "pussy",
        "exposed_vulva",
        "testicles",
        "cunnus",
        "female_genital",
    },
    "cunnus": {
        "penis",
        "exposed_penis",
        "genitalia",
        "genitals",
        "vulva",
        "vagina",
        "pussy",
        "exposed_vulva",
        "testicles",
        "cunnus",
        "female_genital",
    },
    "female_genital": {
        "penis",
        "exposed_penis",
        "genitalia",
        "genitals",
        "vulva",
        "vagina",
        "pussy",
        "exposed_vulva",
        "testicles",
        "cunnus",
        "female_genital",
    },
    "nipple": {"nipple", "nipples", "exposed_nipple", "breast", "exposed_breast", "bare_breast"},
    "nipples": {"nipple", "nipples", "exposed_nipple", "breast", "exposed_breast", "bare_breast"},
    "exposed_nipple": {"nipple", "nipples", "exposed_nipple", "breast", "exposed_breast", "bare_breast"},
    "breast": {"nipple", "nipples", "exposed_nipple", "breast", "exposed_breast", "bare_breast"},
    "exposed_breast": {"nipple", "nipples", "exposed_nipple", "breast", "exposed_breast", "bare_breast"},
    "bare_breast": {"nipple", "nipples", "exposed_nipple", "breast", "exposed_breast", "bare_breast"},
    "nsfw": {
        "anus",
        "anal",
        "ass",
        "asshole",
        "bare_breast",
        "breast",
        "buttocks",
        "cunnus",
        "exposed_breast",
        "exposed_anus",
        "exposed_nipple",
        "exposed_penis",
        "exposed_vulva",
        "female_genital",
        "genitalia",
        "genitals",
        "nipple",
        "nipples",
        "penis",
        "pussy",
        "testicles",
        "vagina",
        "vulva",
    },
    "adult": {
        "anus",
        "anal",
        "ass",
        "asshole",
        "bare_breast",
        "breast",
        "buttocks",
        "cunnus",
        "exposed_breast",
        "exposed_anus",
        "exposed_nipple",
        "exposed_penis",
        "exposed_vulva",
        "female_genital",
        "genitalia",
        "genitals",
        "nipple",
        "nipples",
        "penis",
        "pussy",
        "testicles",
        "vagina",
        "vulva",
    },
}


def normalize_target_label(label: str) -> str:
    normalized = str(label or "").strip().casefold()
    normalized = normalized.replace("-", "_").replace(" ", "_")
    while "__" in normalized:
        normalized = normalized.replace("__", "_")
    return normalized.strip("_")


def expand_target_labels(target_labels: set[str]) -> set[str]:
    expanded: set[str] = set()
    for label in target_labels:
        normalized = normalize_target_label(label)
        if not normalized:
            continue
        expanded.add(normalized)
        expanded.update(TARGET_ALIASES.get(normalized, set()))
    return expanded


def target_matches(label: str, target_labels: set[str] | None) -> bool:
    if target_labels is None:
        return True
    if not target_labels:
        return False
    normalized_label = normalize_target_label(label)
    return normalized_label in expand_target_labels(target_labels)


def apply_cpu_threads(cpu_threads: int | None) -> dict[str, Any]:
    if not cpu_threads:
        return {"requested": None, "status": "not_requested"}
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
        report["libraries"]["torch"] = {
            "available": True,
            "before": before,
            "applied_num_threads": int(torch.get_num_threads()),
        }
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
    return report


def _runtime() -> dict[str, Any]:
    if _RUNTIME:
        return _RUNTIME
    try:
        import cv2
        import numpy as np
        from PIL import Image
        from ultralytics import YOLO
    except Exception as exc:
        raise RuntimeError(
            "Runtime dependencies are unavailable. Install requirements-server-cpu.txt "
            f"or requirements-server-gpu-cu128.txt for this machine. Import failure: {type(exc).__name__}: {exc}"
        ) from exc
    _RUNTIME.update({"cv2": cv2, "np": np, "Image": Image, "YOLO": YOLO})
    return _RUNTIME


def _candidate_models(root: Path) -> list[Path]:
    candidates: list[Path] = []
    for models_dir in (root / "models", root / "backend" / "models"):
        if models_dir.exists():
            candidates.extend(sorted(models_dir.glob("*.pt"), key=lambda p: p.stat().st_mtime, reverse=True))
    return candidates


def pick_model(model_arg: str | None, root: Path) -> Path:
    if model_arg:
        p = Path(model_arg).expanduser()
        if not p.is_absolute():
            for base in (root, root / "models", root / "backend", root / "backend" / "models"):
                candidate = base / p
                if candidate.exists():
                    return candidate
            p = root / p
        return p

    default_path = root / "models" / DEFAULT_MODEL_BASENAME
    if default_path.exists():
        return default_path
    backend_default_path = root / "backend" / "models" / DEFAULT_MODEL_BASENAME
    if backend_default_path.exists():
        return backend_default_path
    candidates = _candidate_models(root)
    return candidates[0] if candidates else default_path


def iter_images(input_path: Path, recursive: bool) -> list[Path]:
    if input_path.is_file():
        return [input_path] if input_path.suffix.lower() in SUPPORTED_EXTS else []
    pattern = "**/*" if recursive else "*"
    return sorted(p for p in input_path.glob(pattern) if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS)


def output_ext(input_file: Path, output_format: str) -> str:
    if output_format == "original":
        ext = input_file.suffix.lower()
        return ext if ext in SUPPORTED_EXTS else ".jpg"
    return {"jpeg": ".jpg", "png": ".png", "webp": ".webp", "bmp": ".bmp"}[output_format]


def save_kwargs(ext: str, quality: int) -> dict[str, Any]:
    if ext in (".jpg", ".jpeg"):
        return {"format": "JPEG", "quality": int(quality)}
    if ext == ".png":
        return {"format": "PNG"}
    if ext == ".webp":
        return {"format": "WebP", "quality": int(quality)}
    if ext == ".bmp":
        return {"format": "BMP"}
    return {"format": "JPEG", "quality": int(quality)}


def safe_label_name(names: Any, class_id: int) -> str:
    if isinstance(names, dict):
        return str(names.get(class_id, class_id))
    try:
        return str(names[class_id])
    except Exception:
        return str(class_id)


def safe_relpath(path: Path, root: Path) -> Path:
    try:
        path_abs = path.resolve()
        root_abs = root.resolve()
        if os.path.commonpath([str(path_abs), str(root_abs)]) == str(root_abs):
            return path_abs.relative_to(root_abs)
    except Exception:
        pass
    return Path(path.name)


def parse_fill_rgba(value: Any, fallback: str = "black") -> tuple[int, int, int, int]:
    raw = str(value or "").strip().lower()
    named = {
        "black": (0, 0, 0, 255),
        "white": (255, 255, 255, 255),
    }
    if raw in named:
        return named[raw]
    if raw.startswith("#"):
        raw = raw[1:]
    if len(raw) == 3 and all(ch in "0123456789abcdef" for ch in raw):
        raw = "".join(ch * 2 for ch in raw)
    if len(raw) == 6 and all(ch in "0123456789abcdef" for ch in raw):
        return (int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16), 255)
    return named.get(fallback, named["black"])


def ensure_mask_f32(mask_np):
    rt = _runtime()
    np = rt["np"]
    mask_f = mask_np.astype(np.float32, copy=False)
    if mask_f.ndim == 3:
        mask_f = mask_f[:, :, 0]
    if mask_f.size:
        try:
            if float(mask_f.max()) > 1.0:
                mask_f = mask_f / 255.0
        except Exception:
            pass
    if not mask_f.flags["C_CONTIGUOUS"]:
        mask_f = np.ascontiguousarray(mask_f, dtype=np.float32)
    return mask_f


def ensure_rgba_f32(arr):
    rt = _runtime()
    np = rt["np"]
    if arr.dtype != np.float32:
        arr = arr.astype(np.float32, copy=False)
    if not arr.flags["C_CONTIGUOUS"]:
        arr = np.ascontiguousarray(arr, dtype=np.float32)
    return arr


_U8_KERNEL_CACHE: dict[int, Any] = {}


def _cached_u8_kernel(k: int):
    rt = _runtime()
    np = rt["np"]
    size = max(1, int(k))
    cached = _U8_KERNEL_CACHE.get(size)
    if cached is None:
        cached = np.ones((size, size), dtype=np.uint8)
        _U8_KERNEL_CACHE[size] = cached
    return cached


def _normalize_brush_hardness(value: Any) -> float:
    try:
        hardness = float(value)
    except Exception:
        return 1.0
    if hardness > 1.0:
        hardness /= 100.0
    return max(0.0, min(1.0, hardness))


def refine_mask(mask_np, target_size, blur_sigma: float, supersample: int, enable_postprocess: bool, brush_hardness: float):
    rt = _runtime()
    cv2 = rt["cv2"]
    np = rt["np"]

    w, h = target_size
    m = mask_np.astype(np.float32, copy=False)
    if m.size and float(m.max()) > 1.0:
        m = m / 255.0
    mh, mw = m.shape[:2]
    if mw != w or mh != h:
        m = cv2.resize(m, (w, h), interpolation=cv2.INTER_NEAREST)
    core_mask = (m > 0.5).astype(np.float32, copy=False)
    if not enable_postprocess:
        return core_mask

    ss = max(1, int(supersample))
    result = core_mask.astype(np.float32, copy=True)
    binary = (core_mask > 0.5).astype(np.uint8) * 255

    hardness = _normalize_brush_hardness(brush_hardness)
    feather_px = 0.0
    if hardness < 0.999:
        feather_px += (1.0 - hardness) * (6.0 + max(0, ss - 1))
    if blur_sigma > 0:
        feather_px += max(0.0, float(blur_sigma)) * 1.35

    if feather_px > 0.0 and np.any(binary > 0):
        k = max(3, int(round(feather_px * 2.0)) | 1)
        expanded = cv2.dilate(binary, _cached_u8_kernel(k), iterations=1)
        sigma = max(0.6, feather_px * 0.55)
        soft = cv2.GaussianBlur(expanded.astype(np.float32) / 255.0, (0, 0), sigmaX=sigma, sigmaY=sigma)
        result = np.maximum(result, np.clip(soft, 0.0, 1.0))
    return np.clip(result, 0.0, 1.0).astype(np.float32, copy=False)


def blend_rgba_mask_inplace(dst_rgba, mask_np, opacity: float, *, src_rgba=None, fill_rgba=None) -> bool:
    rt = _runtime()
    np = rt["np"]
    if dst_rgba is None or opacity <= 0.0:
        return False
    mask_f = ensure_mask_f32(mask_np)
    ys, xs = np.nonzero(mask_f > 0.0)
    if ys.size == 0:
        return False

    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    mask_roi = mask_f[y0:y1, x0:x1]
    alpha_roi = (mask_roi[:, :, np.newaxis] * float(opacity)).astype(np.float32, copy=False)
    dst_roi = dst_rgba[y0:y1, x0:x1, :]

    if src_rgba is not None:
        src_rgba = ensure_rgba_f32(src_rgba)
        src_roi = src_rgba[y0:y1, x0:x1, :]
    else:
        src_roi = np.broadcast_to(np.asarray(fill_rgba, dtype=np.float32), dst_roi.shape)

    dst_rgba[y0:y1, x0:x1, :] = src_roi * alpha_roi + dst_roi * (1.0 - alpha_roi)
    return True


def box_to_mask(box: Any, image_size: tuple[int, int]) -> Any | None:
    rt = _runtime()
    np = rt["np"]
    xyxy = getattr(box, "xyxy", None)
    if xyxy is None:
        return None
    try:
        coords = xyxy[0]
        if hasattr(coords, "detach"):
            coords = coords.detach()
        if hasattr(coords, "cpu"):
            coords = coords.cpu()
        if hasattr(coords, "numpy"):
            coords = coords.numpy()
        coords = [float(value) for value in coords[:4]]
    except Exception:
        return None
    width, height = image_size
    if width <= 0 or height <= 0:
        return None
    x0 = max(0, min(width - 1, int(coords[0])))
    y0 = max(0, min(height - 1, int(coords[1])))
    x1 = max(x0 + 1, min(width, int(coords[2] + 0.999)))
    y1 = max(y0 + 1, min(height, int(coords[3] + 0.999)))
    mask = np.zeros((height, width), dtype=np.float32)
    mask[y0:y1, x0:x1] = 1.0
    return mask


def mask_data_items(masks: Any) -> list[Any]:
    if masks is None:
        return []
    data = getattr(masks, "data", None)
    if data is None:
        return []
    try:
        return list(data)
    except TypeError:
        return [data]


def process_image(model, image_path: Path, output_path: Path, args, target_labels: set[str] | None) -> dict[str, Any]:
    rt = _runtime()
    cv2 = rt["cv2"]
    np = rt["np"]
    Image = rt["Image"]

    results = model.predict(
        str(image_path),
        conf=float(args.threshold),
        verbose=False,
        device=str(args.device),
        imgsz=int(args.imgsz),
        retina_masks=not args.no_retina_masks,
    )

    with Image.open(image_path) as orig_pil:
        exif_data = orig_pil.info.get("exif") if args.preserve_exif else None
        img = orig_pil.convert("RGBA")

    orig_u8 = np.asarray(img, dtype=np.uint8)
    img_np = orig_u8.astype(np.float32)
    names = getattr(model, "names", {}) or {}
    fill_value = getattr(args, "fill_color", None) or getattr(args, "fill", "black")
    fill_rgba = np.array(parse_fill_rgba(fill_value, fallback=getattr(args, "fill", "black")), dtype=np.float32)
    fill_img = None
    blurred = None
    detections = 0
    applied = False

    for result in results:
        masks = getattr(result, "masks", None)
        boxes = getattr(result, "boxes", None)
        if boxes is None:
            continue
        mask_items = mask_data_items(masks)
        for index, box in enumerate(boxes):
            class_id = int(box.cls[0])
            label = safe_label_name(names, class_id)
            if not target_matches(label, target_labels):
                continue
            detections += 1
            mask_tensor = mask_items[index] if index < len(mask_items) else None
            mask_np = mask_tensor.cpu().numpy() if mask_tensor is not None else box_to_mask(box, img.size)
            if mask_np is None:
                continue
            mask_np = refine_mask(
                mask_np,
                img.size,
                blur_sigma=float(args.blur_sigma),
                supersample=int(args.supersample),
                enable_postprocess=not args.no_postprocess,
                brush_hardness=float(args.brush_hardness),
            )
            src_rgba = None
            if args.mode == "mosaic":
                if fill_img is None:
                    h, w = orig_u8.shape[:2]
                    bs = max(1, int(args.mosaic_block_size))
                    small = cv2.resize(orig_u8, (max(1, w // bs), max(1, h // bs)), interpolation=cv2.INTER_AREA)
                    fill_img = ensure_rgba_f32(cv2.resize(small, (w, h), interpolation=cv2.INTER_NEAREST))
                src_rgba = fill_img
            elif args.mode == "blur":
                if blurred is None:
                    blur_radius = max(0.1, float(args.blur_radius))
                    k = max(3, int(blur_radius * 2) + 1)
                    if k % 2 == 0:
                        k += 1
                    blurred = ensure_rgba_f32(cv2.GaussianBlur(orig_u8, (k, k), blur_radius))
                src_rgba = blurred
            if blend_rgba_mask_inplace(img_np, mask_np, float(args.opacity), src_rgba=src_rgba, fill_rgba=fill_rgba):
                applied = True

    output_path.parent.mkdir(parents=True, exist_ok=True)
    out_ext = output_path.suffix.lower()
    if not applied and args.skip_clean:
        return {"input": str(image_path), "output": None, "status": "clean_skipped", "detections": detections}

    if not applied and args.output_format == "original" and args.copy_clean_originals:
        shutil.copy2(image_path, output_path)
        return {"input": str(image_path), "output": str(output_path), "status": "clean", "detections": detections}

    save_kw = save_kwargs(out_ext, int(args.quality))
    if args.preserve_exif and exif_data and out_ext in (".jpg", ".jpeg", ".webp"):
        save_kw["exif"] = exif_data
    if applied:
        img = Image.fromarray(np.clip(img_np, 0, 255).astype(np.uint8), "RGBA")
    if out_ext in (".png", ".webp"):
        img.save(output_path, **save_kw)
    else:
        img.convert("RGB").save(output_path, **save_kw)
    return {"input": str(image_path), "output": str(output_path), "status": "censored" if applied else "clean", "detections": detections}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Headless AutoCensor batch runner")
    parser.add_argument("--input", required=True, help="Input image file or directory")
    parser.add_argument("--output", required=True, help="Output directory")
    parser.add_argument("--model", default=None, help="Model path. Defaults to models/*.pt")
    parser.add_argument("--device", default="cpu", help="Ultralytics device, e.g. cpu, cuda, cuda:0")
    parser.add_argument("--target-mode", choices=("selected", "all"), default="selected", help="Target selection mode. Use 'all' only when every model label should be censored.")
    parser.add_argument("--targets", default="", help="Comma-separated public model labels or aliases to censor when --target-mode=selected. Empty CLI targets use the fixed NTD defaults; use --target-mode=all to process every model label.")
    parser.add_argument("--threshold", type=float, default=0.25)
    parser.add_argument("--imgsz", type=int, default=1280)
    parser.add_argument("--mode", choices=("color", "mosaic", "blur"), default="color")
    parser.add_argument("--fill", choices=("black", "white"), default="black")
    parser.add_argument("--fill-color", default="", help="Solid censor fill color as #RRGGBB. Overrides --fill when provided.")
    parser.add_argument("--opacity", type=float, default=1.0)
    parser.add_argument("--mosaic-block-size", type=int, default=10)
    parser.add_argument("--blur-radius", type=float, default=15)
    parser.add_argument("--blur-sigma", type=float, default=0.0)
    parser.add_argument("--supersample", type=int, default=4)
    parser.add_argument("--brush-hardness", type=float, default=1.0)
    parser.add_argument("--no-postprocess", action="store_true")
    parser.add_argument("--no-retina-masks", action="store_true")
    parser.add_argument("--output-format", choices=("original", "jpeg", "png", "webp", "bmp"), default="original")
    parser.add_argument("--quality", type=int, default=95)
    parser.add_argument("--preserve-exif", action="store_true")
    parser.add_argument("--cpu-threads", type=int, default=None, help="Apply CPU thread limit to Torch/OpenCV where supported")
    parser.add_argument(
        "--copy-clean-originals",
        action="store_true",
        help="Copy clean files byte-for-byte when output-format=original. This can preserve source metadata.",
    )
    parser.add_argument("--no-recursive", action="store_true")
    parser.add_argument("--skip-clean", action="store_true", help="Do not write images with no matching detections")
    parser.add_argument("--dry-run", action="store_true", help="Check inputs/model and list image count without loading ML runtime")
    parser.add_argument("--json", action="store_true", help="Print JSON summary")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    root = Path(__file__).resolve().parent.parent
    input_path = Path(args.input).expanduser()
    output_dir = Path(args.output).expanduser()
    model_path = pick_model(args.model, root)

    if not input_path.exists():
        print(f"[ERROR] Input path not found: {input_path}", file=sys.stderr)
        return 2
    images = iter_images(input_path, recursive=not args.no_recursive)
    if not images:
        print(f"[ERROR] No supported images found under: {input_path}", file=sys.stderr)
        return 2
    if not model_path.exists():
        print(f"[ERROR] Model file not found: {model_path}", file=sys.stderr)
        print("[INFO] Put a trusted compatible .pt model under models/ or pass --model.", file=sys.stderr)
        return 2
    if args.dry_run:
        print(f"[OK] images={len(images)} model={model_path}")
        return 0

    thread_report = apply_cpu_threads(args.cpu_threads)
    try:
        rt = _runtime()
        model = rt["YOLO"](str(model_path))
    except Exception as exc:
        print(f"[ERROR] Failed to initialize model runtime: {exc}", file=sys.stderr)
        return 3

    selected_targets = {item.strip() for item in str(args.targets or "").split(",") if item.strip()}
    target_labels: set[str] | None = None if args.target_mode == "all" else (selected_targets or set(DEFAULT_NTD_TARGETS))
    input_root = input_path if input_path.is_dir() else input_path.parent
    records = []
    failures = 0

    for image_path in images:
        rel = safe_relpath(image_path, input_root)
        out_path = output_dir / rel
        out_path = out_path.with_suffix(output_ext(image_path, args.output_format))
        try:
            record = process_image(model, image_path, out_path, args, target_labels)
            records.append(record)
            print(f"[{record['status']}] {image_path} -> {record.get('output')}")
        except Exception as exc:
            failures += 1
            record = {"input": str(image_path), "error": str(exc)}
            records.append(record)
            print(f"[ERROR] {image_path}: {exc}", file=sys.stderr)

    summary = {
        "processed": len(images),
        "failed": failures,
        "censored": sum(1 for r in records if r.get("status") == "censored"),
        "clean": sum(1 for r in records if r.get("status") == "clean"),
        "clean_skipped": sum(1 for r in records if r.get("status") == "clean_skipped"),
    }
    if args.json:
        print(json.dumps({"summary": summary, "records": records, "cpu_threads": thread_report}, ensure_ascii=False, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
