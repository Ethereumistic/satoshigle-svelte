<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import Button from '$lib/components/ui/button/button.svelte';
    import { Settings, LayoutGrid, Square, Zap } from 'lucide-svelte';
    
    // Define layout options
    export let currentLayout: 'default' | 'side-by-side' = 'default';
    
    const dispatch = createEventDispatcher();
    
    // Toggle settings dropdown
    let showSettings = false;
    
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