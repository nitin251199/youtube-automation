import { STATUS_LABEL, statusTone, type Job } from '@/lib/api';

export function StatusBadge({ job }: { job: Pick<Job, 'status' | 'needsAttention' | 'error' | 'failedPhase'> }) {
  const tone = statusTone(job);
  let label = job.needsAttention ? 'Needs you' : STATUS_LABEL[job.status];
  if (job.status === 'failed' && job.error?.startsWith('Stopped')) label = 'Stopped';
  if (job.status === 'failed' && job.failedPhase === 'upload') label = 'Upload failed';
  return <span className={`badge badge-${tone}`}><span className="dot" />{label}</span>;
}
