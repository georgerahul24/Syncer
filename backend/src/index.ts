import http from 'node:http';
import './database/db.js'; // ensures schema is applied before anything else touches the db
import { createApp } from './app.js';
import { attachWebSocketServer } from './websocket/server.js';
import { backfillMissingTextIndexes } from './search/textIndex.js';
import { PORT } from './config.js';

const server = http.createServer(createApp());
attachWebSocketServer(server);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Syncer server listening on http://0.0.0.0:${PORT} (reachable at http://localhost:${PORT} and from other devices on your network)`);
});

// Runs after the server starts accepting requests — this only ever has
// work to do for books that predate the search feature, and shouldn't
// delay startup while it indexes them. See search/README.md.
backfillMissingTextIndexes().catch((err) => console.error('[search] startup backfill failed:', err));
