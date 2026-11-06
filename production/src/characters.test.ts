import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Page } from 'playwright';
import { FlowClient } from './flowClient.js';
import { voiceFor } from './characters.js';
import type { Item } from './types.js';

// A small stand-in for Flow's agent UI, mirroring the controls observed in the live product (Nov 2026).
const FLOW = `<!doctype html><html><body><div id="app"></div><script>
const S = JSON.parse(localStorage.getItem('flow') || 'null') || { chars: [{ id: 'amit', name: '@CHAR-01-AMIT', voice: null, info: '' }],
  images: [{ title: 'Amit sheet', id: 'amit' }, { title: 'Driver sheet', id: 'driver' }, { title: 'Bus interior', id: 'bus' }],
  generations: 0, chips: [], view: 'all' };
const save = () => localStorage.setItem('flow', JSON.stringify(S));
const loaded = new Set();
// Like Flow: an image's address changes between page loads; its data-media-id does not.
const TOKEN = Math.random().toString(36).slice(2, 8);
const src = i => 'https://flow.test/asb/' + i.id + '-' + TOKEN + '=s1600-rw';
const go = url => { history.pushState({}, '', url); render(); };
const icon = t => '<span aria-hidden="true">' + t + '</span>';
const app = document.getElementById('app');
function render() {
  save(); const path = location.pathname;
  const ent = path.match(/character\\/([\\w-]+)$/);
  if (ent) { const c = S.chars.find(x => x.id === ent[1]);
    // Like Flow: the name shows first; the voice control and saved info arrive ~0.7s later and replace what was typed.
    const loading = !loaded.has(c.id); if (loading) { loaded.add(c.id); setTimeout(render, 700); }
    app.innerHTML = '<button aria-label="Move to trash">t</button><button id="done">Done</button><input aria-label="Character name" value="' + c.name + '"><button aria-label="Edit name">e</button>'
      + (loading ? '' : '<button id="voice">' + icon('voice_selection') + (c.voice ? c.voice.toLowerCase() : 'Select a voice') + '</button>') + '<textarea aria-label="Character personality">' + (loading ? '' : c.info) + '</textarea>'
      + '<div contenteditable="true" role="textbox" aria-label="What do you want to change?"></div><button aria-label="Start generation" onclick="S.generations++;save()">go</button>';
    const input = app.querySelector('input');
    input.onkeydown = e => { if (e.key === 'Enter') { c.name = input.value; save(); } };
    app.querySelector('#done').onclick = () => { c.info = app.querySelector('textarea').value; S.view = 'characters'; go('/project/p1'); };
    if (!loading) app.querySelector('#voice').onclick = () => voiceDialog(c);
    return; }
  if (path.endsWith('/character')) {
    app.innerHTML = '<button>' + icon('upload') + 'Upload</button><button id="afp">' + icon('add') + 'Add from project</button><div contenteditable="true" role="textbox" aria-label="Describe your character…"></div><button aria-label="Start generation" onclick="S.generations++;save()">go</button>';
    app.querySelector('#afp').onclick = () => picker('dialog', S.images.map(i => ({ label: i.title, src: src(i) })), 'Add media', choice => {
      const id = 'c' + S.chars.length; S.chars.push({ id, name: 'Untitled character', voice: null, info: '' });
      setTimeout(() => go('/project/p1/character/' + id), 300); });
    return; }
  app.innerHTML = '<nav><button id="all">' + icon('dashboard') + 'All media</button><button id="chars">' + icon('accessibility_new') + 'Characters</button></nav><main id="main"></main>'
    + '<div id="chips">' + S.chips.map(() => '<button aria-label="Ingredient">i</button>').join('') + '</div>'
    + (S.chips.length ? '<button aria-label="Clear prompt">x</button>' : '')
    + '<div contenteditable="true" role="textbox" aria-label="What do you want to create?"></div><button aria-label="Add ingredients to the prompt box">+</button><button aria-label="Agent instructions">a</button><button aria-label="Start generation" onclick="S.generations++;save()">go</button>';
  const main = app.querySelector('#main');
  main.innerHTML = S.view === 'characters'
    ? '<button id="new">' + icon('add') + 'New character</button>' + S.chars.map(c => '<div class="tile"><span>' + c.name + '</span></div>').join('')
    : S.images.map(i => '<img data-media-id="' + i.id + '" src="' + src(i) + '">').join('');
  app.querySelector('#all').onclick = () => { S.view = 'all'; render(); };
  app.querySelector('#chars').onclick = () => { S.view = 'characters'; render(); };
  if (S.view === 'characters') app.querySelector('#new').onclick = () => go('/project/p1/character');
  const clear = app.querySelector('[aria-label="Clear prompt"]'); if (clear) clear.onclick = () => { S.chips = []; render(); };
  app.querySelector('[aria-label="Add ingredients to the prompt box"]').onclick = () => ingredients(null);
}
function picker(role, options, confirm, done) {
  const box = document.createElement('div'); box.setAttribute('role', role === 'dialog' ? 'dialog' : 'presentation');
  box.innerHTML = '<div role="listbox">' + options.map((o, i) => '<div role="option" data-i="' + i + '" aria-selected="false"><img src="' + o.src + '"><div>' + o.label + '</div>' + (o.kind ? '<div>' + o.kind + '</div>' : '') + '</div>').join('') + '</div><button id="confirm">' + confirm + '</button>';
  let chosen = null;
  box.querySelectorAll('[role=option]').forEach(el => el.onclick = () => { chosen = options[el.dataset.i]; el.setAttribute('aria-selected', 'true'); });
  box.querySelector('#confirm').onclick = () => { box.remove(); if (chosen) done(chosen); };
  document.body.appendChild(box);
}
// Like Flow: Add to prompt shows in every tab, but the Images/Characters tabs list bare names and attach on click.
// Like Flow after navigating: tabs appear ~0.7s after opening, and a list loads only once a tab is chosen.
function ingredients(tab) {
  document.querySelector('#ingredients')?.remove();
  if (tab === null) { const shell = document.createElement('div'); shell.id = 'ingredients'; document.body.appendChild(shell); setTimeout(() => { if (shell.isConnected) { shell.remove(); ingredients('pending'); } }, 700); return; }
  const chars = S.chars.map(c => ({ label: c.name, kind: 'Character', src: 'https://flow-content.test/image/' + c.id + '?Signature=x' }));
  const imgs = S.images.map(i => ({ label: i.title, kind: 'Image', src: src(i) }));
  const options = tab === 'pending' ? [] : tab === 'All' ? [...chars, ...imgs] : tab === 'Characters' ? chars : imgs;
  const box = document.createElement('div'); box.id = 'ingredients';
  box.innerHTML = ['All', 'Images', 'Characters'].map(t => '<div role="tab" aria-selected="' + (t === tab) + '" data-t="' + t + '">' + icon(t === 'All' ? 'dashboard' : t === 'Images' ? 'image' : 'accessibility_new') + t + '</div>').join('')
    + '<div role="listbox">' + options.map((o, i) => '<div role="option" data-i="' + i + '"><img src="' + o.src + '"><div>' + o.label + '</div>' + (tab === 'All' ? '<div>' + o.kind + '</div>' : '') + '</div>').join('') + '</div>'
    + '<button id="confirm">Add to prompt</button>';
  let chosen = null;
  const attach = o => { box.remove(); S.chips.push(o.label); render(); };
  box.querySelectorAll('[role=tab]').forEach(el => el.onclick = () => ingredients(el.dataset.t));
  box.querySelectorAll('[role=option]').forEach(el => el.onclick = () => { chosen = options[el.dataset.i]; if (tab !== 'All') attach(chosen); });
  box.querySelector('#confirm').onclick = () => chosen && attach(chosen);
  document.body.appendChild(box);
}
function voiceDialog(c) {
  const voices = ['Achernar Female, soft, high pitch', 'Algenib Male, gravelly, low pitch', 'Despina Female, smooth, mid pitch', 'Gacrux Female, mature, mid pitch', 'Iapetus Male, clear, mid-low pitch', 'Leda Female, youthful, mid-high pitch', 'Fenrir Male, excitable, younger pitch'];
  const box = document.createElement('div'); box.setAttribute('role', 'dialog');
  // Like Flow: icon, name and description are adjacent elements without separating whitespace.
  box.innerHTML = '<div role="listbox">' + voices.map(v => '<div role="option">' + icon('voice_selection') + '<div>' + v.split(' ')[0] + '</div><div>' + v.split(' ').slice(1).join(' ') + '</div></div>').join('') + '</div><button id="add">Add to character</button>';
  let chosen = null;
  box.querySelectorAll('[role=option]').forEach(el => el.onclick = () => { chosen = el.children[1].textContent; });
  box.querySelector('#add').onclick = () => { c.voice = chosen; box.remove(); render(); };
  document.body.appendChild(box);
}
window.onpopstate = render; render();
</script></body></html>`;

