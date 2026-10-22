/** Between a number and its unit: the two never part at the end of a line. */
const NBSP = ' ';

/**
 * A render time as a person reads it: seconds under a minute, then whole minutes, then hours
 * and minutes ("45 s", "9 min", "1 h 12"). The same units in English and French.
 */
export function formatDuration(seconds: number): string {
  const whole = Math.max(1, Math.round(seconds));
  if (whole < 60) return `${whole}${NBSP}s`;
  const minutes = Math.round(whole / 60);
  if (minutes < 60) return `${minutes}${NBSP}min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}${NBSP}h` : `${hours}${NBSP}h${NBSP}${String(rest).padStart(2, '0')}`;
}

/** The time a take has been rolling, as a camera counts it: m:ss, then h:mm:ss. */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const s = String(whole % 60).padStart(2, '0');
  const minutes = Math.floor(whole / 60);
  if (minutes < 60) return `${minutes}:${s}`;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${s}`;
}
