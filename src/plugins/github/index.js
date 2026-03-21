import { sleep } from '../../utils/time.js';
import { truncate } from '../../utils/text.js';

let pluginConfig = {
  token: '',
  owner: '',
  pollMinutes: 5
};

const state = {
  seenEvents: new Set()
};

async function githubFetch(endpoint) {
  const response = await fetch(`https://api.github.com${endpoint}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${pluginConfig.token}`,
      'user-agent': 'owl-ai'
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub API failed with ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

function toEvent(event) {
  const repoName = event.repo?.name || 'unknown repo';
  const actor = event.actor?.login || 'unknown actor';

  let summary = `${actor} triggered ${event.type} in ${repoName}`;
  if (event.type === 'PullRequestEvent') {
    summary = `${actor} ${event.payload?.action || 'updated'} PR in ${repoName}`;
  }
  if (event.type === 'PushEvent') {
    summary = `${actor} pushed ${event.payload?.commits?.length || 0} commits to ${repoName}`;
  }

  return {
    id: `github-${event.id}`,
    source: 'github',
    type: `github.${event.type.replace(/Event$/, '').toLowerCase()}`,
    timestamp: event.created_at,
    summary,
    data: {
      repo: repoName,
      actor,
      action: event.payload?.action || '',
      ref: event.payload?.ref || '',
      title: event.payload?.pull_request?.title || event.payload?.issue?.title || '',
      commits: (event.payload?.commits || []).map((commit) => truncate(commit.message, 120))
    },
    importance: event.type === 'PullRequestEvent' ? 0.7 : 0.52
  };
}

export default {
  name: 'github',
  description: 'Watches GitHub user or org events for pushes, PRs, and issues.',

  async setup(config = {}) {
    pluginConfig = { ...pluginConfig, ...config };
  },

  async *watch() {
    while (true) {
      const endpoint = pluginConfig.owner ? `/users/${pluginConfig.owner}/events` : '/user/events';
      const events = await githubFetch(endpoint);

      for (const event of events || []) {
        if (state.seenEvents.has(event.id)) {
          continue;
        }
        state.seenEvents.add(event.id);
        yield toEvent(event);
      }

      await sleep((pluginConfig.pollMinutes || 5) * 60_000);
    }
  },

  async query(question) {
    return {
      plugin: 'github',
      status: pluginConfig.token ? 'connected' : 'not-configured',
      question: truncate(question, 160)
    };
  }
};
