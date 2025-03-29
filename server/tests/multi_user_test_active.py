#!/usr/bin/env python3
import asyncio
import socketio
import time
import uuid
import random
from datetime import datetime
import logging
import argparse
import nest_asyncio
from queue import Queue
import sys
import traceback
import json

# Configuration
SERVER_URL = "http://localhost:3001"
NUM_USERS = 10
CONNECTION_DURATION = 30
STAGGERED_START = True  # Set to False for simultaneous connections
DEBUG_EVENTS = False    # Disable detailed event logging - reduces terminal noise

# Print Socket.IO version for debugging (commented out due to compatibility)
# print(f"Using Python Socket.IO version: {socketio.__version__}")

# Increase timeouts for events
CONNECT_TIMEOUT = 8  # seconds
WAITING_TIMEOUT = 5  # seconds
MATCH_TIMEOUT = 15   # seconds
DEBUG_TIMEOUT = 3    # seconds

# Socket.IO configuration - simpler for compatibility
SOCKET_OPTIONS = {
    'transports': ['websocket', 'polling'],
    'wait_timeout': 5,
    'socketio_path': 'socket.io'
}

# Suppress excessive socket.io errors if not in debug mode
if not DEBUG_EVENTS:
    logging.getLogger('socketio').setLevel(logging.ERROR)
    logging.getLogger('engineio').setLevel(logging.ERROR)
    logging.getLogger('websockets').setLevel(logging.ERROR)
else:
    logging.basicConfig(level=logging.DEBUG)

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
        self.users_connected = 0
        self.matches_created = 0
        self.search_starts = 0
        self.match_times = []
        self.offers_received = 0
        self.candidates_received = 0
        # Additional tracking
        self.waiting_for_peer_events = 0
        self.match_ready_events = 0
        self.debug_info_events = 0
        self.connection_errors = 0
        self.signaling_errors = 0
        self.eio_exceptions = 0
        self.connect_timeouts = 0
        self.waiting_timeouts = 0
        self.match_timeouts = 0
    
    def get_match_time_stats(self):
        if not self.match_times:
            return {
                'avg': 0,
                'min': 0,
                'max': 0
            }
        return {
            'avg': sum(self.match_times) / len(self.match_times),
            'min': min(self.match_times) if self.match_times else 0,
            'max': max(self.match_times) if self.match_times else 0
        }
    
    def get_match_percentage(self, total_users):
        if total_users == 0:
            return 0
        # Since each match involves 2 users, divide matches by 2 to get user pairs
        matched_users = min(self.matches_created * 2, total_users)
        return (matched_users / total_users) * 100

stats = TestStats()

