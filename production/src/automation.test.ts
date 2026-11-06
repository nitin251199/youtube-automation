import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FlowClient, FlowGenerationQueuedError } from './flowClient.js';
import { generateNarration } from './narration.js';
import type { Item } from './types.js';

test('current clip is downloaded despite historical queue text, approval happens once, resume does not submit again', async t => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'flow-regression-'));
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await fs.rm(dir,{recursive:true,force:true});});
  const page=await browser.newPage({acceptDownloads:true});
  await page.setContent(`<main><p>Old message: high demand, waiting in the queue</p><div><video src="https://test.invalid/old.mp4"></video><a download="old.mp4" href="data:application/octet-stream;base64,b2xk">Download</a></div><button aria-label="Start generation">Start</button><button id="approve" style="display:none">Approve</button><div id="new"></div></main>
  <script>window.submits=0; window.approvals=0;
  document.querySelector('[aria-label="Start generation"]').onclick=()=>{window.submits++;document.querySelector('#approve').style.display='block'};
  document.querySelector('#approve').onclick=()=>{window.approvals++;document.querySelector('#approve').remove();document.querySelector('#new').innerHTML='<video src="https://test.invalid/new.mp4"></video><a download="new.mp4" href="data:video/mp4;base64,AAAAGGZ0eXBpc29tAAAAAGlzb20=">Download</a>'};</script>`);
  const item:Item={status:'pending'};let saves=0;
  const flow=new FlowClient(page,()=>{});await flow.bind(item,async()=>{saves++;},'video');
  await flow.generate();await flow.download(dir,'scene-0001.mp4');
  assert.equal(await page.evaluate(()=> (window as any).submits),1);
  assert.equal(await page.evaluate(()=> (window as any).approvals),1);
  assert.equal((await fs.readFile(path.join(dir,'scene-0001.mp4'))).toString('ascii',4,8),'ftyp');
  assert.ok(saves>=3);
  await flow.bind(item,async()=>{},'video');await flow.generate();
  assert.equal(await page.evaluate(()=> (window as any).submits),1);
});

test('only old media does not complete a submitted scene; interrupted prepared submission refuses regeneration', async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  await page.setContent('<main><video src="https://test.invalid/old.mp4"></video></main>');
  const item:Item={status:'pending',flow_generation:{phase:'submitted',url:'about:blank',started_at:'now',baseline:['https://test.invalid/old.mp4']}};
  const {waitGeneration}=await import('./generation.js');
  await assert.rejects(waitGeneration(page,item,'video',async()=>{},()=>{},10),FlowGenerationQueuedError);
  (item.flow_generation as any).phase='prepared';
  await assert.rejects(new FlowClient(page,()=>{}).bind(item,async()=>{},'video'),/duplicate credits/);
});

test('missing tile download uses the exact current media, never a gallery-wide older download',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'scoped-download-'));const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await fs.rm(dir,{recursive:true,force:true});});const page=await browser.newPage();
  const source='data:video/mp4;base64,AAAAGGZ0eXBpc29tAAAAAGlzb20=';
  await page.setContent(`<main><video src="https://test.invalid/old.mp4"></video><button aria-label="Download old video" onclick="window.wrongDownload=true">Old download</button><div><video src="${source}"></video></div></main>`);
  const item:Item={status:'pending',flow_generation:{phase:'complete',url:'about:blank',baseline:['https://test.invalid/old.mp4'],source,started_at:'now'}};
  const flow=new FlowClient(page,()=>{});await flow.bind(item,async()=>{},'video');await flow.generate();await flow.download(dir,'scene-0001.mp4');
  assert.equal(await page.evaluate(()=>Boolean((window as any).wrongDownload)),false);
  assert.equal((await fs.readFile(path.join(dir,'scene-0001.mp4'))).toString('ascii',4,8),'ftyp');
});

