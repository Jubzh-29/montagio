import { formatClock, formatDuration, remainingSeconds } from '@/lib/duration';

const nbsp = (text: string) => text.replace(/ /g, ' ');

test('a render time reads in seconds, then minutes, then hours', () => {
  expect(formatDuration(45)).toBe(nbsp('45 s'));
  expect(formatDuration(0.4)).toBe(nbsp('1 s'));
  expect(formatDuration(80)).toBe(nbsp('1 min'));
  expect(formatDuration(95)).toBe(nbsp('2 min'));
  expect(formatDuration(565)).toBe(nbsp('9 min'));
  expect(formatDuration(1135)).toBe(nbsp('19 min'));
  expect(formatDuration(3600)).toBe(nbsp('1 h'));
  expect(formatDuration(4331)).toBe(nbsp('1 h 12'));
});

test('the slate counts like a camera: m:ss, then h:mm:ss', () => {
  expect(formatClock(0)).toBe('0:00');
  expect(formatClock(42.7)).toBe('0:42');
  expect(formatClock(725)).toBe('12:05');
  expect(formatClock(3723)).toBe('1:02:03');
});

test('the time left follows the progress once there is some, the estimate before', () => {
  // Nothing measured yet: the estimate, less the time already gone.
  expect(remainingSeconds(30, 565, 0)).toBe(535);
  expect(remainingSeconds(30, 565, 0.03)).toBe(535);
  // Half done in 4 minutes: about 4 more, whatever the estimate said.
  expect(remainingSeconds(240, 565, 0.5)).toBe(240);
  expect(remainingSeconds(500, 565, 0.96)).toBeCloseTo(20.8, 1);
  expect(remainingSeconds(700, 565, 0)).toBe(0);
});
