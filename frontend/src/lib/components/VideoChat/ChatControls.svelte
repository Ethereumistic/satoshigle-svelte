<script lang="ts">
  import type { ConnectionState } from '$lib/services/webrtc';
  import { Search, SkipForward, X, Mic, MicOff, Video, VideoOff, Zap, LayoutGrid } from 'lucide-svelte';
  
  // Props using standard Svelte approach
  export let connectionStatus: ConnectionState = 'idle';
  export let iceState: RTCIceConnectionState | 'N/A' = 'N/A';
  export let isSearching = false;
  export let isMuted = false;
  export let isVideoOff = false;
  
  // Callback props
  export let onStartSearch: (() => void) | null = null;
  export let onSkipPeer: (() => void) | null = null;
  export let onStopSearch: (() => void) | null = null;
  export let onToggleMute: (() => void) | null = null;
  export let onToggleVideo: (() => void) | null = null;
  export let onToggleLayout: (() => void) | null = null;
  export let onSendTip: (() => void) | null = null;
  
  // Derived state
  $: isConnected = connectionStatus === 'connected' && iceState === 'connected';
</script>

<div class="flex items-center justify-center mt-4 md:mt-6 z-10">
  <div class="bg-gray-900/90 backdrop-blur-sm rounded-xl border border-gray-800/50 shadow-lg overflow-hidden">
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
        
        <!-- End chat button -->
        <button 
          on:click={() => onStopSearch?.()}
          class="p-2 rounded-lg bg-red-600/80 text-white hover:bg-red-500"
          title="End chat"
        >
          <X size={22} />
        </button>
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