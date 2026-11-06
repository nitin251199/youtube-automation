import type { Page, Locator } from 'playwright';
import type { Item } from './types.js';

export class FlowGenerationQueuedError extends Error {
  constructor(message = 'Flow has not produced this generation yet. Submission saved; resume this project without regenerating.') {
    super(message); this.name = 'FlowGenerationQueuedError';
  }
}
export class FlowGenerationFailedError extends Error {
  constructor(detail: string) {
    super(`Google Flow could not generate this item ("${detail}"). Its submission was cleared so it can be submitted again.`); this.name = 'FlowGenerationFailedError';
  }
}
export interface GenerationState {
  url: string; baseline: string[]; started_at: string;
  phase: 'prepared' | 'submitted' | 'complete'; source?: string;
  // Flow rotates media addresses over time; a gallery tile's data-media-id stays fixed.
  media_id?: string; baseline_ids?: string[];
  // The exact prompt sent to Flow's agent; its chat reply holds this item's result.
  request?: string;
}
const tileSelector = (kind: 'video' | 'image', id?: string) => `main ${kind === 'video' ? 'video' : 'img'}[data-media-id${id ? `="${id}"` : ''}]`;
export async function mediaIds(page: Page, kind: 'video' | 'image'): Promise<string[]> {
  return page.locator(tileSelector(kind)).evaluateAll(els => [...new Set(els.map(el => el.getAttribute('data-media-id') ?? '').filter(Boolean))]);
}
const currentSrc = (el: Element) => (el as HTMLMediaElement).currentSrc || el.getAttribute('src') || '';
export async function mediaSources(page: Page, kind: 'video' | 'image'): Promise<string[]> {
  return page.locator(kind === 'video' ? 'video' : 'main img, [data-generation-state] img').evaluateAll(elements =>
    elements.map(el => (el as HTMLMediaElement).currentSrc || el.getAttribute('src') || '').filter(Boolean));
}
/** Media identity without per-load signatures (Flow re-signs the same file on every page load). */
export function mediaKey(src: string): string {
  try { const url = new URL(src); return url.protocol.startsWith('http') ? url.origin + url.pathname : src; }
  catch { return src; }
}
/** Everything already on screen: Flow keeps rendering existing thumbnails for a moment after load. */
export async function settledMediaSources(page: Page, kind: 'video' | 'image', quietMs = 2500, maxMs = 20000): Promise<string[]> {
  const seen = new Set<string>();
  const started = Date.now(); let changed = Date.now();
  for (;;) {
    for (const src of await mediaSources(page, kind)) if (!seen.has(src)) { seen.add(src); changed = Date.now(); }
    if (Date.now() - changed >= quietMs || Date.now() - started >= maxMs) return [...seen];
    await page.waitForTimeout(250);
  }
}
export async function generationResult(page: Page, state: GenerationState, kind: 'video' | 'image', log: (event: string, data?: any) => void = () => {}): Promise<Locator | undefined> {
  if (state.media_id) {
    const tile = page.locator(tileSelector(kind, state.media_id)).first();
    if (!await tile.count()) return undefined;
    state.source = await tile.evaluate(currentSrc); return tile;
  }
  if (state.baseline_ids) {
    const ids = await mediaIds(page, kind);
    const fresh = ids.filter(id => !state.baseline_ids!.includes(id));
    // Everything labelled before submission is in baseline_ids, so several new labels are this request's outputs.
    if (fresh.length > 1) log('multiple_results', { message: `Flow returned ${fresh.length} results for one request; using the first. Set Flow's output count to 1x to save credits.` });
    if (fresh.length) {
      const tile = page.locator(tileSelector(kind, fresh[0])).first();
      state.media_id = fresh[0]; state.source = await tile.evaluate(currentSrc); return tile;
    }
    // Once this page labels its media, only a genuinely new label is a result.
    if (ids.length || state.baseline_ids.length) return undefined;
  }
  const sources = await mediaSources(page, kind);
  const known = new Set(state.baseline.map(mediaKey));
  const candidates = [...new Set(sources.map(mediaKey).filter(key => !known.has(key)))];
  if (!state.source && candidates.length > 1) throw new Error('Multiple new media results appeared. Identify the requested result before resuming; refusing to download an unrelated clip.');
  const key = state.source ? mediaKey(state.source) : candidates[0];
  const source = key && sources.find(src => mediaKey(src) === key);
  if (!source) return undefined;
  const elements = page.locator(kind === 'video' ? 'video' : 'img');
  for (let i = 0; i < await elements.count(); i++) {
    const element = elements.nth(i);
    if (await element.evaluate(el => (el as HTMLMediaElement).currentSrc || el.getAttribute('src')) === source) {
      state.source = source;
      const id = await page.locator(tileSelector(kind)).evaluateAll((els, src) => els.find(el => ((el as HTMLMediaElement).currentSrc || el.getAttribute('src')) === src)?.getAttribute('data-media-id'), source);
      if (id) state.media_id = id;
      return element;
    }
  }
}
export async function waitGeneration(page: Page, item: Item, kind: 'video' | 'image', save: () => Promise<void>, log: (event: string, data?: any) => void, timeout: number) {
  const state = item.flow_generation as GenerationState;
  const deadline = Date.now() + timeout;
  let approvalClicked = false; let lastLog = 0;
  while (Date.now() < deadline) {
    const result = await generationResult(page, state, kind, log);
    if (result) { state.phase = 'complete'; state.url = page.url(); await save(); return result; }
    if (await page.getByText(/We noticed some unusual activity|unusual activity detected/i).first().isVisible()) {
      throw new Error('Google Flow requests account verification. Submission saved; clear the warning and resume this project.');
    }
    const approve = page.getByRole('button', { name: 'Approve', exact: true });
    if (!approvalClicked && await approve.isVisible() && await approve.isEnabled()) {
      await approve.click(); approvalClicked = true; log('generation_approved', { message: 'Approved this requested generation only.' });
    }
    if (Date.now() - lastLog > 60_000) { log('waiting_for_generation', { message: 'Watching current media without resubmitting or reading old queue messages.' }); lastLog = Date.now(); }
    if (page.isClosed()) throw new Error('Flow browser closed. Resume this project.');
    await page.waitForTimeout(1000);
  }
  throw new FlowGenerationQueuedError();
}

