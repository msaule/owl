import test from 'node:test';
import assert from 'node:assert/strict';
import { findTelegramChatIdFromUpdates } from '../src/channels/telegram-setup.js';

test('findTelegramChatIdFromUpdates prefers the latest private chat', () => {
  const chatId = findTelegramChatIdFromUpdates({
    result: [
      {
        update_id: 1,
        message: {
          text: '/start',
          chat: { id: 123, type: 'private' }
        }
      },
      {
        update_id: 2,
        message: {
          text: 'hello',
          chat: { id: 456, type: 'private' }
        }
      }
    ]
  });

  assert.equal(chatId, '456');
});

test('findTelegramChatIdFromUpdates returns null when no usable chat is present', () => {
  const chatId = findTelegramChatIdFromUpdates({
    result: [
      {
        update_id: 3,
        message: {
          text: 'channel post',
          chat: { id: -100, type: 'channel' }
        }
      }
    ]
  });

  assert.equal(chatId, null);
});
