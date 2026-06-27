# -*- mode: python ; coding: utf-8 -*-
# SPDX-FileCopyrightText: 2026 AutoCensor Project Owner and contributors
# SPDX-License-Identifier: MIT

from pathlib import Path

from PyInstaller.utils.hooks import copy_metadata

ROOT = Path(SPECPATH).resolve()


def safe_copy_metadata(package_name):
    try:
        return copy_metadata(package_name, recursive=True)
    except Exception:
        return []


datas = [
    (str(ROOT / "dist"), "dist"),
    (str(ROOT / "public"), "public"),
    (str(ROOT / "models" / "README.md"), "models"),
]
for metadata_package in (
    "ultralytics",
    "opencv-python",
    "torch",
    "torchvision",
    "numpy",
    "pillow",
    "PyYAML",
    "tqdm",
    "requests",
    "psutil",
    "pydantic",
    "py-cpuinfo",
    "matplotlib",
):
    datas += safe_copy_metadata(metadata_package)

binaries = []

hiddenimports = [
    "autocensor_cli",
    "autocensor_server",
    "cv2",
    "numpy",
    "PIL.Image",
    "torch",
    "torchvision",
    "ultralytics",
    "ultralytics.engine.model",
    "ultralytics.engine.predictor",
    "ultralytics.engine.results",
    "ultralytics.models.yolo",
    "ultralytics.models.yolo.detect",
    "ultralytics.models.yolo.detect.predict",
    "ultralytics.models.yolo.model",
    "ultralytics.models.yolo.segment",
    "ultralytics.models.yolo.segment.predict",
    "ultralytics.nn.modules",
    "ultralytics.nn.tasks",
    "ultralytics.utils",
    "ultralytics.utils.ops",
    "yaml",
    "webview",
    "webview.platforms.edgechromium",
    "webview.platforms.winforms",
]

a = Analysis(
    ["backend/autocensor_desktop.py"],
    pathex=[str(ROOT), str(ROOT / "backend")],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "IPython",
        "polars",
        "PyQt5",
        "PyQt6",
        "PySide2",
        "PySide6",
        "av",
        "datasets",
        "jupyter",
        "librosa",
        "numba",
        "onnxruntime",
        "pandas",
        "pdfminer",
        "pyarrow",
        "pypdfium2",
        "pytest",
        "shapely",
        "sklearn",
        "soundfile",
        "scipy",
        "sqlalchemy",
        "timm",
        "tkinter",
        "torchaudio",
        "torchao",
        "triton",
        "transformers",
        "yt_dlp",
    ],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="AutoCensor",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(ROOT / "public" / "app-icon.ico"),
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="AutoCensor",
)
