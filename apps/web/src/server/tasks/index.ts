import type { JobTask, TaskDef } from '../jobs';
import { avatarTask } from './avatar';
import { editTask } from './edit';
import { effectTask } from './effect';
import { hookTask } from './hook';
import { imageUpscaleTask } from './image-upscale';
import { motionTask } from './motion';
import { musicTask } from './music';
import { t2iTask } from './t2i';
import { upscaleTask } from './upscale';

/** The tasks the job engine runs; each lot adds its own. */
export const TASKS: Partial<Record<JobTask, TaskDef>> = {
  t2i: t2iTask,
  edit: editTask,
  effect: effectTask,
  hook: hookTask,
  avatar: avatarTask,
  music: musicTask,
  upscale: upscaleTask,
  'image-upscale': imageUpscaleTask,
  motion: motionTask,
};
