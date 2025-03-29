#!/usr/bin/env python3
import asyncio
import websockets
import requests
import json
import sys
import traceback

# Configuration
SERVER_URL = "http://localhost:3001"
WS_URL = "ws://localhost:3001"
CLIENT_URL = "http://localhost:5173"

# Colors for terminal output
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
ENDC = "\033[0m"

def log_success(msg):
    print(f"{GREEN}✓ {msg}{ENDC}")

def log_error(msg):
    print(f"{RED}✗ {msg}{ENDC}")

def log_info(msg):
    print(f"{BLUE}ℹ {msg}{ENDC}")

def log_warning(msg):
    print(f"{YELLOW}⚠ {msg}{ENDC}")

def check_server():
    """Check if the server is running and responding to HTTP requests"""
    print("\n=== Testing HTTP Server Connection ===")
    try:
        log_info(f"Connecting to {SERVER_URL}/health...")
        response = requests.get(f"{SERVER_URL}/health", timeout=5)
        
        if response.status_code == 200:
            log_success(f"Server is running: {response.json()}")
            return True
        else:
            log_error(f"Server responded with status code {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        log_error(f"Server connection failed: {e}")
        return False

async def test_simple_websocket():
    """Simple WebSocket connection test with more detailed error reporting"""
    print("\n=== Testing WebSocket Connection ===")
    try:
        log_info(f"Attempting to connect to WebSocket at {WS_URL}...")
        
        # Connecting with detailed debug
        async with websockets.connect(WS_URL, ping_interval=None, close_timeout=2) as websocket:
            log_success("WebSocket connection established!")
            
            # Get connection details
            local_addr = websocket.local_address
            remote_addr = websocket.remote_address
            log_info(f"Local address: {local_addr}, Remote address: {remote_addr}")
            
            # Try sending a simple message
            log_info("Sending ping message...")
            await websocket.send(json.dumps({"type": "ping"}))
            log_success("Message sent successfully")
            
            # Try receiving a response
            log_info("Waiting for response...")
            try:
                response = await asyncio.wait_for(websocket.recv(), timeout=3)
                log_success(f"Received response: {response}")
            except asyncio.TimeoutError:
                log_warning("No response received after 3 seconds (timeout)")
            
            # Test successful since we connected
            return True
    except websockets.exceptions.WebSocketException as e:
        log_error(f"WebSocket connection failed: {type(e).__name__} - {e}")
        return False
    except Exception as e:
        log_error(f"Unexpected error: {type(e).__name__} - {e}")
        traceback.print_exc()
        return False

async def main():
    """Main test execution function"""
    print("\n" + "="*50)
    print(f"{BLUE}SATOSHIGLE SERVER CONNECTIVITY TEST{ENDC}")
    print("="*50 + "\n")
    
    # Check if server is running via HTTP
    server_ok = check_server()
    if not server_ok:
        log_error("Server HTTP check failed. Make sure the server is running at " + SERVER_URL)
        return 1
    
    # Test WebSocket connection
    ws_ok = await test_simple_websocket()
    if not ws_ok:
        log_error("WebSocket connection failed. Troubleshooting steps:")
        log_info("1. Check that the server is running")
        log_info("2. Ensure your server has a WebSocket endpoint set up")
        log_info("3. Verify there are no firewalls blocking WebSocket connections")
        log_info("4. Check that Socket.IO is configured correctly on the server")
        return 1
    
    log_success("All connectivity tests passed!")
    return 0

if __name__ == "__main__":
    # Handle keyboard interrupts gracefully
    try:
        exit_code = asyncio.run(main())
        sys.exit(exit_code)
    except KeyboardInterrupt:
        log_warning("\nTest interrupted by user")
        sys.exit(1) 