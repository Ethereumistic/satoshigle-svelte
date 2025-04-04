/**
 * User Manager Service
 * Manages user state, tracking, and operations
 */
import type { User, UserState } from '../models/types';
import logger from '../utils/logger';
import { EventEmitter } from 'events';

export class UserManager extends EventEmitter {
  /** Map of users by ID */
  private users: Map<string, User> = new Map();
  /** Waiting queue ordered by join time */
  private waitingQueue: string[] = [];
  /** Time in ms to prevent immediate rematching after a skip */
  private readonly SKIP_PREVENTION_TIME: number = 60000;

  constructor() {
    super();
    logger.info('UserManager initialized');
  }

  /**
   * Add a new user to the system
   * @param userId Unique user ID (usually socket ID)
   * @returns The created user
   */
  public addUser(userId: string): User {
    if (this.users.has(userId)) {
      logger.warn('Attempted to add user that already exists', { userId });
      return this.users.get(userId)!;
    }

    const user: User = {
      id: userId,
      state: 'idle',
      joinedAt: Date.now(),
      matchedWith: null,
      previousMatches: new Set(),
      blockedUsers: new Set(),
      recentSkips: new Map()
    };

    this.users.set(userId, user);
    logger.debug('User added', { userId });
    this.emit('user:added', user);
    return user;
  }

  /**
   * Remove a user from the system
   * @param userId User ID to remove
   * @returns true if removed, false if not found
   */
  public removeUser(userId: string): boolean {
    const user = this.users.get(userId);
    if (!user) {
      logger.warn('Attempted to remove non-existent user', { userId });
      return false;
    }

    // First remove from waiting queue if present
    this.removeFromWaitingQueue(userId);

    // If user was matched, handle the partner
    if (user.state === 'matched' && user.matchedWith) {
      const partnerId = user.matchedWith;
      const partner = this.users.get(partnerId);
      
      if (partner && partner.matchedWith === userId) {
        // Update partner state
        partner.state = 'waiting';
        partner.matchedWith = null;
        
        // Emit event for disconnection
        this.emit('user:disconnected', { userId, partnerId });
        
        // Add partner back to waiting
        this.addToWaitingQueue(partnerId);
        
        // Process waiting queue to find new matches
        setTimeout(() => this.processWaitingQueue(), 100);
      }
    }

    // Finally remove the user
    this.users.delete(userId);
    logger.debug('User removed', { userId });
    this.emit('user:removed', userId);
    return true;
  }

  /**
   * Update a user's state
   * @param userId User ID to update
   * @param state New state
   * @returns The updated user or null if not found
   */
  public updateUserState(userId: string, state: UserState): User | null {
    const user = this.users.get(userId);
    if (!user) {
      logger.warn('Attempted to update state of non-existent user', { userId, state });
      return null;
    }

    // Handle state transition side effects
    if (user.state !== state) {
      // If moving from matched to another state, handle partner
      if (user.state === 'matched' && user.matchedWith) {
        const partnerId = user.matchedWith;
        const partner = this.users.get(partnerId);
        
        if (partner && partner.matchedWith === userId) {
          // Update partner state
          partner.state = 'waiting';
          partner.matchedWith = null;
          
          // Emit event for disconnection
          this.emit('user:disconnected', { userId, partnerId });
          
          // Add partner back to waiting if they're not the ones skipping
          if (state !== 'matched') {
            this.addToWaitingQueue(partnerId);
          }
        }
      }

      // Update the state
      const previousState = user.state;
      user.state = state;
      
      // If moving to waiting, add to queue
      if (state === 'waiting') {
        user.matchedWith = null;
        this.addToWaitingQueue(userId);
      } 
      // If moving out of waiting, remove from queue
      else if (previousState === 'waiting') {
        this.removeFromWaitingQueue(userId);
      }

      // Emit state change event
      this.emit('user:stateChanged', { 
        userId, 
        previousState, 
        newState: state 
      });
      
      logger.debug('User state updated', { 
        userId, 
        previousState, 
        newState: state 
      });
    }

    return user;
  }

  /**
   * Add a user to the waiting queue
   * @param userId User ID to add to waiting queue
   * @returns true if added, false if already in queue or user not found
   */
  public addToWaitingQueue(userId: string): boolean {
    const user = this.users.get(userId);
    if (!user) {
      logger.warn('Attempted to add non-existent user to waiting queue', { userId });
      return false;
    }

    // First remove if already in queue (shouldn't happen, but safety check)
    this.removeFromWaitingQueue(userId);
    
    // Then add to end
    this.waitingQueue.push(userId);
    
    // Update user state
    user.state = 'waiting';
    user.matchedWith = null;
    
    logger.debug('User added to waiting queue', { 
      userId, 
      queuePosition: this.waitingQueue.length - 1,
      queueSize: this.waitingQueue.length
    });
    
    this.emit('queue:userAdded', { 
      userId, 
      queueSize: this.waitingQueue.length 
    });
    
    return true;
  }

