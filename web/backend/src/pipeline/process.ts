import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import { LineAssembler, type Parsed } from './jsonLines.js';

export interface Tracked {
  done: Promise<{ code: number; stderr: string[] }>;
  stop(): void;
}

const STDERR_TAIL = 80;

/** Spawns a pipeline command in its own process group so a stop also ends Chrome and nested scripts. */
export function track(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv },
  onStdout: (parsed: Parsed) => void, onStderr: (line: string) => void): Tracked {
  const child: ChildProcess = spawn(command, args, {
    cwd: options.cwd, env: options.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32', windowsHide: true,
  });
  const assembler = new LineAssembler();
  const stderr: string[] = [];
  readline.createInterface({ input: child.stdout! }).on('line', line => assembler.push(line).forEach(onStdout));
  readline.createInterface({ input: child.stderr! }).on('line', line => {
    if (!line.trim()) return;
    stderr.push(line); if (stderr.length > STDERR_TAIL) stderr.shift();
    onStderr(line);
  });
  const done = new Promise<{ code: number; stderr: string[] }>(resolve => {
    child.once('error', error => { stderr.push(`Error: ${error.message}`); resolve({ code: -1, stderr }); });
    child.once('close', (code, signal) => {
      assembler.flush().forEach(onStdout);
      resolve({ code: code ?? (signal ? 128 : 1), stderr });
    });
  });
  return {
    done,
    stop() {
      if (child.pid === undefined || child.exitCode !== null) return;
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } }
    },
  };
}
