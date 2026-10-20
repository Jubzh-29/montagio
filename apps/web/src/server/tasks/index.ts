import type { JobTask, TaskDef } from '../jobs';
import { avatarTask } from './avatar';
import { editTask } from './edit';
import { effectTask } from './effect';
import { hookTask } from './hook';
import { musicTask } from './music';
import { t2iTask } from './t2i';

/** The tasks the job engine runs; each lot adds its own. */
export const TASKS: Partial<Record<JobTask, TaskDef>> = {
  t2i: t2iTask,
  edit: editTask,
  effect: effectTask,
  hook: hookTask,
  avatar: avatarTask,
  music: musicTask,
};
