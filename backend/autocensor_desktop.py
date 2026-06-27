# SPDX-FileCopyrightText: 2026 AutoCensor Project Owner and contributors
# SPDX-License-Identifier: MIT

"""Launch AutoCensor as a native desktop window.

This starts the existing local Python backend (which serves the built Vite UI
and the JSON API on a single 127.0.0.1 origin) and opens it in an OS-native
WebView window instead of asking the user to open a browser tab. The UI calls
the API with relative paths, so the window and the backend share one origin and
no extra CORS configuration is needed.

The desktop window uses ``pywebview`` (BSD-3-Clause, MIT-compatible), which
renders through the platform WebView (Edge WebView2 on Windows, WebKit on
macOS/Linux). It is an optional extra and is not part of the headless/server
runtime; install it with ``python -m pip install -r requirements-desktop.txt``.

Usage from the candidate root, after ``npm run build``:

    python backend/autocensor_desktop.py
"""

from __future__ import annotations

import argparse
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path
from typing import Any

import autocensor_server

APP_NAME = "AutoCensor"
WINDOW_TITLE = "AutoCensor"
ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent)).resolve()
DEFAULT_PROFILE_ID = f"{APP_NAME}-vNext"


def _resolve_static_dir(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else (ROOT / path)


def _free_port(host: str) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return int(sock.getsockname()[1])


def _wait_for_health(url: str, timeout: float = 30.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2.0) as response:
                if response.status == 200:
                    return True
        except Exception:
            time.sleep(0.25)
    return False


def _safe_profile_id(value: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in value.strip())
    return cleaned[:80] or DEFAULT_PROFILE_ID


def _profile_config_path(profile_id: str) -> Path:
    if os.name == "nt":
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
    elif sys.platform == "darwin":
        base = str(Path.home() / "Library" / "Application Support")
    else:
        base = os.environ.get("XDG_CONFIG_HOME") or str(Path.home() / ".config")
    return Path(base) / APP_NAME / profile_id


def _storage_path(profile_id: str) -> Path:
    """Per-user directory so the UI's saved settings/shortcuts survive restarts."""
    if os.name == "nt":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    elif sys.platform == "darwin":
        base = str(Path.home() / "Library" / "Application Support")
    else:
        base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    path = Path(base) / APP_NAME / profile_id / "webview"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _reset_profile(profile_id: str) -> None:
    for path in (_storage_path(profile_id), _profile_config_path(profile_id)):
        shutil.rmtree(path, ignore_errors=True)


def _icon_path() -> str | None:
    for candidate in (ROOT / "public" / "app-icon.ico", ROOT / "dist" / "app-icon.ico"):
        if candidate.exists():
            return str(candidate)
    return None


class DesktopApi:
    def __init__(self) -> None:
        self._maximized = False

    def _active_window(self) -> Any:
        import webview

        if not webview.windows:
            raise RuntimeError("desktop window is not available")
        return webview.windows[0]

    def _initial_directory(self, value: str = "") -> str:
        initial = Path(str(value or "")).expanduser()
        if not initial.exists():
            initial = Path.home()
        if initial.is_file():
            initial = initial.parent
        return str(initial)

    def pick_folder(self, initial_dir: str = "") -> dict[str, Any]:
        try:
            import webview

            selected = webview.windows[0].create_file_dialog(
                webview.FOLDER_DIALOG,
                directory=self._initial_directory(initial_dir),
            )
            if not selected:
                return {"ok": False, "cancelled": True, "path": ""}
            if isinstance(selected, (list, tuple)):
                return {"ok": True, "path": str(selected[0]) if selected else ""}
            return {"ok": True, "path": str(selected)}
        except Exception as exc:
            return {"ok": False, "error": f"{type(exc).__name__}: {exc}", "path": ""}

    def pick_model_file(self, initial_dir: str = "") -> dict[str, Any]:
        try:
            import webview

            # Do not restrict release users to a hardcoded model name or extension.
            # The backend will validate whether the selected file can actually load.
            selected = webview.windows[0].create_file_dialog(
                webview.OPEN_DIALOG,
                directory=self._initial_directory(initial_dir),
                file_types=("All files (*.*)",),
            )
            if not selected:
                return {"ok": False, "cancelled": True, "path": ""}
            if isinstance(selected, (list, tuple)):
                return {"ok": True, "path": str(selected[0]) if selected else ""}
            return {"ok": True, "path": str(selected)}
        except Exception as exc:
            return {"ok": False, "error": f"{type(exc).__name__}: {exc}", "path": ""}

    def open_path(self, path: str = "") -> dict[str, Any]:
        raw = str(path or "").strip()
        if not raw:
            return {"ok": False, "error": "empty path"}
        target = Path(raw).expanduser()
        open_target = target
        opened_parent = False
        if not target.exists():
            existing_parent = target.parent
            while not existing_parent.exists() and existing_parent.parent != existing_parent:
                existing_parent = existing_parent.parent
            if not existing_parent.exists():
                return {
                    "ok": False,
                    "error": "requested path not found and no existing parent could be opened",
                    "path": str(target),
                    "existing_parent": "",
                }
            open_target = existing_parent
            opened_parent = True
        try:
            if os.name == "nt":
                os.startfile(str(open_target))  # type: ignore[attr-defined]
            elif sys.platform == "darwin":
                subprocess.Popen(["open", str(open_target)])
            else:
                subprocess.Popen(["xdg-open", str(open_target)])
            return {
                "ok": True,
                "path": str(target),
                "opened_path": str(open_target),
                "opened_parent": opened_parent,
                "missing_target": not target.exists(),
            }
        except Exception as exc:
            return {"ok": False, "error": str(exc), "path": str(target)}

    def minimize_window(self) -> dict[str, Any]:
        try:
            self._active_window().minimize()
            return {"ok": True}
        except Exception as exc:
            return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}

    def toggle_maximize_window(self) -> dict[str, Any]:
        try:
            window = self._active_window()
            if self._maximized:
                window.restore()
                self._maximized = False
            else:
                window.maximize()
                self._maximized = True
            return {"ok": True, "maximized": self._maximized}
        except Exception as exc:
            return {"ok": False, "error": f"{type(exc).__name__}: {exc}", "maximized": self._maximized}

    def close_window(self) -> dict[str, Any]:
        try:
            self._active_window().destroy()
            return {"ok": True}
        except Exception as exc:
            return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}

    def get_window_state(self) -> dict[str, Any]:
        return {"ok": True, "maximized": self._maximized}

    def start_window_drag(self) -> dict[str, Any]:
        if os.name != "nt":
            return {"ok": False, "error": "window drag bridge is only available on Windows"}
        try:
            import ctypes
            from ctypes import wintypes

            user32 = ctypes.windll.user32
            kernel32 = ctypes.windll.kernel32
            current_pid = kernel32.GetCurrentProcessId()
            found_hwnd = wintypes.HWND()
            enum_proc_type = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

            def enum_proc(hwnd: int, _lparam: int) -> bool:
                nonlocal found_hwnd
                if not user32.IsWindowVisible(hwnd):
                    return True
                pid = wintypes.DWORD()
                user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                if int(pid.value) != int(current_pid):
                    return True
                length = user32.GetWindowTextLengthW(hwnd)
                title = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, title, length + 1)
                if title.value == WINDOW_TITLE:
                    found_hwnd = wintypes.HWND(hwnd)
                    return False
                return True

            user32.EnumWindows(enum_proc_type(enum_proc), 0)
            if not found_hwnd.value:
                return {"ok": False, "error": "desktop window handle was not found"}
            user32.ReleaseCapture()
            user32.SendMessageW(found_hwnd, 0x00A1, 2, 0)
            return {"ok": True}
        except Exception as exc:
            return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


