#!/bin/bash
# Double-click on macOS: streams this laptop's camera and mic for SPECTRA.
# Change the port by editing PORT below.
PORT=8081
cd "$(dirname "$0")"
if ! command -v python3 >/dev/null; then
  echo "Python 3 is needed. Install it from https://www.python.org/downloads/ and double-click this again."
  read -n 1 -s -r -p "Press any key to close."; exit 1
fi
if ! python3 -c "import cv2, sounddevice, numpy" 2>/dev/null; then
  echo "First run: installing opencv-python, sounddevice and numpy…"
  python3 -m pip install --user --quiet opencv-python sounddevice numpy || { read -n 1 -s -r -p "Install failed. Press any key to close."; exit 1; }
fi
python3 spectra_camera.py --port "$PORT"
