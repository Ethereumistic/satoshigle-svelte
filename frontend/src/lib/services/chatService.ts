import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { WebRTCService } from './webrtc';
import { userStore } from '$lib/stores/userStore';

// Types
export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  isSystem?: boolean;
}

interface ChatState {
  messages: ChatMessage[];
  isConnected: boolean;
  partnerId: string | null;
  partnerTyping: boolean;
  unreadCount: number;
}

// Create a writable store for chat state
const createChatStore = () => {
  const initialState: ChatState = {
    messages: [],
    isConnected: false,
    partnerId: null,
    partnerTyping: false,
    unreadCount: 0
  };

  const { subscribe, set, update } = writable<ChatState>(initialState);

  return {
    subscribe,
    reset: () => set(initialState),
    setConnected: (isConnected: boolean) => update((state: ChatState) => ({ ...state, isConnected })),
    setPartnerId: (partnerId: string | null) => update((state: ChatState) => ({ ...state, partnerId })),
    setPartnerTyping: (partnerTyping: boolean) => update((state: ChatState) => ({ ...state, partnerTyping })),
    addMessage: (message: ChatMessage) => update((state: ChatState) => ({
      ...state,
      messages: [...state.messages, message],
      unreadCount: state.unreadCount + 1
    })),
    resetUnreadCount: () => update((state: ChatState) => ({ ...state, unreadCount: 0 })),
    clearMessages: () => update((state: ChatState) => ({ ...state, messages: [] }))
  };
};

// Export the store
export const chatStore = createChatStore();

class ChatService {
  private typingTimeout: ReturnType<typeof setTimeout> | null = null;
  private isTyping = false;
  private initialized = false;
  private webrtcService: WebRTCService | null = null;
  private chatConnected = false; // Add flag to track if chat is already connected

  constructor() {
    // We'll initialize when needed, not in constructor to avoid circular dependencies
  }

  /**
   * Initialize the chat service with WebRTC service reference
   */
  public init(webrtcService: WebRTCService): void {
    if (!browser || this.initialized) return;
    
    console.log('Initializing chat service');
    this.webrtcService = webrtcService;
    
    // Set up event listeners for WebRTC events
    this.webrtcService.on('statusChange', (status: string) => {
      if (status === 'connected') {
        // Just log, don't take action here
      } else if (['idle', 'error', 'peer-left'].includes(status)) {
        this.cleanup();
      }
    });
    
    this.webrtcService.on('dataChannelOpen', () => {
      console.log('Data channel open, initializing chat');
      this.initializeChat();
    });
    
    this.webrtcService.on('dataChannelMessage', this.handleDataChannelMessage.bind(this));
    
    // Initialize if already connected
    if (webrtcService.getStatus() === 'connected' && webrtcService.isDataChannelOpen()) {
      console.log('WebRTC already connected with open data channel, initializing chat');
      this.initializeChat();
    }
    
    this.initialized = true;
  }

  /**
   * Handle received data channel messages
   */
  private handleDataChannelMessage(data: any): void {
    if (!data || !data.type) return;
    
    switch (data.type) {
      case 'chat-message':
        this.receiveMessage(data.message);
        break;
      case 'typing-start':
        chatStore.setPartnerTyping(true);
        break;
      case 'typing-stop':
        chatStore.setPartnerTyping(false);
        break;
      case 'chat-joined':
        chatStore.setPartnerId(data.partnerId);
        break;
    }
  }

  /**
   * Initialize chat when data channel is open
   */
  private initializeChat(): void {
    if (!this.webrtcService || !browser) return;
    
    // Set connected status
    chatStore.setConnected(true);
    
    // Only add the system message if not already connected
    if (!this.chatConnected) {
      this.addSystemMessage('Chat connected');
      this.chatConnected = true;
    }
    
    // Send join notification
    const user = get(userStore);
    this.webrtcService.sendData({
      type: 'chat-joined',
      roomId: this.webrtcService.getRoomId(),
      partnerId: user.profile?.displayName || 'Anonymous'
    });
  }

  /**
   * Send a chat message
   */
  public sendMessage(content: string): void {
    if (!this.webrtcService || !browser || !content.trim()) return;
    
    const user = get(userStore);
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    
    const message: ChatMessage = {
      id: messageId,
      senderId: messageId,
      senderName: user.profile?.displayName || 'You',
      content: content.trim()
    };

    // Send via WebRTC if data channel is open
    if (this.webrtcService.isDataChannelOpen()) {
      this.webrtcService.sendData({
        type: 'chat-message',
        roomId: this.webrtcService.getRoomId(),
        message: {
          ...message,
          senderName: user.profile?.displayName || 'Anonymous' // Send real name to peer
        }
      });
    }
    
    // Add to local store (always show as "You" for own messages)
    chatStore.addMessage({
      ...message,
      senderName: 'You'
    });

    // Clear typing indicator
    this.sendTypingStop();
  }

  /**
   * Handle received message
   */
  private receiveMessage(message: ChatMessage): void {
    chatStore.addMessage(message);
  }

  /**
   * Add a system message
   */
  private addSystemMessage(content: string): void {
    const message: ChatMessage = {
      id: `system-${Date.now()}`,
      senderId: 'system',
      senderName: 'System',
      content,
      isSystem: true
    };

    chatStore.addMessage(message);
  }

  /**
   * Send typing indicator
   */
  public sendTypingStart(): void {
    if (!this.webrtcService || !browser || this.isTyping) return;

    if (this.webrtcService.isDataChannelOpen()) {
      this.webrtcService.sendData({
        type: 'typing-start',
        roomId: this.webrtcService.getRoomId()
      });
    }
    
    this.isTyping = true;

    // Clear any existing timeout and set a new one
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }
    
    this.typingTimeout = setTimeout(() => {
      this.sendTypingStop();
    }, 2000);
  }

  /**
   * Stop typing indicator
   */
  public sendTypingStop(): void {
    if (!this.webrtcService || !browser || !this.isTyping) return;

    if (this.webrtcService.isDataChannelOpen()) {
      this.webrtcService.sendData({
        type: 'typing-stop',
        roomId: this.webrtcService.getRoomId()
      });
    }
    
    this.isTyping = false;

    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
      this.typingTimeout = null;
    }
  }

  /**
   * Reset unread message counter
   */
  public markAsRead(): void {
    chatStore.resetUnreadCount();
  }

  /**
   * Clean up resources
   */
  public cleanup(): void {
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
      this.typingTimeout = null;
    }

    this.isTyping = false;
    this.chatConnected = false; // Reset connected flag
    chatStore.reset();
  }
}

// Export singleton instance
const chatService = new ChatService();
export default chatService; 