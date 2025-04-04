<script lang="ts">
  import { gameStore } from '$lib/stores/gameStore';
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { userStore } from '$lib/stores/userStore';
  import { fade, scale, fly } from 'svelte/transition';
  import { Clock, AlertTriangle } from 'lucide-svelte';
  
  // Props
  export let peerId: string; // ID of the peer
  export let userId: string; // ID of the current user
  export let overlay: boolean = false; // Whether the game is displayed as an overlay
  export let socket: any = null; // Socket.io connection (optional)
  export let gameId: string = ''; // Game ID from server (new prop)

  // Event dispatcher
  const dispatch = createEventDispatcher<{
    move: { index: number };
    reset: void;
    invite: void;
    timeout: void;
  }>();
  
  // Timer state
  let timeRemaining = 10;
  let timerInterval: ReturnType<typeof setInterval> | null = null;
  let timerPercentage = 100;
  let isTimeAlmostUp = false;
  
  // Game symbols
  const X = 'X';
  const O = 'O';
  
  // CSS classes for X and O
  const symbolClasses = {
    X: 'text-blue-400',
    O: 'text-yellow-400'
  };
  
  // Listen for game-started event
  onMount(() => {
    if (socket) {
      socket.on('game-started', (data: any) => {
        // Only handle tic-tac-toe game events
        if (data.game !== 'tic-tac-toe') return;
        
        gameId = data.gameId;
        
        // Initialize game state based on server data
        gameStore.updateTicTacToeState({
          playerSymbol: data.playerSymbol,
          currentTurn: 'X', // X always starts
          status: 'playing'
        });
        
        // Start turn timer if it's player's turn
        if (data.isFirst) {
          startTurnTimer();
        }
      });
      
      // Listen for moves from opponent
      socket.on('game-move', (data: any) => {
        // Only handle tic-tac-toe game events
        if (data.game !== 'tic-tac-toe') return;
        
        const index = data.moveData?.index;
        
        if (typeof index === 'number') {
          // Update game state
          gameStore.receiveMove(index);
          
          // Start timer for player's turn
          startTurnTimer();
        }
      });
      
      // Listen for game reset
      socket.on('game-reset', (data: any) => {
        // Only handle tic-tac-toe game events
        if (data.game !== 'tic-tac-toe') return;
        
        // Reset game state
        gameStore.resetTicTacToe();
        
        // Start timer if it's player's turn (X goes first)
        if ($gameStore.ticTacToe.playerSymbol === 'X') {
          startTurnTimer();
        }
      });
      
      // Listen for game end events
      socket.on('game-ended', (data: any) => {
        // Only handle tic-tac-toe game events
        if (data.game !== 'tic-tac-toe') return;
        
        // Update game state to completed with winner
        gameStore.updateTicTacToeState({
          status: 'completed',
          winner: data.winner,
          isDraw: data.isDraw,
          board: data.board
        });
        
        // Stop the timer
        stopTimer();
      });
      
      // Listen for timeout notifications
      socket.on('game-timeout', (data: any) => {
        // Only handle tic-tac-toe game events
        if (data.game !== 'tic-tac-toe') return;
        
        // No special handling needed, the move will come separately
      });
    }
    
    // Start timer if needed
    if ($gameStore.ticTacToe.status === 'playing' && isPlayerTurn) {
      startTurnTimer();
    }
    
    // Log that we're setting up TicTacToe game listeners
    console.log('Setting up TicTacToe game listeners, Socket ID:', socket.id);
    
    // Listen for game started event to update our UI
    socket.on('game-started', (data: {game: string, playerSymbol: 'X' | 'O'}) => {
      if (data.game === 'tic-tac-toe') {
        console.log('Game started event received in TicTacToe.svelte:', data);
        
        // Update our player symbol from the server
        gameStore.updatePlayerSymbol(data.playerSymbol);
      }
    });
    
    return () => {
      // Clean up event listeners
      if (socket) {
        socket.off('game-started');
        socket.off('game-move');
        socket.off('game-reset');
        socket.off('game-ended');
        socket.off('game-timeout');
      }
    };
  });
  
  // Get winner message
  $: winnerMessage = $gameStore.ticTacToe.winner 
    ? $gameStore.ticTacToe.winner === $gameStore.ticTacToe.playerSymbol
      ? 'You won!' 
      : 'You lost!' 
    : 'It\'s a draw!';
  
  // Get current player's symbol name
  $: playerSymbolName = $gameStore.ticTacToe.playerSymbol === 'X' ? 'X' : 'O';
  
  // Check if it's player's turn
  $: isPlayerTurn = $gameStore.ticTacToe.currentTurn === $gameStore.ticTacToe.playerSymbol;
  
  // Check if the game is over
  $: isGameOver = $gameStore.ticTacToe.status === 'completed';
  
  // Adjust styling based on overlay mode
  $: containerClass = overlay 
    ? 'bg-gray-900/80 backdrop-blur-md rounded-xl p-4 border border-gray-800/70 shadow-xl'
    : 'backdrop-blur-sm bg-gray-900/80 rounded-lg p-6';
    
  $: boardSize = overlay ? 'w-56 h-56' : 'w-72 h-72';
  
  // Reset and start turn timer
  function startTurnTimer() {
    // Clear any existing timer
    stopTimer();
    
    // Only start timer for active gameplay and when it's player's turn
    if (!isGameOver && isPlayerTurn && $gameStore.ticTacToe.status === 'playing') {
      timeRemaining = 10;
      timerPercentage = 100;
      isTimeAlmostUp = false;
      
      timerInterval = setInterval(() => {
        timeRemaining -= 1;
        timerPercentage = (timeRemaining / 10) * 100;
        
        // Warn when time is almost up
        if (timeRemaining <= 3 && !isTimeAlmostUp) {
          isTimeAlmostUp = true;
        }
        
        // Handle timeout
        if (timeRemaining <= 0) {
          stopTimer();
          handleTimeout();
        }
      }, 1000);
    }
  }
  
  // Stop the timer
  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }
  
  // Handle turn timeout
  function handleTimeout() {
    // Make a random move if it's player's turn and game is still active
    if (isPlayerTurn && $gameStore.ticTacToe.status === 'playing') {
      const emptySpaces = $gameStore.ticTacToe.board
        .map((cell, index) => ({ cell, index }))
        .filter(item => item.cell === null)
        .map(item => item.index);
      
      if (emptySpaces.length > 0) {
        // Notify about timeout
        if (socket) {
          socket.emit('game-timeout', {
            to: peerId,
            from: userId,
            game: 'tic-tac-toe'
          });
        }
        
        // The server will handle the random move
        dispatch('timeout');
      }
    }
  }
  
  // Watch for turn changes to reset timer
  $: if ($gameStore.ticTacToe.currentTurn && $gameStore.ticTacToe.status === 'playing') {
    startTurnTimer();
  }
  
  // Handle cell click
  function handleCellClick(index: number) {
    // Only allow moves if it's player's turn and the game is active
    if (!isPlayerTurn || $gameStore.ticTacToe.status !== 'playing') return;
    
    // Check if the cell is already filled, critical to avoid desyncs
    if ($gameStore.ticTacToe.board[index] !== null) return;
    
    // Update local state
    gameStore.makeMove(index);
    
    // Dispatch move event to notify parent component
    dispatch('move', { index });
    
    // Stop the timer after move
    stopTimer();
  }
  
  // Send invitation to play
  function sendInvitation() {
    if (!peerId) {
      console.error('Cannot send invitation: Missing peer ID');
      return;
    }
    
    // Use socket.id as fallback if userId is empty
    const effectiveUserId = userId || (socket ? socket.id : '');
    
    console.log('📨 Sending game invitation', {
      fromUser: effectiveUserId,
      toUser: peerId,
      game: 'tic-tac-toe',
      socketID: socket?.id,
      socketConnected: socket?.connected
    });
    
    // Initialize the game state for the sender
    gameStore.sendInvitation(effectiveUserId, peerId, 'tic-tac-toe');
    
    // Notify parent component to send the actual socket message
    dispatch('invite');
  }
  
  // Reset the game
  function resetGame() {
    gameStore.resetTicTacToe();
    dispatch('reset');
  }
  
  // Helper function to get the appropriate CSS class for a cell
  function getCellClass(value: 'X' | 'O' | null) {
    if (!value) return '';
    return symbolClasses[value];
  }
  
  // Generate gradient color for timer border
  $: timerGradientColor = isTimeAlmostUp 
    ? `linear-gradient(90deg, #ef4444 ${timerPercentage}%, transparent ${timerPercentage}%)` 
    : `linear-gradient(90deg, #eab308 ${timerPercentage}%, transparent ${timerPercentage}%)`;
  
  // Clean up on component destroy
  onDestroy(() => {
    stopTimer();
    
    // Clean up event listeners
    if (socket) {
      socket.off('game-started');
      socket.off('game-move');
      socket.off('game-reset');
      socket.off('game-ended');
      socket.off('game-timeout');
    }
  });
