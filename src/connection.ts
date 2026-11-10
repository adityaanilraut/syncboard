import * as Y from 'yjs';
import { decode, encode, type ServerFrame, type ClientFrame } from './protocol.js';

export type ConnectionStatus = 'connecting' | 'online' | 'offline';
export type Cursors = Map<string, { x: number; y: number }>;

export class BoardConnection {
  private socket?: WebSocket;
  private reconnect?: ReturnType<typeof setTimeout>;
  private flushTimer: ReturnType<typeof setInterval>;
  private closed = false;
  private synced = false;
  private nextID = 0;
  private pending = new Map<number, string>();
  private sent = new Set<number>();
  private cursors: Cursors = new Map();
  private lastCursor = 0;
  private delay = 250;

  constructor(
    readonly doc: Y.Doc,
    readonly room: string,
    readonly status: (status: ConnectionStatus) => void,
    readonly showCursors: (cursors: Cursors) => void,
  ) {
    doc.on('update', this.record);
    this.flushTimer = setInterval(() => this.flush(), 25);
    this.open();
  }

  private record = (bytes: Uint8Array, origin: unknown) => {
    if (origin !== this) this.pending.set(++this.nextID, encode(bytes));
  };

  private open() {
    if (this.closed) return;
    this.status('connecting');
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(scheme + '//' + location.host + '/ws/' + this.room);
    this.socket = socket;
    socket.addEventListener('message', event => {
      const frame = JSON.parse(String(event.data)) as ServerFrame;
      switch (frame.type) {
        case 'snapshot':
          Y.applyUpdate(this.doc, decode(frame.data), this);
          this.synced = true;
          this.delay = 250;
          this.status('online');
          break;
        case 'update':
          Y.applyUpdate(this.doc, decode(frame.data), this);
          break;
        case 'ack':
          this.pending.delete(frame.id);
          this.sent.delete(frame.id);
          break;
        case 'cursor':
          this.cursors.set(frame.user, { x: frame.x, y: frame.y });
          this.showCursors(new Map(this.cursors));
          break;
        case 'leave':
          this.cursors.delete(frame.user);
          this.showCursors(new Map(this.cursors));
          break;
      }
    });
    socket.addEventListener('close', () => {
      this.synced = false;
      this.sent.clear();
      this.cursors.clear();
      if (!this.closed) {
        this.status('offline');
        this.showCursors(new Map());
        this.reconnect = setTimeout(() => this.open(), this.delay);
        this.delay = Math.min(5000, this.delay * 2);
      }
    });
  }

  private flush() {
    if (!this.synced || this.sent.size >= 16) return;
    for (const [id, data] of this.pending) {
      if (!this.sent.has(id)) {
        this.send({ type: 'update', id, data });
        this.sent.add(id);
        break;
      }
    }
  }

  cursor(x: number, y: number) {
    if (!this.synced || Date.now() - this.lastCursor < 85) return;
    this.lastCursor = Date.now();
    this.send({ type: 'cursor', x, y });
  }

  private send(frame: ClientFrame) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(frame));
  }

  close() {
    this.closed = true;
    clearInterval(this.flushTimer);
    clearTimeout(this.reconnect);
    this.doc.off('update', this.record);
    this.socket?.close();
  }
}
