<script lang="ts">
    import { onMount } from 'svelte';
    import io from 'socket.io-client';
  
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
      
      if (remoteVideo?.srcObject) {
        try {
          (remoteVideo.srcObject as MediaStream).getTracks().forEach(track => track.stop());
        } catch (err) {
          console.error('Error stopping remote tracks:', err);
        }
        remoteVideo.srcObject = null;
      }
      
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
          localVideo.srcObject = localStream;
          console.log('🎥 Local media initialized');
        } catch (err) {
          console.error('Camera access error:', err);
          status = 'error';
          return;
        }
    
        socket = io('http://localhost:3001', {
          transports: ['websocket'],
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
          timeout: 10000
        });
    
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
          if (remoteVideo && event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
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
  
  <main class="h-screen bg-gray-900 text-white flex flex-col items-center justify-center">
    <div class="grid grid-cols-2 gap-4 w-full h-4/5 p-4 relative">
      <!-- Remote Video -->
      <video 
        bind:this={remoteVideo} 
        autoplay 
        playsinline
        class="rounded-lg bg-black w-full h-full object-cover"
      />
      
      <!-- Local Video Preview -->
      <div class="absolute bottom-4 right-4 w-64 h-36 rounded-lg border-2 border-white overflow-hidden shadow-lg">
        <video 
          bind:this={localVideo} 
          autoplay 
          muted 
          playsinline
          class="w-full h-full object-cover"
        />
      </div>
    </div>
  
    <div class="flex flex-col items-center gap-4">
      <div class="text-xl font-bold">
        {#if status === 'idle'}
          🎥 Ready to chat?
        {:else if status === 'searching'}
          🔍 Searching for peer...
        {:else if status === 'waiting'}
          ⏳ Waiting for peer...
        {:else if status === 'connected' && iceState === 'connected'}
          ✅ Connected!
        {:else if status === 'connected'}
          🔄 Connecting...
        {:else if status === 'peer-left'}
          ❌ Peer disconnected
        {:else if status === 'error'}
          🚨 Connection error
        {/if}
      </div>
  
      <div class="flex gap-4">
        <button
          on:click={startSearch}
          class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
          disabled={isSearching || status === 'connected' && iceState === 'connected'}
        >
          {#if status === 'connected' && iceState === 'connected'}
            Connected
          {:else if isSearching}
            Searching...
          {:else if status === 'peer-left'}
            Find New Partner
          {:else}
            Start Chat
          {/if}
        </button>
  
        {#if status === 'connected' && iceState === 'connected'}
          <button
            on:click={handleSkip}
            class="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded-lg transition-colors"
          >
            Skip Partner
          </button>
        {/if}
        
        {#if status === 'peer-left'}
          <button
            on:click={startSearch}
            class="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition-colors"
          >
            Start Search
          </button>
        {/if}
        
        {#if status === 'searching' || status === 'waiting' || status === 'connected'}
          <button
            on:click={handleStopSearch}
            class="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition-colors"
          >
            {status === 'connected' ? 'End Chat' : 'Stop'}
          </button>
        {/if}
      </div>
  
      <div class="text-sm text-gray-400 text-center">
        ICE State: {iceState}<br>
        Signaling State: {signalingState}
      </div>
    </div>
  </main>