class TestUser:
    def __init__(self, user_id, server_url, lifecycle_queue, stats):
        self.id = user_id
        self.server_url = server_url
        # Use AsyncClient for asyncio compatibility
        self.sio = socketio.AsyncClient(logger=DEBUG_EVENTS, engineio_logger=DEBUG_EVENTS)
        
        # Track connection state
        self.connected = False
        self.waiting = False
        self.matched = False
        self.matched_with = None
        self.room_id = None
        self.state = "disconnected"
        self.last_search_time = None
        self.match_time = None
        self.disconnect_time = None
        self.lifecycle_queue = lifecycle_queue
        self.stats = stats
        self.peer_candidates_received = 0
        self.peer_offers_received = 0
        
        # Event tracking - store all received events with timestamps
        self.events = []
        self.raw_events = []  # Store all raw events for debugging
        
        # Synchronization events
        self.connect_event = asyncio.Event()
        self.waiting_event = asyncio.Event()
        self.match_event = asyncio.Event()
        self.debug_info_event = asyncio.Event()
        
        # Additional state trackers
        self.received_debug_info = None
        self.connection_issues = False
        
        # Set up all event handlers with comprehensive coverage
        @self.sio.event
        async def connect():
            try:
                self.log_success(f"CONNECTED to server at {timestamp()}")
                self.connected = True
                self.state = "connected"
                self.stats.users_connected += 1
                self.track_event('connect')
                self.connect_event.set()
            except Exception as e:
                self.log_error(f"Error in connect handler: {e}")
                self.track_exception('connect_handler', e)
            
        @self.sio.event
        async def disconnect():
            try:
                self.log_warning(f"DISCONNECTED from server at {timestamp()}")
                self.connected = False
                self.state = "disconnected"
                self.disconnect_time = time.time()
                self.track_event('disconnect')
                # Reset other state variables
                self.waiting = False
                self.waiting_event.clear()
                self.matched = False
                self.match_event.clear()
            except Exception as e:
                self.log_error(f"Error in disconnect handler: {e}")
                self.track_exception('disconnect_handler', e)
        
        @self.sio.event
        async def connect_error(data):
            try:
                self.log_error(f"CONNECTION ERROR: {data}")
                self.stats.connection_errors += 1
                self.track_event('connect_error', data)
                self.connection_issues = True
            except Exception as e:
                self.log_error(f"Error in connect_error handler: {e}")
                self.track_exception('connect_error_handler', e)
            
        # Set up client-specific events
        @self.sio.event
        async def waiting_for_peer():
            try:
                self.log_highlight(f"WAITING FOR PEER event received at {timestamp()}")
                self.waiting = True
                self.state = "waiting"
                self.matched = False  # Reset matched state when waiting
                self.matched_with = None
                self.room_id = None
                self.track_event('waiting_for_peer')
                self.stats.waiting_for_peer_events += 1
                self.waiting_event.set()
            except Exception as e:
                self.log_error(f"Error in waiting_for_peer handler: {e}")
                self.track_exception('waiting_for_peer_handler', e)
            
        @self.sio.event
        async def match_ready(data):
            try:
                self.log_success(f"MATCH READY event received at {timestamp()}: {data}")
                self.waiting = False
                self.matched = True
                self.state = "matched"
                self.match_time = time.time()
                self.matched_with = data.get('peerId')
                self.room_id = data.get('roomId')
                
                # Store match details for statistics
                match_time = None
                if self.last_search_time:
                    match_time = self.match_time - self.last_search_time
                    self.stats.match_times.append(match_time)
                
                self.stats.matches_created += 1
                self.stats.match_ready_events += 1
                
                self.track_event('match_ready', data)
                
                # Acknowledge the match to the server
                await self.sio.emit('match-ready', {'matchId': self.room_id})
                
                # Signal that we're matched
                self.match_event.set()
            except Exception as e:
                self.log_error(f"Error in match_ready handler: {e}")
                self.track_exception('match_ready_handler', e)
            
        @self.sio.event
        async def debug_info(data):
            try:
                self.log_info(f"DEBUG INFO received: {data}")
                self.received_debug_info = data
                self.track_event('debug_info', data)
                self.stats.debug_info_events += 1
                self.debug_info_event.set()
            except Exception as e:
                self.log_error(f"Error in debug_info handler: {e}")
                self.track_exception('debug_info_handler', e)
            
        @self.sio.event
        async def connection_error(data):
            try:
                self.log_error(f"Connection error from server: {data}")
                self.track_event('connection_error', data)
                self.stats.connection_errors += 1
            except Exception as e:
                self.log_error(f"Error in connection_error handler: {e}")
                self.track_exception('connection_error_handler', e)
            
        @self.sio.event
        async def peer_disconnected():
            try:
                self.log_warning(f"Peer disconnected at {timestamp()}")
                self.track_event('peer_disconnected')
                # Reset match state
                self.matched = False
                self.matched_with = None
                self.room_id = None
                self.waiting = False
                # Clear match event
                self.match_event.clear()
            except Exception as e:
                self.log_error(f"Error in peer_disconnected handler: {e}")
                self.track_exception('peer_disconnected_handler', e)
            
        @self.sio.event
        async def peer_skipped():
            try:
                self.log_warning(f"Peer skipped at {timestamp()}")
                self.track_event('peer_skipped')
                # Reset match state
                self.matched = False
                self.matched_with = None
                self.room_id = None
                self.waiting = False
                # Clear match event
                self.match_event.clear()
            except Exception as e:
                self.log_error(f"Error in peer_skipped handler: {e}")
                self.track_exception('peer_skipped_handler', e)
        
        # General event handler to catch all events
        @self.sio.event
        async def catch_all(event, data):
            try:
                self.log_debug(f"CATCH-ALL received event: {event}")
                self.raw_events.append({
                    'event': event,
                    'data': data,
                    'time': time.time(),
                    'timestamp': timestamp()
                })
            except Exception as e:
                self.log_error(f"Error in catch-all handler: {e}")
        
        # Use the on method for signal events to handle the namespace
        self.sio.on('signal', self.handle_signal)
        
    def log_info(self, message):
        print(f"[{self.id}] {message}")
    
    def log_success(self, message):
        print(f"[{self.id}] {GREEN}{message}{ENDC}")
        
    def log_error(self, message):
        print(f"[{self.id}] {RED}{message}{ENDC}")
    
    def log_warning(self, message):
        print(f"[{self.id}] {YELLOW}⚠️ {message}{ENDC}")
        
    def log_debug(self, message):
        if DEBUG_EVENTS:
            print(f"[{self.id}] {CYAN}🔍 DEBUG: {message}{ENDC}")
    
    def track_event(self, event_type, data=None):
        event = {
            'type': event_type,
            'time': time.time(),
            'timestamp': timestamp(),
            'data': data
        }
        self.events.append(event)
        self.log_debug(f"Event tracked: {event_type} at {event['timestamp']}")
        return event
    
    def track_exception(self, source, exception):
        """Track exception details for debugging"""
        error_info = {
            'source': source,
            'error': str(exception),
            'traceback': traceback.format_exc(),
            'time': time.time(),
            'timestamp': timestamp()
        }
        self.log_error(f"Exception in {source}: {str(exception)}")
        self.events.append({
            'type': 'exception',
            'time': time.time(),
            'timestamp': timestamp(),
            'data': error_info
        })
        self.stats.eio_exceptions += 1
    
    async def handle_signal(self, data, namespace=None):
        try:
            # Try to parse the signal data
            signal_type = None
            if 'type' in data:
                signal_type = data['type']
            elif 'description' in data and 'type' in data['description']:
                signal_type = data['description']['type']
            elif 'candidate' in data:
                signal_type = 'candidate'
            else:
                signal_type = 'unknown'
            
            if signal_type == 'offer':
                self.peer_offers_received += 1
                self.log_info(f"Received offer from peer")
                self.stats.offers_received += 1
                
                # Send back an answer after a brief delay
                await asyncio.sleep(0.5)
                if self.room_id:
                    self.log_debug(f"Sending answer to {self.matched_with}")
                    await self.sio.emit('signal', {
                        'roomId': self.room_id,
                        'type': 'answer',
                        'description': {'type': 'answer', 'sdp': 'fake_answer_sdp'}
                    })
                
            elif signal_type == 'candidate':
                self.peer_candidates_received += 1
                self.stats.candidates_received += 1
                self.log_debug(f"Received ICE candidate")
                
            self.track_event('signal', {'type': signal_type})
            
        except Exception as e:
            self.log_warning(f"Error processing signal: {str(e)}")
            self.stats.signaling_errors += 1
            self.track_exception('handle_signal', e)
    
    async def connect_to_server(self):
        try:
            # Reset event flags
            self.connect_event.clear()
            self.waiting_event.clear()
            self.match_event.clear()
            self.debug_info_event.clear()
            
            self.log_info(f"Connecting to server: {self.server_url}")
            
            # Use explicit options for better compatibility
            await self.sio.connect(
                self.server_url,
                **SOCKET_OPTIONS  # Use global socket options
            )
            
            # Wait for the connect event to be confirmed
            try:
                self.log_info(f"Waiting up to {CONNECT_TIMEOUT}s for connect event...")
                await asyncio.wait_for(self.connect_event.wait(), timeout=CONNECT_TIMEOUT)
                self.log_success("Connection confirmed by event")
                return True
            except asyncio.TimeoutError:
                self.log_warning(f"Connect event never received after {CONNECT_TIMEOUT} seconds")
                self.stats.connect_timeouts += 1
                return self.connected  # Return the flag value, which may be set by the handler
                
        except socketio.exceptions.ConnectionError as e:
            self.log_error(f"Connection error: {str(e)}")
            self.track_exception('connect_to_server', e)
            self.stats.connection_errors += 1
            return False
        except Exception as e:
            self.log_error(f"Failed to connect: {str(e)}")
            self.track_exception('connect_to_server', e)
            return False
    
    async def start_search(self):
        self.log_info("Starting search")
        self.stats.search_starts += 1
        self.track_event('start_search')
        
        # Reset match state variables
        self.matched = False
        self.matched_with = None
        self.room_id = None
        self.waiting = False
        self.last_search_time = time.time()
        
        # Clear the waiting event so we can detect when it happens
        self.waiting_event.clear()
        
        try:
            self.log_info("Emitting start-search event")
            await self.sio.emit('start-search')
            
            # Wait for waiting-for-peer event with timeout
            try:
                self.log_debug(f"Waiting up to {WAITING_TIMEOUT}s for waiting-for-peer event...")
                await asyncio.wait_for(self.waiting_event.wait(), timeout=WAITING_TIMEOUT)
                self.log_success("Successfully entered waiting state")
                return True
            except asyncio.TimeoutError:
                self.log_warning(f"Did not receive waiting-for-peer event after {WAITING_TIMEOUT} seconds")
                self.stats.waiting_timeouts += 1
                
                # Try to get debug info from the server
                self.log_info("Requesting debug-state from server")
                await self.sio.emit('debug-state')
                try:
                    await asyncio.wait_for(self.debug_info_event.wait(), timeout=DEBUG_TIMEOUT)
                    self.log_info(f"Received debug info: {self.received_debug_info}")
                except asyncio.TimeoutError:
                    self.log_warning(f"Did not receive debug info after {DEBUG_TIMEOUT} seconds")
                
                # Check for socket health
                self.log_info(f"Socket connected status: {self.sio.connected}")
                
                # Check for received events
                event_counts = {}
                for event in self.events:
                    event_type = event.get('type', 'unknown')
                    event_counts[event_type] = event_counts.get(event_type, 0) + 1
                
                self.log_info(f"Event history: {event_counts}")
                
                # Despite timeout, check if the waiting state was somehow set
                return self.waiting
                
        except socketio.exceptions.BadNamespaceError as e:
            self.log_error(f"Bad namespace error when starting search: {str(e)}")
            self.track_exception('start_search', e)
            return False
        except Exception as e:
            self.log_error(f"Error starting search: {str(e)}")
            self.track_exception('start_search', e)
            return False
            
    async def wait_for_match(self, timeout=MATCH_TIMEOUT):
        """Wait for a match to be made"""
        self.log_info(f"Waiting for a match (timeout: {timeout}s)")
        try:
            await asyncio.wait_for(self.match_event.wait(), timeout=timeout)
            self.log_success("Match successfully established")
            return True
        except asyncio.TimeoutError:
            self.log_warning(f"No match found after {timeout} seconds")
            self.stats.match_timeouts += 1
            return False
    
    async def disconnect_from_server(self):
        try:
            if self.connected:
                self.log_info("Disconnecting from server")
                await self.sio.disconnect()
                await asyncio.sleep(0.5)  # Give some time for the disconnect event
                self.log_info("Disconnected successfully")
            return True
        except Exception as e:
            self.log_warning(f"Error disconnecting: {str(e)}")
            self.track_exception('disconnect_from_server', e)
            return False
            
    async def run_lifecycle(self, duration_seconds):
        """Run a complete lifecycle for this user with better event tracking"""
        # Connect to server
        if not await self.connect_to_server():
            await self.lifecycle_queue.put(f"User {self.id} failed to connect")
            return
        
        start_time = time.time()
        search_cooldown = 3  # Seconds to wait between searches
        last_action_time = start_time
        match_count = 0
        
        while time.time() - start_time < duration_seconds:
            current_time = time.time()
            elapsed = current_time - start_time
            
            # Give status update every 10 seconds
            if int(elapsed) % 10 == 0 and int(elapsed) > 0 and int(current_time) != int(last_action_time):
                self.log_info(f"STATUS: {elapsed:.0f}s elapsed, {self.state} state, {match_count} matches")
            
            # If connected but not matched or waiting, start a search
            if self.connected and not self.matched and not self.waiting:
                if current_time - last_action_time > search_cooldown:
                    self.log_info("Not matched or waiting, starting new search")
                    if await self.start_search():
                        last_action_time = current_time
                        
                        # Wait for a match with timeout
                        self.log_info("Waiting for match...")
                        if await self.wait_for_match():
                            match_count += 1
                            self.log_info(f"Match #{match_count} established!")
                    else:
                        # If search failed, wait before trying again
                        self.log_warning("Search failed, waiting before retry")
                        await asyncio.sleep(2)
                        last_action_time = current_time
            
            # If matched, stay in the match for a while then end it
            elif self.matched:
                match_duration = current_time - self.match_time
                if match_duration > 8:  # Stay matched for 8 seconds
                    self.log_info(f"Ending match with {self.matched_with} after {match_duration:.1f}s")
                    # Reset match state
                    self.matched = False
                    self.matched_with = None
                    self.room_id = None
                    last_action_time = current_time
                    # Clear match event for next match
                    self.match_event.clear()
            
            # If waiting for a peer for too long, try restarting search
            elif self.waiting and current_time - last_action_time > 15:
                self.log_warning("Waiting for too long (15s), restarting search")
                # Clear and restart
                self.waiting = False
                self.waiting_event.clear()
                last_action_time = current_time
            
            # If we lost connection, try to reconnect
            elif not self.connected and current_time - last_action_time > 5:
                self.log_warning("Connection lost, attempting to reconnect")
                if await self.connect_to_server():
                    self.log_success("Reconnected successfully")
                    last_action_time = current_time
                else:
                    self.log_error("Reconnection failed")
                    await asyncio.sleep(5)  # Wait before trying again
                    last_action_time = current_time
            
            # Small sleep to prevent CPU hogging
            await asyncio.sleep(0.1)
        
        # Disconnect at the end
        await self.disconnect_from_server()
        
        # Summarize this user's experience
        total_events = len(self.events)
        wait_events = sum(1 for e in self.events if e['type'] == 'waiting_for_peer')
        match_events = sum(1 for e in self.events if e['type'] == 'match_ready')
        
        self.log_info(f"COMPLETED LIFECYCLE: {total_events} events, {wait_events} waits, {match_events} matches")
        await self.lifecycle_queue.put(f"User {self.id} completed with {match_events} matches")

