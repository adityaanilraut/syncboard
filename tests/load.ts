import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { arch, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';
import * as Y from 'yjs';
import type { ServerFrame } from '../src/protocol.js';

const count = Number(process.env.CLIENTS ?? 60);
const seconds = Number(process.env.SECONDS_PER_RUN ?? 120);
const room = randomUUID();
const hosts = (process.env.BOARD_WS ?? 'ws://127.0.0.1:3000,ws://127.0.0.1:3001').split(',');
if (!Number.isSafeInteger(count) || count < 2 || !Number.isSafeInteger(seconds) || seconds < 1 || hosts.length !== 2) {
  throw new Error('Set two backend URLs and positive workload sizes');
}

const remote = Symbol('remote');
const emitted = new Map<string, number>();
const delivered = new Set<string>();
const latencies: number[] = [];
const schedulingDrift: number[] = [];
const sockets: { ws: WebSocket; doc: Y.Doc }[] = [];
let acknowledgements = 0;
let errors = 0;
const disconnected: Record<string, number> = {};
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function connect(i: number) {
  const host = hosts[i % 2];
  const doc = new Y.Doc();
  const shapes = doc.getArray<{ id: string; kind: string; color: string; points: { x: number; y: number }[] }>('shapes');
  const ws = new WebSocket(host + '/ws/' + room);
  sockets.push({ ws, doc });
  let id = 0;
  doc.on('update', (bytes, origin) => {
    if (origin === remote) return;
    if (ws.readyState !== WebSocket.OPEN) {
      errors++;
      return;
    }
    ws.send(JSON.stringify({ type: 'update', id: ++id, data: Buffer.from(bytes).toString('base64') }));
  });
  if (i < 2) {
    // Sample from one client on each backend. All clients still apply every edit.
    shapes.observe(event => {
      if (event.transaction.origin !== remote) return;
      for (const delta of event.changes.delta) {
        for (const shape of (delta.insert as { id: string }[] | undefined) ?? []) {
          const sender = Number(shape.id.split('/')[0]);
          if (sender % 2 === i % 2 || delivered.has(shape.id)) continue;
          const start = emitted.get(shape.id);
          if (start === undefined) continue;
          delivered.add(shape.id);
          latencies.push(performance.now() - start);
        }
      }
    });
  }
  ws.on('close', (code, reason) => {
    const key = code + ' ' + reason.toString();
    disconnected[key] = (disconnected[key] ?? 0) + 1;
  });
  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('Socket did not sync')), 10_000);
    ws.on('error', error => { errors++; reject(error); });
    ws.on('message', raw => {
      const frame = JSON.parse(String(raw)) as ServerFrame;
      if (frame.type === 'ack') {
        acknowledgements++;
      } else if (frame.type === 'update' || frame.type === 'snapshot') {
        Y.applyUpdate(doc, Buffer.from(frame.data, 'base64'), remote);
        if (frame.type === 'snapshot') {
          clearTimeout(deadline);
          resolve();
        }
      }
    });
  });
  return async (start: number) => {
    for (let step = 0; step < seconds; step++) {
      const scheduled = start + step * 1000 + 1000 * i / count;
      await sleep(Math.max(0, scheduled - performance.now()));
      const key = i + '/' + step;
      emitted.set(key, performance.now());
      schedulingDrift.push(performance.now() - scheduled);
      shapes.push([{ id: key, kind: 'pen', color: '#172b2a', points: [{ x: i, y: step }, { x: i + 1, y: step }] }]);
    }
  };
}

try {
  const writers = await Promise.all(Array.from({ length: count }, (_, i) => connect(i)));
  const start = performance.now() + 200;
  await Promise.all(writers.map(write => write(start)));
  const edits = count * seconds;
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline && sockets.some(({ doc }) => doc.getArray('shapes').length < edits)) {
    await sleep(25);
  }
  const checksums = new Set(sockets.map(({ doc }) =>
    createHash('sha256').update(JSON.stringify(doc.getArray('shapes').toArray())).digest('hex')));
  latencies.sort((a, b) => a - b);
  schedulingDrift.sort((a, b) => a - b);
  const p95 = (values: number[]) => values[Math.ceil(0.95 * values.length) - 1] ?? null;
  const result = {
    tested_commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    environment: platform() + '/' + arch() + ' ' + release(),
    node: process.version,
    connected_clients: sockets.filter(({ ws }) => ws.readyState === WebSocket.OPEN).length,
    backends: hosts.length, duration_seconds: seconds, edits_sent: edits, acknowledgements,
    cross_backend_deliveries: latencies.length,
    p95_cross_backend_delivery_ms: p95(latencies),
    p95_load_generator_drift_ms: p95(schedulingDrift),
    all_clients_converged: checksums.size === 1 && sockets.every(({ doc }) => doc.getArray('shapes').length === edits),
    errors, disconnected, timestamp_utc: new Date().toISOString(),
  };
  await mkdir('results', { recursive: true });
  await writeFile('results/load.json', JSON.stringify(result, null, 2) + '\n');
  console.log(result);
  if (!result.all_clients_converged || acknowledgements !== edits || errors ||
      result.connected_clients !== count || latencies.length !== edits) process.exitCode = 1;
} finally {
  for (const { ws, doc } of sockets) {
    ws.close();
    doc.destroy();
  }
}
