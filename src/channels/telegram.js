import { formatDiscoveryMessage } from './manager.js';
import { respondToFollowUp } from '../llm/conversation.js';
import { recordFeedbackFromReply } from '../learning/feedback.js';

export class TelegramChannel {
  constructor(config = {}, deps = {}) {
    this.name = 'telegram';
    this.config = config;
    this.logger = deps.logger;
    this.worldModel = deps.worldModel;
    this.llm = deps.llm;
  }

  async send(discoveries) {
    if (!this.config.botToken || !this.config.chatId) {
      this.logger?.warn('Telegram channel skipped because botToken/chatId are missing');
      return;
    }

    for (const discovery of discoveries) {
      const response = await this.#call('sendMessage', {
        chat_id: this.config.chatId,
        text: formatDiscoveryMessage(discovery)
      });

      const messageId = response?.result?.message_id;
      if (messageId) {
        this.worldModel.setUserPreference(`channel:telegram:message:${messageId}`, discovery.id);
      }
    }
  }

  async pollReplies() {
    if (!this.config.pollReplies || !this.config.botToken) {
      return;
    }

    const lastUpdateId = this.worldModel.getUserPreference('channel:telegram:lastUpdateId') || 0;
    const response = await this.#call('getUpdates', {
      offset: lastUpdateId + 1,
      timeout: 0
    });

    const updates = response?.result || [];
    for (const update of updates) {
      this.worldModel.setUserPreference('channel:telegram:lastUpdateId', update.update_id);
      const message = update.message;
      if (!message?.reply_to_message?.message_id || !message.text) {
        continue;
      }

      const discoveryId = this.worldModel.getUserPreference(
        `channel:telegram:message:${message.reply_to_message.message_id}`
      );

      if (!discoveryId) {
        continue;
      }

      recordFeedbackFromReply(this.worldModel, discoveryId, message.text);

      const discovery = this.worldModel.getDiscovery(discoveryId);
      if (!discovery) {
        continue;
      }

      const reply = await respondToFollowUp({
        message: message.text,
        discovery,
        worldModel: this.worldModel,
        llm: this.llm
      });

      await this.#call('sendMessage', {
        chat_id: message.chat.id,
        text: reply,
        reply_to_message_id: message.message_id
      });
    }
  }

  async #call(method, payload) {
    const response = await fetch(`https://api.telegram.org/bot${this.config.botToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Telegram API ${method} failed with ${response.status}`);
    }

    return response.json();
  }
}
