@echo off
rem このファイルは Shift-JIS (CP932) で保存すること。
rem UTF-8 で保存すると cmd が日本語を解釈できず、行が途中で切れる。
setlocal
cd /d "%~dp0"

rem SmartMemo をローカルで起動する
rem   start.bat        この PC のブラウザで開く
rem   start.bat host   同じ Wi-Fi のスマホからも開けるようにする

echo ==========================================
echo    SmartMemo
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 goto :no_node

if not exist "node_modules" goto :install
goto :launch

:install
echo 初回起動のため、必要なパッケージをインストールします。
echo 数分かかります。しばらくお待ちください。
echo.
call npm install
if errorlevel 1 goto :install_failed
echo.

:launch
set "EXTRA="
if /i "%~1"=="host" goto :launch_host
goto :run

rem host を付けたときだけ通る。このまま :run へ落ちる
:launch_host
set "EXTRA=--host"
echo スマホからも開けるモードで起動します。
echo 表示される Network の URL をスマホのブラウザで開いてください。
echo.

:run
echo 起動しています。ブラウザが自動で開きます。
echo 停止するには この画面で Ctrl+C を押してください。
echo.
call npm run dev -- --open %EXTRA%
echo.
echo 停止しました。
pause
exit /b 0

:no_node
echo [エラー] Node.js が見つかりません。
echo.
echo   https://nodejs.org/ から LTS 版をインストールしてから
echo   もう一度このファイルを実行してください。
echo.
pause
exit /b 1

:install_failed
echo.
echo [エラー] パッケージのインストールに失敗しました。
echo ネットワークにつながっているか確認してください。
echo.
pause
exit /b 1
