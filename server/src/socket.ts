import { Server, Socket } from 'socket.io';

/**
 * Simple Chatroulette/Omegle style matching algorithm
 * 
 * Matching rules:
 * 1. First user waits in the waiting pool
 * 2. Second user matches with the first user
 * 3. Third user waits until either:
 *    - Fourth user joins (matches with third)
 *    - First or second user leaves or skips (matches with the remaining one)
 * 4. Always prefer oldest waiting user for matching
 * 5. Track previously matched users to avoid re-matching recently
 */

// User states
type UserState = 'waiting' | 'matched';

// Simple user representation
interface User {
  id: string;
  state: UserState;
  joinedAt: number;
  matchedWith: string | null;
  previousMatches: Set<string>;
  blockedUsers?: Set<string>; // Temporarily blocked users to prevent breaking existing connections
  recentSkips: Map<string, number>; // Map of userIds to timestamp when skip occurred
}

// Global state
const users = new Map<string, User>();
const waitingQueue: string[] = []; // Ordered by join time (oldest first)

export function setupSocket(io: Server) {
  // Log the current system state (for debugging)
  const logState = () => {
    console.log('\n===== SYSTEM STATE =====');
    console.log(`Total Users: ${users.size}`);
    console.log(`Waiting Queue (${waitingQueue.length}): ${waitingQueue.join(', ')}`);
    
    console.log('\nUsers:');
    users.forEach((user, id) => {
      console.log(`- ${id}: ${user.state} ${user.matchedWith ? `(matched with ${user.matchedWith})` : ''}, joined: ${new Date(user.joinedAt).toISOString()}, prev matches: ${Array.from(user.previousMatches).join(', ')}`);
    });
    console.log('========================\n');
  };

  // Add this after the existing logState function
  const logEmittedEvent = (event: string, to: string, data: any = {}) => {
    console.log(`📤 EMIT [${new Date().toISOString()}] Event "${event}" to ${to}`, data);
  };

  // Add user to waiting queue
  const addToWaitingQueue = (userId: string) => {
    // First remove if already in queue (shouldn't happen, but safety check)
    removeFromWaitingQueue(userId);
    
    // Then add to end
    waitingQueue.push(userId);
    const user = users.get(userId);
    if (user) {
      user.state = 'waiting';
      user.matchedWith = null;
    }
  };

  // Remove user from waiting queue
  const removeFromWaitingQueue = (userId: string) => {
    const index = waitingQueue.indexOf(userId);
    if (index !== -1) {
      waitingQueue.splice(index, 1);
      return true;
    }
    return false;
  };

  // Create a match between two users
  const createMatch = (user1Id: string, user2Id: string) => {
    const user1 = users.get(user1Id);
    const user2 = users.get(user2Id);
    
    if (!user1 || !user2) {
      console.log(`⚠️ Cannot create match - one or both users don't exist`);
      return false;
    }
    
    // CRITICAL: Final validation before match creation
    // This is our last line of defense to prevent breaking existing connections
    
    // 1. Check if either user is already matched with someone else
    if (user1.state === 'matched' && user1.matchedWith !== null && user1.matchedWith !== user2Id) {
      const partner = users.get(user1.matchedWith);
      // Only if partner is valid and actually matched with this user (bidirectional)
      if (partner && partner.state === 'matched' && partner.matchedWith === user1Id) {
        console.log(`🛡️ PROTECTED: Prevented match creation that would break existing connection between ${user1Id} and ${user1.matchedWith}`);
        return false;
      }
    }
    
    if (user2.state === 'matched' && user2.matchedWith !== null && user2.matchedWith !== user1Id) {
      const partner = users.get(user2.matchedWith);
      // Only if partner is valid and actually matched with this user (bidirectional)
      if (partner && partner.state === 'matched' && partner.matchedWith === user2Id) {
        console.log(`🛡️ PROTECTED: Prevented match creation that would break existing connection between ${user2Id} and ${user2.matchedWith}`);
        return false;
      }
    }
    
    // 2. Check for inconsistent state across ALL users
    for (const [otherId, otherUser] of users.entries()) {
      // Skip the two users we're trying to match
      if (otherId === user1Id || otherId === user2Id) continue;
      
      // Check if any other user thinks they're matched with either of our users
      if (otherUser.state === 'matched') {
        if (otherUser.matchedWith === user1Id) {
          console.log(`🛡️ PROTECTED: User ${user1Id} is already matched with ${otherId} - won't create new match`);
          return false;
        }
        
        if (otherUser.matchedWith === user2Id) {
          console.log(`🛡️ PROTECTED: User ${user2Id} is already matched with ${otherId} - won't create new match`);
          return false;
        }
      }
    }
    
    // Create a unique room ID
    const roomId = `room_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    
    // Clean up any existing rooms these users might be in
    const socket1 = io.sockets.sockets.get(user1Id);
    const socket2 = io.sockets.sockets.get(user2Id);
    
    if (!socket1 || !socket2) {
      console.log(`⚠️ Socket missing for match between ${user1Id} and ${user2Id}`);
      return false;
    }
    
    // Leave all rooms except their own socket ID room (which is always present)
    if (socket1.rooms.size > 1) {
      for (const room of socket1.rooms) {
        if (room !== user1Id) {
          socket1.leave(room);
          console.log(`🧹 User ${user1Id} left room ${room}`);
        }
      }
    }
    
    if (socket2.rooms.size > 1) {
      for (const room of socket2.rooms) {
        if (room !== user2Id) {
          socket2.leave(room);
          console.log(`🧹 User ${user2Id} left room ${room}`);
        }
      }
    }
    
    // Setup user states
    user1.state = 'matched';
    user1.matchedWith = user2Id;
    user1.previousMatches.add(user2Id);
    
    user2.state = 'matched';
    user2.matchedWith = user1Id;
    user2.previousMatches.add(user1Id);
    
    // Remove both from waiting queue
    removeFromWaitingQueue(user1Id);
    removeFromWaitingQueue(user2Id);
    
    // Join socket.io room
    socket1.join(roomId);
    socket2.join(roomId);
    
    // Determine initiator (first user is the initiator)
    const user1JoinedFirst = user1.joinedAt <= user2.joinedAt;
    
    // Notify both users
    io.to(user1Id).emit('match-ready', {
      roomId,
      isInitiator: user1JoinedFirst,
      peerId: user2Id,
      forced: false
    });
    logEmittedEvent('match-ready', user1Id, {
      roomId,
      isInitiator: user1JoinedFirst,
      peerId: user2Id,
      forced: false
    });
    
    io.to(user2Id).emit('match-ready', {
      roomId, 
      isInitiator: !user1JoinedFirst,
      peerId: user1Id,
      forced: false
    });
    logEmittedEvent('match-ready', user2Id, {
      roomId, 
      isInitiator: !user1JoinedFirst,
      peerId: user1Id,
      forced: false
    });
    
    console.log(`🔗 Created match between ${user1Id} and ${user2Id} in room ${roomId}`);
    return true;
  };
  
  // Try to find a match for the given user
  const findMatchForUser = (userId: string) => {
    const user = users.get(userId);
    if (!user) return false;
    
    // Skip if there are no other waiting users
    if (waitingQueue.length <= 1) return false;
    
    // Constants for skip prevention
    const SKIP_PREVENTION_TIME = 60000; // 60 seconds cooldown after a skip
    const now = Date.now();
    
    // Find all other waiting users, sorted by join time
    const otherWaitingUsers = waitingQueue
      .filter(id => id !== userId) // Not self
      .map(id => users.get(id)!)
      .filter(other => {
        // Must be in waiting state
        if (other.state !== 'waiting') return false;
        
        // CRITICAL FIX: Check for recent skips to prevent immediate rematching
        // If either user has recently skipped the other, prevent matching
        if (user.recentSkips && user.recentSkips.has(other.id)) {
          const skipTime = user.recentSkips.get(other.id)!;
          if (now - skipTime < SKIP_PREVENTION_TIME) {
            console.log(`🚫 Preventing rematch: ${userId} skipped ${other.id} ${Math.floor((now - skipTime) / 1000)}s ago`);
            return false;
          }
        }
        
        // Also check the other direction
        if (other.recentSkips && other.recentSkips.has(userId)) {
          const skipTime = other.recentSkips.get(userId)!;
          if (now - skipTime < SKIP_PREVENTION_TIME) {
            console.log(`🚫 Preventing rematch: ${other.id} skipped ${userId} ${Math.floor((now - skipTime) / 1000)}s ago`);
            return false;
          }
        }
        
        // Check if this user is blocked (temporarily preventing reconnection to avoid breaking existing connections)
        if (user.blockedUsers && user.blockedUsers.has(other.id)) {
          console.log(`🔒 Skipping blocked user match: ${userId} -> ${other.id}`);
          return false;
        }
        
        // Also check if other user has blocked this user
        if (other.blockedUsers && other.blockedUsers.has(userId)) {
          console.log(`🔒 Skipping reverse blocked user match: ${other.id} -> ${userId}`);
          return false;
        }
        
        // CRITICAL FIX: Check if either user was recently matched with someone else
        // This prevents a user from stealing someone from another match
        if (other.matchedWith) return false;
        
        // CRITICAL PROTECTION: Check all active connections to avoid interception scenarios
        for (const [otherId, otherUser] of users.entries()) {
          // Skip self in this inner check
          if (otherId === userId || otherId === other.id) continue;
          
          if (otherUser.state === 'matched') {
            // THREE CASES that should prevent matching:
            
            // Case 1: If our current user is trying to match with someone already matched to someone else
            if (otherUser.matchedWith === other.id) {
              console.log(`🛑 Blocked potential interception: ${userId} trying to match with ${other.id} who is already matched with ${otherId}`);
              return false;
            }
            
            // Case 2: If the potential match is trying to match with someone already matched to someone else
            if (otherUser.matchedWith === userId) {
              console.log(`🛑 Blocked potential interception: ${other.id} trying to match with ${userId} who is already matched with ${otherId}`);
              return false;
            }
            
            // Case 3: If either user in this potential match is matched with someone else already
            if (user.matchedWith === otherId || other.matchedWith === otherId) {
              console.log(`🛑 Blocked inconsistent match state between ${userId}, ${other.id}, and ${otherId}`);
              return false;
            }
          }
        }
        
        return true;
      });
      
    if (otherWaitingUsers.length === 0) return false;
    
    // Sort by join time (oldest first)
    otherWaitingUsers.sort((a, b) => a.joinedAt - b.joinedAt);
    
    // IMPROVED MATCHING PRIORITY:
    // 1. First try to find users who have NEVER matched before
    let bestMatch = otherWaitingUsers.find(other => !user.previousMatches.has(other.id) && !other.previousMatches.has(userId));
    
    // 2. Then try users who are not in the recent match history (one-directional)
    if (!bestMatch) {
      bestMatch = otherWaitingUsers.find(other => !user.previousMatches.has(other.id));
    }
    
    // 3. Finally, if needed, pick the longest-waiting user, but ONLY if not recently skipped
    if (!bestMatch && otherWaitingUsers.length > 0) {
      // Find the first user that wasn't recently skipped
      bestMatch = otherWaitingUsers.find(other => {
        // Skip users who recently skipped each other
        if (user.recentSkips && user.recentSkips.has(other.id)) {
          const skipTime = user.recentSkips.get(other.id)!;
          if (now - skipTime < SKIP_PREVENTION_TIME) return false;
        }
        
        if (other.recentSkips && other.recentSkips.has(userId)) {
          const skipTime = other.recentSkips.get(userId)!;
          if (now - skipTime < SKIP_PREVENTION_TIME) return false;
        }
        
        return true;
      });
      
      if (bestMatch) {
        console.log(`⚠️ Matching ${userId} with previously matched user ${bestMatch.id} due to lack of alternatives`);
      }
    }
    
    if (bestMatch) {
      return createMatch(userId, bestMatch.id);
    }
    
    return false;
  };
  
  // Process the waiting queue and try to match users
  const processWaitingQueue = () => {
    // Skip if there are fewer than 2 users waiting
    if (waitingQueue.length < 2) {
      console.log(`⏳ Not enough users waiting (${waitingQueue.length}), skipping queue processing`);
      
      // If there's exactly one user waiting, send them the waiting message
      if (waitingQueue.length === 1) {
        const waitingUserId = waitingQueue[0];
        io.to(waitingUserId).emit('waiting-for-peer');
        logEmittedEvent('waiting-for-peer', waitingUserId);
        console.log(`⏳ Notified ${waitingUserId} they are waiting for a peer`);
      }
      
      return;
    }
    
    console.log(`🔄 Processing waiting queue with ${waitingQueue.length} users`);
    
    // Debug: List all waiting users
    console.log(`🔍 Waiting queue users: ${waitingQueue.join(', ')}`);
    
    // CRITICAL FIX: First, verify the waiting queue is consistent with user states
    // This fixes cases where the queue contains users who should not be in waiting state
    const validatedQueue = waitingQueue.filter(userId => {
      const user = users.get(userId);
      
      // User must exist and be in waiting state
      if (!user || user.state !== 'waiting') {
        console.log(`⚠️ Inconsistent state: User ${userId} is in waiting queue but has state: ${user?.state || 'undefined'}`);
        // Remove from queue if not in waiting state
        removeFromWaitingQueue(userId);
        return false;
      }
      
      // Check if user is matched with anyone
      if (user.matchedWith !== null) {
        console.log(`⚠️ Inconsistent state: User ${userId} is in waiting queue but matched with ${user.matchedWith}`);
        // Remove from queue if matched
        removeFromWaitingQueue(userId);
        return false;
      }
      
      return true;
    });
    
    // If we don't have enough users after validation, stop
    if (validatedQueue.length < 2) {
      console.log(`⚠️ Not enough valid users in waiting queue after validation (${validatedQueue.length})`);
      return;
    }
    
    console.log(`✅ Validated queue with ${validatedQueue.length} users: ${validatedQueue.join(', ')}`);
    
    // Clone the queue to avoid modification during iteration
    const queueCopy = [...validatedQueue];
    
    // First try: Match users with no history together
    let matchesMade = 0;
    
    // Try to match users in order of waiting time
    for (let i = 0; i < queueCopy.length; i++) {
      const userId = queueCopy[i];
      const user = users.get(userId);
      
      // Skip users who are no longer waiting (might have been matched in a previous iteration)
      if (!user || user.state !== 'waiting') continue;
      
      // Double check this user is not matched with anyone
      if (user.matchedWith !== null) {
        console.log(`⚠️ User ${userId} has inconsistent state - in waiting queue but matchedWith=${user.matchedWith}`);
        continue;
      }
      
      // Try to match this user
      console.log(`🔍 Attempting to find match for ${userId}`);
      if (findMatchForUser(userId)) {
        matchesMade++;
        console.log(`✅ Match found for ${userId}`);
      } else {
        console.log(`❌ No match found for ${userId}`);
      }
    }
    
    console.log(`📊 Matching round complete: ${matchesMade} matches made`);
    
    // If no matches were made and we still have waiting users, try one more pass
    // with reduced restrictions (this helps when there are only 2 users left and they've matched before)
    if (matchesMade === 0 && waitingQueue.length >= 2) {
      console.log(`🔄 No matches made, trying with relaxed restrictions`);
      
      // Force match between the two longest-waiting users if needed
      const oldestUsers = [...waitingQueue]
        .map(id => users.get(id))
        .filter((user): user is User => user !== undefined && user !== null)
        .filter(user => user.state === 'waiting' && user.matchedWith === null) // Extra validation
        .sort((a, b) => a.joinedAt - b.joinedAt);
      
      if (oldestUsers.length >= 2) {
        createMatch(oldestUsers[0].id, oldestUsers[1].id);
      }
    }
    
    // If we still have waiting users, schedule another round of processing
    if (waitingQueue.length >= 2) {
      setTimeout(processWaitingQueue, 500);
    }
  };

  // Find a new match for a user after their partner left/skipped
  const findNewMatchAfterDisconnect = (userId: string) => {
    const user = users.get(userId);
    if (!user) return;
    
    console.log(`🔄 Finding new match for disconnected user ${userId}`);
    
    // Move user to waiting state
    user.state = 'waiting';
    user.matchedWith = null;
    
    // Add to waiting queue, but prioritize by setting an earlier join time
    // This ensures this user gets matched quickly
    user.joinedAt = Date.now() - 10000; // Make them appear to have been waiting 10 seconds
    addToWaitingQueue(userId);
    
    // Notify user they're waiting
    io.to(userId).emit('waiting-for-peer');
    
    // Try direct matching first
    if (waitingQueue.length >= 2) {
      // Check if we can immediately match this user with another waiting user
      const otherWaitingUser = waitingQueue
        .filter(id => id !== userId)
        .find(id => {
          const other = users.get(id);
          return other && other.state === 'waiting';
        });
        
      if (otherWaitingUser) {
        console.log(`🎯 Direct matching ${userId} with waiting user ${otherWaitingUser}`);
        createMatch(userId, otherWaitingUser);
        return;
      }
    }
    
    // If we couldn't match directly, process the queue
    processWaitingQueue();
  };
  
  // Clean up user data when they disconnect
  const cleanupUser = (userId: string) => {
    const user = users.get(userId);
    if (!user) return;
    
    // Get the socket to check rooms
    const socket = io.sockets.sockets.get(userId);
    
    // Leave all rooms this user is in
    if (socket && socket.rooms.size > 0) {
      for (const room of socket.rooms) {
        if (room !== userId) {  // Don't leave their own room
          socket.leave(room);
          console.log(`🧹 User ${userId} left room ${room} due to disconnect`);
        }
      }
    }
    
    // If user was matched, handle partner disconnection
    if (user.state === 'matched' && user.matchedWith) {
      const partner = users.get(user.matchedWith);
      if (partner) {
        // First ensure the partner is still matched with this user
        // This prevents the case where they've already been matched with someone else
        if (partner.matchedWith === userId) {
          // Notify partner
          io.to(partner.id).emit('peer-disconnected');
          
          // Reset partner state
          partner.matchedWith = null;
          
          // Put partner back in waiting queue
          findNewMatchAfterDisconnect(partner.id);
        }
      }
    }
    
    // Remove from waiting queue if needed
    removeFromWaitingQueue(userId);
    
    // Remove user
    users.delete(userId);
  };

  // Connection handler
  io.on('connection', (socket) => {
    const userId = socket.id;
    console.log(`🔌 [${new Date().toISOString()}] New connection: ${userId}`);
    
    // Create user (Initial state is NOT waiting - they need to start search first)
    users.set(userId, {
      id: userId,
      state: 'waiting', // TODO: Should be changed to 'idle' in future refactoring
      joinedAt: Date.now(),
      matchedWith: null,
      previousMatches: new Set(),
      recentSkips: new Map()
    });
    
    // Add debug event to see server state (only for testing)
    socket.on('debug-state', () => {
      console.log(`🔍 [${userId}] Requested debug state`);
      logState();
      
      // Send back basic info to the client
      const user = users.get(userId);
      if (user) {
        const debugData = {
          state: user.state,
          inWaitingQueue: waitingQueue.includes(userId),
          queuePosition: waitingQueue.indexOf(userId),
          waitingQueueSize: waitingQueue.length,
          totalUsers: users.size
        };
        socket.emit('debug-info', debugData);
        logEmittedEvent('debug-info', userId, debugData);
      }
    });
    
    // Handle user starting search
    socket.on('start-search', () => {
      console.log(`🔍 [${userId}] Starting search`);
      
      const user = users.get(userId);
      if (!user) return; // Safety check
      
      // If user was already matched, handle like a skip
      if (user.state === 'matched' && user.matchedWith) {
        // Get partner
        const partnerId = user.matchedWith;
        const partner = users.get(partnerId);
        
        if (partner) {
          // Notify partner
          socket.to(partnerId).emit('peer-disconnected');
          
          // Find new match for partner
          findNewMatchAfterDisconnect(partnerId);
        }
      }
      
      // CRITICAL: Reset user's previous matches if it's been a while since they were active
      // This prevents old history from interfering with new matches
      const now = Date.now();
      if (now - user.joinedAt > 30000) { // If inactive for 30+ seconds
        // Keep the most recent 3 matches to prevent immediate rematching
        const recentMatches = Array.from(user.previousMatches).slice(-3);
        user.previousMatches = new Set(recentMatches);
      }
      
      // IMPORTANT FIX: Check if any of this user's previous matches are currently in an active connection
      // This is to prevent user B from reconnecting with user A who is already connected with user C
      let blockedUsers = new Set<string>();
      
      // Scan all users to identify those who should be blocked from matching
      for (const [otherId, otherUser] of users.entries()) {
        // Skip if it's the current user
        if (otherId === userId) continue;
        
        // If another user is in matched state, check if they're matched with someone this user has matched with before
        if (otherUser.state === 'matched' && otherUser.matchedWith) {
          // If the user previously matched with this person, block them
          if (user.previousMatches.has(otherId)) {
            blockedUsers.add(otherId);
            console.log(`🔒 [${userId}] Blocking reconnection with ${otherId} who is already matched`);
          }
          
          // ALSO, if the user previously matched with the partner of this person, block the partner
          if (user.previousMatches.has(otherUser.matchedWith)) {
            blockedUsers.add(otherUser.matchedWith);
            console.log(`🔒 [${userId}] Blocking reconnection with ${otherUser.matchedWith} who is already in a match`);
          }
        }
      }
      
      // Store blocked users to prevent incorrect matching
      user.blockedUsers = blockedUsers;
      
      // Add cooldown - when a user disconnects from a match, they should wait a short
      // period before being eligible for matching
      user.joinedAt = Date.now();
      
      // CRITICAL CHANGE: Set user state to waiting before adding to queue
      user.state = 'waiting';
      
      // Put user in waiting queue
      addToWaitingQueue(userId);
      
      // Debug logging
      console.log(`⏳ [${userId}] Added to waiting queue, current queue size: ${waitingQueue.length}`);
      
      // FIXED: Double-check the user is NOT already in a match
      if (!user.matchedWith) {
        // Immediately notify user they're waiting for a peer
        socket.emit('waiting-for-peer');
        logEmittedEvent('waiting-for-peer', userId);
        console.log(`⏳ [${userId}] Sent waiting-for-peer event`);
      } else {
        console.log(`⚠️ [${userId}] Not sending waiting-for-peer because user is matched with ${user.matchedWith}`);
      }
      
      // Process the waiting queue to try to find a match
      processWaitingQueue();
      
      logState();
    });
    
    // Handle user skipping current match
    socket.on('skip', () => {
      console.log(`⏩ [${userId}] Skipping current match`);
      
      const user = users.get(userId);
      if (!user) return; // Safety check
      
      // Only handle if user is matched
      if (user.state === 'matched' && user.matchedWith) {
        // Leave all rooms except own socket ID room
        for (const room of socket.rooms) {
          if (room !== userId) {
            socket.leave(room);
            console.log(`🧹 User ${userId} left room ${room} due to skip`);
          }
        }
        
        // Get partner
        const partnerId = user.matchedWith;
        const partner = users.get(partnerId);
        
        if (partner) {
          // CRITICAL FIX: Add a significantly stronger skip prevention
          // When a user skips, they shouldn't be matched with this user for a longer period
          // Add to recent skips with current timestamp
          user.recentSkips.set(partnerId, Date.now());
          
          // Also, if partner exists, add this user to their recent skips
          if (partner.recentSkips) {
            partner.recentSkips.set(userId, Date.now());
          }
          
          console.log(`🚫 [${userId}] Added ${partnerId} to recent skips`);
          
          // Notify partner
          socket.to(partnerId).emit('peer-skipped');
          
          // Find new match for partner
          findNewMatchAfterDisconnect(partnerId);
        }
        
        // Reset user to waiting
        user.state = 'waiting';
        user.matchedWith = null;
        
        // When user skips, they should be placed at the end of the queue
        // This prevents them from immediately being rematched with the same user
        user.joinedAt = Date.now();
        addToWaitingQueue(userId);
        
        // Try to find a new match for this user
        processWaitingQueue();
        
        // If still waiting, notify user
        if (user.state === 'waiting') {
          socket.emit('waiting-for-peer');
        }
      }
      
      logState();
    });
    
    // Handle user stopping search
    socket.on('stop-search', () => {
      console.log(`⛔ [${userId}] Stopping search`);
      
      const user = users.get(userId);
      if (!user) return; // Safety check
      
      // If user was matched, handle partner
      if (user.state === 'matched' && user.matchedWith) {
        // Leave all rooms except own socket ID room
        for (const room of socket.rooms) {
          if (room !== userId) {
            socket.leave(room);
            console.log(`🧹 User ${userId} left room ${room} due to stop-search`);
          }
        }
        
        const partnerId = user.matchedWith;
        const partner = users.get(partnerId);
        
        // CRITICAL FIX: Explicitly reset THIS USER'S state first
        // This ensures they are no longer matched with anyone
        user.state = 'waiting';
        user.matchedWith = null;
        
        if (partner) {
          // Make sure partner is not matched with this user anymore
          if (partner.matchedWith === userId) {
            // Reset partner's state properly
            partner.state = 'waiting';
            partner.matchedWith = null;
            
            // Notify partner
            socket.to(partnerId).emit('peer-disconnected');
            
            // Add partner to waiting queue (if not already there)
            addToWaitingQueue(partnerId);
            
            console.log(`🔄 [${userId}] Ended chat, reset partner ${partnerId} to waiting state`);
            
            // Find new match for partner
            findNewMatchAfterDisconnect(partnerId);
          }
        }
      }
      
      // Remove user from waiting queue (just in case they're there)
      removeFromWaitingQueue(userId);
      
      // IMPORTANT: When a user clicks "end chat", they return to the lobby
      // and should not be automatically placed in the waiting queue
      // So we DON'T add them to the waiting queue here
      
      // Process waiting queue immediately to match any waiting users
      setTimeout(processWaitingQueue, 100);
      
      logState();
    });
    
    // Handle WebRTC signaling with enhanced security
    socket.on('signal', (data) => {
      // Verify user exists and is in matched state
      const user = users.get(userId);
      if (!user || user.state !== 'matched' || !user.matchedWith) {
        console.log(`⚠️ [${userId}] Unauthorized signal attempt - user not in matched state`);
        // Notify the user they need to reconnect - their connection state is invalid
        socket.emit('connection-error', { message: 'Connection error - please reconnect' });
        return;
      }
      
      // Verify the roomId matches the expected pattern for this user
      if (!data.roomId || typeof data.roomId !== 'string') {
        console.log(`⚠️ [${userId}] Invalid roomId in signal`);
        return;
      }
      
      // Get partner user
      const partnerId = user.matchedWith;
      const partner = users.get(partnerId);
      
      // Additional safety: Verify that partner is also matched with this user (bidirectional check)
      if (!partner || partner.state !== 'matched' || partner.matchedWith !== userId) {
        console.log(`⚠️ [${userId}] Partner mismatch in signal - partner isn't matched back`);
        
        // Connection state is inconsistent - reset both users
        socket.emit('connection-error', { message: 'Connection error - please reconnect' });
        if (partner) {
          io.to(partnerId).emit('connection-error', { message: 'Connection error - please reconnect' });
        }
        
        // Reset user state
        user.state = 'waiting';
        user.matchedWith = null;
        addToWaitingQueue(userId);
        
        // Reset partner state if it exists
        if (partner) {
          partner.state = 'waiting';
          partner.matchedWith = null;
          addToWaitingQueue(partnerId);
        }
        
        return;
      }
      
      // Forward signal to partner
      socket.to(partnerId).emit('signal', data);
    });
    
    // Handle match acknowledgment
    socket.on('match-ready', (data) => {
      console.log(`✅ [${userId}] Acknowledged match ${data.matchId}`);
      // No additional action needed in this simplified model
    });
    
    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`❌ [${userId}] Disconnected`);
      cleanupUser(userId);
      logState();
    });
  });
}