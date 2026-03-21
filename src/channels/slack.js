import { formatDiscoveryMessage } from './manager.js';
import { respondToFollowUp } from '../llm/conversation.js';
import { recordFeedbackFromReply } from '../learning/feedback.js';

const URGENCY_EMOJI = {
  urgent: ':red_circle:',
  important: ':large_yellow_circle:',
  interesting: ':large_green_circle:'
};

const TYPE_EMOJI = {
  connection: ':link:',
  anomaly: ':warning:',
  risk: ':rotating_light:',
  opportunity: ':bulb:',
  anticipation: ':crystal_ball:',
  time_sensitive: ':alarm_clock:'
};

function buildBlocks(discovery) {
  const typeEmoji = TYPE_EMOJI[discovery.type] || ':owl:';
  const urgencyEmoji = URGENCY_EMOJI[discovery.urgency] || '';

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `\u{1F989} OWL Discovery`, emoji: true }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${urgencyEmoji} *${discovery.title}*`
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: discovery.body || ''
      }
    }
  ];

  // Metadata fields
  const fields = [];
  if (discovery.type) {
    fields.push({ type: 'mrkdwn', text: `*Type:* ${typeEmoji} ${discovery.type}` });
  }
  if (discovery.urgency) {
    fields.push({ type: 'mrkdwn', text: `*Urgency:* ${discovery.urgency}` });
  }
  if (discovery.confidence != null) {
    fields.push({ type: 'mrkdwn', text: `*Confidence:* ${Math.round(discovery.confidence * 100)}%` });
  }
  if (discovery.sources?.length) {
    fields.push({ type: 'mrkdwn', text: `*Sources:* ${discovery.sources.join(', ')}` });
  }

  if (fields.length > 0) {
    blocks.push({ type: 'section', fields });
  }

  blocks.push({ type: 'divider' });

  return blocks;
}

export class SlackChannel {
  constructor(config = {}, deps = {}) {
    this.name = 'slack';
    this.config = config;
    this.logger = deps.logger;
    this.worldModel = deps.worldModel;
    this.llm = deps.llm;
  }

  async send(discoveries) {
    if (!this.config.botToken || !this.config.channel) {
      this.logger?.warn('Slack channel skipped because botToken/channel are missing');
      return;
    }

    for (const discovery of discoveries) {
      const payload = this.config.richBlocks !== false
        ? {
            channel: this.config.channel,
            blocks: buildBlocks(discovery),
            text: formatDiscoveryMessage(discovery) // fallback for notifications
          }
        : {
            channel: this.config.channel,
            text: formatDiscoveryMessage(discovery)
          };

      const response = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.botToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(`Slack API failed: ${data.error || response.status}`);
      }

      // Track message for follow-up replies
      if (data.ts && this.worldModel) {
        this.worldModel.setUserPreference(
          `channel:slack:message:${data.channel}:${data.ts}`,
          discovery.id
        );
      }
    }
  }

  async pollReplies() {
    if (!this.config.pollReplies || !this.config.botToken || !this.config.channel) {
      return;
    }

    // Use conversations.history to check for new thread replies to OWL messages
    const lastPollTs = this.worldModel?.getUserPreference('channel:slack:lastPollTs') || '0';

    const response = await fetch('https://slack.com/api/conversations.history', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.botToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        channel: this.config.channel,
        oldest: lastPollTs,
        limit: 50
      })
    });

    const data = await response.json();
    if (!data.ok) {
      return;
    }

    let latestTs = lastPollTs;
    for (const msg of (data.messages || [])) {
      if (!msg.thread_ts || msg.thread_ts === msg.ts) {
        continue; // Not a thread reply
      }

      const discoveryId = this.worldModel?.getUserPreference(
        `channel:slack:message:${this.config.channel}:${msg.thread_ts}`
      );
      if (!discoveryId || !msg.text) {
        continue;
      }

      // Record feedback
      recordFeedbackFromReply(this.worldModel, discoveryId, msg.text);

      // Generate follow-up response
      const discovery = this.worldModel?.getDiscovery(discoveryId);
      if (discovery && this.llm) {
        const reply = await respondToFollowUp({
          message: msg.text,
          discovery,
          worldModel: this.worldModel,
          llm: this.llm
        });

        await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.config.botToken}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            channel: this.config.channel,
            thread_ts: msg.thread_ts,
            text: reply
          })
        });
      }

      if (msg.ts > latestTs) {
        latestTs = msg.ts;
      }
    }

    if (latestTs !== lastPollTs) {
      this.worldModel?.setUserPreference('channel:slack:lastPollTs', latestTs);
    }
  }
}

// Export for testing
export { buildBlocks };
