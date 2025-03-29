#!/usr/bin/env python3
import asyncio
import websockets
import requests
import json
import random
import time
import sys
import uuid
import os

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
    try:
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

def check_frontend():
    """Check if the frontend is running"""
    try:
        response = requests.get(CLIENT_URL, timeout=5)
        if response.status_code == 200:
            log_success("Frontend is running")
            return True
        else:
            log_error(f"Frontend responded with status code {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        log_error(f"Frontend connection failed: {e}")
        return False

async def test_websocket_connection():
    """Test basic WebSocket connection to the server"""
    try:
        log_info("Connecting to WebSocket...")
        async with websockets.connect(WS_URL, timeout=5) as websocket:
            log_success("WebSocket connection established")
            
            # Send a ping to keep the connection open briefly
            await websocket.send(json.dumps({"type": "ping"}))
            log_info("Ping sent")
            
            # Try to receive any response
            try:
                response = await asyncio.wait_for(websocket.recv(), timeout=2)
                log_info(f"Received: {response}")
            except asyncio.TimeoutError:
                log_warning("No response received (timeout)")
                
            return True
    except Exception as e:
        log_error(f"WebSocket connection failed: {e}")
        return False

async def test_matchmaking(num_users=2, timeout=30):
    """
    Simulate multiple users connecting and testing the matchmaking
    
    Args:
        num_users: Number of users to simulate
        timeout: Maximum time (seconds) to wait for matchmaking
    """
    if num_users < 2:
        log_error("Need at least 2 users to test matchmaking")
        return False
    
    log_info(f"Testing matchmaking with {num_users} users (timeout: {timeout}s)")
    
    user_sessions = []
    matched_users = set()
    
    async def user_session(user_id):
        try:
            async with websockets.connect(WS_URL, timeout=5) as websocket:
                log_info(f"User {user_id}: Connected")
                
                # Start searching
                await websocket.send(json.dumps({"type": "start-search"}))
                log_info(f"User {user_id}: Started searching")
                
                # Wait for match
                start_time = time.time()
                
                while time.time() - start_time < timeout:
                    try:
                        response = await asyncio.wait_for(websocket.recv(), timeout=1)
                        data = json.loads(response)
                        
                        if data.get("type") == "match-ready":
                            room_id = data.get("roomId")
                            log_success(f"User {user_id}: Matched in room {room_id}")
                            matched_users.add(user_id)
                            
                            # Send acknowledgement
                            await websocket.send(json.dumps({
                                "type": "match-ready",
                                "matchId": room_id
                            }))
                            
                            # Send fake WebRTC signaling
                            await websocket.send(json.dumps({
                                "type": "signal",
                                "roomId": room_id,
                                "description": {
                                    "type": "offer",
                                    "sdp": f"v=0\r\no=- {int(time.time())} 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\n"
                                }
                            }))
                            
                            # Wait a bit longer to see if we receive signaling data
                            try:
                                signal_data = await asyncio.wait_for(websocket.recv(), timeout=3)
                                log_info(f"User {user_id}: Received signaling data")
                            except asyncio.TimeoutError:
                                log_warning(f"User {user_id}: No signaling data received")
                            
                            # Success, we don't need to wait more
                            return True
                        elif data.get("type") == "waiting-for-peer":
                            log_info(f"User {user_id}: Waiting for peer")
                    except asyncio.TimeoutError:
                        # No message received, continue waiting
                        pass
                
                # Timeout reached without match
                log_warning(f"User {user_id}: Timeout waiting for match")
                return False
                
        except Exception as e:
            log_error(f"User {user_id}: Error - {e}")
            return False
    
    # Create tasks for all users
    for i in range(num_users):
        user_task = asyncio.create_task(user_session(i))
        user_sessions.append(user_task)
    
    # Wait for all users to finish
    results = await asyncio.gather(*user_sessions)
    
    # Calculate success rate
    success_count = sum(1 for r in results if r)
    log_info(f"Matchmaking success rate: {success_count}/{num_users} ({success_count/num_users*100:.1f}%)")
    log_info(f"Users matched: {len(matched_users)}/{num_users}")
    
    return success_count > 0

async def test_load(num_users=10, ramp_up_time=5, test_duration=30):
    """
    Simulate load on the server with many concurrent users
    
    Args:
        num_users: Number of users to simulate
        ramp_up_time: Time in seconds to add all users
        test_duration: Total test duration in seconds
    """
    log_info(f"Starting load test with {num_users} users over {test_duration}s")
    
    active_tasks = []
    user_stats = {
        "connected": 0,
        "matched": 0,
        "errors": 0
    }
    
    async def simulate_user(user_id):
        try:
            # Connect to WebSocket
            async with websockets.connect(WS_URL, timeout=5) as websocket:
                user_stats["connected"] += 1
                log_info(f"User {user_id}: Connected")
                
                # Start searching
                await websocket.send(json.dumps({"type": "start-search"}))
                
                # Random session length between 5-15 seconds
                session_length = random.uniform(5, 15)
                start_time = time.time()
                matched = False
                
                while time.time() - start_time < session_length:
                    try:
                        response = await asyncio.wait_for(websocket.recv(), timeout=1)
                        data = json.loads(response)
                        
                        if data.get("type") == "match-ready":
                            room_id = data.get("roomId")
                            log_success(f"User {user_id}: Matched in room {room_id}")
                            matched = True
                            user_stats["matched"] += 1
                            
                            # Send acknowledgement and fake WebRTC signaling
                            await websocket.send(json.dumps({
                                "type": "match-ready",
                                "matchId": room_id
                            }))
                            
                            # Add some delay to simulate session
                            await asyncio.sleep(random.uniform(1, 3))
                            
                            # 50% chance to skip, 50% to just disconnect
                            if random.random() > 0.5:
                                await websocket.send(json.dumps({"type": "skip"}))
                                log_info(f"User {user_id}: Skipped partner")
                                
                                # New session after skip
                                session_length = time.time() + random.uniform(3, 8) - start_time
                                matched = False
                    except asyncio.TimeoutError:
                        # No message received, continue
                        pass
                
                # Session ended
                log_info(f"User {user_id}: Session ended")
        except Exception as e:
            user_stats["errors"] += 1
            log_error(f"User {user_id}: Error - {e}")
    
    # Start users gradually
    users_per_step = max(1, num_users // 10)
    step_time = ramp_up_time / (num_users / users_per_step)
    
    for batch in range(0, num_users, users_per_step):
        batch_size = min(users_per_step, num_users - batch)
        log_info(f"Starting batch of {batch_size} users (total: {batch}/{num_users})")
        
        for i in range(batch_size):
            user_id = batch + i
            task = asyncio.create_task(simulate_user(user_id))
            active_tasks.append(task)
        
        # Wait before next batch
        if batch + users_per_step < num_users:
            await asyncio.sleep(step_time)
    
    # Wait for the test duration
    remaining_time = max(0, test_duration - ramp_up_time)
    if remaining_time > 0:
        log_info(f"All users started. Continuing test for {remaining_time}s")
        await asyncio.sleep(remaining_time)
    
    # Show results
    log_success(f"Load test completed: {num_users} users")
    log_info(f"Connected users: {user_stats['connected']}/{num_users}")
    log_info(f"Matched users: {user_stats['matched']}")
    log_info(f"Errors: {user_stats['errors']}")
    
    return user_stats["errors"] == 0

async def main():
    """Main test execution function"""
    print("\n" + "="*50)
    print(f"{BLUE}SATOSHIGLE SERVER TEST{ENDC}")
    print("="*50 + "\n")
    
    log_info("Checking server and frontend status...")
    
    # Check if server is running
    server_ok = check_server()
    if not server_ok:
        log_error("Server check failed. Make sure the server is running.")
        return 1
    
    # Check if frontend is running
    frontend_ok = check_frontend()
    if not frontend_ok:
        log_warning("Frontend check failed. Some tests may fail if frontend is required.")
    
    # Basic WebSocket test
    log_info("\nTesting WebSocket connection...")
    ws_ok = await test_websocket_connection()
    if not ws_ok:
        log_error("WebSocket connection failed. Cannot continue with further tests.")
        return 1
    
    # Check command line arguments
    if len(sys.argv) > 1 and sys.argv[1] == "--basic":
        log_info("Basic checks passed. Exiting as requested.")
        return 0
    
    # Matchmaking test
    log_info("\nTesting matchmaking...")
    matchmaking_ok = await test_matchmaking(num_users=2, timeout=30)
    if matchmaking_ok:
        log_success("Matchmaking test successful!")
    else:
        log_warning("Matchmaking test failed. Continuing with other tests...")
    
    # Simple load test
    if len(sys.argv) > 1 and sys.argv[1] == "--load":
        users = int(sys.argv[2]) if len(sys.argv) > 2 else 10
        duration = int(sys.argv[3]) if len(sys.argv) > 3 else 30
        
        log_info(f"\nRunning load test with {users} users for {duration} seconds...")
        load_ok = await test_load(num_users=users, ramp_up_time=min(10, duration/3), test_duration=duration)
        if load_ok:
            log_success("Load test completed successfully!")
        else:
            log_warning("Load test completed with some errors.")
    
    print("\n" + "="*50)
    log_success("All tests completed!")
    print("="*50 + "\n")
    return 0

if __name__ == "__main__":
    # Handle keyboard interrupts gracefully
    try:
        exit_code = asyncio.run(main())
        sys.exit(exit_code)
    except KeyboardInterrupt:
        log_warning("\nTest interrupted by user")
        sys.exit(1) 