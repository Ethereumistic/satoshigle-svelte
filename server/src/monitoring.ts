import { Server } from 'socket.io';
import os from 'node:os';

/**
 * Setup monitoring for Socket.IO server
 * Tracks system resources and connection metrics
 * Includes room cleanup to prevent room accumulation
 */
export function setupMonitoring(io: Server) {
  console.log('📊 Monitoring initialized');
  
  // Clean up abandoned rooms periodically
  const roomCleanupInterval = setInterval(() => {
    cleanupAbandonedRooms(io);
  }, 30000); // Run every 30 seconds
  
  // Monitor system resources and connection stats
  const monitoringInterval = setInterval(() => {
    // Calculate room statistics
    const roomStats = analyzeRooms(io);
    
    const usage = {
      timestamp: new Date().toISOString(),
      cpu: {
        loadavg: os.loadavg()[0],
        cpus: os.cpus().length
      },
      memory: {
        free: os.freemem() / 1024 / 1024,
        total: os.totalmem() / 1024 / 1024,
        usedPercent: 100 - (os.freemem() / os.totalmem() * 100)
      },
      connections: {
        clients: io.engine.clientsCount,
        rooms: io.sockets.adapter.rooms.size,
        roomDetails: roomStats
      }
    };
    
    console.log('📈 System Stats:', JSON.stringify(usage, null, 2));
  }, 5000);

  // Clean up on process exit
  process.on('SIGINT', () => {
    clearInterval(monitoringInterval);
    clearInterval(roomCleanupInterval);
    process.exit(0);
  });
}

/**
 * Analyze Socket.IO rooms and categorize them
 */
function analyzeRooms(io: Server) {
  const rooms = io.sockets.adapter.rooms;
  let userRooms = 0;
  let chatRooms = 0;
  let abandonedRooms = 0;
  let otherRooms = 0;
  
  // Track empty rooms that need cleanup
  const emptyRooms: string[] = [];
  
  // Collect all socket IDs for quick lookup
  const socketIds = new Set<string>();
  for (const [id] of io.sockets.sockets) {
    socketIds.add(id);
  }
  
  // Analyze each room
  for (const [roomId, sockets] of rooms.entries()) {
    // User rooms (matching the socket ID)
    if (socketIds.has(roomId)) {
      userRooms++;
      continue;
    }
    
    // Chat rooms (follow the naming pattern)
    if (roomId.startsWith('room_')) {
      // Check if the room has expected number of users
      if (sockets.size === 2) {
        chatRooms++;
      } else if (sockets.size < 2) {
        // This is a chat room with missing participants - mark for cleanup
        abandonedRooms++;
        emptyRooms.push(roomId);
      } else {
        // Should never happen - chat rooms should have exactly 2 users
        console.log(`⚠️ Unusual room ${roomId} has ${sockets.size} users`);
        chatRooms++;
      }
      continue;
    }
    
    // Other rooms (unknown purpose)
    otherRooms++;
  }
  
  return {
    total: rooms.size,
    userRooms,
    chatRooms,
    abandonedRooms,
    otherRooms
  };
}

/**
 * Clean up abandoned rooms
 */
function cleanupAbandonedRooms(io: Server) {
  const rooms = io.sockets.adapter.rooms;
  let cleanedRooms = 0;
  
  // Collect all socket IDs for quick lookup
  const socketIds = new Set<string>();
  for (const [id] of io.sockets.sockets) {
    socketIds.add(id);
  }
  
  // Find abandoned rooms
  for (const [roomId, sockets] of rooms.entries()) {
    // Skip user rooms (matching the socket ID)
    if (socketIds.has(roomId)) {
      continue;
    }
    
    // Check chat rooms
    if (roomId.startsWith('room_')) {
      // Rooms with fewer than 2 users are candidates for cleanup
      if (sockets.size < 2) {
        // Clean up the room by removing all remaining users
        for (const socketId of sockets) {
          const socket = io.sockets.sockets.get(socketId);
          if (socket) {
            socket.leave(roomId);
          }
        }
        cleanedRooms++;
      }
    }
  }
  
  if (cleanedRooms > 0) {
    console.log(`🧹 Cleaned up ${cleanedRooms} abandoned rooms`);
  }
} 