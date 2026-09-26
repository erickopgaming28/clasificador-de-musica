@echo off
setlocal
chcp 65001 >nul
title Clasificador de Musica
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] No se encontro Node.js. Instalalo desde https://nodejs.org y vuelve a abrir este archivo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Instalando dependencias por primera vez...
  call npm install
  if errorlevel 1 (
    echo [ERROR] Fallo npm install.
    pause
    exit /b 1
  )
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo.
  echo Se creo el archivo .env. Rellena SPOTIFY_CLIENT_ID ^(y opcionalmente ANTHROPIC_API_KEY^),
  echo guardalo y cierra el Bloc de notas para continuar.
  echo.
  notepad ".env"
)

set "PORT=8888"
for /f "tokens=1,* delims==" %%a in ('findstr /b "PORT=" ".env" 2^>nul') do if not "%%b"=="" set "PORT=%%b"

echo Abriendo http://127.0.0.1:%PORT% ...
start "" cmd /c "timeout /t 3 >nul & start http://127.0.0.1:%PORT%"

call npm start

echo.
echo La app se detuvo.
pause
