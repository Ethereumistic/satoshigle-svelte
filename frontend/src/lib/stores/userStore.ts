import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { nostrService } from '$lib/services/nostrService';
import type { NostrProfile } from '$lib/types/nostr';

// Define user store types
export interface UserState {
  isLoggedIn: boolean;
  pubkey: string | null;
  npub: string | null;
  profile: NostrProfile | null;
  isLoading: boolean;
  error: string | null;
}

// Initial state
const initialState: UserState = {
  isLoggedIn: false,
  pubkey: null,
  npub: null,
  profile: null,
  isLoading: false,
  error: null
};

// Create the store
function createUserStore() {
  const { subscribe, set, update } = writable<UserState>(initialState);

  return {
    subscribe,
    
    // Initialize the store - check for existing session
    init: async () => {
      if (!browser) return;
      
      update(state => ({ ...state, isLoading: true }));
      
      try {
        // Check if we have a stored pubkey
        const storedPubkey = localStorage.getItem('nostr:pubkey');
        
        if (storedPubkey) {
          console.log('Found stored pubkey, fetching profile...');
          
          try {
            // Try to get the profile for this pubkey
            const profile = await nostrService.getProfile(storedPubkey);
            const npub = nostrService.hexToNpub(storedPubkey);
            
            console.log('Profile fetched successfully:', profile);
            
            set({
              isLoggedIn: true,
              pubkey: storedPubkey,
              npub,
              profile,
              isLoading: false,
              error: null
            });
          } catch (profileError) {
            console.error('Error fetching profile during init:', profileError);
            
            // Still set the user as logged in, but with a default profile
            const npub = nostrService.hexToNpub(storedPubkey);
            
            set({
              isLoggedIn: true,
              pubkey: storedPubkey,
              npub,
              profile: {
                displayName: 'Anonymous',
                name: '',
                about: '',
                picture: '',
                banner: '',
                website: '',
                nip05: '',
                lud16: '',
              },
              isLoading: false,
              error: 'Could not fetch profile information. Please try refreshing.'
            });
            
            // Try again after a delay
            setTimeout(() => userStore.updateProfile(), 3000);
          }
        } else {
          console.log('No stored pubkey found, setting default state');
          set({ ...initialState, isLoading: false });
        }
      } catch (error) {
        console.error('Error initializing user store:', error);
        set({ 
          ...initialState, 
          isLoading: false, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    },
    
    // Login with Nostr
    login: async () => {
      update(state => ({ ...state, isLoading: true, error: null }));
      
      try {
        const result = await nostrService.login();
        
        if (result.pubkey) {
          // Store the pubkey for future sessions
          if (browser) {
            localStorage.setItem('nostr:pubkey', result.pubkey);
          }
          
          const npub = nostrService.hexToNpub(result.pubkey);
          console.log('Login successful, setting profile:', result.profile);
          
          // Make sure we have all profile fields
          const profile = result.profile || {
            displayName: 'Anonymous',
            name: '',
            about: '',
            picture: '',
            banner: '',
            website: '',
            nip05: '',
            lud16: '',
          };
          
          update(state => ({
            ...state,
            isLoggedIn: true,
            pubkey: result.pubkey,
            npub,
            profile,
            isLoading: false
          }));
          
          // Trigger a profile update after a short delay to ensure all relays are connected
          setTimeout(() => userStore.updateProfile(), 2000);
          
          return true;
        } else {
          throw new Error('Login failed');
        }
      } catch (error) {
        console.error('Login error:', error);
        update(state => ({ 
          ...state, 
          isLoading: false, 
          error: error instanceof Error ? error.message : 'Login failed' 
        }));
        return false;
      }
    },
    
    // Logout
    logout: () => {
      if (browser) {
        localStorage.removeItem('nostr:pubkey');
      }
      
      nostrService.logout();
      set(initialState);
    },
    
    // Update profile
    updateProfile: async () => {
      if (!browser) return;
      
      update(state => ({ ...state, isLoading: true }));
      
      try {
        const pubkey = localStorage.getItem('nostr:pubkey');
        if (!pubkey) {
          throw new Error('No pubkey found');
        }
        
        console.log('Updating profile for pubkey:', pubkey);
        
        // Fetch profile with a more robust approach
        const profile = await nostrService.getProfile(pubkey);
        const npub = nostrService.hexToNpub(pubkey);
        
        console.log('Profile update received:', profile);
        
        // Make sure all required fields are present
        const updatedProfile = {
          displayName: profile.displayName || 'Anonymous',
          name: profile.name || '',
          about: profile.about || '',
          picture: profile.picture || '',
          banner: profile.banner || '',
          website: profile.website || '',
          nip05: profile.nip05 || '',
          lud16: profile.lud16 || '',
        };
        
        update(state => ({
          ...state,
          profile: updatedProfile,
          npub,
          isLoading: false
        }));
        
        return updatedProfile;
      } catch (error) {
        console.error('Error updating profile:', error);
        update(state => ({ 
          ...state, 
          isLoading: false, 
          error: error instanceof Error ? error.message : 'Failed to update profile' 
        }));
        return null;
      }
    }
  };
}

export const userStore = createUserStore();

// Initialize the store when the app loads (in a browser environment)
if (browser) {
  // Only check for existing session, don't initialize Nostr yet
  userStore.init();
}