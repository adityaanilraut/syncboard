import * as Y from 'yjs';
import { bounds, decode, encode, isShape, parseClientFrame, roomPattern } from '../src/protocol.js';

const id = 'a1111111-b222-4333-a444-555555555555';
const point = { x: 12, y: -5 };
const valid = { kind: 'pen', color: '#123abc', points: [point, { x: 0, y: 1 }] };

test.each([
  ['v4 room', id, true],
  ['another variant', id.replace('-a444-', '-b444-'), true],
  ['variant 8', id.replace('-a444-', '-8444-'), true],
  ['variant 9', id.replace('-a444-', '-9444-'), true],
  ['uppercase', id.toUpperCase(), false],
  ['not v4', id.replace('-4333-', '-7333-'), false],
  ['wrong variant', id.replace('-a444-', '-c444-'), false],
  ['extra segment', id + '/extra', false],
  ['short token', id.slice(1), false],
  ['query suffix', id + '?room', false],
])('room format accepts only canonical IDs (%s)', (_name, room, expected) => {
  expect(roomPattern.test(room)).toBe(expected);
});

test.each([
  ['normal', point.x, point.y],
  ['zero', 0, 0],
  ['max x', 100_000, 1],
  ['min x', -100_000, 1],
  ['max y', 1, 100_000],
  ['min y', 1, -100_000],
  ['fractional pointer', 0.5, -0.5],
])('accepts coordinates in range (%s)', (_name, x, y) => {
  expect(parseClientFrame(JSON.stringify({ type: 'cursor', x, y }))).toEqual({ type: 'cursor', x, y });
});

test.each([
  ['bad JSON', 'junk'],
  ['null', 'null'],
  ['array', '[]'],
  ['number', '0'],
  ['unknown type', '{"type":"snapshot"}'],
  ['missing type', '{"x":0,"y":0}'],
  ['missing x', '{"type":"cursor","y":1}'],
  ['missing y', '{"type":"cursor","x":1}'],
  ['string coordinate', '{"type":"cursor","x":"1","y":2}'],
  ['infinite number', '{"type":"cursor","x":1e1000,"y":2}'],
  ['out of range x', '{"type":"cursor","x":100001,"y":2}'],
  ['out of range y', '{"type":"cursor","x":1,"y":-100001}'],
  ['unknown update id', '{"type":"update","data":"AAA="}'],
  ['zero update id', '{"type":"update","id":0,"data":"AAA="}'],
  ['negative update id', '{"type":"update","id":-1,"data":"AAA="}'],
  ['fractional update id', '{"type":"update","id":1.2,"data":"AAA="}'],
  ['unsafe update id', '{"type":"update","id":9007199254740992,"data":"AAA="}'],
  ['string update id', '{"type":"update","id":"1","data":"AAA="}'],
  ['empty update', '{"type":"update","id":1,"data":""}'],
  ['missing update', '{"type":"update","id":1}'],
  ['invalid base64 length', '{"type":"update","id":1,"data":"AA"}'],
  ['invalid base64 character', '{"type":"update","id":1,"data":"AA%="}'],
  ['only padding', '{"type":"update","id":1,"data":"===="}'],
  ['oversized update', JSON.stringify({ type: 'update', id: 1, data: 'A'.repeat(65540) })],
])('rejects malformed frames (%s)', (_name, raw) => {
  expect(parseClientFrame(raw)).toBeUndefined();
});

test.each([
  ['single byte', 1, 'AA=='],
  ['two bytes', 2, 'AAA='],
  ['three bytes', 3, 'AAAA'],
  ['largest safe id', Number.MAX_SAFE_INTEGER, 'AA=='],
  ['maximum payload', 4, 'A'.repeat(65536)],
])('accepts valid update envelopes (%s)', (_name, id, data) => {
  expect(parseClientFrame(JSON.stringify({ type: 'update', id, data, spoofed: 'ignored' })))
    .toEqual({ type: 'update', id, data });
});

test.each([
  ['freehand', valid, true],
  ['rectangle', { ...valid, kind: 'rect' }, true],
  ['ellipse', { ...valid, kind: 'ellipse' }, true],
  ['uppercase hex', { ...valid, color: '#12ABCD' }, true],
  ['missing shape', undefined, false],
  ['null shape', null, false],
  ['primitive', 'shape', false],
  ['unknown tool', { ...valid, kind: 'triangle' }, false],
  ['CSS injection', { ...valid, color: 'url(https://example.com)' }, false],
  ['short hex', { ...valid, color: '#abc' }, false],
  ['numeric color', { ...valid, color: 123 }, false],
  ['no point array', { ...valid, points: {} }, false],
  ['single point', { ...valid, points: [point] }, false],
  ['1000 points', { ...valid, points: Array(1000).fill(point) }, true],
  ['too many points', { ...valid, points: Array(1001).fill(point) }, false],
  ['null point', { ...valid, points: [point, null] }, false],
  ['bad x', { ...valid, points: [point, { x: NaN, y: 0 }] }, false],
  ['bad y', { ...valid, points: [point, { x: 0, y: Infinity }] }, false],
])('validates stored shapes before rendering (%s)', (_name, shape, expected) => {
  expect(isShape(shape)).toBe(expected);
});

test.each([
  [{ x: 4, y: 9 }, { x: 10, y: 20 }, { x: 4, y: 9, width: 6, height: 11 }],
  [{ x: 10, y: 20 }, { x: 4, y: 9 }, { x: 4, y: 9, width: 6, height: 11 }],
  [{ x: 4, y: 20 }, { x: 10, y: 9 }, { x: 4, y: 9, width: 6, height: 11 }],
  [{ x: 0, y: 0 }, { x: -4, y: 4 }, { x: -4, y: 0, width: 4, height: 4 }],
  [{ x: 4, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 4, width: 0, height: 0 }],
])('normalizes shape drags from %j to %j', (a, b, expected) => {
  expect(bounds(a, b)).toEqual(expected);
});

test.each([[], [0], [0, 128], [0, 128, 255], Array.from({ length: 256 }, (_, i) => i)].map(bytes => [bytes]))(
  'round-trips binary update bytes (%j)', (bytes) => {
    const value = Uint8Array.from(bytes);
    expect(decode(encode(value))).toEqual(value);
  },
);

test.each([[0,1,2], [0,2,1], [1,0,2], [1,2,0], [2,0,1], [2,1,0]])(
  'concurrent Yjs edits converge when delivered in order %i/%i/%i', (a, b, c) => {
    const sources = Array.from({ length: 3 }, () => new Y.Doc());
    const updates = sources.map((source, index) => {
      source.getArray('shapes').push([{ ...valid, color: '#' + String(index).padStart(6, '0') }]);
      return Y.encodeStateAsUpdate(source);
    });
    const expected = new Y.Doc();
    const replayed = new Y.Doc();
    updates.forEach(update => Y.applyUpdate(expected, update));
    [a, b, c, b, a].forEach(index => Y.applyUpdate(replayed, updates[index]));
    expect(replayed.getArray('shapes').toArray()).toEqual(expected.getArray('shapes').toArray());
    [...sources, expected, replayed].forEach(doc => doc.destroy());
  },
);
