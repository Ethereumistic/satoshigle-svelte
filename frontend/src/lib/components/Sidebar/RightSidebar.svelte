<script lang="ts">
    import { 
      ChevronLeft, 
      ChevronRight, 
      Settings, 
      MessageSquare, 
      Bell, 
      Send
    } from "lucide-svelte";
    import { onMount, onDestroy } from "svelte";
    import * as Avatar from "$lib/components/ui/avatar";
    import { userStore } from "$lib/stores/userStore";
    import chatService, { chatStore, type ChatMessage } from "$lib/services/chatService";
    import { WebRTCService } from "$lib/services/webrtc";
    import { ScrollArea } from "$lib/components/ui/scroll-area";
    
    // Props
    export let currentLayout: "default" | "side-by-side" = "default";
    export let webrtcService: WebRTCService | undefined = undefined;
    
    // State
    let isExpanded = true;
    let isMobile = false;
    let activeTab = "chats";
    let messageInput = "";
    let messagesContainer: HTMLDivElement;
    let viewportElement: HTMLDivElement;
    let messageInputEl: HTMLTextAreaElement;
    let shouldAutoScroll = true;
    let prevMessagesLength = 0;
    
    // Callback Props
    export let onOpenSettings: () => void = () => {};
    
    // Derived state
    $: isConnected = $chatStore.isConnected;
    $: isPartnerTyping = $chatStore.partnerTyping;
    $: messages = $chatStore.messages;
    $: unreadCount = $chatStore.unreadCount;
    $: connectionStatus = webrtcService?.getStatus() || 'idle';
    
    // Toggle sidebar expansion
    function toggleSidebar() {
      isExpanded = !isExpanded;
      
      // If expanded, set focus to message input
      if (isExpanded && messageInputEl && isConnected) {
        setTimeout(() => messageInputEl.focus(), 300);
      }
    }
    
    // Send message function
    function handleSendMessage() {
      if (messageInput.trim()) {
        chatService.sendMessage(messageInput);
        messageInput = "";
        shouldAutoScroll = true;
      }
    }
    
    // Handle Enter key in message input
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSendMessage();
      }
    }
    
    // Handle typing indicators
    function handleInput() {
      chatService.sendTypingStart();
    }
    
    // Mark messages as read when sidebar is expanded and active tab is chats
    $: if (isExpanded && activeTab === 'chats') {
      chatService.markAsRead();
    }
    
    // Improved scroll to bottom function that respects user scroll position
    function scrollToBottom(force = false) {
      if (!viewportElement) return;
      
      // Get current scroll info
      const { scrollHeight, scrollTop, clientHeight } = viewportElement;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;
      
      // If we're near the bottom or we're forcing a scroll, scroll to bottom
      if (isNearBottom || force || shouldAutoScroll) {
        viewportElement.scrollTo({
          top: scrollHeight,
          // Use auto for immediate scroll on own messages, smooth for incoming
          behavior: force ? "auto" : "smooth"
        });
      }
    }
    
    // Handle scroll events to determine if we should auto-scroll
    function handleScroll() {
      if (!viewportElement) return;
      
      const { scrollHeight, scrollTop, clientHeight } = viewportElement;
      shouldAutoScroll = scrollHeight - scrollTop - clientHeight < 50;
    }
    
    // Trigger scroll to bottom when messages change
    $: if (messages.length) {
      // If new message is added (especially our own), scroll immediately
      const isNewMessage = messages.length > prevMessagesLength;
      prevMessagesLength = messages.length;
      
      // Give DOM time to update, but use a shorter timeout
      if (isNewMessage) {
        const isSelfMessage = messages[messages.length - 1]?.senderName === 'You';
        setTimeout(() => scrollToBottom(isSelfMessage), isSelfMessage ? 0 : 30);
      }
    }
    
    // Check if mobile on mount and when window resizes
    function checkMobile() {
      if (typeof window !== 'undefined') {
        isMobile = window.innerWidth < 768;
        // Auto-collapse on mobile
        if (isMobile) isExpanded = false;
      }
    }
    
    onMount(() => {
      checkMobile();
      
      // Add scroll event listener to detect when user scrolls
      if (viewportElement) {
        viewportElement.addEventListener("scroll", handleScroll);
      }
      
      // Add resize listener
      if (typeof window !== 'undefined') {
        window.addEventListener("resize", checkMobile);
      }
    });
    
    onDestroy(() => {
      if (typeof window !== 'undefined') {
        window.removeEventListener("resize", checkMobile);
        
        // Remove scroll event listener
        if (viewportElement) {
          viewportElement.removeEventListener("scroll", handleScroll);
        }
      }
    });
  </script>
  
  <!-- Fixed width container to prevent horizontal scrolling -->
  <div 
    class="fixed right-0 top-16 bottom-4 z-20 flex flex-col bg-gray-900/90 backdrop-blur-md border-l border-gray-800/50
           {isExpanded ? 'w-72' : 'w-16'} 
           transition-all duration-300 ease-in-out shadow-md"
  >
    <!-- Toggle button -->
    <button 
      class="absolute left-2 top-4 h-6 w-6 rounded-full bg-yellow-500 text-black flex items-center justify-center shadow-md hover:bg-yellow-400 transition-all"
      on:click={toggleSidebar}
      aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
    >
      {#if isExpanded}
        <ChevronRight class="h-4 w-4" />
      {:else}
        <ChevronLeft class="h-4 w-4" />
      {/if}
    </button>
    
    <!-- Header with tabs -->
    <div class="h-20 pt-14 px-3 flex-shrink-0">
      {#if isExpanded}
        <div class="flex items-center justify-between bg-gray-800/50 rounded-md p-1">
          <button 
            class="flex-1 py-1.5 px-2 rounded-sm text-xs font-medium transition-colors {activeTab === 'chats' ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-700/50'}"
            on:click={() => activeTab = 'chats'}
          >
            Chats {#if unreadCount > 0 && activeTab !== 'chats'}<span class="ml-1 px-1.5 py-0.5 bg-yellow-500 text-black rounded-full text-xs">{unreadCount}</span>{/if}
          </button>
          <button 
            class="flex-1 py-1.5 px-2 rounded-sm text-xs font-medium transition-colors {activeTab === 'notifications' ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-700/50'}"
            on:click={() => activeTab = 'notifications'}
          >
            Notifications
          </button>
        </div>
      {:else}
        <div class="flex flex-col items-center space-y-4">
          <button 
            class="h-10 w-10 rounded-md flex items-center justify-center {activeTab === 'chats' ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-700/50'} relative"
            on:click={() => activeTab = 'chats'}
            title="Chats"
          >
            <MessageSquare class="h-5 w-5" />
            {#if unreadCount > 0 && activeTab !== 'chats'}
              <span class="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center bg-yellow-500 text-black rounded-full text-xs font-medium">{unreadCount}</span>
            {/if}
          </button>
          <button 
            class="h-10 w-10 rounded-md flex items-center justify-center {activeTab === 'notifications' ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-700/50'}"
            on:click={() => activeTab = 'notifications'}
            title="Notifications"
          >
            <Bell class="h-5 w-5" />
          </button>
        </div>
      {/if}
    </div>
    
    <!-- Main content area -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Scrollable content -->
      {#if activeTab === 'chats'}
        <ScrollArea class="flex-1 px-3">
          <div class="h-full overflow-auto" bind:this={viewportElement}>
            <div class="flex flex-col gap-3 py-3 pr-2" bind:this={messagesContainer}>
              {#if !isConnected}
                <div class="text-center py-6 text-gray-400 text-sm">
                  {#if connectionStatus === 'connected'}
                    <div class="flex flex-col items-center">
                      <p>Video connected! Chat will be available soon.</p>
                    </div>
                  {:else if connectionStatus === 'idle'}
                    Find someone to chat with!
                  {:else if connectionStatus === 'searching' || connectionStatus === 'waiting'}
                    Searching for someone to chat with...
                  {:else if connectionStatus === 'peer-left'}
                    Your chat partner left
                  {:else}
                    Connection error. Try refreshing the page.
                  {/if}
                </div>
              {:else if messages.length === 0}
                <div class="text-center py-6 text-gray-400 text-sm">
                  Send a message to start chatting!
                </div>
              {:else}
                {#each messages as message, i (message.id)}
                  <div class="flex flex-col {message.senderId === 'system' ? 'items-center' : message.senderName === 'You' ? 'items-end' : 'items-start'} w-full">
                    {#if message.senderId === 'system'}
                      <!-- System message -->
                      <div class="bg-gray-800/70 px-3 py-1.5 rounded-md text-xs text-gray-400">
                        {message.content}
                      </div>
                    {:else}
                      <!-- User message -->
                      <div class="flex items-start gap-2 max-w-[85%] {message.senderName === 'You' ? 'flex-row-reverse' : ''}">
                        {#if message.senderName !== 'You'}
                          <Avatar.Root class="h-6 w-6 flex-shrink-0">
                            <Avatar.Fallback class="bg-yellow-500/10 text-yellow-400 text-xs">
                              {message.senderName.charAt(0)}
                            </Avatar.Fallback>
                          </Avatar.Root>
                        {/if}
                        
                        <div class="{message.senderName === 'You' ? 'bg-yellow-500/20 text-yellow-200' : 'bg-gray-700/80 text-gray-200'} px-3 py-2 rounded-lg text-sm whitespace-normal break-words max-w-full">
                          {message.content}
                        </div>
                      </div>
                    {/if}
                  </div>
                {/each}
                
                {#if isPartnerTyping}
                  <div class="flex items-start gap-2 mt-1">
                    <div class="bg-gray-800/60 px-3 py-2 rounded-lg text-gray-400 text-sm">
                      <span class="typing-indicator"><span>.</span><span>.</span><span>.</span></span>
                    </div>
                  </div>
                {/if}
              {/if}
            </div>
          </div>
        </ScrollArea>
      {:else if activeTab === 'notifications'}
        <!-- Notifications Tab (Empty for now) -->
        <div class="flex-1 px-3">
          <div class="text-center py-6 text-gray-400 text-sm">
            No game invites yet
          </div>
        </div>
      {/if}
      
      <!-- Footer with message input -->
      <div class="px-3 py-3 border-t border-gray-800/50 flex-shrink-0">
        {#if isExpanded && activeTab === 'chats'}
          <div class="flex items-center gap-2">
            <div class="relative flex-1">
              <textarea
                bind:value={messageInput}
                bind:this={messageInputEl}
                on:keydown={handleKeydown}
                on:input={handleInput}
                on:focus={() => { shouldAutoScroll = true; }}
                placeholder={isConnected ? "Type a message..." : "Connect to send messages..."}
                class="w-full bg-gray-800/50 text-gray-200 text-sm rounded-md py-2 px-3 focus:outline-none focus:ring-1 focus:ring-yellow-500/50 resize-none h-10 max-h-24 min-h-10"
                rows="1"
                disabled={!isConnected}
              ></textarea>
            </div>
            <button 
              class="h-10 w-10 flex items-center justify-center rounded-md bg-yellow-500 text-black hover:bg-yellow-400 transition-colors disabled:opacity-50 disabled:hover:bg-yellow-500"
              on:click={handleSendMessage}
              disabled={!isConnected || !messageInput.trim()}
              aria-label="Send message"
            >
              <Send class="h-5 w-5" />
            </button>
          </div>
        {:else if !isExpanded}
          <button 
            class="mx-auto h-10 w-10 flex items-center justify-center rounded-md bg-yellow-500 text-black hover:bg-yellow-400 transition-colors disabled:opacity-50 disabled:hover:bg-yellow-500"
            on:click={toggleSidebar}
            disabled={!isConnected}
            aria-label="Expand to send message"
          >
            <Send class="h-5 w-5" />
          </button>
        {/if}
      </div>
    </div>
  </div>
  
  <style>
    /* Auto-resize textarea */
    textarea {
      overflow-y: auto;
    }
    
    /* Typing indicator animation */
    .typing-indicator {
      display: inline-flex;
      align-items: center;
      height: 17px;
    }
    
    .typing-indicator span {
      font-size: 20px;
      animation: typingDot 1.4s infinite;
      line-height: 0;
    }
    
    .typing-indicator span:nth-child(1) {
      animation-delay: 0s;
    }
    
    .typing-indicator span:nth-child(2) {
      animation-delay: 0.2s;
    }
    
    .typing-indicator span:nth-child(3) {
      animation-delay: 0.4s;
    }
    
    @keyframes typingDot {
      0%, 20% {
        transform: translateY(0);
        opacity: 0.2;
      }
      50% {
        transform: translateY(-5px);
        opacity: 1;
      }
      80%, 100% {
        transform: translateY(0);
        opacity: 0.2;
      }
    }
  </style>