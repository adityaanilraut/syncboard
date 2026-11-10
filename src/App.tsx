import { useEffect, useRef, useState, type PointerEvent } from 'react';
import * as Y from 'yjs';
import { BoardConnection, type ConnectionStatus, type Cursors } from './connection.js';
import { bounds, isShape, roomPattern, type Point, type Shape } from './protocol.js';
import './style.css';

const colors = ['#172b2a', '#257969', '#cf5539', '#254eb3', '#8d4fa8'];
const tools: { kind: Shape['kind']; label: string; icon: string }[] = [
  { kind: 'pen', label: 'Pen', icon: '✎' },
  { kind: 'rect', label: 'Rectangle', icon: '□' },
  { kind: 'ellipse', label: 'Ellipse', icon: '○' },
];

function ShapeElement({ shape }: { shape: Shape }) {
  const stroke = { stroke: shape.color, strokeWidth: 4, fill: 'none' };
  if (shape.kind === 'pen') {
    return <polyline {...stroke} strokeLinejoin="round" strokeLinecap="round"
      points={shape.points.map(point => point.x + ',' + point.y).join(' ')} />;
  }
  const rect = bounds(shape.points[0], shape.points[shape.points.length - 1]);
  if (shape.kind === 'rect') return <rect {...stroke} {...rect} rx={4} />;
  return <ellipse {...stroke} cx={rect.x + rect.width / 2} cy={rect.y + rect.height / 2}
    rx={rect.width / 2} ry={rect.height / 2} />;
}

function Board({ room }: { room: string }) {
  const [doc] = useState(() => new Y.Doc());
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [tool, setTool] = useState<Shape['kind']>('pen');
  const [color, setColor] = useState(colors[0]);
  const [draft, setDraft] = useState<Shape>();
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [cursors, setCursors] = useState<Cursors>(new Map());
  const [copied, setCopied] = useState(false);
  const connection = useRef<BoardConnection>(null);
  const gesture = useRef<Shape>(undefined);

  useEffect(() => {
    const board = doc.getArray('shapes');
    const refresh = () => setShapes(board.toArray().filter(isShape));
    board.observe(refresh);
    connection.current = new BoardConnection(doc, room, setStatus, setCursors);
    return () => {
      connection.current?.close();
      board.unobserve(refresh);
      doc.destroy();
    };
  }, [doc, room]);

  function point(event: PointerEvent<SVGSVGElement>): Point {
    const matrix = event.currentTarget.getScreenCTM();
    const screen = new DOMPoint(event.clientX, event.clientY);
    const result = matrix ? screen.matrixTransform(matrix.inverse()) : screen;
    return { x: Math.round(result.x), y: Math.round(result.y) };
  }

  function start(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || gesture.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const first = point(event);
    gesture.current = { kind: tool, color, points: [first, first] };
    setDraft(gesture.current);
  }

  function move(event: PointerEvent<SVGSVGElement>) {
    const position = point(event);
    connection.current?.cursor(position.x, position.y);
    const shape = gesture.current;
    if (!shape) return;
    if (shape.kind === 'pen' && shape.points.length >= 1000) return;
    const points = shape.kind === 'pen' ? [...shape.points, position] : [shape.points[0], position];
    gesture.current = { ...shape, points };
    setDraft(gesture.current);
  }

  function finish(event: PointerEvent<SVGSVGElement>) {
    move(event);
    if (gesture.current && isShape(gesture.current)) doc.getArray('shapes').push([gesture.current]);
    gesture.current = undefined;
    setDraft(undefined);
  }

  async function share() {
    await navigator.clipboard.writeText(location.href);
    setCopied(true);
  }

  return <>
    <header className="topbar">
      <a href="/" className="brand"><span aria-hidden="true">▧</span> SyncBoard</a>
      <span className={'status ' + status} role="status">{status === 'online' ? 'Live' : status}</span>
      <button className="share" onClick={() => void share()}>{copied ? 'Link copied' : 'Copy room link'}</button>
    </header>
    <main className="workspace">
      <div className="toolbar" aria-label="Drawing tools">
        {tools.map(item => <button key={item.kind} aria-label={item.label} title={item.label}
          aria-pressed={tool === item.kind} onClick={() => setTool(item.kind)}>{item.icon}</button>)}
        <span className="separator" />
        {colors.map(item => <button key={item} aria-label={'Ink ' + item} aria-pressed={color === item}
          className="swatch" onClick={() => setColor(item)}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill={item} /></svg>
        </button>)}
      </div>
      <svg className="board" aria-label="Whiteboard canvas" role="img" viewBox="0 0 1200 720"
        preserveAspectRatio="xMidYMid meet" onPointerDown={start} onPointerMove={move}
        onPointerUp={finish} onPointerCancel={() => { gesture.current = undefined; setDraft(undefined); }}>
        <g data-testid="shapes">{shapes.map((shape, index) => <ShapeElement key={index} shape={shape} />)}</g>
        {draft && <ShapeElement shape={draft} />}
        {[...cursors].map(([id, cursor]) => <g key={id} transform={`translate(${cursor.x},${cursor.y})`}>
          <path d="M 0 0 L 16 7 L 7 9 L 5 17 Z" fill="#257969" stroke="white" strokeWidth={1} />
        </g>)}
      </svg>
      <p className="footnote">Room {room.slice(0, 8)} · {shapes.length} marks</p>
    </main>
  </>;
}

export default function App() {
  const room = location.pathname.split('/')[2] ?? '';
  if (roomPattern.test(room)) return <Board room={room} />;
  return <main className="welcome">
    <div className="welcome-card">
      <p className="brand"><span aria-hidden="true">▧</span> SyncBoard</p>
      <h1>A whiteboard you can share</h1>
      <p>Start a board, draw together, and come back to the same room link later.</p>
      <button className="share" onClick={() => location.assign('/room/' + crypto.randomUUID())}>Create a room</button>
    </div>
  </main>;
}
