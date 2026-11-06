'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, timeAgo, type Job } from '@/lib/api';
import { StatusBadge } from './StatusBadge';

export function VideoList() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const load = () => api<{ jobs: Job[] }>('/videos').then(r => { if (alive) { setJobs(r.jobs); setError(''); } }).catch(e => alive && setError(e.message));
    load();
    const timer = setInterval(load, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  return (
    <section className="card">
      <h2>Videos</h2>
      {error && <p className="error-text">{error}</p>}
      {!jobs && !error && <p className="muted">Loading…</p>}
      {jobs?.length === 0 && <p className="muted">No videos yet. Paste a script to make the first one.</p>}
      <ul className="video-list">
        {jobs?.map(job => {
          const s = job.stages;
          const done = s.scenes.done + s.characters.done + s.backgrounds.done;
          const total = Math.max(1, s.scenes.total + s.characters.total + s.backgrounds.total);
          return (
            <li key={job.id}>
              <Link href={`/videos/${job.id}`}>
                <div className="video-row">
                  <strong className="video-title">{job.title}</strong>
                  <StatusBadge job={job} />
                </div>
                <div className="video-meta">
                  <span>{timeAgo(job.createdAt)}</span>
                  {job.activity && <span className="ellipsis">{job.activity}</span>}
                </div>
                <div className="mini-bar"><span style={{ width: `${Math.round(100 * done / total)}%` }} /></div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
