import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Router } from 'express';
import mongoose from 'mongoose';
import { config, envFile, pipelineEnv, python, repoRoot, scriptingDir, settings, uploadsEnabled } from '../config.js';
import { JobModel } from '../models/Job.js';
import type { JobQueue } from '../queue.js';

const exec = promisify(execFile);
export interface Check { id: string; label: string; ok: boolean; required: boolean; detail: string }

let toolCache: { at: number; checks: Check[] } | undefined;

async function toolChecks(): Promise<Check[]> {
  if (toolCache && Date.now() - toolCache.at < 60_000) return toolCache.checks;
  const env = pipelineEnv();
  let ffmpeg: Check = { id: 'ffmpeg', label: 'FFmpeg with libass', ok: false, required: true, detail: 'FFmpeg was not found on PATH.' };
  try {
    const { stdout } = await exec('ffmpeg', ['-hide_banner', '-filters'], { env, maxBuffer: 4 * 1024 * 1024 });
    ffmpeg = / subtitles /.test(stdout)
      ? { ...ffmpeg, ok: true, detail: 'Title, intro and logo rendering are available.' }
      : { ...ffmpeg, detail: 'This FFmpeg has no subtitles filter, so the title render will fail. On macOS run: brew install ffmpeg-full (it is used automatically).' };
  } catch {}
  let py: Check = { id: 'python', label: 'Python scripting dependencies', ok: false, required: true, detail: '' };
  try { await exec(python(), ['-c', 'import groq, dotenv, jsonschema'], { cwd: scriptingDir, env }); py = { ...py, ok: true, detail: python() }; }
  catch { py.detail = `Run: ${python()} -m pip install -r scripting/requirements.txt`; }
  const playwright = fs.existsSync(path.join(repoRoot, 'production/node_modules/playwright'));
  const checks = [ffmpeg, py, { id: 'production', label: 'Production dependencies', ok: playwright, required: true, detail: playwright ? 'Installed.' : 'Run: npm --prefix production install' }];
  toolCache = { at: Date.now(), checks };
  return checks;
}

function fileCheck(id: string, label: string, value: string | undefined, fallback: string): Check {
  const file = path.resolve(repoRoot, value?.trim() || fallback);
  const ok = fs.existsSync(file);
  return { id, label, ok, required: true, detail: ok ? (file.startsWith(repoRoot) ? path.relative(repoRoot, file) : file) : `Set ${id === 'logo' ? 'CHANNEL_LOGO_PATH' : 'CHANNEL_INTRO_PATH'} in scripting/.env, or upload one per video.` };
}

export function systemRouter(queue: JobQueue) {
  const router = Router();
  router.get('/status', async (_req, res) => {
    const env = settings();
    const set = (name: string) => Boolean(env[name]?.trim());
    const visibility = env.YOUTUBE_VISIBILITY?.trim() || 'private';
    const checks: Check[] = [
      { id: 'env', label: 'Settings file', ok: fs.existsSync(envFile), required: true, detail: fs.existsSync(envFile) ? 'scripting/.env' : 'Run: node welcome.mjs' },
      { id: 'groq', label: 'Groq API key', ok: set('GROQ_API_KEY'), required: true, detail: set('GROQ_API_KEY') ? `Model: ${env.GROQ_MODEL || 'openai/gpt-oss-120b'}` : 'Add GROQ_API_KEY to scripting/.env.' },
      { id: 'zernio', label: 'Zernio upload settings', ok: uploadsEnabled(), required: false, detail: uploadsEnabled() ? `Visibility: ${visibility}` : 'Optional. Not set: videos are produced and reviewed, and approved videos wait here until you add ZERNIO_API_KEY and ZERNIO_YOUTUBE_ACCOUNT_ID.' },
      fileCheck('logo', 'Channel logo', env.CHANNEL_LOGO_PATH, 'production/assets/channel-logo.png'),
      fileCheck('intro', 'Channel intro', env.CHANNEL_INTRO_PATH, 'production/assets/channel-intro.mp4'),
      { id: 'freesound', label: 'Freesound music credentials', ok: ['FREESOUND_CLIENT_ID', 'FREESOUND_CLIENT_SECRET', 'FREESOUND_REFRESH_TOKEN'].every(set), required: true, detail: 'See docs/freesound-onboarding.md.' },
      { id: 'flow', label: 'Google Flow browser profile', ok: fs.existsSync(config.profiles.default), required: false, detail: fs.existsSync(config.profiles.default) ? 'Profile exists. Keep it signed in to Google Flow and AI Studio.' : 'Created on the first run. Sign in to Google in the Chrome window that opens.' },
      ...await toolChecks(),
      { id: 'mongo', label: 'MongoDB', ok: mongoose.connection.readyState === 1, required: true, detail: mongoose.connection.readyState === 1 ? 'Connected.' : 'Not connected.' },
    ];
    if (checks.find(c => c.id === 'freesound')!.ok) checks.find(c => c.id === 'freesound')!.detail = 'Configured.';
    const queued = await JobModel.countDocuments({ status: 'queued' });
    res.json({ ready: checks.every(c => c.ok || !c.required), checks, visibility, uploadsEnabled: uploadsEnabled(), queue: { activeJobId: queue.activeJobId() ?? null, queued } });
  });
  return router;
}
