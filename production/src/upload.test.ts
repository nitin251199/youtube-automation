import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { markReviewPending, loadProject, saveProject } from './reviewState.js';
import { publishApproved, decide } from './upload.js';
import { uploadsEnabled } from './setupConfig.js';
const config = { apiKey: 'fake', accountId: 'account', visibility: 'private' };
async function fixture(t: any) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'upload-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const project = path.join(dir, 'pipeline.json'), video = path.join(dir, 'video.mp4');
  await fs.writeFile(project, '{}'); await fs.writeFile(video, 'test video');
  await markReviewPending(project, video, 'Test');
  return { project, video };
}
async function approve(file: string) { const p = await loadProject(file); p.review!.status = 'approved'; await saveProject(file, p); }
function mock(failPost = false) {
  const calls: string[] = [];
  const http = (async (url: any, init: any) => {
    calls.push(String(url));
    if (String(url).endsWith('/accounts')) return Response.json({ accounts: [{ _id: 'account', platform: 'youtube' }] });
    if (String(url).endsWith('/presign')) return Response.json({ uploadUrl: 'https://storage.test/file', publicUrl: 'https://media.test/video.mp4' });
    if (String(url).includes('storage.test')) { assert.equal(init.headers.Authorization, undefined); for await (const chunk of init.body) {} return new Response(''); }
    if (failPost) throw new Error('Lost response');
    const body = JSON.parse(init.body); assert.equal(body.platforms[0].accountId, 'account'); assert.equal(body.publishNow, true);
    return Response.json({ post: { _id: 'post', platforms: [{ platform: 'youtube', status: 'pending' }] } });
  }) as typeof fetch;
  return { calls, http };
}
test('unapproved and rejected videos cannot upload', async t => {
  const f = await fixture(t); const m = mock();
  await assert.rejects(publishApproved(f.project, config, m.http), /approved/);
  await decide(f.project, false);
  await assert.rejects(publishApproved(f.project, config, m.http), /approved/);
  assert.equal(m.calls.length, 0);
});
test('changed file cannot upload', async t => {
  const f = await fixture(t); await approve(f.project); await fs.writeFile(f.video, 'changed'); const m = mock();
  await assert.rejects(publishApproved(f.project, config, m.http), /changed/); assert.equal(m.calls.length, 0);
});
test('local media uploads and pending post is not marked posted; duplicate blocked', async t => {
  const f = await fixture(t); await approve(f.project); const m = mock();
  const result = await publishApproved(f.project, config, m.http);
  assert.equal(result.status, 'submitted'); assert.equal(result.zernio_post_id, 'post');
  await assert.rejects(publishApproved(f.project, config, m.http)); assert.equal(m.calls.length, 4);
});
test('lost post response blocks resubmission', async t => {
  const f = await fixture(t); await approve(f.project); const m = mock(true);
  await assert.rejects(publishApproved(f.project, config, m.http), /Lost response/);
  assert.equal((await loadProject(f.project)).review!.status, 'submitting');
  await assert.rejects(publishApproved(f.project, config, m.http)); assert.equal(m.calls.length, 4);
});
test('without Zernio, approval is recorded and nothing is uploaded until settings are added', async t => {
  const keys = ['ZERNIO_API_KEY', 'ZERNIO_YOUTUBE_ACCOUNT_ID'];
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => { for (const key of keys) { if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; } });
  Object.assign(process.env, { ZERNIO_API_KEY: '', ZERNIO_YOUTUBE_ACCOUNT_ID: '' });
  assert.equal(await uploadsEnabled(), false);
  const f = await fixture(t); const m = mock();
  const review = await decide(f.project, true);
  assert.equal(review!.status, 'approved');
  assert.equal(review!.submission_started_at, undefined);
  await assert.rejects(publishApproved(f.project), /Zernio is not configured/);
  assert.equal((await loadProject(f.project)).review!.status, 'approved', 'a refused upload leaves the approval intact');
  const later = await publishApproved(f.project, config, m.http);
  assert.equal(later.status, 'submitted');
  assert.equal(m.calls.length, 4);
});
