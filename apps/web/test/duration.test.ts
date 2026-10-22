import { formatClock, formatDuration } from '@/lib/duration';

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
