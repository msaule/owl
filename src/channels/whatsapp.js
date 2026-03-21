/**
 * WhatsApp channel — sends discoveries via the WhatsApp Business Cloud API.
 *
 * Requires a Meta Business account with WhatsApp Business API access.
 * Config: phoneNumberId, accessToken, recipientPhone.
 *
 * For users without Business API access, the webhook channel can be used
 * with services like Twilio or whapi.cloud as a bridge.
 */

import { formatDiscoveryMessage } from './manager.js';

export class WhatsAppChannel {
  constructor(config = {}, deps = {}) {
    this.name = 'whatsapp';
    this.config = config;
    this.logger = deps.logger;
  }

  async send(discoveries) {
    if (!this.config.phoneNumberId || !this.config.accessToken || !this.config.recipientPhone) {
      this.logger?.warn('WhatsApp channel skipped — phoneNumberId, accessToken, or recipientPhone missing');
      return;
    }

    const apiUrl = `https://graph.facebook.com/v18.0/${this.config.phoneNumberId}/messages`;

    for (const discovery of discoveries) {
      const text = formatDiscoveryMessage(discovery);

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: this.config.recipientPhone,
          type: 'text',
          text: { body: text }
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `WhatsApp API failed with ${response.status}: ${errorData.error?.message || 'unknown error'}`
        );
      }
    }
  }
}
