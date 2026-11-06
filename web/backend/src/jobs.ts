import fs from 'node:fs/promises';
import { JobModel, JobEventModel, type JobDoc } from './models/Job.js';
import type { Bus } from './bus.js';

export function publicJob(job: JobDoc, withScript = false) {
  const { script, __v, ...rest } = job.toObject();
  return { ...rest, id: String(job._id), scriptPreview: script.slice(0, 280), ...(withScript ? { script } : {}) };
}

/** Atomic field updates (dotted paths allowed) published to live viewers. */
export async function updateJob(bus: Bus, id: string, set: Record<string, unknown>): Promise<JobDoc | null> {
  const job = await JobModel.findByIdAndUpdate(id, { $set: set }, { returnDocument: 'after' });
  if (job) bus.publish(id, { type: 'job', payload: publicJob(job) });
  return job;
}

export async function logEvent(bus: Bus, id: string, entry: { event: string; message?: string; data?: unknown; source?: 'pipeline' | 'stderr' | 'system' }) {
  const doc = await JobEventModel.create({ jobId: id, ...entry, message: (entry.message ?? '').slice(0, 4000) });
  bus.publish(id, { type: 'event', payload: doc.toObject() });
}

export interface PlanSummary {
  characters: { tag: string; name: string; status: string }[];
  backgrounds: { tag: string; name: string; status: string }[];
  scenes: { number: number; title: string; speaker: string; line: string; status: string }[];
}

export async function readProject(projectFile: string): Promise<any | null> {
  try { return JSON.parse(await fs.readFile(projectFile, 'utf8')); }
  catch (error: any) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}

export function planSummary(project: any): PlanSummary | null {
  if (!project?.scenes?.length) return null;
  return {
    characters: (project.characters ?? []).map((c: any) => ({ tag: c.tag, name: c.name ?? '', status: c.status })),
    backgrounds: (project.backgrounds ?? []).map((b: any) => ({ tag: b.tag, name: b.location_name ?? '', status: b.status })),
    scenes: project.scenes.map((s: any) => ({
      number: s.scene_number, title: s.title ?? '', speaker: s.speaker,
      line: String(s.speaker?.startsWith('@CHAR-') ? s.devanagari_dialogue ?? '' : s.narration_text ?? ''), status: s.status,
    })),
  };
}

export function counts(project: any) {
  const tally = (items: any[] = []) => ({ done: items.filter(i => i.status === 'done').length, total: items.length });
  return { characters: tally(project.characters), backgrounds: tally(project.backgrounds), scenes: { ...tally(project.scenes), total: project.scenes?.length || 12 } };
}

/** validate() in the scripting half adds Flow prompts to every scene. */
export function isPlanned(project: any): boolean {
  return project?.scenes?.length === 12 && project.scenes.every((s: any) => 'animation_prompt_NARRATOR_ONLY' in s);
}
