import { writable, type Writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import io, { type Socket } from 'socket.io-client';
import { env } from '$env/dynamic/public';

export type GameType = 'rock-paper-scissors' | 'tic-tac-toe' | 'dice' | 'cards' | 'darts' | 'arcade' | 'chess';

export interface GameInvite {
  game: GameType;
  settings: Record<string, any>;
  roomId?: string;
}

export interface GameResponse {
  game: GameType;
  accepted: boolean;
  roomId?: string;
}

export interface GameAction {
  game: GameType;
  type: string;
  data: any;
  roomId?: string;
}

export interface RPSGameSettings {
  rounds: number;
}

export type RPSChoice = 'rock' | 'paper' | 'scissors' | null;

export interface RPSGameState {
  currentRound: number;
  totalRounds: number;
  playerChoice: RPSChoice;
  opponentChoice: RPSChoice;
  playerScore: number;
  opponentScore: number;
  roundResult: 'win' | 'lose' | 'draw' | null;
  gameResult: 'win' | 'lose' | 'draw' | null;
  timeRemaining: number;
  status: 'waiting' | 'countdown' | 'choosing' | 'roundResult' | 'gameResult';
  countdown: number;
}

// Store for game state
export const activeGameInvite: Writable<GameInvite | null> = writable(null);
export const receivedGameInvite: Writable<GameInvite | null> = writable(null);
export const activeGame: Writable<GameType | null> = writable(null);
export const rpsGameState: Writable<RPSGameState> = writable({
  currentRound: 1,
  totalRounds: 3,
  playerChoice: null,
  opponentChoice: null,
  playerScore: 0,
  opponentScore: 0,
  roundResult: null,
  gameResult: null,
  timeRemaining: 5,
  status: 'waiting',
  countdown: 3
});

// Game connection status store
export const gameConnectionStatus: Writable<boolean> = writable(false);

class GameService {
  private socket: Socket | null = null;
  private roomId: string | null = null;
  private gameTimer: number | null = null;
  private countdownTimer: number | null = null;
  private isConnected = false;
  
  constructor() {
    if (browser) {
      // Initialize game event listeners
      this.setupEventListeners();
    }
  }

  /**
   * Initialize socket connection for games
   */
  initializeSocket(roomId: string): void {
    if (!browser) return;
    if (this.socket && this.isConnected && this.roomId === roomId) {
      console.log('Game socket already connected to room:', roomId);
      gameConnectionStatus.set(true);
      return;
    }

    // Clean up any existing connection
    this.cleanup();

    // Store the room ID
    this.roomId = roomId;
    
    const serverUrl = env.PUBLIC_VITE_SERVER_URL || 'http://localhost:3001';
    
    try {
      console.log('Initializing game socket for room:', roomId);
      
      // Close any existing connection
      if (this.socket) {
        this.socket.disconnect();
        this.socket = null;
      }
      
      // Create new socket connection
      this.socket = io(serverUrl, {
        transports: ['websocket', 'polling'],
        path: '/socket.io/',
        query: { roomId },
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 10000
      });
      
      this.socket.on('connect', () => {
        console.log('Game socket connected with ID:', this.socket?.id);
        this.isConnected = true;
        gameConnectionStatus.set(true);
        
        // Join the game room
        this.socket?.emit('join-game-room', { roomId });
        console.log('Sent join-game-room event for room:', roomId);
      });
      
      this.socket.on('disconnect', (reason) => {
        console.log('Game socket disconnected, reason:', reason);
        this.isConnected = false;
        gameConnectionStatus.set(false);
        this.resetAllGames();
      });
      
      this.socket.on('connect_error', (err) => {
        console.error('Game socket connection error:', err);
        this.isConnected = false;
        gameConnectionStatus.set(false);
      });
      
      this.socket.on('error', (err) => {
        console.error('Game socket error:', err);
      });
      
      this.socket.on('reconnect', (attempt) => {
        console.log(`Game socket reconnected after ${attempt} attempts`);
        
        // Re-join game room after reconnection
        if (this.roomId) {
          this.socket?.emit('join-game-room', { roomId: this.roomId });
          console.log('Re-joined game room after reconnect:', this.roomId);
        }
      });
      
      this.socket.on('reconnect_attempt', (attempt) => {
        console.log(`Game socket reconnect attempt ${attempt}`);
      });
      
      this.socket.on('reconnect_error', (err) => {
        console.error('Game socket reconnect error:', err);
      });
      
      this.socket.on('reconnect_failed', () => {
        console.error('Game socket reconnect failed after all attempts');
        this.isConnected = false;
        gameConnectionStatus.set(false);
      });
      
      // Game events
      this.socket.on('game-invite', (data: GameInvite) => {
        console.log('%c Received game invite event! ', 'background: #5cb85c; color: white; padding: 4px;', data);
        this.handleGameInvite(data);
      });
      
      this.socket.on('game-response', (data: GameResponse) => {
        console.log('%c Received game response event! ', 'background: #5cb85c; color: white; padding: 4px;', data);
        this.handleGameResponse(data);
      });
      
      this.socket.on('game-action', (data: GameAction) => {
        console.log('%c Received game action event! ', 'background: #5cb85c; color: white; padding: 4px;', data);
        this.handleGameAction(data);
      });
    } catch (err) {
      console.error('Error initializing game socket:', err);
      this.isConnected = false;
      gameConnectionStatus.set(false);
    }
  }
  
  private setupEventListeners() {
    if (!this.socket) return;
    
    console.log('Setting up game socket event listeners');
    
    // Game invite events
    this.socket.on('game-invite', (invite: GameInvite) => {
      console.log('Received game invite:', invite);
      this.handleGameInvite(invite);
    });
    
    // Game response events - ensure consistent event name
    this.socket.on('game-response', (response: GameResponse) => {
      console.log('Received game response from server:', response);
      this.handleGameResponse(response);
    });
    
    // Game action events
    this.socket.on('game-action', (action: GameAction) => {
      console.log('Received game action:', action);
      this.handleGameAction(action);
    });
  }
  
  private handleGameInvite(invite: GameInvite) {
    // Ensure the invite settings are correctly passed through
    console.log('%c Processing received game invite with settings', 'background: #5cb85c; color: white; padding: 4px;', invite.settings);
    
    // Store the invite with the original settings
    receivedGameInvite.set(invite);
  }
  
  private handleGameResponse(response: GameResponse) {
    console.log('Received game response from server:', response, 'Current activeGameInvite:', get(activeGameInvite));
    
    // For Player A: Check if we had sent an invite that is being responded to
    const activeInvite = get(activeGameInvite);
    if (activeInvite && activeInvite.game === response.game) {
      console.log('Found matching active invite for response');
      
      if (response.accepted) {
        console.log('PLAYER A: Game invite accepted, starting game');
        
        // Set active game
        activeGame.set(response.game);
        
        // Clear active invitation
        activeGameInvite.set(null);
        
        // Get the settings we used for the invite
        const inviteSettings = activeInvite.settings;
        console.log('PLAYER A: Using invite settings:', inviteSettings);
        
        // Start the game for Player A
        if (response.game === 'rock-paper-scissors') {
          // Clean up any existing game state first
          this.resetRPSGame();
          
          // Update game state with our original invite settings
          const settings = inviteSettings as RPSGameSettings;
          const rounds = settings?.rounds || 3;
          
          console.log('PLAYER A: Starting game with rounds:', rounds);
          
          rpsGameState.update(state => ({
            ...state,
            totalRounds: rounds
          }));
          
          // Start the countdown to begin the game with a slight delay to ensure both players are synchronized
          console.log('PLAYER A: Starting countdown after invite acceptance');
          setTimeout(() => {
            console.log('PLAYER A: Starting countdown now');
            this.startCountdown();
          }, 100);
        }
      } else {
        console.log('Game invite declined');
        
        // Just clear the active invitation
        activeGameInvite.set(null);
      }
    } else {
      console.log('No matching active invite found for response, or response is for a different game');
    }
  }
  
  private handleGameAction(action: GameAction) {
    if (action.game !== 'rock-paper-scissors') {
      console.log('Ignoring game action for unsupported game type:', action.game);
      return;
    }
    
    console.log('Processing game action:', { gameType: action.game, action: action.type, data: action.data, gameState: get(rpsGameState) });
    
    // Check if it's a cancel message - we should always process those
    if (action.type === 'cancel') {
      console.log('Received cancel action, resetting game');
      this.resetRPSGame();
      activeGame.set(null);
      return;
    }
    
    // For all other actions, only process if we have an active game
    // or if we're in game result waiting for potential play again
    const gameState = get(rpsGameState);
    
    // Check if this is a relevant action
    if (gameState.status === 'waiting' && action.type !== 'start') {
      console.log('Ignoring action because no active game:', action.type);
      return;
    }
    
    // Process game actions
    switch (action.type) {
      case 'start':
        console.log('Starting new RPS game with settings:', action.data.settings);
        rpsGameState.update(state => ({
          ...state,
          totalRounds: action.data.settings.rounds || 3
        }));
        this.startCountdown();
        break;
        
      case 'choice':
        if (!action.data.choice) {
          console.error('Invalid choice received:', action.data);
          return;
        }
        console.log('Received opponent choice:', action.data.choice);
        
        // Update opponent's choice
        rpsGameState.update(state => {
          // Ignore choices if we're not in a choosing state
          if (state.status !== 'choosing') {
            console.log('Ignoring choice because not in choosing state:', state.status);
            return state;
          }
          
          const updatedState = {
            ...state,
            opponentChoice: action.data.choice
          };
          
          // Check if we can calculate the round result now
          if (updatedState.playerChoice) {
            return this.calculateRPSRoundResult(updatedState);
          }
          
          return updatedState;
        });
        break;
        
      default:
        console.log('Unknown game action received:', action.type);
    }
  }
  
  /**
   * Cleanup method to properly close socket connection
   */
  cleanup(): void {
    // Clear any existing timers
    if (this.gameTimer !== null) {
      window.clearTimeout(this.gameTimer);
      this.gameTimer = null;
    }
    
    if (this.countdownTimer !== null) {
      window.clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }
    
    // Reset all game state
    this.resetAllGames();
    
    // Close socket connection
    if (this.socket) {
      console.log('Cleaning up game socket');
      
      // Remove all event listeners to prevent memory leaks
      this.socket.off('connect');
      this.socket.off('disconnect');
      this.socket.off('connect_error');
      this.socket.off('error');
      this.socket.off('reconnect');
      this.socket.off('reconnect_attempt');
      this.socket.off('reconnect_error');
      this.socket.off('reconnect_failed');
      this.socket.off('game-invite');
      this.socket.off('game-response');
      this.socket.off('game-action');
      
      this.socket.disconnect();
      this.socket = null;
    }
    
    // Reset connection state
    this.isConnected = false;
    this.roomId = null;
    gameConnectionStatus.set(false);
  }
  
  /**
   * Send a message through the socket with improved error handling
   */
  private sendSocketMessage(event: string, data: any): boolean {
    if (!this.socket) {
      console.error(`Cannot send ${event}: Socket not initialized`);
      return false;
    }
    
    if (!this.isConnected) {
      console.error(`Cannot send ${event}: Socket not connected`);
      return false;
    }
    
    try {
      // Add room ID to the data if available
      const messageData = this.roomId ? { ...data, roomId: this.roomId } : data;
      
      console.log(`%c Sending ${event} (socket id: ${this.socket.id}) `, 'background: #007bff; color: white; padding: 4px;', messageData);
      
      // For game responses especially, we need to update local state regardless of socket result
      if (event === 'game-response' && !messageData.accepted) {
        console.log('Ensuring local state cleanup for declined invitation, regardless of socket result');
        // If this is a decline, make sure we update our state immediately, regardless of socket result
        activeGameInvite.set(null);
        receivedGameInvite.set(null);
      }
      
      // Send the message with timeout handling
      const sendPromise = new Promise((resolve, reject) => {
        this.socket?.emit(event, messageData, (error: any) => {
          if (error) {
            reject(error);
          } else {
            resolve(true);
          }
        });
        
        // Timeout after 5 seconds
        setTimeout(() => reject(new Error('Socket message timeout')), 5000);
      });
      
      // Handle the promise
      sendPromise
        .then(() => console.log(`%c ${event} sent successfully `, 'background: #28a745; color: white; padding: 4px;'))
        .catch(err => {
          console.error(`%c Error sending ${event} `, 'background: #dc3545; color: white; padding: 4px;', err);
          // If there was an error sending the message (especially for game responses)
          // we still want to ensure our local state is correct
          if (event === 'game-response') {
            console.log('Error sending game response, but ensuring local state is updated');
            activeGameInvite.set(null);
            receivedGameInvite.set(null);
          }
        });
      
      return true;
    } catch (err) {
      console.error(`Error sending ${event} through socket:`, err);
      return false;
    }
  }
  
  sendGameInvite(game: GameType, settings: Record<string, any>) {
    // Create invite with roomId included
    const invite: GameInvite = { 
      game, 
      settings,
      roomId: this.roomId || undefined
    };
    
    // Set local state
    activeGameInvite.set(invite);
    
    // Send to server
    console.log('%c Sending game invite with room ID ', 'background: #17a2b8; color: white; padding: 4px;', invite);
    return this.sendSocketMessage('game-invite', invite);
  }
  
  respondToGameInvite(game: GameType, accepted: boolean) {
    // Check if socket is initialized and connected
    if (!this.socket || !this.isConnected) {
      console.error('Cannot respond to game invite - socket not connected');
      // Clean up local state even if socket isn't working (for decline)
      if (!accepted) {
        receivedGameInvite.set(null);
      }
      return;
    }
    
    // Create response object
    const response: GameResponse = {
      game,
      accepted,
      roomId: this.roomId || undefined  // Include roomId if available
    };
    
    // CRITICAL BUG FIX: If accepted, start the local game immediately for Player B
    // BEFORE sending response to avoid race conditions
    if (accepted) {
      console.log('PLAYER B: Accepting game and starting locally FIRST');
      
      // Store the invitation settings before clearing
      const inviteSettings = get(receivedGameInvite)?.settings;
      console.log('PLAYER B: Invite settings before starting game:', inviteSettings);
      
      // Set active game before cleaning up invitation
      activeGame.set(game);
      
      // For RPS games, start the local game immediately
      if (game === 'rock-paper-scissors') {
        // Clean up any existing game state
        this.resetRPSGame();
        
        // Update game state with settings
        const settings = inviteSettings as RPSGameSettings;
        const rounds = settings?.rounds || 3;
        
        console.log('PLAYER B: Setting up game with rounds:', rounds);
        
        rpsGameState.update(state => ({
          ...state,
          totalRounds: rounds
        }));
        
        // IMPORTANT: Start the countdown immediately on Player B's side
        console.log('PLAYER B: Starting countdown IMMEDIATELY');
        setTimeout(() => {
          console.log('PLAYER B: Starting countdown now');
          this.startCountdown();
        }, 50);
      }
      
      // Clean up active invitation AFTER game is started
      receivedGameInvite.set(null);
      
      // Now send response to server
      return this.sendSocketMessage('game-response', response);
    } else {
      // Clean up active invitation
      receivedGameInvite.set(null);
      
      console.log('Declining game invitation');
      
      // Send response to server
      return this.sendSocketMessage('game-response', response);
    }
  }
  
  sendGameAction(game: GameType, actionType: string, actionData: any) {
    // Create action with roomId included
    const action: GameAction = {
      game,
      type: actionType,
      data: actionData,
      roomId: this.roomId || undefined
    };
    
    // Send to server
    console.log('%c Sending game action with room ID ', 'background: #17a2b8; color: white; padding: 4px;', action);
    return this.sendSocketMessage('game-action', action);
  }
  
  // Check if socket is connected and ready for games
  isReady(): boolean {
    return this.isConnected && !!this.socket;
  }
  
  // Cleanup socket connection
  startGame(game: GameType) {
    activeGame.set(game);
    
    if (game === 'rock-paper-scissors') {
      this.startRPSGame();
    }
    // Add other game types as needed
  }
  
  // Rock Paper Scissors implementation
  startRPSGame() {
    // Clean up any existing timers
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    
    if (this.gameTimer) {
      clearInterval(this.gameTimer);
      this.gameTimer = null;
    }
    
    // Get settings from the active invite if we're the recipient
    // or from the received invite if we're accepting an invite
    const activeInvite = get(activeGameInvite);
    const receivedInvite = get(receivedGameInvite);
    const invite = activeInvite || receivedInvite;
    
    if (invite && invite.game === 'rock-paper-scissors') {
      const settings = invite.settings as RPSGameSettings;
      
      // Debug the rounds setting to verify it's being set correctly
      console.log('%c Starting RPS game with rounds: ', 'background: #ff9800; color: white; padding: 4px;', settings.rounds || 3);
      
      // Make sure we have a valid rounds setting (default to 3 only if necessary)
      const totalRounds = settings.rounds || 3;
      
      // Update game state with settings
      rpsGameState.update(state => ({
        ...state,
        totalRounds: totalRounds,
        currentRound: 1,
        playerScore: 0,
        opponentScore: 0,
        playerChoice: null,
        opponentChoice: null,
        roundResult: null,
        gameResult: null,
        status: 'waiting'
      }));
      
      // Send ready signal to sync both players
      this.sendGameAction('rock-paper-scissors', 'ready', { 
        timestamp: Date.now(),
        settings: { rounds: totalRounds } // Include rounds in ready signal for extra confirmation
      });
      
      // Start countdown
      this.startCountdown();
    }
  }
  
  startCountdown() {
    // Clean up any existing timers
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    
    // Set active game if not already set
    if (!get(activeGame)) {
      console.log('Setting active game in startCountdown');
      activeGame.set('rock-paper-scissors');
    }
    
    // Set game to countdown mode
    rpsGameState.update(state => ({
      ...state,
      status: 'countdown',
      countdown: 3
    }));
    
    console.log('Starting countdown from', get(rpsGameState).countdown);
    
    // Start countdown
    this.countdownTimer = window.setInterval(() => {
      rpsGameState.update(state => {
        const newCountdown = state.countdown - 1;
        
        console.log('Countdown:', newCountdown);
        
        if (newCountdown <= 0) {
          // Countdown complete, start the round
          console.log('Countdown finished, clearing timer');
          clearInterval(this.countdownTimer!);
          this.countdownTimer = null;
          
          // Start the first round
          setTimeout(() => {
            console.log('Starting first round');
            this.startRPSRound();
          }, 1000); // Slight delay before starting round
          
          return { ...state, countdown: 0 };
        }
        
        return { ...state, countdown: newCountdown };
      });
    }, 1000);
  }
  
  startRPSRound() {
    // Clear any existing timer
    if (this.gameTimer) {
      clearInterval(this.gameTimer);
      this.gameTimer = null;
    }
    
    // Ensure active game is set
    if (!get(activeGame)) {
      console.log('Setting active game in startRPSRound');
      activeGame.set('rock-paper-scissors');
    }
    
    // Reset choices for the new round
    rpsGameState.update(state => ({
      ...state,
      playerChoice: null,
      opponentChoice: null,
      roundResult: null,
      status: 'choosing',
      timeRemaining: 5
    }));
    
    const currentState = get(rpsGameState);
    console.log('Starting new round with state:', currentState, 'Round', currentState.currentRound, 'of', currentState.totalRounds);
    
    // Start the timer
    this.gameTimer = window.setInterval(() => {
      rpsGameState.update(state => {
        // If both players made choices, we can end the round early
        if (state.playerChoice && state.opponentChoice) {
          console.log('Both players made choices, calculating result early');
          clearInterval(this.gameTimer!);
          this.gameTimer = null;
          return this.calculateRPSRoundResult(state);
        }
        
        // Otherwise, decrement time
        if (state.timeRemaining > 0) {
          return { ...state, timeRemaining: state.timeRemaining - 0.1 };
        } else {
          // Time's up, force a choice if none was made
          console.log('Time is up, forcing choice if needed');
          clearInterval(this.gameTimer!);
          this.gameTimer = null;
          
          const updatedState = {
            ...state,
            playerChoice: state.playerChoice || 'rock', // Default choice if none selected
            timeRemaining: 0
          };
          
          // Send choice to opponent if we haven't already
          if (!state.playerChoice) {
            console.log('Making default choice of rock');
            this.makeRPSChoice('rock');
          }
          
          // If we have both choices now, calculate the result
          if (updatedState.playerChoice && updatedState.opponentChoice) {
            console.log('Both choices available after timeout, calculating result');
            return this.calculateRPSRoundResult(updatedState);
          }
          
          return updatedState;
        }
      });
    }, 100); // Update more frequently for smoother progress
  }
  
  makeRPSChoice(choice: RPSChoice) {
    if (!choice) return;
    
    // Update local state
    rpsGameState.update(state => ({
      ...state,
      playerChoice: choice
    }));
    
    // Send choice to opponent
    this.sendGameAction('rock-paper-scissors', 'choice', { choice });
    
    // Check if we can determine result (if opponent already chose)
    rpsGameState.update(state => {
      if (state.playerChoice && state.opponentChoice) {
        return this.calculateRPSRoundResult(state);
      }
      return state;
    });
  }
  
  calculateRPSRoundResult(state: RPSGameState): RPSGameState {
    const { playerChoice, opponentChoice } = state;
    
    if (!playerChoice || !opponentChoice) {
      return state; // Can't calculate without both choices
    }
    
    // Prevent recalculating if we already have a round result
    if (state.roundResult !== null) {
      console.log('Round result already calculated, skipping duplicate calculation');
      return state;
    }
    
    console.log('Calculating round result:', { playerChoice, opponentChoice });
    
    let roundResult: 'win' | 'lose' | 'draw';
    
    if (playerChoice === opponentChoice) {
      roundResult = 'draw';
    } else if (
      (playerChoice === 'rock' && opponentChoice === 'scissors') ||
      (playerChoice === 'paper' && opponentChoice === 'rock') ||
      (playerChoice === 'scissors' && opponentChoice === 'paper')
    ) {
      roundResult = 'win';
    } else {
      roundResult = 'lose';
    }
    
    // Update scores
    let playerScore = state.playerScore;
    let opponentScore = state.opponentScore;
    
    if (roundResult === 'win') {
      playerScore++;
    } else if (roundResult === 'lose') {
      opponentScore++;
    }
    
    // Debug the score increment to verify we're not double-counting
    console.log('Score updated:', { 
      previousScore: `${state.playerScore}-${state.opponentScore}`,
      newScore: `${playerScore}-${opponentScore}`, 
      roundResult 
    });
    
    // Check if the game is over
    const winsNeeded = Math.ceil(state.totalRounds / 2);
    let gameResult: 'win' | 'lose' | 'draw' | null = null;
    let status: RPSGameState['status'] = 'roundResult';
    let nextRound = state.currentRound;
    
    // Special case for single-round games
    if (state.totalRounds === 1) {
      // In a single round game with a draw, replay the round
      if (roundResult === 'draw') {
        console.log('Draw in single-round game, will replay the round');
        status = 'roundResult';
        // Game result stays null since we're not done yet
      } else {
        // If not a draw, the round result is the game result
        gameResult = roundResult;
        status = 'gameResult';
        console.log('Single round game completed - setting gameResult to:', gameResult);
      }
    } 
    // Otherwise use normal multi-round logic
    else if (playerScore >= winsNeeded) {
      gameResult = 'win';
      status = 'gameResult';
      console.log('Player reached win threshold - setting gameResult to win');
    } else if (opponentScore >= winsNeeded) {
      gameResult = 'lose';
      status = 'gameResult';
      console.log('Opponent reached win threshold - setting gameResult to lose');
    } else if (state.currentRound >= state.totalRounds) {
      // If we've played all rounds, determine the winner based on score
      if (playerScore > opponentScore) {
        gameResult = 'win';
      } else if (opponentScore > playerScore) {
        gameResult = 'lose';
      } else {
        gameResult = 'draw';
      }
      status = 'gameResult';
      console.log('All rounds completed - setting gameResult to:', gameResult);
    } else {
      // Game continues to next round
      if (roundResult !== 'draw') {
        nextRound++;
      }
      // If it's a draw in a multi-round game, we replay the current round
    }
    
    // Log the game state for debugging
    console.log('Game state after round calculation:', {
      totalRounds: state.totalRounds,
      currentRound: nextRound,
      playerScore,
      opponentScore,
      status,
      gameResult,
      roundResult
    });
    
    // Add more detailed logging when game is over
    if (status === 'gameResult') {
      console.log('%c GAME OVER - FINAL STATE: ', 'background: #ff5722; color: white; padding: 6px; font-weight: bold;', {
        gameResult,
        finalScore: `${playerScore}-${opponentScore}`,
        totalRounds: state.totalRounds,
        status,
        gameState: JSON.stringify({
          ...state,
          playerScore,
          opponentScore,
          gameResult,
          status,
          currentRound: nextRound
        })
      });
    }
    
    // Schedule the next round if game isn't over
    if (status === 'roundResult') {
      setTimeout(() => {
        if (roundResult === 'draw') {
          this.startRPSRound(); // Replay the same round for a draw
        } else {
          rpsGameState.update(s => ({ 
            ...s, 
            currentRound: nextRound,
            playerChoice: null,
            opponentChoice: null,
            roundResult: null
          }));
          this.startCountdown(); // Start next round
        }
      }, 2000); // Show result for 2 seconds before next round
    }
    
    return {
      ...state,
      playerScore,
      opponentScore,
      roundResult,
      gameResult,
      status,
      currentRound: nextRound,
      timeRemaining: 0
    };
  }
  
  resetRPSGame() {
    // Make sure to clear timers first
    if (this.gameTimer) {
      clearInterval(this.gameTimer);
      this.gameTimer = null;
    }
    
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    
    console.log('Resetting RPS game state');
    
    // Reset to initial state
    rpsGameState.set({
      currentRound: 1,
      totalRounds: 3,
      playerChoice: null,
      opponentChoice: null,
      playerScore: 0,
      opponentScore: 0,
      roundResult: null,
      gameResult: null,
      timeRemaining: 5,
      status: 'waiting',
      countdown: 3
    });
  }
  
  resetAllGames() {
    // Reset all game states
    this.resetRPSGame();
    activeGame.set(null);
    activeGameInvite.set(null);
    receivedGameInvite.set(null);
    
    // Clear any timers
    if (this.gameTimer) {
      clearInterval(this.gameTimer);
      this.gameTimer = null;
    }
    
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  /**
   * Debug method to get information about all connected sockets
   */
  debugConnections(): void {
    if (!this.socket || !this.isConnected) {
      console.warn('Cannot debug connections: Socket not connected');
      return;
    }
    
    console.log('%c Requesting debug connection info ', 'background: #6610f2; color: white; padding: 4px;');
    
    // Add listener for the response
    this.socket.once('debug-game-connections-result', (data: any) => {
      console.log('%c Debug connection info received ', 'background: #6610f2; color: white; padding: 4px;', data);
    });
    
    // Send the debug request
    this.socket.emit('debug-game-connections');
  }

  // Add a new cancelGame method
  cancelGame(game: GameType): boolean {
    // Send cancellation event to opponent
    console.log('%c Cancelling game ', 'background: #dc3545; color: white; padding: 4px;', { game });
    const result = this.sendGameAction(game, 'cancel', { timestamp: Date.now() });
    
    // Reset local game state
    if (game === 'rock-paper-scissors') {
      // Make sure to stop timers first
      if (this.gameTimer) {
        clearInterval(this.gameTimer);
        this.gameTimer = null;
      }
      
      if (this.countdownTimer) {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
      }
      
      this.resetRPSGame();
    }
    
    // Clear active game
    activeGame.set(null);
    activeGameInvite.set(null);
    receivedGameInvite.set(null);
    
    return result;
  }

  // Add a new method to update RPS game settings
  updateRPSGameSettings(settings: { rounds: number }) {
    console.log('Updating RPS game settings:', settings);
    
    // Update the game state with new settings
    rpsGameState.update(state => {
      return {
        ...state,
        totalRounds: settings.rounds
      };
    });
  }
}

export const gameService = new GameService();
export default gameService; 