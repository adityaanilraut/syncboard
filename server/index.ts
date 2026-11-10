import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import { resolve } from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { createClient } from 'redis';
import WebSocket, { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import { maxUpdateBytes, parseClientFrame, roomPattern, type ServerFrame } from '../src/protocol.js';

const redis = createClient({ url: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379' });
const subscriber = redis.duplicate();
for (const client of [redis, subscriber]) client.on('error', error => console.error('Redis:', error.message));
await Promise.all([redis.connect(), subscriber.connect()]);

const channel = 'syncboard:events';
const rooms = new Map<string, Room>();
const roomLimit = 100;
const memberLimit = 100;
const append = `
  if redis.call('XLEN', KEYS[1]) >= 50000 then return false end
  local id = redis.call('XADD', KEYS[1], '*', 'data', ARGV[1])
  redis.call('PUBLISH', ARGV[2], ARGV[3])
  return id
`;

function send(socket: WebSocket, frame: ServerFrame) {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > 2 * 1024 * 1024) {
    socket.close(1013, 'Slow connection');
    return;
  }
  socket.send(JSON.stringify(frame));
}

class Room {
  readonly doc = new Y.Doc();
  readonly sockets = new Set<WebSocket>();
  joining = 0;
  readonly key: string;
  private last = '0-0';
  private dirty = false;
  private draining?: Promise<void>;

  constructor(readonly id: string) {
    this.key = 'syncboard:room:' + id;
  }

  catchUp(): Promise<void> {
    this.dirty = true;
    if (!this.draining) this.draining = this.drain().finally(() => { this.draining = undefined; });
    return this.draining;
  }

  private async drain() {
    while (this.dirty) {
      this.dirty = false;
      let count: number;
      do {
        const rows = await redis.xRange(this.key, '(' + this.last, '+', { COUNT: 256 }) ?? [];
        for (const row of rows) {
          const data = row.message.data;
          Y.applyUpdate(this.doc, Buffer.from(data, 'base64'));
          this.broadcast({ type: 'update', data });
          this.last = row.id;
        }
        count = rows.length;
      } while (count === 256);
    }
  }

  broadcast(frame: ServerFrame) {
    for (const socket of this.sockets) send(socket, frame);
  }

  async update(data: string) {
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length > maxUpdateBytes) throw new Error('Update too large');
    // Validate the binary update before persisting it.
    const probe = new Y.Doc();
    try { Y.applyUpdate(probe, bytes); } finally { probe.destroy(); }
    const id = await redis.eval(append, {
      keys: [this.key], arguments: [data, channel, JSON.stringify({ room: this.id })],
    });
    if (!id) throw new Error('Room has reached its update limit');
  }
}

function report(error: unknown) {
  console.error('SyncBoard:', error instanceof Error ? error.message : error);
}

await subscriber.subscribe(channel, raw => {
  const { room, frame } = JSON.parse(raw) as { room: string; frame?: ServerFrame };
  const local = rooms.get(room);
  if (!local) return;
  if (frame) local.broadcast(frame);
  else void local.catchUp().catch(report);
});

const app = express();
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
  referrerPolicy: { policy: 'no-referrer' },
}));
app.get('/healthz', (_req, res) => res.sendStatus(redis.isReady && subscriber.isReady ? 200 : 503));
const frontend = resolve('dist');
app.use(express.static(frontend));
app.get('/room/:room', (req, res) => {
  if (!roomPattern.test(req.params.room)) return res.sendStatus(404);
  return res.sendFile(resolve(frontend, 'index.html'));
});

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 66 * 1024, perMessageDeflate: false });

function roomFor(req: IncomingMessage): string | undefined {
  const host = req.headers.host;
  if (!host) return;
  const path = /^\/ws\/([a-f0-9-]+)$/.exec(req.url ?? '');
  if (!path || !roomPattern.test(path[1])) return;
  const origin = req.headers.origin;
  const allow = process.env.APP_ORIGIN;
  if (allow && origin !== allow) return;
  if (!allow && origin && origin !== 'http://' + host && origin !== 'https://' + host) return;
  return path[1];
}

server.on('upgrade', (req, socket, head) => {
  const id = roomFor(req);
  if (!id || !redis.isReady || !subscriber.isReady || (!rooms.has(id) && rooms.size >= roomLimit)) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  const room = rooms.get(id) ?? new Room(id);
  rooms.set(id, room);
  wss.handleUpgrade(req, socket, head, ws => {
    if (room.sockets.size + room.joining >= memberLimit) {
      ws.close(1013, 'Room is full');
      return;
    }
    connect(ws, room);
  });
});

function connect(socket: WebSocket, room: Room) {
  const user = randomUUID();
  let windowStart = Date.now();
  let frames = 0;
  let connected = true;
  let queue = Promise.resolve();
  let pending = 0;
  socket.on('error', report);
  socket.on('close', () => {
    connected = false;
    room.sockets.delete(socket);
    void publish(room, { type: 'leave', user }).catch(report);
  });
  room.joining++;
  const initialized = room.catchUp().then(() => {
    if (!connected) return;
    send(socket, { type: 'snapshot', data: Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString('base64') });
    room.sockets.add(socket);
  });
  void initialized.finally(() => { room.joining--; }).catch(() => socket.close(1011, 'Could not load room'));
  socket.on('message', raw => {
    if (Date.now() - windowStart > 1000) {
      windowStart = Date.now();
      frames = 0;
    }
    if (++frames > 60 || pending >= 64) {
      socket.close(1008, 'Rate limit');
      return;
    }
    const frame = parseClientFrame(raw.toString());
    if (!frame) {
      socket.close(1007, 'Invalid message');
      return;
    }
    pending++;
    queue = queue.then(async () => {
      await initialized;
      if (!connected) return;
      if (frame.type === 'cursor') await publish(room, { ...frame, user });
      else {
        await room.update(frame.data);
        send(socket, { type: 'ack', id: frame.id });
      }
    }).catch(error => {
      report(error);
      socket.close(1011, 'Could not save update');
    }).finally(() => { pending--; });
  });
}

function publish(room: Room, frame: ServerFrame) {
  return redis.publish(channel, JSON.stringify({ room: room.id, frame }));
}

let heartbeat = 0;
const active = new WeakMap<WebSocket, number>();
server.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '127.0.0.1');
const timer = setInterval(() => {
  for (const room of rooms.values()) {
    if (room.sockets.size) void room.catchUp().catch(report);
  }
  if (++heartbeat % 15 !== 0) return;
  for (const ws of wss.clients) {
    if ((active.get(ws) ?? heartbeat) < heartbeat - 15) {
      ws.terminate();
      continue;
    }
    if (!active.has(ws)) ws.on('pong', () => active.set(ws, heartbeat));
    active.set(ws, active.get(ws) ?? heartbeat);
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  }
  for (const room of rooms.values()) {
    if (!room.sockets.size && !room.joining) {
      // Defer eviction until any in-flight replay or join finishes.
      void room.catchUp().then(() => {
        if (!room.sockets.size && !room.joining && rooms.get(room.id) === room) {
          rooms.delete(room.id);
          room.doc.destroy();
        }
      }).catch(report);
    }
  }
}, 1000);
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    clearInterval(timer);
    for (const ws of wss.clients) ws.close(1001, 'Server shutting down');
    server.close(() => {
      redis.destroy();
      subscriber.destroy();
    });
  });
}
