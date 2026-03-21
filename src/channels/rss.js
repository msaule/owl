/**
 * RSS Feed channel — writes discoveries as an Atom feed to a local XML file.
 *
 * Users can point any feed reader (Feedly, Miniflux, NetNewsWire, etc.)
 * at the local file or serve it via a simple HTTP server.
 *
 * The feed is regenerated on every delivery and kept to the most recent 50
 * discoveries.
 */

import fs from 'node:fs';
import path from 'node:path';
import { formatDiscoveryMessage } from './manager.js';

const MAX_FEED_ITEMS = 50;

function escapeXml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildAtomEntry(discovery) {
  const id = discovery.id || `owl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const updated = discovery.timestamp || new Date().toISOString();
  const title = escapeXml(discovery.title || 'OWL Discovery');
  const body = escapeXml(discovery.body || '');
  const sources = (discovery.sources || []).join(', ');
  const urgency = discovery.urgency || 'interesting';
  const type = discovery.type || 'connection';

  return `  <entry>
    <id>urn:owl:discovery:${escapeXml(id)}</id>
    <title>${title}</title>
    <updated>${updated}</updated>
    <content type="html">&lt;p&gt;${body}&lt;/p&gt;&lt;p&gt;&lt;strong&gt;Type:&lt;/strong&gt; ${escapeXml(type)} | &lt;strong&gt;Urgency:&lt;/strong&gt; ${escapeXml(urgency)} | &lt;strong&gt;Sources:&lt;/strong&gt; ${escapeXml(sources)}&lt;/p&gt;</content>
    <category term="${escapeXml(type)}" />
    <category term="${escapeXml(urgency)}" />
  </entry>`;
}

function buildAtomFeed(discoveries, feedTitle = 'OWL Discoveries') {
  const updated = discoveries.length > 0
    ? discoveries[0].timestamp || new Date().toISOString()
    : new Date().toISOString();

  const entries = discoveries.slice(0, MAX_FEED_ITEMS).map(buildAtomEntry).join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>urn:owl:feed:discoveries</id>
  <title>${escapeXml(feedTitle)}</title>
  <subtitle>AI-powered discoveries from your world model</subtitle>
  <updated>${updated}</updated>
  <generator>OWL</generator>
${entries}
</feed>
`;
}

export class RssChannel {
  constructor(config = {}, deps = {}) {
    this.name = 'rss';
    this.config = config;
    this.logger = deps.logger;
    this.feedPath = config.feedPath || path.join(
      config.dataDir || path.join(process.env.HOME || process.env.USERPROFILE || '.', '.owl'),
      'discoveries.atom'
    );
    this.existingEntries = [];
  }

  async send(discoveries) {
    // Read existing entries if the feed file exists
    this._loadExisting();

    // Prepend new discoveries (newest first)
    const allDiscoveries = [...discoveries, ...this.existingEntries].slice(0, MAX_FEED_ITEMS);

    const feedXml = buildAtomFeed(allDiscoveries, this.config.title || 'OWL Discoveries');

    fs.mkdirSync(path.dirname(this.feedPath), { recursive: true });
    fs.writeFileSync(this.feedPath, feedXml, 'utf8');

    this.existingEntries = allDiscoveries;
    this.logger?.info('Updated RSS feed', { path: this.feedPath, items: allDiscoveries.length });
  }

  _loadExisting() {
    if (this.existingEntries.length > 0) {
      return;
    }

    // We don't parse XML back — we keep a sidecar JSON file for state
    const jsonPath = this.feedPath + '.json';
    try {
      if (fs.existsSync(jsonPath)) {
        this.existingEntries = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      }
    } catch {
      this.existingEntries = [];
    }
  }

  _saveState() {
    const jsonPath = this.feedPath + '.json';
    try {
      fs.writeFileSync(jsonPath, JSON.stringify(this.existingEntries.slice(0, MAX_FEED_ITEMS)), 'utf8');
    } catch {
      // Non-critical — feed still works, just loses history on restart
    }
  }

  async afterSend() {
    this._saveState();
  }
}

// Export for testing
export { buildAtomFeed, buildAtomEntry, escapeXml };
