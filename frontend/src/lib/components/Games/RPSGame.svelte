<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import gameService, { 
    type RPSChoice, 
    rpsGameState, 
    activeGameInvite, 
    receivedGameInvite,
    gameConnectionStatus,
    activeGame
  } from '$lib/services/gameService';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Progress from '$lib/components/ui/progress';
  import { X } from 'lucide-svelte';
  import { fade, scale } from 'svelte/transition';
  
  // Game connection status
  let isGameConnected = false;
  
  // Progress bar animation
  let progressValue = 0;
  let progressInterval: number | null = null;
  
  // Waiting for response state
  let isWaitingForResponse = false;
  
  // Subscribe to game state
  $: gameState = $rpsGameState;
  $: isInviteModalOpen = $activeGameInvite !== null && 
                         $activeGameInvite.game === 'rock-paper-scissors' && 
                         !isWaitingForResponse;
  $: isReceiveInviteModalOpen = $receivedGameInvite !== null && 
                                 $receivedGameInvite.game === 'rock-paper-scissors' &&
                                 gameState.status !== 'gameResult'; // Don't show the invite modal if we're on the game result screen
  $: {
    isGameConnected = $gameConnectionStatus;
    if (isGameConnected) {
      console.log('Game connection is active. Game communication should work properly.');
    } else {
      console.log('Game connection is not active. Game invites may not be sent or received.');
    }
  }
  
  // Debug received game invite settings whenever it changes
  $: if ($receivedGameInvite) {
    console.log('%c Received game invite in component with settings: ', 'background: #17a2b8; color: white; padding: 4px;', $receivedGameInvite.settings);
  }
  
  // Debug game state changes for rounds
  $: console.log(`Current game state: Round ${gameState.currentRound} of ${gameState.totalRounds}`);
  
  // Selected rounds for game settings
  let selectedRounds = 3;
  
  // Game display helpers
  $: totalProgressDuration = gameState.timeRemaining * 1000; // Convert to ms
  $: roundsToWin = Math.ceil(gameState.totalRounds / 2);
  $: isGameActive = ['countdown', 'choosing', 'roundResult', 'gameResult'].includes(gameState.status);
  
  // Simple notification
  let showNotification = false;
  let notificationMessage = '';
  let notificationTimeout: number | null = null;
  
  // Add new state variable for play again invitation
  let playAgainInviteReceived = false;
  let previousGameRounds = 0;
  
  // Track when a game is actually in progress
  $: isActuallyPlaying = gameState.status !== 'waiting';
  
  // Update progress bar based on time remaining
  $: {
    if (browser && gameState.status === 'choosing' && gameState.timeRemaining > 0) {
      // Start progress bar animation
      if (progressInterval) {
        clearInterval(progressInterval);
      }
      
      progressValue = 0;
      const startTime = Date.now();
      const duration = gameState.timeRemaining * 1000;
      
      progressInterval = window.setInterval(() => {
        const elapsed = Date.now() - startTime;
        progressValue = Math.min((elapsed / duration) * 100, 100);
        
        if (progressValue >= 100) {
          clearInterval(progressInterval!);
        }
      }, 50);
    } else if (progressInterval && gameState.status !== 'choosing') {
      clearInterval(progressInterval);
      progressInterval = null;
    }
  }
  
  // Game state changes handler
  $: {
    if (gameState.status === 'countdown') {
      // If countdown starts, close invite modals/dialogs
      isWaitingForResponse = false;
      isInviteModalOpen = false;
    }
  }
  
  // Debug additional state transitions for troubleshooting
  $: {
    if (gameState.status === 'roundResult') {
      console.log('Round result shown:', {
        playerChoice: gameState.playerChoice,
        opponentChoice: gameState.opponentChoice,
        roundResult: gameState.roundResult,
        score: `${gameState.playerScore}-${gameState.opponentScore}`
      });
    } else if (gameState.status === 'gameResult') {
      console.log('Game result shown:', {
        playerChoice: gameState.playerChoice,
        opponentChoice: gameState.opponentChoice,
        gameResult: gameState.gameResult,
        finalScore: `${gameState.playerScore}-${gameState.opponentScore}`
      });
    }
  }
  
  // Handle round choices
  function makeChoice(choice: RPSChoice) {
    if (!choice) return;
    
    if (!isGameConnected) {
      showError('Cannot make choice - game connection not ready. Try again or restart the game.');
      return;
    }
    
    gameService.makeRPSChoice(choice);
  }
  
  // Handle game invites
  function sendGameInvite() {
    // Check if game service is connected
    if (!isGameConnected) {
      console.error('Attempted to send invite but game connection not ready:', { isGameConnected });
      showError('Cannot send invite - game connection not ready. Please try again in a few seconds.');
      return;
    }
    
    console.log('Sending game invite with settings:', { rounds: selectedRounds });
    const result = gameService.sendGameInvite('rock-paper-scissors', { rounds: selectedRounds });
    
    if (!result) {
      console.error('Failed to send game invite, result was:', result);
      showError('Failed to send game invite. Please try again or restart the connection.');
    } else {
      console.log('Game invite sent successfully');
      // Show waiting UI
      isWaitingForResponse = true;
    }
  }
  
  // Add more detailed control over invitation flow
  function respondToInvite(accepted: boolean) {
    if (!isGameConnected && accepted) {
      console.error('Attempted to accept invite but game connection not ready:', { isGameConnected });
      showError('Cannot accept invite - game connection not ready. Please try again in a few seconds.');
      return;
    }
    
    if ($receivedGameInvite) {
      console.log('Responding to game invite:', { 
        accepted, 
        game: $receivedGameInvite.game, 
        rounds: $receivedGameInvite.settings.rounds,
        currentGameState: gameState.status
      });
      
      // When accepting a Play Again invitation, reset game state first
      if (accepted && gameState.status === 'gameResult') {
        console.log('Accepting Play Again invitation - resetting local state first');
        gameService.resetRPSGame();
      }
      
      gameService.respondToGameInvite('rock-paper-scissors', accepted);
      
      // Reset play again state if needed
      if (gameState.status === 'gameResult') {
        playAgainInviteReceived = false;
      }
      
      // Close the invite modal if it's open
      isReceiveInviteModalOpen = false;
    }
  }
  
  // Enhance resetGame to improve the Play Again flow
  function resetGame(playAgainOrEvent: boolean | Event = false) {
    // Determine if this is a play again request
    const playAgain = typeof playAgainOrEvent === 'boolean' ? playAgainOrEvent : false;
    
    // If playAgain is true, send invitation with same settings
    if (playAgain && gameState.status === 'gameResult') {
      console.log('Sending play again invitation with rounds:', gameState.totalRounds);
      // Remember the rounds from previous game
      previousGameRounds = gameState.totalRounds;
      
      // Reset game locally first
      gameService.resetRPSGame();
      
      // Send new invite with same settings
      gameService.sendGameInvite('rock-paper-scissors', { rounds: gameState.totalRounds });
      
      // Show waiting UI
      isWaitingForResponse = true;
      
      // Reset active game to indicate we're waiting for a new game
      activeGame.set(null);
    } else {
      // Regular cancel - cancel the game for both players
      const currentActiveGame = $activeGame;
      if (currentActiveGame) {
        console.log('Cancelling active game for both players');
        gameService.cancelGame(currentActiveGame);
      } else {
        // Fallback to local reset only
        gameService.resetRPSGame();
        activeGameInvite.set(null);
        isWaitingForResponse = false;
      }
    }
    // Reset play again flag
    playAgainInviteReceived = false;
  }
  
  // Clean up on component destroy
  onDestroy(() => {
    if (progressInterval) {
      clearInterval(progressInterval);
    }
    
    if (notificationTimeout) {
      clearTimeout(notificationTimeout);
    }
  });
  
  // Get emoji for a choice
  function getChoiceEmoji(choice: RPSChoice): string {
    if (choice === 'rock') return '✊';
    if (choice === 'paper') return '✋';
    if (choice === 'scissors') return '✌️';
    return '';
  }
  
  // Get color for a result
  function getResultColor(result: 'win' | 'lose' | 'draw' | null): string {
    if (result === 'win') return 'text-green-500';
    if (result === 'lose') return 'text-red-500';
    if (result === 'draw') return 'text-yellow-500';
    return '';
  }
  
  // Get text for a result
  function getResultText(result: 'win' | 'lose' | 'draw' | null): string {
    if (result === 'win') return 'You Win!';
    if (result === 'lose') return 'You Lose!';
    if (result === 'draw') return 'Draw!';
    return '';
  }
  
  // Show error notification
  function showError(message: string) {
    // Clear any existing notification timer
    if (notificationTimeout) {
      clearTimeout(notificationTimeout);
    }
    
    // Set notification message and show it
    notificationMessage = message;
    showNotification = true;
    
    // Auto-hide after 5 seconds
    notificationTimeout = window.setTimeout(() => {
      showNotification = false;
    }, 5000);
  }
  
  // Show custom notification when game is canceled by opponent
  function handleGameCanceled() {
    showNotification = true;
    notificationMessage = 'Game was canceled by your opponent';
    notificationTimeout = window.setTimeout(() => {
      showNotification = false;
    }, 5000);
  }
  
  // Subscribe to cancelation events
  $: {
    if ($activeGame === null && isGameActive) {
      // If active game is set to null while game is active, it means the game was canceled
      console.log('Game was canceled while active');
      handleGameCanceled();
    }
  }
  
  // Track play again invites
  $: {
    if ($receivedGameInvite && 
        $receivedGameInvite.game === 'rock-paper-scissors' && 
        gameState.status === 'gameResult') {
      console.log('Received play again invitation with rounds:', $receivedGameInvite.settings.rounds);
      playAgainInviteReceived = true;
      previousGameRounds = $receivedGameInvite.settings.rounds;
      
      // This ensures the standard invite modal doesn't show
      isReceiveInviteModalOpen = false;
    }
  }
  
  // Add a simple wrapper function to handle play again
  function handlePlayAgain() {
    resetGame(true);
  }
