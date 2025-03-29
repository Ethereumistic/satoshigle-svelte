#!/usr/bin/env python3
"""
Satoshigle Connection Tester
============================
This script tries multiple ways to connect to the Satoshigle server
to help diagnose connection issues.
"""

import asyncio
import sys
import os
import requests
import json
import traceback
import argparse
from urllib.parse import urlparse

# Conditionally import libraries (to avoid errors if not installed)
try:
    import websockets
    WEBSOCKETS_AVAILABLE = True
except ImportError:
    WEBSOCKETS_AVAILABLE = False

try:
    import socketio
    SOCKETIO_AVAILABLE = True
except ImportError:
    SOCKETIO_AVAILABLE = False

# Configuration with defaults
DEFAULT_HOST = "localhost"
DEFAULT_PORT = 3001
DEFAULT_CLIENT_PORT = 5173
DEFAULT_PROTOCOL = "http"

# Colors for terminal output
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
BOLD = "\033[1m"
ENDC = "\033[0m"

def log_success(msg):
    print(f"{GREEN}✓ {msg}{ENDC}")

def log_error(msg):
    print(f"{RED}✗ {msg}{ENDC}")

def log_info(msg):
    print(f"{BLUE}ℹ {msg}{ENDC}")

def log_warning(msg):
    print(f"{YELLOW}⚠ {msg}{ENDC}")

def log_section(msg):
    print(f"\n{BOLD}=== {msg} ==={ENDC}")

def parse_args():
    """Parse command line arguments"""
    parser = argparse.ArgumentParser(
        description="Test connectivity to Satoshigle server using various methods"
    )
    
    parser.add_argument(
        "--host", 
        default=DEFAULT_HOST,
        help=f"Server hostname (default: {DEFAULT_HOST})"
    )
    
    parser.add_argument(
        "--port", 
        type=int, 
        default=DEFAULT_PORT,
        help=f"Server port (default: {DEFAULT_PORT})"
    )
    
    parser.add_argument(
        "--client-port", 
        type=int, 
        default=DEFAULT_CLIENT_PORT,
        help=f"Client/frontend port (default: {DEFAULT_CLIENT_PORT})"
    )
    
    parser.add_argument(
        "--protocol", 
        choices=["http", "https"], 
        default=DEFAULT_PROTOCOL,
        help=f"Protocol to use (default: {DEFAULT_PROTOCOL})"
    )
    
    parser.add_argument(
        "--skip-http", 
        action="store_true",
        help="Skip HTTP connection tests"
    )
    
    parser.add_argument(
        "--skip-ws", 
        action="store_true",
        help="Skip WebSocket connection tests"
    )
    
    parser.add_argument(
        "--skip-socketio", 
        action="store_true",
        help="Skip Socket.IO connection tests"
    )
    
    return parser.parse_args()

async def test_http_connection(base_url):
    """Test HTTP connectivity to the server"""
    log_section("HTTP Connectivity Test")
    
    endpoints = [
        "/",
        "/health",
    ]
    
    success_count = 0
    
    for endpoint in endpoints:
        url = f"{base_url}{endpoint}"
        try:
            log_info(f"Requesting {url}...")
            response = requests.get(url, timeout=5)
            
            if response.status_code == 200:
                log_success(f"Endpoint {endpoint} responded with status {response.status_code}")
                try:
                    json_data = response.json()
                    log_info(f"Response: {json_data}")
                except:
                    log_info(f"Response (text): {response.text[:100]}")
                
                success_count += 1
            else:
                log_error(f"Endpoint {endpoint} responded with status {response.status_code}")
        except requests.exceptions.RequestException as e:
            log_error(f"Request to {endpoint} failed: {e}")
    
    return success_count > 0

async def test_raw_websocket(ws_url):
    """Test raw WebSocket connectivity"""
    if not WEBSOCKETS_AVAILABLE:
        log_error("websockets package not installed. Install with: pip install websockets")
        return False
    
    log_section("Raw WebSocket Connectivity Test")
    log_info(f"Connecting to WebSocket at {ws_url}...")
    
    try:
        async with websockets.connect(ws_url, ping_interval=None, close_timeout=5) as websocket:
            log_success("WebSocket connection established!")
            
            # Check if we can send a message
            log_info("Sending test message...")
            test_message = json.dumps({"type": "test", "message": "Hello from Python"})
            await websocket.send(test_message)
            log_success("Message sent")
            
            # Try to receive a response
            log_info("Waiting for response (3 sec)...")
            try:
                response = await asyncio.wait_for(websocket.recv(), timeout=3)
                log_success(f"Received response: {response}")
            except asyncio.TimeoutError:
                log_warning("No response received (timeout) - this may be normal")
                
            return True
    except Exception as e:
        log_error(f"WebSocket connection failed: {type(e).__name__} - {e}")
        return False

