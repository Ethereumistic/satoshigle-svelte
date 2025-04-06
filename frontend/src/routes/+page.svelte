<script lang="ts">
  import type { PageData } from './$types';
  
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import Button from '$lib/components/ui/button/button.svelte';
  import Navbar from '$lib/components/Navbar/Navbar.svelte';
  import GameSidebar from '$lib/components/Games/GameSidebar.svelte';
  import SettingsModal from '$lib/components/Settings/SettingsModal.svelte';
  import VideoChat from '$lib/components/VideoChat/VideoChat.svelte';
  import ChatControls from '$lib/components/VideoChat/ChatControls.svelte';
  import RPSGame from '$lib/components/Games/RPSGame.svelte';
  import { WebRTCService, type ConnectionState } from '$lib/services/webrtc';
  import { gameService, type GameType, activeGameInvite, gameConnectionStatus } from '$lib/services/gameService';
  import { userStore } from '$lib/stores/userStore';

  export let data: PageData;
  
  // UI state
  let currentLayout: 'default' | 'side-by-side' = 'default';
  let showSettingsModal = false;
  let showVideoSettingsModal = false;
  
  // WebRTC state
  let webrtcService: WebRTCService | undefined;
  let localStream: MediaStream | null = null;
  let remoteStream: MediaStream | null = null;
  let connectionStatus: ConnectionState = 'idle';
  let iceState: RTCIceConnectionState | 'N/A' = 'N/A';
  let signalingState: RTCSignalingState | 'N/A' = 'N/A';
  let isMuted = false;
  let isVideoOff = false;
  
  // Game state
  let isGameConnected = false;

  // Derived state
  $: isSearching = connectionStatus === 'searching' || connectionStatus === 'waiting';
  $: isConnected = connectionStatus === 'connected' && iceState === 'connected';

  // Game related state and functions
  let selectedGame: GameType | null = null;

  // Subscribe to game connection status
  $: isGameConnected = $gameConnectionStatus;

  function selectGame(game: GameType) {
    if (!isConnected) {
      console.error('Cannot start game: not connected to peer');
      return;
    }
    
    // Check if game service is ready
    if (!isGameConnected) {
      console.error('Game service not connected. Try refreshing the page.');
      alert('Game connection issue. Please try refreshing the page.');
      return;
    }
    
    startGameInternal(game);
  }
  
  function startGameInternal(game: GameType) {
    console.log(`Starting game: ${game}`);
    
    if (game === 'rock-paper-scissors') {
      activeGameInvite.set({
        game: 'rock-paper-scissors',
        settings: { rounds: 3 }
      });
    } else {
      console.log(`Game type ${game} not yet implemented`);
    }
  }

  // Initialize WebRTC service
  onMount(async () => {
    // Skip WebRTC initialization on server
    if (!browser) return;
    
    // Create a new instance instead of trying to assign to the import
    webrtcService = new WebRTCService();
    
    // Set up event listeners
    webrtcService.on('statusChange', (status: ConnectionState) => {
      connectionStatus = status;
    });
    
    webrtcService.on('iceStateChange', (state: RTCIceConnectionState) => {
      iceState = state;
    });
    
    webrtcService.on('signalingStateChange', (state: RTCSignalingState) => {
      signalingState = state;
    });
    
    webrtcService.on('localStream', (stream: MediaStream) => {
      localStream = stream;
    });
    
    webrtcService.on('remoteStream', (stream: MediaStream) => {
      remoteStream = stream;
    });
    
    webrtcService.on('error', (message: string) => {
      console.error('WebRTC error:', message);
    });
    
    // Initialize the service
    try {
      await webrtcService.initialize();
    } catch (err) {
      console.error('Failed to initialize WebRTC service:', err);
    }
  });
  
  onDestroy(() => {
    if (browser && webrtcService) {
      webrtcService.cleanup();
    }
  });
  
  // Event handlers
  function handleLayoutChange(event: CustomEvent) {
    const newLayout = event.detail.layout;
    if (newLayout && (newLayout === 'default' || newLayout === 'side-by-side')) {
      currentLayout = newLayout;
    }
  }
  
  async function handleLogin() {
    try {
      await userStore.login();
      console.log('Login successful');
    } catch (error) {
      console.error('Login failed:', error);
    }
  }
  
  function handleLogout() {
    userStore.logout();
    console.log('Logged out');
  }
  
  function startSearch() {
    webrtcService?.startSearch();
  }
  
  function skipPeer() {
    webrtcService?.skipPeer();
  }
  
  function stopSearch() {
    webrtcService?.stopSearch();
  }
  
  function openSettingsModal() {
    showSettingsModal = true;
  }
  
  function openVideoSettingsModal() {
    showVideoSettingsModal = true;
  }
  
  // Handler for track changes from VideoChat component
  function handleTrackChange(type: 'video' | 'audio', track: MediaStreamTrack) {
    if (!browser || !webrtcService) return;
    
    // Get the current connection
    const pc = webrtcService.getPeerConnection();
    if (!pc) {
      console.error('No peer connection available');
      return;
    }
    
    // Get all senders
    const senders = pc.getSenders();
    
    // Find the sender for the track of this type
    const sender = senders.find(s => s.track?.kind === track.kind);
    
    if (sender) {
      // Replace the track
      console.log(`Replacing ${type} track in peer connection`);
      sender.replaceTrack(track)
        .then(() => console.log(`${type} track replaced successfully`))
        .catch(err => console.error(`Error replacing ${type} track:`, err));
    } else {
      // Add the track as a new sender
      console.log(`Adding new ${type} track to peer connection`);
      pc.addTrack(track, localStream!);
    }
  }
  
  // Toggle mute/video functions
  function toggleMute() {
    if (browser && webrtcService) {
      isMuted = !isMuted;
      webrtcService.toggleMute();
    }
  }
  
  function toggleVideo() {
    if (browser && webrtcService) {
      isVideoOff = !isVideoOff;
      webrtcService.toggleVideo();
    }
  }
  
  function toggleLayout() {
    currentLayout = currentLayout === 'default' ? 'side-by-side' : 'default';
  }
  
  function sendTip() {
    // Implement send tip functionality
    alert('Tipping functionality will be implemented soon!');
  }
