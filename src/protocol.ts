export type Point = { x: number; y: number };
export type Shape = {
  kind: 'pen' | 'rect' | 'ellipse';
  color: string;
  points: Point[];
};

export type ClientFrame =
  | { type: 'update'; id: number; data: string }
  | { type: 'cursor'; x: number; y: number };

export type ServerFrame =
  | { type: 'snapshot' | 'update'; data: string }
  | { type: 'ack'; id: number }
  | { type: 'cursor'; user: string; x: number; y: number }
  | { type: 'leave'; user: string };

export const roomPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const maxUpdateBytes = 48 * 1024;

function coordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 100_000;
}

export function parseClientFrame(raw: string): ClientFrame | undefined {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return; }
  if (typeof value !== 'object' || value === null) return;
  const frame = value as Record<string, unknown>;
  if (frame.type === 'update' && typeof frame.id === 'number' &&
      Number.isSafeInteger(frame.id) && frame.id > 0 && typeof frame.data === 'string' &&
      frame.data.length > 0 && frame.data.length <= maxUpdateBytes * 4 / 3 &&
      frame.data.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(frame.data)) {
    return { type: 'update', id: frame.id, data: frame.data };
  }
  if (frame.type === 'cursor' && coordinate(frame.x) && coordinate(frame.y)) {
    return { type: 'cursor', x: frame.x, y: frame.y };
  }
}

export function isShape(value: unknown): value is Shape {
  if (typeof value !== 'object' || value === null) return false;
  const shape = value as Partial<Shape>;
  return (shape.kind === 'pen' || shape.kind === 'rect' || shape.kind === 'ellipse') &&
    typeof shape.color === 'string' && /^#[0-9a-f]{6}$/i.test(shape.color) &&
    Array.isArray(shape.points) && shape.points.length >= 2 && shape.points.length <= 1000 &&
    shape.points.every(point => point && coordinate(point.x) && coordinate(point.y));
}

export function bounds(a: Point, b: Point) {
  return {
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y),
  };
}

export function encode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decode(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
}
