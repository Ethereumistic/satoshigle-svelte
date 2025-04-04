<script lang="ts">
    import { createEventDispatcher } from 'svelte';
    import { X, Save, User, Link, Zap, Globe, FileText } from 'lucide-svelte';
    import * as Dialog from '$lib/components/ui/dialog';
    import * as Tabs from '$lib/components/ui/tabs';
    import * as Avatar from '$lib/components/ui/avatar';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { Button } from '$lib/components/ui/button';
    import { Textarea } from '$lib/components/ui/textarea';
    import { userStore } from '$lib/stores/userStore';
    import { nostrService } from '$lib/services/nostrService';
    
    export let open = false;
    
    const dispatch = createEventDispatcher<{
      close: void;
    }>();
    
    let activeTab = "profile";
    
    // Form state
    let formProfile = {
      displayName: $userStore.profile?.displayName || '',
      name: $userStore.profile?.name || '',
      about: $userStore.profile?.about || '',
      picture: $userStore.profile?.picture || '',
      website: $userStore.profile?.website || '',
      nip05: $userStore.profile?.nip05 || '',
      lud16: $userStore.profile?.lud16 || ''
    };
    
    let isSaving = false;
    let saveError = '';
    
    // Update form when profile changes
    $: if ($userStore.profile) {
      formProfile = {
        displayName: $userStore.profile.displayName || '',
        name: $userStore.profile.name || '',
        about: $userStore.profile.about || '',
        picture: $userStore.profile.picture || '',
        website: $userStore.profile.website || '',
        nip05: $userStore.profile.nip05 || '',
        lud16: $userStore.profile.lud16 || ''
      };
    }
    
    async function saveProfile() {
      if (!$userStore.isLoggedIn) return;
      
      isSaving = true;
      saveError = '';
      
      try {
        // Create metadata content
        const metadata = {
          name: formProfile.name,
          display_name: formProfile.displayName,
          about: formProfile.about,
          picture: formProfile.picture,
          website: formProfile.website,
          nip05: formProfile.nip05,
          lud16: formProfile.lud16
        };
        
        // Publish metadata event (kind 0)
        await nostrService.publishEvent(0, JSON.stringify(metadata));
        
        // Update local profile
        await userStore.updateProfile();
        
        // Close modal after successful save
        setTimeout(() => {
          open = false;
          dispatch('close');
        }, 1000);
      } catch (error) {
        console.error('Error saving profile:', error);
        saveError = error instanceof Error ? error.message : 'Failed to save profile';
      } finally {
        isSaving = false;
      }
    }
    
    function handleClose() {
      open = false;
      dispatch('close');
    }
  </script>
  
  <Dialog.Root bind:open>
    <Dialog.Content class="sm:max-w-[600px] bg-gray-900 border-gray-800 text-gray-100">
      <Dialog.Header>
        <Dialog.Title>Settings</Dialog.Title>
        <Dialog.Description>
          Manage your profile and application settings
        </Dialog.Description>
      </Dialog.Header>
      
      <Tabs.Root value={activeTab} onValueChange={(val: string) => activeTab = val} class="w-full">
        <Tabs.List class="grid grid-cols-2 mb-6">
          <Tabs.Trigger value="profile" class="data-[state=active]:bg-gray-800 data-[state=active]:text-yellow-400">
            <User class="h-4 w-4 mr-2" />
            Profile
          </Tabs.Trigger>
          <Tabs.Trigger value="app" class="data-[state=active]:bg-gray-800 data-[state=active]:text-yellow-400">
            <Zap class="h-4 w-4 mr-2" />
            App Settings
          </Tabs.Trigger>
        </Tabs.List>
        
        <Tabs.Content value="profile" class="space-y-4">
          {#if $userStore.isLoggedIn}
            <div class="flex items-center gap-4 mb-6">
              <Avatar.Root class="h-16 w-16">
                {#if formProfile.picture}
                  <Avatar.Image src={formProfile.picture} alt={formProfile.displayName} />
                {:else}
                  <Avatar.Fallback class="bg-yellow-500/10 text-yellow-400 text-xl">
                    {(formProfile.displayName || 'A').charAt(0)}
                  </Avatar.Fallback>
                {/if}
              </Avatar.Root>
              
              <div>
                <h3 class="text-lg font-medium">{formProfile.displayName || 'Anonymous'}</h3>
                <p class="text-sm text-gray-400">{$userStore.npub || ''}</p>
              </div>
            </div>
            
            <div class="grid gap-4">
              <div class="grid grid-cols-2 gap-4">
                <div class="space-y-2">
                  <Label for="displayName">Display Name</Label>
                  <Input 
                    id="displayName" 
                    bind:value={formProfile.displayName} 
                    placeholder="Display Name"
                    class="bg-gray-800 border-gray-700 text-gray-100"
                  />
                </div>
                
                <div class="space-y-2">
                  <Label for="name">Username</Label>
                  <Input 
                    id="name" 
                    bind:value={formProfile.name} 
                    placeholder="Username"
                    class="bg-gray-800 border-gray-700 text-gray-100"
                  />
                </div>
              </div>
              
              <div class="space-y-2">
                <Label for="about">About</Label>
                <Textarea 
                  id="about" 
                  bind:value={formProfile.about} 
                  placeholder="Tell us about yourself"
                  class="bg-gray-800 border-gray-700 text-gray-100 min-h-[80px]"
                />
              </div>
              
              <div class="space-y-2">
                <Label for="picture">Profile Picture URL</Label>
                <Input 
                  id="picture" 
                  bind:value={formProfile.picture} 
                  placeholder="https://example.com/avatar.jpg"
                  class="bg-gray-800 border-gray-700 text-gray-100"
                />
              </div>
              
              <div class="grid grid-cols-2 gap-4">
                <div class="space-y-2">
                  <Label for="website">
                    <Globe class="h-3.5 w-3.5 inline-block mr-1" />
                    Website
                  </Label>
                  <Input 
                    id="website" 
                    bind:value={formProfile.website} 
                    placeholder="https://yourwebsite.com"
                    class="bg-gray-800 border-gray-700 text-gray-100"
                  />
                </div>
                
                <div class="space-y-2">
                  <Label for="nip05">
                    <FileText class="h-3.5 w-3.5 inline-block mr-1" />
                    NIP-05 Identifier
                  </Label>
                  <Input 
                    id="nip05" 
                    bind:value={formProfile.nip05} 
                    placeholder="you@example.com"
                    class="bg-gray-800 border-gray-700 text-gray-100"
                  />
                </div>
              </div>
              
              <div class="space-y-2">
                <Label for="lud16">
                  <Zap class="h-3.5 w-3.5 inline-block mr-1" />
                  Lightning Address
                </Label>
                <Input 
                  id="lud16" 
                  bind:value={formProfile.lud16} 
                  placeholder="you@walletofsatoshi.com"
                  class="bg-gray-800 border-gray-700 text-gray-100"
                />
              </div>
              
              {#if saveError}
                <p class="text-red-400 text-sm">{saveError}</p>
              {/if}
            </div>
          {:else}
            <div class="text-center py-8">
              <p class="mb-4">You need to log in to manage your profile</p>
              <Button on:click={() => userStore.login()} class="bg-yellow-500 text-black hover:bg-yellow-400">
                <User class="h-4 w-4 mr-2" />
                Log in with Nostr
              </Button>
            </div>
          {/if}
        </Tabs.Content>
        
        <Tabs.Content value="app" class="space-y-4">
          <div class="space-y-4">
            <div class="p-4 rounded-md bg-gray-800/50 border border-gray-800">
              <h3 class="text-sm font-medium mb-2 flex items-center">
                <Zap class="h-4 w-4 mr-2 text-yellow-400" />
                Lightning Settings
              </h3>
              <p class="text-sm text-gray-400 mb-4">
                Configure your Lightning wallet settings for payments within the app.
              </p>
              
              <div class="space-y-2">
                <Label for="defaultAmount">Default Tip Amount (sats)</Label>
                <Input 
                  id="defaultAmount" 
                  type="number" 
                  value="100" 
                  min="1"
                  class="bg-gray-800 border-gray-700 text-gray-100"
                />
              </div>
            </div>
            
            <div class="p-4 rounded-md bg-gray-800/50 border border-gray-800">
              <h3 class="text-sm font-medium mb-2 flex items-center">
                <Globe class="h-4 w-4 mr-2 text-yellow-400" />
                Privacy Settings
              </h3>
              <p class="text-sm text-gray-400 mb-4">
                Control your privacy settings and data sharing preferences.
              </p>
              
              <div class="flex items-center justify-between">
                <Label for="shareProfile" class="cursor-pointer">Share profile with peers</Label>
                <input type="checkbox" id="shareProfile" class="toggle toggle-primary" checked />
              </div>
            </div>
          </div>
        </Tabs.Content>
      </Tabs.Root>
      
      <Dialog.Footer>
        <Button variant="outline" on:click={handleClose} class='text-gray-800'>
          <X class="h-4 w-4 mr-2" />
          Cancel
        </Button>
        
        {#if activeTab === "profile" && $userStore.isLoggedIn}
          <Button on:click={saveProfile} disabled={isSaving} class="bg-yellow-500 text-black hover:bg-yellow-400">
            {#if isSaving}
              <div class="h-4 w-4 border-2 border-t-transparent border-black rounded-full animate-spin mr-2"></div>
              Saving...
            {:else}
              <Save class="h-4 w-4 mr-2" />
              Save Changes
            {/if}
          </Button>
        {/if}
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>