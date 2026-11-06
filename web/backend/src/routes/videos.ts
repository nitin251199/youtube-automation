import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { config, pipelineEnv, uploadsEnabled } from '../config.js';
import { JobModel, JobEventModel, RUNNING, type JobDoc } from '../models/Job.js';
import { logEvent, planSummary, publicJob, readProject, updateJob } from '../jobs.js';
import { review } from '../pipeline/runner.js';
import type { Bus } from '../bus.js';
import type { JobQueue } from '../queue.js';

const exec = promisify(execFile);
const upload = multer({ dest: path.join(os.tmpdir(), 'youtube-automation-uploads'), limits: { fileSize: 1024 ** 3, files: 2 } });

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function projectIdFor(now = new Date()) {
  return `video-${now.toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}`;
}

async function introProblem(file: string): Promise<string | null> {
  try {
    const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file], { env: pipelineEnv() });
    const probe = JSON.parse(stdout);
    if (Number(probe.format?.duration) < 5) return 'The intro video must be at least 5 seconds long.';
    if (!probe.streams?.some((s: any) => s.codec_type === 'audio')) return 'The intro video must have an audio track.';
    if (!probe.streams?.some((s: any) => s.codec_type === 'video')) return 'The intro file has no video track.';
    return null;
  } catch { return 'The intro file could not be read as a video.'; }
}

