import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isQuietTime, filterForQuietHours } from '../src/channels/quiet-hours.js';
import { computeCalibration, calibrateConfidence, getCalibrationSummary } from '../src/learning/calibration.js';
import { WorldModel } from '../src/core/world-model.js';

function createTempDb(name) {
  return path.join(process.cwd(), 'tests', `${name}-${Date.now()}-${Math.random()}.db`);
}

// =============================================
// Quiet Hours
// =============================================

test('isQuietTime returns false when no config', () => {
  assert.equal(isQuietTime({}), false);
  assert.equal(isQuietTime({ start: '', end: '' }), false);
});

test('isQuietTime detects overnight quiet period', () => {
  const config = { start: '22:00', end: '07:00' };

  // 11pm — should be quiet
  const late = new Date('2026-03-21T23:00:00');
  assert.equal(isQuietTime(config, late), true);

  // 3am — should be quiet
  const early = new Date('2026-03-22T03:00:00');
  assert.equal(isQuietTime(config, early), true);

  // 10am — should NOT be quiet
  const morning = new Date('2026-03-22T10:00:00');
  assert.equal(isQuietTime(config, morning), false);
});

test('isQuietTime detects same-day quiet period', () => {
  const config = { start: '13:00', end: '14:00' };

  const during = new Date('2026-03-21T13:30:00');
  assert.equal(isQuietTime(config, during), true);

  const outside = new Date('2026-03-21T15:00:00');
  assert.equal(isQuietTime(config, outside), false);
});

test('isQuietTime respects weekend flag', () => {
  const config = { start: '22:00', end: '07:00', weekends: true };

  // Saturday at noon — quiet due to weekend flag
  const saturday = new Date('2026-03-21T12:00:00'); // March 21, 2026 is a Saturday
  assert.equal(isQuietTime(config, saturday), true);

  // Monday at noon — not quiet (outside time range and not weekend)
  const monday = new Date('2026-03-23T12:00:00');
  assert.equal(isQuietTime(config, monday), false);
});

test('filterForQuietHours lets urgent through during quiet time', () => {
  const discoveries = [
    { title: 'Urgent', urgency: 'urgent', confidence: 0.9 },
    { title: 'Important', urgency: 'important', confidence: 0.8 },
    { title: 'Interesting', urgency: 'interesting', confidence: 0.7 }
  ];

  const config = { start: '00:00', end: '23:59' }; // Always quiet
  const { send, hold } = filterForQuietHours(discoveries, config);

  assert.equal(send.length, 1);
  assert.equal(send[0].title, 'Urgent');
  assert.equal(hold.length, 2);
});

test('filterForQuietHours sends all when not quiet', () => {
  const discoveries = [
    { title: 'A', urgency: 'important' },
    { title: 'B', urgency: 'interesting' }
  ];

  const { send, hold } = filterForQuietHours(discoveries, {}); // No quiet config
  assert.equal(send.length, 2);
  assert.equal(hold.length, 0);
});

test('filterForQuietHours holds urgent when muteUrgent is true', () => {
  const discoveries = [{ title: 'Urgent', urgency: 'urgent' }];
  const config = { start: '00:00', end: '23:59', muteUrgent: true };
  const { send, hold } = filterForQuietHours(discoveries, config);
  assert.equal(send.length, 0);
  assert.equal(hold.length, 1);
});

// =============================================
// Confidence Calibration
// =============================================

test('computeCalibration returns 1.0 for empty world model', () => {
  const dbPath = createTempDb('cal-empty');
  const wm = new WorldModel(dbPath);
  try {
    const cal = computeCalibration(wm);
    assert.equal(cal.high, 1.0);
    assert.equal(cal.medium, 1.0);
    assert.equal(cal.low, 1.0);
  } finally {
    wm.close();
    fs.unlinkSync(dbPath);
  }
});

test('computeCalibration adjusts for positive feedback', () => {
  const dbPath = createTempDb('cal-positive');
  const wm = new WorldModel(dbPath);
  try {
    // Add discoveries with high confidence and positive reactions
    for (let i = 0; i < 5; i++) {
      wm.addDiscovery({
        type: 'connection',
        urgency: 'important',
        title: `Good discovery ${i}`,
        body: 'Body',
        sources: ['gmail'],
        entities: [],
        confidence: 0.85,
        user_reaction: 'positive',
        timestamp: new Date().toISOString()
      });
    }

    const cal = computeCalibration(wm);
    assert.ok(cal.high >= 1.0); // Should be boosted
  } finally {
    wm.close();
    fs.unlinkSync(dbPath);
  }
});

test('computeCalibration adjusts for negative feedback', () => {
  const dbPath = createTempDb('cal-negative');
  const wm = new WorldModel(dbPath);
  try {
    // Add discoveries with high confidence but negative reactions
    for (let i = 0; i < 5; i++) {
      wm.addDiscovery({
        type: 'connection',
        urgency: 'important',
        title: `Bad discovery ${i}`,
        body: 'Body',
        sources: ['gmail'],
        entities: [],
        confidence: 0.85,
        user_reaction: 'negative',
        timestamp: new Date().toISOString()
      });
    }

    const cal = computeCalibration(wm);
    assert.ok(cal.high < 1.0); // Should be reduced
  } finally {
    wm.close();
    fs.unlinkSync(dbPath);
  }
});

test('calibrateConfidence applies band multipliers', () => {
  const calibration = { high: 0.8, medium: 1.2, low: 1.0 };

  // High confidence gets reduced
  const calibrated = calibrateConfidence(0.9, calibration);
  assert.ok(calibrated < 0.9);
  assert.ok(calibrated > 0.5);

  // Medium confidence gets boosted
  const medium = calibrateConfidence(0.7, calibration);
  assert.ok(medium > 0.7);

  // Confidence never exceeds 1.0
  const capped = calibrateConfidence(0.95, { high: 1.3 });
  assert.ok(capped <= 1.0);
});

test('getCalibrationSummary formats readable output', () => {
  const summary = getCalibrationSummary({ high: 1.1, medium: 0.9, low: 1.0 });
  assert.ok(summary.includes('high: 1.10x'));
  assert.ok(summary.includes('medium: 0.90x'));
});
