import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const envFile = path.join(root, 'scripting/.env');
export async function loadEnvironment() {
  try { process.loadEnvFile(envFile); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
}
export interface Config { apiKey: string; accountId: string; visibility: string }
export const ZERNIO_MISSING = 'Zernio is not configured, so nothing was uploaded. Fill ZERNIO_API_KEY and ZERNIO_YOUTUBE_ACCOUNT_ID in scripting/.env, then upload the approved video.';
/** Uploading is optional: without Zernio settings, approved videos wait locally for a later upload. */
export async function uploadsEnabled() {
  await loadEnvironment();
  return Boolean(process.env.ZERNIO_API_KEY?.trim() && process.env.ZERNIO_YOUTUBE_ACCOUNT_ID?.trim());
}
export async function ask(question: string, secret = false): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('Interactive setup required. Run npm run setup in a terminal.');
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  try { process.stdout.write(question); muted = secret; return (await rl.question('')).trim(); }
  finally { muted = false; rl.close(); if (secret) process.stdout.write('\n'); }
}
export async function setup(assets = true): Promise<Config> {
  await loadEnvironment();
  const apiKey = process.env.ZERNIO_API_KEY?.trim() ?? '';
  const accountId = process.env.ZERNIO_YOUTUBE_ACCOUNT_ID?.trim() ?? '';
  const visibility = process.env.YOUTUBE_VISIBILITY?.trim() || 'private';
  // Only an upload (assets=false) needs Zernio; producing and reviewing a video does not.
  if (!assets && (!apiKey || !accountId)) throw new Error(ZERNIO_MISSING);
  if (!['public', 'private', 'unlisted'].includes(visibility)) throw new Error('YOUTUBE_VISIBILITY must be public, private or unlisted in scripting/.env.');
  if (assets) {
    if (!process.env.GROQ_API_KEY?.trim()) {
      throw new Error('Add GROQ_API_KEY to scripting/.env.');
    }
    for (const [name, variable] of [['channel-logo', 'CHANNEL_LOGO_PATH'], ['channel-intro.mp4', 'CHANNEL_INTRO_PATH']]) {
      // A per-video asset is checked in place and never replaces the channel's saved copy.
      const perVideo = variable.replace('CHANNEL_', 'VIDEO_');
      if (process.env[perVideo]?.trim()) {
        try { await fs.access(path.resolve(root, process.env[perVideo]!.trim())); continue; } catch { throw new Error(`${perVideo} points to a missing file.`); }
      }
      const value = process.env[variable]?.trim();
      const configuredPath = value ? path.resolve(root, value) : undefined;
      const logoExtension = configuredPath && name === 'channel-logo'
        ? path.extname(configuredPath).toLowerCase()
        : '.png';
      if (name === 'channel-logo' && !['.png', '.jpg', '.jpeg'].includes(logoExtension)) {
        throw new Error('CHANNEL_LOGO_PATH must point to a PNG or JPG image.');
      }
      const destination = path.join(root, 'production/assets', name === 'channel-logo' ? `${name}${logoExtension}` : name);
      const source = configuredPath ?? destination;
      try { await fs.access(source); } catch { throw new Error(`Set ${variable} to an existing file in scripting/.env.`); }
      if (source !== destination) await fs.copyFile(source, destination);
    }
  }
  return { apiKey, accountId, visibility };
}