</script>

<!-- Game Invite Modal -->
<Dialog.Root bind:open={isInviteModalOpen}>
  <Dialog.Content class="bg-gray-900 border border-gray-800">
    <Dialog.Header>
      <Dialog.Title>Rock Paper Scissors</Dialog.Title>
      <Dialog.Description>
        Configure game settings and send an invite to your peer.
      </Dialog.Description>
    </Dialog.Header>
    
    <div class="p-4 space-y-4">
      <div>
        <label class="block text-sm font-medium mb-2">Rounds</label>
        <div class="flex gap-2">
          {#each [1, 3, 5] as rounds}
            <button 
              class="px-4 py-2 rounded-md {selectedRounds === rounds ? 'bg-yellow-500 text-black' : 'bg-gray-800 text-gray-300'}"
              on:click={() => selectedRounds = rounds}
            >
              {rounds}
            </button>
          {/each}
        </div>
        <p class="text-xs text-gray-400 mt-1">
          Best of {selectedRounds} ({Math.ceil(selectedRounds / 2)} wins needed)
        </p>
      </div>
      
      {#if !isGameConnected}
        <div class="px-3 py-2 bg-red-900/50 border border-red-700 rounded-md text-sm">
          <p class="text-red-300">Game connection not ready. Please try refreshing the page.</p>
        </div>
      {:else}
        <div class="px-3 py-2 bg-green-900/50 border border-green-700 rounded-md text-sm">
          <p class="text-green-300">Game connection ready. You can send invites.</p>
        </div>
      {/if}
    </div>
    
    <Dialog.Footer>
      <button 
        class="px-4 py-2 rounded-md bg-gray-800 text-gray-300 hover:bg-gray-700"
        on:click={() => activeGameInvite.set(null)}
      >
        Cancel
      </button>
      <button 
        class="px-4 py-2 rounded-md bg-yellow-500 text-black hover:bg-yellow-400 {!isGameConnected ? 'opacity-50 cursor-not-allowed' : ''}"
        on:click={sendGameInvite}
        disabled={!isGameConnected}
      >
        Send Invite
      </button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Waiting for Response Modal -->
<Dialog.Root bind:open={isWaitingForResponse}>
  <Dialog.Content class="bg-gray-900 border border-gray-800">
    <Dialog.Header>
      <Dialog.Title>Waiting for Response</Dialog.Title>
      <Dialog.Description>
        Waiting for your peer to accept or decline the invitation...
      </Dialog.Description>
    </Dialog.Header>
    
    <div class="p-8 flex justify-center items-center flex-col space-y-4">
      <div class="w-16 h-16 border-4 border-t-yellow-500 border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin"></div>
      <p class="text-gray-300 text-center">Your game invitation was sent successfully.<br>Waiting for a response...</p>
    </div>
    
    <Dialog.Footer>
      <button 
        class="px-4 py-2 rounded-md bg-gray-800 text-gray-300 hover:bg-gray-700"
        on:click={() => {
          isWaitingForResponse = false;
          activeGameInvite.set(null);
        }}
      >
        Cancel Invitation
      </button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Game Invitation Received Modal -->
<Dialog.Root bind:open={isReceiveInviteModalOpen}>
  <Dialog.Content class="bg-gray-900 border border-gray-800">
    <Dialog.Header>
      <Dialog.Title>Game Invitation</Dialog.Title>
      <Dialog.Description>
        Your peer has invited you to play Rock Paper Scissors.
      </Dialog.Description>
    </Dialog.Header>
    
    <div class="p-4">
      {#if $receivedGameInvite}
        <p class="mb-2">
          Best of {$receivedGameInvite.settings.rounds} 
          ({Math.ceil($receivedGameInvite.settings.rounds / 2)} wins needed)
        </p>
        
        {#if !isGameConnected}
          <div class="px-3 py-2 bg-red-900/50 border border-red-700 rounded-md text-sm mt-2">
            <p class="text-red-300">Game connection not ready. Please try refreshing the page.</p>
          </div>
        {:else}
          <div class="px-3 py-2 bg-green-900/50 border border-green-700 rounded-md text-sm mt-2">
            <p class="text-green-300">Game connection ready. You can accept this invite.</p>
          </div>
        {/if}
      {/if}
    </div>
    
    <Dialog.Footer>
      <button 
        class="px-4 py-2 rounded-md bg-gray-800 text-gray-300 hover:bg-gray-700"
        on:click={() => respondToInvite(false)}
      >
        Decline
      </button>
      <button 
        class="px-4 py-2 rounded-md bg-green-500 text-white hover:bg-green-400 {!isGameConnected ? 'opacity-50 cursor-not-allowed' : ''}"
        on:click={() => respondToInvite(true)}
        disabled={!isGameConnected}
      >
        Accept
      </button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Game Overlay with progress bar at top -->
{#if isGameActive}
  <div class="fixed inset-0 z-40 pointer-events-none">
    <!-- Loading border/Progress Bar -->
    {#if gameState.status === 'choosing'}
      <div class="absolute inset-x-0 top-0 h-2">
        <div class="w-full h-full bg-gray-800">
          <div class="h-full bg-yellow-500 transition-transform duration-100"
               style="width: {progressValue}%;"></div>
        </div>
      </div>
    {/if}
    
    <!-- Game UI -->
    <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-auto bg-black/70 z-50">
      <!-- Close button -->
      <button 
        class="absolute top-4 right-4 p-2 rounded-full bg-gray-900/80 text-gray-300 hover:bg-gray-800"
        on:click={resetGame}
      >
        <X size={20} />
      </button>
      
      <!-- Game Status -->
      <div class="mb-8 text-center">
        <h2 class="text-2xl font-bold mb-2">Rock Paper Scissors</h2>
        <div class="flex items-center gap-4 mb-2">
          <div class="text-center">
            <span class="text-2xl">You</span>
            <div class="text-xl font-bold">{gameState.playerScore}</div>
          </div>
          <div class="text-xl">vs</div>
          <div class="text-center">
            <span class="text-2xl">Opponent</span>
            <div class="text-xl font-bold">{gameState.opponentScore}</div>
          </div>
        </div>
        <div class="text-yellow-500">
          Round {gameState.currentRound} of {gameState.totalRounds}
          (Need {roundsToWin} to win)
        </div>
      </div>
      
      <!-- Countdown -->
      {#if gameState.status === 'countdown'}
        <div class="flex flex-col items-center justify-center">
          <div in:scale={{ duration: 300, start: 0.5 }} 
               out:fade={{ duration: 200 }}
               class="text-8xl font-bold mb-4 text-yellow-500">
            {gameState.countdown}
          </div>
          <div class="w-32 h-4 bg-gray-800 rounded-full overflow-hidden">
            <div class="h-full bg-yellow-500 transition-all duration-1000" 
                 style="width: {(gameState.countdown / 3) * 100}%"></div>
          </div>
          <div class="mt-4 text-gray-300">Get ready...</div>
        </div>
      <!-- Round Result -->
      {:else if gameState.status === 'roundResult'}
        <div class="mb-8 text-center">
          <div class="flex items-center justify-center gap-8 mb-4">
            <div class="text-6xl p-4 bg-gray-800/50 rounded-lg">
              {getChoiceEmoji(gameState.playerChoice)}
            </div>
            <div class="text-4xl">vs</div>
            <div class="text-6xl p-4 bg-gray-800/50 rounded-lg">
              {getChoiceEmoji(gameState.opponentChoice)}
            </div>
          </div>
          <div in:scale={{ duration: 300, start: 0.5 }}
               class="text-3xl font-bold {getResultColor(gameState.roundResult)} mt-4">
            {getResultText(gameState.roundResult)}
          </div>
        </div>
      <!-- Game Result -->
      {:else if gameState.status === 'gameResult'}
        <div class="mb-8 text-center">
          <div in:scale={{ duration: 400, start: 0.7 }}
               class="text-4xl font-bold {getResultColor(gameState.gameResult)} mb-4">
            {#if gameState.gameResult === 'win'}
              You Won the Game!
            {:else if gameState.gameResult === 'lose'}
              You Lost the Game!
            {:else}
              The Game is a Draw!
            {/if}
          </div>
          <div class="flex items-center justify-center gap-8 my-6">
            <div class="text-center">
              <div class="text-7xl">{getChoiceEmoji(gameState.playerChoice)}</div>
              <div class="mt-2">Your final move</div>
            </div>
            <div class="text-4xl">vs</div>
            <div class="text-center">
              <div class="text-7xl">{getChoiceEmoji(gameState.opponentChoice)}</div>
              <div class="mt-2">Opponent's final move</div>
            </div>
          </div>
          <div class="text-xl mb-2">
            Final Score: <span class="text-yellow-500 font-bold">{gameState.playerScore} - {gameState.opponentScore}</span>
          </div>
          <div class="text-sm text-gray-400 mb-6">
            Game was best of {gameState.totalRounds} {gameState.totalRounds === 1 ? 'round' : 'rounds'}
          </div>
          
          {#if playAgainInviteReceived}
            <!-- Play Again invitation received -->
            <div class="space-y-4">
              <div class="text-yellow-400 animate-pulse">
                Your opponent wants to play again!
                <div class="text-sm text-gray-300">
                  Best of {previousGameRounds} {previousGameRounds === 1 ? 'round' : 'rounds'}
                </div>
              </div>
              <div class="flex space-x-4 justify-center">
                <button 
                  class="px-4 py-2 rounded-md bg-gray-800 text-gray-300 hover:bg-gray-700"
                  on:click={() => respondToInvite(false)}
                >
                  Decline
                </button>
                <button 
                  class="px-6 py-3 rounded-lg bg-green-500 text-white font-medium hover:bg-green-400 animate-pulse"
                  on:click={() => respondToInvite(true)}
                >
                  Accept Game
                </button>
              </div>
            </div>
          {:else}
            <!-- Regular Play Again button -->
            <button 
              class="px-6 py-3 rounded-lg bg-yellow-500 text-black font-medium hover:bg-yellow-400"
              on:click={handlePlayAgain}
            >
              Play Again
            </button>
          {/if}
        </div>
      <!-- Choosing -->
      {:else}
        <div class="mb-4 text-center">
          <div class="text-xl mb-2">Choose your move:</div>
          <div class="flex gap-4 mb-6">
            <button 
              class="bg-gray-800 hover:bg-gray-700 w-20 h-20 rounded-lg flex items-center justify-center text-4xl transition-transform {gameState.playerChoice === 'rock' ? 'ring-2 ring-yellow-500 scale-110' : ''}"
              on:click={() => makeChoice('rock')}
              disabled={gameState.playerChoice !== null}
            >
              ✊
            </button>
            <button 
              class="bg-gray-800 hover:bg-gray-700 w-20 h-20 rounded-lg flex items-center justify-center text-4xl transition-transform {gameState.playerChoice === 'paper' ? 'ring-2 ring-yellow-500 scale-110' : ''}"
              on:click={() => makeChoice('paper')}
              disabled={gameState.playerChoice !== null}
            >
              ✋
            </button>
            <button 
              class="bg-gray-800 hover:bg-gray-700 w-20 h-20 rounded-lg flex items-center justify-center text-4xl transition-transform {gameState.playerChoice === 'scissors' ? 'ring-2 ring-yellow-500 scale-110' : ''}"
              on:click={() => makeChoice('scissors')}
              disabled={gameState.playerChoice !== null}
            >
              ✌️
            </button>
          </div>
          {#if gameState.playerChoice}
            <div class="text-center text-green-500">
              You chose {gameState.playerChoice}!
              {#if !gameState.opponentChoice}
                <div class="text-gray-400 mt-2 flex items-center justify-center">
                  <span>Waiting for opponent</span>
                  <span class="ml-1 inline-flex">
                    <span class="animate-ping delay-0">.</span>
                    <span class="animate-ping delay-150">.</span>
                    <span class="animate-ping delay-300">.</span>
                  </span>
                </div>
              {/if}
            </div>
          {/if}
          
          <div class="mt-6">
            <div class="text-sm text-gray-400">Time remaining:</div>
            <div class="w-80 h-3 bg-gray-800 mx-auto mt-1 rounded-full overflow-hidden">
              <div class="h-full bg-yellow-500 transition-transform duration-100"
                   style="width: {progressValue}%;"></div>
            </div>
            <div class="text-sm text-gray-400 mt-1">
              {Math.max(0, Math.ceil(gameState.timeRemaining))} seconds
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- Custom Notification -->
{#if showNotification}
  <div class="fixed bottom-4 right-4 z-50 bg-red-900 border border-red-700 text-white p-4 rounded-lg shadow-lg max-w-sm animate-in fade-in slide-in-from-right-5 duration-300">
    <div class="flex items-center">
      <div class="mr-3">
        <!-- Simple error icon -->
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-red-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <div class="flex-1">
        <h3 class="font-medium">Connection Error</h3>
        <p class="text-sm text-red-200">{notificationMessage}</p>
      </div>
      <button 
        class="ml-2 text-red-300 hover:text-white"
        on:click={() => showNotification = false}
        aria-label="Close notification"
      >
        ×
      </button>
    </div>
  </div>
{/if} 