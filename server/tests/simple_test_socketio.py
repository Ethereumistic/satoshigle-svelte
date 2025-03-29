#!/usr/bin/env python3
import asyncio
import requests
import json
import sys
import traceback
import socketio

# Configuration
SERVER_URL = "http://localhost:3001"
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

async def test_socketio_connection():
    """Test Socket.IO connection to the server"""
    print("\n=== Testing Socket.IO Connection ===")
    
    # Create a Socket.IO client
    sio = socketio.AsyncClient(logger=False, engineio_logger=False)
    connected = False
    received_messages = []
    
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
    
    # Handle any event
    @sio.event
    def message(data):
        log_info(f"Received message: {data}")
        received_messages.append(data)
    
    try:
        # Try multiple configurations
        connection_configs = [
            # Default configuration
            {},
            # WebSocket only
            {'transports': ['websocket']},
            # Polling only
            {'transports': ['polling']},
            # Explicit path
            {'path': '/socket.io/'},
            # Path + websocket
            {'path': '/socket.io/', 'transports': ['websocket']},
        ]
        
        for i, config in enumerate(connection_configs):
            config_desc = f"{config}"
            log_info(f"Attempt {i+1}: Connecting with config {config_desc}...")
            
            try:
                await sio.connect(SERVER_URL, **config, wait_timeout=5)
                
                if connected:
                    log_success(f"Socket.IO connection successful with {config_desc}!")
                    
                    # Try to emit an event
                    log_info("Sending 'ping' event...")
                    await sio.emit("ping", {"message": "Hello from Python test"})
                    log_success("Event sent successfully")
                    
                    # Wait for any response
                    log_info("Waiting for response...")
                    await asyncio.sleep(2)
                    
                    if received_messages:
                        log_success(f"Received {len(received_messages)} message(s)")
                    else:
                        log_warning("No messages received")
                    
                    # Try to send start-search event
                    log_info("Sending 'start-search' event...")
                    await sio.emit("start-search")
                    log_success("Start search event sent")
                    
                    # Wait for potential match
                    log_info("Waiting for potential events...")
                    await asyncio.sleep(5)
                    
                    # Disconnect
                    await sio.disconnect()
                    return True
                
                # Make sure to disconnect before trying next config
                if sio.connected:
                    await sio.disconnect()
                    connected = False
                
            except Exception as e:
                log_error(f"Connection failed with {config_desc}: {str(e)}")
                
                # Make sure to disconnect before trying next config
                if sio.connected:
                    await sio.disconnect()
                    connected = False
            
            # Wait between attempts
            await asyncio.sleep(1)
        
        log_error("All connection attempts failed")
        return False
    except Exception as e:
        log_error(f"Socket.IO error: {type(e).__name__} - {e}")
        traceback.print_exc()
        return False

async def main():
    """Main test execution function"""
    print("\n" + "="*50)
    print(f"{BLUE}SATOSHIGLE SOCKET.IO TEST{ENDC}")
    print("="*50 + "\n")
    
    # Check if server is running via HTTP
    server_ok = check_server()
    if not server_ok:
        log_error("Server HTTP check failed. Make sure the server is running at " + SERVER_URL)
        return 1
    
    # Test Socket.IO connection
    socketio_ok = await test_socketio_connection()
    if not socketio_ok:
        log_error("Socket.IO connection failed. Troubleshooting steps:")
        log_info("1. Check that the server is running")
        log_info("2. Make sure Socket.IO is configured correctly on the server")
        log_info("3. Verify there are no firewalls blocking connections")
        log_info("4. Add 'aiohttp' to your requirements.txt and reinstall")
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