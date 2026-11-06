'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api, RUNNING, timeAgo, type Job } from '@/lib/api';
import { useJobStream } from '@/lib/useJobStream';
import { useSystemStatus } from '@/components/SetupChecklist';
import { StatusBadge } from '@/components/StatusBadge';
import { StageProgress } from '@/components/StageProgress';
import { AttentionBanner } from '@/components/AttentionBanner';
import { ReviewPanel } from '@/components/ReviewPanel';
import { ScenePlan } from '@/components/ScenePlan';
import { ActivityLog } from '@/components/ActivityLog';

type Action = 'start' | 'resume' | 'cancel' | 'approve' | 'reject' | 'upload';

export default function VideoPage() {
  const { id } = useParams<{ id: string }>();
  const { job, setJob, events, connected, missing } = useJobStream(id);
  const { status: system } = useSystemStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function act(action: Action) {
    setBusy(true); setError('');
    try { setJob(await api<Job>(`/videos/${id}/${action}`, { method: 'POST' })); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (missing) return <div className="card"><h2>Video not found</h2><Link href="/">Back to videos</Link></div>;
  if (!job) return <div className="card"><p className="muted">{connected ? 'Loading…' : 'Connecting to the backend…'}</p></div>;

  const running = RUNNING.includes(job.status);
  const rendered = Boolean(job.videoPath) && ['awaiting_approval', 'approved', 'uploading', 'uploaded', 'rejected'].includes(job.status)
    || (job.status === 'failed' && job.failedPhase === 'upload');
  const resumable = (job.status === 'failed' && job.failedPhase !== 'upload') || job.status === 'cancelled';

  return (
    <div className="detail">
      <div className="detail-head">
        <div>
          <Link href="/" className="back">← All videos</Link>
          <h1 lang="hi">{job.title}</h1>
          <p className="muted small">
            {job.projectId} · created {timeAgo(job.createdAt)}
            {job.assets.mode === 'video' ? ' · per-video logo/intro' : ''}
            {!connected && <span className="warn-text"> · reconnecting…</span>}
          </p>
        </div>
        <div className="head-actions">
          <StatusBadge job={job} />
          {running && <button className="ghost danger" disabled={busy} onClick={() => act('cancel')}>Stop</button>}
          {(job.status === 'queued' || job.status === 'planned') && <button className="ghost" disabled={busy} onClick={() => act('cancel')}>Cancel</button>}
          {resumable && <button className="primary" disabled={busy} onClick={() => act('resume')}>Resume</button>}
        </div>
      </div>

      {job.needsAttention && <AttentionBanner attention={job.needsAttention} />}
      {job.status === 'failed' && job.error && (
        <div className="problem" role="alert">
          <strong>{job.error.startsWith('Stopped') ? 'Stopped' : job.failedPhase === 'upload' ? 'Upload problem' : 'The run stopped with an error'}</strong>
          <p>{job.error}</p>
          {resumable && <small>Resume continues from saved progress: finished Flow items are never submitted again.</small>}
        </div>
      )}
      {error && <p className="error-text" role="alert">{error}</p>}

      <section className="card">
        <div className="card-head">
          <h2>Progress</h2>
          <span className="muted small">
            {job.status === 'queued' && job.queuePosition ? `Position ${job.queuePosition} in the queue · ` : ''}
            {job.activity}
          </span>
        </div>
        <StageProgress job={job} />
      </section>

      {job.status === 'planned' && (
        <div className="callout">
          <div>
            <strong>Scene plan ready</strong>
            <p className="muted">Check the characters and 12 scenes below. Starting generation uses Google Flow credits on the signed-in account.</p>
          </div>
          <button className="primary" disabled={busy} onClick={() => act('start')}>Start Flow generation</button>
        </div>
      )}

      <div className="detail-grid">
        <div className="detail-main">
          {rendered && <ReviewPanel job={job} visibility={system?.visibility} uploadsEnabled={system?.uploadsEnabled ?? false} busy={busy} onDecide={act} />}
          {job.plan && <ScenePlan plan={job.plan} open={job.status === 'planned' || !rendered} />}
          {!job.plan && <section className="card"><h2>Script</h2><pre className="script" lang="hi">{job.script}</pre></section>}
        </div>
        <ActivityLog events={events} />
      </div>
    </div>
  );
}
