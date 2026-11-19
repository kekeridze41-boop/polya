@echo off
setlocal
set "PYTHONUTF8=1"
if defined POLYA_PYTHON (
  "%POLYA_PYTHON%" -B "%~dp0preview.py" %*
  exit /b
)
set "COMFY_PYTHON=%LOCALAPPDATA%\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI\.venv\Scripts\python.exe"
if exist "%COMFY_PYTHON%" (
  "%COMFY_PYTHON%" -B "%~dp0preview.py" %*
  exit /b
)
py -3 -B "%~dp0preview.py" %*