async def user_lifecycle(user_id, test_duration):
    """Simulate a complete user lifecycle including active searching and matching"""
    user = TestUser(f"user_{user_id}_{uuid.uuid4().hex[:6]}", SERVER_URL, asyncio.Queue(), stats)
    
    try:
        await user.run_lifecycle(test_duration)
    except Exception as e:
        tb = traceback.format_exc()
        log_error(f"Error in user {user_id} lifecycle: {str(e)}\n{tb}")
    finally:
        # Ensure we disconnect on errors
        if user and hasattr(user, 'connected') and user.connected:
            await user.disconnect_from_server()

async def run_active_test(num_users=10, test_duration=60, server_url=SERVER_URL):
    """Run an active test with multiple users that connect, search, and match"""
    print("\n" + "="*80)
    print(f"Starting Satoshigle Connection Test with {num_users} active users for {test_duration}s each")
    print(f"Server URL: {server_url}")
    # print(f"Using Socket.IO Python client version: {socketio.__version__}")
    print("="*80 + "\n")
    
    # Initialize stats
    global stats
    stats = TestStats()
    
    # Create a queue for user lifecycle completion events
    lifecycle_queue = asyncio.Queue()
    
    # Create tasks for all user lifecycles with staggered starts if enabled
    tasks = []
    for i in range(num_users):
        # Stagger starts slightly to prevent server overload
        if STAGGERED_START:
            await asyncio.sleep(0.5)  # Half-second delay between user starts
        
        tasks.append(asyncio.create_task(user_lifecycle(i, test_duration)))
    
    # Create a periodic task to report statistics
    stats_task = asyncio.create_task(periodic_stats_reporter(test_duration))
    
    try:
        # Wait for all tasks to complete or until interrupted
        await asyncio.gather(*tasks, stats_task)
    except asyncio.CancelledError:
        print("\n\nTest interrupted! Cleaning up...")
        # Cancel any remaining tasks
        for task in tasks:
            if not task.done():
                task.cancel()
        if not stats_task.done():
            stats_task.cancel()
    except Exception as e:
        tb = traceback.format_exc()
        print(f"\n\nError in test: {str(e)}\n{tb}")
    finally:
        # Print final results
        print("\n" + "="*80)
        print("TEST RESULTS")
        print("="*80)
        print(f"Total users: {num_users}")
        print(f"Users that connected: {stats.users_connected}")
        
        print(f"\nTotal matches created: {stats.matches_created}")
        print(f"Users matched: {min(stats.matches_created * 2, num_users)} ({stats.get_match_percentage(num_users):.1f}%)")
        
        if stats.matches_created > 0:
            match_stats = stats.get_match_time_stats()
            print(f"\nMatch time statistics:")
            print(f"  Average time to match: {match_stats['avg']:.2f}s")
            print(f"  Minimum time to match: {match_stats['min']:.2f}s")
            print(f"  Maximum time to match: {match_stats['max']:.2f}s")
        
        print(f"\nEvents received:")
        print(f"  Search starts: {stats.search_starts}")
        print(f"  Waiting-for-peer: {stats.waiting_for_peer_events}")
        print(f"  Match-ready: {stats.match_ready_events}")
        print(f"  Debug info: {stats.debug_info_events}")
        
        print(f"\nErrors and timeouts:")
        print(f"  Connection errors: {stats.connection_errors}")
        print(f"  SocketIO exceptions: {stats.eio_exceptions}")
        print(f"  Connect timeouts: {stats.connect_timeouts}")
        print(f"  Waiting timeouts: {stats.waiting_timeouts}")
        print(f"  Match timeouts: {stats.match_timeouts}")
        
        print(f"\nSignaling:")
        print(f"  Offers received: {stats.offers_received}")
        print(f"  ICE candidates received: {stats.candidates_received}")
        print(f"  Signaling errors: {stats.signaling_errors}")
        
        print("\nTest " + ("completed" if all(t.done() for t in tasks) else "interrupted"))
        print("="*80 + "\n")

