@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 没有找到 node，请直接双击 index.html 使用。
  echo.
  pause
  exit /b 1
)
node serve.mjs
pause
