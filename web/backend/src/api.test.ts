import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { Bus } from './bus.js';
import { JobModel } from './models/Job.js';
import { updateJob } from './jobs.js';
import type { JobQueue } from './queue.js';

// Never reach Zernio from tests, whatever scripting/.env holds; child processes inherit this.
Object.assign(process.env, { ZERNIO_API_KEY: '', ZERNIO_YOUTUBE_ACCOUNT_ID: '' });
const SCRIPT = 'रात की आख़िरी बस में मीरा अकेली बैठी थी। तीसरी सीट हर पड़ाव पर भीग जाती थी। ड्राइवर ने कहा, "उस सीट पर मत बैठना।"';
const bus = new Bus();
const kicks: string[] = [];
const queue = { kick: () => kicks.push('kick'), position: async () => 1, isActive: () => false, activeJobId: () => undefined, stop: () => {} } as unknown as JobQueue;
let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
let available = true;

before(async () => {
  try { await mongoose.connect(`mongodb://127.0.0.1:27017/yt_automation_test_${process.pid}`, { serverSelectionTimeoutMS: 2000 }); }
  catch { available = false; return; }
  server = createApp(bus, queue).listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(async () => {
  if (!available) return;
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

const post = (url: string, body?: FormData | object) => fetch(base + url, body instanceof FormData
  ? { method: 'POST', body }
  : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

test('validation rejects incomplete videos before anything is queued', async t => {
  if (!available) return t.skip('MongoDB is not running locally');
  const cases: [object, RegExp][] = [
    [{ script: SCRIPT }, /title/],
    [{ title: 'x', script: 'छोटा' }, /full finished script/],
    [{ title: 'x'.repeat(101), script: SCRIPT }, /100 characters/],
    [{ title: 'x', script: SCRIPT, assetMode: 'video' }, /Upload a logo/],
  ];
  for (const [body, message] of cases) {
    const response = await post('/videos', body);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, message);
  }
  const form = new FormData();
  form.set('title', 'x'); form.set('script', SCRIPT); form.set('assetMode', 'video');
  form.set('logo', new Blob(['not an image']), 'logo.gif');
  assert.match((await (await post('/videos', form)).json()).error, /PNG or JPG/);
  const intro = new FormData();
  intro.set('title', 'x'); intro.set('script', SCRIPT); intro.set('assetMode', 'video');
  intro.set('intro', new Blob(['not a video']), 'intro.mp4');
  assert.match((await (await post('/videos', intro)).json()).error, /could not be read/);
  assert.equal(await JobModel.countDocuments(), 0);
});

test('a created video is queued, listed, cancellable and resumable', async t => {
  if (!available) return t.skip('MongoDB is not running locally');
  const created = await post('/videos', { title: 'आख़िरी बस', script: SCRIPT, concept: 'भीगी सीट', pauseAfterScript: true });
  assert.equal(created.status, 201);
  const job = await created.json();
  assert.equal(job.status, 'queued');
  assert.equal(job.script, SCRIPT);
  assert.equal(job.pauseAfterScript, true);
  assert.equal(job.stages.scenes.total, 12);
  assert.match(job.projectFile, /scripting[\\/]projects[\\/]video-\d{14}-[0-9a-f]{6}[\\/]pipeline\.json$/);
  assert.ok(kicks.length > 0, 'the queue was kicked');

  const list = await (await fetch(`${base}/videos`)).json();
  assert.equal(list.jobs[0].id, job.id);
  assert.equal(list.jobs[0].script, undefined, 'lists omit the full script');

  assert.equal((await post(`/videos/${job.id}/approve`)).status, 409);
  assert.equal((await post(`/videos/${job.id}/start`)).status, 409);
  assert.equal((await (await post(`/videos/${job.id}/cancel`)).json()).status, 'cancelled');
  assert.equal((await (await post(`/videos/${job.id}/resume`)).json()).status, 'queued');
  assert.equal((await fetch(`${base}/videos/${job.id}/file`)).status, 404);
  assert.equal((await fetch(`${base}/videos/000000000000000000000000`)).status, 404);
  assert.equal((await fetch(`${base}/videos/not-an-id`)).status, 404);

  await updateJob(bus, job.id, { status: 'planned' });
  const started = await (await post(`/videos/${job.id}/start`)).json();
  assert.equal(started.status, 'queued');
  assert.equal(started.planApproved, true);
});

test('SSE sends a snapshot, history and live job updates', async t => {
  if (!available) return t.skip('MongoDB is not running locally');
  const job = await (await post('/videos', { title: 'SSE', script: SCRIPT })).json();
  const controller = new AbortController();
  const response = await fetch(`${base}/videos/${job.id}/stream`, { signal: controller.signal });
  assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
  const reader = response.body!.getReader();
  let text = '';
  const until = async (pattern: RegExp) => {
    while (!pattern.test(text)) text += new TextDecoder().decode((await reader.read()).value);
  };
  await until(/event: history\ndata: .*"queued"/);
  assert.match(text, /^event: job\n/);
  await updateJob(bus, job.id, { status: 'generating', activity: 'Generating scene 1 video', needsAttention: { type: 'flow_sign_in', message: 'Sign in', since: new Date() } });
  await until(/"status":"generating"/);
  assert.match(text, /"needsAttention":\{"type":"flow_sign_in"/);
  controller.abort();
});

async function reviewFixture(t: any, name: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'web-review-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const video = path.join(dir, 'final.mp4');
  const projectFile = path.join(dir, 'pipeline.json');
  await fs.writeFile(video, 'video');
  await fs.writeFile(projectFile, JSON.stringify({ project_id: name, review: { status: 'awaiting_approval', video_path: video, video_sha256: 'x' } }));
  const job = await JobModel.create({ title: name, script: SCRIPT, projectId: `${name}-${process.pid}`, projectFile, outputDir: dir, status: 'awaiting_approval', videoPath: video });
  return { job, projectFile };
}

test('reject runs the real review CLI offline and never uploads', async t => {
  if (!available) return t.skip('MongoDB is not running locally');
  const { job, projectFile } = await reviewFixture(t, 'reject');
  const range = await fetch(`${base}/videos/${job._id}/file`, { headers: { Range: 'bytes=0-1' } });
  assert.equal(range.status, 206);
  assert.equal(await range.text(), 'vi');
  const rejected = await (await post(`/videos/${job._id}/reject`)).json();
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.review.status, 'rejected');
  assert.equal(JSON.parse(await fs.readFile(projectFile, 'utf8')).review.status, 'rejected');
  assert.equal((await post(`/videos/${job._id}/approve`)).status, 409, 'a rejected video cannot be approved');
});

test('without Zernio, approve records the decision and the upload waits for settings', async t => {
  if (!available) return t.skip('MongoDB is not running locally');
  const status = await (await fetch(`${base}/system/status`)).json();
  assert.equal(status.uploadsEnabled, false);
  assert.equal(status.checks.find((c: any) => c.id === 'zernio').required, false);
  const { job, projectFile } = await reviewFixture(t, 'approve');
  const approved = await (await post(`/videos/${job._id}/approve`)).json();
  assert.equal(approved.status, 'approved');
  assert.equal(approved.review.status, 'approved');
  const saved = JSON.parse(await fs.readFile(projectFile, 'utf8')).review;
  assert.equal(saved.status, 'approved');
  assert.equal(saved.submission_started_at, undefined);
  const upload = await post(`/videos/${job._id}/upload`);
  assert.equal(upload.status, 409);
  assert.match((await upload.json()).error, /Zernio is not configured/);
  assert.equal((await post(`/videos/${job._id}/approve`)).status, 409, 'approval is recorded once');
});
