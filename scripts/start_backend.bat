@echo off
setlocal
set ROOT=%~dp0..
where python >nul 2>nul
if %errorlevel%==0 (
  python "%ROOT%\backend\autocensor_server.py" --host 127.0.0.1 --port 8765 --static-dir "%ROOT%\dist"
  exit /b %errorlevel%
)

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 "%ROOT%\backend\autocensor_server.py" --host 127.0.0.1 --port 8765 --static-dir "%ROOT%\dist"
  exit /b %errorlevel%
)

echo Python 3 was not found. Install Python 3.10+ and enable PATH, or install the Windows py launcher.
exit /b 1
