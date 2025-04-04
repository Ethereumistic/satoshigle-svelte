/**
 * SignalingService
 * Manages WebRTC signaling between peers
 */
import { Server, Socket } from 'socket.io';
import logger from '../utils/logger.js';
import { UserManager } from './UserManager.js';
import type { SignalData, MatchReadyEvent, ConnectionErrorEvent } from '../models/types.js';
import { EventEmitter } from 'events';
import { env } from '../config/environment.js';

export class SignalingService extends EventEmitter {
  private io: Server;
  private userManager: UserManager;
  private rateLimits: Map<string, { count: number, lastReset: number }> = new Map();

  /**
   * Create a new SignalingService
   * @param io Socket.IO server instance
   * @param userManager User manager instance
   */
  constructor(io: Server, userManager: UserManager) {
    super();
    this.io = io;
    this.userManager = userManager;

    // Listen for user manager events to respond accordingly
    this.setupUserManagerListeners();

    logger.info('SignalingService initialized');
  }

  /**
   * Set up event listeners for user manager events
   */
  private setupUserManagerListeners(): void {
    // When a match is created, notify both users
    this.userManager.on('match:created', (data) => {
      const { roomId, user1, user2 } = data;

      // Notify first user
      this.sendMatchReady(user1.id, {
        roomId,
        isInitiator: user1.isInitiator,
        peerId: user2.id,
        forced: false
      });

      // Notify second user
      this.sendMatchReady(user2.id, {
        roomId,
        isInitiator: user2.isInitiator,
        peerId: user1.id,
        forced: false
      });
    });

    // When a user disconnects from a match, notify their partner
    this.userManager.on('user:disconnected', ({ userId, partnerId }) => {
      this.io.to(partnerId).emit('peer-disconnected');
      logger.debug('Sent peer-disconnected event', { to: partnerId, from: userId });
      
      // Also notify partner they're waiting for a new peer
      this.io.to(partnerId).emit('waiting-for-peer');
      logger.debug('Sent waiting-for-peer event after disconnect', { to: partnerId });
      
      // Try to find a new match for the partner
      setTimeout(() => this.userManager.findMatchForUser(partnerId), 100);
    });

    // When a match is skipped, notify the partner
    this.userManager.on('match:skipped', ({ userId, partnerId }) => {
      this.io.to(partnerId).emit('peer-skipped');
      logger.debug('Sent peer-skipped event', { to: partnerId, from: userId });
    });
  }

  /**
   * Handle a new socket connection
   * @param socket Socket.IO socket
   */
  public handleConnection(socket: Socket): void {
    const userId = socket.id;
    logger.info('New connection', { userId });

    // Create user
    const user = this.userManager.addUser(userId);

    // Set up event handlers for this socket
    this.setupSocketHandlers(socket);
  }

  /**
   * Send match ready event to a user
   * @param userId User ID to send to
   * @param data Match data
   */
  private sendMatchReady(userId: string, data: MatchReadyEvent): void {
    this.io.to(userId).emit('match-ready', {
      roomId: data.roomId,
      isInitiator: data.isInitiator,
      peerId: data.peerId
    });
    logger.debug('Sent match-ready event', { 
      to: userId, 
      roomId: data.roomId,
      isInitiator: data.isInitiator,
      peerId: data.peerId
    });
  }

  /**
   * Send connection error to a user
   * @param userId User ID to send to
   * @param data Error data
   */
  private sendConnectionError(userId: string, data: ConnectionErrorEvent): void {
    this.io.to(userId).emit('connection-error', data);
    logger.warn('Sent connection-error event', { 
      to: userId, 
      message: data.message 
    });
  }

