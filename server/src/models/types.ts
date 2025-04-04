/**
 * Types for the WebRTC signaling and chat application
 */

/**
 * Possible states for a user in the system
 */
export type UserState = 'idle' | 'waiting' | 'matched';

/**
 * User data in the system
 */
export interface User {
  /** Unique user identifier (socket ID) */
  id: string;
  /** Current state of the user */
  state: UserState;
  /** Timestamp when user joined the system */
  joinedAt: number;
  /** ID of the user they are matched with, or null if not matched */
  matchedWith: string | null;
  /** Set of previous matches to avoid quick rematching */
  previousMatches: Set<string>;
  /** Temporarily blocked users to prevent disrupting existing connections */
  blockedUsers?: Set<string>;
  /** Map of recently skipped users with timestamps to prevent immediate rematching */
  recentSkips: Map<string, number>;
}

/**
 * WebRTC signaling data
 */
export interface SignalData {
  /** Type of signal being sent */
  type: 'offer' | 'answer' | 'candidate';
  /** WebRTC session description or ICE candidate */
  payload: RTCSessionDescriptionInit | RTCIceCandidateInit;
  /** Unique room identifier for this communication */
  roomId: string;
}

/**
 * Match ready event data
 */
export interface MatchReadyEvent {
  /** Unique room identifier */
  roomId: string;
  /** Whether this peer is the initiator of the WebRTC connection */
  isInitiator: boolean;
  /** ID of the peer they are matched with */
  peerId: string;
  /** Whether this match was forced due to limited options */
  forced: boolean;
}

/**
 * Connection error event data
 */
export interface ConnectionErrorEvent {
  /** Error message */
  message: string;
  /** Error code, if applicable */
  code?: number;
}

/**
 * System statistics for monitoring
 */
export interface SystemStats {
  /** Timestamp of the stats collection */
  timestamp: string;
  /** CPU metrics */
  cpu: {
    /** CPU load average */
    loadavg: number;
    /** Number of CPU cores */
    cpus: number;
  };
  /** Memory metrics */
  memory: {
    /** Free memory in MB */
    free: number;
    /** Total memory in MB */
    total: number;
    /** Percentage of used memory */
    usedPercent: number;
  };
  /** Connection metrics */
  connections: {
    /** Number of connected clients */
    clients: number;
    /** Number of active rooms */
    rooms: number;
    /** Detailed room statistics */
    roomDetails: RoomStats;
  };
}

/**
 * Room statistics for monitoring
 */
export interface RoomStats {
  /** Total number of rooms */
  total: number;
  /** Number of user rooms (socket ID rooms) */
  userRooms: number;
  /** Number of active chat rooms with matched users */
  chatRooms: number;
  /** Number of abandoned rooms that need cleanup */
  abandonedRooms: number;
  /** Number of other/unknown purpose rooms */
  otherRooms: number;
} 