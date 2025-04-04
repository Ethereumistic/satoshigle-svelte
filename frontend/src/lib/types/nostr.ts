export interface NostrProfile {
    displayName: string;
    name: string;
    about: string;
    picture: string;
    banner: string;
    website: string;
    nip05: string;
    lud16: string;
  }
  
  export interface NostrEvent {
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
    sig: string;
  }