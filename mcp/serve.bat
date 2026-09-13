@echo off
REM serve.bat -- keep the MCP server up.
REM
REM Launched by serve.vbs, which is launched by the MagmaCrunchBotFarmMCP
REM scheduled task. The loop is here rather than in the task's own restart
REM settings for the same reason ollama-serve.bat loops: wscript exits the
REM moment it spawns this, so the task reads Ready and its restart rules never
REM fire. If node dies, this brings it back.
REM
REM Defaults to loopback. Set BOT_FARM_MCP_HOST to the tailnet address to serve
REM the tailnet directly -- and then a token is required, which is the point.

setlocal enabledelayedexpansion

if "%BOT_FARM_MCP_HOST%"=="" set "BOT_FARM_MCP_HOST=127.0.0.1"
if "%BOT_FARM_MCP_PORT%"=="" set "BOT_FARM_MCP_PORT=8787"

set "LOGDIR=%APPDATA%\com.magmacrunch.bot-farm"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set "LOG=%LOGDIR%\mcp.log"

:loop
echo [%DATE% %TIME%] starting on %BOT_FARM_MCP_HOST%:%BOT_FARM_MCP_PORT% >> "%LOG%"
node "%~dp0server.mjs" --http --host %BOT_FARM_MCP_HOST% --port %BOT_FARM_MCP_PORT% >> "%LOG%" 2>&1
echo [%DATE% %TIME%] exited with %ERRORLEVEL%, retrying in 10s >> "%LOG%"
timeout /t 10 /nobreak > nul
goto loop
