# Build a polished self-hosted PDF + EPUB reader

Build a complete, production-quality, self-hosted web application for reading PDF and EPUB books.

The application should feel extremely polished, fast, minimal and calm — closer to a carefully designed Apple reading application than a typical web application.

The priority is:

1. Reading experience
2. Smoothness/performance
3. Reliable synchronization
4. Annotations
5. Simplicity of deployment and maintenance

Do not overengineer the application.

---

# 1. Technology constraints

Use the smallest sensible dependency set.

## Frontend

Use:

- React
- TypeScript
- Vite

Use normal CSS or CSS modules.

Do not introduce a large UI framework unless there is a compelling reason.

## Backend

Use:

- Node.js
- Express
- TypeScript
- WebSockets

## Database

Use:

**SQLite**

SQLite is intentional.

This application is self-hosted and does not need PostgreSQL.

Do not introduce:

- PostgreSQL
- MySQL
- Redis
- MongoDB
- Kafka
- message queues
- external databases
- cloud databases

Use SQLite directly or through a very lightweight SQLite library.

Avoid a heavy ORM unless it provides a clear benefit that cannot reasonably be achieved with a small database layer.

Keep the database layer simple and explicit.

## Storage

Store uploaded books on the local filesystem.

Use SQLite for metadata and filesystem storage for the actual PDF/EPUB files.

Do not introduce S3, MinIO, cloud storage, or another object-storage system.

## Deployment

Do not use Docker.

The application should run with a simple process such as:

```text
npm install
npm run build
npm start
```

or an equivalent minimal setup.

Provide a clear README explaining how to run it.

---

# 2. Keep dependencies minimal

Before adding any dependency, ask:

> Can this reasonably be implemented with the existing platform or a small amount of code?

If yes, do not add the dependency.

Do not add libraries simply because they are popular.

In particular, avoid unnecessary dependencies for:

- state management
- UI components
- animation
- database abstraction
- WebSocket abstraction
- utility functions
- file storage
- authentication

Use the browser and Node.js platform where practical.

The final application should have a relatively small dependency footprint.

---

# 3. Core functionality

Users should be able to:

- create accounts
- log in
- log out
- upload PDF books
- upload EPUB books
- view their library
- open books
- resume reading
- read using continuous scrolling
- read using page-based navigation
- synchronize reading position between sessions
- disable synchronization
- highlight text
- add notes
- edit notes
- delete annotations
- search within books
- navigate table of contents/bookmarks
- change reader appearance/settings

Everything must actually work.

Do not create placeholder functionality.

---

# 4. Product design

The application should be:

- minimal
- elegant
- quiet
- extremely readable
- responsive
- fast
- visually consistent

Think of the design language as:

**Apple Books + modern macOS application + Readwise Reader**

without copying any existing application's interface.

Avoid:

- dashboard aesthetics
- excessive cards
- excessive borders
- unnecessary gradients
- giant buttons
- unnecessary animations
- excessive UI chrome

The book should be the visual focus.

---

# 5. Application structure

Keep the application conceptually simple:

```text
app/
    frontend/
    backend/
    data/
        library/
        database.sqlite
```

A reasonable source structure is:

```text
frontend/
    src/
        components/
        pages/
        reader/
            pdf/
            epub/
            annotations/
            sync/
        services/
        hooks/
        styles/
        types/

backend/
    src/
        auth/
        books/
        annotations/
        reader/
        sync/
        database/
        storage/
        websocket/
        middleware/
```

Do not create dozens of abstractions for the sake of abstraction.

---

# 6. Authentication

Implement real multi-user accounts.

Users need:

- registration
- login
- logout
- persistent sessions
- protected routes

Passwords must be securely hashed.

Do not store plaintext passwords.

Prefer secure HTTP-only cookies for authentication.

Every request involving a book, annotation, reading position or session must verify that the authenticated user is authorized to access that resource.

A user must never be able to access another user's books by changing an ID in a request.

---

# 7. SQLite database