def _set_windows_app_id() -> None:
    """Group the window under our own taskbar identity instead of python.exe."""
    if os.name != "nt":
        return
    try:
        import ctypes

        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(f"{APP_NAME}.vNext.Desktop")
    except Exception:
        pass


def _apply_windows_window_icon(icon_path: str | None) -> None:
    if os.name != "nt" or not icon_path:
        return

    def worker() -> None:
        try:
            import ctypes
            from ctypes import wintypes

            user32 = ctypes.windll.user32
            kernel32 = ctypes.windll.kernel32
            current_pid = kernel32.GetCurrentProcessId()
            found_hwnd = wintypes.HWND()

            enum_proc_type = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

            def enum_proc(hwnd: int, _lparam: int) -> bool:
                nonlocal found_hwnd
                if not user32.IsWindowVisible(hwnd):
                    return True
                pid = wintypes.DWORD()
                user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                if int(pid.value) != int(current_pid):
                    return True
                length = user32.GetWindowTextLengthW(hwnd)
                title = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, title, length + 1)
                if title.value == WINDOW_TITLE:
                    found_hwnd = wintypes.HWND(hwnd)
                    return False
                return True

            for _ in range(40):
                user32.EnumWindows(enum_proc_type(enum_proc), 0)
                if found_hwnd.value:
                    image_icon = 1
                    lr_loadfromfile = 0x0010
                    lr_defaultsize = 0x0040
                    hicon = user32.LoadImageW(None, icon_path, image_icon, 0, 0, lr_loadfromfile | lr_defaultsize)
                    if hicon:
                        wm_seticon = 0x0080
                        user32.SendMessageW(found_hwnd, wm_seticon, 0, hicon)
                        user32.SendMessageW(found_hwnd, wm_seticon, 1, hicon)
                        if sys.maxsize > 2**32:
                            set_class_long = user32.SetClassLongPtrW
                        else:
                            set_class_long = user32.SetClassLongW
                        set_class_long(found_hwnd, -14, hicon)
                        set_class_long(found_hwnd, -34, hicon)
                    return
                time.sleep(0.25)
        except Exception:
            pass

    threading.Thread(target=worker, daemon=True).start()


