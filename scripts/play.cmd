@echo off
setlocal
set "PORT=8080"
if not "%~1"=="" set "PORT=%~1"

echo(%PORT%| findstr /R "^[0-9][0-9]*$" >nul
if errorlevel 1 (
  echo Daily Red: Port must be a number from 1 to 65535. Try: scripts\play.cmd 8080 1>&2
  exit /b 1
)
if %PORT% LSS 1 (
  echo Daily Red: Port must be a number from 1 to 65535. Try: scripts\play.cmd 8080 1>&2
  exit /b 1
)
if %PORT% GTR 65535 (
  echo Daily Red: Port must be a number from 1 to 65535. Try: scripts\play.cmd 8080 1>&2
  exit /b 1
)

if not exist "%~dp0..\Dockerfile" (
  echo Daily Red: Dockerfile is missing. Use a complete Daily Red checkout. 1>&2
  exit /b 1
)
if not exist "%~dp0..\patches\pokefirered-dailyred.patch" (
  echo Daily Red: The FireRed patch is missing. Use a complete Daily Red checkout. 1>&2
  exit /b 1
)
if not exist "%~dp0..\web\index.html" (
  echo Daily Red: web\index.html is missing. Use a complete Daily Red checkout. 1>&2
  exit /b 1
)

where docker >nul 2>nul
if errorlevel 1 (
  echo Daily Red: Docker is missing. Install Docker Desktop: https://docs.docker.com/desktop/setup/install/windows-install/ 1>&2
  exit /b 1
)

docker version --format "{{.Server.Version}}" >nul 2>nul
if errorlevel 1 (
  echo Daily Red: Docker is installed but its engine is unavailable. Start Docker Desktop, then run: docker version 1>&2
  exit /b 1
)
set "DOCKER_OS="
for /f "delims=" %%A in ('docker info --format "{{.OSType}}"') do set "DOCKER_OS=%%A"
if /I not "%DOCKER_OS%"=="linux" (
  echo Daily Red: A Linux Docker engine is required. Switch Docker Desktop to Linux containers, then run: docker info --format "{{.OSType}}" 1>&2
  exit /b 1
)

docker build --progress=quiet -t dailyred:local "%~dp0.."
if errorlevel 1 (
  echo Daily Red: Image build failed. Check the Docker error above, internet access, and free disk space. 1>&2
  echo For a detailed log, run: docker build --progress=plain -t dailyred:local "%~dp0.." 1>&2
  exit /b 1
)

echo Open http://localhost:%PORT% and press Play. Press Ctrl+C here to stop the server.
set /a NEXT_PORT=PORT+1 >nul
if %PORT% GEQ 65535 set "NEXT_PORT=8080"
docker run --rm -p "127.0.0.1:%PORT%:8080" dailyred:local
if errorlevel 1 (
  echo Daily Red: Docker exited with an error. If you did not stop the game, check the error above. 1>&2
  echo If port %PORT% is unavailable, try: "%~f0" %NEXT_PORT% 1>&2
  exit /b 1
)
exit /b %errorlevel%
