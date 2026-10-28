@echo off
rem Double-click on Windows: streams this laptop's camera and mic for SPECTRA.
rem Change the port by editing PORT below.
set PORT=8081
cd /d "%~dp0"
where python >nul 2>nul || (echo Python 3 is needed. Install it from https://www.python.org/downloads/ ^(tick "Add to PATH"^) and run this again. & pause & exit /b 1)
python -c "import cv2, sounddevice, numpy" 2>nul || (echo First run: installing opencv-python, sounddevice and numpy... & python -m pip install --user --quiet opencv-python sounddevice numpy || (echo Install failed. & pause & exit /b 1))
python spectra_camera.py --port %PORT%
pause
