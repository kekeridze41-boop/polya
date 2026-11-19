@echo off
setlocal
set "PYTHONUTF8=1"
if defined POLYA_PYTHON (
  "%POLYA_PYTHON%" -B "%~dp0workbench.py" %*
  exit /b
)
set "COMFY_PYTHON=%LOCALAPPDATA%\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI\.venv\Scripts\python.exe"
if exist "%COMFY_PYTHON%" (
  "%COMFY_PYTHON%" -B "%~dp0workbench.py" %*
  exit /b
)
where py.exe >nul 2>nul
if not errorlevel 1 (
  py -3 -B "%~dp0workbench.py" %*
  exit /b
)
echo Set POLYA_PYTHON to the ComfyUI Desktop python.exe path.
exit /b 1
