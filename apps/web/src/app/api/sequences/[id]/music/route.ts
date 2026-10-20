import { jobCreationRoute } from '@/server/job-route';

/** Music under a finished film (extension "music"): `{ prompt, bpm? }`, the film named by the URL. */
export const POST = jobCreationRoute('music', ({ id }) => ({ sequenceId: id }));
