#!/usr/bin/env python3
import asyncio
import socketio
import time
import uuid
import random
import statistics
from datetime import datetime

# Configuration
SERVER_URL = "http://localhost:3001"
NUM_USERS = 100  # Number of users to simulate
MAX_CONCURRENT = 20  # Maximum number of concurrent connections to test
TEST_DURATION = 60  # Test duration in seconds

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

class PerformanceUser:
    def __init__(self, user_id):
        self.id = user_id
        self.sio = socketio.AsyncClient(logger=False)
        self.connected = False
        self.events = []
        self.connection_time = None
        self.latencies = []
        self.waiting_time = None
        self.match_time = None
        self.total_wait_time = None
        
        # Set up event handlers
        @self.sio.event
        async def connect():
            self.connected = True
            self.connection_time = time.time()
            self.events.append({
                'type': 'connect',
                'time': timestamp()
            })
        
        @self.sio.event
        async def disconnect():
            self.connected = False
            self.events.append({
                'type': 'disconnect',
                'time': timestamp()
            })
        
        @self.sio.event
        async def connect_error(error):
            self.connected = False
            self.events.append({
                'type': 'connect_error',
                'error': str(error),
                'time': timestamp()
            })
            
        @self.sio.event
        async def waiting_for_peer():
            self.waiting_time = time.time()
            self.events.append({
                'type': 'waiting_for_peer',
                'time': timestamp()
            })
            
        @self.sio.event
        async def match_ready(data):
            self.match_time = time.time()
            if self.waiting_time:
                self.total_wait_time = self.match_time - self.waiting_time
            
            self.events.append({
                'type': 'match_ready',
                'data': data,
                'time': timestamp()
            })
            
            # Record the round trip latency of this event
            ping_time = random.random() * 0.1  # Small random delay (0-100ms)
            await asyncio.sleep(ping_time)
            start_time = time.time()
            await self.sio.emit('match-ready', {'matchId': data.get('roomId')})
            end_time = time.time()
            self.latencies.append(end_time - start_time)
        
        # Use the handler method instead of a nested function
        self.sio.on('signal', self.handle_signal)
    
    async def handle_signal(self, data):
        self.events.append({
            'type': 'signal',
            'time': timestamp()
        })
        
        # Measure latency for signal events
        start_time = time.time()
        if data.get('description', {}).get('type') == 'offer':
            await self.sio.emit('signal', {
                'roomId': data.get('roomId'),
                'description': {'type': 'answer', 'sdp': 'fake_sdp_answer'}
            })
        elif data.get('candidate'):
            await self.sio.emit('signal', {
                'roomId': data.get('roomId'),
                'candidate': {'candidate': 'fake_ice_candidate', 'sdpMid': '0', 'sdpMLineIndex': 0}
            })
        end_time = time.time()
        self.latencies.append(end_time - start_time)
    
    async def connect(self):
        try:
            start_time = time.time()
            await self.sio.connect(SERVER_URL, transports=['websocket', 'polling'])
            end_time = time.time()
            self.latencies.append(end_time - start_time)
            return True
        except Exception as e:
            return False
            
    async def start_search(self):
        if not self.connected:
            return False
        
        start_time = time.time()
        await self.sio.emit('start-search')
        end_time = time.time()
        self.latencies.append(end_time - start_time)
        return True
        
    async def skip(self):
        if not self.connected:
            return False
        
        start_time = time.time()
        await self.sio.emit('skip')
        end_time = time.time()
        self.latencies.append(end_time - start_time)
        return True
        
    async def stop_search(self):
        if not self.connected:
            return False
        
        start_time = time.time()
        await self.sio.emit('stop-search')
        end_time = time.time()
        self.latencies.append(end_time - start_time)
        return True
        
    async def disconnect(self):
        if self.connected:
            await self.sio.disconnect()

