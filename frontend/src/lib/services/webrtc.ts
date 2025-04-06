// Simple browser-compatible event emitter
class BrowserEventEmitter {
  private events: Map<string, Function[]> = new Map();

  on(event: string, listener: Function): this {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event)?.push(listener);
    return this;
  }

  off(event: string, listener?: Function): this {
    if (!this.events.has(event)) return this;
    
    if (!listener) {
      this.events.delete(event);
      return this;
    }

    const listeners = this.events.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
      if (listeners.length === 0) {
        this.events.delete(event);
      }
    }
    return this;
  }

  emit(event: string, ...args: any[]): boolean {
    if (!this.events.has(event)) return false;
    
    const listeners = this.events.get(event);
    if (listeners) {
      listeners.forEach(listener => {
        listener(...args);
      });
      return true;
    }
    return false;
  }

  once(event: string, listener: Function): this {
    const onceWrapper = (...args: any[]) => {
      listener(...args);
      this.off(event, onceWrapper);
    };
    return this.on(event, onceWrapper);
  }

  removeAllListeners(event?: string): this {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
    return this;
  }
}

import io from 'socket.io-client';
import { env } from '$env/dynamic/public';
import gameService from './gameService';

// State types
export type ConnectionState = 'idle' | 'searching' | 'waiting' | 'connected' | 'peer-left' | 'error';

// Event types
export type WebRTCEvents = {
  statusChange: (status: ConnectionState) => void;
  iceStateChange: (state: RTCIceConnectionState) => void;
  signalingStateChange: (state: RTCSignalingState) => void;
  localStream: (stream: MediaStream) => void;
  remoteStream: (stream: MediaStream) => void;
  error: (message: string) => void;
};

export class WebRTCService extends BrowserEventEmitter {
  private socket: ReturnType<typeof io> | null = null;
  private pc: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private roomId: string | null = null;
  private isInitiator = false;
  private partnerId: string | null = null;
  private status: ConnectionState = 'idle';
  private peerConnection: RTCPeerConnection | null = null;
  private remoteStream: MediaStream | null = null;
  private iceServers: RTCIceServer[] = [];
  private isInitialized = false;
  private _isMuted = false;
  private _isVideoOff = false;

  constructor() {
    super();
  }

