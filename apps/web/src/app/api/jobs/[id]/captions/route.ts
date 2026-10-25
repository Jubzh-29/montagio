import { jobCreationRoute } from '@/server/job-route';

/** Captions of a finished talking clip (avatar, voice change, translation): Whisper hears it; the clip is named by the URL. */
export const POST = jobCreationRoute('captions', ({ id }) => ({ parent: { source: 'job', id } }));
