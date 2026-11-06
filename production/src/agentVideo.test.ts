import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import { FlowClient } from './flowClient.js';
import { FlowGenerationFailedError } from './generation.js';
import type { Item } from './types.js';

// A stand-in for Flow's agent chat and media editor, mirroring the live markup (Nov 2026).
const FLOW = `<!doctype html><html><body><main id="app"></main><script>
const S = JSON.parse(localStorage.getItem('flow') || 'null') || { messages: [], replies: [], busy: false, submits: 0, upscaled: 0 };
const save = () => localStorage.setItem('flow', JSON.stringify(S));
const go = url => { history.pushState({}, '', url); render(); };
const mp4 = id => 'data:video/mp4;base64,' + btoa('\\u0000\\u0000\\u0000\\u0018ftypisom' + id);
const message = m => m.role === 'user'
  ? '<div><flow-chat-bubble><flow-structured-prompt-text><span>' + m.text + '</span></flow-structured-prompt-text></flow-chat-bubble></div>'
  : m.error ? '<div><flow-chat-bubble><flow-error-tile>warning Failed Something went wrong. Please try again.</flow-error-tile></flow-chat-bubble></div>'
  : '<div><flow-chat-bubble><flow-a2ui-message-renderer><flow-a2ui-video-option><div role="button" aria-label="Open video in editor" data-id="' + m.id + '">' + (m.rendering ? '' : '<img src="https://storage.test/image/' + m.id + '-poster?Signature=x">') + '</div></flow-a2ui-video-option></flow-a2ui-message-renderer>'
    + (m.player ? '<video src="https://flow.test/asb/' + m.id + '=mm,22,15"></video>' : '') + '</flow-chat-bubble></div>';
function render() {
  save();
  const app = document.getElementById('app');
  const edit = location.pathname.match(/edit\\/([\\w-]+)$/);
  if (edit) {
    const clip = S.messages.find(m => m.id === edit[1]);
    // Like Flow: while a clip is still rendering, its editor shows Download media disabled.
    if (clip && clip.rendering) setTimeout(render, 400);
    app.innerHTML = '<button aria-label="Back button to go to previous page">back</button><button aria-label="Download media"' + (clip && clip.rendering ? ' disabled' : '') + '>dl</button><div contenteditable="true" aria-label="What do you want to change?"></div><button aria-label="Start generation" onclick="S.submits=-999;save()">go</button>';
    app.querySelector('[aria-label="Download media"]').onclick = () => {
      const menu = document.createElement('div'); menu.setAttribute('role', 'menu');
      menu.innerHTML = ['270p Animated GIF', '720p Original size', '1080p Upscaled', '4K Upscaled'].map(t => '<div role="menuitem">' + t + '</div>').join('');
      menu.querySelectorAll('[role=menuitem]').forEach(el => el.onclick = () => {
        menu.remove();
        if (/Upscaled|GIF/.test(el.textContent)) { S.upscaled++; save(); return; }
        const a = document.createElement('a'); a.href = mp4(edit[1]); a.download = 'clip.mp4'; document.body.appendChild(a); a.click(); a.remove();
      });
      document.body.appendChild(menu);
    };
    return;
  }
  app.innerHTML = '<button aria-label="Agent instructions">a</button><div contenteditable="true" role="textbox" aria-label="What do you want to create?"></div>'
    + (S.busy ? '<button aria-label="Stop">stop</button>' : '<button aria-label="Start generation">go</button>')
    + '<flow-agent-panel><flow-chat-scroller><div id="list">' + S.messages.map(message).join('') + '</div></flow-chat-scroller></flow-agent-panel>';
  app.querySelectorAll('[aria-label="Open video in editor"]').forEach(el => el.onclick = () => go(location.pathname + '/edit/' + el.dataset.id));
  const submit = app.querySelector('[aria-label="Start generation"]');
  if (submit) submit.onclick = () => {
    S.submits++; S.messages.push({ role: 'user', text: app.querySelector('[contenteditable]').innerText }); S.busy = true; render();
    // Like the scene 5 failure: an older clip's player re-renders while this request is still pending.
    setTimeout(() => { const old = S.messages.find(m => m.id); if (old) { old.player = true; render(); } }, 300);
    const reply = S.replies.shift();
    // Like Flow: the reply card appears as a grey placeholder at once and gets its preview when rendering ends.
    setTimeout(() => { S.busy = false; S.messages.push(reply === 'error' ? { role: 'agent', error: true } : { role: 'agent', id: reply, rendering: true }); render(); }, 600);
    setTimeout(() => { const m = S.messages.find(x => x.id === reply); if (m) { m.rendering = false; render(); } }, 2500);
  };
}
window.onpopstate = render; render();
</script></body></html>`;

const PROMPT = 'Generate exactly one 16:9 VIDEO scene using the saved reference assets #BGD-02 @CHAR-03. SCENE ACTION: Budhiya leans toward Amit and whispers.';

async function flowPage(t: any, seed: { messages?: unknown[]; replies?: string[] }): Promise<Page> {
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage({ acceptDownloads: true });
  await page.route('https://flow.test/**', route => route.fulfill({ contentType: 'text/html', body: FLOW }));
  await page.route('https://storage.test/**', route => route.fulfill({ status: 204 }));
  await page.goto('https://flow.test/project/p1');
  await page.evaluate(s => { localStorage.setItem('flow', JSON.stringify({ messages: [], replies: [], busy: false, submits: 0, upscaled: 0, ...s })); }, seed);
  await page.reload();
  return page;
}
const state = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('flow')!));
const earlier = [{ role: 'user', text: 'Generate exactly one 16:9 VIDEO scene for scene 4. SCENE ACTION: Amit sits alone.' }, { role: 'agent', id: 'clip4' }];

