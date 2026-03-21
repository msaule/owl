import { googleFetch } from '../google-auth.js';
import { sleep } from '../../utils/time.js';
import { truncate } from '../../utils/text.js';

let pluginConfig = {
  credentials: '',
  pollSeconds: 60,
  emailDetailLevel: 'standard'
};

const state = {
  seenMessageIds: new Set(),
  historyId: null,
  me: null
};

function parseHeaderMap(message) {
  return Object.fromEntries(
    (message.payload?.headers || []).map((header) => [header.name.toLowerCase(), header.value])
  );
}

function splitAddresses(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function determineImportance(headers, labels) {
  let score = 0.45;
  if ((labels || []).includes('IMPORTANT')) {
    score += 0.2;
  }
  if ((labels || []).includes('UNREAD')) {
    score += 0.1;
  }
  if ((headers.subject || '').toLowerCase().includes('urgent')) {
    score += 0.15;
  }
  if (headers['in-reply-to']) {
    score += 0.05;
  }
  return Math.min(0.95, score);
}

async function getProfile() {
  return googleFetch(pluginConfig.credentials, 'https://gmail.googleapis.com/gmail/v1/users/me/profile');
}

async function listRecentMessages() {
  const payload = await googleFetch(
    pluginConfig.credentials,
    'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&includeSpamTrash=false'
  );

  return payload.messages || [];
}

async function listHistory(startHistoryId) {
  return googleFetch(
    pluginConfig.credentials,
    `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${startHistoryId}&historyTypes=messageAdded`
  );
}

async function fetchMessage(id) {
  return googleFetch(
    pluginConfig.credentials,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=In-Reply-To`
  );
}

async function getCandidateMessageIds() {
  if (!state.historyId) {
    return listRecentMessages();
  }

  try {
    const payload = await listHistory(state.historyId);
    const history = payload.history || [];
    const ids = [];

    for (const item of history) {
      for (const added of item.messagesAdded || []) {
        ids.push(added.message);
      }
      state.historyId = item.id || state.historyId;
    }

    return ids;
  } catch {
    return listRecentMessages();
  }
}

function toEvent(message) {
  const headers = parseHeaderMap(message);
  const from = splitAddresses(headers.from);
  const to = splitAddresses(headers.to);
  const cc = splitAddresses(headers.cc);
  const me = state.me?.emailAddress || '';
  const isSent = from.some((value) => value.toLowerCase().includes(me.toLowerCase()));
  const snippetLength = pluginConfig.emailDetailLevel === 'minimal' ? 80 : pluginConfig.emailDetailLevel === 'full' ? 500 : 200;

  return {
    id: message.id,
    source: 'gmail',
    type: isSent ? 'email.sent' : 'email.received',
    timestamp: new Date(Number(message.internalDate)).toISOString(),
    summary: `Email ${isSent ? 'to' : 'from'} ${truncate((isSent ? to[0] : from[0]) || 'unknown', 60)}: ${truncate(headers.subject || '(no subject)', 100)}`,
    data: {
      from,
      to,
      cc,
      subject: headers.subject || '',
      snippet: truncate(message.snippet || '', snippetLength),
      labels: message.labelIds || [],
      threadId: message.threadId,
      hasAttachments: false,
      isReply: Boolean(headers['in-reply-to'])
    },
    importance: determineImportance(headers, message.labelIds)
  };
}

export default {
  name: 'gmail',
  description: 'Watches Gmail for new sent and received emails using local OAuth credentials.',

  async setup(config = {}) {
    pluginConfig = { ...pluginConfig, ...config };
    state.me = await getProfile();
  },

  async *watch() {
    while (true) {
      const messages = await getCandidateMessageIds();
      for (const messageRef of messages) {
        if (!messageRef?.id || state.seenMessageIds.has(messageRef.id)) {
          continue;
        }

        const message = await fetchMessage(messageRef.id);
        state.seenMessageIds.add(message.id);
        state.historyId = message.historyId || state.historyId;
        yield toEvent(message);
      }

      await sleep((pluginConfig.pollSeconds || 60) * 1000);
    }
  },

  async query(question) {
    return {
      plugin: 'gmail',
      status: 'connected',
      question
    };
  }
};
