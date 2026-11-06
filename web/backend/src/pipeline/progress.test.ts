import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LineAssembler } from './jsonLines.js';
import { ProgressInterpreter, errorFrom, type Update } from './progress.js';

function run(lines: string[]) {
  const assembler = new LineAssembler();
  const interpreter = new ProgressInterpreter();
  const updates: Update[] = [];
  for (const line of lines) for (const parsed of assembler.push(line)) updates.push(interpreter.handle(parsed));
  for (const parsed of assembler.flush()) updates.push(interpreter.handle(parsed));
  return updates;
}

const pretty = (value: unknown) => JSON.stringify(value, null, 2).split('\n');

test('a full workflow transcript maps to stages, attention and the final review state', () => {
  const updates = run([
    '{"event":"script_locked","words":120}',
    '{"event":"script_stage_done","stage":"characters","count":2}',
    '{"event":"script_stage_done","stage":"backgrounds","count":3}',
    '{"event":"script_stage_done","stage":"scenes","count":12}',
    'ffmpeg version 9.0.1 Copyright (c) 2000-2026 the FFmpeg developers',
    'built with Apple clang version 21.0.0',
    'Exiting with exit code 0',
    '/repo/scripting/projects/video-1/pipeline.json',
    '{"at":"2026-11-05T10:00:00Z","event":"waiting_for_flow_ready","message":"Complete Google sign-in"}',
    '{"at":"2026-11-05T10:00:05Z","event":"flow_ready","url":"https://labs.google/flow/project/1"}',
    '{"at":"2026-11-05T10:00:06Z","event":"start","label":"scene:4"}',
    '{"at":"2026-11-05T10:01:06Z","event":"waiting_for_generation","message":"Watching current media"}',
    '{"at":"2026-11-05T10:02:00Z","event":"downloaded","file":"/out/scene-0004.mp4"}',
    '{"at":"2026-11-05T10:02:00Z","event":"done","label":"scene:4"}',
    '{"file":"/out/narration-manifest.json","scenes":[1,2,5]}',
    'Waiting for AI Studio speech generation. Complete Google sign-in here if prompted.',
    'Narration 1: using existing audio.',
    'Hey, when I open Google AI Studio, just click on the Run button so I can proceed.',
    'Narration 2: downloaded.',
    'Narration 5: downloaded.',
    ...pretty({ output: '/out/background-music.mp3', refreshed_authorization: false, sound: { id: 1, name: 'Dark drone', license: 'Creative Commons 0', durationSeconds: 90 }, query: 'horror' }),
    '{"output":"/out/final-narrated.mp4","edit_report":"/out/final-narrated.mp4.edit-report.json","durationSeconds":61.2,"clips":12,"backgroundReviewWarnings":0}',
    '{"input":"/out/final-narrated.mp4","output":"/out/final.mp4","title":"t","titleEndSeconds":3.7}',
    ...pretty({ format: { duration: '66.2', size: '123' } }),
    ...pretty({ event: 'video_ready', video_path: '/out/final.mp4', status: 'awaiting_approval' }),
    'Review the video in the web app, or run: npm --prefix production run review -- prompt --project <pipeline.json>',
  ]);
  const statuses = updates.map(u => u.status).filter(Boolean);
  assert.deepEqual(statuses, ['narrating', 'mixing', 'mixing', 'rendering', 'awaiting_approval']);
  assert.deepEqual(updates[1].stages, { script: { done: 1 }, characters: { total: 2 } });
  assert.deepEqual(updates[3].stages, { script: { done: 3 } });
  const attention = updates.filter(u => u.attention !== undefined).map(u => u.attention && `${u.attention.type}${u.attention.delayed ? ':delayed' : ''}`);
  assert.deepEqual(attention, ['flow_sign_in:delayed', null, null, 'ai_studio_sign_in:delayed', null, 'ai_studio_run', null, null, null]);
  assert.ok(updates.some(u => u.activity === 'Waiting for Flow to finish scene 4 video'));
  assert.deepEqual(updates.filter(u => u.stages?.narration).map(u => u.stages!.narration), [{ done: 0, total: 3 }, { done: 1 }, { done: 2 }, { done: 3 }]);
  assert.ok(!updates.some(u => u.log?.message?.startsWith('ffmpeg version')), 'FFmpeg banners are not logged');
  assert.ok(!updates.some(u => u.log?.event === 'output'), 'every JSON block was recognised');
});

test('Flow verification on a failed item raises an attention banner; queue pauses are explained', () => {
  const [failed, paused] = run([
    '{"event":"failed","label":"scene:2","error":"Error: Google Flow requests account verification. Submission saved; clear the warning and resume this project."}',
    '{"event":"paused_for_flow_queue","label":"scene:3","message":"Flow has not produced this generation yet."}',
  ]);
  assert.equal(failed.attention?.type, 'flow_verification');
  assert.equal(failed.recount, true);
  assert.equal(paused.attention?.type, 'flow_queue');
});

test('a truncated pretty block falls back to text instead of being lost', () => {
  const updates = run(['{', '  "event": "video_ready",']);
  assert.deepEqual(updates.map(u => u.log?.message), ['{', '"event": "video_ready",']);
});

test('the most specific error is chosen from stderr', () => {
  const nested = [
    'file:///repo/production/src/cli.ts:7',
    'Error: Google Flow requests account verification. Submission saved; clear the warning and resume this project.',
    '    at waitGeneration (file:///repo/production/src/generation.ts:39:13)',
    'Error: node exited with code 1; later stages were not run.',
  ];
  assert.match(errorFrom(nested, 'x'), /account verification/);
  assert.equal(errorFrom(['Traceback (most recent call last):', 'ValueError: Expected 12 scenes, got 11'], 'x'), 'Expected 12 scenes, got 11');
  assert.equal(errorFrom(['Error: python3 exited with code 1; later stages were not run.'], 'x'), 'python3 exited with code 1; later stages were not run.');
  assert.equal(errorFrom(['plain noise'], 'fallback'), 'fallback');
});
