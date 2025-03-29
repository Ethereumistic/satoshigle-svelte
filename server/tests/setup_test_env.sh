#!/bin/bash
echo "Setting up Python testing environment for Satoshigle..."

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "Python 3 is not installed or not in PATH."
    echo "Please install Python 3 from https://www.python.org/downloads/"
    exit 1
fi

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
else
    echo "Virtual environment already exists."
fi

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Install dependencies
echo "Installing dependencies..."
pip install -r requirements.txt

echo
echo "======================================================="
echo "Python test environment setup complete!"
echo
echo "To run tests:"
echo
echo "1. Make sure the server is running: bun run dev"
echo "2. Make sure the frontend is running"
echo "3. Run: python simple_test.py"
echo
echo "For basic connectivity test only: python simple_test.py --basic"
echo "For load testing: python simple_test.py --load 20 30"
echo "======================================================="
echo 