/**
 * Monitoring Service
 * Tracks system resources, connection metrics, and performs cleanup
 */
import { Server } from 'socket.io';
import os from 'node:os';
import logger from '../utils/logger';
import { EventEmitter } from 'events';
import type { RoomStats, SystemStats } from '../models/types';
import { UserManager } from './UserManager';

export class MonitoringService extends EventEmitter {
  private io: Server;
  private userManager: UserManager;
  private roomCleanupInterval: NodeJS.Timeout | null = null;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private readonly ROOM_CLEANUP_INTERVAL_MS = 30000; // 30 seconds
  private readonly MONITORING_INTERVAL_MS = 5000; // 5 seconds

  constructor(io: Server, userManager: UserManager) {
    super();
    this.io = io;
    this.userManager = userManager;
    
    logger.info('MonitoringService initialized');
  }

  /**
   * Start monitoring and cleanup intervals
   */
  public start(): void {
    // Stop existing intervals if any
    this.stop();
    
    // Clean up abandoned rooms periodically
    this.roomCleanupInterval = setInterval(() => {
      this.cleanupAbandonedRooms();
    }, this.ROOM_CLEANUP_INTERVAL_MS);
    
    // Monitor system resources and connection stats
    this.monitoringInterval = setInterval(() => {
      const stats = this.collectSystemStats();
      
      // Emit monitoring event with stats
      this.emit('monitoring:stats', stats);
      
      // Log stats summary
      logger.info('System stats', {
        users: this.userManager.getUserCount(),
        waiting: this.userManager.getWaitingQueueSize(),
        memory: Math.round(stats.memory.usedPercent) + '%',
        cpu: Math.round(stats.cpu.loadavg * 100) / 100,
        connections: stats.connections.clients
      });
    }, this.MONITORING_INTERVAL_MS);
    
    logger.info('Monitoring started', {
      cleanupInterval: this.ROOM_CLEANUP_INTERVAL_MS,
      monitoringInterval: this.MONITORING_INTERVAL_MS
    });
  }

  /**
   * Stop monitoring and cleanup intervals
   */
  public stop(): void {
    if (this.roomCleanupInterval) {
      clearInterval(this.roomCleanupInterval);
      this.roomCleanupInterval = null;
    }
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    logger.info('Monitoring stopped');
  }

  /**
   * Collect system statistics
   * @returns System statistics
   */
  private collectSystemStats(): SystemStats {
    // Calculate room statistics
    const roomStats = this.analyzeRooms();
    
    // Calculate system resource usage
    const stats: SystemStats = {
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
        clients: this.io.engine.clientsCount,
        rooms: this.io.sockets.adapter.rooms.size,
        roomDetails: roomStats
      }
    };
    
    return stats;
  }

  /**
   * Analyze Socket.IO rooms and categorize them
   * @returns Room statistics
   */
  private analyzeRooms(): RoomStats {
    const rooms = this.io.sockets.adapter.rooms;
    const stats: RoomStats = {
      total: rooms.size,
      userRooms: 0,
      chatRooms: 0,
      abandonedRooms: 0,
      otherRooms: 0
    };
    
    // Collect all socket IDs for quick lookup
    const socketIds = new Set<string>();
    for (const [id] of this.io.sockets.sockets) {
      socketIds.add(id);
    }
    
    // Analyze each room
    for (const [roomId, sockets] of rooms.entries()) {
      // User rooms (matching the socket ID)
      if (socketIds.has(roomId)) {
        stats.userRooms++;
        continue;
      }
      
      // Chat rooms (follow the naming pattern)
      if (roomId.startsWith('room_')) {
        // Check if the room has expected number of users
        if (sockets.size === 2) {
          stats.chatRooms++;
        } else if (sockets.size < 2) {
          // This is a chat room with missing participants
          stats.abandonedRooms++;
        } else {
          // Should never happen - chat rooms should have exactly 2 users
          logger.warn('Unusual room size', { roomId, size: sockets.size });
          stats.chatRooms++;
        }
        continue;
      }
      
      // Other rooms (unknown purpose)
      stats.otherRooms++;
    }
    
    return stats;
  }

  /**
   * Clean up abandoned rooms
   */
  private cleanupAbandonedRooms(): void {
    const rooms = this.io.sockets.adapter.rooms;
    let cleanedRooms = 0;
    
    // Collect all socket IDs for quick lookup
    const socketIds = new Set<string>();
    for (const [id] of this.io.sockets.sockets) {
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
            const socket = this.io.sockets.sockets.get(socketId);
            if (socket) {
              socket.leave(roomId);
              logger.debug('User removed from abandoned room', { 
                userId: socketId, 
                roomId 
              });
            }
          }
          cleanedRooms++;
        }
      }
    }
    
    if (cleanedRooms > 0) {
      logger.info('Cleaned up abandoned rooms', { count: cleanedRooms });
      this.emit('monitoring:roomsCleanup', { cleanedRooms });
    }
  }
} 