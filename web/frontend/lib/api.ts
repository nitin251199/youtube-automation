export const API = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');

export type JobStatus =
  | 'queued' | 'scripting' | 'planned' | 'generating' | 'narrating' | 'mixing' | 'rendering'
  | 'awaiting_approval' | 'approved' | 'uploading' | 'uploaded' | 'rejected' | 'failed' | 'cancelled';

export type Counter = { done: number; total: number };

export interface Job {
  id: string;
  title: string;
  script?: string;
  scriptPreview: string;
  concept: string;
  status: JobStatus;
  stages: { script: Counter; characters: Counter; backgrounds: Counter; scenes: Counter; narration: Counter };
  activity: string;
  needsAttention: { type: string; message: string; since: string } | null;
  assets: { mode: 'channel' | 'video'; logoPath: string | null; introPath: string | null };
  pauseAfterScript: boolean;
  planApproved: boolean;
  projectId: string;
  projectFile: string;
  outputDir: string;
  videoPath: string | null;
  review: { status: string | null; youtubeUrl: string | null; zernioPostId: string | null };
  error: string | null;
  failedPhase: 'scripting' | 'production' | 'upload' | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  queuePosition?: number | null;
  plan?: Plan | null;
}

export interface Plan {
  characters: { tag: string; name: string; status: string }[];
  backgrounds: { tag: string; name: string; status: string }[];
  scenes: { number: number; title: string; speaker: string; line: string; status: string }[];
}

export interface JobEvent { _id: string; at: string; source: 'pipeline' | 'stderr' | 'system'; event: string; message: string }

export interface SystemStatus {
  ready: boolean;
  visibility: string;
  uploadsEnabled: boolean;
  checks: { id: string; label: string; ok: boolean; required: boolean; detail: string }[];
  queue: { activeJobId: string | null; queued: number };
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(`${API}/api${path}`, { cache: 'no-store', ...init }); }
  catch { throw new Error(`Cannot reach the backend at ${API}. Is it running?`); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body as T;
}

export const RUNNING: JobStatus[] = ['scripting', 'generating', 'narrating', 'mixing', 'rendering'];

export const STATUS_LABEL: Record<JobStatus, string> = {
  queued: 'Queued', scripting: 'Writing scene plan', planned: 'Plan ready', generating: 'Generating in Flow',
  narrating: 'Narrating', mixing: 'Mixing audio', rendering: 'Rendering', awaiting_approval: 'Needs your review',
  approved: 'Approved', uploading: 'Uploading', uploaded: 'Uploaded', rejected: 'Rejected', failed: 'Failed', cancelled: 'Cancelled',
};

export function statusTone(job: Pick<Job, 'status' | 'needsAttention' | 'error'>): 'idle' | 'busy' | 'warn' | 'good' | 'bad' {
  if (job.needsAttention) return 'warn';
  if (job.status === 'awaiting_approval' || job.status === 'planned') return 'warn';
  if (job.status === 'uploaded' || job.status === 'approved') return 'good';
  if (job.status === 'failed') return 'bad';
  if (RUNNING.includes(job.status) || job.status === 'uploading') return 'busy';
  return 'idle';
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}