  /**
   * Set up event handlers for a socket
   * @param socket Socket.IO socket
   */
  private setupSocketHandlers(socket: Socket): void {
    const userId = socket.id;

    // Debug state request
    socket.on('debug-state', () => {
      logger.debug('Debug state requested', { userId });
      
      const user = this.userManager.getUser(userId);
      if (user) {
        const debugData = {
          state: user.state,
          inWaitingQueue: this.userManager.getWaitingQueue().includes(userId),
          queuePosition: this.userManager.getWaitingQueue().indexOf(userId),
          waitingQueueSize: this.userManager.getWaitingQueueSize(),
          totalUsers: this.userManager.getUserCount()
        };
        
        socket.emit('debug-info', debugData);
        logger.debug('Sent debug info', { to: userId, data: debugData });
      }
    });

    // Start search
    socket.on('start-search', () => {
      logger.info('User started search', { userId });
      
      const user = this.userManager.getUser(userId);
      if (!user) return;
      
      // If user was already matched, handle like a skip
      if (user.state === 'matched' && user.matchedWith) {
        this.userManager.handleSkip(userId);
      }

      // Reset recent matches if it's been a while
      const now = Date.now();
      if (now - user.joinedAt > 30000) { // If inactive for 30+ seconds
        // Keep the most recent 3 matches to prevent immediate rematching
        const recentMatches = Array.from(user.previousMatches).slice(-3);
        user.previousMatches = new Set(recentMatches);
      }
      
      // Update user state to waiting
      this.userManager.updateUserState(userId, 'waiting');
      
      // Notify user they're waiting
      socket.emit('waiting-for-peer');
      logger.debug('Sent waiting-for-peer event', { to: userId });
      
      // Try to find a match
      this.userManager.processWaitingQueue();
    });

    // Skip current match
    socket.on('skip', () => {
      logger.info('User skipped match', { userId });
      
      // Handle skip through user manager
      if (this.userManager.handleSkip(userId)) {
        // Notify user they're waiting again
        socket.emit('waiting-for-peer');
        logger.debug('Sent waiting-for-peer event after skip', { to: userId });
        
        // Try to find new matches
        this.userManager.processWaitingQueue();
      }
    });

    // Stop search
    socket.on('stop-search', () => {
      logger.info('User stopped search', { userId });
      
      const user = this.userManager.getUser(userId);
      if (!user) return;
      
      // Handle like a skip if user was matched
      if (user.state === 'matched' && user.matchedWith) {
        const partnerId = user.matchedWith;
        const partner = this.userManager.getUser(partnerId);
        
        // Reset this user's state first
        user.state = 'idle';
        user.matchedWith = null;
        
        // Have them leave any rooms
        for (const room of socket.rooms) {
          if (room !== userId) {
            socket.leave(room);
            logger.debug('User left room due to stop-search', { userId, room });
          }
        }
        
        if (partner) {
          // Make sure partner is not matched with this user anymore
          if (partner.matchedWith === userId) {
            // Reset partner's state
            partner.state = 'waiting';
            partner.matchedWith = null;
            
            // Notify partner
            this.io.to(partnerId).emit('peer-disconnected');
            logger.debug('Sent peer-disconnected event', { to: partnerId });
            
            // Add partner to waiting queue
            this.userManager.addToWaitingQueue(partnerId);
            
            // Try to find a new match for the partner
            this.userManager.findMatchForUser(partnerId);
          }
        }
      }
      
      // Remove from waiting queue
      this.userManager.removeFromWaitingQueue(userId);
      
      // Update state to idle
      this.userManager.updateUserState(userId, 'idle');
      
      // Process waiting queue to match other users
      setTimeout(() => this.userManager.processWaitingQueue(), 100);
    });

    // WebRTC signaling
    socket.on('signal', (data) => {
      // Rate limiting
      if (!this.checkRateLimit(userId, 'signal')) {
        logger.warn('Rate limit exceeded for signal', { userId });
        this.sendConnectionError(userId, { message: 'Rate limit exceeded for signaling' });
        return;
      }
      
      try {
        // Verify user exists and is in matched state
        const user = this.userManager.getUser(userId);
        if (!user || user.state !== 'matched' || !user.matchedWith) {
          logger.warn('Unauthorized signal attempt', { userId, state: user?.state });
          this.sendConnectionError(userId, { message: 'Connection error - please reconnect' });
          return;
        }
        
        // Verify the roomId is present
        if (!data.roomId || typeof data.roomId !== 'string') {
          logger.warn('Invalid roomId in signal', { userId });
          return;
        }
        
        // Get partner user
        const partnerId = user.matchedWith;
        const partner = this.userManager.getUser(partnerId);
        
        // Additional safety: Verify bidirectional match
        if (!partner || partner.state !== 'matched' || partner.matchedWith !== userId) {
          logger.warn('Partner mismatch in signal', { 
            userId, 
            partnerId,
            partnerState: partner?.state,
            partnerMatchedWith: partner?.matchedWith
          });
          
          // Connection state is inconsistent - reset both users
          this.sendConnectionError(userId, { message: 'Connection error - please reconnect' });
          
          if (partner) {
            this.io.to(partnerId).emit('connection-error', { message: 'Connection error - please reconnect' });
          }
          
          // Reset user state
          this.userManager.updateUserState(userId, 'waiting');
          
          // Reset partner state if it exists
          if (partner) {
            this.userManager.updateUserState(partnerId, 'waiting');
          }
          
          return;
        }
        
        // Forward signal to partner
        socket.to(partnerId).emit('signal', data);
        logger.debug('Forwarded signal', { from: userId, to: partnerId, type: data.type });
      } catch (err) {
        logger.error('Error processing signal', { userId, error: (err as Error).message });
        this.sendConnectionError(userId, { message: 'Error processing signal' });
      }
    });

    // Match acknowledgment
    socket.on('match-ready', (data) => {
      logger.debug('Match acknowledged', { userId, matchId: data.matchId });
      // No additional action needed
    });

    // Disconnection
    socket.on('disconnect', () => {
      logger.info('User disconnected', { userId });
      this.userManager.removeUser(userId);
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