test('AI Studio narration is filled and downloaded automatically as valid WAV',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'narration-regression-'));const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();await fs.rm(dir,{recursive:true,force:true});});
  const page=await browser.newPage();
  await page.setContent(`<label>Style instructions<textarea aria-label="Style instructions"></textarea></label><textarea aria-label="Text"></textarea><button>Run</button><audio></audio>
  <script>document.querySelector('button').onclick=()=>{const bytes=new Uint8Array(46);const view=new DataView(bytes.buffer);bytes.set([82,73,70,70]);view.setUint32(4,38,true);bytes.set([87,65,86,69],8);document.querySelector('audio').src=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}))};</script>`);
  const target=path.join(dir,'narration-0001.wav');await generateNarration(page,'यह कहानी है।','Calm Hindi narrator',target);
  assert.equal(await page.getByRole('textbox',{name:'Text',exact:true}).inputValue(),'यह कहानी है।');
  assert.equal((await fs.readFile(target)).toString('ascii',8,12),'WAVE');
});

test('a late-rendering Flow composer is still detected; a missing one stops before any submission',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  await page.setContent(`<main><button aria-label="Add media menu">+</button><button aria-label="Start generation" onclick="window.submits=(window.submits||0)+1">Go</button></main>
  <script>setTimeout(()=>{document.querySelector('main').insertAdjacentHTML('beforeend','<div contenteditable="true"></div><button aria-label="Agent instructions">i</button>')},1500);</script>`);
  const flow=new FlowClient(page,()=>{});
  assert.equal(await flow.uiMode(10000),'agent');
  await page.setContent('<main><button aria-label="Add media menu">+</button><button aria-label="Start generation" onclick="window.submits=1">Go</button></main>');
  await assert.rejects(flow.uiMode(300),/composer did not appear.*Nothing was submitted/s);
  assert.equal(await page.evaluate(()=>(window as any).submits),undefined);
  process.env.FLOW_CLASSIC_UI='1';t.after(()=>{delete process.env.FLOW_CLASSIC_UI;});
  assert.equal(await flow.uiMode(300),'classic');
});

test('an existing image that renders late is not mistaken for the new result',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  await page.setContent(`<main><div contenteditable="true"></div><button aria-label="Agent instructions">i</button><img data-media-id="amit" src="https://test.invalid/asb/amit.png"><button aria-label="Start generation">Go</button><div id="out"></div></main>
  <script>setTimeout(()=>document.querySelector('main').insertAdjacentHTML('beforeend','<img src="https://test.invalid/image/tile?Expires=1&Signature=a">'),800);
  document.querySelector('[aria-label="Start generation"]').onclick=()=>{window.submits=(window.submits||0)+1;setTimeout(()=>{document.querySelector('#out').innerHTML='<img data-media-id="driver" src="https://test.invalid/asb/driver.png">'},1500)};</script>`);
  const flow=new FlowClient(page,()=>{});await flow.uiMode(5000);
  const item:Item={status:'pending'};await flow.bind(item,async()=>{},'image');await flow.agentPrompt('Generate the driver');await flow.generate();
  assert.equal((item.flow_generation as any).source,'https://test.invalid/asb/driver.png');
  assert.equal((item.flow_generation as any).media_id,'driver');
  assert.deepEqual((item.flow_generation as any).baseline_ids,['amit']);
  assert.equal(await page.evaluate(()=>(window as any).submits),1);
});

test('a re-signed URL of old media does not complete a submitted item',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  await page.setContent('<main><img src="https://test.invalid/image/tile?Expires=2&Signature=b"></main>');
  const item:Item={status:'pending',flow_generation:{phase:'submitted',url:'about:blank',started_at:'now',baseline:['https://test.invalid/image/tile?Expires=1&Signature=a']}};
  const {waitGeneration}=await import('./generation.js');
  await assert.rejects(waitGeneration(page,item,'image',async()=>{},()=>{},1500),FlowGenerationQueuedError);
});

