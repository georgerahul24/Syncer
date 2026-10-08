import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import './database/db.js'; // ensures schema is applied before anything else touches the db
import { createApp } from './app.js';
import { attachWebSocketServer } from './websocket/server.js';
import { backfillMissingTextIndexes } from './search/textIndex.js';
import { PORT, TLS_CERT_FILE, TLS_KEY_FILE } from './config.js';

// HTTPS when a cert/key pair is configured, plain HTTP otherwise. This is the
// difference between a phone being able to install Syncer as a real PWA and
// only being able to bookmark it — Chrome gates service workers, install, and
// the Android share target on a secure origin. See README.
function createServer() {
  if (!TLS_CERT_FILE && !TLS_KEY_FILE) return { server: http.createServer(createApp()), scheme: 'http' };
  if (!TLS_CERT_FILE || !TLS_KEY_FILE) {
    console.error('[tls] TLS_CERT_FILE and TLS_KEY_FILE must both be set; falling back to HTTP.');
    return { server: http.createServer(createApp()), scheme: 'http' };
  }
  try {
    const credentials = { cert: fs.readFileSync(TLS_CERT_FILE), key: fs.readFileSync(TLS_KEY_FILE) };
    return { server: https.createServer(credentials, createApp()), scheme: 'https' };
  } catch (err) {
    // Refuse to silently downgrade to HTTP: someone who configured TLS wants
    // TLS, and a silent fallback would look like a working install until the
    // phone quietly refuses to register a service worker.
    console.error(`[tls] Could not read TLS_CERT_FILE/TLS_KEY_FILE: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

const { server, scheme } = createServer();
attachWebSocketServer(server);

// Both of these matter specifically when the client is reaching this server
// the long way round — over Tailscale, and most of all through a Funnel,
// where every connection is proxied via a relay and a fresh TCP + TLS
// handshake costs several round trips through it.
//
// Node closes an idle keep-alive connection after 5 seconds, which is far
// shorter than the gaps between this app's requests (a reading session is
// mostly quiet, then bursts). Holding connections open for a minute means a
// burst reuses one that's already warm instead of paying the handshake
// again. headersTimeout must stay above keepAliveTimeout, or a request that
// arrives just as the idle timer fires can be dropped mid-flight.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;
// Nagle's algorithm holds a small write back waiting for more data to
// coalesce with. Combined with delayed ACK on the other end it can add tens
// of milliseconds to exactly the traffic this app cares about being prompt:
// position syncs and other small, latency-sensitive messages. Bulk file
// transfers fill packets on their own and are unaffected either way.
server.on('connection', (socket) => socket.setNoDelay(true));

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `Syncer server listening on ${scheme}://0.0.0.0:${PORT} (reachable at ${scheme}://localhost:${PORT} and from other devices on your network)`
  );
  if (scheme === 'http') {
    console.log(
      'Note: served over plain HTTP. Phones on your network can read the library, but Chrome will not offer "Install"\n' +
        '      or list Syncer in the Android share sheet over an insecure origin. See README, "Installing on your phone".'
    );
  }
});

// Runs after the server starts accepting requests — this only ever has
// work to do for books that predate the search feature, and shouldn't
// delay startup while it indexes them. See search/README.md.
backfillMissingTextIndexes().catch((err) => console.error('[search] startup backfill failed:', err));
