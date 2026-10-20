import { jobCreationRoute } from '@/server/job-route';

/** A one-photo hook (extensions "edit" and "transitions"): the edit makes the end frame, the transition animates it. */
export const POST = jobCreationRoute('hook');
