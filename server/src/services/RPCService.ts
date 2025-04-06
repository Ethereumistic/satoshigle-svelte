/**
 * RPCService
 * Handles game-related Socket.IO messaging between peers
 */
import { Server, Socket } from 'socket.io';
import logger from '../utils/logger.js';
import { UserManager } from './UserManager.js';
import { EventEmitter } from 'events';
import { env } from '../config/environment.js';

// Game-related types
interface GameInvite {
  game: string;
  settings: Record<string, any>;
  roomId?: string; // Make roomId optional in the interface
}

interface GameResponse {
  game: string;
  accepted: boolean;
  roomId?: string; // Add roomId to GameResponse
  settings?: Record<string, any>; // Add settings for flexibility
}

interface GameAction {
  game: string;
  type: string;
  data: any;
  roomId?: string; // Add roomId to GameAction
  settings?: Record<string, any>; // Add settings for flexibility
}

export class RPCService extends EventEmitter {
  private io: Server;
  private userManager: UserManager;
  private gameRooms: Map<string, Set<string>> = new Map(); // roomId -> set of user IDs
  private rateLimits: Map<string, { count: number, lastReset: number }> = new Map();

  /**
   * Create a new RPCService for game communication
   * @param io Socket.IO server instance
   * @param userManager User manager instance
   */
  constructor(io: Server, userManager: UserManager) {
    super();
    this.io = io;
    this.userManager = userManager;
    logger.info('RPCService initialized');
  }

