import type { Parsed } from './jsonLines.js';
import type { JobStatus } from '../models/Job.js';

export type AttentionType = 'flow_sign_in' | 'flow_verification' | 'flow_queue' | 'ai_studio_sign_in' | 'ai_studio_run';
export interface Attention { type: AttentionType; message: string; delayed?: boolean }
type Counter = { done?: number; total?: number };

export interface Update {
  log?: { event: string; message: string; data?: unknown };
  status?: JobStatus;
  activity?: string;
  stages?: Partial<Record<'script' | 'characters' | 'backgrounds' | 'scenes' | 'narration', Counter>>;
  /** undefined leaves the banner unchanged; null clears it. */
  attention?: Attention | null;
  /** Re-read asset/scene counts from pipeline.json. */
  recount?: boolean;
}

const NOISE = /^(?:ffmpeg|ffprobe) version |^built with |^configuration: |^lib\w+\s+\d+\.\s*\d+|^Exiting with exit code 0$|^Review the video in the web app|pipeline\.json$/;

export const ATTENTION_TEXT: Record<AttentionType, string> = {
  flow_sign_in: 'Google Flow is waiting in the automation Chrome window. If it shows a Google sign-in or verification page, complete it there. The run continues by itself.',
  flow_verification: 'Google Flow asked to verify the account. Clear the warning in the automation Chrome window, then press Resume. The saved submission will not be sent again.',
  flow_queue: 'Flow is still generating under high demand. The submission is saved; press Resume later and it will continue watching instead of submitting again.',
  ai_studio_sign_in: 'Google AI Studio is waiting in the automation Chrome window. If it shows a sign-in page, sign in there. Narration continues by itself.',
  ai_studio_run: 'Hey, when I open Google AI Studio, just click on the Run button so I can proceed.',
};

function describe(label: string): string {
  const [kind, n] = label.split(':');
  return ({ character: `character ${n}`, background: `background ${n}`, scene: `scene ${n} video` } as Record<string, string>)[kind] ?? label;
}

/** Maps the pipeline's existing output to job progress. One instance per child process. */
export class ProgressInterpreter {
  private label = '';
  narrationDone = 0;
  narrationTotal = 0;

  handle(parsed: Parsed): Update {
    return parsed.kind === 'json' ? this.json(parsed.value) : this.text(parsed.text);
  }

