// Mirrors backend/src/sync/protocol.ts by hand (see that file's header for
// why there's no shared package). Keep the two in sync.

export interface ClientPositionMessage {
  type: 'position';
  eventId: string;
  clientRevision: number;
  locationType: string;
  location: unknown;
  progress: number;
}

export interface ClientSyncToggleMessage {
  type: 'sync-toggle';
  enabled: boolean;
}

export type ClientMessage = ClientPositionMessage | ClientSyncToggleMessage | { type: 'ping' };

export interface ServerJoinedMessage {
  type: 'joined';
  sessionId: string;
  revision: number;
  syncEnabled: boolean;
  locationType: string | null;
  location: unknown | null;
  progress: number;
}

export interface ServerPositionUpdateMessage {
  type: 'position-update';
  serverRevision: number;
  sourceSessionId: string;
  eventId: string;
  locationType: string;
  location: unknown;
  progress: number;
}

export interface ServerAckMessage {
  type: 'ack';
  eventId: string;
  serverRevision: number;
}

export interface ServerErrorMessage {
  type: 'error';
  message: string;
}

export type ServerMessage =
  | ServerJoinedMessage
  | ServerPositionUpdateMessage
  | ServerAckMessage
  | ServerErrorMessage
  | { type: 'pong' };