  /**
   * Handle a new socket connection for game RPC
   * @param socket Socket.IO socket
   */
  public handleConnection(socket: Socket): void {
    const userId = socket.id;

    // Handle game room joining
    socket.on('join-game-room', ({ roomId }) => {
      logger.info('User joining game room', { userId, roomId, socketId: socket.id });
      
      // Check if the user exists in UserManager
      const user = this.userManager.getUser(userId);
      if (!user) {
        logger.warn('User not found for join-game-room', { userId, roomId });
        // Allow joining anyway, since the WebRTC connection might be valid
        // even if the UserManager doesn't have the correct state
      }
      
      // Log the user state but don't block based on it
      if (user && user.state !== 'matched') {
        logger.warn('User not in matched state for join-game-room, but allowing anyway', { 
          userId, 
          state: user.state, 
          roomId 
        });
      }
      
      // Find partner ID either from UserManager or try to infer from roomId
      let partnerId = user?.matchedWith || null;
      
      // If we can't get the matched partner from user state,
      // try to derive it from the room ID or existing game rooms
      if (!partnerId) {
        // Look up existing connections in the same room
        const existingUsers = this.gameRooms.get(roomId);
        if (existingUsers && existingUsers.size > 0) {
          // Use the first user that's not the current user
          for (const existingUserId of existingUsers) {
            if (existingUserId !== userId) {
              partnerId = existingUserId;
              break;
            }
          }
        }
        logger.info('Inferred partner ID from existing game room', { 
          userId, 
          roomId, 
          inferredPartnerId: partnerId 
        });
      }
      
      const gameRoomId = `game:${roomId}`;
      
      // Always join the socket to this room
      socket.join(gameRoomId);
      
      // Track users in this game room
      if (!this.gameRooms.has(roomId)) {
        this.gameRooms.set(roomId, new Set());
      }
      this.gameRooms.get(roomId)?.add(userId);
      
      // Store user ID in socket data for easier lookup
      socket.data = socket.data || {};
      socket.data.userId = userId;
      socket.data.gameRoomId = gameRoomId;
      
      logger.info('User joined game room successfully', { 
        userId, 
        roomId, 
        gameRoomId,
        partner: partnerId,
        socketRooms: Array.from(socket.rooms || [])
      });
      
      // Notify the user that they have joined the room successfully
      socket.emit('game-room-joined', { roomId, partnerId });
    });
    
    // Game invite event - forward to the other user in the room
    socket.on('game-invite', (invite: GameInvite) => {
      logger.info('Received game-invite event', { userId, invite, socketId: socket.id });
      
      if (!this.checkRateLimit(userId, 'game-invite')) {
        logger.warn('Rate limit exceeded for game-invite', { userId });
        return;
      }
      
      const roomId = invite.roomId || (typeof invite === 'object' && invite.settings && invite.settings.roomId);
      if (!roomId) {
        logger.warn('No roomId provided in game-invite', { userId, invite });
        return;
      }
      
      // Check if user exists but don't block based on state
      const user = this.userManager.getUser(userId);
      let partnerId = user?.matchedWith || null;
      
      // Try to find partner in the game room if not available from UserManager
      if (!partnerId) {
        // Check the game room members
        const gameRoom = this.gameRooms.get(roomId);
        if (gameRoom) {
          for (const memberId of gameRoom) {
            if (memberId !== userId) {
              partnerId = memberId;
              break;
            }
          }
        }
      }
      
      logger.info('Processing game invite', { 
        from: userId, 
        to: partnerId || 'unknown', 
        game: invite.game,
        roomId: roomId
      });
      
      // Try multiple methods to ensure delivery:
      
      // 1. Broadcast to all sockets in the game room except sender
      const gameRoomId = `game:${roomId}`;
      socket.to(gameRoomId).emit('game-invite', invite);
      logger.info('Method 1: Broadcast game-invite to game room', { gameRoomId });
      
      // 2. Send directly to partner socket ID if we know it
      if (partnerId) {
        this.io.to(partnerId).emit('game-invite', invite);
        logger.info('Method 2: Emitted game-invite to partner socket ID', { partnerId });
      }
      
      // 3. Find partner's socket directly and send
      try {
        // Get all sockets in the room except this one
        const socketsInRoom = Array.from(this.io.sockets.sockets.values())
          .filter(s => 
            s.id !== socket.id && 
            s.rooms && 
            s.rooms.has(gameRoomId)
          );
        
        if (socketsInRoom.length > 0) {
          for (const partnerSocket of socketsInRoom) {
            partnerSocket.emit('game-invite', invite);
            logger.info('Method 3: Direct socket emit game-invite to socket in room', { 
              partnerSocketId: partnerSocket.id 
            });
          }
        } else {
          logger.warn('No other sockets found in game room', { gameRoomId });
        }
      } catch (err) {
        logger.error('Error finding sockets in room', { error: String(err) });
      }
    });
    
    // Game response event - forward to the other user in the room
    socket.on('game-response', (response: GameResponse) => {
      logger.info('Received game-response event', { userId, response, socketId: socket.id });
      
      if (!this.checkRateLimit(userId, 'game-response')) {
        logger.warn('Rate limit exceeded for game-response', { userId });
        return;
      }
      
      // Try to get game room ID from socket data or from response
      const roomId = socket.data?.gameRoomId || 
                     (response as any).roomId || 
                     (typeof response === 'object' && response.settings && response.settings.roomId);
      
      // Get user but don't block based on state
      const user = this.userManager.getUser(userId);
      let partnerId = user?.matchedWith || null;
      
      // Try to find partner in game room if needed
      if (!partnerId && roomId) {
        // Extract standard room ID if we have a gameRoomId (e.g. "game:roomId")
        const standardRoomId = roomId.startsWith('game:') ? roomId.substring(5) : roomId;
        const gameRoom = this.gameRooms.get(standardRoomId);
        if (gameRoom) {
          for (const memberId of gameRoom) {
            if (memberId !== userId) {
              partnerId = memberId;
              break;
            }
          }
        }
      }
      
      logger.info('Processing game response', { 
        from: userId, 
        to: partnerId || 'unknown', 
        game: response.game,
        roomId: roomId || 'unknown',
        accepted: response.accepted
      });
      
      // Try multiple methods to ensure delivery
      
      // 1. Broadcast to game room if we know it
      if (roomId && roomId.startsWith('game:')) {
        socket.to(roomId).emit('game-response', response);
        logger.info('Method 1: Broadcast game-response to game room', { gameRoomId: roomId });
      }
      
      // 2. Send directly to partner if we know them
      if (partnerId) {
        this.io.to(partnerId).emit('game-response', response);
        logger.info('Method 2: Emitted game-response to partner socket ID', { partnerId });
      }
      
      // 3. Try to find partner's socket directly
      try {
        // If we have a game room ID, find all sockets in that room
        if (roomId && roomId.startsWith('game:')) {
          const socketsInRoom = Array.from(this.io.sockets.sockets.values())
            .filter(s => 
              s.id !== socket.id && 
              s.rooms && 
              s.rooms.has(roomId)
            );
          
          if (socketsInRoom.length > 0) {
            for (const partnerSocket of socketsInRoom) {
              partnerSocket.emit('game-response', response);
              logger.info('Method 3: Direct socket emit game-response to socket in room', { 
                partnerSocketId: partnerSocket.id 
              });
            }
          }
        }
      } catch (err) {
        logger.error('Error finding sockets in room for game-response', { error: String(err) });
      }
    });
    
    // Game action event - forward to the other user in the room
    socket.on('game-action', (action: GameAction) => {
      logger.info('Received game-action event', { userId, action, socketId: socket.id });
      
      if (!this.checkRateLimit(userId, 'game-action')) {
        logger.warn('Rate limit exceeded for game-action', { userId });
        return;
      }
      
      // Try to get game room ID from socket data or from action
      const roomId = socket.data?.gameRoomId || 
                     (action as any).roomId || 
                     (typeof action === 'object' && action.settings && action.settings.roomId);
      
      // Get user but don't block based on state
      const user = this.userManager.getUser(userId);
      let partnerId = user?.matchedWith || null;
      
      // Try to find partner in game room if needed
      if (!partnerId && roomId) {
        // Extract standard room ID if we have a gameRoomId (e.g. "game:roomId")
        const standardRoomId = roomId.startsWith('game:') ? roomId.substring(5) : roomId;
        const gameRoom = this.gameRooms.get(standardRoomId);
        if (gameRoom) {
          for (const memberId of gameRoom) {
            if (memberId !== userId) {
              partnerId = memberId;
              break;
            }
          }
        }
      }
      
      logger.info('Processing game action', { 
        from: userId, 
        to: partnerId || 'unknown', 
        game: action.game,
        type: action.type,
        roomId: roomId || 'unknown'
      });
      
      // Try multiple methods to ensure delivery
      
      // 1. Broadcast to game room if we know it
      if (roomId && roomId.startsWith('game:')) {
        socket.to(roomId).emit('game-action', action);
        logger.info('Method 1: Broadcast game-action to game room', { gameRoomId: roomId });
      }
      
      // 2. Send directly to partner if we know them
      if (partnerId) {
        this.io.to(partnerId).emit('game-action', action);
        logger.info('Method 2: Emitted game-action to partner socket ID', { partnerId });
      }
      
      // 3. Try to find partner's socket directly
      try {
        // If we have a game room ID, find all sockets in that room
        if (roomId && roomId.startsWith('game:')) {
          const socketsInRoom = Array.from(this.io.sockets.sockets.values())
            .filter(s => 
              s.id !== socket.id && 
              s.rooms && 
              s.rooms.has(roomId)
            );
          
          if (socketsInRoom.length > 0) {
            for (const partnerSocket of socketsInRoom) {
              partnerSocket.emit('game-action', action);
              logger.info('Method 3: Direct socket emit game-action to socket in room', { 
                partnerSocketId: partnerSocket.id 
              });
            }
          }
        }
      } catch (err) {
        logger.error('Error finding sockets in room for game-action', { error: String(err) });
      }
    });

    // Debug endpoint to list all connected sockets
    socket.on('debug-game-connections', () => {
      try {
        const socketInfo: Record<string, any>[] = [];
        
        // Get all socket IDs
        for (const [id, socket] of this.io.sockets.sockets.entries()) {
          const user = this.userManager.getUser(id);
          const rooms = Array.from(socket.rooms || []);
          
          socketInfo.push({
            socketId: id,
            userId: id,
            rooms: rooms,
            matchedWith: user?.matchedWith || null,
            state: user?.state || 'unknown'
          });
        }
        
        // Get all game rooms
        const gameRooms: Record<string, string[]> = {};
        for (const [roomId, userIds] of this.gameRooms.entries()) {
          gameRooms[roomId] = Array.from(userIds);
        }
        
        const debug = {
          socketCount: this.io.sockets.sockets.size,
          sockets: socketInfo,
          gameRooms: gameRooms
        };
        
        logger.info('Debug game connections', debug);
        socket.emit('debug-game-connections-result', debug);
      } catch (err) {
        logger.error('Error in debug-game-connections', { error: String(err) });
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      // Clean up any game rooms this user was part of
      for (const [roomId, users] of this.gameRooms.entries()) {
        if (users.has(userId)) {
          users.delete(userId);
          logger.debug('User removed from game room on disconnect', { userId, roomId });
          
          // Clean up empty rooms
          if (users.size === 0) {
            this.gameRooms.delete(roomId);
            logger.debug('Empty game room removed', { roomId });
          }
        }
      }
    });
  }

  /**
   * Check if a user has exceeded rate limits for an action
   * @param userId User ID to check
   * @param action Action being performed
   * @returns true if allowed, false if exceeded
   */
  private checkRateLimit(userId: string, action: string): boolean {
    const key = `${userId}:${action}`;
    const now = Date.now();
    const limit = this.rateLimits.get(key) || { count: 0, lastReset: now };
    
    // Reset count if window has passed
    if (now - limit.lastReset > env.RATE_LIMIT_WINDOW_MS) {
      limit.count = 0;
      limit.lastReset = now;
    }
    
    // Increment counter
    limit.count++;
    this.rateLimits.set(key, limit);
    
    // Check if limit exceeded
    if (limit.count > env.RATE_LIMIT_MAX_REQUESTS) {
      logger.warn('Rate limit exceeded', { userId, action, count: limit.count });
      return false;
    }
    
    return true;
  }
} 