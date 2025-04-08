<script lang="ts">
  import type { ConnectionState } from '$lib/services/webrtc';
  import { Search, SkipForward, X, Mic, MicOff, Video, VideoOff, Zap, LayoutGrid, Gamepad2, Send, Check } from 'lucide-svelte';
  import { gameService, rpsGameState, receivedGameInvite, activeGame, activeGameInvite, gameConnectionStatus } from '$lib/services/gameService';
  import { fade, scale } from 'svelte/transition';
  
  // Props using standard Svelte approach
  export let connectionStatus: ConnectionState = 'idle';
  export let iceState: RTCIceConnectionState | 'N/A' = 'N/A';
  export let isSearching = false;
  export let isMuted = false;
  export let isVideoOff = false;
  
  // Game related props
  export let isGameActive = false;
  export let isGameResult = false;
  export let playAgainInviteReceived = false;
  export let previousGameRounds = 0;
  
  // Callback props
  export let onStartSearch: (() => void) | null = null;
  export let onSkipPeer: (() => void) | null = null;
  export let onStopSearch: (() => void) | null = null;
  export let onToggleMute: (() => void) | null = null;
  export let onToggleVideo: (() => void) | null = null;
  export let onToggleLayout: (() => void) | null = null;
  export let onSendTip: (() => void) | null = null;
  
  // Game callback props
  export let onCancelGame: (() => void) | null = null;
  export let onPlayAgain: (() => void) | null = null;
  export let onRespondToInvite: ((accepted: boolean) => void) | null = null;
  
  // Game invite state
  let selectedRounds = 3;
  let isWaitingForResponse = false;
  let isGameConnected = false;
  let isInviteModalOpen = false;
  let isReceiveInviteModalOpen = false;
  
  // Subscribe to game state
  $: gameState = $rpsGameState;
  $: hasReceivedPlayAgainInvite = playAgainInviteReceived && $receivedGameInvite && 
                                  $receivedGameInvite.game === 'rock-paper-scissors' && 
                                  isGameResult;
  
  // Add explicit debug logging for the Play Again button conditions
  $: {
    if (isGameResult) {
      console.log('Play Again button conditions check:', {
        isGameResult,
        hasReceivedPlayAgainInvite,
        isInviteModalOpen,
        isWaitingForResponse,
        gameStatus: gameState.status,
        gameResult: gameState.gameResult,
        shouldShowPlayAgainButton: isGameResult && !hasReceivedPlayAgainInvite && !isInviteModalOpen && !isWaitingForResponse
      });
    }
  }
  
  // Game invite reactive states
  $: {
    const isActive = $activeGameInvite !== null;
    const isCorrectGame = isActive && $activeGameInvite.game === 'rock-paper-scissors';
    const notWaiting = !isWaitingForResponse;
    
    // When game is finished (gameResult), we consider it not active for invite purposes
    const gameFinished = gameState.status === 'gameResult';
    
    console.log('ChatControls: Invite state check:', { 
      isActive, 
      isCorrectGame, 
      notWaiting,
      gameFinished,
      gameStatus: gameState.status,
      gameResult: gameState.gameResult,
      activeGameInvite: $activeGameInvite
    });
    
    // Only show invite settings UI if we're in gameResult state or not in any game state
    isInviteModalOpen = isActive && isCorrectGame && notWaiting && 
                        (gameFinished || !isGameActive);
  }
  
  // For received invites, we need a separate check
  $: {
    const hasReceivedInvite = $receivedGameInvite !== null;
    const isCorrectGame = hasReceivedInvite && $receivedGameInvite.game === 'rock-paper-scissors';
    // Show in gameResult state or when no game is active, but not during gameplay
    const showState = gameState.status === 'gameResult' || !isGameActive;
    
    console.log('ChatControls: Received invite check:', {
      hasReceivedInvite,
      isCorrectGame,
      showState,
      gameStatus: gameState.status
    });
    
    isReceiveInviteModalOpen = hasReceivedInvite && isCorrectGame && showState && !hasReceivedPlayAgainInvite;
  }
  
  $: {
    isGameConnected = $gameConnectionStatus;
  }
  
  // Clear waiting dialog when game starts or when response is received
  $: {
    // Clear waiting UI when game starts
    if (gameState.status === 'countdown') {
      console.log('ChatControls: Game starting, clearing invite UI states');
      isWaitingForResponse = false;
    }
    
    // Clear waiting UI when active invite is null (declined or accepted)
    if (isWaitingForResponse && $activeGameInvite === null) {
      console.log('ChatControls: Game invite resolved, clearing waiting UI');
      isWaitingForResponse = false;
    }
  }
  
  // Derived state
  $: isConnected = connectionStatus === 'connected' && iceState === 'connected';
  
  // Helper function to log game actions
  function logGameAction(action: string) {
    console.log(`ChatControls: ${action}`);
  }
  
  // Game invite functions 
  function sendGameInvite() {
    if (!isGameConnected) {
      console.error('ChatControls: Attempted to send invite but game connection not ready:', { isGameConnected });
      return;
    }
    
    console.log('ChatControls: Sending game invite with settings:', { rounds: selectedRounds });
    
    // Update local game state with the new round count immediately (for Play Again)
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
      console.error('ChatControls: Failed to send game invite, result was:', result);
    } else {
      console.log('ChatControls: Game invite sent successfully');
      // Show waiting UI
      isWaitingForResponse = true;
    }
  }
  
  function respondToInvite(accepted: boolean) {
    if (!isGameConnected && accepted) {
      console.error('ChatControls: Attempted to accept invite but game connection not ready:', { isGameConnected });
      return;
    }
    
    if ($receivedGameInvite) {
      console.log('ChatControls: Responding to game invite:', { 
        accepted, 
        game: $receivedGameInvite.game, 
        rounds: $receivedGameInvite.settings.rounds
      });
      
      // Send response to server
      gameService.respondToGameInvite('rock-paper-scissors', accepted);
    }
  }
  
  // Force check game result state for visibility
  $: {
    if (gameState.status === 'gameResult') {
      // Log every time we detect a game over state
      console.log('%c GAME OVER DETECTED IN CONTROLS ', 'background: #4caf50; color: white; padding: 4px;', {
        gameResult: gameState.gameResult,
        isGameResult,
        hasReceivedPlayAgainInvite,
        isInviteModalOpen,
        isWaitingForResponse,
        shouldShowPlayAgainButton: isGameResult && !hasReceivedPlayAgainInvite && !isInviteModalOpen && !isWaitingForResponse
      });
      
      // Don't modify isGameResult directly to avoid cyclical dependency
      // Just ensure our debugging is visible
    }
  }
