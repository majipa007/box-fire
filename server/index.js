// Host entry point: serves the client and shared modules over HTTP, accepts
// WebSocket connections on the same port, and keeps a heartbeat on each one.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { PORT, HEARTBEAT_MS, DEAD_MS } from '../shared/constants.js';
import { decodeClient } from '../shared/protocol.js';
import { Game } from './game.js';

// In a `bun build --compile` binary this module reports the executable's own
// path, with client/ and shared/ embedded beside it.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = fs.existsSync(path.join(here, 'client', 'index.html')) ? here : path.resolve(here, '..');
const MOUNTS = [['/shared/', path.join(root, 'shared')], ['/', path.join(root, 'client')]];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

// URL → file inside client/ or shared/, or null. The URL is user input, so the
// resolved path must stay inside its mount.
function resolveFile(url) {
  let p;
  try { p = decodeURIComponent(new URL(url, 'http://host').pathname); } catch { return null; }
  if (p.includes('\0')) return null;
  if (p.endsWith('/')) p += 'index.html';
  const [prefix, dir] = MOUNTS.find(([prefix]) => p.startsWith(prefix));
  const file = path.resolve(dir, p.slice(prefix.length));
  return file.startsWith(dir + path.sep) ? file : null;
}

const server = http.createServer((req, res) => {
  const file = resolveFile(req.url);
  const type = file && MIME[path.extname(file)];
  if (!type) return notFound(res);
  fs.readFile(file, (err, data) => {
    if (err) return notFound(res);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

const isLoopback = (addr = '') => /^(127\.|::1$|::ffff:127\.)/.test(addr);
const port = Number(process.env.PORT) || PORT;

const MAP_ID = 'arena_01';
const game = new Game(MAP_ID, JSON.parse(fs.readFileSync(path.join(root, 'shared', 'maps', `${MAP_ID}.json`), 'utf8')));
const conns = new Set();
const MAX_MSG = 4096;
const wss = new WebSocketServer({ server, maxPayload: MAX_MSG });

// ws re-emits the HTTP server's errors, so a failed listen surfaces here.
wss.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE'
    ? `Port ${port} is already in use. Stop whatever is using it, or set the PORT environment variable to another port (for example 3001).`
    : err);
  process.exit(1);
});

wss.on('connection', (ws, req) => {
  const conn = { ws, loopback: isLoopback(req.socket.remoteAddress), lastPong: Date.now(), pingAt: 0, rtt: 0, player: null };
  conns.add(conn);
  ws.on('error', () => {}); // a broken socket must never take the host down
  ws.on('pong', () => {
    conn.lastPong = Date.now();
    conn.rtt = conn.lastPong - conn.pingAt;
  });
  ws.on('message', (data, isBinary) => {
    // Bun's built-in ws ignores maxPayload (it caps frames at 16 MiB), so check again.
    if (data.length > MAX_MSG) return ws.close(1009);
    const msg = isBinary ? null : decodeClient(String(data));
    if (!msg) return;
    try { game.handle(conn, msg); } catch (err) { console.error('message handler failed:', err); }
  });
  ws.on('close', () => {
    conns.delete(conn);
    game.disconnect(conn);
  });
});

// Heartbeat. Browsers answer pings below the page's JavaScript, even in
// background tabs, so only a dead connection stops answering.
setInterval(() => {
  const now = Date.now();
  for (const conn of conns) {
    if (now - conn.lastPong > DEAD_MS) { conn.ws.terminate(); continue; }
    if (conn.ws.readyState !== conn.ws.OPEN) continue;
    conn.pingAt = now;
    conn.ws.ping();
  }
}, HEARTBEAT_MS);

game.startLoop();

server.listen(port, () => {
  const urls = Object.values(os.networkInterfaces()).flat()
    .filter((a) => a.family === 'IPv4' && !a.internal)
    .map((a) => `  http://${a.address}:${port}`);
  console.log('Boxfire is running. Share one of these with friends on the same WiFi:');
  console.log(urls.join('\n') || '  (no LAN address found)');
  console.log(`On this machine: http://localhost:${port}`);
});