  /**
   * Remove a user from the waiting queue
   * @param userId User ID to remove from queue
   * @returns true if removed, false if not in queue
   */
  public removeFromWaitingQueue(userId: string): boolean {
    const index = this.waitingQueue.indexOf(userId);
    if (index !== -1) {
      this.waitingQueue.splice(index, 1);
      
      logger.debug('User removed from waiting queue', { 
        userId, 
        queueSize: this.waitingQueue.length 
      });
      
      this.emit('queue:userRemoved', { 
        userId, 
        queueSize: this.waitingQueue.length 
      });
      
      return true;
    }
    return false;
  }

  /**
   * Create a match between two users
   * @param user1Id First user ID
   * @param user2Id Second user ID
   * @returns Room ID if matched successfully, null otherwise
   */
  public createMatch(user1Id: string, user2Id: string): string | null {
    const user1 = this.users.get(user1Id);
    const user2 = this.users.get(user2Id);
    
    // Detailed logging of matching information
    logger.info('Attempting to create match', { 
      user1Id, 
      user2Id,
      user1State: user1?.state,
      user2State: user2?.state,
      user1Matched: user1?.matchedWith,
      user2Matched: user2?.matchedWith
    });
    
    if (!user1 || !user2) {
      logger.warn('Cannot create match - one or both users don\'t exist', { user1Id, user2Id });
      return null;
    }
    
    // CRITICAL: Final validation before match creation
    // Check if either user is already matched with someone else
    if (user1.state === 'matched' && user1.matchedWith !== null && user1.matchedWith !== user2Id) {
      const partner = this.users.get(user1.matchedWith);
      // Only if partner is valid and actually matched with this user (bidirectional)
      if (partner && partner.state === 'matched' && partner.matchedWith === user1Id) {
        logger.warn('Protected: Prevented match creation that would break existing connection', { 
          user1Id, 
          existingMatch: user1.matchedWith 
        });
        return null;
      }
    }
    
    if (user2.state === 'matched' && user2.matchedWith !== null && user2.matchedWith !== user1Id) {
      const partner = this.users.get(user2.matchedWith);
      // Only if partner is valid and actually matched with this user (bidirectional)
      if (partner && partner.state === 'matched' && partner.matchedWith === user2Id) {
        logger.warn('Protected: Prevented match creation that would break existing connection', { 
          user2Id, 
          existingMatch: user2.matchedWith 
        });
        return null;
      }
    }
    
    // Check for inconsistent state across ALL users
    for (const [otherId, otherUser] of this.users.entries()) {
      // Skip the two users we're trying to match
      if (otherId === user1Id || otherId === user2Id) continue;
      
      // Check if any other user thinks they're matched with either of our users
      if (otherUser.state === 'matched') {
        if (otherUser.matchedWith === user1Id) {
          logger.warn('Protected: User is already matched with someone else', { 
            user1Id, 
            otherMatchId: otherId 
          });
          return null;
        }
        
        if (otherUser.matchedWith === user2Id) {
          logger.warn('Protected: User is already matched with someone else', { 
            user2Id, 
            otherMatchId: otherId 
          });
          return null;
        }
      }
    }
    
    // Create a unique room ID
    const roomId = `room_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    
    // Setup user states
    user1.state = 'matched';
    user1.matchedWith = user2Id;
    user1.previousMatches.add(user2Id);
    
    user2.state = 'matched';
    user2.matchedWith = user1Id;
    user2.previousMatches.add(user1Id);
    
    // Remove both from waiting queue
    this.removeFromWaitingQueue(user1Id);
    this.removeFromWaitingQueue(user2Id);
    
    // Determine initiator (first user is the initiator)
    const user1JoinedFirst = user1.joinedAt <= user2.joinedAt;
    
    logger.info('Created match between users', { 
      user1Id, 
      user2Id, 
      roomId,
      user1Initiator: user1JoinedFirst,
      user2Initiator: !user1JoinedFirst
    });
    
    // Emit match event
    this.emit('match:created', {
      roomId,
      user1: {
        id: user1Id,
        isInitiator: user1JoinedFirst,
      },
      user2: {
        id: user2Id,
        isInitiator: !user1JoinedFirst,
      }
    });
    
    return roomId;
  }

  /**
   * Handle a user skipping their current match
   * @param userId User ID that is skipping
   * @returns true if skip was handled, false if user not found or not matched
   */
  public handleSkip(userId: string): boolean {
    const user = this.users.get(userId);
    if (!user) {
      logger.warn('Skip attempted for non-existent user', { userId });
      return false;
    }
    
    // Only handle if user is matched
    if (user.state !== 'matched' || !user.matchedWith) {
      logger.warn('Skip attempted but user is not in matched state', { 
        userId, 
        state: user.state 
      });
      return false;
    }
    
    const partnerId = user.matchedWith;
    const partner = this.users.get(partnerId);
    
    if (partner) {
      // Add to recent skips with current timestamp
      user.recentSkips.set(partnerId, Date.now());
      
      // Also add this user to partner's recent skips
      if (partner.recentSkips) {
        partner.recentSkips.set(userId, Date.now());
      }
      
      logger.debug('Added to recent skips', { userId, partnerId });
      
      // Reset partner state and find new match
      partner.state = 'waiting';
      partner.matchedWith = null;
      this.addToWaitingQueue(partnerId);
      
      // Emit skip event
      this.emit('match:skipped', { userId, partnerId });
    }
    
    // Reset user to waiting
    user.state = 'waiting';
    user.matchedWith = null;
    
    // When user skips, they should be placed at the end of the queue
    user.joinedAt = Date.now();
    this.addToWaitingQueue(userId);
    
    return true;
  }

  /**
   * Check if a user can be matched with another user
   * @param userId First user ID
   * @param candidateId Second user ID to check
   * @returns true if they can be matched, false otherwise
   */
  public canMatch(userId: string, candidateId: string): boolean {
    const user = this.users.get(userId);
    const candidate = this.users.get(candidateId);
    
    if (!user || !candidate) {
      return false;
    }
    
    // Must be in waiting state
    if (user.state !== 'waiting' || candidate.state !== 'waiting') {
      return false;
    }
    
    const now = Date.now();
    
    // Check for recent skips to prevent immediate rematching
    if (user.recentSkips && user.recentSkips.has(candidateId)) {
      const skipTime = user.recentSkips.get(candidateId)!;
      if (now - skipTime < this.SKIP_PREVENTION_TIME) {
        return false;
      }
    }
    
    // Also check the other direction
    if (candidate.recentSkips && candidate.recentSkips.has(userId)) {
      const skipTime = candidate.recentSkips.get(userId)!;
      if (now - skipTime < this.SKIP_PREVENTION_TIME) {
        return false;
      }
    }
    
    // Check if this user is blocked
    if (user.blockedUsers && user.blockedUsers.has(candidateId)) {
      return false;
    }
    
    // Also check if other user has blocked this user
    if (candidate.blockedUsers && candidate.blockedUsers.has(userId)) {
      return false;
    }
    
    // Check if either user was recently matched with someone else
    if (candidate.matchedWith) return false;
    
    return true;
  }

  /**
   * Try to find a match for a user
   * @param userId User ID to find a match for
   * @returns Room ID if matched, null if no match found
   */
  public findMatchForUser(userId: string): string | null {
    const user = this.users.get(userId);
    if (!user) {
      logger.warn('Cannot find match for non-existent user', { userId });
      return null;
    }
    
    // Skip if there are no other waiting users
    if (this.waitingQueue.length <= 1) {
      logger.debug('Not enough users in waiting queue for matching', {
        userId,
        queueSize: this.waitingQueue.length
      });
      return null;
    }
    
    // Find all other waiting users, sorted by join time
    const otherWaitingUsers = this.waitingQueue
      .filter(id => id !== userId) // Not self
      .map(id => this.users.get(id)!)
      .filter(other => this.canMatch(userId, other.id));
      
    if (otherWaitingUsers.length === 0) {
      logger.debug('No eligible matches found', { userId });
      return null;
    }
    
    // Sort by join time (oldest first)
    otherWaitingUsers.sort((a, b) => a.joinedAt - b.joinedAt);
    
    // IMPROVED MATCHING PRIORITY:
    // 1. First try to find users who have NEVER matched before
    let bestMatch = otherWaitingUsers.find(other => 
      !user.previousMatches.has(other.id) && 
      !other.previousMatches.has(userId)
    );
    
    // 2. Then try users who are not in the recent match history (one-directional)
    if (!bestMatch) {
      bestMatch = otherWaitingUsers.find(other => !user.previousMatches.has(other.id));
    }
    
    // 3. Finally, if needed, pick the longest-waiting user
    if (!bestMatch && otherWaitingUsers.length > 0) {
      bestMatch = otherWaitingUsers[0];
      logger.debug('Matching with previously matched user due to lack of alternatives', {
        userId,
        matchId: bestMatch.id
      });
    }
    
    if (bestMatch) {
      return this.createMatch(userId, bestMatch.id);
    }
    
    return null;
  }

  /**
   * Process the waiting queue to match users
   * @returns Number of matches made
   */
  public processWaitingQueue(): number {
    // Skip if there are fewer than 2 users waiting
    if (this.waitingQueue.length < 2) {
      logger.debug('Not enough users waiting, skipping queue processing', {
        queueSize: this.waitingQueue.length
      });
      
      return 0;
    }
    
    logger.debug('Processing waiting queue', {
      queueSize: this.waitingQueue.length,
      waitingUsers: this.waitingQueue.join(', ')
    });
    
    // CRITICAL FIX: First, verify the waiting queue is consistent with user states
    const validatedQueue = this.waitingQueue.filter(userId => {
      const user = this.users.get(userId);
      
      // User must exist and be in waiting state
      if (!user || user.state !== 'waiting') {
        logger.warn('Inconsistent state: User is in waiting queue but has wrong state', {
          userId,
          state: user?.state || 'undefined'
        });
        
        // Remove from queue if not in waiting state
        this.removeFromWaitingQueue(userId);
        return false;
      }
      
      // Check if user is matched with anyone
      if (user.matchedWith !== null) {
        logger.warn('Inconsistent state: User is in waiting queue but matched with someone', {
          userId,
          matchedWith: user.matchedWith
        });
        
        // Remove from queue if matched
        this.removeFromWaitingQueue(userId);
        return false;
      }
      
      return true;
    });
    
    // If we don't have enough users after validation, stop
    if (validatedQueue.length < 2) {
      logger.warn('Not enough valid users in waiting queue after validation', {
        validQueueSize: validatedQueue.length,
        originalQueueSize: this.waitingQueue.length
      });
      return 0;
    }
    
    // Clone the queue to avoid modification during iteration
    const queueCopy = [...validatedQueue];
    
    // Try to match users in order of waiting time
    let matchesMade = 0;
    
    for (let i = 0; i < queueCopy.length; i++) {
      const userId = queueCopy[i];
      const user = this.users.get(userId);
      
      // Skip users who are no longer waiting (might have been matched in a previous iteration)
      if (!user || user.state !== 'waiting') continue;
      
      // Double check this user is not matched with anyone
      if (user.matchedWith !== null) {
        logger.warn('User has inconsistent state - in waiting queue but matched with someone', {
          userId,
          matchedWith: user.matchedWith
        });
        continue;
      }
      
      // Try to match this user
      logger.debug('Attempting to find match', { userId });
      const roomId = this.findMatchForUser(userId);
      
      if (roomId) {
        matchesMade++;
        logger.info('Match found', { userId, roomId });
      } else {
        logger.debug('No match found', { userId });
      }
    }
    
    logger.info('Matching round complete', { matchesMade });
    
    // If no matches were made and we still have waiting users, try one more pass
    // with reduced restrictions (this helps when there are only 2 users left and they've matched before)
    if (matchesMade === 0 && this.waitingQueue.length >= 2) {
      logger.debug('No matches made, trying with relaxed restrictions');
      
      // Force match between the two longest-waiting users if needed
      const oldestUsers = [...this.waitingQueue]
        .map(id => this.users.get(id))
        .filter((user): user is User => user !== undefined && user !== null)
        .filter(user => user.state === 'waiting' && user.matchedWith === null) // Extra validation
        .sort((a, b) => a.joinedAt - b.joinedAt);
      
      if (oldestUsers.length >= 2) {
        this.createMatch(oldestUsers[0].id, oldestUsers[1].id);
        matchesMade++;
      }
    }
    
    return matchesMade;
  }

  /**
   * Get all users
   * @returns Map of all users
   */
  public getAllUsers(): Map<string, User> {
    return new Map(this.users);
  }

  /**
   * Get a specific user
   * @param userId User ID to retrieve
   * @returns User or undefined if not found
   */
  public getUser(userId: string): User | undefined {
    return this.users.get(userId);
  }

  /**
   * Get the waiting queue
   * @returns Array of user IDs in waiting queue
   */
  public getWaitingQueue(): string[] {
    return [...this.waitingQueue];
  }

  /**
   * Get waiting queue size
   * @returns Number of users in waiting queue
   */
  public getWaitingQueueSize(): number {
    return this.waitingQueue.length;
  }

  /**
   * Get total number of users
   * @returns Total number of users
   */
  public getUserCount(): number {
    return this.users.size;
  }
} 