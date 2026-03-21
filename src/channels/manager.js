import { CliChannel } from './cli.js';
import { TelegramChannel } from './telegram.js';
import { SlackChannel } from './slack.js';
import { DiscordChannel } from './discord.js';
import { EmailDigestChannel } from './email-digest.js';
import { WebhookChannel } from './webhook.js';
import { RssChannel } from './rss.js';
import { WhatsAppChannel } from './whatsapp.js';
import { filterForQuietHours } from './quiet-hours.js';
import { appendNdjson, readNdjson, writeNdjson } from '../utils/fs.js';

const URGENCY_EMOJI = {
  urgent: '🔴',
  important: '🟡',
  interesting: '🟢'
};

function createChannel(name, config, deps) {
  const map = {
    cli: CliChannel,
    telegram: TelegramChannel,
    slack: SlackChannel,
    discord: DiscordChannel,
    'email-digest': EmailDigestChannel,
    webhook: WebhookChannel,
    rss: RssChannel,
    whatsapp: WhatsAppChannel
  };

  const Channel = map[name];
  if (!Channel) {
    return null;
  }

  return new Channel(config, deps);
}

/**
 * Extract a suggested action from the discovery body, if present.
 * The discovery prompt asks the LLM to end with a suggested action.
 * We look for patterns like "Suggested action: ..." or the last sentence
 * that starts with an imperative verb.
 */
function extractSuggestedAction(body) {
  if (!body) {
    return { mainBody: body || '', action: '' };
  }

  // Check for explicit "Suggested action:" pattern
  const actionMatch = body.match(/suggested action:\s*(.+?)$/im);
  if (actionMatch) {
    const mainBody = body.slice(0, actionMatch.index).trim();
    return { mainBody, action: actionMatch[1].trim() };
  }

  return { mainBody: body, action: '' };
}

export function formatDiscoveryMessage(discovery) {
  const { mainBody, action } = extractSuggestedAction(discovery.body);
  const lines = [
    '\u{1F989} OWL found something',
    '',
    `${URGENCY_EMOJI[discovery.urgency] || ''} ${discovery.title}`.trim(),
    '',
    mainBody
  ];

  if (action) {
    lines.push('', `\u{2192} ${action}`);
  }

  lines.push('', `[Sources: ${(discovery.sources || []).join(', ') || 'unknown'}]`);
  return lines.join('\n');
}

export class ChannelManager {
  constructor(config = {}, deps = {}) {
    this.logger = deps.logger;
    this.deliveryQueuePath = deps.deliveryQueuePath;
    this.quietHoursConfig = config.quietHours || {};
    this.channels = [];

    for (const [name, channelConfig] of Object.entries(config)) {
      if (!channelConfig?.enabled) {
        continue;
      }

      const channel = createChannel(name, channelConfig, deps);
      if (channel) {
        this.channels.push(channel);
      }
    }
  }

  async deliver(discoveries, metadata = {}) {
    // Apply quiet hours filtering
    const { send, hold } = filterForQuietHours(discoveries, this.quietHoursConfig);
    if (hold.length > 0) {
      this.logger?.info('Quiet hours: holding discoveries', { held: hold.length, sending: send.length });
      // Queue held discoveries for later
      for (const discovery of hold) {
        this.queueDelivery('_all', [discovery], metadata);
      }
    }
    if (send.length === 0) {
      return;
    }

    for (const channel of this.channels) {
      try {
        await channel.send(send, metadata);
      } catch (error) {
        this.logger?.warn('Channel delivery failed, retrying once', {
          channel: channel.name,
          message: error.message
        });
        try {
          await channel.send(discoveries, metadata);
        } catch (retryError) {
          this.logger?.error('Channel delivery failed and was queued for retry', {
            channel: channel.name,
            message: retryError.message
          });
          this.queueDelivery(channel.name, discoveries, metadata);
        }
      }
    }
  }

  queueDelivery(channelName, discoveries, metadata = {}) {
    if (!this.deliveryQueuePath) {
      return;
    }

    appendNdjson(this.deliveryQueuePath, {
      channelName,
      discoveries,
      metadata,
      queuedAt: new Date().toISOString()
    });
  }

  async flushQueue() {
    if (!this.deliveryQueuePath) {
      return;
    }

    const pending = readNdjson(this.deliveryQueuePath);
    if (pending.length === 0) {
      return;
    }

    const remaining = [];
    for (const item of pending) {
      const channel = this.channels.find((entry) => entry.name === item.channelName);
      if (!channel) {
        remaining.push(item);
        continue;
      }

      try {
        await channel.send(item.discoveries, item.metadata || {});
      } catch (error) {
        this.logger?.warn('Queued channel delivery still failing', {
          channel: channel.name,
          message: error.message
        });
        remaining.push(item);
      }
    }

    writeNdjson(this.deliveryQueuePath, remaining);
  }

  async flushDigests() {
    for (const channel of this.channels) {
      if (typeof channel.flush !== 'function') {
        continue;
      }

      try {
        await channel.flush();
      } catch (error) {
        this.logger?.warn('Deferred channel flush failed', {
          channel: channel.name,
          message: error.message
        });
      }
    }
  }

  async pollReplies() {
    for (const channel of this.channels) {
      if (typeof channel.pollReplies !== 'function') {
        continue;
      }

      try {
        await channel.pollReplies();
      } catch (error) {
        this.logger?.warn('Channel polling failed', {
          channel: channel.name,
          message: error.message
        });
      }
    }
  }
}