</script>

<!-- Wrapper div -->
<div class="flex flex-col -translate-y-14">
  <!-- Top Row - Game Controls (conditionally rendered) -->
  {#if isInviteModalOpen || isWaitingForResponse || isReceiveInviteModalOpen || isGameResult}
    <div class="flex items-center justify-center z-10" 
         in:scale={{ duration: 200, start: 0.95 }} 
         out:fade={{ duration: 150 }}>
      <div class="bg-gray-900/90 backdrop-blur-sm rounded-t-xl border-t border-x border-gray-800/50 shadow-lg overflow-hidden">
        <div class="flex items-center space-x-1 md:space-x-2 p-2">
          {#if isGameResult}
            <div class="flex items-center space-x-2">
              {#if hasReceivedPlayAgainInvite}
                <span class="text-yellow-400 text-sm mr-2 hidden md:inline-block">Play again?</span>
                <button 
                  on:click={() => {
                    logGameAction('Declining play again invitation');
                    if (onRespondToInvite) onRespondToInvite(false);
                  }}
                  class="p-2 rounded-lg bg-gray-800/50 text-gray-300 hover:bg-gray-700/80 hover:text-white text-sm"
                >
                  <X size={22} />
                </button>
                <button 
                  on:click={() => {
                    logGameAction('Accepting play again invitation');
                    if (onRespondToInvite) onRespondToInvite(true);
                  }}
                  class="p-2 rounded-lg bg-green-600/90 text-white hover:bg-green-500 text-sm"
                >
                  <Check size={22} />
                </button>
              {:else if !isInviteModalOpen && !isWaitingForResponse}
                <button 
                  on:click={() => {
                    logGameAction('Play again button clicked');
                    if (onPlayAgain) onPlayAgain();
                  }}
                  class="flex items-center justify-center px-4 py-2 bg-yellow-500 hover:bg-yellow-400 text-black font-medium rounded-lg transition-all duration-200"
                >
                  <Gamepad2 class="mr-2" size={18} />
                  Play Again
                </button>
              {/if}
            </div>
          {:else if isInviteModalOpen}
            <div class="flex items-center space-x-2">
              <div class="text-xs font-medium text-gray-300">Rounds:</div>
              {#each [1, 3, 5] as rounds}
                <button 
                  class="w-8 h-8 flex items-center justify-center rounded-lg {selectedRounds === rounds ? 'bg-yellow-500 text-black' : 'bg-gray-800/80 text-gray-300'}"
                  on:click={() => selectedRounds = rounds}
                >
                  {rounds}
                </button>
              {/each}
              <button 
                class="p-2 rounded-lg bg-gray-600/80 text-gray-300"
                on:click={() => activeGameInvite.set(null)}
                title="Cancel"
              >
                <X size={22} />
              </button>
              <button 
                class="p-2 rounded-lg bg-yellow-500 text-black {!isGameConnected ? 'opacity-50 cursor-not-allowed' : ''}"
                on:click={sendGameInvite}
                disabled={!isGameConnected}
                title="Send Invite"
              >
                <Send size={22} />
              </button>
            </div>
          {:else if isWaitingForResponse}
            <div class="flex items-center space-x-2">
              <div class="w-6 h-6 border-2 border-t-yellow-500 border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin"></div>
              <div class="text-sm text-gray-300">Waiting for response...</div>
              <button 
                class="p-2 rounded-full bg-gray-800/80 text-gray-300"
                on:click={() => {
                  isWaitingForResponse = false;
                  activeGameInvite.set(null);
                }}
                title="Cancel"
              >
                <X size={22} />
              </button>
            </div>
          {:else if isReceiveInviteModalOpen}
            <div class="flex items-center space-x-2">
              <div class="text-sm text-gray-300 mr-2">
                Rock Paper Scissors 🎮 Best of {$receivedGameInvite?.settings?.rounds}
              </div>
              <button 
                class="p-2 rounded-lg bg-gray-800/80 text-gray-300"
                on:click={() => respondToInvite(false)}
                title="Decline"
              >
                <X size={22} />
              </button>
              <button 
                class="p-2 rounded-lg bg-green-600/90 text-white {!isGameConnected ? 'opacity-50 cursor-not-allowed' : ''}"
                on:click={() => respondToInvite(true)}
                disabled={!isGameConnected}
                title="Accept"
              >
                <Check size={22} />
              </button>
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  <!-- Bottom Row - Always visible chat controls -->
  <div class="flex items-center justify-center z-10 transition-transform duration-150" 
       class:translate-y-14={!(isInviteModalOpen || isWaitingForResponse || isReceiveInviteModalOpen || isGameResult)}>
    <div class="bg-gray-900/90 backdrop-blur-sm rounded-b-xl border-b border-gray-800/50 shadow-lg overflow-hidden">
      <div class="flex items-center space-x-1 md:space-x-2 p-2">
        {#if isConnected}
          <!-- Skip button -->
          <button 
            on:click={() => onSkipPeer?.()}
            class="flex items-center justify-center px-4 py-2 bg-gradient-to-r from-yellow-600 to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-black font-medium rounded-lg transition-all duration-200"
          >
            <SkipForward class="mr-2" size={18} />
            Skip
          </button>

          <!-- End chat button -->
          <button 
            on:click={() => onStopSearch?.()}
            class="p-2 rounded-lg bg-red-600/80 text-white hover:bg-red-500"
            title="End chat"
          >
            <X size={22} />
          </button>
          
          <!-- Mute/Unmute button -->
          <button 
            on:click={() => onToggleMute?.()}
            class={`p-2 rounded-lg ${isMuted ? 'bg-gray-700/80 text-red-500' : 'bg-gray-800/50 text-gray-300 hover:bg-gray-700/80 hover:text-white'}`}
            title={isMuted ? "Unmute" : "Mute"}
          >
            {#if isMuted}
              <MicOff size={22} />
            {:else}
              <Mic size={22} />
            {/if}
          </button>
          
          <!-- Video On/Off button -->
          <button 
            on:click={() => onToggleVideo?.()}
            class={`p-2 rounded-lg ${isVideoOff ? 'bg-gray-700/80 text-red-500' : 'bg-gray-800/50 text-gray-300 hover:bg-gray-700/80 hover:text-white'}`}
            title={isVideoOff ? "Turn video on" : "Turn video off"}
          >
            {#if isVideoOff}
              <VideoOff size={22} />
            {:else}
              <Video size={22} />
            {/if}
          </button>
          
          <!-- Layout button -->
          <button 
            on:click={() => onToggleLayout?.()}
            class="p-2 rounded-lg bg-gray-800/50 text-gray-300 hover:bg-gray-700/80 hover:text-white"
            title="Change layout"
          >
            <LayoutGrid size={22} />
          </button>
          
          <!-- Send tip button -->
          <button 
            on:click={() => onSendTip?.()}
            class="flex items-center justify-center px-4 py-2 bg-gray-800/50 hover:bg-gray-700/80 text-gray-300 hover:text-white rounded-lg"
          >
            <Zap class="mr-1" size={18} />
            Send tip
          </button>
          
          <!-- Cancel game button - only show when game is active -->
          {#if isGameActive}
            <div class="border-l border-gray-700/50 mx-1"></div>
            <button 
              on:click={() => {
                logGameAction('Cancel game button clicked');
                onCancelGame?.();
              }}
              class="p-2 rounded-lg bg-red-600/80 text-white hover:bg-red-500"
              title="End game"
            >
              <X size={22} />
            </button>
          {/if}
        {:else if isSearching}
          <!-- Cancel search button -->
          <button 
            on:click={() => onStopSearch?.()}
            class="flex items-center justify-center px-4 py-2 bg-gray-800/80 hover:bg-gray-700 text-gray-200 font-medium rounded-lg transition-all duration-200"
          >
            <X class="mr-2" size={18} />
            Cancel
          </button>
        {:else}
          <!-- Start search button -->
          <button 
            on:click={() => onStartSearch?.()}
            class="flex items-center justify-center px-6 py-2 bg-gradient-to-r from-yellow-600 to-yellow-500 hover:from-yellow-500 hover:to-yellow-400 text-black font-medium rounded-lg transition-all duration-200"
          >
            <Search class="mr-2" size={18} />
            Start Searching
          </button>
        {/if}
      </div>
    </div>
  </div>
</div> 