async function flowPage(t: any): Promise<Page> {
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('https://flow.test/**', route => route.fulfill({ contentType: 'text/html', body: FLOW }));
  await page.route('https://flow-content.test/**', route => route.fulfill({ status: 204 }));
  await page.goto('https://flow.test/project/p1');
  return page;
}
const state = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('flow')!));
// Saved in an earlier session: the address token is stale, the media id is not.
const generated = (id: string) => ({ phase: 'complete', url: 'https://flow.test/project/p1', baseline: [], started_at: 'now', source: `https://flow.test/asb/${id}-STALE=s1600-rw`, media_id: id });

test('voices follow the character description: gender first, then age', () => {
  assert.equal(voiceFor('Older male, gravelly North Indian Hindi'), 'Algenib');
  assert.equal(voiceFor('Female elder, late 60s, frail build'), 'Gacrux');
  assert.equal(voiceFor('Young female, soft voice'), 'Leda');
  assert.equal(voiceFor('25-year-old man, calm'), 'Iapetus');
  assert.equal(voiceFor('teenage boy, nervous'), 'Fenrir');
  assert.equal(voiceFor('एक बूढ़ी औरत'), 'Gacrux');
  assert.equal(voiceFor('a woman in her thirties'), 'Despina');
});

test('a generated character image becomes a named Flow character with a voice; existing names are reused; no generation is started', async t => {
  const page = await flowPage(t);
  const flow = new FlowClient(page, () => {});
  let saves = 0; const save = async () => { saves++; };
  const amit: Item = { status: 'done', tag: '@CHAR-01-AMIT', look_summary: 'man, 25', voice_description: 'Calm adult male' };
  await flow.ensureCharacter(amit, save);
  assert.deepEqual((amit.flow_character as any).existing, true);
  const driver: Item = { status: 'done', tag: '@CHAR-02-DRIVER', look_summary: '55-year-old bus driver, grey moustache', voice_description: 'Older male, gravelly North Indian Hindi', flow_generation: generated('driver') };
  await flow.ensureCharacter(driver, save);
  let s = await state(page);
  const made = s.chars.find((c: any) => c.name === '@CHAR-02-DRIVER');
  assert.ok(made, 'the character was saved under its tag');
  assert.equal(made.voice, 'Algenib');
  assert.match(made.info, /grey moustache.*gravelly/s);
  assert.equal((driver.flow_character as any).done, true);
  assert.equal(s.chars.length, 2);
  await flow.ensureCharacter(driver, save);
  s = await state(page);
  assert.equal(s.chars.length, 2, 'a saved character is never created twice');
  assert.equal(s.generations, 0);
  assert.ok(saves >= 3);
  assert.match(page.url(), /\/project\/p1$/);
});

