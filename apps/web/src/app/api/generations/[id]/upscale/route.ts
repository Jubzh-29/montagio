import { jobCreationRoute } from '@/server/job-route';

/** HD 1080p of a finished camera clip (extension "upscale"); the clip is named by the URL. */
export const POST = jobCreationRoute('upscale', ({ id }) => ({ parent: { source: 'generation', id } }));
