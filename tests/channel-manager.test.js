import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ChannelManager } from '../src/channels/manager.js';
import { EmailDigestChannel } from '../src/channels/email-digest.js';
import { readNdjson } from '../src/utils/fs.js';

function createTempPath(name) {
  return path.join(process.cwd(), 'tests', `${name}-${Date.now()}-${Math.random()}.ndjson`);
}

test('channel manager queues failed deliveries and flushes them later', async () => {
  const queuePath = createTempPath('delivery-queue');
  let attempts = 0;
  const manager = new ChannelManager({}, { deliveryQueuePath: queuePath });

  manager.channels = [
    {
      name: 'cli',
      async send() {
        attempts += 1;
        if (attempts <= 2) {
          throw new Error('temporary failure');
        }
      }
    }
  ];

  await manager.deliver([
    {
      id: 'disc_retry',
      urgency: 'important',
      title: 'Retry me',
      body: 'This should be retried.',
      sources: ['mock']
    }
  ]);

  assert.equal(readNdjson(queuePath).length, 1);

  await manager.flushQueue();

  assert.equal(readNdjson(queuePath).length, 0);
  assert.equal(attempts, 3);

  if (fs.existsSync(queuePath)) {
    fs.unlinkSync(queuePath);
  }
});

test('email digest channel buffers discoveries until flush time', async () => {
  const queuePath = createTempPath('email-digest');
  const channel = new EmailDigestChannel(
    {
      provider: 'resend',
      apiKey: 'test-key',
      from: 'owl@example.com',
      to: 'user@example.com'
    },
    {
      digestQueuePath: queuePath
    }
  );

  await channel.send([
    {
      id: 'disc_1',
      timestamp: '2026-03-20T10:00:00.000Z',
      urgency: 'important',
      title: 'First',
      body: 'First discovery body.',
      sources: ['gmail']
    },
    {
      id: 'disc_2',
      timestamp: '2026-03-20T11:00:00.000Z',
      urgency: 'interesting',
      title: 'Second',
      body: 'Second discovery body.',
      sources: ['calendar']
    }
  ]);

  assert.equal(readNdjson(queuePath).length, 2);

  const originalFetch = global.fetch;
  let sentPayload = null;
  global.fetch = async (_url, options) => {
    sentPayload = JSON.parse(options.body);
    return {
      ok: true
    };
  };

  try {
    await channel.flush();
  } finally {
    global.fetch = originalFetch;
  }

  assert.ok(sentPayload.subject.includes('OWL') && sentPayload.subject.includes('2'));
  assert.equal(readNdjson(queuePath).length, 0);

  if (fs.existsSync(queuePath)) {
    fs.unlinkSync(queuePath);
  }
});
