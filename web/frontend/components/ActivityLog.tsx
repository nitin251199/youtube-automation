'use client';
import { useEffect, useRef, useState } from 'react';
import type { JobEvent } from '@/lib/api';

export function ActivityLog({ events }: { events: JobEvent[] }) {
  const [technical, setTechnical] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const pinned = useRef(true);
  const shown = events.filter(e => technical || (e.source !== 'stderr' && e.message));
  const hidden = events.filter(e => e.source === 'stderr').length;

  useEffect(() => {
    const el = list.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [shown.length]);

  return (
    <section className="card log-card">
      <div className="card-head">
        <h2>Activity</h2>
        <label className="check small">
          <input type="checkbox" checked={technical} onChange={e => setTechnical(e.target.checked)} />
          <span>Technical output{hidden ? ` (${hidden})` : ''}</span>
        </label>
      </div>
      <ol className="log" ref={list} onScroll={e => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
        {shown.length === 0 && <li className="muted empty">Waiting for the first update…</li>}
        {shown.map(e => (
          <li key={e._id} className={`log-${e.source} log-${e.event}`}>
            <time>{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })}</time>
            <span>{e.message}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
