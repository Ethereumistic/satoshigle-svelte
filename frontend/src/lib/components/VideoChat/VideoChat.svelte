<script lang="ts">
  import { onMount, onDestroy, afterUpdate } from 'svelte';
  import type { ConnectionState } from '$lib/services/webrtc';
  import { Zap, Video, Mic, Volume2, X, Settings, Camera, Send } from 'lucide-svelte';
  import { browser } from '$app/environment';
  import { fade, scale } from 'svelte/transition';
  import gameService, { 
    activeGameInvite, 
    receivedGameInvite,
    gameConnectionStatus,
    rpsGameState,
  } from '$lib/services/gameService';
  
  // Props using standard Svelte approach
  export let localStream: MediaStream | null = null;
  export let remoteStream: MediaStream | null = null;
  export let connectionStatus: ConnectionState = 'idle';
  export let iceState: RTCIceConnectionState | 'N/A' = 'N/A';
  export let layout: 'default' | 'side-by-side' = 'default';
  // Add callback prop for track switching
  export let onTrackChange: ((type: 'video' | 'audio', track: MediaStreamTrack) => void) | null = null;
  // Settings modal control props
  export let showSettingsModal = false;
  export let onSettingsModalClose: () => void = () => {};
  
  // Game overlay props
  export let playerChoiceEmoji: string | null = null;
  export let opponentChoiceEmoji: string | null = null;
  export let showPlayerChoice = false;
  export let showOpponentChoice = false;
  
  // Game invite props and state (keep but don't show UI)
  let selectedRounds = 3;
  let isWaitingForResponse = false;
  let isGameConnected = false;
  
  // Reactive states
  $: isConnected = connectionStatus === 'connected' && iceState === 'connected';
  $: isInviteModalOpen = $activeGameInvite !== null && 
                        $activeGameInvite.game === 'rock-paper-scissors' && 
                        !isWaitingForResponse;
  $: isReceiveInviteModalOpen = $receivedGameInvite !== null && 
                               $receivedGameInvite.game === 'rock-paper-scissors';
  $: {
    isGameConnected = $gameConnectionStatus;
  }
  
  // Clear waiting dialog when game starts or when response is received
  $: {
    // Clear waiting UI when game starts
    if ($rpsGameState && $rpsGameState.status === 'countdown') {
      console.log('Game starting, clearing invite UI states');
      isWaitingForResponse = false;
      // No need to clear activeGameInvite here as it will be cleared automatically
    }
    
    // Clear waiting UI when active invite is null (declined or accepted)
    if (isWaitingForResponse && $activeGameInvite === null) {
      console.log('Game invite resolved, clearing waiting UI');
      isWaitingForResponse = false;
    }
    
    // Clear received invite UI when response is sent or game starts
    if ($rpsGameState && $rpsGameState.status !== 'waiting' && $receivedGameInvite !== null) {
      console.log('Game starting after receiving invite, clearing received invite UI');
      // The receivedGameInvite store will be cleared by the gameService
    }
  }
  
  // Video elements
  let defaultLocalVideo: HTMLVideoElement;
  let defaultRemoteVideo: HTMLVideoElement;
  let sideLocalVideo: HTMLVideoElement;
  let sideRemoteVideo: HTMLVideoElement;
  
  // Track last stream to detect changes
  let lastRemoteStream: MediaStream | null = null;
  
  // Track when to force update
  let shouldForceUpdate = false;
  
  // Settings modal state
  let activeSettingsTab: 'video' | 'audio' | 'volume' = 'video';
  
  // Available devices
  let videoDevices: MediaDeviceInfo[] = [];
  let audioDevices: MediaDeviceInfo[] = [];
  let selectedVideoDeviceId = '';
  let selectedAudioDeviceId = '';
  let remoteVolume = 1.0; // Range 0-1
  
  // Game invite functions (keep these for use in ChatControls)
  function sendGameInvite() {
    if (!isGameConnected) {
      console.error('Attempted to send invite but game connection not ready:', { isGameConnected });
      return;
    }
    
    console.log('Sending game invite with settings:', { rounds: selectedRounds });
    
    const result = gameService.sendGameInvite('rock-paper-scissors', { rounds: selectedRounds });
    
    if (!result) {
      console.error('Failed to send game invite, result was:', result);
    } else {
      console.log('Game invite sent successfully');
      // Show waiting UI
      isWaitingForResponse = true;
    }
  }
  
  function respondToInvite(accepted: boolean) {
    if (!isGameConnected && accepted) {
      console.error('Attempted to accept invite but game connection not ready:', { isGameConnected });
      return;
    }
    
    if ($receivedGameInvite) {
      console.log('Responding to game invite:', { 
        accepted, 
        game: $receivedGameInvite.game, 
        rounds: $receivedGameInvite.settings.rounds
      });
      
      // Send response to server
      gameService.respondToGameInvite('rock-paper-scissors', accepted);
      
      // Clear UI state immediately to avoid delay
      isReceiveInviteModalOpen = false;
    }
  }
  
  // Update preview video when settings modal is shown or tab changes
  $: {
    // Only run in browser environment
    if (browser && showSettingsModal && activeSettingsTab === 'video' && localStream) {
      setTimeout(() => {
        const previewVideo = document.getElementById('settings-preview-video') as HTMLVideoElement;
        if (previewVideo && localStream) {
          previewVideo.srcObject = localStream;
        }
      }, 0);
    }
  }
  
  // Load available media devices
  async function loadAvailableDevices() {
    // Skip if not in browser
    if (!browser) return;
    
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      
      // Filter devices by type
      videoDevices = devices.filter(device => device.kind === 'videoinput');
      audioDevices = devices.filter(device => device.kind === 'audioinput');
      
      // Set initial selected devices if there's a current stream
      if (localStream) {
        const videoTrack = localStream.getVideoTracks()[0];
        const audioTrack = localStream.getAudioTracks()[0];
        
        if (videoTrack) {
          const settings = videoTrack.getSettings();
          selectedVideoDeviceId = settings.deviceId || '';
        }
        
        if (audioTrack) {
          const settings = audioTrack.getSettings();
          selectedAudioDeviceId = settings.deviceId || '';
        }
      }
      
      console.log('Available devices loaded:', { videoDevices, audioDevices });
    } catch (err) {
      console.error('Error loading available devices:', err);
    }
  }
  
  // Switch to a different video/audio source
  async function switchMediaSource(type: 'video' | 'audio', deviceId: string) {
    // Skip if not in browser
    if (!browser || !deviceId) return;
    
    try {
      // Create constraints based on device selection
      const constraints: MediaStreamConstraints = {};
      
      if (type === 'video') {
        constraints.video = { deviceId: { exact: deviceId } };
        // Keep audio if we already have it
        if (localStream?.getAudioTracks().length) {
          constraints.audio = true;
        }
      } else if (type === 'audio') {
        constraints.audio = { deviceId: { exact: deviceId } };
        // Keep video if we already have it
        if (localStream?.getVideoTracks().length) {
          constraints.video = true;
        }
      }
      
      // Get new media stream
      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      // Replace specific track in the current stream
      if (localStream) {
        if (type === 'video') {
          const videoTrack = newStream.getVideoTracks()[0];
          if (videoTrack) {
            // Remove old video tracks
            localStream.getVideoTracks().forEach(track => {
              localStream?.removeTrack(track);
              track.stop();
            });
            
            // Add new video track
            localStream.addTrack(videoTrack);
            selectedVideoDeviceId = deviceId;
            
            // Update the peer connection if we're connected
            if (isConnected && onTrackChange) {
              onTrackChange('video', videoTrack);
            }
            
            // Update local UI
            updateLocalStream(localStream, true);
          }
        } else if (type === 'audio') {
          const audioTrack = newStream.getAudioTracks()[0];
          if (audioTrack) {
            // Remove old audio tracks
            localStream.getAudioTracks().forEach(track => {
              localStream?.removeTrack(track);
              track.stop();
            });
            
            // Add new audio track
            localStream.addTrack(audioTrack);
            selectedAudioDeviceId = deviceId;
            
            // Update the peer connection if we're connected
            if (isConnected && onTrackChange) {
              onTrackChange('audio', audioTrack);
            }
          }
        }
      } else {
        // If no existing stream, use the new one
        localStream = newStream;
        updateLocalStream(localStream, true);
        
        // Notify parent component if connected
        if (isConnected && onTrackChange) {
          if (type === 'video') {
            const videoTrack = newStream.getVideoTracks()[0];
            if (videoTrack) onTrackChange('video', videoTrack);
          } else if (type === 'audio') {
            const audioTrack = newStream.getAudioTracks()[0];
            if (audioTrack) onTrackChange('audio', audioTrack);
          }
        }
      }
      
      console.log(`Switched ${type} source to:`, deviceId);
    } catch (err) {
      console.error(`Error switching ${type} source:`, err);
    }
  }
  
  // Update remote volume
  function updateRemoteVolume(volume: number) {
    remoteVolume = volume;
    
    // Update volume on both remote videos
    if (defaultRemoteVideo) {
      defaultRemoteVideo.volume = remoteVolume;
    }
    
    if (sideRemoteVideo) {
      sideRemoteVideo.volume = remoteVolume;
    }
  }
  
  // Close settings modal
  function closeSettings() {
    onSettingsModalClose();
  }
  
  // Update video elements when props change
  $: {
    if (localStream) {
      updateLocalStream(localStream);
    }
  }
  
  // Force video element update when connected state changes
  $: {
    if (connectionStatus === 'connected' && remoteStream) {
      shouldForceUpdate = true;
      // Use setTimeout to ensure the update happens after state changes
      setTimeout(() => {
        forceUpdateVideoElements();
      }, 100);
    }
  }
  
  // Watch remote stream changes separately for more control
  $: {
    if (remoteStream !== lastRemoteStream) {
      lastRemoteStream = remoteStream;
      if (remoteStream) {
        console.log('Remote stream changed, updating video elements');
        shouldForceUpdate = true;
        updateRemoteStream(remoteStream);
      }
    }
  }
  
  // Monitor layout changes
  $: {
    if (layout) {
      console.log('Layout changed, updating video elements');
      // Delay to ensure DOM is updated
      setTimeout(updateVideoElements, 50);
    }
  }
  
  // Force update of video elements (clears and reattaches streams)
  function forceUpdateVideoElements() {
    console.log('Force updating video elements');
    
    // Clear all video sources first
    if (defaultRemoteVideo && defaultRemoteVideo.srcObject) {
      defaultRemoteVideo.srcObject = null;
    }
    
    if (sideRemoteVideo && sideRemoteVideo.srcObject) {
      sideRemoteVideo.srcObject = null;
    }
    
    // Re-attach streams after a small delay
    setTimeout(() => {
      if (remoteStream) {
        updateRemoteStream(remoteStream, true);
      }
      shouldForceUpdate = false;
    }, 50);
  }
  
  // Attach streams to video elements
  function updateVideoElements() {
    if (localStream) {
      updateLocalStream(localStream);
    }
    
    if (remoteStream) {
      updateRemoteStream(remoteStream);
    }
  }
  
  function updateLocalStream(stream: MediaStream, force = false) {
    if (defaultLocalVideo && (force || !defaultLocalVideo.srcObject)) {
      defaultLocalVideo.srcObject = stream;
    }
    
    if (sideLocalVideo && (force || !sideLocalVideo.srcObject)) {
      sideLocalVideo.srcObject = stream;
    }
  }
  
  function updateRemoteStream(stream: MediaStream, force = false) {
    console.log('Updating remote stream, force:', force);
    
    if (defaultRemoteVideo && (force || !defaultRemoteVideo.srcObject)) {
      console.log('Setting defaultRemoteVideo.srcObject');
      defaultRemoteVideo.srcObject = stream;
      defaultRemoteVideo.volume = remoteVolume;
      defaultRemoteVideo.play().catch(err => console.error('Error playing default remote video:', err));
    }
    
    if (sideRemoteVideo && (force || !sideRemoteVideo.srcObject)) {
      console.log('Setting sideRemoteVideo.srcObject');
      sideRemoteVideo.srcObject = stream;
      sideRemoteVideo.volume = remoteVolume;
      sideRemoteVideo.play().catch(err => console.error('Error playing side remote video:', err));
    }
  }
  
  // Additional lifecycle hook to catch any updates
  afterUpdate(() => {
    if (shouldForceUpdate && remoteStream) {
      updateRemoteStream(remoteStream, true);
      shouldForceUpdate = false;
    }
  });
  
  onMount(() => {
    // Only execute browser-specific code in the browser environment
    if (browser) {
      // Initial update of video elements
      updateVideoElements();
      
      // Load available media devices
      loadAvailableDevices();
      
      // Add event listeners for loadedmetadata to handle when video is ready
      if (defaultRemoteVideo) {
        defaultRemoteVideo.addEventListener('loadedmetadata', () => {
          defaultRemoteVideo.play().catch(err => console.error('Error playing default remote video:', err));
        });
      }
      
      if (sideRemoteVideo) {
        sideRemoteVideo.addEventListener('loadedmetadata', () => {
          sideRemoteVideo.play().catch(err => console.error('Error playing side remote video:', err));
        });
      }
      
      // Add device change listener
      navigator.mediaDevices.addEventListener('devicechange', loadAvailableDevices);
    }
  });
  
  onDestroy(() => {
    // Only execute browser-specific code in the browser environment
    if (browser) {
      // Clean up video elements
      if (defaultLocalVideo && defaultLocalVideo.srcObject) {
        defaultLocalVideo.srcObject = null;
      }
      
      if (defaultRemoteVideo && defaultRemoteVideo.srcObject) {
        defaultRemoteVideo.srcObject = null;
      }
      
      if (sideLocalVideo && sideLocalVideo.srcObject) {
        sideLocalVideo.srcObject = null;
      }
      
      if (sideRemoteVideo && sideRemoteVideo.srcObject) {
        sideRemoteVideo.srcObject = null;
      }
      
      // Remove device change listener
      navigator.mediaDevices.removeEventListener('devicechange', loadAvailableDevices);
    }
  });
