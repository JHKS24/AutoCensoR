# SPDX-FileCopyrightText: 2026 AutoCensor Project Owner and contributors
# SPDX-License-Identifier: MIT

"""Generate the desktop application icon from the master artwork.

The master image keeps the full icon appearance. This script removes only the
near-black background connected to the canvas edges, preserving the dark tile
and internal redaction shapes, then exports the PNG/ICO files used by the app.

Run from the project root:

    python scripts/generate_app_icon.py
"""

from __future__ import annotations

from collections import deque
from pathlib import Path

try:
    from PIL import Image
except ImportError as exc:  # pragma: no cover - clear guidance when Pillow is absent
    raise SystemExit(
        "Pillow is required to build the app icon. Install it with "
        "'python -m pip install pillow' (it is already in requirements.txt)."
    ) from exc

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
MASTER = PUBLIC / "app-icon-master.png"
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
BACKGROUND_MAX_CHANNEL = 30


def _is_connected_background(pixel: tuple[int, int, int, int]) -> bool:
    red, green, blue, alpha = pixel
    return alpha > 0 and max(red, green, blue) <= BACKGROUND_MAX_CHANNEL


def remove_outer_background(image: Image.Image) -> Image.Image:
    """Make only edge-connected near-black background pixels transparent."""
    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()
    visited = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def mark_if_background(x: int, y: int) -> None:
        index = y * width + x
        if visited[index]:
            return
        if _is_connected_background(pixels[x, y]):
            visited[index] = 1
            queue.append((x, y))

    for x in range(width):
        mark_if_background(x, 0)
        mark_if_background(x, height - 1)
    for y in range(height):
        mark_if_background(0, y)
        mark_if_background(width - 1, y)

    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height:
                mark_if_background(nx, ny)

    for y in range(height):
        row = y * width
        for x in range(width):
            if visited[row + x]:
                red, green, blue, _alpha = pixels[x, y]
                pixels[x, y] = (red, green, blue, 0)

    return rgba


def main() -> int:
    if not MASTER.exists():
        raise SystemExit(f"missing icon master artwork: {MASTER.relative_to(ROOT)}")

    PUBLIC.mkdir(parents=True, exist_ok=True)
    master = remove_outer_background(Image.open(MASTER))

    png_path = PUBLIC / "app-icon.png"
    master.resize((256, 256), Image.Resampling.LANCZOS).save(png_path, format="PNG")

    ico_path = PUBLIC / "app-icon.ico"
    master.save(ico_path, format="ICO", sizes=[(size, size) for size in ICO_SIZES])

    print(f"wrote {png_path.relative_to(ROOT)} (256x256)")
    print(f"wrote {ico_path.relative_to(ROOT)} ({', '.join(f'{size}x{size}' for size in ICO_SIZES)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