Use SQLite as the single application database.

At minimum create tables equivalent to:

```text
users
books
book_files
reading_progress
reader_sessions
annotations
```

Potentially add:

```text
devices
```

only if actually useful.

Keep the schema relational and simple.

Use indexes for common operations.

Important queries include:

- get user's books
- get book
- get reading position
- get active sessions for book
- get annotations for book
- update reading revision

Do not store the entire application state inside one giant JSON column.

---

# 8. Books

Each uploaded book gets its own internal ID.

Do not use filenames as IDs.

Store metadata such as:

```text
id
userId
title
author
format
filePath
fileSize
fileHash
createdAt
updatedAt
```

Extract metadata from the book where practical.

For EPUB:

- title
- author
- cover
- identifier
- table of contents

For PDF:

- title where available
- author where available
- page count
- outline/bookmarks where available

---

# 9. File storage

Books should be stored on the filesystem.

Use a controlled directory such as:

```text
data/library/<userId>/<bookId>/book.pdf
```

Never construct filesystem paths directly from untrusted user input.

Generate safe internal filenames.

Protect against:

- path traversal
- arbitrary filesystem access
- filename collisions
- unauthorized file access

---

# 10. PDF reader

Use PDF.js.

Do not implement PDF rendering yourself.

The reader must support:

- page rendering
- continuous scrolling
- page navigation
- zoom
- fit width
- fit page
- keyboard navigation
- page number navigation
- PDF outline/bookmarks
- text selection
- text search

## Performance

This is extremely important.

Do NOT render every page of a large PDF simultaneously.

Use:

- lazy rendering
- viewport-aware rendering
- nearby-page preloading
- virtualization where appropriate
- cancellation of unnecessary rendering
- stable page containers

A PDF with hundreds or thousands of pages must remain usable.

Avoid keeping hundreds of high-resolution canvas elements in memory.

Do not create a DOM containing every rendered page.

---

# 11. EPUB reader

Use EPUB.js or another mature EPUB rendering library.

Support:

- reflowable EPUB
- paginated mode
- continuous scrolling mode
- table of contents
- chapter navigation
- text selection
- search
- highlights
- font size
- line height
- margins
- reading width
- themes

Support both:

```text
paginated
```

and:

```text
scrolled
```

modes.

Do not treat EPUB like PDF.

EPUB is reflowable, so a "page number" is not a stable synchronization identifier.

Use EPUB CFI or another stable document-location mechanism.

---

# 12. Reading position

Create a unified reading position model.

Conceptually:

```text
ReadingPosition

bookId
format
locationType
location
progress
updatedAt
```

For PDF:

```text
page
scrollOffset
progress
```

For EPUB:

```text
CFI/location
chapter
progress
scrollOffset
```

The persisted position must survive:

- browser refresh
- closing the browser
- reopening the book
- changing screen size
- switching devices

---

# 13. Reading modes

The reader must support two fundamentally different modes.

## Continuous

The entire book behaves like one smooth scrolling document.

Requirements:

- smooth scrolling
- lazy rendering
- no visible page-loading jumps
- stable layout
- nearby-page preloading
- correct scroll restoration

## Paginated

The book behaves like a page-based reader.

Support:

- next
- previous
- keyboard controls
- touch controls
- progress
- optional two-page spread on large screens

Do not use cheesy 3D page-turn effects.

Use subtle transitions.

---

# 14. Reading position synchronization

This is one of the core features.

If a user opens the same book in multiple sessions:

```text
MacBook
Chrome tab
iPhone
iPad
```

the user can synchronize their reading position.

Example:

```text
MacBook
Page 153
```

User moves to page 154.

Other synchronized sessions move to page 154.

The synchronization should feel nearly invisible.

---

# 15. Sync controls

The user must be able to disable synchronization.

Provide:

```text
Sync reading position
[ ON ]
```

and:

```text
This session
● Synced

[ Desync ]
```

When desynced:

```text
Sync paused

[ Resume sync ]
```

Desyncing means:

- stop receiving position updates
- stop publishing position updates

It does NOT mean:

- delete progress
- reset progress
- delete the session
- delete the book

Support:

- global sync preference
- per-book preference
- current-session sync state

---

# 16. Synchronization architecture

Use WebSockets.

The server should be authoritative.

Every reader session gets a unique:

```text
sessionId
```

Every position update should contain enough information to identify its origin and version.

Conceptually:

```json
{
  "eventId": "...",
  "sessionId": "...",
  "bookId": "...",
  "position": {},
  "clientRevision": 12
}
```

The server should assign an authoritative revision:

```json
{
  "eventId": "...",
  "sourceSessionId": "...",
  "bookId": "...",
  "serverRevision": 42,
  "position": {}
}
```

Clients apply only appropriate/newer revisions.

---

# 17. CRITICAL: synchronization loops

Prevent synchronization cycles.

This must never happen:

```text
A changes position
        ↓
server
        ↓
B receives position
        ↓
B publishes position
        ↓
server
        ↓
A receives position
        ↓
A publishes position
        ↓
...
```

A position received from a remote session must NOT be treated as a new local user action.

Maintain explicit provenance.

Distinguish:

```text
LOCAL_USER_ACTION
```

from:

```text
REMOTE_SYNC_UPDATE
```

Only local user actions are eligible to publish a new position update.

A remotely applied position must never automatically generate another synchronization event.

Also use:

- event IDs
- session IDs
- server revisions
- stale-update rejection
- deduplication

where appropriate.

---

# 18. Sync conflict resolution

Handle simultaneous changes.

Example:

```text
Laptop → page 200
Phone  → page 150
```

at approximately the same time.

Do not leave behavior undefined.

Use a deterministic server-authoritative strategy.

The server should assign revisions to accepted changes.

Clients should converge on the authoritative state.

Document the conflict-resolution behavior in the code.

Do not rely solely on client timestamps because device clocks can differ.

---

# 19. Do not sync every scroll event

Never send a WebSocket message for every pixel of scrolling.

Instead:

- update the local UI immediately
- debounce meaningful scroll-position changes
- synchronize when the user pauses
- synchronize page changes immediately
- persist periodically
- attempt a final save when leaving the reader

The exact debounce interval should be chosen based on testing.

---

# 20. Reader sessions

Create a session whenever a user opens a book.

Conceptually:

```text
reader_sessions

id
userId
bookId
syncEnabled
lastKnownPosition
lastSeenAt
createdAt
```

Each browser tab should have its own session ID.

If two tabs open the same book, they must be treated as two separate sessions.

---

# 21. Reconnection

WebSockets disconnect.

Handle:

- network loss
- WiFi switching
- laptop sleep/wake
- browser tab suspension
- temporary server outage
- mobile network switching

Use reconnect with backoff.

When reconnecting:

```text
connect
→ authenticate
→ create/re-establish session
→ fetch authoritative latest state
→ reconcile
→ resume realtime updates
```

Do not assume the client's old state is still authoritative.

---

# 22. Offline behavior

The reader should remain usable while temporarily offline.

The user should still be able to:

- read
- navigate
- change position
- create/edit annotations where practical

Queue mutations where necessary.

When reconnecting:

- synchronize queued changes
- reconcile with server state
- converge to authoritative state

Never silently lose reading progress.

---

# 23. Highlights

Users must be able to select text and highlight it.

Support:

- create highlight
- remove highlight
- change highlight color
- attach note
- navigate back to highlight

Use stable locations.

## EPUB

Use CFI/text-range based locations.

## PDF

Do not store only raw screen coordinates.

Zooming and resizing would break them.

Store enough information to identify the selected text and its location, such as:

```text
page
selectedText
contextBefore
contextAfter
normalized coordinates
document location
```

Use PDF.js text-layer information and appropriate annotation mechanisms.

---

# 24. Notes

A highlight may have an associated note.

