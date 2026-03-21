import { sleep } from '../../utils/time.js';
import { truncate } from '../../utils/text.js';

let pluginConfig = {
  botToken: '',
  channels: [],
  pollMinutes: 2
};

const state = {
  /** @type {Map<string, string>} channel name → channel ID */
  channelMap: new Map(),
  /** @type {Map<string, string>} channel ID → oldest timestamp seen */
  cursors: new Map(),
  /** @type {Map<string, string>} user ID → display name */
  userCache: new Map()
};

async function slackApi(method, params = {}) {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const response = await fetch(url.toString(), {
    headers: { authorization: `Bearer ${pluginConfig.botToken}` }
  });

  if (!response.ok) {
    throw new Error(`Slack API ${method} failed with ${response.status}`);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Slack API ${method} error: ${data.error}`);
  }

  return data;
}

async function resolveChannelIds() {
  const data = await slackApi('conversations.list', { types: 'public_channel,private_channel', limit: 200 });
  const wanted = new Set((pluginConfig.channels || []).map((ch) => ch.replace(/^#/, '').toLowerCase()));

  for (const channel of data.channels || []) {
    if (wanted.has(channel.name.toLowerCase())) {
      state.channelMap.set(channel.name, channel.id);
    }
  }
}

async function resolveUser(userId) {
  if (state.userCache.has(userId)) {
    return state.userCache.get(userId);
  }

  try {
    const data = await slackApi('users.info', { user: userId });
    const name = data.user?.real_name || data.user?.name || userId;
    state.userCache.set(userId, name);
    return name;
  } catch {
    return userId;
  }
}

function toEvent(message, channelName) {
  const isMention = String(message.text || '').includes('<@');
  return {
    id: `slack-${message.ts}`,
    source: 'slack',
    type: isMention ? 'slack.mention' : 'slack.message',
    timestamp: new Date(Number(message.ts) * 1000).toISOString(),
    summary: `Message in #${channelName}: ${truncate(message.text || '', 180)}`,
    data: {
      channel: channelName,
      user: message._userName || message.user || 'unknown',
      text: truncate(message.text || '', 300),
      threadTs: message.thread_ts || null
    },
    importance: isMention ? 0.7 : 0.45
  };
}

export default {
  name: 'slack',
  description: 'Watches Slack channels for messages, mentions, and activity.',

  async setup(config = {}) {
    pluginConfig = { ...pluginConfig, ...config };
  },

  async *watch() {
    if (!pluginConfig.botToken || !pluginConfig.channels?.length) {
      return;
    }

    await resolveChannelIds();

    while (true) {
      for (const [channelName, channelId] of state.channelMap.entries()) {
        const params = { channel: channelId, limit: 30 };
        const cursor = state.cursors.get(channelId);
        if (cursor) {
          params.oldest = cursor;
        }

        const data = await slackApi('conversations.history', params);
        const messages = (data.messages || [])
          .filter((msg) => !msg.subtype) // Skip join/leave/bot messages
          .reverse(); // oldest first

        for (const message of messages) {
          // Skip messages we've already seen
          if (cursor && message.ts <= cursor) {
            continue;
          }

          // Resolve user name
          if (message.user) {
            message._userName = await resolveUser(message.user);
          }

          yield toEvent(message, channelName);
        }

        // Advance cursor to the latest message timestamp
        if (messages.length) {
          state.cursors.set(channelId, messages.at(-1).ts);
        }
      }

      await sleep((pluginConfig.pollMinutes || 2) * 60_000);
    }
  },

  async query(question) {
    return {
      plugin: 'slack',
      status: pluginConfig.botToken ? 'connected' : 'not-configured',
      channelsWatching: Array.from(state.channelMap.keys()),
      question: truncate(question, 160)
    };
  }
};
