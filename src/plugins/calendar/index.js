import { googleFetch } from '../google-auth.js';
import { sleep } from '../../utils/time.js';
import { truncate } from '../../utils/text.js';

let pluginConfig = {
  credentials: '',
  pollMinutes: 5,
  windowDays: 14,
  calendarId: 'primary'
};

const state = {
  seen: new Map(),
  approaching: new Set()
};

async function listEvents() {
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + (pluginConfig.windowDays || 14) * 86_400_000).toISOString();
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    showDeleted: 'true',
    maxResults: '250'
  });

  const payload = await googleFetch(
    pluginConfig.credentials,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(pluginConfig.calendarId || 'primary')}/events?${params.toString()}`
  );

  return payload.items || [];
}

function buildAttendees(event) {
  return (event.attendees || []).map((attendee) =>
    attendee.displayName && attendee.email
      ? `${attendee.displayName} <${attendee.email}>`
      : attendee.email || attendee.displayName || 'unknown attendee'
  );
}

function toBaseEvent(event, type) {
  const start = event.start?.dateTime || event.start?.date;
  return {
    id: `${event.id}:${type}`,
    source: 'calendar',
    type,
    timestamp: start || new Date().toISOString(),
    summary: `${event.summary || '(untitled)'}${type === 'calendar.event.approaching' ? ' is approaching' : ''}`,
    data: {
      title: event.summary || '',
      attendees: buildAttendees(event),
      time: start,
      location: event.location || '',
      description: truncate(event.description || '', 200),
      recurrence: event.recurrence || []
    },
    importance: type === 'calendar.event.approaching' ? 0.8 : 0.58
  };
}

export default {
  name: 'calendar',
  description: 'Watches Google Calendar for new, changed, cancelled, and approaching events.',

  async setup(config = {}) {
    pluginConfig = { ...pluginConfig, ...config };
  },

  async *watch() {
    while (true) {
      const events = await listEvents();
      const now = Date.now();

      for (const event of events) {
        const key = event.id;
        const updated = event.updated || '';
        const previous = state.seen.get(key);

        if (!previous) {
          state.seen.set(key, updated);
          yield toBaseEvent(event, event.status === 'cancelled' ? 'calendar.event.cancelled' : 'calendar.event.created');
        } else if (previous !== updated) {
          state.seen.set(key, updated);
          yield toBaseEvent(event, event.status === 'cancelled' ? 'calendar.event.cancelled' : 'calendar.event.updated');
        }

        const startTime = new Date(event.start?.dateTime || event.start?.date || 0).getTime();
        if (startTime > now && startTime <= now + 2 * 3_600_000) {
          const approachKey = `${event.id}:${event.start?.dateTime || event.start?.date}`;
          if (!state.approaching.has(approachKey)) {
            state.approaching.add(approachKey);
            yield toBaseEvent(event, 'calendar.event.approaching');
          }
        }
      }

      await sleep((pluginConfig.pollMinutes || 5) * 60_000);
    }
  },

  async query(question) {
    return {
      plugin: 'calendar',
      status: 'connected',
      question
    };
  }
};
