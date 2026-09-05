import http from 'node:http';
import './database/db.js'; // ensures schema is applied before anything else touches the db
import { createApp } from './app.js';
import { attachWebSocketServer } from './websocket/server.js';
import { PORT } from './config.js';

const server = http.createServer(createApp());
attachWebSocketServer(server);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Syncer server listening on http://0.0.0.0:${PORT} (reachable at http://localhost:${PORT} and from other devices on your network)`);
});
