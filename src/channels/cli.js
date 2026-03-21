import { formatDiscoveryMessage } from './manager.js';

export class CliChannel {
  constructor(config = {}, deps = {}) {
    this.name = 'cli';
    this.config = config;
    this.logger = deps.logger;
  }

  async send(discoveries) {
    for (const discovery of discoveries) {
      console.log(`\n${formatDiscoveryMessage(discovery)}\n`);
    }

    this.logger?.info('Delivered discoveries to CLI', { count: discoveries.length });
  }
}
