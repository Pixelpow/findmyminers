@echo off
setlocal
set SCRIPT_DIR=%~dp0
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install-service.ps1" %*
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [ERROR] Installation du service echouee. Execute ce .cmd en tant qu'administrateur.
  pause
  exit /b %ERRORLEVEL%
)
echo.
echo [OK] Service installe.
pause
