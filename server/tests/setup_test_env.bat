@echo off
echo Setting up Python testing environment for Satoshigle...

REM Check if Python is installed
where python >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Python is not installed or not in PATH.
    echo Please install Python from https://www.python.org/downloads/
    exit /b 1
)

REM Create virtual environment if it doesn't exist
if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
) else (
    echo Virtual environment already exists.
)

REM Activate virtual environment
echo Activating virtual environment...
call venv\Scripts\activate.bat

REM Install dependencies
echo Installing dependencies...
pip install -r requirements.txt

echo.
echo =======================================================
echo Python test environment setup complete!
echo.
echo To run tests:
echo.
echo 1. Make sure the server is running: bun run dev
echo 2. Make sure the frontend is running
echo 3. Run: python simple_test.py
echo.
echo For basic connectivity test only: python simple_test.py --basic
echo For load testing: python simple_test.py --load 20 30
echo =======================================================
echo. 