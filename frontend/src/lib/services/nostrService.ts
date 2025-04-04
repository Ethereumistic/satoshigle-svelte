import NDK, { NDKEvent, NDKNip07Signer, NDKUser } from '@nostr-dev-kit/ndk';
import { nip19 } from 'nostr-tools';
import type { NostrProfile } from '$lib/types/nostr';
import { browser } from '$app/environment';

class NostrService {
  private ndk: NDK | null = null;
  private signer: NDKNip07Signer | null = null;
  private initialized = false;
  
  constructor() {
    // Don't initialize automatically
  }
  
  // Convert hex pubkey to npub format
  public hexToNpub(hex: string): string {
    try {
      return nip19.npubEncode(hex);
    } catch (error) {
      console.error('Error converting hex to npub:', error);
      return hex;
    }
  }
  
  // Convert npub to hex format
  public npubToHex(npub: string): string {
    try {
      const { data } = nip19.decode(npub);
      return data as string;
    } catch (error) {
      console.error('Error converting npub to hex:', error);
      return npub;
    }
  }
  
  private async initialize() {
    if (!browser) return;
    
    // If already initialized, don't initialize again
    if (this.initialized && this.ndk) return;
    
    console.log('Initializing NDK...');
    
    try {
      // Create a new NDK instance with NIP-07 signer
      try {
        this.signer = new NDKNip07Signer();
        console.log('NIP-07 signer created');
      } catch (error) {
        console.error('Failed to create NIP-07 signer:', error);
        throw new Error('Failed to create NIP-07 signer. Please make sure you have a NOSTR extension installed.');
      }
      
      // Create NDK with signer and relays
      this.ndk = new NDK({
        explicitRelayUrls: [
          'wss://relay.damus.io',
          'wss://relay.nostr.band',
          'wss://nos.lol',
          'wss://relay.current.fyi',
          'wss://nostr.bitcoiner.social',
          'wss://relay.nostr.info'
        ],
        signer: this.signer
      });
      
      // Connect to relays
      try {
        await this.ndk.connect();
        console.log('NDK connected to relays');
        this.initialized = true;
      } catch (error) {
        console.error('Failed to connect NDK to relays:', error);
        // We'll still consider it initialized but warn about relay connection issues
        this.initialized = true;
        console.warn('NDK initialized but with relay connection issues');
      }
    } catch (error) {
      console.error('Failed to initialize NDK:', error);
      this.ndk = null;
      this.initialized = false;
      throw error;
    }
  }
  
