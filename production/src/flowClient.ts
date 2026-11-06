import type { Page, Locator } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { S } from './selectors.js';
import type { Item } from './types.js';
import { launchProfile } from './browserSession.js';
import { FlowGenerationFailedError, FlowGenerationQueuedError, mediaIds, mediaKey, replyStatus, settledMediaSources, waitAgentResult, waitGeneration, type GenerationState } from './generation.js';
import { characterInfo, describeCharacter, voiceFor } from './characters.js';
import { saveSceneIdentity } from './sceneIdentity.js';
export { FlowGenerationQueuedError, FlowGenerationFailedError } from './generation.js';

export class FlowClient {
  private item?: Item;
  private save: () => Promise<void> = async () => {};
  private result?: Locator;
  private kind: 'video' | 'image' = 'image';
  private mode: 'agent' | 'classic' = 'classic';
  private request?: string;
  constructor(private page: Page, private log: (e: string, d?: any) => void) {}
  async first(candidates: readonly string[], timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      for (const selector of candidates) {
        const matches = this.page.locator(selector);
        for(let i=0;i<await matches.count();i++) {
          const locator=matches.nth(i);
          if(await locator.isVisible()) return locator;
        }
      }
      if (this.page.isClosed()) throw new Error('Automation browser closed.');
      await this.page.waitForTimeout(200);
    }
    throw new Error(`Flow control missing at ${this.page.url()}: ${candidates.join(' | ')}`);
  }
  async click(candidates: readonly string[]) { await (await this.first(candidates)).click(); }
  async fill(candidates: readonly string[], text: string) { await (await this.first(candidates)).fill(text); }
  async prompt(text: string) { if (!text || text === 'undefined') throw new Error('Missing generation prompt.'); await this.fill(S.promptInput, text); }
  /** Waits for the current agent composer; the classic editor path renames assets and needs a Voice control. */
  async uiMode(timeout = 30000): Promise<'agent' | 'classic'> {
    if (process.env.FLOW_CLASSIC_UI === '1') return this.mode = 'classic';
    try {
      await this.page.locator("button[aria-label='Agent instructions']").first().waitFor({ state: 'visible', timeout });
      await this.page.locator(S.promptInput.join(',')).first().waitFor({ state: 'visible', timeout });
      return this.mode = 'agent';
    } catch {
      throw new Error(`Google Flow's prompt composer did not appear within ${Math.round(timeout / 1000)}s. Check the automation Chrome window for a sign-in, verification or welcome dialog, then resume. Nothing was submitted.`);
    }
  }
  async agentPrompt(text: string) {
    this.request = text;
    // Current Flow's agent prompt chooses the requested media kind itself;
    // opening its Settings button opens agent settings, not a model selector.
    await this.prompt(text);
  }
  async bind(item: Item, save: () => Promise<void>, kind: 'video' | 'image') {
    this.item = item; this.save = save; this.kind = kind; this.result = undefined;
    const state = item.flow_generation as GenerationState | undefined;
    if (state?.phase === 'prepared') throw new Error('Previous run stopped at submission. Check this item in Flow before clearing its flow_generation marker; automatic retry could duplicate credits.');
    if (state && this.page.url() !== state.url) await this.page.goto(state.url, { waitUntil: 'domcontentloaded' });
    return Boolean(state);
  }
  /** `request` is this item's agent prompt, needed to find its reply after a restart. */
  async generate(request?: string) {
    if (!this.item) throw new Error('Generation item has not been bound.');
    const minutes = Number(process.env.FLOW_QUEUE_WAIT_MINUTES ?? '30');
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 120) throw new Error('FLOW_QUEUE_WAIT_MINUTES must be between 1 and 120.');
    let state = this.item.flow_generation as GenerationState | undefined;
    if (!state) {
      const submit = this.mode === 'agent' ? await this.idleSubmit() : await this.first(S.submit);
      const enabledDeadline = Date.now() + 15000;
      while (!await submit.isEnabled() && Date.now() < enabledDeadline) await this.page.waitForTimeout(200);
      if (!await submit.isEnabled()) throw new Error('Flow generation control is disabled. The form has not accepted its prompt.');
      const baseline = await settledMediaSources(this.page, this.kind);
      state = { url: this.page.url(), baseline, baseline_ids: await mediaIds(this.page, this.kind), phase: 'prepared', started_at: new Date().toISOString(), ...(this.mode === 'agent' ? { request: this.request ?? request } : {}) };
      this.item.flow_generation = state; await this.save();
      await submit.click();
      state.phase = 'submitted'; state.url = this.page.url(); await this.save();
    }
    if (this.mode === 'agent' && this.kind === 'video') return this.agentVideo(state, request, minutes * 60_000);
    this.result = await waitGeneration(this.page, this.item, this.kind, this.save, this.log, minutes * 60_000);
  }
  /** Gallery video tiles carry no stable id, so a clip comes from Flow's reply to this request and is kept by its editor id. */
  private async agentVideo(state: GenerationState, request: string | undefined, timeout: number) {
    state.request ??= request; await this.save();
    let option: Locator | undefined;
    try {
      if (state.media_id && state.phase === 'complete') {
        // A saved clip can still fail in Flow after it was recorded; its reply then shows an error.
        const reply = state.request ? await replyStatus(this.page, state.request, 'video') : undefined;
        if (reply?.error) throw new FlowGenerationFailedError(reply.error);
        return;
      }
      option = await waitAgentResult(this.page, this.item!, 'video', this.save, this.log, timeout);
    } catch (error) {
      if (error instanceof FlowGenerationFailedError) { delete this.item!.flow_generation; await this.save(); }
      throw error;
    }
    await option.click();
    await this.page.waitForURL(/\/edit\/[\w-]+$/, { timeout: 60000 });
    state.media_id = /\/edit\/([\w-]+)$/.exec(new URL(this.page.url()).pathname)![1];
    await this.save();
  }
  /** The agent swaps Start generation for Stop while it works; never submit to a busy agent. */
  private async idleSubmit() {
    const submit = this.page.locator(S.agentSubmit).first();
    const deadline = Date.now() + 10 * 60_000; let lastLog = Date.now();
    while (!await submit.isVisible()) {
      if (Date.now() > deadline) throw new Error('Google Flow is still busy with an earlier request after 10 minutes. Nothing new was submitted; resume once it finishes.');
      if (this.page.isClosed()) throw new Error('Automation browser closed.');
      if (Date.now() - lastLog > 60_000) { this.log('waiting_for_flow_idle', { message: 'Flow is still finishing the previous request; waiting before submitting.' }); lastLog = Date.now(); }
      await this.page.waitForTimeout(500);
    }
    return submit;
  }
  /** Saves a generated character image as a named Flow character, which the agent cannot do itself. */
  async ensureCharacter(item: Item, save: () => Promise<void>) {
    let record = (item.flow_character ?? {}) as { url?: string; done?: boolean; existing?: boolean; voice?: string };
    if (record.done) return;
    const tag = String(item.tag ?? '');
    if (!tag) throw new Error('A character without a tag cannot be saved in Flow.');
    if (!record.url) {
      const generation = item.flow_generation as GenerationState | undefined;
      const source = generation?.media_id ? await this.currentSource(generation.media_id) : generation?.source;
      await this.page.getByRole('button', { name: /Characters$/ }).first().click();
      const create = this.page.getByRole('button', { name: /New character/ }).first();
      await create.waitFor({ state: 'visible', timeout: 30000 });
      await this.settled(this.page.locator('main'));
      if (await this.page.locator('main').getByText(tag, { exact: true }).count()) {
        item.flow_character = { done: true, existing: true }; await save();
        this.log('character_saved', { tag, message: `Using the existing Flow character ${tag}.` });
        return this.showAllMedia();
      }
      if (!source) throw new Error(`Character ${tag} has no generated image in this Flow project to save as a character.`);
      await create.click();
      await this.page.getByRole('button', { name: /Add from project/ }).click();
      const dialog = this.page.locator('[role=dialog]').last();
      await (await this.option(dialog, o => mediaKey(o.img) === mediaKey(source), tag)).click();
      await dialog.getByRole('button', { name: 'Add media', exact: true }).click();
      await this.page.waitForURL(/\/character\/[\w-]+$/, { timeout: 90000 });
      // Saved at once so an interrupted save resumes on this entity instead of creating another.
      record = { url: this.page.url() }; item.flow_character = record; await save();
    } else if (this.page.url() !== record.url) await this.page.goto(record.url, { waitUntil: 'domcontentloaded' });
    const name = this.page.locator(S.characterName);
    await name.waitFor({ state: 'visible', timeout: 60000 });
    // Flow fills in the saved voice and info after the name appears; anything typed earlier is overwritten.
    await this.page.locator('button').filter({ hasText: 'voice_selection' }).first().waitFor({ state: 'visible', timeout: 60000 });
    await this.settled(this.page.locator('body'));
    if (await name.inputValue() !== tag) {
      await this.page.getByRole('button', { name: 'Edit name' }).click();
      await name.fill(tag); await name.press('Enter');
      const deadline = Date.now() + 10000;
      while (await name.inputValue() !== tag) { if (Date.now() > deadline) throw new Error(`Flow did not accept the character name ${tag}.`); await this.page.waitForTimeout(200); }
    }
    const pick = this.page.locator('button').filter({ hasText: 'Select a voice' }).first();
    if (await pick.isVisible()) {
      const voice = voiceFor(describeCharacter(item));
      await pick.click();
      const voices = this.page.locator('[role=dialog]').last();
      // Flow renders the voice name and its description as adjacent elements, so match the displayed text.
      await (await this.option(voices, o => new RegExp(`(^|\\s)${voice}(\\s|$)`).test(o.text), `Voice ${voice}`)).click();
      await voices.getByRole('button', { name: 'Add to character' }).click();
      await this.page.locator('button').filter({ hasText: new RegExp(voice, 'i') }).first().waitFor({ state: 'visible', timeout: 15000 });
      record.voice = voice;
    }
    const info = this.page.locator(S.characterInfo);
    if (!(await info.inputValue()).trim()) {
      const text = characterInfo(item);
      await info.fill(text);
      await this.settled(this.page.locator('body'));
      if (await info.inputValue() !== text) throw new Error(`Flow did not keep the character info for ${tag}; resume to retry.`);
    }
    await this.page.getByRole('button', { name: 'Done', exact: true }).click();
    await this.page.waitForURL(url => !/\/character(\/|$)/.test(url.pathname), { timeout: 30000 });
    item.flow_character = { ...record, done: true }; await save();
    this.log('character_saved', { tag, voice: record.voice, message: `Saved ${tag} as a Flow character${record.voice ? ` with the ${record.voice} voice` : ''}.` });
    await this.showAllMedia();
  }
  /** Attaches a scene's saved characters and background image to the prompt; anything missing stops before submission. */
  async attachIngredients(refs: { label: string; character?: string; mediaId?: string; image?: string }[]) {
    const chips = this.page.getByRole('button', { name: 'Ingredient', exact: true });
    const clear = this.page.getByRole('button', { name: 'Clear prompt' });
    if (await clear.isVisible()) { await clear.click(); await this.until(async () => await chips.count() === 0, 'Flow did not clear the previous ingredients.'); }
    for (const ref of refs) {
      const image = ref.character ? undefined : ref.mediaId ? await this.currentSource(ref.mediaId) : ref.image;
      if (!ref.character && !image) throw new Error(`${ref.label} has no generated image in this Flow project. Nothing was submitted.`);
      const before = await chips.count();
      await this.page.getByRole('button', { name: 'Add ingredients to the prompt box' }).click();
      // The picker draws its tabs a moment after opening, and choosing a tab is what loads its list.
      const tab = this.page.getByRole('tab', { name: ref.character ? /Characters$/ : /Images$/ }).first();
      if (await tab.waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false)) await tab.click();
      const picker = this.page.locator('[role=listbox]').last().locator('xpath=..');
      // The Characters/Images tabs list bare names and attach on click; the All tab adds a kind and needs Add to prompt.
      const option = await this.option(picker, ref.character
        ? o => o.text === ref.character || o.text === `${ref.character} Character`
        : o => mediaKey(o.img) === mediaKey(image!), ref.label).catch(async error => { await this.page.keyboard.press('Escape'); throw error; });
      await option.click();
      // Add to prompt is shown in every tab, so give a direct attach a moment before pressing it.
      await this.until(async () => await chips.count() > before, '', 2500)
        .catch(() => this.page.getByRole('button', { name: 'Add to prompt' }).click());
      await this.until(async () => await chips.count() === before + 1, `Flow did not attach ${ref.label}. Nothing was submitted.`);
    }
    this.log('ingredients_attached', { message: `Attached ${refs.map(r => r.label).join(', ')}.` });
  }
  private async option(scope: Locator, match: (o: { text: string; img: string }) => boolean, label: string): Promise<Locator> {
    const options = scope.locator('[role=option]');
    await options.first().waitFor({ state: 'visible', timeout: 30000 });
    await this.settled(scope);
    for (let screen = 0; screen < 25; screen++) {
      const all = await options.evaluateAll(els => els.map(el => ({ text: (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim(), img: el.querySelector('img')?.getAttribute('src') ?? '' })));
      const hits = all.flatMap((o, i) => match(o) ? [i] : []);
      if (new Set(hits.map(i => all[i].text + mediaKey(all[i].img))).size > 1) throw new Error(`${label} matches several Flow items; refusing to guess. Nothing was submitted.`);
      if (hits.length) return options.nth(hits[0]);
      const scrolled = await scope.locator('[role=listbox]').first().evaluate(el => { const top = el.scrollTop; el.scrollTop += el.clientHeight; return el.scrollTop !== top; }).catch(() => false);
      if (!scrolled) break;
      await this.settled(scope);
    }
    throw new Error(`${label} was not found in this Flow project. Nothing was submitted.`);
  }
  /** The address Flow currently serves for a media id; addresses rotate, so look it up right before use. */
  private async currentSource(mediaId: string): Promise<string | undefined> {
    const tile = this.page.locator(`main img[data-media-id="${mediaId}"], main video[data-media-id="${mediaId}"]`).first();
    try {
      for (const view of [/All media$/, /^(image\s+)?Images$/]) {
        const nav = this.page.getByRole('button', { name: view }).first();
        if (!await nav.count()) continue;
        await nav.click(); await this.settled(this.page.locator('main'));
        for (let screen = 0; screen < 12; screen++) {
          if (await tile.count()) return await tile.evaluate(el => (el as HTMLMediaElement).currentSrc || el.getAttribute('src') || '') || undefined;
          const before = await this.page.locator('main [data-media-id]').count();
          await this.page.locator('main').hover().catch(() => {}); await this.page.mouse.wheel(0, 900); await this.settled(this.page.locator('main'), 600);
          if (await this.page.locator('main [data-media-id]').count() === before && !await tile.count()) break;
        }
      }
      return undefined;
    } finally {
      // New results appear at the top of All media, where generation watches for them.
      await this.showAllMedia().catch(() => {}); await this.page.mouse.wheel(0, -100000).catch(() => {});
    }
  }
  private async showAllMedia() {
    await this.page.getByRole('button', { name: /All media$/ }).first().click();
  }
  private async settled(locator: Locator, quietMs = 1200, maxMs = 15000) {
    const start = Date.now(); let last = ''; let changed = Date.now();
    while (Date.now() - start < maxMs) {
      const now = await locator.innerHTML().catch(() => '');
      if (now !== last) { last = now; changed = Date.now(); } else if (Date.now() - changed >= quietMs) return;
      await this.page.waitForTimeout(200);
    }
  }
  private async until(check: () => Promise<boolean>, message: string, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (!await check()) { if (Date.now() > deadline) throw new Error(message); await this.page.waitForTimeout(200); }
  }
  async rename(name: string) {
    let input;
    try { input = await this.first(S.nameInput, 1500); }
    catch { await this.click(S.options); await this.click(S.rename); input = await this.first(S.nameInput); }
    await input.fill(name);
    try { await this.click(S.save); } catch { await input.press('Enter'); }
  }
  async configureVoice(voice: { gender?: string; age?: string; descriptor?: string; name?: string }) {
    await this.click(S.voice);
    await this.click((voice.gender ?? '').toLowerCase().startsWith('f') ? S.femaleVoice : S.maleVoice);
    await this.click(S.customizePerformance);
    if (voice.age) await this.fill(S.ageInput, voice.age);
    if (voice.descriptor) await this.fill(S.descriptorInput, voice.descriptor);
    if (voice.name) await this.fill(S.voiceNameInput, voice.name);
    await this.click(S.saveNewVoice); await this.click(S.addToCharacter);
  }
  async selectAsset(tag: string, hint?: string) {
    if (!tag || tag === 'undefined') throw new Error('Scene references an undefined asset.');
    await this.click(S.promptInput); await this.page.keyboard.type(tag);
    const exact = this.page.getByRole('option').filter({ hasText: tag }).or(this.page.getByText(tag, { exact: true })).last();
    if (await exact.isVisible()) { await exact.click(); return; }
    // Current Flow uses an ingredient picker with generated prompt summaries.
    // Match a unique visible card semantically; never retain a positional index.
    const picker = this.page.getByRole('button', { name: /Add ingredients/i });
    if (await picker.isVisible()) await picker.click();
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const text = new RegExp(escaped + (hint ? `|${hint.slice(0, 28).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` : ''), 'i');
    const option = this.page.getByRole('option').filter({ hasText: text });
    await option.first().waitFor({ state: 'visible', timeout: 15000 });
    if (await option.count() !== 1) throw new Error(`Asset ${tag} has multiple matching cards. Refusing to select an unrelated asset.`);
    await option.click();
  }
  async download(output: string, filename: string) {
    await fs.mkdir(output, { recursive: true });
    const destination = path.join(output, filename);
    const agentClip = this.mode === 'agent' && this.kind === 'video' ? (this.item?.flow_generation as GenerationState | undefined)?.media_id : undefined;
    if (agentClip) return this.downloadFromEditor(agentClip, destination);
    if (!this.result || !this.item) throw new Error('No completed media belonging to this item.');
    await this.result.hover(); // Flow reveals the current tile's actions on hover.
    const card = this.result.locator('xpath=ancestor::*[.//button[contains(@aria-label,"Download") or contains(@aria-label,"download")] or .//a[@download]][1]');
    const control = card.locator('button[aria-label*="Download" i], a[download]').first();
    if (!await control.isVisible() || await card.locator('video').count() !== 1) { await this.downloadMediaSource(destination); return; }
    const [download] = await Promise.all([this.page.waitForEvent('download', { timeout: 120000 }), control.click()]);
    if (await download.failure()) throw new Error('Flow download failed. Resume to retry this result.');
    await download.saveAs(destination);
    const handle = await fs.open(destination, 'r');
    let valid=false;
    try { const bytes = Buffer.alloc(12); await handle.read(bytes, 0, 12, 0); valid=bytes.toString('ascii', 4, 8)==='ftyp'; }
    finally { await handle.close(); }
    // Flow sometimes exposes only Download batch (ZIP). The exact playable
    // media source is still downloadable without selecting an unrelated item.
    if(!valid) { await this.downloadMediaSource(destination);return; }
    await saveSceneIdentity(destination,this.item);
    this.log('downloaded', { file: destination });
  }
  /** Downloads the free original from Flow's editor; the upscaled options cost credits and are never chosen. */
  private async downloadFromEditor(mediaId: string, destination: string) {
    const project = /^(.*?\/project\/[^/?#]+)/.exec(this.page.url())?.[1] ?? /^(.*?\/project\/[^/?#]+)/.exec((this.item!.flow_generation as GenerationState).url)?.[1];
    if (!project) throw new Error('Cannot tell which Flow project this clip belongs to.');
    try {
      if (!new URL(this.page.url()).pathname.endsWith(`/edit/${mediaId}`)) await this.page.goto(`${project}/edit/${mediaId}`, { waitUntil: 'domcontentloaded' });
      // Flow keeps Download media disabled until the clip has finished rendering.
      const button = this.page.getByRole('button', { name: 'Download media' });
      const minutes = Number(process.env.FLOW_QUEUE_WAIT_MINUTES ?? '30');
      const deadline = Date.now() + minutes * 60_000; let lastLog = Date.now();
      while (!(await button.isVisible() && await button.isEnabled())) {
        if (Date.now() > deadline) throw new FlowGenerationQueuedError(`Flow is still rendering this clip after ${minutes} minutes. Its id is saved; resume later to download it without resubmitting.`);
        if (Date.now() - lastLog > 60_000) { this.log('waiting_for_render', { message: 'Flow is still rendering this clip; waiting to download it.' }); lastLog = Date.now(); }
        await this.page.waitForTimeout(1000);
      }
      await button.click();
      const original = this.page.locator('[role=menu]').last().locator('[role^=menuitem]').filter({ hasText: /Original size/i }).first();
      await original.waitFor({ state: 'visible', timeout: 15000 });
      const [download] = await Promise.all([this.page.waitForEvent('download', { timeout: 180000 }), original.click()]);
      if (await download.failure()) throw new Error('Flow download failed. Resume to retry this clip.');
      const temporary = `${destination}.download`;
      await download.saveAs(temporary);
      const bytes = Buffer.alloc(12); const handle = await fs.open(temporary, 'r');
      try { await handle.read(bytes, 0, 12, 0); } finally { await handle.close(); }
      if (bytes.toString('ascii', 4, 8) !== 'ftyp') { await fs.rm(temporary, { force: true }); throw new Error('Flow did not return an MP4 for this clip. Refusing an invalid download.'); }
      await fs.rename(temporary, destination);
      await saveSceneIdentity(destination, this.item!);
      this.log('downloaded', { file: destination });
    } finally {
      // The editor has its own prompt box; later prompts must go to the project's agent composer.
      await this.page.goto(project, { waitUntil: 'domcontentloaded' });
      await this.page.locator("button[aria-label='Agent instructions']").first().waitFor({ state: 'visible', timeout: 120000 });
    }
  }
  private async downloadMediaSource(destination: string) {
    const state=this.item?.flow_generation as GenerationState;
    if(!state?.source) throw new Error('No exact media source saved for this scene.');
    let bytes:Buffer;
    if(state.source.startsWith('blob:')||state.source.startsWith('data:')) {
      const base64=await this.page.evaluate(async source=>{
        const response=await fetch(source);if(!response.ok) throw new Error('Media source download failed.');
        const blob=await response.blob();return new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);});
      },state.source);
      bytes=Buffer.from(base64,'base64');
    } else {
      const response=await this.page.request.get(state.source,{timeout:120000});
      if(!response.ok()) throw new Error(`Scene media source download failed (${response.status()}).`);
      bytes=await response.body();
    }
    if(bytes.toString('ascii',4,8)!=='ftyp') throw new Error('Scene media source did not return an MP4. Refusing an invalid result.');
    const temporary=destination+'.tmp';await fs.writeFile(temporary,bytes);await fs.rename(temporary,destination);
    await saveSceneIdentity(destination,this.item!);
    this.log('downloaded',{file:destination});
  }
}

export async function start(url: string, userDataDir: string, log: (e: string, d?: any) => void) {
  const context = await launchProfile(userDataDir);
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    log('waiting_for_flow_ready', { message: 'Complete Google sign-in or verification here if prompted. Automation will wait.' });
    const ready = page.locator(S.addMedia.join(',')).or(page.getByRole('button', { name: /New project/i })).first();
    await ready.waitFor({ state: 'visible', timeout: 600000 });
    if (await page.getByRole('button', { name: /New project/i }).isVisible()) {
      await page.getByRole('button', { name: /New project/i }).click();
      await page.locator(S.addMedia.join(',')).first().waitFor({ state: 'visible', timeout: 60000 });
    }
    log('flow_ready', { url: page.url() });
    return { context, page, flow: new FlowClient(page, log) };
  } catch (error) { await context.close(); throw error; }
}
