import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const envFile = path.join(repoRoot, 'scripting/.env');
export const scriptingDir = path.join(repoRoot, 'scripting');
export const productionDir = path.join(repoRoot, 'production');

// Fresh scripting/.env values (real env vars win), never copied into process.env,
// so pipeline children always load the file's latest edits themselves.
export function settings(): Record<string, string | undefined> {
  let file: Record<string, string> = {};
  try { file = parseEnv(fs.readFileSync(envFile, 'utf8')) as Record<string, string>; }
  catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  return { ...file, ...process.env };
}

const initial = settings();
export const config = {
  port: Number(initial.WEB_API_PORT || 4000),
  origin: (initial.WEB_ORIGIN || 'http://localhost:3000').split(',').map(s => s.trim()),
  mongoUrl: initial.MONGO_URL || 'mongodb://127.0.0.1:27017/youtube_automation',
  projectsDir: path.join(scriptingDir, 'projects'),
  outputsDir: path.join(productionDir, 'outputs'),
  // One logged-in automation profile per Flow account; multi-user maps users to profiles.
  profiles: { default: path.join(productionDir, 'chrome-profile') } as Record<string, string>,
  attentionDelayMs: Number(initial.WEB_ATTENTION_DELAY_MS || 20000),
};

/** Zernio is optional: without it, approved videos stay local until it is configured. */
export function uploadsEnabled(): boolean {
  const env = settings();
  return Boolean(env.ZERNIO_API_KEY?.trim() && env.ZERNIO_YOUTUBE_ACCOUNT_ID?.trim());
}

export function python(): string {
  const venv = path.join(scriptingDir, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (fs.existsSync(venv)) return venv;
  return process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

/** PATH for pipeline children, preferring an FFmpeg build with libass (the title overlay needs it). */
export function pipelinePath(): string {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates = [settings().FFMPEG_DIR, '/opt/homebrew/opt/ffmpeg-full/bin', '/usr/local/opt/ffmpeg-full/bin'];
  const full = candidates.find(dir => dir && fs.existsSync(path.join(dir, exe)));
  return full ? `${full}${path.delimiter}${process.env.PATH ?? ''}` : process.env.PATH ?? '';
}

export function pipelineEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, PATH: pipelinePath(), PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', FORCE_COLOR: '0', NO_COLOR: '1', ...extra };
}
