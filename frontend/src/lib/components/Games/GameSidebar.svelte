<script lang="ts">
  import { 
    Swords, 
    Dices, 
    Gamepad2, 
    Spade, 
    Target, 
    X, 
    Hand, 
    Joystick,
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    User,
    Settings,
    LogOut,
    Plus,
    Minus
  } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import { slide } from 'svelte/transition';
  import * as Collapsible from '$lib/components/ui/collapsible';
  import * as Avatar from '$lib/components/ui/avatar';
  import * as Separator from '$lib/components/ui/separator';
  import { userStore } from '$lib/stores/userStore';
  
  // Props
  export let currentLayout: 'default' | 'side-by-side' = 'default';
  // New prop for peer connection status
  export let peerConnected: boolean = false;
  
  // State
  let isExpanded = true;
  let isMobile = false;
  let gamesOpen = true;
  
  // Callback Props (replacing dispatcher)
  export let onSelectGame: (detail: { game: string }) => void = () => {};
  export let onOpenSettings: () => void = () => {};
  export let onLogin: () => void = () => {};
  export let onLogout: () => void = () => {};
  
  // Games data
  const games = [
    { id: 'tic-tac-toe', name: 'Tic-Tac-Toe', icon: X },
    { id: 'rock-paper-scissors', name: 'Rock Paper Scissors', icon: Hand },
    { id: 'chess', name: 'Chess', icon: Swords },
    { id: 'dice', name: 'Dice Roll', icon: Dices },
    { id: 'cards', name: 'Poker', icon: Spade },
    { id: 'darts', name: 'Darts', icon: Target },
    { id: 'arcade', name: 'Arcade Games', icon: Gamepad2 }
  ];
  
  // Handle game selection
  function selectGame(gameId: string) {
    if (!peerConnected) {
      console.log('Cannot select game without peer connection');
      return;
    }
    
    console.log(`Selected game: ${gameId}`);
    
    // For Tic Tac Toe, use the new direct approach
    if (gameId === 'tic-tac-toe') {
      // Use the game overlay which will handle the direct start request
      onSelectGame({ game: gameId });
    } else {
      // For other games, use the regular event dispatch
      onSelectGame({ game: gameId });
    }
  }
  
  // Toggle sidebar expansion
  function toggleSidebar() {
    isExpanded = !isExpanded;
  }
  
  // Handle login button click
  function handleLogin() {
    onLogin();
  }
  
  // Handle logout button click
  function handleLogout() {
    onLogout();
  }
  
  // Check if mobile on mount and when window resizes
  function checkMobile() {
    isMobile = window.innerWidth < 768;
    // Auto-collapse on mobile
    if (isMobile) isExpanded = false;
  }
  
  onMount(() => {
    checkMobile();
    
    // Add resize listener
    window.addEventListener('resize', checkMobile);
    
    // Cleanup
    return () => {
      window.removeEventListener('resize', checkMobile);
    };
  });
</script>

<!-- Fixed width container to prevent horizontal scrolling -->
<div 
  class="fixed left-0 top-0 h-screen z-20 flex flex-col bg-gray-900/90 backdrop-blur-md border-r border-gray-800/50
         {isExpanded ? 'w-64' : 'w-16'} 
         {currentLayout === 'side-by-side' ? 'mt-16' : 'mt-16'}
         transition-all duration-300 ease-in-out shadow-md overflow-hidden"
