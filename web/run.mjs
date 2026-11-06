// Starts the API and the Next.js UI together; Ctrl+C stops both (a running video stops with progress saved).
import { spawn } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2] === 'start' ? 'start' : 'dev';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const parts = [
  { name: 'api', cwd: path.join(here, 'backend'), script: 'start' },
  { name: 'web', cwd: path.join(here, 'frontend'), script: mode },
];

let stopping = false;
const children = parts.map(({ name, cwd, script }) => {
  const child = spawn(npm, ['run', '--silent', script], { cwd, shell: process.platform === 'win32', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  for (const stream of [child.stdout, child.stderr]) readline.createInterface({ input: stream }).on('line', line => console.log(`[${name}] ${line}`));
  child.on('exit', code => {
    if (!stopping) { console.log(`[${name}] exited with code ${code}; stopping.`); stop(code ?? 1); }
  });
  return child;
});

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 10000).unref();
  Promise.all(children.map(c => c.exitCode !== null || new Promise(r => c.once('exit', r)))).then(() => process.exit(code));
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
console.log(`YouTube Automation (${mode}): UI http://localhost:3000 · API http://localhost:4000`);