  // Initialize the service
  public async initialize(): Promise<void> {
    // Initialize local media
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true
      });
      this.emit('localStream', this.localStream);
    } catch (err) {
      this.setStatus('error');
      this.emit('error', `Camera access error: ${err}`);
      throw err;
    }

    // Initialize socket connection
    await this.initializeSocket();
  }

  // Set up socket connection
  private async initializeSocket(): Promise<void> {
    // Use environment variables for server connection with fallback
    const serverUrl = env.PUBLIC_VITE_SERVER_URL || 'http://localhost:3001';
    const serverIpUrl = env.PUBLIC_VITE_SERVER_IP_URL || 'http://192.168.192.1:3001';

    try {
      // Try main connection first
      this.socket = io(serverUrl, {
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 3,
        reconnectionDelay: 1000,
        path: '/socket.io/'
      });

      // If main connection fails, try IP connection after brief delay
      this.socket.on('connect_error', (err) => {
        console.error('Socket main connection error:', err);

        // Only try alternative if we haven't connected yet
        if (!this.socket?.connected) {
          console.log('Trying alternative connection to:', serverIpUrl);
          
          // Disconnect from first attempt
          this.socket?.disconnect();
          
          // Connect to alternative URL after a short delay
          setTimeout(() => {
            this.socket = io(serverIpUrl, {
              transports: ['websocket', 'polling'],
              reconnectionAttempts: 5,
              reconnectionDelay: 1000,
              path: '/socket.io/'
            });
            
            // Set up events again for the new connection
            this.setupSocketEvents();
          }, 1000);
        }
      });

      // Set up initial event handlers
      this.setupSocketEvents();
    } catch (err) {
      this.setStatus('error');
      this.emit('error', `Socket connection error: ${err}`);
      throw err;
    }
  }

  // Set up socket event handlers
  private setupSocketEvents(): void {
    if (!this.socket) return;

    this.socket
      .on('connect', () => {
        console.log('🔗 Socket connected');
        // When reconnecting, restart search if we were searching before
        if (this.status === 'searching') {
          setTimeout(() => this.socket?.emit('start-search'), 500);
        }
      })
      .on('connect_error', (err) => {
        console.error('Socket connection error:', err);
        this.setStatus('error');
      })
      .on('disconnect', () => {
        console.log('🔌 Socket disconnected');
        // If we were connected to a peer, show error
        if (this.status === 'connected') {
          this.setStatus('error');
        }
      })
      .on('waiting-for-peer', () => {
        console.log('⏳ Waiting for peer...');
        this.setStatus('waiting');
      })
      .on('match-ready', ({ roomId: matchId, isInitiator: initiator, peerId }) => {
        console.log(`🚀 Match ready: ${matchId}, initiator: ${initiator}, peerId: ${peerId}`);
        
        // Reset any existing connection before starting a new one
        this.resetConnection();
        
        this.roomId = matchId;
        this.isInitiator = initiator ?? false;
        this.partnerId = peerId;
        this.setStatus('connected');
        
        // Acknowledge the match to the server
        this.socket?.emit('match-ready', { matchId });
        
        // Initialize WebRTC connection
        this.initializePeerConnection();
      })
      .on('peer-disconnected', () => {
        console.log('⚠️ Peer disconnected');
        this.setStatus('peer-left');
        this.resetConnection();
      })
      .on('peer-skipped', () => {
        console.log('⚠️ Peer skipped connection');
        this.resetConnection();
        this.setStatus('searching');
      })
      .on('connection-error', (data) => {
        console.error('🚨 Connection error:', data.message);
        this.resetConnection();
        this.setStatus('error');
        this.emit('error', data.message);
      });
  }

  // Start searching for a peer
  public startSearch(): void {
    if (this.status === 'searching') return;
    this.resetConnection(); // Ensure clean state before starting
    this.setStatus('searching');
    console.log('🔍 Starting search...');
    this.socket?.emit('start-search');
  }

  // Skip current peer
  public skipPeer(): void {
    console.log('⏩ User initiated skip');
    this.socket?.emit('skip');
    this.setStatus('searching');
    this.resetConnection();
  }

  // Stop searching
  public stopSearch(): void {
    console.log('⛔ User stopped search');
    this.socket?.emit('stop-search');
    this.setStatus('idle');
    this.resetConnection();
  }

  // Reset WebRTC connection
  private resetConnection(): void {
    if (this.pc) {
      console.log('🛑 Closing peer connection');
      try {
        // Remove all event listeners to prevent any callbacks after reset
        this.pc.onicecandidate = null;
        this.pc.ontrack = null;
        this.pc.oniceconnectionstatechange = null;
        this.pc.onsignalingstatechange = null;
        this.pc.close();
      } catch (err) {
        console.error('Error closing peer connection:', err);
      }
      this.pc = null;
    }
    
    // Clear match data
    this.roomId = null;
    this.isInitiator = false;
    this.partnerId = null;
    
    // Clean up any lingering listeners for signals
    this.socket?.off('signal');
  }

  // Initialize WebRTC peer connection
  private async initializePeerConnection(): Promise<void> {
    try {
      console.log('🔄 Initializing WebRTC...');
      this.pc = new RTCPeerConnection({
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
      if (this.localStream) {
        this.localStream.getTracks().forEach(track => {
          this.pc?.addTrack(track, this.localStream!);
          console.log(`➕ Added local ${track.kind} track`);
        });
      }

      // Remote track handler
      this.pc.ontrack = (event) => {
        console.log("🎬 Remote track received", event.streams);
        if (event.streams && event.streams.length > 0) {
          const stream = event.streams[0];
          
          // Safeguard to ensure we have a valid MediaStream
          if (!(stream instanceof MediaStream)) {
            console.error('Invalid MediaStream received in ontrack');
            return;
          }
          
          // Emit remote stream event
          this.emit('remoteStream', stream);
        }
      };

      // ICE Candidate handling
      this.pc.onicecandidate = (event) => {
        if (event.candidate && this.roomId) {
          console.log('🧊 Sending ICE candidate');
          this.socket?.emit('signal', {
            roomId: this.roomId,
            candidate: event.candidate
          });
        }
      };

      // State change handlers
      this.pc.oniceconnectionstatechange = () => {
        const iceState = this.pc?.iceConnectionState || 'closed';
        console.log('❄️ ICE State:', iceState);
        this.emit('iceStateChange', iceState);
        
        // Update status based on ICE state
        if (iceState === 'connected' || iceState === 'completed') {
          this.setStatus('connected');
        } else if (iceState === 'failed') {
          this.setStatus('error');
        } else if (iceState === 'disconnected') {
          // Wait for potential self-recovery before declaring error
          setTimeout(() => {
            if (this.pc && this.pc.iceConnectionState === 'disconnected') {
              this.setStatus('error');
            }
          }, 5000);
        } else if (iceState === 'closed') {
          this.setStatus('error');
        }
      };

      this.pc.onsignalingstatechange = () => {
        const signalingState = this.pc?.signalingState || 'closed';
        console.log('📶 Signaling State:', signalingState);
        this.emit('signalingStateChange', signalingState);
      };

      // Signal handler - clean up old ones first
      this.socket?.off('signal');
      this.socket?.on('signal', async (data) => {
        try {
          if (!this.pc) {
            console.log('⚠️ Received signal but no peer connection exists');
            return;
          }

          console.log(`📨 Received signal: ${data.description?.type || 'candidate'}`);
          
          if (data.description) {
            console.log('📝 Setting remote description');
            console.log('📝 Remote Description:', data.description.type);
            await this.pc.setRemoteDescription(new RTCSessionDescription(data.description));
            
            if (data.description.type === 'offer') {
              console.log('✍️ Creating answer');
              const answer = await this.pc.createAnswer();
              await this.pc.setLocalDescription(answer);
              this.socket?.emit('signal', {
                roomId: this.roomId,
                description: answer
              });
            }
          }
          
          if (data.candidate) {
            console.log('➕ Adding ICE candidate');
            try {
              await this.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (err) {
              // Ignore ICE candidate errors if we're not ready yet
              if (this.pc.remoteDescription) {
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
      if (this.isInitiator) {
        console.log('✍️ Creating offer');
        const offer = await this.pc.createOffer();
        console.log('✍️ Offer created');
        await this.pc.setLocalDescription(offer);
        this.socket?.emit('signal', {
          roomId: this.roomId,
          description: offer
        });
      } else {
        // If we're not the initiator, set up listener for the data channel
        this.pc.ondatachannel = (event) => {
          console.log('📊 Received data channel:', event.channel.label);
          // Simply log the data channel but don't use it
          // The game communication is now handled through socket.io
        };
      }
    } catch (err) {
      console.error('🚨 WebRTC Error:', err);
      this.setStatus('error');
      this.resetConnection();
    }
  }

  // When connection is established, initialize game service socket
  private setStatus(status: ConnectionState): void {
    const previousStatus = this.status;
    this.status = status;
    this.emit('statusChange', status);

    // When connection becomes active, initialize game service
    if (status === 'connected' && previousStatus !== 'connected' && this.roomId) {
      console.log('WebRTC connected, initializing game service');
      gameService.initializeSocket(this.roomId);
    } else if (status !== 'connected' && previousStatus === 'connected') {
      // When connection is lost, clean up game service
      console.log('WebRTC disconnected, cleaning up game service');
      gameService.cleanup();
    }
  }

  // Get current connection status
  public getStatus(): ConnectionState {
    return this.status;
  }

  // Check if we are currently searching
  public isSearching(): boolean {
    return this.status === 'searching' || this.status === 'waiting';
  }

  // Clean up and disconnect
  public cleanup(): void {
    console.log('🧹 Cleaning up WebRTC service...');
    this.socket?.disconnect();
    this.resetConnection();
    if (this.localStream) {
      try {
        this.localStream.getTracks().forEach(track => track.stop());
      } catch (err) {
        console.error('Error stopping local tracks:', err);
      }
      this.localStream = null;
    }
  }

  /**
   * Get the current PeerConnection
   */
  public getPeerConnection(): RTCPeerConnection | null {
    return this.pc;
  }
  
  /**
   * Toggle mute state of audio tracks
   */
  toggleMute(): boolean {
    if (!this.localStream) return false;
    
    const audioTracks = this.localStream.getAudioTracks();
    if (audioTracks.length === 0) return false;
    
    const shouldMute = !this._isMuted;
    audioTracks.forEach(track => {
      track.enabled = !shouldMute;
    });
    
    this._isMuted = shouldMute;
    return true;
  }
  
  /**
   * Toggle visibility of video tracks
   */
  toggleVideo(): boolean {
    if (!this.localStream) return false;
    
    const videoTracks = this.localStream.getVideoTracks();
    if (videoTracks.length === 0) return false;
    
    const shouldHide = !this._isVideoOff;
    videoTracks.forEach(track => {
      track.enabled = !shouldHide;
    });
    
    this._isVideoOff = shouldHide;
    return true;
  }
  
  /**
   * Check if audio is currently muted
   */
  get isMuted(): boolean {
    return this._isMuted;
  }
  
  /**
   * Check if video is currently turned off
   */
  get isVideoOff(): boolean {
    return this._isVideoOff;
  }
}

// Create a singleton instance
const webrtcService = new WebRTCService();
export default webrtcService; 