test('an interrupted character save resumes on the same entity instead of creating another', async t => {
  const page = await flowPage(t);
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('flow')!); s.chars.push({ id: 'half', name: 'Untitled character', voice: null, info: '' }); localStorage.setItem('flow', JSON.stringify(s)); });
  const flow = new FlowClient(page, () => {});
  const budhiya: Item = { status: 'done', tag: '@CHAR-03-BUDHIYA', look_summary: 'Female elder, late 60s', voice_description: 'eerie old woman', flow_generation: generated('amit'), flow_character: { url: 'https://flow.test/project/p1/character/half' } };
  await flow.ensureCharacter(budhiya, async () => {});
  const s = await state(page);
  assert.equal(s.chars.length, 2);
  assert.equal(s.chars[1].name, '@CHAR-03-BUDHIYA');
  assert.equal(s.chars[1].voice, 'Gacrux');
  assert.equal(s.generations, 0);
});

test('scene ingredients attach the exact characters and background image; a missing one stops before submission', async t => {
  const page = await flowPage(t);
  const flow = new FlowClient(page, () => {});
  await flow.attachIngredients([{ label: '@CHAR-01-AMIT', character: '@CHAR-01-AMIT' }, { label: '#BGD-01-BUS', mediaId: 'bus' }]);
  await flow.agentPrompt('Scene 1 text');
  assert.deepEqual((await state(page)).chips, ['@CHAR-01-AMIT', 'Bus interior']);
  await flow.attachIngredients([{ label: '@CHAR-01-AMIT', character: '@CHAR-01-AMIT' }]);
  assert.deepEqual((await state(page)).chips, ['@CHAR-01-AMIT'], 'earlier ingredients are cleared first');
  await assert.rejects(flow.attachIngredients([{ label: '@CHAR-09-NOBODY', character: '@CHAR-09-NOBODY' }]), /@CHAR-09-NOBODY.*Nothing was submitted/s);
  await assert.rejects(flow.attachIngredients([{ label: '#BGD-02-GONE', mediaId: 'gone' }]), /#BGD-02-GONE.*Nothing was submitted/s);
  await assert.rejects(flow.attachIngredients([{ label: '#BGD-03-NEVER' }]), /#BGD-03-NEVER has no generated image.*Nothing was submitted/s);
  assert.equal((await state(page)).generations, 0);
});
