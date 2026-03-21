import cron from 'node-cron';
import { nowIso } from '../utils/time.js';
import { runFeedbackExpiry } from '../learning/feedback.js';
import { computeHealthMetrics, detectHealthAnomalies } from '../discovery/health.js';
import { computeBaselines, detectAnomalies, anomaliesToEvents } from '../core/anomaly.js';
import { compileDebriefData, buildDebriefPrompt } from '../discovery/debrief.js';
import { parseDiscoveries } from '../discovery/filter.js';

export function registerSchedules({ discovery, channels, entityQueue, config, worldModel, llm, logger }) {
  const tasks = [];

  const wrap = (name, handler) => async () => {
    logger?.info('Scheduled task starting', { task: name });
    await handler();
    worldModel.setUserPreference(`schedule:lastRun:${name}`, nowIso());
  };

  tasks.push(
    cron.schedule(config.discovery?.quickSchedule || '*/30 * * * *', wrap('quick', () => discovery.runQuick()))
  );
  tasks.push(
    cron.schedule(config.discovery?.deepSchedule || '0 */6 * * *', wrap('deep', () => discovery.runDeep()))
  );
  tasks.push(
    cron.schedule(config.discovery?.dailySchedule || '0 7 * * *', wrap('daily', () => discovery.runDaily()))
  );
  tasks.push(cron.schedule('*/10 * * * *', wrap('delivery-retry', () => channels.flushQueue())));
  tasks.push(
    cron.schedule(
      config.channels?.['email-digest']?.schedule || config.discovery?.dailySchedule || '0 7 * * *',
      wrap('digest-flush', () => channels.flushDigests())
    )
  );
  tasks.push(cron.schedule('*/5 * * * *', wrap('entity-flush', () => entityQueue.flush())));
  tasks.push(cron.schedule('*/2 * * * *', wrap('channel-poll', () => channels.pollReplies())));

  // Expire stale discoveries (no response after 48h → neutral) and stale situations
  tasks.push(cron.schedule('0 */6 * * *', wrap('feedback-expiry', () => {
    const result = runFeedbackExpiry(worldModel);
    if (result.expiredDiscoveries || result.expiredSituations) {
      logger?.info('Feedback expiry ran', result);
    }
  })));

  // Health self-diagnostics — log anomalies daily
  tasks.push(cron.schedule('30 7 * * *', wrap('health-check', () => {
    const metrics = computeHealthMetrics(worldModel);
    const anomalies = detectHealthAnomalies(metrics);
    if (anomalies.length > 0) {
      logger?.warn('Health anomalies detected', { anomalies });
    }
    logger?.info('Health check completed', {
      discoveries_today: metrics.daily.discoveries,
      events_today: metrics.daily.events,
      feedback_rate: metrics.weekly.feedbackRate
    });
  })));

  // Anomaly detection — run every 4 hours, inject anomaly events
  tasks.push(cron.schedule('0 */4 * * *', wrap('anomaly-detection', () => {
    try {
      const baselines = computeBaselines(worldModel, 30);
      const anomalies = detectAnomalies(worldModel, baselines, 4);
      if (anomalies.length > 0) {
        const events = anomaliesToEvents(anomalies);
        for (const event of events) {
          worldModel.addEvent(event);
        }
        logger?.info('Anomaly detection found signals', { count: anomalies.length });
      }
    } catch (error) {
      logger?.warn('Anomaly detection failed (non-fatal)', { message: error.message });
    }
  })));

  // Weekly debrief — Sunday at 6pm
  if (llm) {
    tasks.push(cron.schedule('0 18 * * 0', wrap('weekly-debrief', async () => {
      try {
        const data = compileDebriefData(worldModel);
        if (data.discoveries.total === 0 && data.events.total === 0) {
          logger?.info('Weekly debrief skipped — no activity this week');
          return;
        }

        const userName = config.user?.name || 'the user';
        const { systemPrompt, userPrompt } = buildDebriefPrompt(data, userName);

        const response = await llm.chat(systemPrompt, userPrompt, {
          responseFormat: 'json',
          temperature: 0.4,
          maxTokens: 1200
        });

        const parsed = parseDiscoveries(`[${response}]`);
        for (const debrief of parsed) {
          if (debrief.title && debrief.body) {
            const debriefDiscovery = {
              ...debrief,
              type: debrief.type || 'connection',
              urgency: debrief.urgency || 'interesting',
              timestamp: nowIso(),
              sources: debrief.sources || ['owl'],
              entities: debrief.entities || []
            };
            worldModel.addDiscovery(debriefDiscovery);
            await channels.deliver([debriefDiscovery], { scanType: 'debrief' });
            logger?.info('Weekly debrief generated', { title: debrief.title });
          }
        }
      } catch (error) {
        logger?.warn('Weekly debrief failed (non-fatal)', { message: error.message });
      }
    })));
  }

  return tasks;
}
