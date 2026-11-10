import { jest } from '@jest/globals';
import * as Y from 'yjs';
import { BoardConnection, type ConnectionStatus, type Cursors } from '../src/connection.js';
import { encode, type ClientFrame, type ServerFrame } from '../src/protocol.js';

const sockets: TestSocket[] = [];
const room = 'a1111111-b222-4333-a444-555555555555';

class TestSocket extends EventTarget {
  static OPEN = 1;
  readyState = TestSocket.OPEN;
  frames: ClientFrame[] = [];

  constructor(readonly url: string) {
    super();
    sockets.push(this);
  }

  send(value: string) {
    this.frames.push(JSON.parse(value));
  }

  receive(frame: ServerFrame) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(frame) }));
  }

  close() {
    if (this.readyState !== TestSocket.OPEN) return;
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }
}

let doc: Y.Doc;
let board: BoardConnection;
let statuses: ConnectionStatus[];
let cursors: Cursors[];
const globals = new Map<string, PropertyDescriptor | undefined>();

function install(name: string, value: unknown) {
  globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, value });
}

function snapshot(socket: TestSocket, state = new Y.Doc()) {
  socket.receive({ type: 'snapshot', data: encode(Y.encodeStateAsUpdate(state)) });
}

beforeEach(() => {
  jest.useFakeTimers();
  sockets.length = 0;
  statuses = [];
  cursors = [];
  install('WebSocket', TestSocket);
  install('location', { protocol: 'https:', host: 'board.example' });
  doc = new Y.Doc();
  board = new BoardConnection(doc, room, status => statuses.push(status), current => cursors.push(current));
});

afterEach(() => {
  board.close();
  doc.destroy();
  for (const [name, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  globals.clear();
  jest.useRealTimers();
});

test('chooses secure WebSockets and waits for the server snapshot before marking the board live', () => {
  expect(sockets[0].url).toBe('wss://board.example/ws/' + room);
  expect(statuses).toEqual(['connecting']);
  snapshot(sockets[0]);
  expect(statuses).toEqual(['connecting', 'online']);
});

test('queues local edits until the snapshot and clears each edit after acknowledgement', () => {
  doc.getArray('shapes').push(['local']);
  jest.advanceTimersByTime(250);
  expect(sockets[0].frames).toEqual([]);
  snapshot(sockets[0]);
  jest.advanceTimersByTime(25);
  expect(sockets[0].frames).toMatchObject([{ type: 'update', id: 1 }]);
  sockets[0].receive({ type: 'ack', id: 1 });
  sockets[0].close();
  jest.advanceTimersByTime(250);
  snapshot(sockets[1]);
  jest.advanceTimersByTime(25);
  expect(sockets[1].frames).toEqual([]);
});

test('resends the same unacknowledged update after a reconnect', () => {
  snapshot(sockets[0]);
  doc.getArray('shapes').push(['local']);
  jest.advanceTimersByTime(25);
  const frame = sockets[0].frames[0];
  sockets[0].close();
  expect(statuses.at(-1)).toBe('offline');
  jest.advanceTimersByTime(250);
  snapshot(sockets[1]);
  jest.advanceTimersByTime(25);
  expect(sockets[1].frames).toEqual([frame]);
});

test('applies remote updates without echoing them back', () => {
  const remote = new Y.Doc();
  try {
    remote.getArray('shapes').push(['old']);
    snapshot(sockets[0], remote);
    remote.getArray('shapes').push(['new']);
    sockets[0].receive({ type: 'update', data: encode(Y.encodeStateAsUpdate(remote)) });
    jest.advanceTimersByTime(500);
    expect(doc.getArray('shapes').toArray()).toEqual(['old', 'new']);
    expect(sockets[0].frames).toEqual([]);
  } finally {
    remote.destroy();
  }
});

test('limits concurrent unacknowledged updates', () => {
  snapshot(sockets[0]);
  for (let i = 0; i < 20; i++) doc.getArray('shapes').push([i]);
  jest.advanceTimersByTime(1000);
  expect(sockets[0].frames).toHaveLength(16);
  sockets[0].receive({ type: 'ack', id: 1 });
  jest.advanceTimersByTime(25);
  expect(sockets[0].frames.at(-1)).toMatchObject({ id: 17, type: 'update' });
});

test('throttles cursor sends, tracks peer departure, and clears cursors when disconnected', () => {
  board.cursor(1, 2);
  expect(sockets[0].frames).toEqual([]);
  snapshot(sockets[0]);
  board.cursor(1, 2);
  board.cursor(2, 3);
  jest.advanceTimersByTime(85);
  board.cursor(3, 4);
  expect(sockets[0].frames).toEqual([{ type: 'cursor', x: 1, y: 2 }, { type: 'cursor', x: 3, y: 4 }]);
  sockets[0].receive({ type: 'cursor', user: 'peer', x: 5, y: 6 });
  expect(cursors.at(-1)?.get('peer')).toEqual({ x: 5, y: 6 });
  sockets[0].receive({ type: 'leave', user: 'peer' });
  expect(cursors.at(-1)?.size).toBe(0);
  sockets[0].receive({ type: 'cursor', user: 'peer', x: 5, y: 6 });
  sockets[0].close();
  expect(cursors.at(-1)?.size).toBe(0);
});

test('stops reconnecting when the room unmounts', () => {
  sockets[0].close();
  board.close();
  jest.advanceTimersByTime(10_000);
  expect(sockets).toHaveLength(1);
});
