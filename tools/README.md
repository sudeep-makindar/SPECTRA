# Connecting cameras and microphones

SPECTRA does all the AI on the computer it runs on. Every other device just
streams its picture and sound over your Wi-Fi, like a CCTV camera.

| Device | Gives SPECTRA | How |
|---|---|---|
| The SPECTRA computer | webcam + mic | **Devices → Add device → SPECTRA computer's webcam** |
| Android phone | camera + mic | Free **IP Webcam** app |
| Another laptop | webcam + mic | Double-click **Start SPECTRA camera** (this folder) |
| Any phone, no app | camera + mic + speaker | Scan a QR code in the browser |

Everything must be on **the same Wi-Fi** as the SPECTRA computer. If the venue
Wi-Fi blocks devices from seeing each other, put everything on a phone hotspot.

---

## Android phone: IP Webcam app (recommended)

1. Install **IP Webcam** (by Pavel Khlebovich) from the Play Store.
2. Optional, in its settings: *Video preferences → Video resolution* 640×480,
   and *Audio mode → Enabled*.
3. Scroll to the bottom and tap **Start server**. The screen shows an address
   like `http://192.168.1.23:8080`.
4. In SPECTRA: **Devices → Add device → Android phone → Camera and mic**,
   type `192.168.1.23`, pick a zone, **Connect**.

SPECTRA reads `http://<phone>:8080/video` (picture) and
`http://<phone>:8080/audio.wav` (sound). The app keeps streaming with the
screen off; plug the phone into a charger for long sessions.

## Another laptop: SPECTRA camera script

1. Copy this `tools` folder to the other laptop. It needs Python 3
   (https://www.python.org/downloads/; on Windows tick "Add to PATH").
2. Double-click **Start SPECTRA camera** (`.command` on macOS, `.bat` on
   Windows). The first run installs `opencv-python`, `sounddevice` and
   `numpy`. On a Mac, allow Terminal to use the camera and microphone.
3. The window prints the address, e.g. `192.168.1.30:8081`. Open
   `http://192.168.1.30:8081/` in a browser to check the picture.
4. In SPECTRA: **Devices → Add device → Another laptop → Camera and mic**,
   type that address, **Connect**.

Change the port by editing `PORT=` in the launcher, or run
`python3 spectra_camera.py --port 9000` (also `--camera 1`, `--no-audio`).
Keep the window open while it streams; close it to stop.

## Any phone, no app (iPhone, or a speaker)

1. On the SPECTRA computer, once per Wi-Fi network:
   `./scripts/make_https.sh --force`, then restart `make dev-frontend`.
2. **Devices → Add device → Any phone, no app → Camera, mic and speaker →
   Create pairing code**.
3. Scan the QR code, accept the certificate warning (Android: *Advanced →
   Proceed*; iPhone: *Show details → visit this website*), tap **Start**.
4. Keep the screen on and the page open.

This is also how a phone becomes a **speaker** for announcements.

## If a device won't connect

- Open its address in the SPECTRA computer's browser (`http://<ip>:8080/` for
  IP Webcam, `http://<ip>:8081/` for the script). If that page doesn't load,
  the devices can't see each other: same Wi-Fi? Try a phone hotspot.
- macOS asks whether Python may accept connections: click **Allow**.
- A device's IP can change when it reconnects to Wi-Fi. Delete it in
  SPECTRA and add it again with the new address.
