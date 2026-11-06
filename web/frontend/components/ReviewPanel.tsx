'use client';
import { API, type Job } from '@/lib/api';

export function ReviewPanel({ job, visibility, uploadsEnabled, busy, onDecide }: {
  job: Job; visibility?: string; uploadsEnabled: boolean; busy: boolean; onDecide: (decision: 'approve' | 'reject' | 'upload') => void;
}) {
  const zernioHint = <p className="muted small">Zernio is not configured yet. Add <code>ZERNIO_API_KEY</code> and <code>ZERNIO_YOUTUBE_ACCOUNT_ID</code> to <code>scripting/.env</code> to upload; this page picks it up by itself.</p>;
  const src = `${API}/api/videos/${job.id}/file?v=${encodeURIComponent(job.finishedAt ?? job.updatedAt)}`;
  return (
    <section className="card review">
      <video className="player" src={src} controls preload="metadata" playsInline />
      <div className="review-body">
        {job.status === 'awaiting_approval' && <>
          <h2>Is this video good enough to upload to YouTube?</h2>
          {uploadsEnabled
            ? <p className="muted">Approving uploads this exact file through Zernio{visibility ? <> as <strong>{visibility}</strong></> : null}, right away, with no second confirmation. Rejecting uploads nothing.</p>
            : <p className="muted">Uploading is off until Zernio is configured, so approving only records your decision and nothing is uploaded. You can upload the approved video later.</p>}
          <p className="muted small">Watch the whole video first: check lip-sync, voices and that backgrounds stay consistent between shots.</p>
          <div className="actions">
            <button className="primary" disabled={busy} onClick={() => onDecide('approve')}>{uploadsEnabled ? 'Approve & upload' : 'Approve'}</button>
            <button className="ghost danger" disabled={busy} onClick={() => onDecide('reject')}>Reject</button>
            <a className="link" href={`${src}&download=1`}>Download MP4</a>
          </div>
        </>}
        {job.status === 'approved' && <>
          <h2>Approved, not uploaded yet</h2>
          {uploadsEnabled
            ? <p className="muted">Zernio is configured now. Uploading sends this exact approved file{visibility ? <> as <strong>{visibility}</strong></> : null}.</p>
            : zernioHint}
          <div className="actions">
            <button className="primary" disabled={busy || !uploadsEnabled} onClick={() => onDecide('upload')}>Upload to YouTube</button>
            <a className="link" href={`${src}&download=1`}>Download MP4</a>
          </div>
        </>}
        {job.status === 'uploading' && <><h2>Uploading…</h2><p className="muted">Sending the approved file to YouTube through Zernio. You can leave this page.</p></>}
        {job.status === 'uploaded' && <>
          <h2>{job.review.status === 'posted' ? 'Published to YouTube' : 'Submitted to YouTube'}</h2>
          <p className="muted">{job.review.status === 'posted' ? 'YouTube has published the video.' : 'Zernio accepted the post. YouTube may still be processing it; follow it in the Zernio dashboard.'}</p>
          <div className="actions">
            {job.review.youtubeUrl && <a className="primary button" href={job.review.youtubeUrl} target="_blank" rel="noreferrer">Open on YouTube</a>}
            <a className="link" href={`${src}&download=1`}>Download MP4</a>
          </div>
        </>}
        {job.status === 'rejected' && <><h2>Rejected</h2><p className="muted">Nothing was uploaded. The rendered file stays on disk at <code>{job.videoPath}</code>.</p></>}
        {job.status === 'failed' && job.failedPhase === 'upload' && <>
          <h2>Upload did not finish</h2>
          <p className="muted">{job.review.status === 'submitting'
            ? 'A post request had already started, so retrying here is blocked to avoid a duplicate. Check the Zernio dashboard first.'
            : 'Nothing was posted. Fix the problem shown above, then retry.'}</p>
          {!uploadsEnabled && zernioHint}
          <div className="actions">
            <button className="primary" disabled={busy || !uploadsEnabled || job.review.status === 'submitting'} onClick={() => onDecide('upload')}>Retry upload</button>
            <a className="link" href={`${src}&download=1`}>Download MP4</a>
          </div>
        </>}
        <p className="path small"><code>{job.videoPath}</code></p>
      </div>
    </section>
  );
}