</script>

<div class="flex flex-col h-full relative">
  {#if $gameStore.ticTacToe.status === null}
    <!-- Initial screen - show play button -->
    <div class="flex-1 flex flex-col items-center justify-center backdrop-blur-sm bg-gray-900/70 rounded-lg p-6" in:fade={{ duration: 200 }}>
      <h3 class="text-xl font-bold mb-6 text-yellow-400">Play Tic-Tac-Toe</h3>
      <p class="text-center text-gray-300 mb-6">Challenge your chat partner to a game of Tic-Tac-Toe!</p>
      <button 
        class="px-6 py-3 rounded-md bg-gradient-to-r from-yellow-400 to-orange-500 hover:from-yellow-500 hover:to-orange-600 text-black font-medium transition-colors shadow-lg hover:shadow-yellow-500/20"
        on:click={sendInvitation}
      >
        Play Game
      </button>
    </div>
  {:else if $gameStore.ticTacToe.status === 'waiting'}
    <!-- Waiting for response screen -->
    <div class="flex-1 flex flex-col items-center justify-center backdrop-blur-sm bg-gray-900/70 rounded-lg p-6" in:fade={{ duration: 200 }}>
      <div class="w-16 h-16 border-4 border-t-yellow-400 border-r-yellow-400/20 border-b-yellow-400/20 border-l-yellow-400/20 rounded-full animate-spin mb-6"></div>
      <h3 class="text-xl font-bold mb-2 text-yellow-400">Waiting for Response</h3>
      <p class="text-center text-gray-300">Your request has been sent. Waiting for your partner to respond...</p>
    </div>
  {:else}
    <!-- Game board -->
    <div class="flex-1 flex flex-col items-center justify-center {containerClass}" in:fade={{ duration: 200 }}>
      <!-- Turn indicator -->
      {#if !isGameOver}
        <div 
          class="absolute {overlay ? '-top-10' : 'top-0'} left-0 right-0 py-2 text-center {overlay ? 'text-base' : 'text-lg'} font-bold {isPlayerTurn ? 'bg-gradient-to-r from-yellow-500/80 to-orange-500/80 text-black' : 'bg-gray-800/90 text-gray-300'} rounded-t-lg transition-all duration-300"
          in:fly={{ y: -20, duration: 300 }}
        >
          {#if isPlayerTurn}
            <div class="flex items-center justify-center gap-2">
              <span>YOUR TURN</span>
              <Clock class="{overlay ? 'h-4 w-4' : 'h-5 w-5'} animate-pulse" />
              <span class="{overlay ? 'text-xs' : 'text-sm'}">({timeRemaining}s)</span>
            </div>
          {:else}
            <div class="flex items-center justify-center gap-2">
              <span>Opponent's Turn</span>
              <div class="{overlay ? 'w-3 h-3' : 'w-5 h-5'} rounded-full bg-gray-700/70 animate-pulse"></div>
            </div>
          {/if}
        </div>
      {/if}
      
      <!-- Game info - smaller in overlay mode -->
      <div class="mb-4 text-center {overlay ? 'mt-0' : 'mt-10'}">
        {#if !overlay}
          <div class="flex items-center justify-center gap-6 mb-4">
            <div class="flex flex-col items-center p-3 rounded-lg {isPlayerTurn ? 'bg-gray-800/80 ring-2 ring-yellow-500' : 'bg-gray-800/40'} transition-all duration-300">
              <span class="text-sm font-medium text-gray-400">You are</span>
              <span class="text-3xl font-bold {symbolClasses[$gameStore.ticTacToe.playerSymbol || 'X']}">{playerSymbolName}</span>
            </div>
            
            <div class="flex flex-col items-center p-3 rounded-lg {!isPlayerTurn && !isGameOver ? 'bg-gray-800/80 ring-2 ring-yellow-500' : 'bg-gray-800/40'} transition-all duration-300">
              <span class="text-sm font-medium text-gray-400">Opponent is</span>
              <span class="text-3xl font-bold {symbolClasses[$gameStore.ticTacToe.playerSymbol === 'X' ? 'O' : 'X']}">
                {$gameStore.ticTacToe.playerSymbol === 'X' ? 'O' : 'X'}
              </span>
            </div>
          </div>
        {:else}
          <!-- Compact display for overlay mode -->
          <div class="flex items-center justify-center gap-4 mb-2">
            <div class="flex items-center gap-1">
              <span class="text-xs text-gray-400">You:</span>
              <span class="text-lg font-bold {symbolClasses[$gameStore.ticTacToe.playerSymbol || 'X']}">{playerSymbolName}</span>
            </div>
            <div class="flex items-center gap-1">
              <span class="text-xs text-gray-400">Opponent:</span>
              <span class="text-lg font-bold {symbolClasses[$gameStore.ticTacToe.playerSymbol === 'X' ? 'O' : 'X']}">
                {$gameStore.ticTacToe.playerSymbol === 'X' ? 'O' : 'X'}
              </span>
            </div>
          </div>
        {/if}
        
        {#if isGameOver}
          <div 
            class="{overlay ? 'py-1 px-3 text-base' : 'py-2 px-4 text-lg'} rounded-lg font-bold {$gameStore.ticTacToe.winner === $gameStore.ticTacToe.playerSymbol ? 'bg-green-500/20 text-green-400' : $gameStore.ticTacToe.winner ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'} animate-pulse"
            in:fly={{ y: 20, duration: 300 }}
          >
            {winnerMessage}
          </div>
        {/if}
      </div>
      
      <!-- Game board with timer border -->
      <div 
        class="relative p-1 rounded-xl overflow-hidden mb-4"
        style="background: {!isGameOver && isPlayerTurn ? timerGradientColor : 'rgba(31, 41, 55, 0.7)'}"
      >
        <div class="grid grid-cols-3 gap-2 {boardSize} p-2 bg-gray-900/80 rounded-lg">
          {#each $gameStore.ticTacToe.board as cell, index}
            <button 
              class="bg-gray-800/80 hover:bg-gray-700/80 rounded-md flex items-center justify-center {overlay ? 'text-2xl' : 'text-4xl'} font-bold transition-colors
                    {!cell && isPlayerTurn && $gameStore.ticTacToe.status === 'playing' ? 'hover:bg-gray-700 hover:shadow-inner' : ''}
                    {isPlayerTurn && !cell && $gameStore.ticTacToe.status === 'playing' ? 'animate-pulse' : ''}"
              on:click={() => handleCellClick(index)}
              disabled={cell !== null || !isPlayerTurn || $gameStore.ticTacToe.status !== 'playing'}
            >
              {#if cell}
                <span class={getCellClass(cell)} in:scale={{ duration: 300 }}>{cell}</span>
              {:else if isPlayerTurn && $gameStore.ticTacToe.status === 'playing'}
                <span class="text-gray-700 opacity-50 {overlay ? 'text-[8px]' : 'text-xs'}">Click</span>
              {/if}
            </button>
          {/each}
        </div>
        
        <!-- Warning indicator when time is almost up -->
        {#if isTimeAlmostUp && isPlayerTurn && !isGameOver}
          <div class="absolute -top-1 left-0 right-0 flex justify-center">
            <div class="bg-red-500 text-white text-xs px-3 py-1 rounded-b-md flex items-center gap-1">
              <AlertTriangle class="h-3 w-3" />
              <span>Time running out!</span>
            </div>
          </div>
        {/if}
      </div>
      
      <!-- Game controls -->
      {#if isGameOver}
        <button 
          class="{overlay ? 'px-4 py-1.5 text-sm' : 'px-6 py-2'} rounded-md bg-gradient-to-r from-yellow-400 to-orange-500 hover:from-yellow-500 hover:to-orange-600 text-black font-medium transition-colors shadow-lg"
          on:click={resetGame}
          in:scale={{ duration: 300, delay: 300 }}
        >
          Play Again
        </button>
      {/if}
    </div>
  {/if}
</div> 