  async login() {
    if (!browser) {
      throw new Error('Nostr is only available in browser environment');
    }
    
    console.log('Starting Nostr login process...');
    
    // Initialize only when login is called
    if (!this.initialized || !this.ndk) {
      try {
        await this.initialize();
      } catch (error) {
        console.error('Failed to initialize during login:', error);
        throw new Error('Failed to initialize Nostr. Please make sure you have a NOSTR extension installed (like Alby, nos2x, or Flamingo).');
      }
    }
    
    if (!this.ndk || !this.signer) {
      throw new Error('NDK not initialized. Please make sure you have a NOSTR extension installed.');
    }
    
    try {
      // Request user's public key using NIP-07
      console.log('Requesting user pubkey from extension...');
      let user;
      try {
        user = await this.signer.user();
      } catch (error) {
        console.error('Error getting user from signer:', error);
        throw new Error('Failed to get pubkey from extension. Please make sure your NOSTR extension is unlocked and grants permission.');
      }
      
      if (!user.pubkey) {
        throw new Error('No public key returned from extension. Please make sure your NOSTR extension is properly set up.');
      }
      
      console.log('Login successful, pubkey:', user.pubkey);
      
      // Wait a moment for relay connections to establish
      console.log('Waiting for relay connections to establish...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Get user profile with improved profile fetching
      console.log('Fetching user profile...');
      const profile = await this.getProfile(user.pubkey);
      console.log('Retrieved profile during login:', profile);
      
      return {
        pubkey: user.pubkey,
        profile
      };
    } catch (error) {
      console.error('Nostr login error:', error);
      throw new Error('Failed to login with Nostr: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }
  
  async getProfile(pubkey: string): Promise<NostrProfile> {
    if (!browser) {
      return this.getDefaultProfile();
    }
    
    // Initialize if needed
    if (!this.initialized) {
      try {
        await this.initialize();
      } catch (error) {
        console.error('Failed to initialize NDK during getProfile:', error);
        return this.getDefaultProfile();
      }
    }
    
    if (!this.ndk) {
      console.warn('NDK still not available after initialization');
      return this.getDefaultProfile();
    }
    
    try {
      console.log('Fetching profile for pubkey:', pubkey);
      
      // Method 1: Using NDKUser fetchProfile
      const user = new NDKUser({ pubkey });
      try {
        await user.fetchProfile();
        console.log('NDK Profile data:', user.profile);
      } catch (err) {
        console.warn('Error fetching profile using NDKUser:', err);
      }
      
      // Method 2: Directly fetch kind 0 events for the user
      // This is a more direct approach to get the metadata
      let profileContent: Record<string, any> = {};
      
      try {
        if (this.ndk) {
          const filter = { kinds: [0], authors: [pubkey], limit: 1 };
          const events = await this.ndk.fetchEvents(filter);
          
          let latestEvent: NDKEvent | null = null;
          
          // Find the most recent profile event
          for (const event of events) {
            if (!latestEvent || event.created_at > latestEvent.created_at) {
              latestEvent = event;
            }
          }
          
          // Parse profile content from the latest event
          if (latestEvent) {
            try {
              console.log('Latest metadata event:', latestEvent);
              profileContent = JSON.parse(latestEvent.content);
              console.log('Parsed profile content:', profileContent);
            } catch (e) {
              console.error('Error parsing profile content:', e);
            }
          }
        }
      } catch (err) {
        console.warn('Error fetching kind 0 events:', err);
      }
      
      // Helper to ensure string values
      const getString = (value: any): string => 
        value ? (typeof value === 'string' ? value : String(value)) : '';
      
      // Combine both methods for best results
      const combinedProfile = {
        // Try the direct event first, then fall back to NDK user profile
        displayName: getString(profileContent?.display_name || profileContent?.displayName || 
                    user.profile?.displayName || user.profile?.display_name || user.profile?.name) || 'Anonymous',
        name: getString(profileContent?.name || user.profile?.name),
        about: getString(profileContent?.about || profileContent?.description || 
                user.profile?.about || user.profile?.description),
        picture: getString(profileContent?.picture || profileContent?.image || profileContent?.avatar ||
                 user.profile?.image || user.profile?.picture || user.profile?.avatar),
        banner: getString(profileContent?.banner || profileContent?.background ||
                 user.profile?.banner || user.profile?.background),
        website: getString(profileContent?.website || profileContent?.url ||
                  user.profile?.website || user.profile?.url),
        nip05: getString(profileContent?.nip05 || user.profile?.nip05),
        lud16: getString(profileContent?.lud16 || profileContent?.lightning_address || 
                profileContent?.lightningAddress || user.profile?.lud16 || 
                user.profile?.lightning_address || user.profile?.lightningAddress),
      };
      
      console.log('Combined profile:', combinedProfile);
      return combinedProfile;
      
    } catch (error) {
      console.error('Error fetching profile:', error);
      return this.getDefaultProfile();
    }
  }
  
  private getDefaultProfile(): NostrProfile {
    return {
      displayName: '',
      name: '',
      about: '',
      picture: '',
      banner: '',
      website: '',
      nip05: '',
      lud16: '',
    };
  }
  
  async publishEvent(kind: number, content: string, tags: string[][] = []) {
    if (!browser) {
      throw new Error('Nostr is only available in browser environment');
    }
    
    // Initialize if needed
    if (!this.initialized) {
      await this.initialize();
    }
    
    if (!this.ndk || !this.signer) {
      throw new Error('NDK not initialized');
    }
    
    try {
      const event = new NDKEvent(this.ndk);
      event.kind = kind;
      event.content = content;
      event.tags = tags;
      
      await event.sign();
      await event.publish();
      
      return event.id;
    } catch (error) {
      console.error('Error publishing event:', error);
      throw error;
    }
  }
  
  logout() {
    // Clear the local state
    this.ndk = null;
    this.signer = null;
    this.initialized = false;
  }
}

// Export as a singleton instance
export const nostrService = new NostrService();