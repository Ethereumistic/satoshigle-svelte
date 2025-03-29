#!/usr/bin/env python3
import asyncio
import socketio
import time
import uuid
import random
from datetime import datetime

# Configuration
SERVER_URL = "http://localhost:3001"

# Colors for terminal output
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
CYAN = "\033[96m"
MAGENTA = "\033[95m"
ENDC = "\033[0m"

def log_success(msg):
    print(f"{GREEN}✓ {msg}{ENDC}")

def log_error(msg):
    print(f"{RED}✗ {msg}{ENDC}")

def log_info(msg):
    print(f"{BLUE}ℹ {msg}{ENDC}")

def log_warning(msg):
    print(f"{YELLOW}⚠ {msg}{ENDC}")

def log_special(msg):
    print(f"{MAGENTA}• {msg}{ENDC}")

def log_highlight(msg):
    print(f"{CYAN}➤ {msg}{ENDC}")

def timestamp():
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]

class TestUser:
    def __init__(self, user_id):
        self.id = user_id
        self.sio = socketio.AsyncClient(logger=False)
        self.connected = False
        self.waiting = False
        self.matched = False
        self.matched_with = None
        self.room_id = None
        self.is_initiator = False
        self.events = []
        
        # Set up event handlers
        @self.sio.event
        async def connect():
            self.connected = True
            log_success(f"[{self.id}] Connected to server")
        
        @self.sio.event
        async def disconnect():
            self.connected = False
            log_info(f"[{self.id}] Disconnected from server")
        
        @self.sio.event
        async def connect_error(error):
            self.connected = False
            log_error(f"[{self.id}] Connection error: {error}")
            
        @self.sio.event
        async def waiting_for_peer():
            self.waiting = True
            self.matched = False
            self.matched_with = None
            log_info(f"[{self.id}] Waiting for peer")
            
        @self.sio.event
        async def match_ready(data):
            self.waiting = False
            self.matched = True
            self.room_id = data.get('roomId')
            self.is_initiator = data.get('isInitiator', False)
            log_success(f"[{self.id}] Match ready! Room: {self.room_id}, Initiator: {self.is_initiator}")
            
            # Acknowledge the match
            await self.sio.emit('match-ready', {'matchId': self.room_id})
            
            # Simulate WebRTC signaling
            if self.is_initiator:
                await asyncio.sleep(0.5)
                await self.sio.emit('signal', {
                    'roomId': self.room_id,
                    'description': {'type': 'offer', 'sdp': 'fake_sdp_offer'}
                })
        
        @self.sio.event
        async def peer_disconnected():
            log_warning(f"[{self.id}] Peer disconnected")
            self.matched = False
            self.matched_with = None
            self.room_id = None
            
        @self.sio.event
        async def peer_skipped():
            log_warning(f"[{self.id}] Peer skipped")
            self.matched = False
            self.matched_with = None
            self.room_id = None
        
        # Handle signal events - note the 'self' parameter is implicitly passed
        # We need to define the handler function with the correct signature 
        self.sio.on('signal', self.handle_signal)
    
    # Define the signal handler as a method of the class
    async def handle_signal(self, data):
        log_info(f"[{self.id}] Received signal: {data.get('description', {}).get('type', 'candidate')}")
        self.events.append({
            'type': 'signal',
            'data': data,
            'time': timestamp()
        })
        
        # If we received an offer, send back an answer
        if data.get('description', {}).get('type') == 'offer':
            await asyncio.sleep(0.5)
            await self.sio.emit('signal', {
                'roomId': self.room_id,
                'description': {'type': 'answer', 'sdp': 'fake_sdp_answer'}
            })
        
        # If we received a candidate, send one back
        if data.get('candidate'):
            await asyncio.sleep(0.2)
            await self.sio.emit('signal', {
                'roomId': self.room_id,
                'candidate': {'candidate': 'fake_ice_candidate', 'sdpMid': '0', 'sdpMLineIndex': 0}
            })
    
    async def connect(self):
        try:
            await self.sio.connect(SERVER_URL, transports=['websocket', 'polling'])
            await asyncio.sleep(1)  # Wait to ensure connection is established
            return self.connected
        except Exception as e:
            log_error(f"[{self.id}] Connection failed: {e}")
            return False
            
    async def start_search(self):
        if not self.connected:
            log_error(f"[{self.id}] Cannot start search: Not connected")
            return False
            
        await self.sio.emit('start-search')
        log_info(f"[{self.id}] Started search")
        return True
        
    async def skip(self):
        if not self.connected or not self.matched:
            log_error(f"[{self.id}] Cannot skip: Not connected or not matched")
            return False
            
        await self.sio.emit('skip')
        log_info(f"[{self.id}] Skipped current match")
        return True
        
    async def stop_search(self):
        if not self.connected:
            log_error(f"[{self.id}] Cannot stop search: Not connected")
            return False
            
        await self.sio.emit('stop-search')
        log_info(f"[{self.id}] Stopped search")
        return True
        
    async def disconnect(self):
        if self.connected:
            await self.sio.disconnect()
            log_info(f"[{self.id}] Disconnected from server")