</script>

<main class="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black text-white flex flex-col">
  <!-- Navbar with proper property name -->
  <Navbar 
    currentLayout={currentLayout} 
    on:changeLayout={handleLayoutChange} 
  />
  
  <!-- Game Sidebar with proper property name -->
  <GameSidebar 
    currentLayout={currentLayout}
    peerConnected={connectionStatus === 'connected' && iceState === 'connected'}
    dataChannelConnected={isGameConnected}
    onSelectGame={(detail) => selectGame(detail.game)}
    onOpenVideoSettings={openVideoSettingsModal}
    on:openSettings={openSettingsModal}
    on:login={handleLogin}
    on:logout={handleLogout}
  />
  
  <!-- Settings Modal -->
  <SettingsModal bind:open={showSettingsModal} />
  
  <!-- Rock Paper Scissors Game -->
  <RPSGame />
  
  <div class="flex-1 flex flex-col items-center justify-center p-4 md:p-6">
    <!-- Video Chat -->
    <VideoChat
      localStream={localStream}
      remoteStream={remoteStream}
      connectionStatus={connectionStatus}
      iceState={iceState}
      layout={currentLayout}
      onTrackChange={handleTrackChange}
      showSettingsModal={showVideoSettingsModal}
      onSettingsModalClose={() => showVideoSettingsModal = false}
    />
    
    <!-- Chat Controls -->
    <ChatControls
      connectionStatus={connectionStatus}
      iceState={iceState}
      isSearching={isSearching}
      {isMuted}
      {isVideoOff}
      onStartSearch={startSearch}
      onSkipPeer={skipPeer}
      onStopSearch={stopSearch}
      onToggleMute={toggleMute}
      onToggleVideo={toggleVideo}
      onToggleLayout={toggleLayout}
      onSendTip={sendTip}
    />
  </div>
</main>