#!/usr/bin/env python3
import asyncio
import socketio
import time
import uuid
import random
from datetime import datetime

# Configuration
SERVER_URL = "http://localhost:3001"
NUM_USERS = 10
CONNECTION_DURATION = 30  # How long each user stays connected

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

# Global stats
class TestStats:
    def __init__(self):
        self.connected_users = 0
        self.matched_users = 0
        self.total_matches = 0
        self.waiting_users = 0
        self.match_times = []
        self.match_pairs = []
    
    def print_current_state(self):
        log_highlight("\n=== CURRENT TEST STATE ===")
        log_info(f"Connected users: {self.connected_users}")
        log_info(f"Matched users: {self.matched_users}")
        log_info(f"Waiting users: {self.waiting_users}")
        log_info(f"Total matches created: {self.total_matches}")
        if self.match_times:
            avg_time = sum(self.match_times) / len(self.match_times)
            log_info(f"Average time to match: {avg_time:.2f}s")

stats = TestStats()

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
        self.waiting_since = None
        self.matched_at = None
        
        # Set up event handlers
        @self.sio.event
        async def connect():
            self.connected = True
            stats.connected_users += 1
            log_success(f"[{self.id}] Connected to server")
        
        @self.sio.event
        async def disconnect():
            self.connected = False
            stats.connected_users -= 1
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
            self.waiting_since = time.time()
            stats.waiting_users += 1
            log_info(f"[{self.id}] Waiting for peer")
            
        @self.sio.event
        async def match_ready(data):
            self.waiting = False
            stats.waiting_users -= 1
            self.matched = True
            self.matched_at = time.time()
            self.room_id = data.get('roomId')
            self.is_initiator = data.get('isInitiator', False)
            
            # Calculate time to match
            if self.waiting_since:
                match_time = self.matched_at - self.waiting_since
                stats.match_times.append(match_time)
                stats.matched_users += 1
            
            log_success(f"[{self.id}] Match ready! Room: {self.room_id}, Initiator: {self.is_initiator}")
            
            # Record this match in global stats if initiator
            if self.is_initiator and data.get('roomId'):
                stats.total_matches += 0.5  # Increment by 0.5 since both users will increment
                stats.match_pairs.append(data.get('roomId'))
            
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
            if self.matched:
                stats.matched_users -= 1
                self.matched = False
            self.matched_with = None
            self.room_id = None
            
        @self.sio.event
        async def peer_skipped():
            log_warning(f"[{self.id}] Peer skipped")
            if self.matched:
                stats.matched_users -= 1
                self.matched = False
            self.matched_with = None
            self.room_id = None
        
        # Handle signal events
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
            
        if self.matched:
            stats.matched_users -= 1
            self.matched = False
            
        await self.sio.emit('skip')
        log_info(f"[{self.id}] Skipped current match")
        return True
        
    async def stop_search(self):
        if not self.connected:
            log_error(f"[{self.id}] Cannot stop search: Not connected")
            return False
        
        if self.waiting:
            stats.waiting_users -= 1
            self.waiting = False
            
        await self.sio.emit('stop-search')
        log_info(f"[{self.id}] Stopped search")
        return True
        
    async def disconnect(self):
        if self.connected:
            if self.matched:
                stats.matched_users -= 1
            if self.waiting:
                stats.waiting_users -= 1
            await self.sio.disconnect()
            log_info(f"[{self.id}] Disconnected from server")

async def user_lifecycle(user_id, test_duration):
    """Simulate a complete user lifecycle"""
    user = TestUser(f"user_{user_id}_{uuid.uuid4().hex[:6]}")
    
    try:
        # Connect
        connected = await user.connect()
        if not connected:
            log_error(f"Failed to connect user {user.id}")
            return
        
        # Start search
        await user.start_search()
        
        # Keep connection alive
        start_time = time.time()
        while time.time() - start_time < test_duration:
            # Random chance to skip if matched
            if user.matched and random.random() < 0.1:  # 10% chance each second
                await user.skip()
                await asyncio.sleep(1)
                await user.start_search()
            
            # Print current stats every 5 seconds
            if int(time.time() - start_time) % 5 == 0:
                stats.print_current_state()
            
            await asyncio.sleep(1)
        
        # Disconnect
        await user.stop_search()
        await user.disconnect()
        
    except Exception as e:
        log_error(f"User {user.id} lifecycle error: {e}")
        try:
            await user.disconnect()
        except:
            pass

async def run_extended_test():
    log_special("Starting Satoshigle Extended Multi-User Test...")
    log_highlight(f"Server URL: {SERVER_URL}")
    log_highlight(f"Testing with {NUM_USERS} users for {CONNECTION_DURATION} seconds each")
    
    # Create tasks for all users
    tasks = [
        asyncio.create_task(user_lifecycle(i+1, CONNECTION_DURATION))
        for i in range(NUM_USERS)
    ]
    
    # Wait for all tasks to complete
    await asyncio.gather(*tasks)
    
    # Final stats
    log_special("\n=== FINAL TEST RESULTS ===")
    log_success(f"Total matches created: {stats.total_matches}")
    if stats.match_times:
        avg_time = sum(stats.match_times) / len(stats.match_times)
        min_time = min(stats.match_times)
        max_time = max(stats.match_times)
        log_info(f"Average time to match: {avg_time:.2f}s")
        log_info(f"Fastest match: {min_time:.2f}s")
        log_info(f"Slowest match: {max_time:.2f}s")
    log_info(f"Connected users: {stats.connected_users}")
    log_info(f"Matched users: {stats.matched_users}")
    log_info(f"Waiting users: {stats.waiting_users}")

if __name__ == "__main__":
    try:
        asyncio.run(run_extended_test())
    except KeyboardInterrupt:
        log_warning("Test interrupted by user") 