Support:

- create
- edit
- delete
- autosave

Autosave must be debounced.

Do not send a network request for every keystroke.

---

# 25. Annotation panel

Create a clean annotation panel.

Example:

```text
ANNOTATIONS

Chapter 4

"This is an important concept..."

This connects to the previous section.

────────────

Chapter 7

"Consistency..."

Review this later.
```

Clicking an annotation should navigate directly to the relevant location.

Support filtering:

- all
- highlights
- notes
- colors

---

# 26. Annotation persistence

Annotations must survive:

- refresh
- closing/reopening
- changing devices
- changing zoom
- changing EPUB font size
- changing viewport

Do not make annotation positions dependent on a specific screen resolution.

---

# 27. Search

Implement in-book search.

PDF:

- use PDF.js text extraction/search

EPUB:

- search book text

Support:

- next result
- previous result
- result count where practical
- highlighted result
- navigation to result

Do not block the UI unnecessarily while searching large books.

---

# 28. Table of contents

For EPUB:

use the EPUB navigation structure.

For PDF:

use PDF outline/bookmarks where available.

Clicking a chapter should navigate smoothly to the correct location.

---

# 29. Library UI

The library should feel like a personal bookshelf, not a CRUD dashboard.

Display:

- cover
- title
- author
- reading progress
- last opened

Sections:

```text
Continue Reading
Recently Added
All Books
```

Example:

```text
Continue Reading

[cover]

Designing Data-Intensive Applications
47%
Chapter 5
```

Provide an obvious upload action.

---

# 30. Uploading

Support:

```text
.pdf
.epub
```

Validate:

- file type
- extension
- size
- file integrity

Do not trust the extension alone.

Do not allow a user to overwrite another book.

Show upload progress.

After upload:

```text
upload
→ validate
→ store
→ extract metadata
→ generate cover if applicable
→ add to library
```

---

# 31. EPUB security

Treat uploaded EPUB files as untrusted archives.

Protect against:

- path traversal during extraction
- malicious archive entries
- unexpected file types
- arbitrary JavaScript execution

Do not enable EPUB embedded JavaScript unless there is a very strong reason.

Keep the EPUB execution environment appropriately restricted.

---

# 32. Reader appearance

Provide a small, polished settings menu.

For EPUB:

- theme
- font
- font size
- line height
- margins
- reading width

Themes:

```text
Light
Sepia
Dark
```

For PDF:

- zoom
- page width
- page fit
- background/reader appearance where appropriate

Persist user preferences.

---

# 33. UI behavior

Reader controls should be hidden while reading and appear when needed.

For example:

```text
mouse movement
tap
keyboard shortcut
```

can reveal controls.

Controls should disappear after inactivity.

Do not hide important state such as sync status permanently.

Use subtle status indicators.

---

# 34. Mobile

The mobile reader should be designed specifically for mobile.

Do not merely shrink desktop controls.

Use:

- touch-friendly controls
- swipe/page navigation
- bottom sheets
- overlay sidebars
- appropriate safe-area handling
- maximum available reading area

---

# 35. Accessibility

Support:

- keyboard navigation
- semantic controls
- focus states
- screen readers where practical
- sufficient contrast
- reduced motion

Respect:

```text
prefers-reduced-motion
```

---

# 36. Error handling

Never show raw backend errors to users.

Handle:

- invalid book
- corrupted book
- unsupported EPUB
- password-protected PDF
- upload failure
- authentication failure
- lost connection
- sync failure
- unavailable book

Errors should be understandable.

---

# 37. Security

Treat all uploaded books and all client input as untrusted.

Protect against:

- path traversal
- unauthorized book access
- unauthorized annotation access
- unauthorized progress access
- malformed uploads
- oversized uploads
- malicious EPUB archives
- injection attacks
- authentication abuse

Every resource access must verify ownership.

Do not trust IDs supplied by the browser.

---

# 38. Performance

Performance is a product feature.

Measure and optimize:

