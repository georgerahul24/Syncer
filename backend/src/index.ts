import http from 'node:http';
import './database/db.js'; // ensures schema is applied before anything else touches the db
import { createApp } from './app.js';
import { attachWebSocketServer } from './websocket/server.js';
import { PORT } from './config.js';

const server = http.createServer(createApp());
attachWebSocketServer(server);

server.listen(PORT, () => {
  console.log(`Syncer server listening on http://localhost:${PORT}`);
});
