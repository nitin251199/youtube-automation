import { RUNNING, type Counter, type Job, type JobStatus } from '@/lib/api';

type State = 'done' | 'active' | 'pending' | 'failed';
interface Step { key: string; label: string; phase: number; counter?: Counter; detail: string }

const PHASE: Partial<Record<JobStatus, number>> = {
  scripting: 0, planned: 1, generating: 1, narrating: 2, mixing: 3, rendering: 4,
  awaiting_approval: 5, uploading: 5, approved: 6, uploaded: 6, rejected: 6,
};
const complete = (c?: Counter) => Boolean(c && c.total > 0 && c.done >= c.total);

export function StageProgress({ job }: { job: Job }) {
  const s = job.stages;
  const steps: Step[] = [
    { key: 'script', label: 'Scene plan', phase: 0, counter: s.script, detail: 'Groq: characters, backgrounds, 12 scenes' },
    { key: 'characters', label: 'Characters', phase: 1, counter: s.characters, detail: 'Flow reference images' },
    { key: 'backgrounds', label: 'Backgrounds', phase: 1, counter: s.backgrounds, detail: 'Flow reference images' },
    { key: 'scenes', label: 'Scene videos', phase: 1, counter: s.scenes, detail: 'Flow clips, downloaded' },
    { key: 'narration', label: 'Narration', phase: 2, counter: s.narration.total ? s.narration : undefined, detail: 'Google AI Studio voice' },
    { key: 'mix', label: 'Music & mix', phase: 3, detail: 'Freesound bed, speaker-aware edit' },
    { key: 'render', label: 'Intro, title, logo', phase: 4, detail: 'Final render' },
    { key: 'review', label: 'Your review', phase: 5, detail: job.status === 'uploaded' ? 'Uploaded to YouTube' : job.status === 'approved' ? 'Approved, not uploaded yet' : 'Approve or reject' },
  ];
  const failed = job.status === 'failed';
  // Without a live phase (queued, failed, cancelled), the first unfinished counted step is where work stands.
  const phase = PHASE[job.status] ?? (job.failedPhase === 'upload' ? 5 : steps.find(step => !complete(step.counter))?.phase ?? 0);
  const moving = RUNNING.includes(job.status) || job.status === 'awaiting_approval' || job.status === 'uploading';
  let marked = false;

  const state = (step: Step): State => {
    if (complete(step.counter) || step.phase < phase || job.status === 'uploaded') return 'done';
    if (step.phase !== phase || marked) return 'pending';
    if (failed) { marked = true; return 'failed'; }
    if (!moving) return 'pending';
    marked = true;
    return 'active';
  };

  return (
    <ol className="stepper">
      {steps.map(step => {
        const st = state(step);
        const c = step.counter;
        return (
          <li key={step.key} className={`step step-${st}`}>
            <span className="step-icon" aria-hidden>{st === 'done' ? '✓' : st === 'failed' ? '!' : ''}</span>
            <div className="step-body">
              <strong>{step.label}{c && c.total > 0 && <em> {c.done}/{c.total}</em>}</strong>
              <small>{step.detail}</small>
              {c && c.total > 0 && st !== 'pending' && <div className="mini-bar"><span style={{ width: `${Math.round(100 * Math.min(1, c.done / c.total))}%` }} /></div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
