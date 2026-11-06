import { config } from './config.js';
import { JobModel, RUNNING } from './models/Job.js';
import { logEvent, updateJob } from './jobs.js';
import { PipelineRunner } from './pipeline/runner.js';
import type { Bus } from './bus.js';

// One job at a time per Google Flow profile: Flow drives a single logged-in browser
// and spends real credits, so generations never run in parallel on one account.
export class JobQueue {
  private active = new Map<string, PipelineRunner>();
  private kicking = false;
  private again = false;
  private closed = false;

  constructor(private bus: Bus) {}

  /** Jobs left mid-run by a previous backend process are marked for an explicit resume. */
  async recover() {
    const interrupted = await JobModel.find({ status: { $in: [...RUNNING, 'uploading'] } });
    for (const job of interrupted) {
      const upload = job.status === 'uploading';
      const error = upload
        ? 'The backend stopped during upload. Check the Zernio dashboard before retrying.'
        : 'The backend stopped during this run. Saved progress is kept; press Resume to continue without resubmitting finished work.';
      await updateJob(this.bus, String(job._id), { status: 'failed', failedPhase: upload ? 'upload' : 'production', error, activity: '', needsAttention: null });
      await logEvent(this.bus, String(job._id), { event: 'interrupted', message: error, source: 'system' });
    }
  }

  activeJobId(profile = 'default') { return this.active.get(profile)?.jobId; }
  isActive(jobId: string) { return [...this.active.values()].some(r => r.jobId === jobId); }

  async position(jobId: string): Promise<number | null> {
    const job = await JobModel.findById(jobId, { status: 1, createdAt: 1, flowProfile: 1 });
    if (!job || job.status !== 'queued') return null;
    return 1 + await JobModel.countDocuments({ status: 'queued', flowProfile: job.flowProfile, createdAt: { $lt: job.createdAt } });
  }

  kick() { void this.drain(); }

  stop(jobId: string) {
    for (const runner of this.active.values()) if (runner.jobId === jobId) runner.stop();
  }

  async shutdown() {
    this.closed = true;
    const runners = [...this.active.values()];
    runners.forEach(r => r.stop());
    const deadline = Date.now() + 8000;
    while (this.active.size && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
  }

  private async drain() {
    if (this.closed) return;
    if (this.kicking) { this.again = true; return; }
    this.kicking = true;
    this.again = false;
    try {
      for (const profile of Object.keys(config.profiles)) {
        if (this.active.has(profile)) continue;
        const job = await JobModel.findOneAndUpdate(
          { status: 'queued', flowProfile: profile },
          { $set: { status: 'scripting', activity: 'Starting' } },
          { sort: { createdAt: 1 }, returnDocument: 'after' },
        );
        if (!job) continue;
        const runner = new PipelineRunner(this.bus, job);
        this.active.set(profile, runner);
        void runner.run().finally(() => { this.active.delete(profile); this.kick(); });
      }
    } finally {
      this.kicking = false;
      if (this.again) this.kick();
    }
  }
}
