import fs from 'node:fs/promises';
import path from 'node:path';
import { config, pipelineEnv, productionDir, python, repoRoot, scriptingDir } from '../config.js';
import { JobModel, type JobDoc, type JobStatus } from '../models/Job.js';
import { counts, isPlanned, logEvent, readProject, updateJob } from '../jobs.js';
import type { Bus } from '../bus.js';
import { ProgressInterpreter, errorFrom, type Attention, type Update } from './progress.js';
import { track, type Tracked } from './process.js';
import type { Parsed } from './jsonLines.js';

const TRANSIENT_ATTENTION = new Set(['flow_sign_in', 'ai_studio_sign_in', 'ai_studio_run']);

/** Runs one job's pipeline: Groq scripting, then the unchanged start-video workflow. */
export class PipelineRunner {
  private current?: Tracked;
  private stopped = false;
  private chain: Promise<unknown> = Promise.resolve();
  private attentionTimer?: NodeJS.Timeout;
  private recountTimer?: NodeJS.Timeout;
  private status?: JobStatus;

  constructor(private bus: Bus, private job: JobDoc) {}

  get jobId() { return String(this.job._id); }

  stop() { this.stopped = true; this.current?.stop(); }

  async run(): Promise<void> {
    try {
      await this.set({ status: 'scripting', error: null, failedPhase: null, needsAttention: null, startedAt: new Date(), finishedAt: null, runs: (this.job.runs ?? 0) + 1, activity: 'Starting' });
      if (!isPlanned(await readProject(this.job.projectFile))) {
        if (!await this.scripting()) return;
        const fresh = await JobModel.findById(this.job._id);
        if (fresh?.pauseAfterScript && !fresh.planApproved) {
          await this.set({ status: 'planned', activity: 'Scene plan ready. Review it, then start Flow generation.', finishedAt: new Date() });
          return;
        }
      }
      await this.production();
    } catch (error: any) {
      await this.fail('production', error?.message ?? String(error));
    } finally {
      clearTimeout(this.attentionTimer); clearTimeout(this.recountTimer);
      await this.chain;
    }
  }

  private async scripting(): Promise<boolean> {
    const { projectId, projectFile, title, concept, script } = this.job;
    const scriptFile = path.join(path.dirname(projectFile), 'script.txt');
    await fs.mkdir(path.dirname(projectFile), { recursive: true });
    await fs.writeFile(scriptFile, script, 'utf8');
    await this.set({ status: 'scripting', activity: 'Reading the script', 'stages.script.done': 0 });
    const args = ['-m', 'pipeline.from_script', '--project-id', projectId, '--script-file', scriptFile, '--title', title, ...(concept ? ['--concept', concept] : [])];
    const { code, stderr } = await this.exec(python(), args, scriptingDir, pipelineEnv({ PROJECTS_DIR: config.projectsDir }));
    if (code !== 0) { await this.fail('scripting', errorFrom(stderr, `Scripting exited with code ${code}.`)); return false; }
    await this.recount();
    return true;
  }

  private async production() {
    const { projectFile, outputDir, assets, flowProfile } = this.job;
    await this.set({ status: 'generating', activity: 'Starting production' });
    await this.recount();
    const extra: Record<string, string> = {};
    if (assets?.mode === 'video' && assets.logoPath) extra.VIDEO_LOGO_PATH = assets.logoPath;
    if (assets?.mode === 'video' && assets.introPath) extra.VIDEO_INTRO_PATH = assets.introPath;
    const profile = config.profiles[flowProfile ?? 'default'] ?? config.profiles.default;
    const args = [path.join(repoRoot, 'start-video.mjs'), '--project', projectFile, '--output-dir', outputDir, '--user-data-dir', profile];
    const { code, stderr } = await this.exec(process.execPath, args, repoRoot, pipelineEnv(extra));
    await this.recount();
    if (code !== 0) return this.fail('production', errorFrom(stderr, `The video workflow exited with code ${code}.`));
    const delivery = JSON.parse(await fs.readFile(path.join(outputDir, 'delivery.json'), 'utf8'));
    await fs.access(delivery.video_path);
    const project = await readProject(projectFile);
    await this.set({
      status: 'awaiting_approval', videoPath: delivery.video_path, activity: 'Waiting for your approval', needsAttention: null,
      'review.status': project?.review?.status ?? 'awaiting_approval', finishedAt: new Date(),
    });
    await this.log({ event: 'awaiting_approval', message: 'Is this video good enough to upload to YouTube?', source: 'system' });
  }

  private exec(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
    const interpreter = new ProgressInterpreter();
    this.current = track(command, args, { cwd, env },
      (parsed: Parsed) => this.enqueue(() => this.apply(interpreter.handle(parsed))),
      line => this.enqueue(() => this.log({ event: 'stderr', message: line, source: 'stderr' })));
    return this.current.done.then(async result => { await this.chain; this.current = undefined; return result; });
  }

  private enqueue(task: () => Promise<unknown>) {
    this.chain = this.chain.then(task).catch(error => console.error('[runner]', error));
  }