async def test_socketio_connection(base_url):
    """Test Socket.IO connectivity"""
    if not SOCKETIO_AVAILABLE:
        log_error("python-socketio package not installed. Install with: pip install python-socketio[client]")
        return False
    
    log_section("Socket.IO Connectivity Test")
    log_info(f"Initializing Socket.IO client for {base_url}...")
    
    sio = socketio.AsyncClient(logger=True, engineio_logger=True)
    connected = False
    
    @sio.event
    async def connect():
        nonlocal connected
        connected = True
        log_success("Socket.IO connected!")
    
    @sio.event
    async def connect_error(data):
        log_error(f"Socket.IO connection error: {data}")
    
    @sio.event
    async def disconnect():
        log_info("Socket.IO disconnected")
    
    # Generic event handler
    @sio.on('*')
    def catch_all(event, data):
        log_info(f"Received event: {event}, data: {data}")
    
    # Try different transport configurations
    transport_configs = [
        {'transports': ['websocket']},
        {'transports': ['polling', 'websocket']},
        {}  # Default configuration
    ]
    
    for i, config in enumerate(transport_configs):
        try:
            transport_desc = config.get('transports', ['polling', 'websocket'])
            log_info(f"Attempt {i+1}: Connecting with transports {transport_desc}...")
            
            try:
                await sio.connect(base_url, **config, wait_timeout=5)
                
                # If we connected, try sending a message
                if connected:
                    log_info("Sending 'ping' event...")
                    await sio.emit('ping', {'data': 'Ping from Python tester'})
                    
                    # Wait a bit for any response
                    await asyncio.sleep(3)
                    await sio.disconnect()
                    
                    log_success(f"Socket.IO connection successful with {transport_desc}")
                    return True
            except socketio.exceptions.ConnectionError as e:
                log_error(f"Connection failed with {transport_desc}: {e}")
            
            # Make sure we're disconnected before trying the next option
            if sio.connected:
                await sio.disconnect()
                connected = False
                
            # Wait a moment before next attempt
            await asyncio.sleep(1)
            
        except Exception as e:
            log_error(f"Socket.IO error: {type(e).__name__} - {e}")
            traceback.print_exc()
    
    log_error("All Socket.IO connection attempts failed")
    return False

async def main():
    """Main function to run all tests"""
    args = parse_args()
    
    # Construct URLs
    server_base_url = f"{args.protocol}://{args.host}:{args.port}"
    client_base_url = f"{args.protocol}://{args.host}:{args.client_port}"
    ws_url = f"ws://{args.host}:{args.port}"
    
    print("\n" + "="*60)
    print(f"{BOLD}{BLUE}SATOSHIGLE SERVER CONNECTION TESTER{ENDC}")
    print("="*60)
    print(f"\nTesting connection to server at: {server_base_url}")
    print(f"Frontend URL: {client_base_url}")
    print("="*60 + "\n")
    
    results = {}
    
    # HTTP Connectivity Test
    if not args.skip_http:
        results['http'] = await test_http_connection(server_base_url)
    else:
        log_info("Skipping HTTP tests")
    
    # WebSocket Connectivity Test
    if not args.skip_ws:
        results['websocket'] = await test_raw_websocket(ws_url)
    else:
        log_info("Skipping WebSocket tests")
    
    # Socket.IO Connectivity Test
    if not args.skip_socketio:
        results['socketio'] = await test_socketio_connection(server_base_url)
    else:
        log_info("Skipping Socket.IO tests")
    
    # Summary
    log_section("Test Results Summary")
    
    for test_name, success in results.items():
        if success:
            log_success(f"{test_name.upper()} Connectivity: PASS")
        else:
            log_error(f"{test_name.upper()} Connectivity: FAIL")
    
    all_passed = all(results.values())
    
    if all_passed:
        log_success("\nAll tests passed! Your server appears to be correctly configured.")
        return 0
    else:
        if 'http' in results and results['http']:
            log_info("\nHTTP connectivity works but WebSocket/Socket.IO failed.")
            log_info("Troubleshooting steps:")
            log_info("1. Check that Socket.IO is configured correctly on your server")
            log_info("2. Verify CORS settings on your server allow WebSocket connections")
            log_info("3. Check for firewalls blocking WebSocket connections")
            log_info("4. Ensure Socket.IO is listening on the correct path/endpoint")
        else:
            log_error("\nServer appears to be unreachable or not running correctly.")
            log_info("Basic troubleshooting steps:")
            log_info("1. Check that your server is running")
            log_info("2. Verify the host and port settings")
            log_info("3. Check your network/firewall settings")
        
        return 1

if __name__ == "__main__":
    try:
        exit_code = asyncio.run(main())
        sys.exit(exit_code)
    except KeyboardInterrupt:
        log_warning("\nTest interrupted by user")
        sys.exit(1) 