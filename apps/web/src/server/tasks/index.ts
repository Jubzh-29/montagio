import type { JobTask, TaskDef } from '../jobs';
import { t2iTask } from './t2i';

/** The tasks the job engine runs; each lot adds its own. */
export const TASKS: Partial<Record<JobTask, TaskDef>> = {
  t2i: t2iTask,
};
