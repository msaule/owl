import chalk from 'chalk';
import ora from 'ora';
import crypto from 'node:crypto';
import { WorldModel } from '../core/world-model.js';
import { showBanner, computeOwlScore, formatOwlScore } from './banner.js';

const DEMO_ENTITIES = [
  { type: 'person', name: 'Sarah Chen', attributes: { role: 'CTO', company: 'Nexus AI' } },
  { type: 'person', name: 'James Park', attributes: { role: 'Lead Engineer', company: 'Nexus AI' } },
  { type: 'person', name: 'Maria Gonzalez', attributes: { role: 'VP Sales', company: 'Apex Corp' } },
  { type: 'company', name: 'Nexus AI', attributes: { industry: 'artificial intelligence', size: 'startup' } },
  { type: 'company', name: 'Apex Corp', attributes: { industry: 'enterprise software', size: 'mid-market' } },
  { type: 'company', name: 'CloudScale Inc', attributes: { industry: 'cloud infrastructure' } },
  { type: 'project', name: 'Project Aurora', attributes: { status: 'active', priority: 'high' } },
  { type: 'topic', name: 'Series B Funding', attributes: { domain: 'finance' } },
  { type: 'topic', name: 'API Migration', attributes: { domain: 'engineering' } },
  { type: 'location', name: 'San Francisco', attributes: { type: 'city' } }
];

const DEMO_EVENTS = [
  { source: 'gmail', type: 'email_received', summary: 'Sarah Chen sent contract renewal proposal for Project Aurora', entities: [0, 1, 6] },
  { source: 'gmail', type: 'email_sent', summary: 'Replied to Maria Gonzalez about Apex Corp partnership terms', entities: [2, 4] },
  { source: 'calendar', type: 'meeting', summary: 'Board meeting: Series B update with Nexus AI leadership', entities: [0, 3, 7] },
  { source: 'calendar', type: 'meeting', summary: 'Technical review: API Migration progress with James Park', entities: [1, 8] },
  { source: 'github', type: 'pull_request', summary: 'James Park opened PR #142: Migrate auth endpoints to v2 API', entities: [1, 8] },
  { source: 'github', type: 'issue', summary: 'CloudScale Inc reported latency spike in production cluster', entities: [5] },
  { source: 'slack', type: 'message', summary: 'Sarah Chen mentioned Project Aurora deadline moved to next Friday', entities: [0, 6] },
  { source: 'slack', type: 'mention', summary: 'Team discussing Apex Corp integration requirements in #deals', entities: [4, 2] },
  { source: 'shopify', type: 'order', summary: '3 new enterprise orders from CloudScale Inc region', entities: [5] },
  { source: 'files', type: 'document_modified', summary: 'Q4 financial projections updated — revenue forecast revised up 12%', entities: [7] },
  { source: 'gmail', type: 'email_received', summary: 'CloudScale Inc requesting expedited onboarding for new contract', entities: [5] },
  { source: 'calendar', type: 'meeting', summary: 'Dinner with Maria Gonzalez at San Francisco — Apex Corp deal closing', entities: [2, 4, 9] },
  { source: 'github', type: 'push', summary: '14 commits pushed to main: API migration phase 2 complete', entities: [8] },
  { source: 'slack', type: 'message', summary: 'James Park flagged potential conflict between Aurora timeline and API migration', entities: [1, 6, 8] }
];

