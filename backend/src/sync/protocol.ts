// WebSocket wire protocol. Mirrored (by hand — no shared package on
// purpose, see ARCHITECTURE.md) on the frontend at
// frontend/src/reader/sync/protocol.ts. Keep the two in sync.
//
// One WebSocket connection == one reader session == one open book in one
// browser tab. bookId/sessionId are established once at connect time
// (via `?bookId=` + auth cookie) and never re-asserted by the client on
// later messages, so a client can never spoof another session's identity.

export interface ReadingLocation {
  // 'pdf-page' | 'epub-cfi'
  locationType: string;
  // Format-specific payload: { page, scrollOffset } for PDF,
  // { cfi, chapter, scrollOffset } for EPUB. Opaque to the sync layer.
  location: unknown;
  progress: number; // 0..1
}

export interface ClientPositionMessage extends ReadingLocation {
  type: 'position';
  eventId: string;
  clientRevision: number;
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
  // null when the book has never been opened before (no saved position yet)
  locationType: string | null;
  location: unknown | null;
  progress: number;
}

export interface ServerPositionUpdateMessage extends ReadingLocation {
  type: 'position-update';
  serverRevision: number;
  sourceSessionId: string;
  eventId: string;
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