</script>

{#if layout === 'default'}
  <!-- Default Layout: Large remote video with small local video in corner -->
  <div class="w-full max-w-[74%] -mt-4">
    <div class="relative w-full aspect-video rounded-xl overflow-hidden backdrop-blur-sm bg-black/30 border border-gray-800/50 shadow-[0_0_15px_rgba(0,0,0,0.5)] transition-all duration-300 ease-in-out">
      <!-- Remote Video -->
      <video 
        bind:this={defaultRemoteVideo} 
        autoplay 
        playsinline
        class="absolute inset-0 w-full h-full object-cover bg-gray-900/80"
      ></video>

      <div class="absolute flex bottom-4 left-4 items-center z-10">
        <div class="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-yellow-400 to-orange-500">
          Satoshigle
        </div>
        <div class="ml-2 text-orange-500"><Zap /></div>
      </div>
      
      <!-- Opponent Choice Emoji Overlay (for default layout) -->
      {#if showOpponentChoice && opponentChoiceEmoji}
        <div class="absolute top-10 left-1/2 transform -translate-x-1/2 z-20 pointer-events-none">
          <div class="bg-gray-900/70 backdrop-blur-sm rounded-full p-3 shadow-lg border border-yellow-500/50">
            <div class="text-4xl">{opponentChoiceEmoji}</div>
          </div>
        </div>
      {/if}
      
      <!-- Status Overlay -->
      {#if !isConnected}
        <div class="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div class="text-center p-6 max-w-md">
            {#if connectionStatus === 'searching' || connectionStatus === 'waiting'}
              <div class="w-16 h-16 border-4 border-t-yellow-400 border-r-yellow-400/20 border-b-yellow-400/20 border-l-yellow-400/20 rounded-full animate-spin mx-auto mb-4"></div>
              <h3 class="text-xl font-medium mb-2">
                {connectionStatus === 'searching' ? 'Searching for someone to chat with...' : 'Waiting for peer to connect...'}
              </h3>
            {:else if connectionStatus === 'peer-left'}
              <div class="w-16 h-16 rounded-full bg-orange-500/20 flex items-center justify-center mx-auto mb-4">
                <span class="text-3xl">⚠️</span>
              </div>
              <h3 class="text-xl font-medium mb-2">Peer Disconnected</h3>
              <p class="text-gray-400 mb-4">Your chat partner has left the conversation</p>
            {:else if connectionStatus === 'error'}
              <div class="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
                <span class="text-3xl">❌</span>
              </div>
              <h3 class="text-xl font-medium mb-2">Connection Error</h3>
              <p class="text-gray-400 mb-4">There was a problem with your connection</p>
            {/if}
          </div>
        </div>
      {/if}
      
      <!-- Local Video Preview -->
      <div class="absolute bottom-4 right-4 w-1/4 max-w-[240px] aspect-video rounded-lg overflow-hidden border-2 border-gray-700/50 shadow-lg">
        <video 
          bind:this={defaultLocalVideo} 
          autoplay 
          muted 
          playsinline
          class="absolute inset-0 w-full h-full object-cover bg-gray-900"
        ></video>
        
        <!-- Player Choice Emoji Overlay (for default layout) -->
        {#if showPlayerChoice && playerChoiceEmoji}
          <div class="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
            <div class="bg-gray-900/70 backdrop-blur-sm rounded-full p-2 shadow-lg border border-yellow-500/50">
              <div class="text-3xl">{playerChoiceEmoji}</div>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{:else}
  <!-- Side by Side Layout: Equal sized videos -->
  <div class="w-full max-w-[85%] -mt-4">
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 transition-all duration-300 ease-in-out">
      <!-- Remote Video -->
      <div class="relative aspect-square rounded-xl overflow-hidden backdrop-blur-sm bg-black/30 border border-gray-800/50 shadow-[0_0_15px_rgba(0,0,0,0.5)]">
        <video 
          bind:this={sideRemoteVideo} 
          autoplay 
          playsinline
          class="absolute inset-0 w-full h-full object-cover bg-gray-900/80"
        ></video>

        <div class="absolute flex bottom-4 left-4 items-center z-10">
          <div class="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-yellow-400 to-orange-500">
            Satoshigle
          </div>
          <div class="ml-2 text-orange-500"><Zap /></div>
        </div>
        
        <!-- Opponent Choice Emoji Overlay (for side-by-side layout) -->
        {#if showOpponentChoice && opponentChoiceEmoji}
          <div class="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
            <div class="bg-gray-900/70 backdrop-blur-sm rounded-full p-3 shadow-lg border border-yellow-500/50">
              <div class="text-4xl">{opponentChoiceEmoji}</div>
            </div>
          </div>
        {/if}
        
        <!-- Status Overlay for Remote Video -->
        {#if !isConnected}
          <div class="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div class="text-center p-4 max-w-[90%]">
              {#if connectionStatus === 'searching' || connectionStatus === 'waiting'}
                <div class="w-12 h-12 border-4 border-t-yellow-400 border-r-yellow-400/20 border-b-yellow-400/20 border-l-yellow-400/20 rounded-full animate-spin mx-auto mb-3"></div>
                <h3 class="text-lg font-medium">
                  {connectionStatus === 'searching' ? 'Searching...' : 'Waiting...'}
                </h3>
              {:else if connectionStatus === 'peer-left'}
                <div class="w-12 h-12 rounded-full bg-orange-500/20 flex items-center justify-center mx-auto mb-3">
                  <span class="text-2xl">⚠️</span>
                </div>
                <h3 class="text-lg font-medium">Peer Disconnected</h3>
              {:else if connectionStatus === 'error'}
                <div class="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-3">
                  <span class="text-2xl">❌</span>
                </div>
                <h3 class="text-lg font-medium">Connection Error</h3>
              {/if}
            </div>
          </div>
        {/if}
        
        <div class="absolute top-2 left-2 px-2 py-1 bg-black/50 rounded text-xs">
          Peer
        </div>
      </div>
      
      <!-- Local Video -->
      <div class="relative aspect-square rounded-xl overflow-hidden backdrop-blur-sm bg-black/30 border border-gray-800/50 shadow-[0_0_15px_rgba(0,0,0,0.5)]">
        <video 
          bind:this={sideLocalVideo} 
          autoplay 
          muted 
          playsinline
          class="absolute inset-0 w-full h-full object-cover bg-gray-900"
        ></video>
        
        <!-- Player Choice Emoji Overlay (for side-by-side layout) -->
        {#if showPlayerChoice && playerChoiceEmoji}
          <div class="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
            <div class="bg-gray-900/70 backdrop-blur-sm rounded-full p-3 shadow-lg border border-yellow-500/50">
              <div class="text-4xl">{playerChoiceEmoji}</div>
            </div>
          </div>
        {/if}
        
        <div class="absolute top-2 left-2 px-2 py-1 bg-black/50 rounded text-xs">
          You
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Settings Modal -->
{#if showSettingsModal}
  <div class="fixed inset-0 flex items-center justify-center z-50">
    <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" on:click={closeSettings}></div>
    <div class="relative z-10 bg-gray-900 rounded-lg border border-gray-800 shadow-lg w-full max-w-md overflow-hidden">
      <div class="flex items-center justify-between p-4 border-b border-gray-800">
        <h3 class="text-lg font-medium flex items-center">
          <Settings size={18} class="mr-2" />
          {activeSettingsTab === 'video' ? 'Camera Settings' : 
           activeSettingsTab === 'audio' ? 'Microphone Settings' : 'Volume Settings'}
        </h3>
        <button 
          class="p-1 rounded hover:bg-gray-800 transition-colors text-gray-400 hover:text-white"
          on:click={closeSettings}
        >
          <X size={20} />
        </button>
      </div>
      
      <div class="p-4">
        <!-- Tab Navigation -->
        <div class="flex mb-4 border-b border-gray-800">
          <button 
            class="px-4 py-2 border-b-2 {activeSettingsTab === 'video' ? 'border-yellow-500 text-yellow-500' : 'border-transparent text-gray-400'}"
            on:click={() => activeSettingsTab = 'video'}
          >
            Camera
          </button>
          <button 
            class="px-4 py-2 border-b-2 {activeSettingsTab === 'audio' ? 'border-yellow-500 text-yellow-500' : 'border-transparent text-gray-400'}"
            on:click={() => activeSettingsTab = 'audio'}
          >
            Microphone
          </button>
          <button 
            class="px-4 py-2 border-b-2 {activeSettingsTab === 'volume' ? 'border-yellow-500 text-yellow-500' : 'border-transparent text-gray-400'}"
            on:click={() => activeSettingsTab = 'volume'}
          >
            Volume
          </button>
        </div>
        
        {#if activeSettingsTab === 'video'}
          <div class="mb-4">
            <label class="block text-sm font-medium mb-2">Select Camera</label>
            <select 
              class="w-full p-2 bg-gray-800 rounded border border-gray-700 mb-4" 
              value={selectedVideoDeviceId}
              on:change={(e) => switchMediaSource('video', e.currentTarget.value)}
            >
              {#each videoDevices as device}
                <option value={device.deviceId}>
                  {device.label || `Camera ${videoDevices.indexOf(device) + 1}`}
                </option>
              {/each}
            </select>
            
            <!-- Video preview -->
            <div class="aspect-video bg-gray-950 rounded overflow-hidden">
              <video 
                autoplay 
                muted 
                playsinline
                class="w-full h-full object-cover"
                id="settings-preview-video"
              ></video>
            </div>
          </div>
        {:else if activeSettingsTab === 'audio'}
          <div class="mb-4">
            <label class="block text-sm font-medium mb-2">Select Microphone</label>
            <select 
              class="w-full p-2 bg-gray-800 rounded border border-gray-700" 
              value={selectedAudioDeviceId}
              on:change={(e) => switchMediaSource('audio', e.currentTarget.value)}
            >
              {#each audioDevices as device}
                <option value={device.deviceId}>
                  {device.label || `Mic ${audioDevices.indexOf(device) + 1}`}
                </option>
              {/each}
            </select>
          </div>
        {:else}
          <div class="mb-4">
            <label class="block text-sm font-medium mb-2">
              Remote Volume: {Math.round(remoteVolume * 100)}%
            </label>
            <input 
              type="range" 
              min="0" 
              max="1" 
              step="0.01" 
              value={remoteVolume}
              on:input={(e) => updateRemoteVolume(parseFloat(e.currentTarget.value))}
              class="w-full h-2 accent-yellow-500"
            />
          </div>
        {/if}
      </div>
      
      <div class="p-4 bg-gray-950 border-t border-gray-800 flex justify-end">
        <button 
          class="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-black font-medium rounded transition-colors"
          on:click={closeSettings}
        >
          Done
        </button>
      </div>
    </div>
  </div>
{/if} 
