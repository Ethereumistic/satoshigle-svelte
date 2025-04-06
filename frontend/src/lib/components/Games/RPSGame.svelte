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

  // Add special debugging for game activation
  $: {
    console.log('Game status change detected:', {
      status: gameState.status,
      currentRound: gameState.currentRound,
      totalRounds: gameState.totalRounds,
      activeGame: $activeGame,
      isGameActive: ['countdown', 'choosing', 'roundResult', 'gameResult'].includes(gameState.status)
    });
    
    // Special debugging for 1-round games
    if (gameState.totalRounds === 1) {
      console.log('Single round game detected:', {
        status: gameState.status,
        activeGame: $activeGame
      });
    }
  }
  
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
  
  // Notification state
  let isNotificationVisible = false;
  let notificationMessage = '';
  let notificationType: 'error' | 'info' = 'error';
  let notificationTimeout: number | null = null;
  
  // Add new state variable for play again invitation
  let playAgainInviteReceived = false;
  let previousGameRounds = 0;
  
  // Track when a game is actually in progress
  $: isActuallyPlaying = gameState.status !== 'waiting';
  
  // Add a flag to track who canceled the game
  let selfCanceled = false;
  
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
    
    // IMPORTANT: Update our local game state with the new round count immediately
    // This ensures our UI will show the correct number of rounds
    if (gameState.status === 'gameResult' && gameState.totalRounds !== selectedRounds) {
      console.log('Updating local game state with new round count:', { 
        oldRounds: gameState.totalRounds, 
        newRounds: selectedRounds 
      });
      // Reset game state first, then update with our selected rounds
      gameService.resetRPSGame();
      // Update our local rpsGameState to have the correct round count
      gameService.updateRPSGameSettings({ rounds: selectedRounds });
    }
    
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
  
  // Enhance resetGame to improve the Play Again flow
  function resetGame(playAgainOrEvent: boolean | Event = false) {
    // Determine if this is a play again request
    const playAgain = typeof playAgainOrEvent === 'boolean' ? playAgainOrEvent : false;
    
    // If playAgain is true, open settings instead of immediately sending
    if (playAgain && gameState.status === 'gameResult') {
      console.log('Opening Play Again settings with rounds:', gameState.totalRounds);
      // Remember the rounds from previous game
      previousGameRounds = gameState.totalRounds;
      selectedRounds = gameState.totalRounds;
      
      // Reset game UI first but don't send the invite yet
      gameService.resetRPSGame();
      
      // Instead of setting activeGameInvite here, let the parent component handle it
      // This is to prevent conflicts with the ChatControls component
      console.log('RPSGame: Resetting for Play Again, letting parent component handle invite UI');
      
      // Reset active game
      activeGame.set(null);
    } else {
      // Regular cancel - cancel the game for both players
      const currentActiveGame = $activeGame;
      if (currentActiveGame) {
        console.log('Cancelling active game for both players');
        // Set flag to indicate we're canceling the game ourselves
        selfCanceled = true;
        gameService.cancelGame(currentActiveGame);
        setTimeout(() => { selfCanceled = false; }, 1000); // Reset flag after a short delay
      } else {
        // Fallback to local reset only
        console.log('No active game to cancel, just resetting local state');
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
  
  // Show custom notifications with different styles
  function showNotification(message: string, type: 'error' | 'info' = 'error') {
    // Clear any existing notification timer
    if (notificationTimeout) {
      clearTimeout(notificationTimeout);
    }
    
    // Set notification message and show it
    notificationMessage = message;
    notificationType = type;
    isNotificationVisible = true;
    
    // Auto-hide after 5 seconds
    notificationTimeout = window.setTimeout(() => {
      isNotificationVisible = false;
    }, 5000);
  }
  
  // Show error notification
  function showError(message: string) {
    showNotification(message, 'error');
  }
  
  // Show custom notification when game is canceled by opponent
  function handleGameCanceled() {
    showNotification('Game was canceled by your opponent', 'error');
  }
  
  // Subscribe to cancelation events
  $: {
    if ($activeGame === null && isGameActive && !selfCanceled) {
      // If active game is set to null while game is active AND we didn't cancel it ourselves,
      // it means the game was canceled by the opponent
      console.log('Game was canceled by opponent while active');
      handleGameCanceled();
      
      // IMPORTANT: Force reset our own game state to ensure UI clears properly
      if (gameState.status === 'gameResult') {
        console.log('Forcing reset of game state to clear UI');
        gameService.resetRPSGame();
      }
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
    console.log('RPSGame handlePlayAgain called, status:', gameState.status);
    resetGame(true);
  }
  
  // Subscribe to active game invite changes to detect declined invitations
  $: {
    // If we were waiting for a response and the invite disappeared, it means it was declined
    // Works for both initial game invites and play again invites
    if (isWaitingForResponse && $activeGameInvite === null) {
      console.log('Game invitation was declined or timed out while waiting');
      isWaitingForResponse = false;
      showError('The other player declined your invitation');
    }
    
    // Handle case where we declined a play again invitation or the other player declined ours
    if (gameState.status === 'gameResult' && !playAgainInviteReceived && $receivedGameInvite === null && $activeGameInvite === null) {
      // Check if there's no active game anymore (indicating a declined play again invitation)
      if ($activeGame === null) {
        console.log('Play again invitation was declined or canceled, resetting game UI state');
        // Clean up everything by calling resetGame which will reset the RPS game state
        resetGame();
      }
    }
    
    // Log state changes for debugging
    if ($activeGameInvite !== null) {
      console.log('RPSGame detected activeGameInvite:', $activeGameInvite);
    }
  }
  
  // Function to decline the "Play Again" invitation
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
      } else if (!accepted && gameState.status === 'gameResult') {
        console.log('Declining Play Again invitation - resetting game state');
        // Set flag to indicate we're canceling the game ourselves
        selfCanceled = true;
        // Set activeGame to null to trigger the cleanup in our reactive statement
        activeGame.set(null);
        // IMPORTANT: Reset the game state for ourselves too
        gameService.resetRPSGame();
        setTimeout(() => { selfCanceled = false; }, 1000); // Reset flag after a short delay
      }
      
      // Send response to server
      gameService.respondToGameInvite('rock-paper-scissors', accepted);
      
      // Reset play again state
      if (gameState.status === 'gameResult') {
        playAgainInviteReceived = false;
        
        // If declining, show a notification to self that we declined
        if (!accepted) {
          showNotification('You declined the invitation', 'info');
        }
      }
      
      // Close the invite modal if it's open
      isReceiveInviteModalOpen = false;
    }
  }
</script>

<!-- DISABLED: Game Invite Modals have been moved to VideoChat.svelte -->
<!-- Replace the Game Invite Modal with a minimal overlay -->
{#if false && isInviteModalOpen}
  <div class="fixed bottom-20 left-1/2 transform -translate-x-1/2 z-40 pointer-events-auto"
       in:fade={{ duration: 200 }}
       out:fade={{ duration: 150 }}>
    <div class="bg-gray-900/90 backdrop-blur-sm rounded-lg border border-gray-800/70 shadow-lg overflow-hidden max-w-md"
         in:scale={{ duration: 200, start: 0.95, opacity: 0 }}>
      <div class="p-3 border-b border-gray-800/60">
        <h3 class="font-medium text-lg">Rock Paper Scissors</h3>
        <p class="text-xs text-gray-400">Configure game settings</p>
      </div>
      
      <div class="p-4">
        <div>
          <label class="block text-sm font-medium mb-2">Rounds</label>
          <div class="flex gap-2">
            {#each [1, 3, 5] as rounds}
              <button 
                class="px-4 py-2 rounded-md {selectedRounds === rounds ? 'bg-yellow-500 text-black' : 'bg-gray-800/80 text-gray-300'}"
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
      </div>
      
      <div class="flex justify-end p-3 border-t border-gray-800/60 bg-gray-900/40">
        <button 
          class="px-3 py-1.5 rounded-md bg-gray-800/80 text-gray-300 hover:bg-gray-700/90 mr-2"
          on:click={() => activeGameInvite.set(null)}
        >
          Cancel
        </button>
        <button 
          class="px-3 py-1.5 rounded-md bg-yellow-500 text-black hover:bg-yellow-400 {!isGameConnected ? 'opacity-50 cursor-not-allowed' : ''}"
          on:click={sendGameInvite}
          disabled={!isGameConnected}
        >
          Send Invite
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Replace the Waiting for Response Modal with a minimal overlay -->
{#if false && isWaitingForResponse}
  <div class="fixed bottom-32 left-1/2 transform -translate-x-1/2 z-40 pointer-events-auto"
       in:fade={{ duration: 200 }}
       out:fade={{ duration: 150 }}>
    <div class="bg-gray-900/90 backdrop-blur-sm rounded-lg border border-gray-800/70 shadow-lg overflow-hidden max-w-md"
         in:scale={{ duration: 200, start: 0.95, opacity: 0 }}>
      <div class="p-4 flex items-center">
        <div class="w-10 h-10 border-3 border-t-yellow-500 border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin mr-3"></div>
        <div>
          <h3 class="font-medium">Waiting for Response</h3>
          <p class="text-sm text-gray-400">Game invite sent to peer...</p>
        </div>
      </div>
      
      <div class="flex justify-end p-3 border-t border-gray-800/60 bg-gray-900/40">
        <button 
          class="px-3 py-1.5 rounded-md bg-gray-800/80 text-gray-300 hover:bg-gray-700/90"
          on:click={() => {
            console.log('Cancelling waiting for response');
            isWaitingForResponse = false;
            
            // Clear the active invite to ensure it's fully cancelled
            if ($activeGameInvite) {
              console.log('Clearing active invite:', $activeGameInvite);
              activeGameInvite.set(null);
            }
            
            // Show confirmation to user
            showNotification('You cancelled the invitation', 'info');
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Replace the Game Invitation Received Modal with a minimal overlay -->
{#if false && isReceiveInviteModalOpen}
  <div class="fixed bottom-32 left-1/2 transform -translate-x-1/2 z-40 pointer-events-auto"
       in:fade={{ duration: 200 }}
       out:fade={{ duration: 150 }}>
    <div class="bg-gray-900/90 backdrop-blur-sm rounded-lg border border-gray-800/70 shadow-lg overflow-hidden max-w-md"
         in:scale={{ duration: 200, start: 0.95, opacity: 0 }}>
      <div class="p-3 border-b border-gray-800/60">
        <h3 class="font-medium text-lg">Game Invitation</h3>
        <p class="text-xs text-gray-400">Rock Paper Scissors challenge</p>
      </div>
      
      <div class="p-4">
        {#if $receivedGameInvite}
          <div class="flex items-center justify-center mb-2">
            <div class="text-4xl mr-3">🎮</div>
            <div>
              <p class="text-sm">
                Best of <span class="text-yellow-500 font-medium">{$receivedGameInvite?.settings?.rounds}</span> 
                rounds
              </p>
              <p class="text-xs text-gray-400">
                ({Math.ceil(($receivedGameInvite?.settings?.rounds || 3) / 2)} wins needed)
              </p>
            </div>
          </div>
        {/if}
      </div>
      
      <div class="flex justify-end p-3 border-t border-gray-800/60 bg-gray-900/40">
        <button 
          class="px-3 py-1.5 rounded-md bg-gray-800/80 text-gray-300 hover:bg-gray-700/90 mr-2"
          on:click={() => respondToInvite(false)}
        >
          Decline
        </button>
        <button 
          class="px-3 py-1.5 rounded-md bg-green-600/90 text-white hover:bg-green-500 {!isGameConnected ? 'opacity-50 cursor-not-allowed' : ''}"
          on:click={() => respondToInvite(true)}
          disabled={!isGameConnected}
        >
          Accept
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Game Overlay with responsive positioning based on layout -->
{#if isGameActive}
  <div class="fixed inset-0 z-30 pointer-events-none">
    <!-- Loading border/Progress Bar -->
    {#if gameState.status === 'choosing'}
      <div class="absolute inset-x-0 top-0 h-2 z-40">
        <div class="w-full h-full bg-gray-800/70">
          <div class="h-full bg-yellow-500 transition-transform duration-100"
               style="width: {progressValue}%;"></div>
        </div>
      </div>
    {/if}
    
    <!-- Game Status panel - positioned at the top in Navbar area -->
    <div class="absolute top-12 inset-x-0 flex justify-center pointer-events-auto z-40">
      <div class="bg-gray-900/80 backdrop-blur-sm rounded-lg border border-gray-800/70 px-5 py-2 shadow-lg">
        <div class="flex items-center gap-4">
          <div class="text-center">
            <span class="text-sm text-gray-300">You</span>
            <div class="text-lg font-bold text-yellow-500">{gameState.playerScore}</div>
          </div>
          <div class="text-sm font-bold">Round {gameState.currentRound}/{gameState.totalRounds}</div>
          <div class="text-center">
            <span class="text-sm text-gray-300">Opponent</span>
            <div class="text-lg font-bold text-yellow-500">{gameState.opponentScore}</div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Countdown overlay - shows in center of screen -->
    {#if gameState.status === 'countdown'}
      <div class="absolute inset-0 flex items-center justify-center pointer-events-auto z-40">
        <div in:scale={{ duration: 300, start: 0.5 }} 
             out:fade={{ duration: 200 }}
             class="text-8xl font-bold text-yellow-500 bg-black/40 backdrop-blur-sm p-10 rounded-full">
          {gameState.countdown}
        </div>
      </div>
    <!-- Round/Game Result - shows as smaller overlay -->
    {:else if gameState.status === 'roundResult' || gameState.status === 'gameResult'}
      <div class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-auto z-40">
        <div class="bg-gray-900/90 backdrop-blur-sm border border-gray-800 rounded-lg p-4 shadow-lg text-center">
          {#if gameState.status === 'roundResult'}
            <div in:scale={{ duration: 300, start: 0.5 }}
                 class="text-xl font-bold {getResultColor(gameState.roundResult)} mb-2">
              {getResultText(gameState.roundResult)}
            </div>
          {:else if gameState.status === 'gameResult'}
            <div in:scale={{ duration: 400, start: 0.7 }}
                 class="text-2xl font-bold {getResultColor(gameState.gameResult)} mb-3">
              {#if gameState.gameResult === 'win'}
                You Won!
              {:else if gameState.gameResult === 'lose'}
                You Lost!
              {:else}
                Game Draw!
              {/if}
            </div>
            <div class="text-sm text-gray-400 mb-2">
              Final Score: <span class="text-yellow-500 font-bold">{gameState.playerScore} - {gameState.opponentScore}</span>
            </div>
          {/if}
          
          <div class="flex items-center justify-center gap-4 my-3">
            <div class="text-center">
              <div class="text-5xl">{getChoiceEmoji(gameState.playerChoice)}</div>
              <div class="mt-1 text-xs">You</div>
            </div>
            <div class="text-xl">vs</div>
            <div class="text-center">
              <div class="text-5xl">{getChoiceEmoji(gameState.opponentChoice)}</div>
              <div class="mt-1 text-xs">Opponent</div>
            </div>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}

<!-- Choice buttons overlay - positioned above chat controls -->
{#if isGameActive && gameState.status === 'choosing' && !gameState.playerChoice}
  <div class="fixed bottom-24 left-1/2 transform -translate-x-1/2 z-40 pointer-events-auto">
    <div class="bg-gray-900/80 backdrop-blur-sm rounded-lg border border-gray-800 p-3 shadow-lg">
      <div class="flex gap-3">
        <button 
          class="bg-gray-800/90 hover:bg-gray-700 w-16 h-16 rounded-lg flex items-center justify-center text-3xl transition-transform hover:scale-110"
          on:click={() => makeChoice('rock')}
        >
          ✊
        </button>
        <button 
          class="bg-gray-800/90 hover:bg-gray-700 w-16 h-16 rounded-lg flex items-center justify-center text-3xl transition-transform hover:scale-110"
          on:click={() => makeChoice('paper')}
        >
          ✋
        </button>
        <button 
          class="bg-gray-800/90 hover:bg-gray-700 w-16 h-16 rounded-lg flex items-center justify-center text-3xl transition-transform hover:scale-110"
          on:click={() => makeChoice('scissors')}
        >
          ✌️
        </button>
      </div>
      
      <div class="mt-2 text-center text-sm text-gray-300">
        Time: {Math.max(0, Math.ceil(gameState.timeRemaining))}s
      </div>
    </div>
  </div>
{/if}

<!-- Waiting message when you've made your choice -->
{#if isGameActive && gameState.status === 'choosing' && gameState.playerChoice && !gameState.opponentChoice}
  <div class="fixed bottom-24 left-1/2 transform -translate-x-1/2 z-40 pointer-events-auto">
    <div class="bg-gray-900/80 backdrop-blur-sm rounded-lg border border-gray-800 p-3 shadow-lg">
      <div class="text-center text-gray-200 flex items-center">
        <span>Waiting for opponent</span>
        <span class="ml-1 inline-flex">
          <span class="animate-ping delay-0">.</span>
          <span class="animate-ping delay-150">.</span>
          <span class="animate-ping delay-300">.</span>
        </span>
      </div>
    </div>
  </div>
{/if}

<!-- Custom Notification with dynamic styling -->
{#if isNotificationVisible}
  <div 
    class="fixed bottom-4 right-4 z-50 p-4 rounded-lg shadow-lg max-w-sm animate-in fade-in slide-in-from-right-5 duration-300"
    class:bg-red-900={notificationType === 'error'} 
    class:border-red-700={notificationType === 'error'}
    class:bg-blue-900={notificationType === 'info'} 
    class:border-blue-700={notificationType === 'info'}
    class:text-white={true}
    class:border={true}
  >
    <div class="flex items-center">
      <div class="mr-3">
        {#if notificationType === 'error'}
          <!-- Error icon -->
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-red-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        {:else}
          <!-- Info icon -->
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        {/if}
      </div>
      <div class="flex-1">
        <h3 class="font-medium">
          {notificationType === 'error' ? 'Error' : 'Information'}
        </h3>
        <p class="text-sm" class:text-red-200={notificationType === 'error'} class:text-blue-200={notificationType === 'info'}>
          {notificationMessage}
        </p>
      </div>
      <button 
        class="ml-2" 
        class:text-red-300={notificationType === 'error'} 
        class:text-blue-300={notificationType === 'info'} 
        class:hover:text-white={true}
        on:click={() => (isNotificationVisible = false)}
        aria-label="Close notification"
      >
        ×
      </button>
    </div>
  </div>
{/if} 