>
  <!-- Toggle button -->
  <button 
    class="absolute right-5 top-0  h-6 w-6 rounded-full bg-yellow-500 text-black flex items-center justify-center shadow-md hover:bg-yellow-400 transition-all"
    on:click={toggleSidebar}
    aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
  >
    {#if isExpanded}
      <ChevronLeft class="h-4 w-4" />
    {:else}
      <ChevronRight class="h-4 w-4" />
    {/if}
  </button>
  
  <!-- Content -->
  <div class="flex-1 flex flex-col pt-8 pb-4 overflow-y-auto overflow-x-hidden">
    <!-- Header -->
    <!-- <div class="px-4 mb-6">
      <div class="flex items-center font-medium text-gray-100">
        <Joystick class="h-5 w-5 mr-2 text-yellow-400" />
        {#if isExpanded}
          <span class="text-lg font-semibold">Satoshigle</span>
        {/if}
      </div>
    </div>
    
    <Separator.Root class="mb-4 mx-3 bg-gray-800" /> -->
    
    <!-- Games Section -->
    <div class="px-3 space-y-1 mb-4">
      <Collapsible.Root bind:open={gamesOpen} class="w-full">
        <div class="flex items-center justify-between px-2 py-2 rounded-md hover:bg-gray-800 transition-colors relative">
          <div class="flex items-center">
            <Gamepad2 class="h-5 w-5 text-yellow-400 {isExpanded ? 'mr-3' : ''}" />
            {#if isExpanded}
              <span class="text-sm font-medium text-gray-200">Games</span>
            {/if}
          </div>
          
          <!-- Only show toggle when expanded -->
          {#if isExpanded}
            <Collapsible.Trigger class="h-5 w-5 flex items-center justify-center rounded-sm hover:bg-gray-700">
              {#if gamesOpen}
                <Minus class="h-4 w-4 text-gray-300" />
              {:else}
                <Plus class="h-4 w-4 text-gray-300" />
              {/if}
            </Collapsible.Trigger>
          {:else}
            <!-- When collapsed, clicking anywhere on the header toggles games -->
            <button 
              class="absolute inset-0 w-full h-full cursor-pointer"
              on:click={() => gamesOpen = !gamesOpen}
              aria-label={gamesOpen ? "Collapse games" : "Expand games"}
            ></button>
          {/if}
        </div>
        
        <Collapsible.Content>
          {#if isExpanded}
            <div class="pl-9 pr-2 space-y-1 mt-1" transition:slide={{ duration: 200 }}>
              {#each games as game}
                <button 
                  class="w-full flex items-center justify-start rounded-md px-2 py-2 text-sm 
                        {peerConnected 
                          ? 'text-gray-300 hover:bg-gray-800 hover:text-yellow-400' 
                          : 'text-gray-500 cursor-not-allowed'} 
                        transition-colors"
                  on:click={() => selectGame(game.id)}
                  disabled={!peerConnected}
                  title={peerConnected ? game.name : 'Connect to a partner to play games'}
                >
                  <svelte:component this={game.icon} class="h-4 w-4 mr-3 flex-shrink-0" />
                  <span class="truncate">{game.name}</span>
                </button>
              {/each}
            </div>
          {:else}
            <!-- Collapsed view of games -->
            <div class="space-y-1 mt-1" transition:slide={{ duration: 200 }}>
              {#each games as game}
                <button 
                  class="w-full flex items-center justify-center rounded-md p-2 text-sm 
                        {peerConnected 
                          ? 'text-gray-300 hover:bg-gray-800 hover:text-yellow-400' 
                          : 'text-gray-500 cursor-not-allowed'} 
                        transition-colors"
                  on:click={() => selectGame(game.id)}
                  disabled={!peerConnected}
                  title={peerConnected ? game.name : 'Connect to a partner to play games'}
                >
                  <svelte:component this={game.icon} class="h-5 w-5 flex-shrink-0" />
                </button>
              {/each}
            </div>
          {/if}
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  </div>
  
  <Separator.Root class="mb-4 mx-3 bg-gray-800" />
  <!-- Footer with user info - fixed at bottom -->
  <div class="absolute bottom-20 left-0 right-0 border-gray-800   px-3 ">
    {#if $userStore.isLoggedIn}
      <div class="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-gray-800 transition-colors">
        {#if isExpanded}
          <Avatar.Root class="h-8 w-8 flex-shrink-0">
            {#if $userStore.profile?.picture}
              <Avatar.Image src={$userStore.profile.picture} alt={$userStore.profile.displayName || 'User'} />
            {:else}
              <Avatar.Fallback class="bg-yellow-500/10 text-yellow-400">
                {($userStore.profile?.displayName || 'U').charAt(0)}
              </Avatar.Fallback>
            {/if}
          </Avatar.Root>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium truncate text-gray-200">
              {$userStore.profile?.displayName || 'Anonymous'}
            </p>
            <p class="text-xs text-gray-400 truncate">
              {#if $userStore.npub}
                {$userStore.npub.slice(0, 10)}...{$userStore.npub.slice(-8)}
              {:else}
                Nostr User
              {/if}
            </p>
          </div>
          <button 
            class="h-8 w-8 flex items-center justify-center rounded-md hover:bg-gray-700 text-gray-400 flex-shrink-0"
            on:click={onOpenSettings}
            aria-label="Settings"
          >
            <Settings class="h-4 w-4" />
          </button>
        {:else}
          <button 
            class="w-full flex items-center justify-center p-2"
            on:click={onOpenSettings}
            aria-label="Settings"
          >
            <Avatar.Root class="h-8 w-8">
              {#if $userStore.profile?.picture}
                <Avatar.Image src={$userStore.profile.picture} alt={$userStore.profile.displayName || 'User'} />
              {:else}
                <Avatar.Fallback class="bg-yellow-500/10 text-yellow-400">
                  {($userStore.profile?.displayName || 'U').charAt(0)}
                </Avatar.Fallback>
              {/if}
            </Avatar.Root>
          </button>
        {/if}
      </div>
      
      {#if isExpanded}
        <button 
          class="w-full flex items-center gap-3 px-2 py-2 mt-1 rounded-md hover:bg-gray-800 transition-colors text-sm text-gray-300"
          on:click={handleLogout}
        >
          <LogOut class="h-4 w-4 text-gray-400" />
          <span>Log out</span>
        </button>
      {/if}
    {:else}
      <button 
        class="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-yellow-500 text-black hover:bg-yellow-400 transition-colors"
        on:click={handleLogin}
      >
        {#if isExpanded}
          <User class="h-4 w-4" />
          <span>Log in with Nostr</span>
        {:else}
          <User class="h-5 w-5" />
        {/if}
      </button>
    {/if}
  </div>
</div>