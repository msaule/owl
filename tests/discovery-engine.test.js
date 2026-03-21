import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { WorldModel } from '../src/core/world-model.js';
import { DiscoveryEngine } from '../src/discovery/engine.js';
import { filterDiscoveries } from '../src/discovery/filter.js';
import { classifyFeedback, recordFeedbackFromReply } from '../src/learning/feedback.js';
import { getPreferenceSummary } from '../src/learning/preferences.js';
import { getTypeBoost, getSourceBoost, getPreferenceScore, buildPreferenceHints } from '../src/learning/improvement.js';
import { buildDiscoveryPrompt } from '../src/discovery/prompt.js';

function createTempDb(name) {
  return path.join(process.cwd(), 'tests', `${name}-${Date.now()}-${Math.random()}.db`);
}

function makeFakeLlm(responseJson) {
  return {
    async chat() {
      return JSON.stringify(responseJson);
    }
  };
}

function makeFakeChannels() {
  const delivered = [];
  return {
    delivered,
    async deliver(discoveries) {
      delivered.push(...discoveries);
    }
  };
}

// --- Feedback classification ---

test('classifyFeedback detects positive, negative, neutral, and action', () => {
  assert.deepEqual(classifyFeedback('thanks, very useful!'), { reaction: 'positive', actedOn: false });
  assert.deepEqual(classifyFeedback('I knew this already'), { reaction: 'negative', actedOn: false });
  assert.deepEqual(classifyFeedback('random reply'), { reaction: 'neutral', actedOn: false });
  assert.deepEqual(classifyFeedback('done, ordered it'), { reaction: 'positive', actedOn: true });
  assert.deepEqual(classifyFeedback('I sent the email'), { reaction: 'positive', actedOn: true });
});

// --- Preference recording ---

test('recordFeedbackFromReply accumulates preference scores', () => {
  const dbPath = createTempDb('feedback-prefs');
  const wm = new WorldModel(dbPath);

  const disc = wm.addDiscovery({
    type: 'risk',
    urgency: 'important',
    title: 'Cash flow risk',
    body: 'Low cash balance.',
    sources: ['gmail', 'shopify'],
    entities: []
  });

  recordFeedbackFromReply(wm, disc.id, 'thanks, very useful');
  recordFeedbackFromReply(wm, disc.id, 'great insight');

  const typeScore = wm.getUserPreference('preference:type:risk');
  assert.ok(typeScore >= 2, `Expected positive type score, got ${typeScore}`);

  const gmailScore = wm.getUserPreference('preference:source:gmail');
  assert.ok(gmailScore >= 2, `Expected positive source score, got ${gmailScore}`);

  wm.close();
  fs.unlinkSync(dbPath);
});

test('negative feedback decrements preference scores', () => {
  const dbPath = createTempDb('feedback-neg');
  const wm = new WorldModel(dbPath);

  const disc = wm.addDiscovery({
    type: 'anomaly',
    urgency: 'interesting',
    title: 'Boring anomaly',
    body: 'Nothing special.',
    sources: ['calendar'],
    entities: []
  });

  recordFeedbackFromReply(wm, disc.id, 'obvious, I knew that');

  const typeScore = wm.getUserPreference('preference:type:anomaly');
  assert.ok(typeScore < 0, `Expected negative type score, got ${typeScore}`);

  wm.close();
  fs.unlinkSync(dbPath);
});

// --- Improvement scoring ---

test('getTypeBoost returns neutral for no data and boosts for positive', () => {
  const dbPath = createTempDb('boost');
  const wm = new WorldModel(dbPath);

  assert.equal(getTypeBoost(wm, 'risk'), 1.0);

  wm.setUserPreference('preference:type:risk', 3);
  const boost = getTypeBoost(wm, 'risk');
  assert.ok(boost > 1.0 && boost <= 1.5, `Expected boost > 1.0, got ${boost}`);

  wm.setUserPreference('preference:type:anomaly', -3);
  const penalty = getTypeBoost(wm, 'anomaly');
  assert.ok(penalty < 1.0 && penalty >= 0.5, `Expected penalty < 1.0, got ${penalty}`);

  wm.close();
  fs.unlinkSync(dbPath);
});

test('getSourceBoost averages source scores', () => {
  const dbPath = createTempDb('source-boost');
  const wm = new WorldModel(dbPath);

  wm.setUserPreference('preference:source:gmail', 4);
  wm.setUserPreference('preference:source:shopify', -2);

  const boost = getSourceBoost(wm, ['gmail', 'shopify']);
  assert.ok(boost > 0.9 && boost < 1.3, `Expected moderate boost, got ${boost}`);

  wm.close();
  fs.unlinkSync(dbPath);
});

