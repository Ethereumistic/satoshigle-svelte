// server/src/types.ts
export interface SignalData {
    type: 'offer' | 'answer' | 'candidate'
    payload: RTCSessionDescriptionInit | RTCIceCandidateInit
    roomId: string
  }