export function getDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OWL Dashboard</title>
<script src="https://d3js.org/d3.v7.min.js"><\/script>
<style>
  :root {
    --bg: #0a0a0f;
    --card: #12121a;
    --border: #1e1e2e;
    --text: #e0e0e8;
    --dim: #888;
    --accent: #FFB347;
    --red: #EF4444;
    --yellow: #FBBF24;
    --green: #22C55E;
    --blue: #3B82F6;
    --purple: #A855F7;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; overflow-x:hidden; }

  .header {
    display:flex; align-items:center; justify-content:space-between;
    padding:16px 24px; border-bottom:1px solid var(--border);
  }
  .header h1 { font-size:1.4rem; color:var(--accent); }
  .header .score-badge {
    display:flex; align-items:center; gap:8px;
    padding:6px 16px; border-radius:20px; font-weight:600;
    background:var(--card); border:1px solid var(--border);
  }

  .grid {
    display:grid; grid-template-columns:1fr 1fr;
    grid-template-rows:auto auto; gap:16px; padding:16px 24px;
  }
  .graph-panel { grid-column:1; grid-row:1/3; min-height:500px; }
  .discovery-panel { grid-column:2; grid-row:1; max-height:400px; overflow-y:auto; }
  .bottom-row { grid-column:2; grid-row:2; display:grid; grid-template-columns:1fr 1fr; gap:16px; }

  .panel {
    background:var(--card); border:1px solid var(--border); border-radius:12px;
    padding:16px; position:relative;
  }
  .panel h2 { font-size:0.85rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--dim); margin-bottom:12px; }

  /* Graph */
  #graph { width:100%; height:100%; min-height:460px; }
  #graph svg { width:100%; height:100%; }
  .node circle { cursor:pointer; stroke:var(--border); stroke-width:1.5; }
  .node text { fill:var(--text); font-size:10px; pointer-events:none; }
  .link { stroke:var(--border); stroke-opacity:0.4; }
  .node:hover circle { stroke:var(--accent); stroke-width:2; }

  /* Discoveries */
  .disc-item {
    padding:10px 12px; border-radius:8px; margin-bottom:8px;
    background:rgba(255,255,255,0.02); border-left:3px solid var(--dim);
  }
  .disc-item.urgent { border-left-color:var(--red); }
  .disc-item.important { border-left-color:var(--yellow); }
  .disc-item.interesting { border-left-color:var(--green); }
  .disc-title { font-weight:600; font-size:0.9rem; margin-bottom:4px; }
  .disc-meta { font-size:0.75rem; color:var(--dim); }

  /* Stats */
  .stat-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .stat-item { text-align:center; padding:8px; }
  .stat-value { font-size:1.6rem; font-weight:700; color:var(--accent); }
  .stat-label { font-size:0.7rem; color:var(--dim); text-transform:uppercase; }

  /* Events */
  .event-list { max-height:200px; overflow-y:auto; }
  .event-item { padding:6px 0; border-bottom:1px solid var(--border); font-size:0.8rem; }
  .event-source { display:inline-block; padding:1px 6px; border-radius:4px; font-size:0.7rem; font-weight:600; margin-right:6px; }
  .event-source.gmail { background:rgba(234,67,53,0.2); color:#EA4335; }
  .event-source.calendar { background:rgba(66,133,244,0.2); color:#4285F4; }
  .event-source.github { background:rgba(168,85,247,0.2); color:#A855F7; }
  .event-source.slack { background:rgba(74,21,75,0.2); color:#E01E5A; }
  .event-source.shopify { background:rgba(150,191,72,0.2); color:#96BF48; }
  .event-source.files { background:rgba(255,179,71,0.2); color:#FFB347; }

  /* Score bar */
  .score-bar { display:flex; gap:2px; height:6px; border-radius:3px; overflow:hidden; margin-top:8px; }
  .score-segment { height:100%; border-radius:1px; }

  /* Entity tooltip */
  .tooltip {
    position:absolute; background:var(--card); border:1px solid var(--accent);
    border-radius:8px; padding:10px 14px; font-size:0.8rem; pointer-events:none;
    opacity:0; transition:opacity 0.15s; z-index:100; max-width:250px;
  }
  .tooltip.visible { opacity:1; }

  /* Loading */
  .loading { text-align:center; padding:40px; color:var(--dim); }

  @media (max-width:900px) {
    .grid { grid-template-columns:1fr; }
    .graph-panel { grid-column:1; grid-row:1; min-height:300px; }
    .discovery-panel { grid-column:1; grid-row:2; }
    .bottom-row { grid-column:1; grid-row:3; }
  }
</style>
</head>
<body>

<div class="header">
  <h1>🦉 OWL Dashboard</h1>
  <div class="score-badge" id="score-badge">Loading...</div>
</div>

<div class="grid">
  <div class="panel graph-panel">
    <h2>Knowledge Graph</h2>
    <div id="graph"><div class="loading">Loading graph...</div></div>
  </div>

  <div class="panel discovery-panel">
    <h2>Recent Discoveries</h2>
    <div id="discoveries"><div class="loading">Loading...</div></div>
  </div>

  <div class="bottom-row">
    <div class="panel">
      <h2>World Model</h2>
      <div id="stats"><div class="loading">Loading...</div></div>
    </div>
    <div class="panel">
      <h2>Recent Events</h2>
      <div id="events" class="event-list"><div class="loading">Loading...</div></div>
    </div>
  </div>
</div>

<div class="tooltip" id="tooltip"></div>

<script>
const API = '';
const typeColors = {
  person: '#3B82F6', company: '#A855F7', project: '#22C55E',
  topic: '#FFB347', location: '#EF4444', unknown: '#888'
};

async function fetchJSON(url) {
  const res = await fetch(API + url);
  return res.json();
}

// ─── Score ───
async function loadScore() {
  const data = await fetchJSON('/api/stats');
  const s = data.score;
  const badge = document.getElementById('score-badge');
  let color = '#EF4444';
  if (s.total >= 80) color = '#22C55E';
  else if (s.total >= 60) color = '#FFB347';
  else if (s.total >= 40) color = '#FBBF24';
  else if (s.total >= 20) color = '#F97316';
  badge.innerHTML = \`<span style="color:\${color};font-size:1.3rem">\${s.total}</span><span style="color:var(--dim)">/100</span> OWL Score\`;

  // Stats
  const st = data.stats;
  document.getElementById('stats').innerHTML = \`
    <div class="stat-grid">
      <div class="stat-item"><div class="stat-value">\${st.entities}</div><div class="stat-label">Entities</div></div>
      <div class="stat-item"><div class="stat-value">\${st.events}</div><div class="stat-label">Events</div></div>
      <div class="stat-item"><div class="stat-value">\${st.discoveries}</div><div class="stat-label">Discoveries</div></div>
      <div class="stat-item"><div class="stat-value">\${st.situations}</div><div class="stat-label">Situations</div></div>
    </div>
    <div class="score-bar">
      <div class="score-segment" style="flex:\${s.breakdown.freshness};background:#3B82F6" title="Freshness \${s.breakdown.freshness}/25"></div>
      <div class="score-segment" style="flex:\${s.breakdown.coverage};background:#A855F7" title="Coverage \${s.breakdown.coverage}/20"></div>
      <div class="score-segment" style="flex:\${s.breakdown.discoveryRate};background:#22C55E" title="Discoveries \${s.breakdown.discoveryRate}/20"></div>
      <div class="score-segment" style="flex:\${s.breakdown.feedbackLoop};background:#FFB347" title="Feedback \${s.breakdown.feedbackLoop}/15"></div>
      <div class="score-segment" style="flex:\${s.breakdown.sourceDiversity};background:#EF4444" title="Sources \${s.breakdown.sourceDiversity}/10"></div>
      <div class="score-segment" style="flex:\${s.breakdown.health};background:#FBBF24" title="Health \${s.breakdown.health}/10"></div>
    </div>
  \`;
}

// ─── Discoveries ───
async function loadDiscoveries() {
  const data = await fetchJSON('/api/discoveries?days=14');
  const el = document.getElementById('discoveries');
  if (!data.length) { el.innerHTML = '<div class="loading">No discoveries yet</div>'; return; }
  el.innerHTML = data.map(d => \`
    <div class="disc-item \${d.urgency}">
      <div class="disc-title">\${esc(d.title)}</div>
      <div class="disc-meta">\${d.type} · \${d.sources?.join(', ') || ''} · \${d.timestamp?.slice(0,10) || ''} · \${Math.round((d.confidence||0)*100)}%</div>
    </div>
  \`).join('');
}

// ─── Events ───
async function loadEvents() {
  const data = await fetchJSON('/api/events?days=7');
  const el = document.getElementById('events');
  if (!data.length) { el.innerHTML = '<div class="loading">No events yet</div>'; return; }
  el.innerHTML = data.slice(0, 30).map(e => \`
    <div class="event-item">
      <span class="event-source \${e.source}">\${e.source}</span>
      \${esc(e.summary?.slice(0,80) || '')}
    </div>
  \`).join('');
}

// ─── Graph ───
async function loadGraph() {
  const data = await fetchJSON('/api/graph');
  const container = document.getElementById('graph');
  container.innerHTML = '';

  if (!data.nodes || data.nodes.length === 0) {
    container.innerHTML = '<div class="loading">No graph data yet. Run owl start to begin.</div>';
    return;
  }

  const width = container.clientWidth;
  const height = container.clientHeight || 460;

  const svg = d3.select(container).append('svg')
    .attr('viewBox', [0, 0, width, height]);

  const simulation = d3.forceSimulation(data.nodes)
    .force('link', d3.forceLink(data.edges).id(d => d.id).distance(80).strength(d => d.strength * 0.5))
    .force('charge', d3.forceManyBody().strength(-200))
    .force('center', d3.forceCenter(width/2, height/2))
    .force('collision', d3.forceCollide().radius(30));

  const link = svg.append('g')
    .selectAll('line')
    .data(data.edges)
    .join('line')
    .attr('class', 'link')
    .attr('stroke-width', d => Math.max(1, d.strength * 3));

  const node = svg.append('g')
    .selectAll('g')
    .data(data.nodes)
    .join('g')
    .attr('class', 'node')
    .call(d3.drag()
      .on('start', (e,d) => { if(!e.active) simulation.alphaTarget(0.3).restart(); d.fx=d.x; d.fy=d.y; })
      .on('drag', (e,d) => { d.fx=e.x; d.fy=e.y; })
      .on('end', (e,d) => { if(!e.active) simulation.alphaTarget(0); d.fx=null; d.fy=null; })
    );

  node.append('circle')
    .attr('r', d => 6 + (d.importance || 0.5) * 10)
    .attr('fill', d => typeColors[d.type] || typeColors.unknown);

  node.append('text')
    .text(d => d.name)
    .attr('dx', d => 8 + (d.importance || 0.5) * 10)
    .attr('dy', 3);

  // Tooltip
  const tooltip = document.getElementById('tooltip');
  node.on('mouseover', (e, d) => {
    tooltip.innerHTML = \`<strong>\${esc(d.name)}</strong><br><span style="color:var(--dim)">\${d.type}</span>\`;
    tooltip.classList.add('visible');
  }).on('mousemove', (e) => {
    tooltip.style.left = (e.pageX + 12) + 'px';
    tooltip.style.top = (e.pageY - 20) + 'px';
  }).on('mouseout', () => {
    tooltip.classList.remove('visible');
  });

  simulation.on('tick', () => {
    link
      .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
    node.attr('transform', d => \`translate(\${d.x},\${d.y})\`);
  });
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ─── Init ───
Promise.all([loadScore(), loadDiscoveries(), loadEvents(), loadGraph()]);

// Auto-refresh every 60s
setInterval(() => { loadScore(); loadDiscoveries(); loadEvents(); }, 60000);
</script>
</body>
</html>`;
}
