'use client';

// "Team map": a flat node diagram of how work flows, Supervisor → connections (accounts / API keys) → models.
// Static layout in three CSS columns with an SVG overlay for the curved edges (no extra dependency).
// An edge is animated while that connection is running a job, so the map doubles as live status.

import { useCallback, useEffect, useRef, useState } from 'react';

export default function TeamMap({ supervisor, connections, models }) {
  const box = useRef(null);
  const [edges, setEdges] = useState([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const measure = useCallback(() => {
    const root = box.current;
    if (!root) return;
    const r = root.getBoundingClientRect();
    const at = (id, side) => {
      const el = root.querySelector(`[data-node="${CSS.escape(id)}"]`);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: (side === 'right' ? b.right : b.left) - r.left, y: b.top + b.height / 2 - r.top };
    };
    const out = [];
    for (const c of connections) {
      const a = at('supervisor', 'right');
      const b = at(`c:${c.id}`, 'left');
      if (a && b) out.push({ key: `s-${c.id}`, a, b, active: c.busy, muted: c.status !== 'ok' });
      for (const m of c.models) {
        const a2 = at(`c:${c.id}`, 'right');
        const b2 = at(`m:${m}`, 'left');
        if (a2 && b2) out.push({ key: `${c.id}-${m}`, a: a2, b: b2, active: c.busy, muted: c.status !== 'ok' });
      }
    }
    setSize({ w: r.width, h: r.height });
    setEdges(out);
  }, [connections]);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [measure]);

  const path = ({ a, b }) => {
    const dx = Math.max(24, (b.x - a.x) / 2);
    return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
  };

  return (
    <div className="team-map" ref={box}>
      <svg className="edges" width={size.w} height={size.h} aria-hidden="true">
        {edges.map((e) => <path key={e.key} d={path(e)} className={`edge${e.active ? ' active' : ''}${e.muted ? ' muted' : ''}`} />)}
      </svg>
      <div className="map-col">
        <div className="map-col-label">Supervisor</div>
        <div className="node" data-node="supervisor" data-kind="supervisor" data-status={supervisor.on ? 'ok' : 'bad'}>
          <div className="node-head"><b>{supervisor.label}</b></div>
          <div className="node-body">{supervisor.on ? 'Answers in seconds and plans the steps' : 'Off: add a free GROQ_API_KEY in Vercel'}</div>
        </div>
      </div>
      <div className="map-col">
        <div className="map-col-label">Connections</div>
        {connections.map((c) => (
          <a key={c.id} href={`#agent-${c.id}`} className="node" data-node={`c:${c.id}`} data-status={c.status}>
            <div className="node-head"><b>{c.label}</b><span className={`status ${c.status}`}>{c.word}</span></div>
            <div className="node-body">
              {c.left !== null ? <div className="node-meter"><div className={`meter ${c.left <= 10 ? 'bad' : c.left <= 30 ? 'warn' : ''}`}><span style={{ width: `${c.left}%` }} /></div><span className="num">{c.left}%</span></div> : <span>{c.plan}</span>}
              {c.busy ? <span className="node-busy">Working on a job</span> : null}
            </div>
          </a>
        ))}
        {!connections.length ? <a href="#add" className="node" data-node="none"><div className="node-head"><b>+ Add a connection</b></div></a> : null}
      </div>
      <div className="map-col">
        <div className="map-col-label">Models in use</div>
        {models.map((m) => (
          <div key={m.id} className="node small" data-node={`m:${m.id}`}>
            <div className="node-head"><b>{m.label}</b></div>
            {m.jobs.length ? <div className="node-body">Best for {m.jobs.join(', ')}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}