test('a scene video is taken from the reply to its own request, opened by editor id and saved at original size', async t => {
  const page = await flowPage(t, { messages: earlier, replies: ['clip6'] });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-video-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const flow = new FlowClient(page, () => {});
  assert.equal(await flow.uiMode(5000), 'agent');
  const item: Item = { status: 'pending', scene_number: 6 };
  await flow.bind(item, async () => {}, 'video');
  await flow.agentPrompt(PROMPT);
  await flow.generate(PROMPT);
  await flow.download(dir, 'scene-0006.mp4');
  const fg = item.flow_generation as any;
  assert.equal(fg.media_id, 'clip6', 'never the re-rendered scene 4 clip');
  assert.match(await fs.readFile(path.join(dir, 'scene-0006.mp4'), 'latin1'), /ftypisomclip6$/);
  const s = await state(page);
  assert.equal(s.submits, 1);
  assert.equal(s.upscaled, 0, 'only the free original size is downloaded');
  assert.match(page.url(), /\/project\/p1$/, 'returns to the project composer');
});

test('a Flow error reply fails the scene clearly and clears its submission so it is sent again', async t => {
  const page = await flowPage(t, { messages: earlier, replies: ['error'] });
  const flow = new FlowClient(page, () => {}); await flow.uiMode(5000);
  const item: Item = { status: 'pending', scene_number: 5 };
  await flow.bind(item, async () => {}, 'video');
  await flow.agentPrompt(PROMPT);
  await assert.rejects(flow.generate(PROMPT), (error: any) => error instanceof FlowGenerationFailedError && /Something went wrong/.test(error.message));
  assert.equal(item.flow_generation, undefined);
});

test('after a restart the earlier request is found by its prompt and its clip downloaded without resubmitting', async t => {
  const page = await flowPage(t, { messages: [...earlier, { role: 'user', text: PROMPT }, { role: 'agent', id: 'clip6' }, { role: 'user', text: 'Always approve' }] });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-video-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const flow = new FlowClient(page, () => {}); await flow.uiMode(5000);
  const item: Item = { status: 'failed', scene_number: 6, flow_generation: { phase: 'submitted', url: 'https://flow.test/project/p1', baseline: [], baseline_ids: [], started_at: 'then' } };
  assert.equal(await flow.bind(item, async () => {}, 'video'), true);
  await flow.generate(PROMPT);
  await flow.download(dir, 'scene-0006.mp4');
  assert.equal((item.flow_generation as any).media_id, 'clip6');
  assert.equal((await state(page)).submits, 0);
  // A completed clip later downloads straight from its saved editor id.
  await fs.rm(path.join(dir, 'scene-0006.mp4'));
  const again = new FlowClient(page, () => {}); await again.uiMode(5000);
  await again.bind(item, async () => {}, 'video'); await again.generate(PROMPT); await again.download(dir, 'scene-0006.mp4');
  assert.match(await fs.readFile(path.join(dir, 'scene-0006.mp4'), 'latin1'), /clip6$/);
});

test('a clip that is still rendering is never opened as finished; a saved clip waits for Download media to be enabled', async t => {
  const page = await flowPage(t, { messages: [...earlier, { role: 'user', text: PROMPT }, { role: 'agent', id: 'clip5', rendering: true }] });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-video-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const flow = new FlowClient(page, () => {}); await flow.uiMode(5000);
  const pending: Item = { status: 'failed', scene_number: 5, flow_generation: { phase: 'submitted', url: 'https://flow.test/project/p1', baseline: [], started_at: 'then', request: PROMPT } };
  await flow.bind(pending, async () => {}, 'video');
  const finish = () => page.evaluate(() => { const s = JSON.parse(localStorage.getItem('flow')!); s.messages.find((m: any) => m.id === 'clip5').rendering = false; localStorage.setItem('flow', JSON.stringify(s)); });
  const later = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const rendered = later(1500).then(finish).then(() => page.reload());
  const started = Date.now();
  await flow.generate(PROMPT);
  await rendered;
  assert.ok(Date.now() - started >= 1400, 'waited for the preview instead of taking the placeholder');
  // The earlier run saved this clip as complete while it was still rendering.
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('flow')!); s.messages.find((m: any) => m.id === 'clip5').rendering = true; localStorage.setItem('flow', JSON.stringify(s)); });
  const finished = later(1500).then(finish);
  await flow.download(dir, 'scene-0005.mp4');
  await finished;
  assert.match(await fs.readFile(path.join(dir, 'scene-0005.mp4'), 'latin1'), /clip5$/);
});

test('a saved clip whose render later failed in Flow is reported as failed instead of waited on', async t => {
  const page = await flowPage(t, { messages: [...earlier, { role: 'user', text: PROMPT }, { role: 'agent', error: true }] });
  const flow = new FlowClient(page, () => {}); await flow.uiMode(5000);
  const item: Item = { status: 'failed', scene_number: 5, flow_generation: { phase: 'complete', url: 'https://flow.test/project/p1', baseline: [], started_at: 'then', request: PROMPT, media_id: 'placeholder-id' } };
  await flow.bind(item, async () => {}, 'video');
  const started = Date.now();
  await assert.rejects(flow.generate(PROMPT), FlowGenerationFailedError);
  assert.ok(Date.now() - started < 20000);
  assert.equal(item.flow_generation, undefined, 'cleared so the scene is submitted again');
});
