<script lang="ts">
  import { onMount } from 'svelte';
  import io from 'socket.io-client';
  import Button from '$lib/components/ui/button/button.svelte';
  import Navbar from '$lib/components/Navbar/Navbar.svelte';
  import GameSidebar from '$lib/components/Games/GameSidebar.svelte';
  import GameOverlay from '$lib/components/Games/GameOverlay.svelte';
  import SettingsModal from '$lib/components/Settings/SettingsModal.svelte';
  import { gameStore } from '$lib/stores/gameStore';
  import { userStore } from '$lib/stores/userStore';
  import { Zap } from 'lucide-svelte';
  
  // Video chat state
  let localVideo: HTMLVideoElement;
  let remoteVideo: HTMLVideoElement;
  let pc: RTCPeerConnection | null = null;
  let socket: ReturnType<typeof io>;
  let status: 'idle' | 'searching' | 'waiting' | 'connected' | 'peer-left' | 'error' = 'idle';
  let roomId: string | null = null;
  let localStream: MediaStream | null = null;
  let isSearching = false;
  let isInitiator = false;
  let iceState = 'N/A';
  let signalingState = 'N/A';
  let partnerId: string | null = null;
  
  // Layout state
  let currentLayout: 'default' | 'side-by-side' = 'default';
  let previousLayout: 'default' | 'side-by-side' = 'default';
  
  // Video references for layout switching
  let defaultLocalVideo: HTMLVideoElement;
  let defaultRemoteVideo: HTMLVideoElement;
  let sideLocalVideo: HTMLVideoElement;
  let sideRemoteVideo: HTMLVideoElement;
  
  // Settings modal state
  let showSettingsModal = false;
  
  // Handle layout change from navbar
  function handleLayoutChange(event: CustomEvent) {
    const newLayout = event.detail.layout;
    console.log('Layout change event received:', newLayout);
    
    if (newLayout && (newLayout === 'default' || newLayout === 'side-by-side')) {
      previousLayout = currentLayout;
      currentLayout = newLayout;
      console.log('Layout has been updated to:', currentLayout);
      
      // Schedule reattachment of video streams after update with a slight delay to ensure DOM has updated
      setTimeout(() => {
        console.log('Reattaching video streams after layout change');
        reattachVideoStreams();
        
        // Also update references to ensure they're correct
        updateVideoReferences();
        
        // Secondary reattachment after a brief delay to catch any missed frames
        setTimeout(reattachVideoStreams, 500);
      }, 50);
    } else {
      console.error('Invalid layout value received:', newLayout);
    }
  }
  
  // Reattach video streams when layout changes to preserve video
  function reattachVideoStreams() {
    // Update main video references based on current layout
    if (currentLayout === 'default') {
      localVideo = defaultLocalVideo;
      remoteVideo = defaultRemoteVideo;
    } else {
      localVideo = sideLocalVideo;
      remoteVideo = sideRemoteVideo;
    }
    
    // IMPORTANT: Immediately clone and transfer any existing streams to both layouts
    
    // Handle local video stream
    if (localStream) {
      // Ensure both local video elements have the stream attached
      if (defaultLocalVideo && !defaultLocalVideo.srcObject) {
        console.log('Attaching local stream to default layout');
        defaultLocalVideo.srcObject = localStream;
      }
      
      if (sideLocalVideo && !sideLocalVideo.srcObject) {
        console.log('Attaching local stream to side-by-side layout');
        sideLocalVideo.srcObject = localStream;
      }
    }
    
    // Handle remote video streams - check all possible sources
    const remoteStreamSources = [
      defaultRemoteVideo?.srcObject, 
      sideRemoteVideo?.srcObject,
      remoteVideo?.srcObject
    ].filter(Boolean) as MediaStream[];
    
    if (remoteStreamSources.length > 0) {
      // Use the first available remote stream
      const remoteStream = remoteStreamSources[0];
      
      console.log('Transferring remote stream to both layouts');
      
      // Apply to both video elements
      if (defaultRemoteVideo && defaultRemoteVideo.srcObject !== remoteStream) {
        defaultRemoteVideo.srcObject = remoteStream;
      }
      
      if (sideRemoteVideo && sideRemoteVideo.srcObject !== remoteStream) {
        sideRemoteVideo.srcObject = remoteStream;
      }
      
      // Update the main reference too
      if (remoteVideo && remoteVideo.srcObject !== remoteStream) {
        remoteVideo.srcObject = remoteStream;
      }
    } else if (pc && pc.getReceivers) {
      // Alternative method using RTCRtpReceiver when no stream is available
      const receivers = pc.getReceivers();
      const videoReceivers = receivers.filter(r => r.track && r.track.kind === 'video');
      
      if (videoReceivers.length > 0) {
        console.log('Recreating MediaStream from receivers');
        
        const newStream = new MediaStream();
        receivers.forEach(receiver => {
          if (receiver.track) {
            newStream.addTrack(receiver.track);
          }
        });
        
        // Apply to both layouts
        if (defaultRemoteVideo) defaultRemoteVideo.srcObject = newStream;
        if (sideRemoteVideo) sideRemoteVideo.srcObject = newStream;
        if (remoteVideo) remoteVideo.srcObject = newStream;
      }
    }
  }

  // Handle game selection from sidebar
  function handleGameSelection(event: CustomEvent<{game: string}>) {
    const game = event.detail.game;
    gameStore.startGame(game);
  }

  // Handle login from sidebar
  async function handleLogin() {
    try {
      await userStore.login();
      console.log('Login successful');
    } catch (error) {
      console.error('Login failed:', error);
    }
  }
  
  // Handle logout from sidebar
  function handleLogout() {
    userStore.logout();
    console.log('Logged out');
  }

  const startSearch = async () => {
    if (isSearching) return;
    resetConnection(); // Ensure clean state before starting
    isSearching = true;
    status = 'searching';
    console.log('🔍 Starting search...');
    socket.emit('start-search');
  };

  const handleSkip = () => {
    console.log('⏩ User initiated skip');
    socket.emit('skip');
    status = 'searching';
    resetConnection();
  };

  const handleStopSearch = () => {
    console.log('⛔ User stopped search');
    socket.emit('stop-search');
    status = 'idle';
    resetConnection();
    isSearching = false;
  };

  // Update video references based on layout
  function updateVideoReferences() {
    if (currentLayout === 'default') {
      localVideo = defaultLocalVideo;
      remoteVideo = defaultRemoteVideo;
    } else {
      localVideo = sideLocalVideo;
      remoteVideo = sideRemoteVideo;
    }
  }

  const resetConnection = () => {
    if (pc) {
      console.log('🛑 Closing peer connection');
      try {
        // Remove all event listeners to prevent any callbacks after reset
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.oniceconnectionstatechange = null;
        pc.onsignalingstatechange = null;
        pc.close();
      } catch (err) {
        console.error('Error closing peer connection:', err);
      }
      pc = null;
    }
    
    // Clear all video streams
    [defaultRemoteVideo, sideRemoteVideo].forEach(videoEl => {
      if (videoEl?.srcObject) {
        try {
          (videoEl.srcObject as MediaStream).getTracks().forEach(track => track.stop());
          videoEl.srcObject = null;
        } catch (err) {
          console.error('Error stopping remote tracks:', err);
        }
      }
    });
    
    // Clear match data
    iceState = 'N/A';
    signalingState = 'N/A';
    roomId = null;
    isInitiator = false;
    partnerId = null;
    
    // Clean up any lingering listeners for signals
    socket?.off('signal');
  };

  const handleIceConnectionStateChange = () => {
    if (!pc) return;
    
    iceState = pc.iceConnectionState || 'N/A';
    console.log('❄️ ICE State:', iceState);
    
    // Update UI status when connection is actually established
    if (iceState === 'connected' || iceState === 'completed') {
      status = 'connected';
      
      // Ensure video streams are attached to both layout videos
      if (localStream) {
        if (defaultLocalVideo && !defaultLocalVideo.srcObject) {
          defaultLocalVideo.srcObject = localStream;
        }
        if (sideLocalVideo && !sideLocalVideo.srcObject) {
          sideLocalVideo.srcObject = localStream;
        }
      }
      
      // Ensure remote video is propagated to both layouts
      if (remoteVideo && remoteVideo.srcObject) {
        const remoteStream = remoteVideo.srcObject as MediaStream;
        if (defaultRemoteVideo && !defaultRemoteVideo.srcObject) {
          defaultRemoteVideo.srcObject = remoteStream;
        }
        if (sideRemoteVideo && !sideRemoteVideo.srcObject) {
          sideRemoteVideo.srcObject = remoteStream;
        }
      }
    } else if (iceState === 'failed') {
      status = 'error';
    } else if (iceState === 'disconnected') {
      // Wait for potential self-recovery before declaring error
      setTimeout(() => {
        if (pc && pc.iceConnectionState === 'disconnected') {
          status = 'error';
        }
      }, 5000);
    } else if (iceState === 'closed') {
      status = 'error';
    }
  };

  function setupSocketEvents() {
    console.log('Setting up socket events with socket ID:', socket?.id, 'Connected:', socket?.connected);
    
    if (!socket) {
      console.error('Socket not initialized when setting up events');
      return;
    }
    
    socket
      .on('connect', () => {
        console.log('🔗 Socket connected');
        // When reconnecting, restart search if we were searching before
        if (isSearching && status === 'searching') {
          setTimeout(() => socket.emit('start-search'), 500);
        }
      })
      .on('connect_error', (err) => {
        console.error('Socket connection error:', err);
        status = 'error';
      })
      .on('disconnect', () => {
        console.log('🔌 Socket disconnected');
        // If we were connected to a peer, show error
        if (status === 'connected') {
          status = 'error';
        }
      })
      .on('waiting-for-peer', () => {
        console.log('⏳ Waiting for peer...');
        status = 'waiting';
        isSearching = true;
      })
      .on('match-ready', ({ roomId: matchId, isInitiator: initiator, peerId }) => {
        console.log(`🚀 Match ready: ${matchId}, initiator: ${initiator}, peerId: ${peerId}`);
        
        // Reset any existing connection before starting a new one
        resetConnection();
        
        roomId = matchId;
        isInitiator = initiator ?? false;
        status = 'connected'; // Will be updated once ICE connection is established
        
        // Store the partner's ID
        partnerId = peerId;
        
        // Acknowledge the match to the server
        socket.emit('match-ready', { matchId });
        
        // Initialize WebRTC connection
        initializePeerConnection();
      })
      .on('peer-disconnected', () => {
        console.log('⚠️ Peer disconnected');
        status = 'peer-left';
        resetConnection();
        
        // If a game was in progress, end it
        if ($gameStore.isPlaying) {
          gameStore.endGame();
        }
      })
      .on('peer-skipped', () => {
        console.log('⚠️ Peer skipped connection');
        resetConnection();
        status = 'searching';
        isSearching = true;
        
        // If a game was in progress, end it
        if ($gameStore.isPlaying) {
          gameStore.endGame();
        }
      })
      .on('connection-error', (data) => {
        console.error('🚨 Connection error:', data.message);
        resetConnection();
        status = 'error';
        isSearching = false;
        
        // Provide user feedback
        setTimeout(() => {
          if (confirm('Connection error detected. Would you like to try again?')) {
            startSearch();
          }
        }, 1000);
      })
      // Game-related socket events
      .on('game-invite', (data) => {
        console.log('📨 Game invitation received:', data);
        
        // Check if we have all the necessary data
        if (!data.game || !data.from) {
          console.error('Invalid game invitation data:', data);
          return;
        }
        
        // Start the game
        gameStore.startGame(data.game || 'tic-tac-toe');
        
        // DON'T send invitation - instead handle as a receiver
        // This is crucial - we don't want to create a waiting state for the invitation receiver
        
        // Instead, just show the invitation modal via the GameOverlay component
        // The invitation details will be handled by the socket listener in GameOverlay
      })
      .on('game-invite-response', (data) => {
        console.log('📩 Game invitation response:', data);
        
        if (!data.game) {
          console.error('Invalid game invitation response data:', data);
          return;
        }
        
        if (data.accepted) {
          console.log('Game invitation accepted!');
          gameStore.startGame(data.game || 'tic-tac-toe');
        } else {
          console.log('Game invitation rejected.');
          gameStore.endGame();
          // Maybe show a notification that the invitation was declined
        }
      })
      .on('game-move', (data) => {
        console.log('🎮 Game move received:', data);
        
        if (data.game === 'tic-tac-toe') {
          // Support both old and new formats
          const moveIndex = data.moveData?.index ?? data.move;
          
          if (typeof moveIndex === 'number') {
            // Update the game state with the opponent's move
            gameStore.receiveMove(moveIndex);
          } else {
            console.error('Invalid move data received:', data);
          }
        }
      })
      .on('game-reset', (data) => {
        console.log('🔄 Game reset received:', data);
        if (data.game === 'tic-tac-toe') {
          gameStore.resetTicTacToe();
        }
      })
      // Add new event listener for game invitation sent confirmation
      .on('game-invite-sent', (data) => {
        console.log('📩 Game invitation send status:', data);
        if (!data.success) {
          // Show error message or reset the game if invitation failed
          gameStore.endGame();
          alert('Failed to send game invitation. Please try again.');
        }
      })
      // Add listener for timeout notification
      // .on('game-timeout', (data) => {
      //   console.log('⏱️ Game timeout notification received:', data);
      //   if (data.game === 'tic-tac-toe') {
      //     // Handle the timeout notification (e.g., show a temporary toast)
      //     gameStore.handleTimeout();
      //   }
      // })
      // Add listener for game cancellation
      .on('game-cancel', (data) => {
        console.log('🚫 Game cancellation received:', data);
        if (data.game === 'tic-tac-toe') {
          // Handle the game cancellation
          // This will be handled by the GameOverlay component
        }
      })
      // Add handlers for the new direct game request flow
      .on('tic-tac-toe-request', (data) => {
        console.log('🎮 Received Tic Tac Toe game request in +page.svelte:', data, 'Socket ID:', socket?.id, 'Connected:', socket?.connected);
        // The GameOverlay component should handle this event, but let's log that we received it here too
      })
      .on('game-started', (data) => {
        console.log('🎮 Game started:', data);
        if (data.game === 'tic-tac-toe') {
          // Start the game with the received symbol
          gameStore.startGame('tic-tac-toe');
          gameStore.updatePlayerSymbol(data.playerSymbol);
        }
      })
      .on('tic-tac-toe-declined', (data) => {
        console.log('🎮 Tic Tac Toe request declined:', data);
        // End the game state since the request was declined
        gameStore.endGame();
      });
  }

  onMount(() => {
    const init = async () => {
      try {
        // Initialize local media immediately
        localStream = await navigator.mediaDevices.getUserMedia({ 
          video: { width: 1280, height: 720 },
          audio: true 
        });
        
        // Initialize video references based on the current layout
        if (currentLayout === 'default') {
          localVideo = defaultLocalVideo;
          remoteVideo = defaultRemoteVideo;
        } else {
          localVideo = sideLocalVideo;
          remoteVideo = sideRemoteVideo;
        }
        
        // Set local video stream
        if (localVideo) {
          localVideo.srcObject = localStream;
          console.log('🎥 Local media initialized');
        } else {
          console.error('Local video element not available');
        }
      } catch (err) {
        console.error('Camera access error:', err);
        status = 'error';
        return;
      }
  
      // Use environment variables for server connection with fallback
      const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
      const serverIpUrl = import.meta.env.VITE_SERVER_IP_URL || 'http://192.168.192.1:3001';
      
      console.log('Attempting connections to:', serverUrl, serverIpUrl);
      
      // Try main connection first
      socket = io(serverUrl, {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 3,
        reconnectionDelay: 1000,
        path: '/socket.io/'
      });
      
      // If main connection fails, try IP connection after brief delay
      socket.on('connect_error', (err) => {
        console.error('Socket main connection error:', err);
        
        // Only try alternative if we haven't connected yet
        if (!socket.connected) {
          console.log('Trying alternative connection to:', serverIpUrl);
          
          // Disconnect from first attempt
          socket.disconnect();
          
          // Connect to alternative URL after a short delay
          setTimeout(() => {
            socket = io(serverIpUrl, {
              transports: ['websocket', 'polling'],
              reconnectionAttempts: 5,
              reconnectionDelay: 1000,
              path: '/socket.io/'
            });
            
            // Set up events again for the new connection
            setupSocketEvents();
          }, 1000);
        }
      });
      
      // Set up initial event handlers
      setupSocketEvents();
      
      // Verify socket connection state after 2 seconds
      setTimeout(() => {
        console.log('Socket connection verification - socket ID:', socket?.id, 'Connected:', socket?.connected);
        console.log('Partner ID (peerId):', partnerId);
        
        // Test socket handlers
        console.log('Socket handlers for tic-tac-toe-request:', socket?.listeners('tic-tac-toe-request')?.length || 0);
        
        // Add a direct listener for the tic-tac-toe-request event
        socket.on('tic-tac-toe-request', (data) => {
          console.log('DIRECT LISTENER - tic-tac-toe-request received in +page.svelte:', data);
          alert('Game request received!');
        });
        
        console.log('Direct listener added for tic-tac-toe-request');
      }, 2000);
    };

    // Start initialization
    init();

    // Return the cleanup function
    return () => {
      console.log('🧹 Cleaning up...');
      socket?.disconnect();
      resetConnection();
      if (localStream) {
        try {
          localStream.getTracks().forEach(track => track.stop());
        } catch (err) {
          console.error('Error stopping local tracks:', err);
        }
      }
    };
  });

  const initializePeerConnection = async () => {
    try {
      console.log('🔄 Initializing WebRTC...');
      pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { 
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
          }
        ],
        iceCandidatePoolSize: 10,
        iceTransportPolicy: 'all'
      });

      // Add local tracks
      localStream?.getTracks().forEach(track => {
        pc?.addTrack(track, localStream!);
        console.log(`➕ Added local ${track.kind} track`);
      });

      // Remote track handler
      pc.ontrack = (event) => {
        console.log("🎬 Remote track received", event.streams);
        if (event.streams && event.streams.length > 0) {
          const stream = event.streams[0];
          
          // Safeguard to ensure we have a valid MediaStream
          if (!(stream instanceof MediaStream)) {
            console.error('Invalid MediaStream received in ontrack');
            return;
          }
          
          // Store original track IDs for debugging
          const trackIds = stream.getTracks().map(t => t.id).join(',');
          console.log(`Stream tracks: ${trackIds}`);
          
          // Update all video elements immediately
          try {
            console.log('Applying remote stream to both layout videos');
            
            // Update both remote video elements regardless of current layout
            if (defaultRemoteVideo) {
              defaultRemoteVideo.srcObject = stream;
              console.log('Stream attached to default remote video');
            }
            
            if (sideRemoteVideo) {
              sideRemoteVideo.srcObject = stream;
              console.log('Stream attached to side-by-side remote video');
            }
            
            // Also update the main remote video reference
            if (remoteVideo) {
              remoteVideo.srcObject = stream;
            }
            
            // Double check after a short delay to make sure streams are attached
            setTimeout(() => {
              if (defaultRemoteVideo && !defaultRemoteVideo.srcObject) {
                defaultRemoteVideo.srcObject = stream;
              }
              if (sideRemoteVideo && !sideRemoteVideo.srcObject) {
                sideRemoteVideo.srcObject = stream;
              }
            }, 200);
          } catch (err) {
            console.error('Error setting remote stream:', err);
          }
        }
      };

      // ICE Candidate handling
      pc.onicecandidate = (event) => {
        if (event.candidate && roomId) {
          console.log('🧊 Sending ICE candidate');
          socket.emit('signal', {
            roomId,
            candidate: event.candidate
          });
        }
      };

      // State change handlers
      pc.oniceconnectionstatechange = handleIceConnectionStateChange;

      pc.onsignalingstatechange = () => {
        signalingState = pc?.signalingState || 'N/A';
        console.log('📶 Signaling State:', signalingState);
      };

      // Signal handler - clean up old ones first
      socket.off('signal');
      socket.on('signal', async (data) => {
        try {
          if (!pc) {
            console.log('⚠️ Received signal but no peer connection exists');
            return;
          }

          console.log(`📨 Received signal: ${data.description?.type || 'candidate'}`);
          
          if (data.description) {
            console.log('📝 Setting remote description');
            console.log('📝 Remote Description:', data.description.type);
            await pc.setRemoteDescription(new RTCSessionDescription(data.description));
            
            if (data.description.type === 'offer') {
              console.log('✍️ Creating answer');
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              socket.emit('signal', {
                roomId,
                description: answer
              });
            }
          }
          
          if (data.candidate) {
            console.log('➕ Adding ICE candidate');
            try {
              await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (err) {
              // Ignore ICE candidate errors if we're not ready yet
              if (pc.remoteDescription) {
                console.error('Error adding ICE candidate:', err);
              } else {
                console.log('Ignoring ICE candidate - no remote description yet');
              }
            }
          }
        } catch (err) {
          console.error('🚨 Signal error:', err);
        }
      });

      // Create offer if initiator
      if (isInitiator) {
        console.log('✍️ Creating offer');
        const offer = await pc.createOffer();
        console.log('✍️ Offer created');          
        await pc.setLocalDescription(offer);
        socket.emit('signal', {
          roomId,
          description: offer
        });
      }
    } catch (err) {
      console.error('🚨 WebRTC Error:', err);
      status = 'error';
      resetConnection();
    }
  };

  // Game handling
  function handleGameSelect(event: CustomEvent<{game: string}>) {
    console.log('Selected game:', event.detail.game);
    gameStore.startGame(event.detail.game);
  }
  
  // Settings modal handling
  function openSettingsModal() {
    showSettingsModal = true;
  }
