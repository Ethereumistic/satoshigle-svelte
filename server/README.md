# Satoshigle Signaling Server

A WebRTC signaling server for the Satoshigle application, facilitating peer-to-peer video connections and user matching.

## Architecture

The server is built with a modular architecture that separates concerns for better maintainability and scalability:

```
server/
├── src/
│   ├── config/          # Configuration and environment variables
│   ├── middleware/      # Express and Socket.IO middleware
│   ├── models/          # Type definitions and data models
│   ├── services/        # Core business logic services
│   ├── utils/           # Utility functions and helpers
│   ├── index.ts         # Main export file
│   └── server.ts        # Server initialization and setup
```

### Key Components

- **UserManager**: Manages user state, matching logic, and waiting queue
- **SignalingService**: Handles WebRTC signaling between peers
- **MonitoringService**: Tracks system resources and performs maintenance
- **Security Middleware**: Implements rate limiting, CORS, and connection limits

## Getting Started

### Prerequisites

- Node.js 18+ or Bun 1.0+
- Redis (optional, for distributed deployment)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/satoshigle.git
cd satoshigle/server

# Install dependencies
npm install
```

### Environment Variables

Create a `.env` file in the server directory with the following variables:

```env
# Server configuration
NODE_ENV=development
PORT=3001

# Client URLs
CLIENT_URL=http://localhost:5173
CLIENT_IP_URL=http://192.168.192.1:5173

# Redis configuration (optional)
REDIS_ENABLED=false
REDIS_URL=redis://localhost:6379

# Rate limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# Socket.IO configuration
SOCKET_PATH=/socket.io/
CONNECTION_TIMEOUT_MS=20000
MAX_DISCONNECTION_DURATION_MS=60000
```

### Running the Server

```bash
# Development mode
npm run dev

# Production mode
npm run build
npm start
```

## Scaling Considerations

The server is designed to scale horizontally with the following strategies:

1. **Stateless Design**: Core application state can be externalized to Redis
2. **Shared Nothing Architecture**: Each instance operates independently
3. **Connection Pooling**: Socket.IO can be configured with sticky sessions
4. **Load Balancing**: Multiple server instances can be deployed behind a load balancer

For high-scale deployments, consider:

- Implementing Redis for shared state across instances
- Using a proper session store for Socket.IO
- Setting up health checks and auto-scaling rules
- Using a CDN for static assets

## Integration with Lightning Network

The server architecture is designed to support future integration with Bitcoin Lightning Network:

- Separation of concerns allows for easy addition of payment services
- Event-driven design facilitates asynchronous payment processing
- State management can handle transitions for payment verification

Planned Lightning features include:
- User-to-user payments during video chat
- Payment channel management
- Micropayment tracking and verification

## Security Considerations

The server implements several security measures:

- Rate limiting to prevent abuse
- Connection limiting per IP address
- CORS configuration to restrict origins
- Helmet for secure HTTP headers
- Input validation
- State validation to prevent unauthorized signaling

## Development and Contributing

### Code Style

The project uses TypeScript with ESLint and Prettier for code quality. Run linting with:

```bash
npm run lint
```

### Testing

Run tests with:

```bash
npm test
```

### Building

Build the production version with:

```bash
npm run build
```

## License

[MIT License](LICENSE)
