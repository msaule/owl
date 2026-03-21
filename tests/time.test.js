import test from 'node:test';
import assert from 'node:assert/strict';
import { nextCronOccurrence } from '../src/utils/time.js';

test('nextCronOccurrence handles stepped minute schedules', () => {
  const next = nextCronOccurrence('*/30 * * * *', new Date('2026-03-20T10:05:00.000Z'));
  assert.equal(next, '2026-03-20T10:30:00.000Z');
});

test('nextCronOccurrence handles stepped hour schedules', () => {
  const next = nextCronOccurrence('0 */6 * * *', new Date('2026-03-20T10:05:00.000Z'));
  assert.equal(next, '2026-03-20T12:00:00.000Z');
});

test('nextCronOccurrence handles fixed daily schedules', () => {
  const next = nextCronOccurrence('0 7 * * *', new Date('2026-03-20T10:05:00.000Z'));
  assert.equal(next, '2026-03-20T13:00:00.000Z');
});