export function videosRouter(bus: Bus, queue: JobQueue) {
  const router = Router();

  async function load(req: Request): Promise<JobDoc> {
    const id = String(req.params.id);
    if (!mongoose.isValidObjectId(id)) throw new HttpError(404, 'Video not found.');
    const job = await JobModel.findById(id);
    if (!job) throw new HttpError(404, 'Video not found.');
    return job;
  }

  async function detail(job: JobDoc) {
    return { ...publicJob(job, true), queuePosition: await queue.position(String(job._id)), plan: planSummary(await readProject(job.projectFile)) };
  }

  router.post('/', upload.fields([{ name: 'logo', maxCount: 1 }, { name: 'intro', maxCount: 1 }]), async (req, res) => {
    const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
    const temporary = Object.values(files).flat().map(f => f.path);
    try {
      const title = String(req.body.title ?? '').trim();
      const script = String(req.body.script ?? '').replace(/\r\n/g, '\n').trim();
      const concept = String(req.body.concept ?? '').trim();
      const assetMode = req.body.assetMode === 'video' ? 'video' : 'channel';
      const pauseAfterScript = ['true', '1', 'on', true].includes(req.body.pauseAfterScript);
      if (!title) throw new HttpError(400, 'Add a title.');
      if (title.length > 100) throw new HttpError(400, 'YouTube titles can be at most 100 characters.');
      if (script.length < 40) throw new HttpError(400, 'Paste the full finished script (at least a few sentences).');
      if (script.length > 20000) throw new HttpError(400, 'The script is too long for a one-minute, 12-scene video.');
      const logo = files.logo?.[0], intro = files.intro?.[0];
      if (assetMode === 'video' && !logo && !intro) throw new HttpError(400, 'Upload a logo and/or intro for this video, or use the channel assets.');
      const logoExt = logo ? path.extname(logo.originalname).toLowerCase() : '';
      if (logo && !['.png', '.jpg', '.jpeg'].includes(logoExt)) throw new HttpError(400, 'The logo must be a PNG or JPG image.');
      if (intro) { const problem = await introProblem(intro.path); if (problem) throw new HttpError(400, problem); }

      const projectId = projectIdFor();
      const outputDir = path.join(config.outputsDir, projectId);
      const assets: { mode: 'channel' | 'video'; logoPath: string | null; introPath: string | null } = { mode: assetMode, logoPath: null, introPath: null };
      if (assetMode === 'video') {
        const inputs = path.join(outputDir, 'inputs');
        await fs.mkdir(inputs, { recursive: true });
        if (logo) { assets.logoPath = path.join(inputs, `channel-logo${logoExt}`); await fs.copyFile(logo.path, assets.logoPath); }
        if (intro) { assets.introPath = path.join(inputs, 'channel-intro.mp4'); await fs.copyFile(intro.path, assets.introPath); }
      }
      const job = await JobModel.create({
        title, script, concept, assets, pauseAfterScript, projectId, outputDir,
        projectFile: path.join(config.projectsDir, projectId, 'pipeline.json'),
        stages: { script: { done: 0, total: 3 }, scenes: { done: 0, total: 12 } },
      });
      await logEvent(bus, String(job._id), { event: 'queued', message: 'Video created and queued.', source: 'system' });
      queue.kick();
      res.status(201).json(await detail(job));
    } finally {
      await Promise.all(temporary.map(f => fs.rm(f, { force: true })));
    }
  });

  router.get('/', async (_req, res) => {
    const jobs = await JobModel.find().sort({ createdAt: -1 }).limit(100);
    res.json({ jobs: jobs.map(job => publicJob(job)), activeJobId: queue.activeJobId() ?? null });
  });

  router.get('/:id', async (req, res) => { res.json(await detail(await load(req))); });

  router.get('/:id/events', async (req, res) => {
    const job = await load(req);
    const limit = Math.min(Number(req.query.limit) || 300, 1000);
    const events = await JobEventModel.find({ jobId: job._id }).sort({ at: -1, _id: -1 }).limit(limit);
    res.json({ events: events.reverse() });
  });

  router.get('/:id/stream', async (req: Request, res: Response) => {
    const job = await load(req);
    const id = String(job._id);
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    // Subscribe before reading history; the client de-duplicates events by _id.
    const unsubscribe = bus.subscribe(id, async message => {
      if (message.type === 'event') return send('event', message.payload);
      const fresh = await JobModel.findById(id);
      if (fresh) send('job', await detail(fresh));
    });
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => { unsubscribe(); clearInterval(ping); });
    send('job', await detail(job));
    const history = await JobEventModel.find({ jobId: job._id }).sort({ at: -1, _id: -1 }).limit(300);
    send('history', history.reverse());
  });

  router.get('/:id/file', async (req, res) => {
    const job = await load(req);
    if (!job.videoPath) throw new HttpError(404, 'This video has not been rendered yet.');
    try { await fs.access(job.videoPath); } catch { throw new HttpError(404, 'The rendered file is missing from disk.'); }
    res.type('video/mp4');
    if (req.query.download) res.attachment(`${job.projectId}.mp4`);
    res.sendFile(job.videoPath, { acceptRanges: true, cacheControl: false });
  });

  router.post('/:id/start', async (req, res) => {
    const job = await load(req);
    if (job.status !== 'planned') throw new HttpError(409, 'Only a video with a reviewed scene plan can be started.');
    await updateJob(bus, String(job._id), { status: 'queued', planApproved: true, activity: 'Queued for Flow generation', error: null });
    await logEvent(bus, String(job._id), { event: 'plan_approved', message: 'Scene plan approved. Queued for Flow generation.', source: 'system' });
    queue.kick();
    res.json(await detail((await JobModel.findById(job._id))!));
  });

  router.post('/:id/resume', async (req, res) => {
    const job = await load(req);
    const resumable = (job.status === 'failed' && job.failedPhase !== 'upload') || job.status === 'cancelled';
    if (!resumable) throw new HttpError(409, 'Only a stopped or failed run can be resumed.');
    await updateJob(bus, String(job._id), { status: 'queued', error: null, failedPhase: null, needsAttention: null, activity: 'Queued to resume', ...(job.pauseAfterScript ? { planApproved: true } : {}) });
    await logEvent(bus, String(job._id), { event: 'resume', message: 'Queued to resume from saved progress.', source: 'system' });
    queue.kick();
    res.json(await detail((await JobModel.findById(job._id))!));
  });

  router.post('/:id/cancel', async (req, res) => {
    const job = await load(req);
    const id = String(job._id);
    if (queue.isActive(id) && RUNNING.includes(job.status as any)) {
      queue.stop(id);
      await logEvent(bus, id, { event: 'stopping', message: 'Stopping the run. Finished work stays saved.', source: 'system' });
    } else if (job.status === 'queued' || job.status === 'planned') {
      await updateJob(bus, id, { status: 'cancelled', activity: 'Cancelled before generation', finishedAt: new Date() });
      await logEvent(bus, id, { event: 'cancelled', message: 'Cancelled.', source: 'system' });
    } else throw new HttpError(409, 'This video is not queued or running.');
    res.json(await detail((await JobModel.findById(id))!));
  });

  const reviewRoute = (command: 'approve' | 'reject' | 'upload') => async (req: Request, res: Response) => {
    const job = await load(req);
    const id = String(job._id);
    const uploads = uploadsEnabled();
    if (command === 'upload' && !uploads) throw new HttpError(409, 'Zernio is not configured yet. Add ZERNIO_API_KEY and ZERNIO_YOUTUBE_ACCOUNT_ID to scripting/.env, then upload.');
    const from = command === 'upload'
      ? { $or: [{ status: 'approved' }, { status: 'failed', failedPhase: 'upload' }] }
      : { status: 'awaiting_approval' };
    const uploading = command === 'upload' || (command === 'approve' && uploads);
    const next = uploading
      ? { status: 'uploading', error: null, failedPhase: null, activity: 'Uploading to YouTube through Zernio' }
      : { status: command === 'reject' ? 'rejected' : 'approved', activity: command === 'reject' ? 'Recording rejection' : 'Recording approval' };
    // Atomic claim: a double click cannot record two decisions or start two uploads.
    const filter: Record<string, unknown> = { _id: job._id, ...from };
    const claimed = await JobModel.findOneAndUpdate(filter, { $set: next }, { returnDocument: 'after' }) as JobDoc | null;
    if (!claimed) throw new HttpError(409, command === 'upload' ? 'Only an approved video can be uploaded.' : 'This video is not awaiting approval.');
    if (command === 'approve') await logEvent(bus, id, { event: 'approved', message: uploads ? 'Approved. Uploading to YouTube through Zernio.' : 'Approved.', source: 'system' });
    if (command === 'upload') await logEvent(bus, id, { event: 'upload_started', message: 'Uploading to YouTube through Zernio.', source: 'system' });
    const task = review(bus, claimed, command).catch(async error => {
      await updateJob(bus, id, { status: 'failed', failedPhase: 'upload', error: String(error?.message ?? error) });
    });
    if (!uploading) await task;
    res.status(uploading ? 202 : 200).json(await detail((await JobModel.findById(id))!));
  };
  router.post('/:id/approve', reviewRoute('approve'));
  router.post('/:id/reject', reviewRoute('reject'));
  router.post('/:id/upload', reviewRoute('upload'));

  return router;
}