  private json(v: Record<string, any>): Update {
    const event = typeof v.event === 'string' ? v.event : undefined;
    switch (event) {
      case 'script_locked':
        return { log: { event, message: `Script locked (${v.words} words). Asking Groq for characters, backgrounds and 12 scenes.` }, activity: 'Extracting characters from the script' };
      case 'script_stage_done': {
        const order = ['characters', 'backgrounds', 'scenes'];
        const next = ['Extracting backgrounds', 'Splitting the script into 12 scenes', 'Scene plan validated'][order.indexOf(v.stage)];
        return { log: { event, message: `${v.stage}: ${v.count}` }, activity: next, stages: { script: { done: order.indexOf(v.stage) + 1 }, ...(v.stage === 'scenes' ? {} : { [v.stage]: { total: v.count } }) } };
      }
      case 'script_stage_retry':
        return { log: { event, message: `Groq returned an invalid plan (${v.error}); retrying.` } };
      case 'script_ready':
        return { log: { event, message: `Plan ready: ${v.characters} characters, ${v.backgrounds} backgrounds, ${v.scenes} scenes.` }, recount: true };
      case 'waiting_for_flow_ready':
        return { log: { event, message: 'Opening Google Flow in the automation browser.' }, activity: 'Opening Google Flow', attention: { type: 'flow_sign_in', message: ATTENTION_TEXT.flow_sign_in, delayed: true } };
      case 'flow_ready':
        return { log: { event, message: 'Google Flow is ready.' }, attention: null, activity: 'Google Flow is ready' };
      case 'start':
        this.label = String(v.label ?? '');
        return { log: { event, message: `Generating ${describe(this.label)}.` }, activity: `Generating ${describe(this.label)}`, attention: null, recount: true };
      case 'done':
        return { log: { event, message: `Finished ${describe(String(v.label))}.` }, recount: true };
      case 'failed': {
        const error = String(v.error ?? '');
        return {
          log: { event, message: `Failed ${describe(String(v.label))}: ${error}` }, recount: true,
          ...(/verif|unusual activity/i.test(error) ? { attention: { type: 'flow_verification' as const, message: ATTENTION_TEXT.flow_verification } } : {}),
        };
      }
      case 'paused_for_flow_queue':
        return { log: { event, message: String(v.message ?? 'Flow queue is busy.') }, attention: { type: 'flow_queue', message: ATTENTION_TEXT.flow_queue } };
      case 'waiting_for_generation':
        return { log: { event, message: `Waiting for Flow to finish ${describe(this.label)}.` }, activity: `Waiting for Flow to finish ${describe(this.label)}` };
      case 'generation_approved':
        return { log: { event, message: String(v.message ?? 'Approved the requested generation.') } };
      case 'downloaded':
        return { log: { event, message: `Downloaded ${String(v.file ?? '').split(/[\\/]/).pop()}.` }, recount: true };
      case 'video_ready':
        return { log: { event, message: 'Final video is ready for review.', data: { video_path: v.video_path } }, status: 'awaiting_approval', activity: 'Waiting for your approval', attention: null };
      case undefined: break;
      default:
        return { log: { event, message: String(v.message ?? '') } };
    }
    if (Array.isArray(v.scenes) && typeof v.file === 'string' && v.file.endsWith('narration-manifest.json')) {
      this.narrationTotal = v.scenes.length; this.narrationDone = 0;
      return { log: { event: 'narration_manifest', message: `${v.scenes.length} narrator scenes need AI Studio audio.` }, status: 'narrating', activity: 'Preparing narration', stages: { narration: { done: 0, total: v.scenes.length } } };
    }
    if (v.sound && typeof v.output === 'string') {
      return { log: { event: 'music_ready', message: `Background music: "${v.sound.name}" (${v.sound.license}).` }, status: 'mixing', activity: 'Mixing dialogue, narration and music' };
    }
    if (typeof v.edit_report === 'string' && 'durationSeconds' in v) {
      return { log: { event: 'mix_ready', message: `Mixed ${v.clips} clips (${Number(v.durationSeconds).toFixed(1)}s). Rendering intro, title and logo.` }, status: 'rendering', activity: 'Rendering intro, title and logo' };
    }
    if ('titleEndSeconds' in v) return { log: { event: 'render_ready', message: 'Intro, title and logo rendered.' }, activity: 'Final checks' };
    if (v.format || v.streams) return {};
    return { log: { event: 'output', message: '', data: v } };
  }

  private text(text: string): Update {
    if (NOISE.test(text)) return {};
    if (text.startsWith('Hey, when I open Google AI Studio')) {
      return { log: { event: 'ai_studio_run_needed', message: text }, attention: { type: 'ai_studio_run', message: ATTENTION_TEXT.ai_studio_run } };
    }
    if (text.startsWith('Waiting for AI Studio speech generation')) {
      return { log: { event: 'ai_studio_opening', message: 'Opening Google AI Studio for narration.' }, activity: 'Generating narration in Google AI Studio', attention: { type: 'ai_studio_sign_in', message: ATTENTION_TEXT.ai_studio_sign_in, delayed: true } };
    }
    if (text.startsWith('All narration already downloaded')) {
      this.narrationDone = this.narrationTotal;
      return { log: { event: 'narration_ready', message: text }, status: 'mixing', activity: 'Mixing dialogue, narration and music', stages: { narration: { done: this.narrationTotal } } };
    }
    const narration = /^Narration (\d+): (downloaded|using existing audio)/.exec(text);
    if (narration) {
      this.narrationDone += 1;
      const finished = this.narrationTotal > 0 && this.narrationDone >= this.narrationTotal;
      return {
        log: { event: 'narration', message: text }, attention: null, stages: { narration: { done: this.narrationDone } },
        ...(finished ? { status: 'mixing' as const, activity: 'Mixing dialogue, narration and music' } : { activity: `Narration ${this.narrationDone + 1} of ${this.narrationTotal}` }),
      };
    }
    return { log: { event: 'log', message: text } };
  }
}

const GENERIC = /exited with code \d+; later stages were not run|^\d+ exited with code/;

/** The most specific error message in a failed child's stderr. */
export function errorFrom(stderr: string[], fallback: string): string {
  const errors = stderr
    .map(line => /^(?:[\w.]*(?:Error|Exception))(?: \[[\w-]+\])?: (.+)$/.exec(line.trim())?.[1])
    .filter((m): m is string => Boolean(m));
  return errors.filter(m => !GENERIC.test(m)).pop() ?? errors.pop() ?? fallback;
}
