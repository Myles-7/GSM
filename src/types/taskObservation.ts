export type TaskObservationSource = 'agy' | 'http' | 'server' | 'gsm';
export type TaskContentChannel = 'answer' | 'reasoning';
export interface TaskRequestObservation {
  owner: string; taskId: string; requestId: string; itemId?: string; label: string;
  source: TaskObservationSource; model?: string; effort?: string; attempt: number;
  mode: 'stream' | 'final' | 'unknown'; phase: string; startedAt: string;
  phaseStartedAt: string; firstOutputAt?: string; lastOutputAt?: string; lastActivityAt: string; endedAt?: string;
  answer: string; reasoning: string; receivedChars: number; truncated: boolean;
  outcome?: 'succeeded' | 'failed' | 'unknown' | 'canceled'; error?: string; usage?: Record<string, number>;
}
export interface TaskObservationEvent {
  id: string; requestId?: string; itemId?: string; source: TaskObservationSource;
  type: string; phase?: string; message?: string; time: string; remoteSeq?: number;
  stepIndex?: number; state?: string; usage?: Record<string,number>;
}
export interface TaskObservedResult {
  id: string; requestId?: string; itemId?: string; repositoryId?: number;
  label: string; data: unknown; commitStatus: 'saved' | 'pending' | 'failed' | 'not_started' | 'conflict';
}
export interface TaskObservations {
  requests: TaskRequestObservation[]; events: TaskObservationEvent[]; results: TaskObservedResult[];
  loaded: boolean; truncated: boolean; pinned: boolean; storageError?: string;
}
