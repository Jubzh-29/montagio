import type { JobTask, TaskDef } from '../jobs';

/** The tasks the job engine runs; each lot adds its own (text-to-image, edit, effects…). */
export const TASKS: Partial<Record<JobTask, TaskDef>> = {};