test('buildPreferenceHints returns empty string with no data', () => {
  const dbPath = createTempDb('hints-empty');
  const wm = new WorldModel(dbPath);

  assert.equal(buildPreferenceHints(wm), '');

  wm.close();
  fs.unlinkSync(dbPath);
});

test('buildPreferenceHints includes liked and disliked types', () => {
  const dbPath = createTempDb('hints-full');
  const wm = new WorldModel(dbPath);

  wm.setUserPreference('preference:type:connection', 5);
  wm.setUserPreference('preference:type:anomaly', -3);

  const hints = buildPreferenceHints(wm);
  assert.ok(hints.includes('connection'), `Expected 'connection' in hints: ${hints}`);
  assert.ok(hints.includes('anomaly'), `Expected 'anomaly' in hints: ${hints}`);
  assert.ok(hints.includes('values'), 'Expected "values" keyword');
  assert.ok(hints.includes('less useful'), 'Expected "less useful" keyword');

  wm.close();
  fs.unlinkSync(dbPath);
});

// --- Preference-aware filtering ---

test('filterDiscoveries promotes user-preferred types in sort order', () => {
  const dbPath = createTempDb('pref-filter');
  const wm = new WorldModel(dbPath);

  // User strongly prefers 'opportunity' over 'anomaly'
  wm.setUserPreference('preference:type:opportunity', 5);
  wm.setUserPreference('preference:type:anomaly', -3);

  const filtered = filterDiscoveries(
    [
      {
        type: 'anomaly',
        urgency: 'important',
        title: 'Anomaly A',
        body: 'Some anomaly found.',
        sources: ['mock'],
        entities: [],
        confidence: 0.85
      },
      {
        type: 'opportunity',
        urgency: 'important',
        title: 'Opportunity B',
        body: 'A great opportunity.',
        sources: ['mock'],
        entities: [],
        confidence: 0.80
      }
    ],
    wm,
    { minConfidence: 0.6, importanceThreshold: 'medium', maxDiscoveriesPerRun: 2, maxDiscoveriesPerDay: 5 }
  );

  // Even though anomaly has higher raw confidence, opportunity should rank first
  // because user preferences boost it
  assert.ok(filtered.length >= 1);
  assert.equal(filtered[0].title, 'Opportunity B');

  wm.close();
  fs.unlinkSync(dbPath);
});

// --- Discovery prompt includes preferences ---

test('buildDiscoveryPrompt includes preference hints when provided', () => {
  const { systemPrompt } = buildDiscoveryPrompt(
    '## Recent Events\n- something happened',
    'quick',
    { name: 'Alice' },
    { preferenceHints: 'The user especially values: connection discoveries.' }
  );

  assert.ok(systemPrompt.includes('Alice'), 'Should include user name');
  assert.ok(systemPrompt.includes('connection discoveries'), 'Should include preference hints');
  assert.ok(systemPrompt.includes('Learned user preferences'), 'Should label the section');
});

test('buildDiscoveryPrompt omits preference line when hints are empty', () => {
  const { systemPrompt } = buildDiscoveryPrompt(
    '## Recent Events\n- something happened',
    'deep',
    { name: 'Bob' },
    { preferenceHints: '' }
  );

  assert.ok(!systemPrompt.includes('Learned user preferences'), 'Should not include label when empty');
});

// --- Discovery engine end-to-end (with fake LLM) ---

test('DiscoveryEngine runs a quick scan and delivers results', async () => {
  const dbPath = createTempDb('engine-e2e');
  const wm = new WorldModel(dbPath);

  // Seed some events
  wm.addEvent({
    source: 'gmail',
    type: 'email.received',
    summary: 'Email from John: Q3 pricing review',
    data: { from: 'john@acme.com', subject: 'Q3 pricing review' },
    importance: 0.7,
    entities: ['person_john']
  });

  const fakeDiscoveries = [
    {
      type: 'connection',
      urgency: 'important',
      title: 'Pricing risk with Acme',
      body: 'John from Acme is asking about pricing while their contract renews next month. Suggested action: prepare renewal offer.',
      sources: ['gmail', 'calendar'],
      entities: ['person_john'],
      confidence: 0.88
    }
  ];

  const llm = makeFakeLlm(fakeDiscoveries);
  const channels = makeFakeChannels();
  const engine = new DiscoveryEngine(wm, llm, channels, {
    minConfidence: 0.6,
    importanceThreshold: 'medium',
    maxDiscoveriesPerRun: 3,
    maxDiscoveriesPerDay: 5
  }, { user: { name: 'TestUser' } });

  const results = await engine.runQuick();

  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Pricing risk with Acme');
  assert.equal(channels.delivered.length, 1);

  // Discovery should be stored in the world model
  const stored = wm.getRecentDiscoveries(new Date(Date.now() - 60000).toISOString(), 10);
  assert.ok(stored.some((d) => d.title === 'Pricing risk with Acme'));

  // Events should be marked processed
  const unprocessed = wm.getUnprocessedEvents();
  assert.equal(unprocessed.length, 0);

  wm.close();
  fs.unlinkSync(dbPath);
});

