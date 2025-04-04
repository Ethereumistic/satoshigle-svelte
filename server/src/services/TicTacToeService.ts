/**
 * TicTacToeService
 * Manages Tic Tac Toe game state and logic on the server
 */
import { Server, Socket } from 'socket.io';
import { EventEmitter } from 'events';
import logger from '../utils/logger';
import { UserManager } from './UserManager';

// Game-specific types
type GamePlayer = 'X' | 'O';
type TicTacToeBoard = Array<GamePlayer | null>;
type GameStatus = 'waiting' | 'playing' | 'completed';

// Game data structure
interface TicTacToeGame {
  id: string;
  board: TicTacToeBoard;
  currentTurn: GamePlayer;
  player1: {
    id: string;
    symbol: GamePlayer;
  };
  player2: {
    id: string;
    symbol: GamePlayer;
  };
  status: GameStatus;
  winner: GamePlayer | null;
  isDraw: boolean;
  createdAt: number;
  lastMoveAt: number;
  moveHistory: Array<{
    player: string;
    position: number;
    timestamp: number;
  }>;
}

export class TicTacToeService extends EventEmitter {
  private io: Server;
  private userManager: UserManager;
  private games: Map<string, TicTacToeGame> = new Map();
  private playerGameMap: Map<string, string> = new Map(); // Maps player ID to game ID
  
  // Game timeout settings (in milliseconds)
  private readonly TURN_TIMEOUT = 15000; // 15 seconds per turn
  private readonly GAME_EXPIRY = 300000; // 5 minutes for inactive games

  /**
   * Create a new TicTacToeService
   * @param io Socket.IO server instance
   * @param userManager User manager instance for player information
   */
  constructor(io: Server, userManager: UserManager) {
    super();
    this.io = io;
    this.userManager = userManager;

    // Start cleanup intervals
    this.startMaintenanceIntervals();

    logger.info('TicTacToeService initialized');
  }

  /**
   * Start intervals for cleaning up expired games and invitations
   */
  private startMaintenanceIntervals(): void {
    // Clean up inactive games every minute
    setInterval(() => this.cleanupInactiveGames(), 60000);
  }