- initial reader load
- PDF rendering
- EPUB rendering
- scrolling
- page transitions
- annotation rendering
- search
- WebSocket traffic
- React re-renders

Avoid:

- unnecessary re-renders
- expensive calculations inside scroll handlers
- rendering thousands of DOM elements
- rendering all PDF pages
- sending excessive WebSocket messages
- unnecessary database queries

Use browser-native APIs where they are sufficient.

---

# 39. Large books

Explicitly test:

- 500-page PDF
- 1000+ page PDF
- image-heavy PDF
- scanned PDF
- large EPUB
- EPUB with many chapters
- EPUB with many images
- books with many annotations

Large books should not freeze the browser.

---

# 40. Database reliability

SQLite is the database.

Configure it sensibly for a self-hosted application.

Use:

- transactions for multi-step mutations
- foreign keys
- indexes
- appropriate journal mode
- safe concurrent access

Do not build a complicated database abstraction.

The database should remain a single simple `.sqlite` file.

Provide migrations or a reliable schema initialization mechanism.

---

# 41. Backup friendliness

One advantage of the architecture is that the user should be able to back up:

```text
database.sqlite
data/library/
```

and restore the application.

Do not scatter application data across external services.

Document what needs to be backed up.

---

# 42. Testing

Write meaningful automated tests.

Test:

### Authentication

- registration
- login
- logout
- invalid credentials
- authorization

### Books

- upload
- validation
- metadata
- ownership
- deletion

### Progress

- save
- restore
- multiple sessions

### Synchronization

Explicitly test:

```text
A → server → B
```

and ensure:

```text
B does NOT → server → A → server → B
```

Also test:

- duplicate events
- stale revisions
- simultaneous changes
- reconnect
- offline
- desync
- resync
- three simultaneous sessions
- multiple browser tabs

### Annotations

- create
- edit
- delete
- persistence
- navigation

---

# 43. Development approach

Build incrementally.

Do not generate the entire application as one giant untested implementation.

Implement in this order:

## Phase 1

Project setup:

- React
- Express
- TypeScript
- SQLite
- authentication
- basic library

## Phase 2

PDF reader.

## Phase 3

EPUB reader.

## Phase 4

Persistent reading position.

## Phase 5

WebSocket sessions.

## Phase 6

Reliable synchronization and conflict handling.

## Phase 7

Highlights and notes.

## Phase 8

Search and table of contents.

## Phase 9

Reader settings and responsive UI.

## Phase 10

Performance and edge cases.

## Phase 11

Security hardening.

## Phase 12

Full end-to-end testing.

After every phase, make sure previous functionality still works.

---

# 44. Do not declare completion prematurely

The application is not complete merely because:

```text
npm run build
```

succeeds.

Actually exercise the application.

The final end-to-end test should be:

```text
Create user
        ↓
Upload PDF
        ↓
Open book
        ↓
Read
        ↓
Close book
        ↓
Reopen
        ↓
Position restored
        ↓
Open same book in second browser
        ↓
Enable sync
        ↓
Change position
        ↓
Verify second browser moves
        ↓
Disable sync
        ↓
Verify second browser stops moving
        ↓
Reconnect
        ↓
Verify state converges
        ↓
Highlight text
        ↓
Add note
        ↓
Close book
        ↓
Reopen
        ↓
Verify annotation
        ↓
Navigate from annotation to text
```

Also test the same flow with EPUB.

---

# 45. Final engineering principle

Keep the implementation **boring underneath and beautiful on top**.

The backend does not need to be complicated.

The deployment does not need to be complicated.

The database does not need to be complicated.

The synchronization system should be deterministic and robust.

The reader itself should be highly optimized.

The UI should feel exceptionally polished.

Prefer a small amount of well-written code over introducing another dependency.

Do not add infrastructure unless the application demonstrably needs it.

The final result should be a self-contained application that can realistically be hosted by one person on a small server with:

```text
Node.js
SQLite
filesystem
```

and nothing else.