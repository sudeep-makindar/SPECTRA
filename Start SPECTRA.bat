@echo off
setlocal
cd /d "%~dp0"
if not exist "backend\.venv\Scripts\python.exe" (
  echo Run "Setup SPECTRA.bat" first.
  pause
  exit /b 1
)

start "SPECTRA backend (AI models)" /D "%~dp0backend" cmd /k ".venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000"
start "SPECTRA dashboard" /D "%~dp0frontend" cmd /k "npm run dev"

set "IP="
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL|VirtualBox|VMware' -and $_.IPAddress -notlike '169.*' } | Select-Object -First 1).IPAddress"`) do set "IP=%%i"

echo.
echo  SPECTRA is starting. The AI models take about 20 seconds to load.
echo.
echo    Dashboard on this laptop:    http://localhost:5173
echo    Dashboard on other devices:  http://%IP%:5173
echo    Address for camera scripts:  %IP%
echo.
echo  If Windows asks whether Python or Node.js may use the network, choose Allow (Private networks).
echo  To stop SPECTRA, close the two windows that just opened.
echo.
timeout /t 8 >nul
start "" http://localhost:5173
pause