// Runs in the page: finds the last chat request carrying this prompt and summarises Flow's reply to it.
// Short user messages such as "Always approve" are answers inside the same exchange, not new requests.
const REPLY_SCRIPT = `(([request, kind, token]) => {
  const key = s => (s || '').toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu, '');
  const want = key(request);
  const mine = [...document.querySelectorAll('flow-structured-prompt-text')].filter(p => key(p.innerText).includes(want)).pop();
  if (!mine) return { found: false, options: 0, error: null };
  let item = mine.closest('flow-chat-bubble') || mine;
  while (item.parentElement && item.parentElement.querySelectorAll('flow-chat-bubble').length < 2) item = item.parentElement;
  const replies = [];
  for (let next = item.nextElementSibling; next; next = next.nextElementSibling) {
    const asked = next.querySelector('flow-structured-prompt-text');
    if (asked && key(asked.innerText).length > 80) break;
    replies.push(next);
  }
  const error = replies.map(r => r.querySelector('flow-error-tile')).find(Boolean);
  const tag = kind === 'video' ? 'flow-a2ui-video-option' : 'flow-a2ui-image-option';
  const cards = replies.flatMap(r => [...r.querySelectorAll(tag + ' [role=button]')]);
  // A card stays a grey placeholder without its preview image until Flow finishes rendering it.
  const ready = cards.filter(c => [...c.querySelectorAll('img')].some(i => /^https?:/.test(i.getAttribute('src') || '')));
  ready.forEach((o, i) => o.setAttribute('data-runner-result', token + '-' + i));
  return { found: true, options: ready.length, rendering: cards.length - ready.length, error: error ? error.innerText.replace(/^\\s*warning\\s*/i, '').replace(/\\s+/g, ' ').trim() : null };
})`;

export interface ReplyStatus { found: boolean; options: number; rendering?: number; error: string | null }
/** Flow's current reply to this request, waiting briefly for the chat history to render. */
export async function replyStatus(page: Page, request: string, kind: 'video' | 'image', wait = 30000): Promise<ReplyStatus> {
  const deadline = Date.now() + wait;
  for (;;) {
    const reply = await page.evaluate(`${REPLY_SCRIPT}(${JSON.stringify([request, kind, 'status'])})`) as ReplyStatus;
    if (reply.found || Date.now() > deadline) return reply;
    await page.waitForTimeout(1000);
  }
}
/** Waits for Flow's agent to answer this item's own request; older media elsewhere on the page is ignored. */
export async function waitAgentResult(page: Page, item: Item, kind: 'video' | 'image', save: () => Promise<void>, log: (event: string, data?: any) => void, timeout: number): Promise<Locator> {
  const state = item.flow_generation as GenerationState;
  if (!state.request) throw new Error('This submission has no saved request text, so its reply cannot be identified in Flow.');
  const deadline = Date.now() + timeout;
  const token = `result-${Date.now()}`;
  let approvalClicked = false; let lastLog = 0;
  while (Date.now() < deadline) {
    const reply = await page.evaluate(`${REPLY_SCRIPT}(${JSON.stringify([state.request, kind, token])})`) as ReplyStatus;
    if (reply.error) throw new FlowGenerationFailedError(reply.error);
    if (reply.options) {
      if (reply.options > 1) log('multiple_results', { message: `Flow returned ${reply.options} results for one request; using the first. Set Flow's output count to 1x to save credits.` });
      state.phase = 'complete'; await save();
      return page.locator(`[data-runner-result="${token}-0"]`);
    }
    if (await page.getByText(/We noticed some unusual activity|unusual activity detected/i).first().isVisible()) {
      throw new Error('Google Flow requests account verification. Submission saved; clear the warning and resume this project.');
    }
    const approve = page.getByRole('button', { name: 'Approve', exact: true });
    if (!approvalClicked && await approve.isVisible() && await approve.isEnabled()) {
      await approve.click(); approvalClicked = true; log('generation_approved', { message: 'Approved this requested generation only.' });
    }
    if (Date.now() - lastLog > 60_000) { log('waiting_for_generation', { message: reply.rendering ? 'Flow is rendering this clip.' : reply.found ? 'Waiting for Flow to answer this request.' : 'Looking for this request in Flow\'s chat.' }); lastLog = Date.now(); }
    if (page.isClosed()) throw new Error('Flow browser closed. Resume this project.');
    await page.waitForTimeout(1000);
  }
  throw new FlowGenerationQueuedError();
}
