/**
 * Main server entry point
 * Sets up Express, Socket.IO, and the application services
 */
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from './config/environment';
import logger from './utils/logger';
import { UserManager } from './services/UserManager';
import { SignalingService } from './services/SignalingService';
import { ChatService } from './services/ChatService';
import { RPCService } from './services/RPCService';
import { MonitoringService } from './services/MonitoringService';
import { 
  corsMiddleware, 
  rateLimiter, 
  securityHeaders, 
  validateRequest,
  SocketConnectionLimiter 
} from './middleware/security.js';

// Create Express app
const app = express();

// Apply middleware
app.use(corsMiddleware);
app.use(securityHeaders);
app.use(express.json());
app.use(rateLimiter);
app.use(validateRequest);

// Add health check endpoints
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Satoshigle server is running' });
});

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    message: 'Satoshigle server is running',
    version: '1.0.0',
    environment: env.NODE_ENV
  });
});

// Create HTTP server
const server = createServer(app);

// Create Socket.IO server
const io = new Server(server, {
  cors: {
    origin: env.ALLOWED_ORIGINS, 
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
  },
  path: env.SOCKET_PATH,
  transports: ['websocket', 'polling'],
  connectionStateRecovery: {
    maxDisconnectionDuration: env.MAX_DISCONNECTION_DURATION_MS
  }
});

// Initialize services
const userManager = new UserManager();
const signalingService = new SignalingService(io, userManager);
const chatService = new ChatService(io, userManager);
const rpcService = new RPCService(io, userManager);
const monitoringService = new MonitoringService(io, userManager);
const socketConnectionLimiter = new SocketConnectionLimiter();

// Set up Socket.IO connection handling
io.on('connection', (socket) => {
  // Get IP address for connection limiting
  const address = socket.handshake.address;
  
  // Check connection limit
  if (!socketConnectionLimiter.checkConnection(address)) {
    logger.warn('Connection rejected - too many connections from IP', { ip: address });
    socket.disconnect(true);
    return;
  }
  
  // Handle the connection with all services
  signalingService.handleConnection(socket);
  chatService.handleConnection(socket); // Initialize the chat service
  rpcService.handleConnection(socket); // Initialize the RPC service for game communication
  
  // When socket disconnects, release the connection count
  socket.on('disconnect', () => {
    socketConnectionLimiter.releaseConnection(address);
  });
});

// Start monitoring
monitoringService.start();

// Handle graceful shutdown
const gracefulShutdown = () => {
  logger.info('Received shutdown signal, closing connections...');
  
  // Stop monitoring to cancel intervals
  monitoringService.stop();
  
  // Close the server
  server.close(() => {
    logger.info('Server closed successfully');
    process.exit(0);
  });
  
  // Force close after timeout
  setTimeout(() => {
    logger.error('Server close timed out, forcing shutdown');
    process.exit(1);
  }, 10000);
};

// Set up shutdown handlers
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start the server
const PORT = env.PORT;
server.listen(PORT, () => {
  logger.info(`Signaling server running`, {
    port: PORT,
    environment: env.NODE_ENV,
    socketPath: env.SOCKET_PATH
  });
});