test('DiscoveryEngine returns empty array when LLM finds nothing', async () => {
  const dbPath = createTempDb('engine-empty');
  const wm = new WorldModel(dbPath);

  const llm = makeFakeLlm([]);
  const channels = makeFakeChannels();
  const engine = new DiscoveryEngine(wm, llm, channels, {}, { user: { name: 'TestUser' } });

  const results = await engine.runDeep();
  assert.equal(results.length, 0);
  assert.equal(channels.delivered.length, 0);

  wm.close();
  fs.unlinkSync(dbPath);
});

test('DiscoveryEngine handles LLM error gracefully', async () => {
  const dbPath = createTempDb('engine-error');
  const wm = new WorldModel(dbPath);

  const llm = {
    async chat() {
      throw new Error('API rate limit exceeded');
    }
  };
  const channels = makeFakeChannels();
  const engine = new DiscoveryEngine(wm, llm, channels, {}, { user: { name: 'TestUser' } });

  const results = await engine.runQuick();
  assert.equal(results.length, 0);
  assert.equal(channels.delivered.length, 0);

  wm.close();
  fs.unlinkSync(dbPath);
});

// --- Full learning loop integration ---

test('full learning loop: feedback → preference → filter re-ranking', () => {
  const dbPath = createTempDb('learning-loop');
  const wm = new WorldModel(dbPath);

  // Simulate several rounds of positive feedback on 'connection' discoveries
  for (let i = 0; i < 4; i++) {
    const d = wm.addDiscovery({
      type: 'connection',
      urgency: 'important',
      title: `Connection discovery ${i}`,
      body: `Body for connection ${i}.`,
      sources: ['gmail'],
      entities: []
    });
    recordFeedbackFromReply(wm, d.id, 'thanks, great');
  }

  // Simulate negative feedback on 'anomaly' discoveries
  for (let i = 0; i < 3; i++) {
    const d = wm.addDiscovery({
      type: 'anomaly',
      urgency: 'interesting',
      title: `Anomaly ${i}`,
      body: `Body for anomaly ${i}.`,
      sources: ['files'],
      entities: []
    });
    recordFeedbackFromReply(wm, d.id, 'obvious, I knew that');
  }

  // Verify preference summary reflects the learning
  const summary = getPreferenceSummary(wm);
  assert.ok(summary.includes('connection'), 'Summary should mention connection as valued');

  // Verify preference hints work
  const hints = buildPreferenceHints(wm);
  assert.ok(hints.includes('connection'), 'Hints should include connection');
  assert.ok(hints.includes('anomaly'), 'Hints should include anomaly as less useful');

  // Verify filter ranking: a new connection should rank above a new anomaly
  // even when the anomaly has slightly higher raw confidence
  const filtered = filterDiscoveries(
    [
      {
        type: 'anomaly',
        urgency: 'important',
        title: 'New anomaly detected',
        body: 'Some anomaly was detected in the data.',
        sources: ['files'],
        entities: [],
        confidence: 0.90
      },
      {
        type: 'connection',
        urgency: 'important',
        title: 'New connection found',
        body: 'Two data sources connect in an interesting way.',
        sources: ['gmail'],
        entities: [],
        confidence: 0.82
      }
    ],
    wm,
    { minConfidence: 0.6, importanceThreshold: 'medium', maxDiscoveriesPerRun: 2, maxDiscoveriesPerDay: 10 }
  );

  assert.ok(filtered.length >= 1);
  assert.equal(filtered[0].title, 'New connection found', 'Connection should rank first after positive feedback');

  wm.close();
  fs.unlinkSync(dbPath);
});
