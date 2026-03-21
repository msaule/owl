import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { WorldModel } from '../src/core/world-model.js';
import { runFeedbackExpiry } from '../src/learning/feedback.js';
import { formatDiscoveryMessage } from '../src/channels/manager.js';
import { WebhookChannel } from '../src/channels/webhook.js';

function createTempDb(name) {
  return path.join(process.cwd(), 'tests', `${name}-${Date.now()}-${Math.random()}.db`);
}

// --- Feedback auto-expiry ---

test('expireStaleDiscoveries marks old unreacted discoveries as neutral', () => {
  const dbPath = createTempDb('expiry');
  const wm = new WorldModel(dbPath);

  // Add a discovery from 3 days ago with no reaction
  wm.addDiscovery({
    type: 'risk',
    urgency: 'important',
    title: 'Old unreacted discovery',
    body: 'Some risk.',
    sources: ['gmail'],
    entities: [],
    timestamp: new Date(Date.now() - 72 * 3_600_000).toISOString()
  });

  // Add a recent discovery with no reaction (should NOT be expired)
  const recent = wm.addDiscovery({
    type: 'connection',
    urgency: 'interesting',
    title: 'Fresh discovery',
    body: 'Something new.',
    sources: ['calendar'],
    entities: [],
    timestamp: new Date().toISOString()
  });

  // Add a discovery from 3 days ago that already has a reaction (should NOT change)
  const reacted = wm.addDiscovery({
    type: 'anomaly',
    urgency: 'important',
    title: 'Already reacted',
    body: 'User liked this.',
    sources: ['shopify'],
    entities: [],
    timestamp: new Date(Date.now() - 72 * 3_600_000).toISOString()
  });
  wm.updateDiscoveryReaction(reacted.id, 'positive', false);

  const count = wm.expireStaleDiscoveries(48);
  assert.equal(count, 1, 'Should expire exactly 1 discovery');

  // The recent one should still have null reaction
  const freshDisc = wm.getDiscovery(recent.id);
  assert.equal(freshDisc.user_reaction, null);

  // The reacted one should still be positive
  const reactedDisc = wm.getDiscovery(reacted.id);
  assert.equal(reactedDisc.user_reaction, 'positive');

  wm.close();
  fs.unlinkSync(dbPath);
});

test('expireStaleSituations marks old active situations as expired', () => {
  const dbPath = createTempDb('sit-expiry');
  const wm = new WorldModel(dbPath);

  // Add an old situation
  wm.addSituation({
    description: 'Old situation',
    urgency: 0.6,
    entities: [],
    related_events: [],
    created_at: new Date(Date.now() - 14 * 86_400_000).toISOString(),
    updated_at: new Date(Date.now() - 14 * 86_400_000).toISOString()
  });

  // Add a fresh situation
  wm.addSituation({
    description: 'Fresh situation',
    urgency: 0.8,
    entities: [],
    related_events: []
  });

  const count = wm.expireStaleSituations(7);
  assert.equal(count, 1, 'Should expire exactly 1 situation');

  const active = wm.getActiveSituations();
  assert.equal(active.length, 1);
  assert.equal(active[0].description, 'Fresh situation');

  wm.close();
  fs.unlinkSync(dbPath);
});

test('runFeedbackExpiry runs both discovery and situation expiry', () => {
  const dbPath = createTempDb('full-expiry');
  const wm = new WorldModel(dbPath);

  wm.addDiscovery({
    type: 'risk',
    urgency: 'urgent',
    title: 'Stale discovery',
    body: 'No reaction.',
    sources: ['gmail'],
    entities: [],
    timestamp: new Date(Date.now() - 72 * 3_600_000).toISOString()
  });

  wm.addSituation({
    description: 'Stale situation',
    urgency: 0.6,
    entities: [],
    related_events: [],
    created_at: new Date(Date.now() - 14 * 86_400_000).toISOString(),
    updated_at: new Date(Date.now() - 14 * 86_400_000).toISOString()
  });

  const result = runFeedbackExpiry(wm);
  assert.equal(result.expiredDiscoveries, 1);
  assert.equal(result.expiredSituations, 1);

  wm.close();
  fs.unlinkSync(dbPath);
});

// --- Discovery message formatting ---

test('formatDiscoveryMessage includes owl emoji and urgency indicator', () => {
  const message = formatDiscoveryMessage({
    type: 'risk',
    urgency: 'urgent',
    title: 'Cash flow warning',
    body: 'Low balance detected. Suggested action: review accounts today.',
    sources: ['gmail', 'shopify'],
    entities: []
  });

  assert.ok(message.includes('\u{1F989}'), 'Should include owl emoji');
  assert.ok(message.includes('\u{1F534}'), 'Should include red circle for urgent');
  assert.ok(message.includes('Cash flow warning'), 'Should include title');
  assert.ok(message.includes('\u{2192}'), 'Should include arrow for suggested action');
  assert.ok(message.includes('review accounts today'), 'Should extract suggested action');
  assert.ok(message.includes('[Sources: gmail, shopify]'), 'Should include sources');
});

test('formatDiscoveryMessage works without explicit suggested action', () => {
  const message = formatDiscoveryMessage({
    type: 'connection',
    urgency: 'interesting',
    title: 'Cross-source connection',
    body: 'Two data sources connect in an interesting way.',
    sources: ['calendar'],
    entities: []
  });

  assert.ok(message.includes('\u{1F989}'), 'Should include owl emoji');
  assert.ok(message.includes('\u{1F7E2}'), 'Should include green circle');
  assert.ok(!message.includes('\u{2192}'), 'Should not include arrow when no action');
});

// --- Webhook channel ---

test('WebhookChannel posts structured JSON to configured URL', async () => {
  let capturedUrl = null;
  let capturedBody = null;
  const originalFetch = global.fetch;

  global.fetch = async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    return { ok: true };
  };

  try {
    const channel = new WebhookChannel({
      url: 'https://example.com/hook',
      secret: 'test-secret'
    });

    await channel.send([
      {
        type: 'opportunity',
        urgency: 'important',
        title: 'New deal',
        body: 'A prospect matched.',
        sources: ['crm'],
        entities: ['company_acme'],
        confidence: 0.9
      }
    ]);

    assert.equal(capturedUrl, 'https://example.com/hook');
    assert.equal(capturedBody.event, 'discoveries');
    assert.equal(capturedBody.discoveries.length, 1);
    assert.equal(capturedBody.discoveries[0].title, 'New deal');
    assert.ok(capturedBody.timestamp, 'Should include timestamp');
  } finally {
    global.fetch = originalFetch;
  }
});

test('WebhookChannel skips when url is missing', async () => {
  const channel = new WebhookChannel({});
  // Should not throw
  await channel.send([{ title: 'test', body: 'test', sources: [], entities: [] }]);
});
