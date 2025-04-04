import { writable } from 'svelte/store';

// Define the game board type
type TicTacToeBoard = Array<'X' | 'O' | null>;

// Define the game player types
type GamePlayer = 'X' | 'O';

// Define the game status
type GameStatus = 'waiting' | 'playing' | 'completed' | null;

type GameState = {
  activeGame: string | null;
  isPlaying: boolean;
  // Tic Tac Toe specific state
  ticTacToe: {
    board: TicTacToeBoard;
    currentTurn: GamePlayer;
    playerSymbol: GamePlayer | null; // Symbol for the current user (X or O)
    winner: GamePlayer | null;
    isDraw: boolean;
    status: GameStatus;
  };
};

const createGameStore = () => {
  const initialTicTacToeState = {
    board: Array(9).fill(null) as TicTacToeBoard,
    currentTurn: 'X' as GamePlayer, // X always starts
    playerSymbol: null as GamePlayer | null,
    winner: null as GamePlayer | null,
    isDraw: false,
    status: null as GameStatus
  };

  const { subscribe, set, update } = writable<GameState>({
    activeGame: null,
    isPlaying: false,
    ticTacToe: initialTicTacToeState
  });

  // Check for a winner in tic-tac-toe
  const checkWinner = (board: TicTacToeBoard): GamePlayer | null => {
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
  };

  // Check if the game is a draw
  const checkDraw = (board: TicTacToeBoard): boolean => {
    return board.every(cell => cell !== null);
  };

  return {
    subscribe,
    
    // Start a game
    startGame: (gameId: string) => update(state => ({ 
      ...state, 
      activeGame: gameId, 
      isPlaying: true 
    })),
    
    // End a game
    endGame: () => update(state => ({ 
      ...state, 
      activeGame: null, 
      isPlaying: false,
      // Reset game-specific state if needed
      ticTacToe: initialTicTacToeState
    })),
    
    // Batch update the TicTacToe state (for syncing with server)
    updateTicTacToeState: (updates: Partial<typeof initialTicTacToeState>) => update(state => {
      return {
        ...state,
        ticTacToe: {
          ...state.ticTacToe,
          ...updates
        }
      };
    }),
    
    // Send a game request
    sendInvitation: (fromUser: string, toUser: string, gameId: string) => update(state => {
      return {
        ...state,
        activeGame: gameId,
        isPlaying: true,
        ticTacToe: {
          ...initialTicTacToeState,
          status: 'waiting' as GameStatus
        }
      };
    }),
    
    // Make a move in tic-tac-toe (client-side only for UI updates)
    makeMove: (index: number) => update(state => {
      if (!state.isPlaying || state.activeGame !== 'tic-tac-toe') return state;
      if (state.ticTacToe.status !== 'playing') return state;
      if (state.ticTacToe.board[index] !== null) return state;
      if (state.ticTacToe.currentTurn !== state.ticTacToe.playerSymbol) return state;
      
      // Create a copy of the board
      const newBoard = [...state.ticTacToe.board];
      newBoard[index] = state.ticTacToe.playerSymbol!;
      
      // Switch turn (the server will handle game ending conditions)
      const nextTurn = state.ticTacToe.currentTurn === 'X' ? 'O' : 'X';
      
      return {
        ...state,
        ticTacToe: {
          ...state.ticTacToe,
          board: newBoard,
          currentTurn: nextTurn
        }
      };
    }),
    
    // Receive opponent's move
    receiveMove: (index: number) => update(state => {
      if (!state.isPlaying || state.activeGame !== 'tic-tac-toe') return state;
      if (state.ticTacToe.status !== 'playing') return state;
      if (state.ticTacToe.board[index] !== null) return state;
      if (state.ticTacToe.currentTurn === state.ticTacToe.playerSymbol) return state;
      
      // Create a copy of the board
      const newBoard = [...state.ticTacToe.board];
      const opponentSymbol = state.ticTacToe.playerSymbol === 'X' ? 'O' : 'X';
      newBoard[index] = opponentSymbol;
      
      // Switch turn (the server will handle game ending conditions)
      const nextTurn = state.ticTacToe.currentTurn === 'X' ? 'O' : 'X';
      
      return {
        ...state,
        ticTacToe: {
          ...state.ticTacToe,
          board: newBoard,
          currentTurn: nextTurn
        }
      };
    }),
    
    // Reset the tic-tac-toe game
    resetTicTacToe: () => update(state => {
      return {
        ...state,
        ticTacToe: {
          ...initialTicTacToeState,
          playerSymbol: state.ticTacToe.playerSymbol, // Keep the assigned symbol
          status: 'playing' as GameStatus
        }
      };
    }),
    
    // Update player symbol
    updatePlayerSymbol: (symbol: GamePlayer) => update(state => {
      if (state.activeGame !== 'tic-tac-toe') return state;
      
      return {
        ...state,
        ticTacToe: {
          ...state.ticTacToe,
          playerSymbol: symbol
        }
      };
    })
  };
};

export const gameStore = createGameStore();