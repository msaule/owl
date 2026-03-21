/**
 * Webhook channel — posts discovery payloads as JSON to a user-configured URL.
 * Useful for custom integrations, n8n, Zapier, IFTTT, or any system that
 * accepts HTTP webhooks.
 */
export class WebhookChannel {
  constructor(config = {}, deps = {}) {
    this.name = 'webhook';
    this.config = config;
    this.logger = deps.logger;
  }

  async send(discoveries) {
    if (!this.config.url) {
      this.logger?.warn('Webhook channel skipped because url is missing');
      return;
    }

    const headers = {
      'content-type': 'application/json',
      ...(this.config.headers || {})
    };

    if (this.config.secret) {
      headers['x-owl-secret'] = this.config.secret;
    }

    const payload = {
      event: 'discoveries',
      timestamp: new Date().toISOString(),
      discoveries: discoveries.map((d) => ({
        type: d.type,
        urgency: d.urgency,
        title: d.title,
        body: d.body,
        sources: d.sources || [],
        entities: d.entities || [],
        confidence: d.confidence
      }))
    };

    const response = await fetch(this.config.url, {
      method: this.config.method || 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Webhook delivery failed with ${response.status}`);
    }
  }
}
