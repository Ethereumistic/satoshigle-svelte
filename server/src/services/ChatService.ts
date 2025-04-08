/**
 * ChatService
 * Manages chat messaging between peers
 */
import { Server, Socket } from 'socket.io';
import logger from '../utils/logger.js';
import { UserManager } from './UserManager.js';
import { EventEmitter } from 'events';

// Chat message type
interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  isSystem?: boolean;
}

export class ChatService extends EventEmitter {
  private io: Server;
  private userManager: UserManager;
  private chatRooms: Map<string, Set<string>> = new Map();
  private activeSockets: Map<string, string> = new Map(); // socketId -> roomId

  /**
   * Create a new ChatService
   * @param io Socket.IO server instance
   * @param userManager User manager instance
   */
  constructor(io: Server, userManager: UserManager) {
    super();
    this.io = io;
    this.userManager = userManager;

    logger.info('ChatService initialized');
    
    // Log active users every 30 seconds
    setInterval(() => {
      logger.debug('Active chat rooms:', { 
        roomCount: this.chatRooms.size, 
        socketCount: this.activeSockets.size,
        rooms: Array.from(this.chatRooms.entries()).map(([roomId, users]) => ({
          roomId,
          userCount: users.size,
          users: Array.from(users)
        }))
      });
    }, 30000);
  }

  /**
   * Handle a new socket connection
   * @param socket Socket.IO socket
   */
  public handleConnection(socket: Socket): void {
    const userId = socket.id;
    logger.debug('Chat connection established', { userId });
    
    // Track this socket
    this.activeSockets.set(userId, '');

    // Set up event handlers for chat
    this.setupSocketHandlers(socket);
  }

  /**
   * Set up event handlers for a socket
   * @param socket Socket.IO socket
   */
  private setupSocketHandlers(socket: Socket): void {
    const userId = socket.id;

    // Join chat room
    socket.on('join-chat', (data) => {
      try {
        const { roomId } = data;
        if (!roomId) {
          logger.warn('Invalid roomId in join-chat', { userId });
          return;
        }

        // Check if user is already in another room
        const currentRoom = this.activeSockets.get(userId);
        if (currentRoom && currentRoom !== roomId) {
          // Leave the previous room first
          socket.leave(currentRoom);
          const previousRoomUsers = this.chatRooms.get(currentRoom);
          if (previousRoomUsers) {
            previousRoomUsers.delete(userId);
            if (previousRoomUsers.size === 0) {
              this.chatRooms.delete(currentRoom);
            }
          }
        }
        
        // Join the Socket.IO room
        socket.join(roomId);
        this.activeSockets.set(userId, roomId);
        
        // Track user in this chat room
        if (!this.chatRooms.has(roomId)) {
          this.chatRooms.set(roomId, new Set());
        }
        
        const roomUsers = this.chatRooms.get(roomId)!;
        roomUsers.add(userId);
        
        // Notify ALL users in the room (including this one)
        this.io.in(roomId).emit('chat-joined', { 
          roomId,
          userCount: roomUsers.size
        });
        
        // Send a welcome message to the room
        const systemMessage: ChatMessage = {
          id: `system_${Date.now()}`,
          senderId: 'system',
          senderName: 'System',
          content: `Chat connected with ${roomUsers.size} users`,
          isSystem: true
        };
        
        this.io.in(roomId).emit('chat-message', systemMessage);
      } catch (error) {
        logger.error('Error handling join-chat event', { 
          userId, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    });

    // Chat message
    socket.on('chat-message', (data) => {
      try {
        const { roomId, message } = data;
        
        if (!roomId || !message || !message.content) {
          logger.warn('Invalid message data', { userId });
          return;
        }
        
        // Forward message to everyone in the room except sender
        socket.to(roomId).emit('chat-message', message);
      } catch (error) {
        logger.error('Error handling chat-message event', { 
          userId, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    });

    // Typing indicators
    socket.on('typing-start', (data) => {
      try {
        const { roomId } = data;
        if (!roomId) return;
        
        socket.to(roomId).emit('typing-start', { userId });
      } catch (error) {
        logger.error('Error handling typing-start event', { 
          userId, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    });
    
    socket.on('typing-stop', (data) => {
      try {
        const { roomId } = data;
        if (!roomId) return;
        
        socket.to(roomId).emit('typing-stop', { userId });
      } catch (error) {
        logger.error('Error handling typing-stop event', { 
          userId, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      try {
        // Get the room this user was in
        const roomId = this.activeSockets.get(userId);
        this.activeSockets.delete(userId);
        
        if (roomId) {
          // Remove user from the room
          const roomUsers = this.chatRooms.get(roomId);
          if (roomUsers) {
            roomUsers.delete(userId);
            
            // Notify others in the room
            socket.to(roomId).emit('chat-user-left', { userId });
            
            // Clean up empty rooms
            if (roomUsers.size === 0) {
              this.chatRooms.delete(roomId);
            } else {
              // Send a system message about user leaving
              const systemMessage: ChatMessage = {
                id: `system_${Date.now()}`,
                senderId: 'system',
                senderName: 'System',
                content: 'Your chat partner left',
                isSystem: true
              };
              
              this.io.in(roomId).emit('chat-message', systemMessage);
            }
          }
        }
      } catch (error) {
        logger.error('Error handling disconnect event', { 
          userId, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    });
  }
}