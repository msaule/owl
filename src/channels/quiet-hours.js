/**
 * Quiet Hours — prevents OWL from sending discoveries during configured
 * quiet periods (e.g., 10pm - 7am, weekends).
 *
 * When a discovery would be delivered during quiet hours, it is held
 * in a buffer and released when quiet hours end.
 */

/**
 * Check if the current time falls within quiet hours.
 *
 * @param {object} config - Quiet hours config
 * @param {string} config.start - Start time in "HH:MM" format (e.g., "22:00")
 * @param {string} config.end - End time in "HH:MM" format (e.g., "07:00")
 * @param {boolean} [config.weekends] - Also quiet on weekends (Saturday/Sunday)
 * @param {Date} [now] - Override current time (for testing)
 * @returns {boolean}
 */
export function isQuietTime(config = {}, now = new Date()) {
  if (!config.start || !config.end) {
    return false;
  }

  // Check weekends
  if (config.weekends) {
    const day = now.getDay();
    if (day === 0 || day === 6) {
      return true;
    }
  }

  const [startHour, startMin] = config.start.split(':').map(Number);
  const [endHour, endMin] = config.end.split(':').map(Number);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = startHour * 60 + (startMin || 0);
  const endMinutes = endHour * 60 + (endMin || 0);

  // Handle overnight ranges (e.g., 22:00 → 07:00)
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  // Handle same-day ranges (e.g., 13:00 → 14:00)
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

/**
 * Filter discoveries based on urgency during quiet hours.
 * Urgent discoveries always go through; others are held.
 *
 * @param {Array} discoveries - Discoveries to filter
 * @param {object} config - Quiet hours config
 * @returns {{ send: Array, hold: Array }}
 */
export function filterForQuietHours(discoveries, config = {}) {
  if (!isQuietTime(config)) {
    return { send: discoveries, hold: [] };
  }

  const send = [];
  const hold = [];

  for (const discovery of discoveries) {
    if (discovery.urgency === 'urgent' && !config.muteUrgent) {
      send.push(discovery);
    } else {
      hold.push(discovery);
    }
  }

  return { send, hold };
}
