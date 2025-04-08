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
  import { gameService, type GameType, activeGameInvite, gameConnectionStatus, rpsGameState, receivedGameInvite, activeGame } from '$lib/services/gameService';
  import { userStore } from '$lib/stores/userStore';
  import RightSidebar from '$lib/components/Sidebar/RightSidebar.svelte';
  import chatService from '$lib/services/chatService';
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
  let playAgainInviteReceived = false;
  let previousGameRounds = 0;
  let isGameResult = false;

  // Derived state
  $: isSearching = connectionStatus === 'searching' || connectionStatus === 'waiting';
  $: isConnected = connectionStatus === 'connected' && iceState === 'connected';
  $: isGameActive = ['countdown', 'choosing', 'roundResult'].includes($rpsGameState.status);

  // Explicitly compute isGameResult to ensure it's always up-to-date
  $: {
    // Always set isGameResult to true when game status is gameResult regardless of win/lose state
    isGameResult = $rpsGameState.status === 'gameResult';
    
    // Log a clear message when we enter or exit game result state
    if (isGameResult) {
      console.log('%c GAME RESULT STATE ACTIVE ', 'background: #9c27b0; color: white; padding: 4px;', {
        status: $rpsGameState.status,
        gameResult: $rpsGameState.gameResult,
        isGameResult
      });
    }
  }
  
  // Game emoji display state
  $: playerChoiceEmoji = getChoiceEmoji($rpsGameState.playerChoice);
  $: opponentChoiceEmoji = getChoiceEmoji($rpsGameState.opponentChoice);
  $: showPlayerChoice = isGameActive && 
                       ($rpsGameState.status === 'choosing' || 
                        $rpsGameState.status === 'roundResult' || 
                        $rpsGameState.status === 'gameResult') && 
                        $rpsGameState.playerChoice !== null;
  $: showOpponentChoice = isGameActive && 
                         ($rpsGameState.status === 'roundResult' || 
                          $rpsGameState.status === 'gameResult') && 
                          $rpsGameState.opponentChoice !== null;

  // Track activeGameInvite changes
  $: {
    if ($activeGameInvite) {
      console.log('+page.svelte: activeGameInvite updated:', $activeGameInvite, 'Game status:', $rpsGameState.status);
    }
  }

  // Helper to get emoji for a choice
  function getChoiceEmoji(choice: 'rock' | 'paper' | 'scissors' | null): string {
    if (choice === 'rock') return '✊';
    if (choice === 'paper') return '✋';
    if (choice === 'scissors') return '✌️';
    return '';
  }

  // Game related state and functions
  let selectedGame: GameType | null = null;

  // Subscribe to game connection status
  $: isGameConnected = $gameConnectionStatus;

  // Track play again invites
  $: {
    if ($receivedGameInvite && 
        $receivedGameInvite.game === 'rock-paper-scissors' && 
        $rpsGameState.status === 'gameResult') {
      console.log('Received play again invitation with rounds:', $receivedGameInvite.settings.rounds);
      playAgainInviteReceived = true;
      previousGameRounds = $receivedGameInvite.settings.rounds;
    } else {
      playAgainInviteReceived = false;
    }
  }

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

      // Initialize chat service with the WebRTC service
      chatService.init(webrtcService);
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
  
  // Game control functions
  function handleCancelGame() {
    console.log('Canceling game from main component');
    const currentActiveGame = $activeGame;
    if (currentActiveGame) {
      gameService.cancelGame(currentActiveGame);
    } else {
      // Fallback to local reset only
      gameService.resetRPSGame();
      activeGameInvite.set(null);
    }
  }
  
  function handlePlayAgain() {
    console.log('Play again from main component, current status:', $rpsGameState.status, 'result:', $rpsGameState.gameResult);
    
    // Always handle Play Again regardless of win/lose state
    if ($rpsGameState.status === 'gameResult') {
      // First make sure there's no existing invite
      activeGameInvite.set(null);
      
      // Make sure game state is reset
      gameService.resetRPSGame();
      
      // Small delay to ensure state is cleared first
      setTimeout(() => {
        console.log('Setting activeGameInvite for Play Again with rounds:', $rpsGameState.totalRounds);
        // Set new invite to trigger UI
        activeGameInvite.set({
          game: 'rock-paper-scissors',
          settings: { rounds: $rpsGameState.totalRounds }
        });
        
        // Check what happened after setting
        setTimeout(() => {
          console.log('Current activeGameInvite state:', $activeGameInvite);
          console.log('Current gameState status:', $rpsGameState.status);
        }, 50);
      }, 50);
    }
  }
  
  function handleRespondToInvite(accepted: boolean) {
    console.log('Responding to invitation from main component:', accepted);
    if ($receivedGameInvite) {
      // When accepting a Play Again invitation, reset game state first
      if (accepted && $rpsGameState.status === 'gameResult') {
        gameService.resetRPSGame();
      } else if (!accepted && $rpsGameState.status === 'gameResult') {
        // Set activeGame to null to trigger the cleanup in the RPSGame component
        activeGame.set(null);
        // Also reset our game state
        gameService.resetRPSGame();
      }
      
      // Send response to server
      gameService.respondToGameInvite('rock-paper-scissors', accepted);
      
      // Reset play again state
      playAgainInviteReceived = false;
    }
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
  
  <!-- Rock Paper Scissors Game - Now with game UI only, no modals -->
  <RPSGame />
  
  <div class="flex-1 flex flex-col items-center justify-center p-4 md:p-6">
    <!-- Video Chat with game emoji overlays and game invites -->
    <VideoChat
      localStream={localStream}
      remoteStream={remoteStream}
      connectionStatus={connectionStatus}
      iceState={iceState}
      layout={currentLayout}
      onTrackChange={handleTrackChange}
      showSettingsModal={showVideoSettingsModal}
      onSettingsModalClose={() => showVideoSettingsModal = false}
      playerChoiceEmoji={playerChoiceEmoji}
      opponentChoiceEmoji={opponentChoiceEmoji}
      showPlayerChoice={showPlayerChoice}
      showOpponentChoice={showOpponentChoice}
    />
    
    <!-- Chat Controls with game invite UI -->
    <ChatControls
      connectionStatus={connectionStatus}
      iceState={iceState}
      isSearching={isSearching}
      {isMuted}
      {isVideoOff}
      isGameActive={isGameActive}
      isGameResult={isGameResult}
      playAgainInviteReceived={playAgainInviteReceived}
      previousGameRounds={previousGameRounds}
      onStartSearch={startSearch}
      onSkipPeer={skipPeer}
      onStopSearch={stopSearch}
      onToggleMute={toggleMute}
      onToggleVideo={toggleVideo}
      onToggleLayout={toggleLayout}
      onSendTip={sendTip}
      onCancelGame={handleCancelGame}
      onPlayAgain={handlePlayAgain}
      onRespondToInvite={handleRespondToInvite}
    />
  </div>

  <RightSidebar 
    webrtcService={webrtcService}
  />
</main>