</script>

<main class="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black text-white flex flex-col">
  <!-- Navbar with two-way binding for currentLayout -->
  <Navbar 
    bind:currentLayout={currentLayout} 
    on:changeLayout={handleLayoutChange} 
  />
  
  <!-- Game Sidebar -->
  <GameSidebar 
    currentLayout={currentLayout}
    on:selectGame={handleGameSelect}
    on:openSettings={openSettingsModal}
    on:login={handleLogin}
    on:logout={handleLogout}
    peerConnected={status === 'connected' && iceState === 'connected'}
  />
  
  <!-- Game Overlay (will only show when a game is active) -->
  <GameOverlay 
    peerId={partnerId || ''} 
    {socket}
  />
  
  <!-- Settings Modal -->
  <SettingsModal bind:open={showSettingsModal} />
  
  <div class="flex-1 flex flex-col items-center justify-center p-4 md:p-6">
    <!-- Video Container -->
    {#if currentLayout === 'default'}
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
            <div class="ml-2 text-orange-500"><Zap  /></div>
          </div>
          
          <!-- Status Overlay -->
          {#if status !== 'connected' || iceState !== 'connected'}
            <div class="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
              <div class="text-center p-6 max-w-md">
                {#if status === 'searching' || status === 'waiting'}
                  <div class="w-16 h-16 border-4 border-t-yellow-400 border-r-yellow-400/20 border-b-yellow-400/20 border-l-yellow-400/20 rounded-full animate-spin mx-auto mb-4"></div>
                  <h3 class="text-xl font-medium mb-2">
                    {status === 'searching' ? 'Searching for someone to chat with...' : 'Waiting for peer to connect...'}
                  </h3>
                {:else if status === 'peer-left'}
                  <div class="w-16 h-16 rounded-full bg-orange-500/20 flex items-center justify-center mx-auto mb-4">
                    <span class="text-3xl">⚠️</span>
                  </div>
                  <h3 class="text-xl font-medium mb-2">Peer Disconnected</h3>
                  <p class="text-gray-400 mb-4">Your chat partner has left the conversation</p>
                {:else if status === 'error'}
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
              class="w-full h-full object-cover bg-gray-900"
            ></video>
          </div>
        </div>
      </div>
    {:else}
      <!-- Side by Side Layout: Equal sized videos -->
      <div class="w-full max-w-[85%] -mt-4 ">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 transition-all duration-300 ease-in-out">
          <!-- Remote Video -->
          <div class="relative aspect-square rounded-bl-xl rounded-br-xl overflow-hidden backdrop-blur-sm bg-black/30 border border-gray-800/50 shadow-[0_0_15px_rgba(0,0,0,0.5)]">
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
              <div class="ml-2 text-orange-500"><Zap  /></div>
            </div>
            
            <!-- Status Overlay for Remote Video -->
            {#if status !== 'connected' || iceState !== 'connected'}
              <div class="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                <div class="text-center p-4 max-w-[90%]">
                  {#if status === 'searching' || status === 'waiting'}
                    <div class="w-12 h-12 border-4 border-t-yellow-400 border-r-yellow-400/20 border-b-yellow-400/20 border-l-yellow-400/20 rounded-full animate-spin mx-auto mb-3"></div>
                    <h3 class="text-lg font-medium">
                      {status === 'searching' ? 'Searching...' : 'Waiting...'}
                    </h3>
                  {:else if status === 'peer-left'}
                    <div class="w-12 h-12 rounded-full bg-orange-500/20 flex items-center justify-center mx-auto mb-3">
                      <span class="text-2xl">⚠️</span>
                    </div>
                    <h3 class="text-lg font-medium">Peer Disconnected</h3>
                  {:else if status === 'error'}
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
            
            <div class="absolute top-2 left-2 px-2 py-1 bg-black/50 rounded text-xs">
              You
            </div>
          </div>
        </div>
      </div>
    {/if}
    
    <!-- Controls -->
    <div class="flex translate-y-3 gap-6">
      {#if status === 'connected' && iceState === 'connected'}
        <button
          on:click={handleSkip}
          class="px-6 py-3 rounded-full font-medium bg-yellow-600 hover:bg-yellow-700 text-white transition-colors"
        >
          Skip Partner
        </button>

        <button
          on:click={handleStopSearch}
          class="px-6 py-3 rounded-full font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
        >
          End Chat
        </button>
      {:else}
        <button
          on:click={startSearch}
          class="px-6 py-3 rounded-full font-medium transition-all duration-200 disabled:opacity-50 
                 bg-gradient-to-r from-yellow-400 to-orange-500 hover:from-yellow-500 hover:to-orange-600 text-black shadow-lg hover:shadow-yellow-500/20"
          disabled={isSearching}
        >
          {#if isSearching}
            Searching...
          {:else if status === 'peer-left'}
            Find New Partner
          {:else}
            Start Chat
          {/if}
        </button>

        {#if status === 'searching' || status === 'waiting'}
          <button
            on:click={handleStopSearch}
            class="px-6 py-3 rounded-full font-medium bg-red-600 hover:bg-red-700 text-white transition-colors"
          >
            Stop
          </button>
        {/if}
      {/if}
    </div>
  </div>
</main>