const DEMO_DISCOVERIES = [
  {
    type: 'connection',
    urgency: 'important',
    title: 'Nexus AI contract renewal coincides with Series B timeline',
    body: 'Sarah Chen sent a contract renewal for Project Aurora the same week as the Series B board meeting. The timing suggests Nexus AI may be positioning Aurora as a key metric for investors. Consider aligning the renewal terms with the fundraising narrative.\n\nSuggested action: Review Aurora deliverables before the board meeting to ensure alignment.',
    sources: ['gmail', 'calendar'],
    confidence: 0.85
  },
  {
    type: 'pattern',
    urgency: 'interesting',
    title: 'James Park is the bridge between Project Aurora and API Migration',
    body: 'James Park appears in both Aurora discussions and API migration work. He flagged a timeline conflict between these two initiatives. This single point of dependency could become a bottleneck.\n\nSuggested action: Consider staffing a second engineer on the API migration to reduce bus-factor risk.',
    sources: ['github', 'slack'],
    confidence: 0.78
  },
  {
    type: 'anomaly',
    urgency: 'urgent',
    title: 'CloudScale Inc activity spike — 3 signals in 24 hours',
    body: 'CloudScale Inc appeared in a production issue report, 3 new enterprise orders, and an expedited onboarding request all within the same day. This is unusual — they typically generate 1 event per week. Something significant may be happening at CloudScale.\n\nSuggested action: Reach out to CloudScale Inc proactively to understand the urgency behind the onboarding request.',
    sources: ['github', 'shopify', 'gmail'],
    confidence: 0.92
  },
  {
    type: 'insight',
    urgency: 'interesting',
    title: 'Apex Corp deal likely closing this week',
    body: 'Three converging signals: Maria Gonzalez email thread about partnership terms, team discussion in #deals about integration requirements, and a dinner meeting scheduled in San Francisco. The deal appears to be in its final stages.\n\nSuggested action: Prepare onboarding materials for Apex Corp to reduce time-to-value after close.',
    sources: ['gmail', 'slack', 'calendar'],
    confidence: 0.88
  }
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runDemo() {
  showBanner();
  console.log(chalk.hex('#FFB347').bold('  ▶ Demo Mode') + chalk.dim(' — Watch OWL analyze a simulated world\n'));

  const dbPath = ':memory:';
  const wm = new WorldModel(dbPath);

  // Step 1: Ingest entities
  const spinner = ora({ text: 'Connecting to data sources...', color: 'yellow' }).start();
  await sleep(800);
  spinner.succeed('Connected to 6 data sources');

  // Add entities
  const entityIds = [];
  const entitySpinner = ora({ text: 'Building world model...', color: 'yellow' }).start();
  for (const entity of DEMO_ENTITIES) {
    const id = crypto.randomUUID();
    entityIds.push(id);
    wm.upsertEntity({
      id,
      type: entity.type,
      name: entity.name,
      attributes: entity.attributes,
      sources: ['demo'],
      importance: 0.5 + Math.random() * 0.5
    });
    await sleep(100);
  }
  entitySpinner.succeed(`Tracked ${DEMO_ENTITIES.length} entities across your world`);

  // Add relationships
  const relSpinner = ora({ text: 'Mapping relationships...', color: 'yellow' }).start();
  wm.addRelationship({ fromEntity: entityIds[0], toEntity: entityIds[3], type: 'works_at', strength: 0.9 });
  wm.addRelationship({ fromEntity: entityIds[1], toEntity: entityIds[3], type: 'works_at', strength: 0.9 });
  wm.addRelationship({ fromEntity: entityIds[2], toEntity: entityIds[4], type: 'works_at', strength: 0.9 });
  wm.addRelationship({ fromEntity: entityIds[0], toEntity: entityIds[6], type: 'leads', strength: 0.8 });
  wm.addRelationship({ fromEntity: entityIds[1], toEntity: entityIds[8], type: 'leads', strength: 0.7 });
  wm.addRelationship({ fromEntity: entityIds[3], toEntity: entityIds[7], type: 'pursuing', strength: 0.6 });
  wm.addRelationship({ fromEntity: entityIds[4], toEntity: entityIds[3], type: 'partner_of', strength: 0.5 });
  await sleep(600);
  relSpinner.succeed('Mapped 7 relationships');

  // Add events
  const eventSpinner = ora({ text: 'Processing events from sources...', color: 'yellow' }).start();
  const baseTime = Date.now() - 3 * 86_400_000;
  for (let i = 0; i < DEMO_EVENTS.length; i++) {
    const ev = DEMO_EVENTS[i];
    wm.addEvent({
      id: crypto.randomUUID(),
      source: ev.source,
      type: ev.type,
      timestamp: new Date(baseTime + i * 3_600_000 * 2).toISOString(),
      summary: ev.summary,
      entities: ev.entities.map((idx) => entityIds[idx]),
      raw: {}
    });
    await sleep(80);
  }
  eventSpinner.succeed(`Processed ${DEMO_EVENTS.length} events from 6 sources`);

  // Run "discovery"
  console.log('');
  const discSpinner = ora({ text: chalk.bold('Running discovery engine...'), color: 'yellow' }).start();
  await sleep(1500);
  discSpinner.succeed(chalk.bold('Discovery engine found 4 insights'));
  console.log('');

  // Display discoveries
  for (const disc of DEMO_DISCOVERIES) {
    const urgencyColors = { urgent: '#EF4444', important: '#FFB347', interesting: '#22C55E' };
    const urgencyEmoji = { urgent: '🔴', important: '🟡', interesting: '🟢' };
    const color = urgencyColors[disc.urgency] || '#888';

    console.log(chalk.hex(color).bold(`  ${urgencyEmoji[disc.urgency]} ${disc.title}`));
    console.log(chalk.dim(`    ${disc.body.split('\n')[0]}`));
    console.log(chalk.dim(`    Sources: ${disc.sources.join(', ')}  •  Confidence: ${Math.round(disc.confidence * 100)}%`));
    console.log('');

    wm.addDiscovery({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      type: disc.type,
      urgency: disc.urgency,
      title: disc.title,
      body: disc.body,
      sources: disc.sources,
      entities: [],
      confidence: disc.confidence
    });

    await sleep(400);
  }

  // Show OWL Score
  const score = computeOwlScore(wm, {
    plugins: {
      gmail: { enabled: true },
      calendar: { enabled: true },
      github: { enabled: true },
      slack: { enabled: true },
      shopify: { enabled: true },
      files: { enabled: true }
    },
    maxDiscoveriesPerDay: 5,
    entityTarget: 10
  });
  console.log(formatOwlScore(score));
  console.log('');

  console.log(chalk.dim('  ─────────────────────────────────────────────'));
  console.log('');
  console.log(chalk.bold('  This is what OWL does with your real data.'));
  console.log(chalk.dim('  No dashboards. No prompting. Just discoveries that matter.'));
  console.log('');
  console.log(`  ${chalk.hex('#FFB347')('→')} Run ${chalk.bold('owl setup')} to connect your real sources`);
  console.log(`  ${chalk.hex('#FFB347')('→')} Run ${chalk.bold('owl start')} to begin watching your world`);
  console.log('');

  wm.close();
}
