// server/src/server.ts
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import cors from 'cors';
import { setupSocket } from './socket';
import * as dotenv from 'dotenv';
import { setupMonitoring } from './monitoring';

// Load environment variables
dotenv.config();

// Get allowed origins from environment variables
const allowedOrigins = [
  process.env.CLIENT_URL || 'http://localhost:5173',
  process.env.CLIENT_IP_URL || 'http://192.168.192.1:5173',
  // Additional origins for testing
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000'
];

console.log('Allowed CORS origins:', allowedOrigins);

const app = express();
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

// Add health check endpoints for testing
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Satoshigle server is running' });
});

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    message: 'Satoshigle server is running',
    version: '1.0.0'
  });
});

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins for testing
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization']
  },
  path: '/socket.io/', // Explicit path
  transports: ['websocket', 'polling'],
  connectionStateRecovery: {
    maxDisconnectionDuration: 60_000
  }
});

// Setup Socket.IO event handlers
setupSocket(io);

// Initialize monitoring
setupMonitoring(io);

const PORT = process.env.PORT || 3001;
// Listen on all network interfaces
server.listen(PORT, () => {
  console.log(`🚀 Signaling server running on:`);
  console.log(`- Local: http://localhost:${PORT}`);
  console.log(`- Socket.IO: ws://localhost:${PORT}/socket.io/`);
  console.log(`- Network: http://192.168.192.1:${PORT}`);
});