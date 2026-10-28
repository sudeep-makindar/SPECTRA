@echo off
setlocal
title SPECTRA setup
cd /d "%~dp0"
echo.
echo  SPECTRA setup - installs everything once (about 3 GB, 10-20 minutes).
echo  Do this at home on good Wi-Fi, not at the venue.
echo.

set "PY="
where py >nul 2>nul && py -3.12 -c "import sys" >nul 2>nul && set "PY=py -3.12"
if not defined PY (
  where python >nul 2>nul && set "PY=python"
)
if not defined PY (
  echo Python 3.12 is not installed. Get it from https://www.python.org/downloads/ and tick "Add python.exe to PATH", then run this again.
  pause
  exit /b 1
)
where node >nul 2>nul || (echo Node.js is not installed. Get the LTS version from https://nodejs.org/ and run this again. & pause & exit /b 1)
where nvidia-smi >nul 2>nul && (echo NVIDIA GPU found: & nvidia-smi --query-gpu=name,driver_version --format=csv,noheader) || echo WARNING: no NVIDIA driver found. SPECTRA would run on the CPU, slowly. Install the latest driver from nvidia.com.

echo.
echo [1/5] Creating the Python environment...
if not exist "backend\.venv\Scripts\python.exe" %PY% -m venv backend\.venv || goto :fail
set "VPY=backend\.venv\Scripts\python.exe"
"%VPY%" -m pip install --upgrade pip --quiet || goto :fail

echo [2/5] Installing PyTorch with NVIDIA CUDA support (large download)...
"%VPY%" -m pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu128 || goto :fail

echo [3/5] Installing SPECTRA's Python packages...
"%VPY%" -m pip install -r backend\requirements.txt || goto :fail

echo [4/5] Installing the dashboard (Node packages)...
pushd frontend
call npm install || (popd & goto :fail)
popd

echo [5/5] Downloading the AI models...
"%VPY%" scripts\prefetch_models.py || goto :fail

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo Created .env - put your GROQ_API_KEY in it for the AI assistant.
)

echo.
"%VPY%" -c "import torch; print('GPU ready:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'NO, running on the CPU')"
echo.
echo Setup finished. Double-click "Start SPECTRA.bat" to run it.
pause
exit /b 0

:fail
echo.
echo Setup stopped because a step failed. Scroll up to see the error, fix it, and run this again.
pause
exit /b 1
