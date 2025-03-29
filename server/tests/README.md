# Satoshigle Testing

This directory contains Python scripts for testing the Satoshigle WebRTC video chat application.

## Setup

### Create and activate virtual environment

```bash
# Windows
python -m venv venv
.\venv\Scripts\activate

# macOS/Linux
python3 -m venv venv
source venv/bin/activate
```

### Install dependencies

```bash
pip install -r requirements.txt
```

## Connection Testing (Recommended First Step)

If you're having issues with connectivity, the connection tester script provides detailed diagnostics:

```bash
# Activate virtual environment if not already activated
.\venv\Scripts\activate  # Windows
source venv/bin/activate  # macOS/Linux

# Run connection tester
python connection_tester.py

# Optional parameters
python connection_tester.py --host 192.168.0.1 --port 3001
```

The connection tester:
- Tests HTTP connectivity to server endpoints
- Tests raw WebSocket connectivity 
- Tests Socket.IO connectivity with multiple transport options
- Provides detailed error messages and troubleshooting steps

## Load and Functionality Testing

Make sure both the server and frontend are running before running these tests:

```bash
# In one terminal - start server
cd server
bun run dev

# In another terminal - start frontend
cd frontend
bun run dev
```

### Basic Connectivity Test

```bash
# Activate virtual environment if not already activated
.\venv\Scripts\activate  # Windows
source venv/bin/activate  # macOS/Linux

# Run basic test that only checks connectivity
python simple_test.py --basic
```

### Full Test with Matchmaking

```bash
# Test matchmaking with default 2 users
python simple_test.py
```

### Load Testing

```bash
# Load test with 50 users for 60 seconds
python simple_test.py --load 50 60
```

## Troubleshooting Connection Issues

### Socket.IO vs WebSocket

The Satoshigle server uses Socket.IO, which is not the same as raw WebSockets. If you see errors like:

```
WebSocket connection failed: WebSocketProtocolError - ...
```

Try the Socket.IO-specific test:

```bash
python simple_test_socketio.py
```

### Common Issues

1. **HTTP works but WebSocket fails**
   - Check that Socket.IO is properly configured on the server
   - Verify CORS settings allow WebSocket connections
   - Some networks/firewalls block WebSocket connections

2. **"Connection refused" errors**
   - Ensure the server is running on the specified port
   - Verify IP address/hostname is correct

3. **"Invalid status code" errors**
   - The server might not be handling WebSocket upgrade requests correctly
   - Check Socket.IO configuration on server

## Test Parameters

- `--basic`: Only test server connectivity and WebSocket connection
- `--load [users] [duration]`: Run load test with specified number of users for specified duration in seconds
- Default test runs matchmaking with 2 users

## Expected Results

- The script will output colored text indicating test progress
- Green checkmarks (✓) indicate successful operations
- Red X marks (✗) indicate failures
- Test will exit with code 0 on success, 1 on failure 