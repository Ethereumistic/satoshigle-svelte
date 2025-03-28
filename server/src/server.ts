// server/src/server.ts
import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import cors from 'cors';
import { setupSocket } from './socket';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Get allowed origins from environment variables
const allowedOrigins = [
  process.env.CLIENT_URL || 'http://localhost:5173',
  process.env.CLIENT_IP_URL || 'http://192.168.192.1:5173'
];

console.log('Allowed CORS origins:', allowedOrigins);

const app = express();
app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket'],
  connectionStateRecovery: {
    maxDisconnectionDuration: 60_000
  }
});

setupSocket(io);

const PORT = process.env.PORT || 3001;
// Listen on all network interfaces
server.listen(PORT, () => {
  console.log(`🚀 Signaling server running on:`);
  console.log(`- Local: http://localhost:${PORT}`);
  console.log(`- Network: http://192.168.192.1:${PORT}`);
});