  /**
   * Handle game events from a socket
   * @param socket Socket.IO socket
   */
  public handleSocketEvents(socket: Socket): void {
    const playerId = socket.id;

    // Direct game start request (simplified approach)
    socket.on('tic-tac-toe-start', (data) => {
      try {
        const { peerId } = data;
        
        logger.info('Tic Tac Toe direct start request', { from: playerId, to: peerId });
        
        // Create request and notify the peer
        this.io.to(peerId).emit('tic-tac-toe-request', {
          from: playerId,
          requestId: `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
        });
        
        logger.debug('Sent tic-tac-toe-request to peer', { from: playerId, to: peerId });
      } catch (error) {
        logger.error('Error handling direct game start request', { error, playerId });
        socket.emit('game-error', {
          game: 'tic-tac-toe',
          message: 'Failed to request game start'
        });
      }
    });
    
    // Handle game request response
    socket.on('tic-tac-toe-response', (data) => {
      try {
        const { accepted, requesterId, requestId } = data;
        
        logger.info('Tic Tac Toe request response', { 
          from: playerId,
          to: requesterId,
          accepted
        });
        
        if (accepted) {
          // Create new game between the two players
          const game = this.createGame(requesterId, playerId);
          
          // Notify both players that the game has started
          this.notifyGameStart(game);
          
          logger.info('Game created after acceptance', { 
            gameId: game.id,
            player1: game.player1.id,
            player2: game.player2.id
          });
        } else {
          // Notify requester that the game was declined
          this.io.to(requesterId).emit('tic-tac-toe-declined', {
            from: playerId
          });
          
          logger.debug('Game request was declined', { by: playerId, to: requesterId });
        }
      } catch (error) {
        logger.error('Error handling game request response', { error, playerId });
      }
    });

    // Game moves
    socket.on('game-move', (data) => {
      try {
        const { moveData } = data;
        const index = moveData?.index;
        
        // Validate move
        if (typeof index !== 'number' || index < 0 || index > 8) {
          logger.warn('Invalid move index', { playerId, index });
          return;
        }
        
        // Process the move
        const gameId = this.playerGameMap.get(playerId);
        if (!gameId) {
          logger.warn('Player not in a game', { playerId });
          return;
        }
        
        const result = this.makeMove(gameId, playerId, index);
        if (result.success) {
          // Get opponent ID
          const game = this.games.get(gameId)!;
          const opponentId = game.player1.id === playerId ? game.player2.id : game.player1.id;
          
          // Forward move to opponent
          this.io.to(opponentId).emit('game-move', {
            game: 'tic-tac-toe',
            moveData: { index },
            from: playerId
          });
          
          // If game ended, notify both players
          if (result.gameEnded) {
            this.notifyGameEnd(game);
          }
        } else {
          // Send error to player
          socket.emit('game-error', {
            message: result.message || 'Invalid move'
          });
        }
      } catch (error) {
        logger.error('Error processing game move', { error, playerId });
      }
    });

    // Game reset/play again
    socket.on('game-reset', (data) => {
      try {
        const { to } = data;
        
        // Check if in a game
        const gameId = this.playerGameMap.get(playerId);
        if (!gameId) {
          // No active game to reset
          return;
        }
        
        // Reset the game
        const game = this.resetGame(gameId);
        if (game) {
          // Notify both players
          this.io.to(game.player1.id).emit('game-reset', {
            game: 'tic-tac-toe',
            gameId: game.id
          });
          
          this.io.to(game.player2.id).emit('game-reset', {
            game: 'tic-tac-toe',
            gameId: game.id
          });
        }
      } catch (error) {
        logger.error('Error resetting game', { error, playerId });
      }
    });

    // Game timeout (when a player takes too long)
    socket.on('game-timeout', (data) => {
      try {
        const { to } = data;
        
        // Get game ID
        const gameId = this.playerGameMap.get(playerId);
        if (!gameId) return;
        
        const game = this.games.get(gameId);
        if (!game) return;
        
        // Handle timeout by making a random move
        if (game.status === 'playing' && 
            ((game.currentTurn === game.player1.symbol && game.player1.id === playerId) ||
             (game.currentTurn === game.player2.symbol && game.player2.id === playerId))) {
          
          // Find empty cells
          const emptyCells = game.board
            .map((cell, index) => ({ cell, index }))
            .filter(item => item.cell === null)
            .map(item => item.index);
          
          if (emptyCells.length > 0) {
            // Make a random move
            const randomIndex = Math.floor(Math.random() * emptyCells.length);
            const moveIndex = emptyCells[randomIndex];
            
            // Process the move
            const result = this.makeMove(gameId, playerId, moveIndex);
            
            if (result.success) {
              // Get opponent ID
              const opponentId = game.player1.id === playerId ? game.player2.id : game.player1.id;
              
              // Forward timeout notification
              this.io.to(opponentId).emit('game-timeout', {
                game: 'tic-tac-toe',
                from: playerId
              });
              
              // Forward move to opponent
              this.io.to(opponentId).emit('game-move', {
                game: 'tic-tac-toe',
                moveData: { index: moveIndex },
                from: playerId
              });
              
              // If game ended, notify both players
              if (result.gameEnded) {
                this.notifyGameEnd(game);
              }
            }
          }
        }
      } catch (error) {
        logger.error('Error handling game timeout', { error, playerId });
      }
    });

    // Game cancel
    socket.on('game-cancel', (data) => {
      try {
        const { to } = data;
        
        // Get game ID
        const gameId = this.playerGameMap.get(playerId);
        if (!gameId) return;
        
        // End the game
        this.endGame(gameId, 'cancelled');
        
        // Notify the opponent
        this.io.to(to).emit('game-cancel', {
          game: 'tic-tac-toe',
          from: playerId
        });
      } catch (error) {
        logger.error('Error cancelling game', { error, playerId });
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      // Handle any active games
      this.handlePlayerDisconnect(playerId);
    });
  }

  /**
   * Create a new game between two players
   * @param player1Id First player ID
   * @param player2Id Second player ID
   * @returns Created game
   */
  private createGame(player1Id: string, player2Id: string): TicTacToeGame {
    const gameId = `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();
    
    // Randomly assign X and O
    const firstPlayerSymbol: GamePlayer = Math.random() > 0.5 ? 'X' : 'O';
    const secondPlayerSymbol: GamePlayer = firstPlayerSymbol === 'X' ? 'O' : 'X';
    
    const game: TicTacToeGame = {
      id: gameId,
      board: Array(9).fill(null),
      currentTurn: 'X', // X always starts
      player1: {
        id: player1Id,
        symbol: firstPlayerSymbol
      },
      player2: {
        id: player2Id,
        symbol: secondPlayerSymbol
      },
      status: 'playing',
      winner: null,
      isDraw: false,
      createdAt: now,
      lastMoveAt: now,
      moveHistory: []
    };
    
    // Store game
    this.games.set(gameId, game);
    
    // Map players to this game
    this.playerGameMap.set(player1Id, gameId);
    this.playerGameMap.set(player2Id, gameId);
    
    logger.info('Game created', { 
      gameId, 
      player1: player1Id, 
      player2: player2Id 
    });
    
    return game;
  }

  /**
   * Make a move in a game
   * @param gameId Game ID
   * @param playerId Player making the move
   * @param position Board position (0-8)
   * @returns Result of the move
   */
  private makeMove(gameId: string, playerId: string, position: number): { 
    success: boolean; 
    message?: string;
    gameEnded: boolean; 
  } {
    const game = this.games.get(gameId);
    if (!game) {
      return { success: false, message: 'Game not found', gameEnded: false };
    }
    
    // Check if game is active
    if (game.status !== 'playing') {
      return { success: false, message: 'Game is not active', gameEnded: false };
    }
    
    // Check if position is valid
    if (position < 0 || position > 8 || game.board[position] !== null) {
      return { success: false, message: 'Invalid move position', gameEnded: false };
    }
    
    // Determine player's symbol
    const playerSymbol = game.player1.id === playerId 
      ? game.player1.symbol 
      : game.player2.symbol;
    
    // Check if it's player's turn
    if (game.currentTurn !== playerSymbol) {
      return { success: false, message: 'Not your turn', gameEnded: false };
    }
    
    // Update the board
    game.board[position] = playerSymbol;
    
    // Add to move history
    game.moveHistory.push({
      player: playerId,
      position,
      timestamp: Date.now()
    });
    
    // Update last move timestamp
    game.lastMoveAt = Date.now();
    
    // Check for winner
    const winner = this.checkWinner(game.board);
    if (winner) {
      game.status = 'completed';
      game.winner = winner;
      logger.info('Game completed with winner', { gameId, winner });
      return { success: true, gameEnded: true };
    }
    
    // Check for draw
    if (this.checkDraw(game.board)) {
      game.status = 'completed';
      game.isDraw = true;
      logger.info('Game completed with draw', { gameId });
      return { success: true, gameEnded: true };
    }
    
    // Switch turns
    game.currentTurn = game.currentTurn === 'X' ? 'O' : 'X';
    
    return { success: true, gameEnded: false };
  }

  /**
   * Reset a game for a rematch
   * @param gameId Game ID
   * @returns Reset game
   */
  private resetGame(gameId: string): TicTacToeGame | null {
    const game = this.games.get(gameId);
    if (!game) return null;
    
    // Create a new game with switched player symbols
    const now = Date.now();
    
    // Switch symbols for the rematch
    const player1Symbol = game.player1.symbol === 'X' ? 'O' : 'X';
    const player2Symbol = game.player2.symbol === 'X' ? 'O' : 'X';
    
    const resetGame: TicTacToeGame = {
      id: gameId,
      board: Array(9).fill(null),
      currentTurn: 'X', // X always starts
      player1: {
        id: game.player1.id,
        symbol: player1Symbol
      },
      player2: {
        id: game.player2.id,
        symbol: player2Symbol
      },
      status: 'playing',
      winner: null,
      isDraw: false,
      createdAt: now,
      lastMoveAt: now,
      moveHistory: []
    };
    
    // Update game in store
    this.games.set(gameId, resetGame);
    
    logger.info('Game reset for rematch', { gameId });
    return resetGame;
  }

  /**
   * End a game
   * @param gameId Game ID
   * @param reason Reason for ending
   */
  private endGame(gameId: string, reason: string): void {
    const game = this.games.get(gameId);
    if (!game) return;
    
    // Clean up player mappings
    this.playerGameMap.delete(game.player1.id);
    this.playerGameMap.delete(game.player2.id);
    
    // Remove game
    this.games.delete(gameId);
    
    logger.info('Game ended', { gameId, reason });
  }

  /**
   * Handle player disconnection
   * @param playerId Disconnected player ID
   */
  private handlePlayerDisconnect(playerId: string): void {
    // Handle active game
    const gameId = this.playerGameMap.get(playerId);
    if (gameId) {
      const game = this.games.get(gameId);
      if (game) {
        // Get opponent ID
        const opponentId = game.player1.id === playerId ? game.player2.id : game.player1.id;
        
        // Notify opponent
        this.io.to(opponentId).emit('game-cancel', {
          game: 'tic-tac-toe',
          from: playerId,
          reason: 'disconnect'
        });
        
        // End game
        this.endGame(gameId, 'player_disconnect');
      }
    }
  }

  /**
   * Notify both players about game start
   * @param game Game to notify about
   */
  private notifyGameStart(game: TicTacToeGame): void {
    // Notify first player
    this.io.to(game.player1.id).emit('game-started', {
      game: 'tic-tac-toe',
      gameId: game.id,
      playerSymbol: game.player1.symbol,
      opponentId: game.player2.id,
      isFirst: game.player1.symbol === 'X'
    });
    
    // Notify second player
    this.io.to(game.player2.id).emit('game-started', {
      game: 'tic-tac-toe',
      gameId: game.id,
      playerSymbol: game.player2.symbol,
      opponentId: game.player1.id,
      isFirst: game.player2.symbol === 'X'
    });
    
    logger.debug('Game start notifications sent', { gameId: game.id });
  }

  /**
   * Notify both players about game end
   * @param game Completed game
   */
  private notifyGameEnd(game: TicTacToeGame): void {
    // Prepare end result
    const result = {
      game: 'tic-tac-toe',
      gameId: game.id,
      isDraw: game.isDraw,
      winner: game.winner,
      board: game.board
    };
    
    // Notify both players
    this.io.to(game.player1.id).emit('game-ended', result);
    this.io.to(game.player2.id).emit('game-ended', result);
    
    logger.debug('Game end notifications sent', { gameId: game.id });
  }

  /**
   * Check for a winner on the board
   * @param board Game board
   * @returns Winning player symbol or null
   */
  private checkWinner(board: TicTacToeBoard): GamePlayer | null {
    // Winning combinations: rows, columns, diagonals
    const winPatterns = [
      [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
      [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
      [0, 4, 8], [2, 4, 6]             // diagonals
    ];

    for (const pattern of winPatterns) {
      const [a, b, c] = pattern;
      if (board[a] && board[a] === board[b] && board[a] === board[c]) {
        return board[a] as GamePlayer;
      }
    }

    return null;
  }

  /**
   * Check if the game is a draw
   * @param board Game board
   * @returns True if draw
   */
  private checkDraw(board: TicTacToeBoard): boolean {
    return board.every(cell => cell !== null);
  }

  /**
   * Clean up inactive games
   */
  private cleanupInactiveGames(): void {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [id, game] of this.games.entries()) {
      // Check if game is inactive
      if (now - game.lastMoveAt > this.GAME_EXPIRY) {
        // Clean up player mappings
        this.playerGameMap.delete(game.player1.id);
        this.playerGameMap.delete(game.player2.id);
        
        // Remove game
        this.games.delete(id);
        cleanedCount++;
        
        // Notify players if they're still connected
        this.io.to(game.player1.id).emit('game-expired', {
          game: 'tic-tac-toe',
          gameId: id
        });
        
        this.io.to(game.player2.id).emit('game-expired', {
          game: 'tic-tac-toe',
          gameId: id
        });
      }
    }
    
    if (cleanedCount > 0) {
      logger.debug(`Cleaned up ${cleanedCount} inactive games`);
    }
  }

  /**
   * Get active game count
   * @returns Number of active games
   */
  public getActiveGameCount(): number {
    return this.games.size;
  }
} 