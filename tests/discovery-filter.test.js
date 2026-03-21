import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { WorldModel } from '../src/core/world-model.js';
import { filterDiscoveries } from '../src/discovery/filter.js';

function createTempDb(name) {
  return path.join(process.cwd(), 'tests', `${name}-${Date.now()}-${Math.random()}.db`);
}

test('discovery filter drops duplicates and low-confidence items', () => {
  const dbPath = createTempDb('discovery-filter');
  const worldModel = new WorldModel(dbPath);

  worldModel.addDiscovery({
    id: 'disc_existing',
    timestamp: new Date().toISOString(),
    type: 'risk',
    urgency: 'important',
    title: 'Supplier delay risk',
    body: 'Supplier delay is building. Suggested action: call them today.',
    sources: ['gmail'],
    entities: ['company_acme']
  });

  const filtered = filterDiscoveries(
    [
      {
        type: 'risk',
        urgency: 'important',
        title: 'Supplier delay risk',
        body: 'Supplier delay is building. Suggested action: call them today.',
        sources: ['gmail'],
        entities: ['company_acme'],
        confidence: 0.9
      },
      {
        type: 'opportunity',
        urgency: 'important',
        title: 'Backup supplier available',
        body: 'A backup supplier appears available now. Suggested action: ask for inventory today.',
        sources: ['gmail', 'shopify'],
        entities: ['company_backup'],
        confidence: 0.85
      },
      {
        type: 'connection',
        urgency: 'interesting',
        title: 'Weak signal',
        body: 'Probably something, maybe not. Suggested action: think about it.',
        sources: ['mock'],
        entities: [],
        confidence: 0.2
      }
    ],
    worldModel,
    {
      minConfidence: 0.6,
      importanceThreshold: 'medium',
      maxDiscoveriesPerRun: 3,
      maxDiscoveriesPerDay: 5
    }
  );

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].title, 'Backup supplier available');

  worldModel.close();
  fs.unlinkSync(dbPath);
});