async def periodic_stats_reporter(duration):
    """Reports stats periodically during the test"""
    start_time = time.time()
    
    while time.time() - start_time < duration:
        # Wait 10 seconds between reports
        await asyncio.sleep(10)
        
        # Report current stats
        print("\n--- Test Progress Report ---")
        print(f"Time elapsed: {time.time() - start_time:.0f}s / {duration}s")
        print(f"Connected users: {stats.users_connected}")
        print(f"Matches created: {stats.matches_created}")
        print(f"Search starts: {stats.search_starts}")
        print(f"Events - Waiting: {stats.waiting_for_peer_events}, Match: {stats.match_ready_events}")
        print(f"Signal events - Offers: {stats.offers_received}, Candidates: {stats.candidates_received}")
        
        # Check if we should warn about potential issues
        if stats.search_starts > 0 and stats.matches_created == 0 and time.time() - start_time > 20:
            print("\n⚠️ WARNING: Users are searching but no matches are being created!")
            print("This may indicate a problem with the server's matching logic.")
            
        if stats.search_starts > 0 and stats.waiting_for_peer_events == 0 and time.time() - start_time > 10:
            print("\n⚠️ WARNING: Search events sent but no waiting-for-peer events received!")
            print("Check that server is sending these events and client is receiving them.")
            
        if stats.connection_errors > 0 or stats.eio_exceptions > 0:
            print(f"\n⚠️ WARNING: Connection issues detected!")
            print(f"Connection errors: {stats.connection_errors}, Socket exceptions: {stats.eio_exceptions}")
        
        print("----------------------------\n")

if __name__ == "__main__":
    # Parse command line arguments
    parser = argparse.ArgumentParser(description="Run an active test against the Satoshigle server")
    parser.add_argument('--users', type=int, default=NUM_USERS, help='Number of users to simulate')
    parser.add_argument('--duration', type=int, default=CONNECTION_DURATION, help='Duration in seconds for each user')
    parser.add_argument('--server', type=str, default=SERVER_URL, help='Server URL')
    parser.add_argument('--debug', action='store_true', help='Enable debug event logging')
    args = parser.parse_args()
    
    # Set global debug flag
    DEBUG_EVENTS = args.debug
    
    # Always use 'nest_asyncio' to ensure asyncio works in all environments
    nest_asyncio.apply()
    
    try:
        asyncio.run(run_active_test(
            num_users=args.users,
            test_duration=args.duration,
            server_url=args.server
        ))
    except KeyboardInterrupt:
        print("\nTest interrupted by user")
    except Exception as e:
        tb = traceback.format_exc()
        print(f"Error running test: {str(e)}\n{tb}") 