  private async apply(update: Update) {
    if (update.log) await this.log({ ...update.log, source: 'pipeline' });
    const set: Record<string, unknown> = {};
    if (update.status && update.status !== this.status) set.status = update.status;
    if (update.activity) set.activity = update.activity;
    for (const [stage, counter] of Object.entries(update.stages ?? {})) {
      for (const [key, value] of Object.entries(counter)) set[`stages.${stage}.${key}`] = value;
    }
    const attention = update.attention;
    if (attention !== undefined) {
      clearTimeout(this.attentionTimer);
      if (attention === null) set.needsAttention = null;
      else if (attention.delayed) this.attentionTimer = setTimeout(() => this.enqueue(() => this.attention(attention)), config.attentionDelayMs);
    }
    if (attention && !attention.delayed) await this.attention(attention, set);
    else if (Object.keys(set).length) await this.set(set);
    if (update.recount) { clearTimeout(this.recountTimer); this.recountTimer = setTimeout(() => this.enqueue(() => this.recount()), 250); }
  }

  private async attention(attention: Attention, set: Record<string, unknown> = {}) {
    await this.set({ ...set, needsAttention: { type: attention.type, message: attention.message, since: new Date() } });
    await this.log({ event: 'needs_attention', message: attention.message, source: 'system' });
  }

  private async recount() {
    const project = await readProject(this.job.projectFile);
    if (!project) return;
    const c = counts(project);
    await this.set({ 'stages.characters': c.characters, 'stages.backgrounds': c.backgrounds, 'stages.scenes': c.scenes });
  }

  private async fail(phase: 'scripting' | 'production', message: string) {
    const job = await JobModel.findById(this.job._id);
    const keep = job?.needsAttention && !TRANSIENT_ATTENTION.has(job.needsAttention.type ?? '');
    const error = this.stopped ? 'Stopped. Saved progress is kept; press Resume to continue without resubmitting finished work.' : message;
    await this.set({ status: 'failed', failedPhase: phase, error, finishedAt: new Date(), activity: '', ...(keep ? {} : { needsAttention: null }) });
    await this.log({ event: 'failed', message: error, source: 'system' });
  }

  private async set(fields: Record<string, unknown>) {
    if (typeof fields.status === 'string') this.status = fields.status as JobStatus;
    const job = await updateJob(this.bus, this.jobId, fields);
    if (job) this.job = job;
  }

  private log(entry: Parameters<typeof logEvent>[2]) { return logEvent(this.bus, this.jobId, entry); }
}

/** Runs one review CLI command (approve, reject or upload) against the project's saved review state. */
export async function review(bus: Bus, job: JobDoc, command: 'approve' | 'reject' | 'upload') {
  const id = String(job._id);
  const args = ['--use-system-ca', '--import', 'tsx', path.join(productionDir, 'src/review.ts'), command, '--project', job.projectFile];
  const { code, stderr } = await track(process.execPath, args, { cwd: productionDir, env: pipelineEnv() }, () => {}, () => {}).done;
  const project = await readProject(job.projectFile);
  const state = project?.review ?? {};
  const reviewFields = { 'review.status': state.status ?? null, 'review.youtubeUrl': state.youtube_url ?? null, 'review.zernioPostId': state.zernio_post_id ?? null };
  if (command === 'reject' && code === 0) {
    await updateJob(bus, id, { ...reviewFields, status: 'rejected', activity: 'Rejected. Nothing was uploaded.' });
    return logEvent(bus, id, { event: 'rejected', message: 'Video rejected. Nothing was uploaded.', source: 'system' });
  }
  if (code === 0 && (state.status === 'posted' || state.status === 'submitted')) {
    const message = state.status === 'posted' ? 'Published to YouTube.' : 'Submitted to YouTube through Zernio. It shows as published once YouTube finishes processing; check the Zernio dashboard.';
    await updateJob(bus, id, { ...reviewFields, status: 'uploaded', error: null, failedPhase: null, activity: message });
    return logEvent(bus, id, { event: 'uploaded', message, source: 'system', data: { youtube_url: state.youtube_url ?? null } });
  }
  if (code === 0 && command === 'approve' && state.status === 'approved' && !state.submission_started_at) {
    const message = 'Approved. Nothing was uploaded because Zernio is not configured yet; upload this video once you add it.';
    await updateJob(bus, id, { ...reviewFields, status: 'approved', error: null, failedPhase: null, activity: 'Approved. Not uploaded yet.' });
    return logEvent(bus, id, { event: 'approved_local', message, source: 'system' });
  }
  const error = code === 0
    ? 'Zernio reported the YouTube upload as failed. Check the Zernio dashboard before retrying.'
    : errorFrom(stderr, `The review command exited with code ${code}.`);
  await updateJob(bus, id, { ...reviewFields, status: 'failed', failedPhase: 'upload', error, activity: '' });
  return logEvent(bus, id, { event: 'upload_failed', message: error, source: 'system' });
}
