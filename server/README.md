# Satoshigle Server

Backend server for Satoshigle, a WebRTC-based video chat application.

## Setup

1. Install dependencies:

```bash
bun install
```

2. Configure environment variables (copy `.env.example` to `.env` if needed)

3. Start the server:

```bash
bun run dev
```

## Testing with Python

The server includes a Python-based testing suite that helps you validate functionality and performance.

### Setting up the test environment

#### Windows:
```bash
cd server/tests
.\setup_test_env.bat
```

#### macOS/Linux:
```bash
cd server/tests
chmod +x setup_test_env.sh
./setup_test_env.sh
```

This will:
- Create a Python virtual environment
- Install required dependencies
- Configure the test setup

### Running the tests

Make sure both server and frontend are running before testing:

```bash
# In one terminal - server
cd server
bun run dev

# In another terminal - frontend
cd frontend
bun run dev
```

Then run the tests:

```bash
cd server/tests

# Activate virtual environment (Windows)
.\venv\Scripts\activate

# Activate virtual environment (macOS/Linux)
source venv/bin/activate

# Basic connectivity test
python simple_test.py --basic

# Full test with matchmaking
python simple_test.py

# Load test with 50 users for 60 seconds
python simple_test.py --load 50 60
```

### What the tests validate

1. **Basic Connectivity**
   - Server health check endpoints
   - WebSocket connection establishment

2. **Matchmaking Algorithm**
   - User pairing functionality
   - WebRTC signaling exchange

3. **Load Testing**
   - Concurrent user handling (up to 100+ users)
   - Connection success rates
   - Match creation performance

## API Endpoints

- `GET /health` - Health check endpoint
- WebSocket endpoint for real-time signaling
  - Handles user matchmaking
  - Relays WebRTC signaling data
  - Manages room creation and cleanup

This project was created using `bun init` in bun v1.2.4. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
