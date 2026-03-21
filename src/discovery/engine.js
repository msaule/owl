import { compileContext } from './context.js';
import { filterDiscoveries, parseDiscoveries } from './filter.js';
import { getLastRun, setLastRun } from './history.js';
import { buildDiscoveryPrompt } from './prompt.js';
import { buildPreferenceHints } from '../learning/improvement.js';
import { processDiscoveryChain, buildMetaDiscoveryPrompt } from './chains.js';
import { nowIso } from '../utils/time.js';

export class DiscoveryEngine {
  constructor(worldModel, llm, channels, config = {}, options = {}) {
    this.worldModel = worldModel;
    this.llm = llm;
    this.channels = channels;
    this.config = config;
    this.user = options.user || {};
    this.logger = options.logger;
  }

  async runQuick() {
    return this.run('quick');
  }

  async runDeep() {
    return this.run('deep');
  }

  async runDaily() {
    return this.run('daily');
  }

  async #processChain(discovery) {
    try {
      const activeChains = this.worldModel.getActiveChains(30);
      const { chain, isNew, shouldMeta } = processDiscoveryChain(discovery, activeChains);

      if (isNew) {
        this.worldModel.addChain(chain);
      } else {
        this.worldModel.updateChain(chain);
      }

      // Generate meta-discovery if chain is long enough
      if (shouldMeta) {
        const recentDiscoveries = this.worldModel.getRecentDiscoveries(
          new Date(Date.now() - 30 * 86_400_000).toISOString(), 100
        );
        const { systemPrompt, userPrompt } = buildMetaDiscoveryPrompt(chain, recentDiscoveries);

        const response = await this.llm.chat(systemPrompt, userPrompt, {
          responseFormat: 'json',
          temperature: 0.3,
          maxTokens: 1000
        });

        const parsed = parseDiscoveries(`[${response}]`);
        for (const meta of parsed) {
          if (meta.title && meta.body) {
            const metaDiscovery = {
              ...meta,
              type: meta.type || 'connection',
              urgency: meta.urgency || 'important',
              timestamp: nowIso(),
              sources: meta.sources || chain.sources || [],
              entities: meta.entities || chain.entities || []
            };
            this.worldModel.addDiscovery(metaDiscovery);
            await this.channels.deliver([metaDiscovery], { scanType: 'meta' });
            this.logger?.info('Meta-discovery generated from chain', {
              chainId: chain.id,
              chainLength: chain.length,
              title: meta.title
            });
          }
        }
      }
    } catch (error) {
      this.logger?.warn('Chain processing failed (non-fatal)', { message: error.message });
    }
  }

  async run(scanType) {
    const lastRunTime = getLastRun(this.worldModel, scanType);
    const context = compileContext(this.worldModel, scanType, { lastRunTime });

    const preferenceHints = buildPreferenceHints(this.worldModel);
    const { systemPrompt, userPrompt } = buildDiscoveryPrompt(context, scanType, this.user, { preferenceHints });

    try {
      const response = await this.llm.chat(systemPrompt, userPrompt, {
        responseFormat: 'json',
        temperature: 0.3,
        maxTokens: scanType === 'daily' ? 2600 : 2000
      });

      const discoveries = parseDiscoveries(response);
      const filtered = filterDiscoveries(discoveries, this.worldModel, this.config);

      for (const discovery of filtered) {
        this.worldModel.addDiscovery({
          ...discovery,
          timestamp: nowIso()
        });

        // Process through chain system
        await this.#processChain(discovery);
      }

      if (filtered.length > 0) {
        await this.channels.deliver(filtered, { scanType });
      }

      this.worldModel.markEventsProcessed();
      setLastRun(this.worldModel, scanType, nowIso());

      this.logger?.info('Discovery run completed', {
        scanType,
        candidates: discoveries.length,
        delivered: filtered.length
      });

      return filtered;
    } catch (error) {
      this.logger?.error('Discovery run failed', { scanType, message: error.message });
      return [];
    }
  }
}
