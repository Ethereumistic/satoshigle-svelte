# Satoshigle Testing Guide

This document outlines how to test the Satoshigle application for performance, stability, and functionality.

## Prerequisites

- [Bun](https://bun.sh/) (for running the server)
- [k6](https://k6.io/docs/getting-started/installation/) (for load testing)
- [Playwright](https://playwright.dev/) (for functional testing)

## Quick Start

1. Clone the repository and install dependencies:

```bash
cd server
bun install
bun run test:install  # Install Playwright browsers
```

2. Start the server with monitoring enabled:

```bash
cd server
bun run dev
```

3. In a separate terminal, start the frontend:

```bash
cd ../frontend # Adjust path as needed
bun install
bun run dev
```

4. Verify that both server and frontend are running:

```bash
cd server
bun run verify
```

This will check if the server and frontend are accessible before running tests.

## Testing Options

### 1. Basic Functionality Test

The basic functionality test opens two browser windows and verifies they can connect to each other successfully:

```bash
# For macOS/Linux:
cd server
bun run test:basic

# For Windows:
cd server
bun run test:basic:win
```

This test will:
- Open two browser windows
- Navigate to the application
- Initiate a video chat search
- Verify both users connect
- Verify video streams are flowing
- Test the skip functionality

### 2. Load Testing

The load testing suite simulates multiple concurrent users to test the scalability of the application:

#### Small Load Test (10 users)

```bash
cd server
bun run test:load:small
```

#### Full Load Test (up to 100 users)

```bash
cd server
bun run test:load
```

The load test will:
- Gradually increase the number of virtual users
- Simulate WebSocket connections
- Simulate WebRTC signaling
- Test the matchmaking algorithm
- Measure connection success rates and latencies

#### Analyzing Load Test Results

After running a load test, analyze the results:

```bash
cd server
bun run test:load:analyze
```

This will provide:
- Peak concurrent user count
- Connection success rate
- Average connection times
- Recommendations based on results

## Monitoring

The server includes built-in monitoring that logs:
- CPU usage
- Memory usage
- Number of active connections
- Number of rooms

These metrics are printed to the console every 5 seconds when the server is running.

## What This Tests

1. **Matchmaking Algorithm**
   - How efficiently users are paired
   - Time to find a match

2. **Signaling Performance**
   - WebSocket connection stability
   - Message processing throughput

3. **Server Resource Usage**
   - CPU and memory consumption under load
   - Maximum concurrent connections

4. **WebRTC Connection**
   - ICE candidate exchange success rate
   - Connection establishment time

## Troubleshooting

### Common Issues

1. **Test Stuck at "Starting basic connection test..."**
   - Ensure Playwright is properly installed: `bun run test:install`
   - Check that the frontend is running: `bun run verify`
   - Verify that fake media is working by adding `--use-fake-ui-for-media-stream` flag
   - On Windows, use `bun run test:basic:win` instead of `test:basic`

2. **Server Shows 404 Error**
   - The server needs to be restarted with the updated code (added health endpoints)
   - Run `bun run dev` again to restart the server
   - Verify with `bun run verify` that the server is accessible

3. **WebRTC Connection Failures**
   - Make sure your system has access to camera/microphone
   - Check STUN/TURN server configuration in the frontend code
   - Browser security policies might be blocking connections

4. **Load Test Failures**
   - Install k6 globally: `npm install -g k6` or use Docker
   - On Windows, install k6 with Chocolatey: `choco install k6`
   - Verify server is running and accessible: `bun run verify`
   - Start with a smaller number of users and gradually increase

5. **Browser Not Opening**
   - Make sure you have Chromium installed: `bun run test:install`
   - Check that your system allows browser automation
   - Try running tests as an administrator if needed

### If the Server Won't Start

- Check for port conflicts (default is 3001)
- Ensure all dependencies are installed with `bun install`
- Check the .env file for proper configuration

### If the Frontend Won't Start

- Check for port conflicts (default is 5173)
- Ensure all dependencies are installed with `bun install`
- Update environment variables to point to the correct server

## Windows-Specific Notes

For Windows users:
- Use `bun run test:basic:win` instead of `test:basic` for browser tests
- Install k6 using Chocolatey: `choco install k6`
- If you get "Module not found" errors, make sure you're using the Windows-specific command
- For WebRTC tests, you might need to grant camera and microphone permissions explicitly
- If browser windows don't open, try running PowerShell as Administrator

## Custom Test Configurations

You can customize the load test by modifying `tests/load-test.js` and adjusting:
- Number of users
- Test duration
- User behavior patterns
- Connection properties

## Further Improvements

Consider these additional tests:
- Long-running stability tests (24+ hours)
- Geographic distribution testing
- Network degradation testing
- Mobile device compatibility 