import mongoose, { Schema, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const JOB_STATUSES = [
  'queued', 'scripting', 'planned', 'generating', 'narrating', 'mixing', 'rendering',
  'awaiting_approval', 'approved', 'uploading', 'uploaded', 'rejected', 'failed', 'cancelled',
] as const;
export type JobStatus = typeof JOB_STATUSES[number];
export const RUNNING: JobStatus[] = ['scripting', 'generating', 'narrating', 'mixing', 'rendering'];

const counter = { done: { type: Number, default: 0 }, total: { type: Number, default: 0 } };

const jobSchema = new Schema({
  // Multi-user groundwork: owner and Flow account are recorded but not enforced yet.
  ownerId: { type: String, default: null, index: true },
  flowProfile: { type: String, default: 'default' },
  projectId: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  script: { type: String, required: true },
  concept: { type: String, default: '' },
  assets: {
    mode: { type: String, enum: ['channel', 'video'], default: 'channel' },
    logoPath: { type: String, default: null },
    introPath: { type: String, default: null },
  },
  pauseAfterScript: { type: Boolean, default: false },
  planApproved: { type: Boolean, default: false },
  status: { type: String, enum: JOB_STATUSES, default: 'queued', index: true },
  stages: {
    script: { done: { type: Number, default: 0 }, total: { type: Number, default: 3 } },
    characters: counter,
    backgrounds: counter,
    scenes: { done: { type: Number, default: 0 }, total: { type: Number, default: 12 } },
    narration: counter,
  },
  activity: { type: String, default: '' },
  needsAttention: {
    type: new Schema({ type: String, message: String, since: Date }, { _id: false }),
    default: null,
  },
  projectFile: { type: String, required: true },
  outputDir: { type: String, required: true },
  videoPath: { type: String, default: null },
  review: {
    status: { type: String, default: null },
    youtubeUrl: { type: String, default: null },
    zernioPostId: { type: String, default: null },
  },
  error: { type: String, default: null },
  failedPhase: { type: String, enum: ['scripting', 'production', 'upload', null], default: null },
  runs: { type: Number, default: 0 },
  startedAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null },
}, { timestamps: true });

jobSchema.index({ status: 1, createdAt: 1 });

export type Job = InferSchemaType<typeof jobSchema>;
export type JobDoc = HydratedDocument<Job>;
export const JobModel = mongoose.model('Job', jobSchema, 'jobs');

const eventSchema = new Schema({
  jobId: { type: Schema.Types.ObjectId, required: true, index: true },
  at: { type: Date, default: () => new Date() },
  source: { type: String, enum: ['pipeline', 'stderr', 'system'], default: 'pipeline' },
  event: { type: String, required: true },
  message: { type: String, default: '' },
  data: { type: Schema.Types.Mixed, default: null },
}, { versionKey: false });

export type JobEvent = InferSchemaType<typeof eventSchema>;
export const JobEventModel = mongoose.model('JobEvent', eventSchema, 'job_events');

