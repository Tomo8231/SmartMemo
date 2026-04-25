@echo off
rem Start a local HTTP server on this folder so a phone on the same Wi-Fi can open SmartMemo.
rem Tries python first (most common), falls back to a tiny PowerShell HTTP server.

setlocal
set PORT=8000

rem Find a non-loopback IPv4 address
for /f "tokens=2 delims=:" %%I in ('powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.PrefixOrigin -ne 'WellKnown' } ^| Select-Object -First 1).IPAddress"') do set LANIP=%%I
if "%LANIP%"=="" set LANIP=localhost

echo.
echo ============================================================
echo   SmartMemo local server
echo ============================================================
echo   On your phone (same Wi-Fi), open:
echo     http://%LANIP%:%PORT%/SmartMemo.html
echo.
echo   Press Ctrl+C to stop.
echo ============================================================
echo.

where python >nul 2>nul
if %ERRORLEVEL%==0 (
  python -m http.server %PORT% --bind 0.0.0.0
  goto :eof
)

where py >nul 2>nul
if %ERRORLEVEL%==0 (
  py -m http.server %PORT% --bind 0.0.0.0
  goto :eof
)

rem Fallback: PowerShell HttpListener
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-server.ps1" %PORT%
