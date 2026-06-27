@echo off
setlocal
cd /d "%~dp0\.."
npm run build || exit /b 1
python scripts\generate_app_icon.py || exit /b 1
python -m PyInstaller --noconfirm --clean --distpath "%CD%\dist_desktop" --workpath "%CD%\build\pyinstaller" AutoCensor.spec || exit /b 1
echo Desktop build written to: %CD%\dist_desktop\AutoCensor\AutoCensor.exe
