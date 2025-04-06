<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import Button from '$lib/components/ui/button/button.svelte';
    import { Settings, LayoutGrid, Square, Zap, Gamepad2 } from 'lucide-svelte';
    import { rpsGameState, activeGame } from '$lib/services/gameService';
    
    // Define layout options
    export let currentLayout: 'default' | 'side-by-side' = 'default';
    
    const dispatch = createEventDispatcher();
    
    // Toggle settings dropdown
    let showSettings = false;
    
    // Game status
    $: gameState = $rpsGameState;
    $: isGameActive = ['countdown', 'choosing', 'roundResult', 'gameResult'].includes(gameState.status);
    $: roundsToWin = Math.ceil(gameState.totalRounds / 2);
    
    function toggleSettings() {
      showSettings = !showSettings;
    }
    
    function changeLayout(layout: 'default' | 'side-by-side') {
      if (layout === currentLayout) return; // Prevent unnecessary changes
      
      console.log('Dispatching layout change to:', layout);
      
      // Use requestAnimationFrame to ensure the DOM has updated before stream attachment
      requestAnimationFrame(() => {
        dispatch('changeLayout', { layout });
      });
      
      showSettings = false;
    }
  </script>
  
  <nav class="w-full py-2 px-4 md:px-6 flex justify-between items-center bg-gray-900/60 backdrop-blur-md border-b border-gray-800/50">
    <!-- Logo and slogan -->
    <div class="flex items-center">
      <div class="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-yellow-400 to-orange-500">
        Satoshigle
      </div>
      <div class="ml-2 text-orange-500"><Zap  /></div>
    </div>

    <!-- Game Status - Center part of navbar -->
    {#if isGameActive}
      <div class="hidden md:flex items-center">
        <div class="flex items-center gap-2 bg-gray-900/80 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-gray-800/50">
          <div class="flex items-center">
            <Gamepad2 size={18} class="text-yellow-500 mr-1" />
            <span class="text-sm font-medium">Rock Paper Scissors</span>
          </div>
          
          <div class="h-4 w-px bg-gray-700"></div>
          
          <div class="flex items-center gap-2">
            <div class="text-sm">
              <span class="text-yellow-500 font-medium">{gameState.playerScore}</span>
              <span class="text-gray-400">vs</span>
              <span class="text-yellow-500 font-medium">{gameState.opponentScore}</span>
            </div>
            
            <div class="text-xs text-gray-400">
              {#if gameState.status === 'countdown'}
                Starting game...
              {:else if gameState.status === 'choosing'}
                Round {gameState.currentRound}/{gameState.totalRounds}
              {:else if gameState.status === 'roundResult'}
                Round {gameState.currentRound} result
              {:else if gameState.status === 'gameResult'}
                Game finished
              {/if}
            </div>
          </div>
        </div>
      </div>
    {/if}
    
    <!-- Controls -->
    <div class="flex items-center gap-2">
      <!-- Direct layout toggle with icons -->
      <Button 
        on:click={() => changeLayout(currentLayout === 'default' ? 'side-by-side' : 'default')}
        variant="ghost"
        size="sm"
        class="p-2 rounded-full hover:bg-gray-800"
        title={currentLayout === 'default' ? 'Switch to Side-by-Side' : 'Switch to Default'}
      >
        {#if currentLayout === 'default'}
          <LayoutGrid size={20} />
        {:else}
          <Square size={20} />
        {/if}
      </Button>
      
      <!-- Settings button -->
      <div class="relative">
        <Button 
          on:click={toggleSettings}
          variant="ghost"
          class="p-2 rounded-full hover:bg-gray-800"
        >
          <Settings size={20} />
        </Button>
        
        <!-- Settings dropdown -->
        {#if showSettings}
          <div class="absolute right-0 mt-2 w-56 rounded-md shadow-lg bg-gray-800 border border-gray-700 z-50 overflow-hidden transition-all duration-200 ease-in-out">
            <div class="py-2 px-3 border-b border-gray-700">
              <h3 class="text-sm font-medium text-gray-200">Layout Settings</h3>
            </div>
            <div class="py-2">
              <button 
                on:click={() => changeLayout('default')}
                class="w-full text-left px-4 py-2 text-sm hover:bg-gray-700 flex items-center {currentLayout === 'default' ? 'text-yellow-400' : 'text-gray-300'}"
              >
                <span class="mr-2">{currentLayout === 'default' ? '✓' : ''}</span>
                Default Layout
              </button>
              <button 
                on:click={() => changeLayout('side-by-side')}
                class="w-full text-left px-4 py-2 text-sm hover:bg-gray-700 flex items-center {currentLayout === 'side-by-side' ? 'text-yellow-400' : 'text-gray-300'}"
              >
                <span class="mr-2">{currentLayout === 'side-by-side' ? '✓' : ''}</span>
                Side by Side
              </button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </nav>
  
  <!-- Backdrop for closing settings when clicking outside -->
  {#if showSettings}
    <div 
      
      class="fixed inset-0 z-40" 
      on:click={toggleSettings}
    ></div>
  {/if}