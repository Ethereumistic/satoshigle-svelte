<script lang="ts">
  import { onMount } from 'svelte';
  import io from 'socket.io-client';
  import Button from '$lib/components/ui/button/button.svelte';
  import Navbar from '$lib/components/Navbar/Navbar.svelte';
	import { Zap } from 'lucide-svelte';
  
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
  
  // Layout state
  let currentLayout: 'default' | 'side-by-side' = 'default';
  let previousLayout: 'default' | 'side-by-side' = 'default';
  
  // Video references for layout switching
  let defaultLocalVideo: HTMLVideoElement;
  let defaultRemoteVideo: HTMLVideoElement;
  let sideLocalVideo: HTMLVideoElement;
  let sideRemoteVideo: HTMLVideoElement;
  
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
        transports: ['websocket'],
        reconnectionAttempts: 3,
        reconnectionDelay: 1000,
        timeout: 5000
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
              transports: ['websocket'],
              reconnectionAttempts: 5,
              reconnectionDelay: 1000,
              timeout: 10000
            });
            
            // Set up events again for the new connection
            setupSocketEvents();
          }, 1000);
        }
      });
      
      // Function to set up all socket event handlers
      function setupSocketEvents() {
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
          .on('match-ready', ({ roomId: matchId, isInitiator: initiator }) => {
            console.log(`🚀 Match ready: ${matchId}, initiator: ${initiator}`);
            
            // Reset any existing connection before starting a new one
            resetConnection();
            
            roomId = matchId;
            isInitiator = initiator ?? false;
            status = 'connected'; // Will be updated once ICE connection is established
            
            // Acknowledge the match to the server
            socket.emit('match-ready', { matchId });
            
            // Initialize WebRTC connection
            initializePeerConnection();
          })
          .on('peer-disconnected', () => {
            console.log('⚠️ Peer disconnected');
            status = 'peer-left';
            resetConnection();
          })
          .on('peer-skipped', () => {
            console.log('⚠️ Peer skipped connection');
            resetConnection();
            status = 'searching';
            isSearching = true;
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
          });
      }
      
      // Set up initial event handlers
      setupSocketEvents();
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
</script>

<main class="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black text-white flex flex-col">
  <!-- Navbar with two-way binding for currentLayout -->
  <Navbar 
    bind:currentLayout={currentLayout} 
    on:changeLayout={handleLayoutChange} 
  />
  
  <div class="flex-1 flex flex-col items-center justify-center p-4 md:p-6">
    <!-- Layout indicator -->
    <!-- <div class="text-xs bg-gray-800 text-yellow-400 rounded-full px-3 py-1 mb-4">
      Layout: {currentLayout}
    </div> -->
    
    <!-- Video Container -->
    {#if currentLayout === 'default'}
      <!-- Default Layout: Large remote video with small local video in corner -->
      <div class="w-full max-w-[83%] -mt-6">
        <div class="relative w-full aspect-video rounded-bl-xl rounded-br-xl overflow-hidden backdrop-blur-sm bg-black/30 border border-gray-800/50 shadow-[0_0_15px_rgba(0,0,0,0.5)] transition-all duration-300 ease-in-out">
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
      <div class="w-full max-w-[94%] -mt-6">
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
          <div class="relative aspect-square rounded-bl-xl rounded-br-xl overflow-hidden backdrop-blur-sm bg-black/30 border border-gray-800/50 shadow-[0_0_15px_rgba(0,0,0,0.5)]">
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
    
    <!-- Status Indicator -->
    <div class="mt-4 text-center">
      <div class="inline-flex items-center gap-2 px-4 py-2 rounded-full backdrop-blur-md bg-gray-800/60">
        {#if status === 'connected' && iceState === 'connected'}
          <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          <span>Connected</span>
        {:else if status === 'idle'}
          <span>Ready to chat</span>
        {:else if status === 'searching'}
          <span>Searching...</span>
        {:else if status === 'waiting'}
          <span>Waiting...</span>
        {:else if status === 'peer-left'}
          <span>Peer disconnected</span>
        {:else if status === 'error'}
          <span>Connection error</span>
        {/if}
      </div>
    </div>
    
<!-- Controls -->
<div class="flex absolute bottom-4 gap-4 mt-6">
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


    
    <!-- Debug Info -->
    <div class="mt-6 text-xs text-gray-500 text-center">
      <details>
        <summary class="cursor-pointer hover:text-gray-400">Connection Details</summary>
        <div class="mt-2 p-2 rounded bg-gray-800/50 inline-block">
          ICE State: {iceState} | Signaling State: {signalingState}
        </div>
      </details>
    </div>
  </div>
  
  <!-- Footer -->
  <div class="w-full py-4 text-center text-gray-500 text-sm mt-auto">
    <p>Powered by Bitcoin Lightning Network</p>
  </div>
</main>