def _cleanup_desktop_runtime(backend_server: Any, backend_thread: threading.Thread, cleanup_started: threading.Event) -> None:
    if cleanup_started.is_set():
        return
    cleanup_started.set()
    try:
        autocensor_server.set_desktop_window_controller(None)
    except Exception:
        pass
    try:
        autocensor_server.set_desktop_file_controller(None)
    except Exception:
        pass
    try:
        autocensor_server.shutdown_runtime(timeout=5)
    except Exception:
        pass
    try:
        backend_server.shutdown()
    except Exception:
        pass
    try:
        backend_server.server_close()
    except Exception:
        pass
    try:
        backend_thread.join(timeout=5)
    except RuntimeError:
        pass


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run AutoCensor in a native desktop window")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0, help="0 selects a free local port")
    parser.add_argument("--static-dir", default="dist", help="Built UI directory to serve")
    parser.add_argument("--width", type=int, default=1600)
    parser.add_argument("--height", type=int, default=920)
    parser.add_argument(
        "--profile-id",
        default=DEFAULT_PROFILE_ID,
        help="Stable per-user desktop profile for settings and WebView storage",
    )
    parser.add_argument(
        "--reset-profile",
        action="store_true",
        help="Clear this desktop profile before launch; useful for first-run verification",
    )
    args = parser.parse_args(argv)
    profile_id = _safe_profile_id(args.profile_id)

    static_dir = _resolve_static_dir(args.static_dir)
    if not (static_dir / "index.html").exists():
        print(
            f"Built UI not found at {static_dir}.\n"
            "Build it first with 'npm run build', then run this launcher again.",
            file=sys.stderr,
        )
        return 2

    try:
        import webview
    except ImportError:
        print(
            "The desktop window needs pywebview. Install the optional desktop extra with:\n"
            "    python -m pip install -r requirements-desktop.txt\n"
            "Or run the server directly and use AutoCensor as a local server.",
            file=sys.stderr,
        )
        return 3

    host = args.host
    port = args.port or _free_port(host)
    origin = f"http://{host}:{port}"
    if args.reset_profile:
        _reset_profile(profile_id)
    os.environ["AUTOCENSOR_APP_STORAGE_ID"] = profile_id

    backend_server = autocensor_server.create_http_server(host, port, str(static_dir), ROOT)
    backend_thread = threading.Thread(target=backend_server.serve_forever, daemon=True)
    backend_thread.start()
    cleanup_started = threading.Event()

    try:
        if not _wait_for_health(f"{origin}/api/health"):
            print("The local backend did not start. Check the console output above.", file=sys.stderr)
            return 4

        _set_windows_app_id()
        desktop_api = DesktopApi()
        def desktop_window_controller(action: str) -> dict[str, Any]:
            if action == "state":
                return {"ok": True, "desktop": True, "maximized": desktop_api._maximized}
            if action == "minimize":
                return desktop_api.minimize_window()
            if action == "toggle-maximize":
                return desktop_api.toggle_maximize_window()
            if action == "close":
                return desktop_api.close_window()
            if action == "drag":
                return desktop_api.start_window_drag()
            return {"ok": False, "error": "Unknown desktop window action"}

        autocensor_server.set_desktop_window_controller(desktop_window_controller)
        def desktop_file_controller(action: str, payload: dict[str, Any]) -> dict[str, Any]:
            if action == "pick-folder":
                return desktop_api.pick_folder(str(payload.get("initial_dir") or ""))
            if action == "pick-model-file":
                return desktop_api.pick_model_file(str(payload.get("initial_path") or ""))
            if action == "open-path":
                return desktop_api.open_path(str(payload.get("path") or ""))
            return {"ok": False, "error": "Unknown desktop file action", "path": ""}

        autocensor_server.set_desktop_file_controller(desktop_file_controller)
        window = webview.create_window(
            WINDOW_TITLE,
            url=f"{origin}/?desktop=1&v={int(time.time() * 1000)}",
            width=args.width,
            height=args.height,
            min_size=(1120, 680),
            js_api=desktop_api,
            frameless=True,
            easy_drag=False,
            shadow=True,
        )

        def cleanup_after_window_closed() -> None:
            # Give the WebView pagehide/localStorage flush a brief chance to run,
            # then close the local backend even if the GUI loop does not return.
            time.sleep(0.25)
            _cleanup_desktop_runtime(backend_server, backend_thread, cleanup_started)
            os._exit(0)

        window.events.closed += cleanup_after_window_closed

        # private_mode=False + a stable storage_path keep the UI's localStorage
        # (settings, shortcuts, theme) across restarts. Defaults would wipe them.
        start_kwargs = dict(private_mode=False, storage_path=str(_storage_path(profile_id)))
        icon = _icon_path()
        _apply_windows_window_icon(icon)
        try:
            webview.start(icon=icon, **start_kwargs) if icon else webview.start(**start_kwargs)
        except TypeError:
            # Older pywebview builds without the icon keyword; keep persistence.
            webview.start(**start_kwargs)
    finally:
        _cleanup_desktop_runtime(backend_server, backend_thread, cleanup_started)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
