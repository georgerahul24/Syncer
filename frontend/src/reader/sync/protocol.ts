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

// Live push for annotations and notebook pages — see the matching comment
// in backend/src/sync/protocol.ts for why these go to every session
// unconditionally rather than being gated by the sync toggle.
export interface ServerNotebookUpsertMessage {
  type: 'notebook-upsert';
  page: Record<string, unknown>;
}

export interface ServerNotebookDeleteMessage {
  type: 'notebook-delete';
  pageId: string;
}

export interface ServerAnnotationUpsertMessage {
  type: 'annotation-upsert';
  annotation: Record<string, unknown>;
}

export interface ServerAnnotationDeleteMessage {
  type: 'annotation-delete';
  annotationId: string;
}

export type ServerMessage =
  | ServerJoinedMessage
  | ServerPositionUpdateMessage
  | ServerAckMessage
  | ServerErrorMessage
  | ServerNotebookUpsertMessage
  | ServerNotebookDeleteMessage
  | ServerAnnotationUpsertMessage
  | ServerAnnotationDeleteMessage
  | { type: 'pong' };