test('while Flow is busy, the runner waits for its own Start generation button and never clicks look-alikes',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  await page.setContent(`<main><div contenteditable="true"></div><button aria-label="Agent instructions">i</button><button onclick="window.decoy=true">Generate concept art</button><button aria-label="Stop" id="busy">■</button><div id="out"></div></main>
  <script>setTimeout(()=>{document.querySelector('#busy').outerHTML='<button aria-label="Start generation" id="go">Go</button>';document.querySelector('#go').onclick=()=>{window.submits=1;setTimeout(()=>{document.querySelector('#out').innerHTML='<img src="https://test.invalid/asb/budhiya.png">'},300)}},2000);</script>`);
  const flow=new FlowClient(page,()=>{});await flow.uiMode(5000);
  const item:Item={status:'pending'};await flow.bind(item,async()=>{},'image');await flow.agentPrompt('Generate Budhiya');
  await Promise.race([flow.generate(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('generate() did not finish within 15s')),15000))]);
  assert.equal(await page.evaluate(()=>(window as any).decoy),undefined,'the look-alike button was never clicked');
  assert.equal(await page.evaluate(()=>(window as any).submits),1);
  assert.equal((item.flow_generation as any).source,'https://test.invalid/asb/budhiya.png');
});

test('Flow rotates media addresses: a resumed result is found by media id, and rotated old media never counts as new',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  const {waitGeneration}=await import('./generation.js');
  await page.setContent('<main><img data-media-id="old" src="https://t.invalid/asb/old-TOKEN2=s1600-rw"><img data-media-id="res" src="https://t.invalid/asb/res-TOKEN2=s1600-rw"></main>');
  const done:Item={status:'pending',flow_generation:{phase:'complete',url:'about:blank',started_at:'now',baseline:['https://t.invalid/asb/old-TOKEN1=s1600-rw'],baseline_ids:['old'],source:'https://t.invalid/asb/res-TOKEN1=s1600-rw',media_id:'res'}};
  await waitGeneration(page,done,'image',async()=>{},()=>{},1500);
  assert.equal((done.flow_generation as any).source,'https://t.invalid/asb/res-TOKEN2=s1600-rw');
  await page.setContent('<main><img data-media-id="old" src="https://t.invalid/asb/old-TOKEN2=s1600-rw"></main>');
  const pending:Item={status:'pending',flow_generation:{phase:'submitted',url:'about:blank',started_at:'now',baseline:['https://t.invalid/asb/old-TOKEN1=s1600-rw'],baseline_ids:['old']}};
  await assert.rejects(waitGeneration(page,pending,'image',async()=>{},()=>{},1200),FlowGenerationQueuedError);
  await page.evaluate(()=>document.querySelector('main')!.insertAdjacentHTML('beforeend','<img data-media-id="new" src="https://t.invalid/asb/new-TOKEN2=s1600-rw">'));
  await waitGeneration(page,pending,'image',async()=>{},()=>{},3000);
  assert.equal((pending.flow_generation as any).media_id,'new');
});

test('two outputs of the same request (Flow set to 2x) complete with the first instead of getting stuck',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  const {waitGeneration}=await import('./generation.js');
  await page.setContent('<main><img data-media-id="old" src="https://t.invalid/asb/old=s1600-rw"><img data-media-id="a" src="https://t.invalid/asb/a=s1600-rw"><img data-media-id="b" src="https://t.invalid/asb/b=s1600-rw"></main>');
  const logs:string[]=[];
  const item:Item={status:'pending',flow_generation:{phase:'submitted',url:'about:blank',started_at:'now',baseline:['https://t.invalid/asb/old=s1600-rw'],baseline_ids:['old']}};
  await waitGeneration(page,item,'image',async()=>{},(e)=>logs.push(e),2000);
  assert.equal((item.flow_generation as any).media_id,'a');
  assert.ok(logs.includes('multiple_results'));
});
