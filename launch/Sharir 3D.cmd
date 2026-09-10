@echo off
title Sharir 3D - Human Body
cd /d "%~dp0"

rem Prefer the py launcher, fall back to python on PATH.
where py >nul 2>&1 && (py -3 serve.py & goto :done)
where python >nul 2>&1 && (python serve.py & goto :done)

echo.
echo  Python was not found on this computer.
echo  Install it from https://python.org  (tick "Add to PATH"), then run this again.
echo.
pause
:done
