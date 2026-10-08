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

// Live push for a book's own content — annotations (highlights/notes) and
// notebook pages (typed + stylus-drawn ink) — so a mark made on one device
// appears on another already-open session immediately, the same way a
// reading position does, instead of only showing up on that session's next
// page load. Unlike position updates these are unconditional: they aren't
// behind the sync on/off toggle (annotations/notebook pages always persist
// to the server regardless of that toggle — see annotations/routes.ts and
// notebook/routes.ts), so every live session for the book gets them,
// including the one that made the edit (harmless — it already has this
// exact state from its own optimistic update).
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
