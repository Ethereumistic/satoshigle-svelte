<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { userStore } from '$lib/stores/userStore';
  import { gameStore } from '$lib/stores/gameStore';
  import { writable } from 'svelte/store';
  import { browser } from '$app/environment';
  import TicTacToe from './TicTacToe.svelte';
  import { X } from 'lucide-svelte';
  
  // Create a layout store since it doesn't exist
  const layoutStore = writable({
    currentLayout: 'default' // default layout
  });
  
  // Socket should be passed as a prop from the parent since $lib/socket doesn't exist
  export let peerId: string;
  export let socket: any; // Socket.io connection
  
  // Game request states
  let showGameRequest = false;
  let gameRequestDetails = {
    requestId: '',
    game: 'tic-tac-toe',
    from: '',
    timestamp: 0
  };
  
  // Track active game ID
  let activeGameId = '';
  
  const dispatch = createEventDispatcher<{
    close: void;
  }>();
  
  // Determine overlay position based on layout mode
  $: overlayPosition = $layoutStore.currentLayout === 'side-by-side' 
    ? 'fixed bottom-4 right-4 w-[280px]' 
    : 'fixed bottom-20 right-8 w-[280px]';
  
  // Handle game request
  function handleGameRequest(data: any) {
    console.log('🎮 Game request received in GameOverlay:', data, 'Socket ID:', socket?.id, 'Connected:', socket?.connected);
    
    gameRequestDetails = {
      from: data.from,
      requestId: data.requestId,
      game: 'tic-tac-toe',
      timestamp: Date.now()
    };
    
    // Show game request modal
    showGameRequest = true;
  }
  
  // Accept game request
  function acceptGameRequest() {
    console.log('✅ Accepting game request from', gameRequestDetails.from);
    
    // Send acceptance response through socket
    if (browser && socket) {
      socket.emit('tic-tac-toe-response', {
        requesterId: gameRequestDetails.from,
        requestId: gameRequestDetails.requestId,
        accepted: true
      });
    }
    
    // Hide game request modal
    showGameRequest = false;
  }
  
  // Decline game request
  function declineGameRequest() {
    console.log('❌ Declining game request from', gameRequestDetails.from);
    
    // Send decline response through socket
    if (browser && socket) {
      socket.emit('tic-tac-toe-response', {
        requesterId: gameRequestDetails.from,
        requestId: gameRequestDetails.requestId,
        accepted: false
      });
    }
    
    // Hide game request modal
    showGameRequest = false;
  }
  
  // Start a new game (initiator)
  function startTicTacToe() {
    if (browser && socket && peerId) {
      console.log('🎮 Requesting to start Tic Tac Toe with peer:', peerId, 'Socket ID:', socket.id, 'Connected:', socket.connected);
      
      // Ensure the socket is connected before sending
      if (!socket.connected) {
        console.error('Cannot send game request: Socket not connected');
        alert('Connection issue. Please try again in a moment.');
        return;
      }
      
      // Try alternative approach: emit directly to the main event
      socket.emit('tic-tac-toe-start', {
        peerId: peerId,
        game: 'tic-tac-toe',
        from: socket.id
      });
      
      console.log('Game request sent to:', peerId);
      
      // Set a timeout to check if we get a response
      setTimeout(() => {
        // If we're still in waiting state after 5 seconds, show an error
        if ($gameStore.ticTacToe.status === 'waiting') {
          console.log('No response received for game request after 5 seconds');
          
          // Try alternative: use the peer handler
          alert('Game request timed out. Please try again.');
          
          // Reset game state
          gameStore.endGame();
        }
      }, 5000);
    }
  }
  
  // Close the game overlay and notify the other player
  function closeGame() {
    // Always notify peer if the game is in playing state
    if ($gameStore.ticTacToe.status === 'playing') {
      console.log('📢 Notifying peer that game is being cancelled');
      // Emit cancel event to socket
      if (browser && socket) {
        socket.emit('game-cancel', {
          to: peerId,
          from: $userStore.pubkey || socket.id,
          game: 'tic-tac-toe'
        });
      }
    }
    
    // Always end the game and reset state properly
    console.log('Ending game completely');
    gameStore.endGame(); // This fully resets all game state
    dispatch('close');
  }
  
  // Handle a move made in the game
  function handleMove(event: CustomEvent<{index: number}>) {
    console.log('🎮 Move made at index', event.detail.index);
    
    // Send move to server
    if (browser && socket) {
      socket.emit('game-move', {
        to: peerId,
        from: $userStore.pubkey || socket.id,
        game: 'tic-tac-toe',
        moveData: {
          index: event.detail.index
        }
      });
    }
  }
  
  // Handle game reset
  function handleReset() {
    if (browser && socket) {
      socket.emit('game-reset', {
        to: peerId,
        from: $userStore.pubkey || socket.id,
        game: 'tic-tac-toe'
      });
    }
  }
  
  // Handle game cancel notification
  function handleGameCancel(event: any) {
    console.log('🚫 Game cancelled by peer', event);
    
    if (event.game === 'tic-tac-toe') {
      // Show notification that game was cancelled
      showCancelNotification = true;
      
      // Hide notification after a delay, only in browser environment
      if (browser) {
        setTimeout(() => {
          showCancelNotification = false;
          gameStore.endGame();
          dispatch('close');
        }, 3000);
      }
    }
  }
  
  // Flag to show cancel notification
  let showCancelNotification = false;
  
  // Handle expired game notification
  function handleGameExpired(event: any) {
    if (event.game === 'tic-tac-toe') {
      console.log('⏱️ Game session expired');
      gameStore.endGame();
      dispatch('close');
    }
  }
  
  // Handle game declined notification
  function handleGameDeclined(event: any) {
    console.log('❌ Game request declined', event);
    showDeclinedNotification = true;
    
    // Auto-hide after a few seconds
    if (browser) {
      setTimeout(() => {
        showDeclinedNotification = false;
      }, 3000);
    }
  }
  
  // Flag to show decline notification
  let showDeclinedNotification = false;
  
  onMount(() => {
    // Listen for game events - only if socket exists and we're in the browser
    if (browser && socket) {
      console.log('Setting up game event listeners in GameOverlay, Socket ID:', socket.id, 'Connected:', socket.connected);
      
      // Important: Force socket connection check
      if (!socket.connected) {
        console.error('Socket not connected when setting up game listeners');
        
        // Attempt to reconnect
        socket.connect();
        
        // Wait for connection and then set up listeners
        socket.on('connect', () => {
          setupGameListeners();
        });
      } else {
        // Socket is connected, set up listeners immediately
        setupGameListeners();
      }
    }
  });
  
  // Separate function to set up game listeners for better organization
  function setupGameListeners() {
    // Clear previous event listeners to avoid duplicates
    socket.off('tic-tac-toe-request');
    socket.off('tic-tac-toe-declined');
    socket.off('game-started');
    socket.off('game-cancel');
    socket.off('game-expired');
    
    // Log that we're explicitly setting up the tic-tac-toe-request listener
    console.log('Setting up tic-tac-toe-request listener');
    
    // Listen for game requests with direct attachment
    socket.on('tic-tac-toe-request', (data: {from: string, requestId: string}) => {
      console.log('🎮 Game request received in GameOverlay DIRECT HANDLER:', data);
      handleGameRequest(data);
    });
    
    // Listen for game request declined
    socket.on('tic-tac-toe-declined', handleGameDeclined);
    
    // Listen for game started event
    socket.on('game-started', (data: any) => {
      console.log('🎮 Game started event received', data);
      
      if (data.game === 'tic-tac-toe') {
        activeGameId = data.gameId;
        
        // Update game state
        gameStore.startGame('tic-tac-toe');
        gameStore.updateTicTacToeState({
          playerSymbol: data.playerSymbol,
          status: 'playing',
          currentTurn: 'X' // X always starts
        });
      }
    });
    
    // Listen for game cancellations
    socket.on('game-cancel', handleGameCancel);
    
    // Listen for game expiry
    socket.on('game-expired', handleGameExpired);
    
    // Confirm listeners are set up
    console.log('Event listeners attached to socket in GameOverlay');
    
    // Test that the event handler is working
    setTimeout(() => {
      console.log('Testing tic-tac-toe-request event handler:');
      const testHandler = socket.listeners('tic-tac-toe-request');
      console.log('Number of tic-tac-toe-request handlers:', testHandler.length);
    }, 1000);
  }
  
  onDestroy(() => {
    // Clean up socket listeners - only if socket exists and we're in the browser
    if (browser && socket) {
      console.log('Cleaning up game event listeners');
      
      // Remove event listeners
      socket.off('tic-tac-toe-request', handleGameRequest);
      socket.off('tic-tac-toe-declined', handleGameDeclined);
      socket.off('game-started');
      socket.off('game-cancel', handleGameCancel);
      socket.off('game-expired', handleGameExpired);
    }
  });
