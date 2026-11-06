'use client';
import { useEffect, useState } from 'react';
import { API, type Job, type JobEvent } from './api';

/** Live job state over SSE; EventSource reconnects by itself after network drops. */
export function useJobStream(id: string) {
  const [job, setJob] = useState<Job | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const source = new EventSource(`${API}/api/videos/${id}/stream`);
    const merge = (incoming: JobEvent[]) => setEvents(current => {
      const seen = new Set(current.map(e => e._id));
      const next = [...current, ...incoming.filter(e => !seen.has(e._id))];
      return next.length > 1500 ? next.slice(-1500) : next;
    });
    source.onopen = () => setConnected(true);
    source.onerror = () => {
      setConnected(false);
      fetch(`${API}/api/videos/${id}`).then(r => { if (r.status === 404) { setMissing(true); source.close(); } }).catch(() => {});
    };
    source.addEventListener('job', e => setJob(JSON.parse((e as MessageEvent).data)));
    source.addEventListener('history', e => merge(JSON.parse((e as MessageEvent).data)));
    source.addEventListener('event', e => merge([JSON.parse((e as MessageEvent).data)]));
    return () => source.close();
  }, [id]);

  return { job, setJob, events, connected, missing };
}