async def run_test_scenario():
    log_special("Starting multi-user test for Satoshigle...")
    log_highlight(f"Server URL: {SERVER_URL}")
    
    # Create test users
    users = [
        TestUser(f"user_{i+1}_{uuid.uuid4().hex[:8]}")
        for i in range(4)
    ]
    
    try:
        # Connect all users
        log_highlight("Connecting all users...")
        for user in users:
            connected = await user.connect()
            if not connected:
                log_error(f"Failed to connect user {user.id}")
        
        # Count connected users
        connected_users = [u for u in users if u.connected]
        log_success(f"Connected {len(connected_users)}/{len(users)} users")
        
        if len(connected_users) < 2:
            log_error("Not enough users connected to continue test")
            return False
        
        # Wait a bit
        await asyncio.sleep(2)
        
        # Start search for first two users
        log_highlight("Starting search for users 1 and 2...")
        await users[0].start_search()
        await asyncio.sleep(1)
        await users[1].start_search()
        
        # Wait for matching to occur
        await asyncio.sleep(5)
        
        # Start search for third user
        log_highlight("Starting search for user 3...")
        await users[2].start_search()
        
        # Wait a bit
        await asyncio.sleep(5)
        
        # Check if users have been matched
        matched_users = [u for u in users if u.matched]
        log_info(f"Users matched so far: {len(matched_users)}/{len(connected_users)}")
        
        # Skip if a user is matched
        if matched_users:
            log_highlight(f"User {matched_users[0].id} skipping their match...")
            await matched_users[0].skip()
            await asyncio.sleep(3)
        else:
            log_warning("No users matched yet, skipping the skip test")
        
        # Start search for fourth user
        log_highlight("Starting search for user 4...")
        await users[3].start_search()
        
        # Wait for matching
        await asyncio.sleep(5)
        
        # Final count of matched users
        matched_users = [u for u in users if u.matched]
        log_info(f"Final matched users: {len(matched_users)}/{len(connected_users)}")
        
        # Stop search for any remaining users
        log_highlight("Stopping search for all users...")
        for user in users:
            if user.waiting or not user.matched:
                await user.stop_search()
        
        # Final status report
        log_highlight("Test scenario complete. Final status:")
        for i, user in enumerate(users):
            status = "Matched" if user.matched else "Waiting" if user.waiting else "Idle"
            log_info(f"User {i+1} ({user.id}): {status}")
        
        # Test summary
        log_special("Test Summary:")
        log_success(f"Successfully connected: {len(connected_users)}/{len(users)} users")
        log_success(f"Successfully matched: {len(matched_users)}/{len(users)} users")
        
        # Clean up
        log_highlight("Disconnecting all users...")
        for user in users:
            await user.disconnect()
        
        return True
        
    except Exception as e:
        log_error(f"Test scenario failed: {e}")
        import traceback
        traceback.print_exc()
        
        # Try to disconnect all users
        for user in users:
            try:
                await user.disconnect()
            except:
                pass
        return False

if __name__ == "__main__":
    try:
        asyncio.run(run_test_scenario())
    except KeyboardInterrupt:
        log_warning("Test interrupted by user") 