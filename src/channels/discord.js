import { formatDiscoveryMessage } from './manager.js';

const URGENCY_COLORS = {
  urgent: 0xff3b30,    // red
  important: 0xffcc00, // yellow
  interesting: 0x34c759 // green
};

const TYPE_EMOJI = {
  connection: '\u{1F517}',    // link
  anomaly: '\u{26A0}\u{FE0F}', // warning
  risk: '\u{1F6A8}',           // rotating light
  opportunity: '\u{1F4A1}',    // light bulb
  anticipation: '\u{1F52E}',   // crystal ball
  time_sensitive: '\u{23F0}'   // alarm clock
};

function buildEmbed(discovery) {
  const typeEmoji = TYPE_EMOJI[discovery.type] || '\u{1F989}';
  const color = URGENCY_COLORS[discovery.urgency] || URGENCY_COLORS.interesting;

  const fields = [];

  if (discovery.type) {
    fields.push({ name: 'Type', value: discovery.type, inline: true });
  }
  if (discovery.urgency) {
    fields.push({ name: 'Urgency', value: discovery.urgency, inline: true });
  }
  if (discovery.confidence != null) {
    fields.push({ name: 'Confidence', value: `${Math.round(discovery.confidence * 100)}%`, inline: true });
  }
  if (discovery.sources?.length) {
    fields.push({ name: 'Sources', value: discovery.sources.join(', '), inline: true });
  }
  if (discovery.entities?.length) {
    fields.push({ name: 'Entities', value: discovery.entities.slice(0, 5).join(', '), inline: false });
  }

  return {
    title: `${typeEmoji} ${discovery.title}`,
    description: discovery.body || '',
    color,
    fields,
    footer: { text: '\u{1F989} OWL Discovery' },
    timestamp: discovery.timestamp || new Date().toISOString()
  };
}

export class DiscordChannel {
  constructor(config = {}, deps = {}) {
    this.name = 'discord';
    this.config = config;
    this.logger = deps.logger;
  }

  async send(discoveries) {
    if (!this.config.webhookUrl) {
      this.logger?.warn('Discord channel skipped because webhookUrl is missing');
      return;
    }

    for (const discovery of discoveries) {
      const payload = this.config.richEmbeds !== false
        ? { embeds: [buildEmbed(discovery)] }
        : { content: formatDiscoveryMessage(discovery) };

      const response = await fetch(this.config.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Discord webhook failed with ${response.status}`);
      }

      // Discord rate limit: 30 requests/min for webhooks
      if (discoveries.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
}

// Export for testing
export { buildEmbed };