</script>

{#if showGameRequest}
  <!-- Game request notification -->
  <div 
    class="fixed bottom-20 right-6 bg-gray-900/90 backdrop-blur-sm border border-yellow-500/50 rounded-lg p-4 shadow-xl w-[300px] z-50"
    in:fly={{ y: 50, duration: 300 }}
    out:fade={{ duration: 200 }}
  >
    <h3 class="text-lg font-bold text-yellow-400 mb-2">Game Request</h3>
    <p class="text-gray-300 text-sm mb-4">
      Your chat partner wants to play Tic-Tac-Toe with you!
    </p>
    <div class="flex gap-2">
      <button 
        class="flex-1 py-2 rounded-md bg-gradient-to-r from-yellow-400 to-orange-500 text-black font-medium text-sm"
        on:click={acceptGameRequest}
      >
        Accept
      </button>
      <button 
        class="flex-1 py-2 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium text-sm"
        on:click={declineGameRequest}
      >
        Decline
      </button>
    </div>
  </div>
{/if}

{#if showCancelNotification}
  <!-- Game cancellation notification -->
  <div 
    class="fixed bottom-20 right-6 bg-red-900/90 backdrop-blur-sm border border-red-500/50 rounded-lg p-4 shadow-xl w-[300px] z-50"
    in:fly={{ y: 50, duration: 300 }}
    out:fade={{ duration: 200 }}
  >
    <h3 class="text-lg font-bold text-red-400 mb-2">Game Cancelled</h3>
    <p class="text-gray-300 text-sm">
      Your partner has cancelled the game session.
    </p>
  </div>
{/if}

{#if showDeclinedNotification}
  <!-- Game declined notification -->
  <div 
    class="fixed bottom-20 right-6 bg-gray-900/90 backdrop-blur-sm border border-gray-500/50 rounded-lg p-4 shadow-xl w-[300px] z-50"
    in:fly={{ y: 50, duration: 300 }}
    out:fade={{ duration: 200 }}
  >
    <h3 class="text-lg font-bold text-gray-400 mb-2">Game Declined</h3>
    <p class="text-gray-300 text-sm">
      Your partner declined your game request.
    </p>
  </div>
{/if}

<!-- Game overlay -->
{#if $gameStore.isPlaying}
<div 
  class="{overlayPosition} z-30"
  in:fly={{ y: 50, duration: 300 }}
  out:fade={{ duration: 200 }}
>
  <div class="relative overflow-hidden rounded-xl shadow-2xl">
    <!-- Close button -->
    <button 
      class="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full bg-gray-800/90 hover:bg-red-500/90 text-gray-300 hover:text-white z-10 transition-colors"
      on:click={closeGame}
    >
      <X class="w-3.5 h-3.5" />
    </button>
    
    <!-- Game component -->
    <div class="overflow-hidden">
      <TicTacToe 
        peerId={peerId} 
        userId={$userStore.pubkey || socket?.id || ''}
        socket={socket}
        overlay={true}
        gameId={activeGameId}
        on:move={handleMove}
        on:reset={handleReset}
        on:invite={startTicTacToe}
      />
    </div>
  </div>
</div>
{/if}