class PerformanceReport:
    def __init__(self):
        self.connection_times = []
        self.event_latencies = []
        self.match_wait_times = []
        self.total_events = 0
        self.successful_connections = 0
        self.successful_matches = 0
        self.errors = 0
        
    def add_user(self, user):
        # Add connection time
        if user.connection_time:
            self.successful_connections += 1
            
        # Add latencies
        self.event_latencies.extend(user.latencies)
        
        # Add match wait time
        if user.total_wait_time:
            self.match_wait_times.append(user.total_wait_time)
            self.successful_matches += 1
            
        # Count events
        self.total_events += len(user.events)
        
        # Count errors
        self.errors += len([e for e in user.events if e.get('type') == 'connect_error'])
        
    def print_report(self):
        log_special("\n=== PERFORMANCE TEST REPORT ===")
        log_highlight(f"Total simulated users: {NUM_USERS}")
        log_highlight(f"Max concurrent connections: {MAX_CONCURRENT}")
        log_highlight(f"Test duration: {TEST_DURATION} seconds\n")
        
        log_success(f"Successful connections: {self.successful_connections}/{NUM_USERS} " +
                   f"({self.successful_connections/NUM_USERS*100:.1f}%)")
        log_success(f"Successful matches: {self.successful_matches}/{NUM_USERS} " +
                   f"({self.successful_matches/NUM_USERS*100:.1f}%)")
        log_info(f"Total events processed: {self.total_events}")
        log_error(f"Connection errors: {self.errors}")
        
        if self.event_latencies:
            avg_latency = statistics.mean(self.event_latencies) * 1000
            median_latency = statistics.median(self.event_latencies) * 1000
            min_latency = min(self.event_latencies) * 1000
            max_latency = max(self.event_latencies) * 1000
            
            log_highlight("\nEvent Latency (ms):")
            log_info(f"Average: {avg_latency:.2f} ms")
            log_info(f"Median: {median_latency:.2f} ms")
            log_info(f"Min: {min_latency:.2f} ms")
            log_info(f"Max: {max_latency:.2f} ms")
        
        if self.match_wait_times:
            avg_wait = statistics.mean(self.match_wait_times)
            median_wait = statistics.median(self.match_wait_times)
            min_wait = min(self.match_wait_times)
            max_wait = max(self.match_wait_times)
            
            log_highlight("\nMatch Wait Times (seconds):")
            log_info(f"Average: {avg_wait:.2f} s")
            log_info(f"Median: {median_wait:.2f} s")
            log_info(f"Min: {min_wait:.2f} s")
            log_info(f"Max: {max_wait:.2f} s")

async def run_performance_test():
    log_special("Starting Satoshigle Performance Test...")
    log_highlight(f"Server URL: {SERVER_URL}")
    log_highlight(f"Testing with {NUM_USERS} simulated users, {MAX_CONCURRENT} max concurrent")
    
    # Create all users but don't connect yet
    all_users = [PerformanceUser(f"perf_{i+1}_{uuid.uuid4().hex[:6]}") for i in range(NUM_USERS)]
    report = PerformanceReport()
    
    # Track active user tasks
    active_tasks = []
    completed_users = []
    
    async def user_lifecycle(user):
        try:
            # Connect
            success = await user.connect()
            if not success:
                return
                
            # Wait a bit to stabilize
            await asyncio.sleep(random.uniform(0.5, 1.5))
            
            # Start search
            await user.start_search()
            
            # Random delay for a skip if we haven't matched yet
            if random.random() < 0.3:  # 30% chance to skip
                await asyncio.sleep(random.uniform(3.0, 6.0))
                await user.skip()
                
            # Wait a bit more
            await asyncio.sleep(random.uniform(2.0, 4.0))
            
            # Stop search
            await user.stop_search()
            
            # Disconnect
            await user.disconnect()
            
            # Add to completed
            completed_users.append(user)
            
        except Exception as e:
            log_error(f"User {user.id} failed: {e}")
            try:
                await user.disconnect()
            except:
                pass
    
    # Start test timer
    start_time = time.time()
    
    # Process users in batches to control concurrency
    remaining_users = all_users.copy()
    
    while remaining_users or active_tasks:
        # Add new users up to MAX_CONCURRENT
        while len(active_tasks) < MAX_CONCURRENT and remaining_users:
            user = remaining_users.pop(0)
            task = asyncio.create_task(user_lifecycle(user))
            active_tasks.append((user, task))
            log_info(f"Started user {user.id} (active: {len(active_tasks)})")
            
            # Small delay between user starts
            await asyncio.sleep(random.uniform(0.5, 1.0))
        
        # Check for completed tasks
        for user, task in active_tasks.copy():
            if task.done():
                active_tasks.remove((user, task))
                # Handle any exceptions
                try:
                    await task
                except Exception as e:
                    log_error(f"User {user.id} task failed: {e}")
                
                log_info(f"Completed user {user.id} (active: {len(active_tasks)})")
        
        # Check test duration
        elapsed_time = time.time() - start_time
        if elapsed_time >= TEST_DURATION:
            if not remaining_users and not active_tasks:
                break
            
            # If we're over time but still have active tasks, wait for them to finish
            if elapsed_time >= TEST_DURATION + 10:  # Grace period of 10 seconds
                log_warning("Test taking longer than expected, cancelling remaining tasks")
                for user, task in active_tasks:
                    try:
                        task.cancel()
                        await user.disconnect()
                    except:
                        pass
                break
            
        # Small delay before next check
        await asyncio.sleep(0.5)
    
    # Calculate final statistics
    log_highlight(f"Test completed in {time.time() - start_time:.2f} seconds")
    
    # Add all completed users to report
    for user in completed_users:
        report.add_user(user)
    
    # Print report
    report.print_report()
    
    return report

if __name__ == "__main__":
    try:
        asyncio.run(run_performance_test())
    except KeyboardInterrupt:
        log_warning("Test interrupted by user") 