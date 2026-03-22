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
    --card: #111118;
    --card-hover: #16161f;
    --border: #1e1e2e;
    --text: #e0e0e8;
    --dim: #666;
    --accent: #FFB347;
    --red: #EF4444;
    --yellow: #FBBF24;
    --green: #22C55E;
    --blue: #3B82F6;
    --purple: #A855F7;
    --cyan: #06B6D4;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--bg); color:var(--text); font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; overflow-x:hidden; }
  ::-webkit-scrollbar { width:6px; } ::-webkit-scrollbar-track { background:var(--bg); } ::-webkit-scrollbar-thumb { background:var(--border); border-radius:3px; }

  /* Header */
  .header {
    display:flex; align-items:center; justify-content:space-between;
    padding:14px 24px; border-bottom:1px solid var(--border);
    background:linear-gradient(180deg, rgba(255,179,71,0.03) 0%, transparent 100%);
  }
  .header-left { display:flex; align-items:center; gap:16px; }
  .header h1 { font-size:1.3rem; color:var(--accent); letter-spacing:-0.02em; }
  .header h1 span { color:var(--dim); font-weight:400; font-size:0.8rem; margin-left:8px; }
  .search-box {
    background:var(--card); border:1px solid var(--border); border-radius:8px;
    padding:6px 12px; color:var(--text); font-size:0.85rem; width:240px; outline:none;
    transition:border-color 0.2s;
  }
  .search-box:focus { border-color:var(--accent); }
  .search-box::placeholder { color:var(--dim); }
  .score-badge {
    display:flex; align-items:center; gap:10px;
    padding:6px 18px; border-radius:20px; font-weight:600;
    background:var(--card); border:1px solid var(--border);
  }
  .score-ring { position:relative; width:36px; height:36px; }
  .score-ring svg { transform:rotate(-90deg); }
  .score-ring .value { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); font-size:0.7rem; font-weight:700; }

  /* Layout */
  .main { display:grid; grid-template-columns:1fr 360px; grid-template-rows:1fr; height:calc(100vh - 56px); }
  .left-col { display:flex; flex-direction:column; overflow:hidden; }
  .right-col { display:flex; flex-direction:column; border-left:1px solid var(--border); overflow:hidden; }

  .graph-area { flex:1; position:relative; min-height:0; }
  .bottom-bar { display:grid; grid-template-columns:1fr 1fr 1fr; gap:1px; border-top:1px solid var(--border); height:220px; }
  .bottom-panel { background:var(--card); padding:12px 16px; overflow-y:auto; }

  .panel-header { font-size:0.75rem; text-transform:uppercase; letter-spacing:0.06em; color:var(--dim); margin-bottom:10px; font-weight:600; display:flex; justify-content:space-between; align-items:center; }
  .panel-count { background:var(--border); padding:1px 8px; border-radius:10px; font-size:0.7rem; }

  /* Graph */
  #graph { width:100%; height:100%; }
  #graph svg { width:100%; height:100%; }
  .link { stroke-opacity:0.25; }
  .link:hover { stroke-opacity:0.6; }
  .node circle { cursor:pointer; transition:r 0.15s; }
  .node text { fill:var(--text); font-size:9px; pointer-events:none; font-weight:500; opacity:0.8; }
  .node:hover circle { filter:brightness(1.3); }
  .node.selected circle { stroke:var(--accent) !important; stroke-width:3 !important; }
  .node.dimmed { opacity:0.15; }
  .link.dimmed { stroke-opacity:0.04; }

  /* Graph legend */
  .graph-legend {
    position:absolute; bottom:12px; left:12px; display:flex; gap:12px;
    background:rgba(10,10,15,0.85); padding:6px 12px; border-radius:6px; font-size:0.7rem;
    border:1px solid var(--border); backdrop-filter:blur(8px);
  }
  .legend-item { display:flex; align-items:center; gap:4px; color:var(--dim); }
  .legend-dot { width:8px; height:8px; border-radius:50%; }

  /* Graph controls */
  .graph-controls {
    position:absolute; top:12px; right:12px; display:flex; gap:6px;
  }
  .graph-btn {
    background:rgba(10,10,15,0.85); border:1px solid var(--border); border-radius:6px;
    padding:4px 10px; color:var(--dim); font-size:0.7rem; cursor:pointer;
    backdrop-filter:blur(8px); transition:color 0.15s, border-color 0.15s;
  }
  .graph-btn:hover, .graph-btn.active { color:var(--accent); border-color:var(--accent); }

  /* Discovery list */
  .disc-scroll { flex:1; overflow-y:auto; padding:0 16px 16px; }
  .disc-item {
    padding:12px; border-radius:8px; margin-bottom:8px; cursor:pointer;
    background:var(--card); border:1px solid var(--border); border-left:3px solid var(--dim);
    transition:background 0.15s, border-color 0.15s;
  }
  .disc-item:hover { background:var(--card-hover); border-color:rgba(255,179,71,0.3); }
  .disc-item.urgent { border-left-color:var(--red); }
  .disc-item.important { border-left-color:var(--yellow); }
  .disc-item.interesting { border-left-color:var(--green); }
  .disc-title { font-weight:600; font-size:0.85rem; margin-bottom:4px; line-height:1.3; }
  .disc-body { font-size:0.78rem; color:var(--dim); margin:6px 0; line-height:1.4; display:none; }
  .disc-item.expanded .disc-body { display:block; }
  .disc-meta { font-size:0.7rem; color:var(--dim); display:flex; gap:8px; flex-wrap:wrap; }
  .disc-tag { background:var(--border); padding:1px 6px; border-radius:4px; font-size:0.65rem; }
  .conf-bar { display:inline-block; width:40px; height:4px; border-radius:2px; background:var(--border); vertical-align:middle; margin-left:4px; overflow:hidden; }
  .conf-fill { height:100%; border-radius:2px; }

  /* Entity detail sidebar */
  .entity-detail { padding:16px; display:none; overflow-y:auto; flex:1; }
  .entity-detail.visible { display:block; }
  .entity-detail h3 { font-size:1rem; margin-bottom:2px; }
  .entity-type { color:var(--dim); font-size:0.8rem; margin-bottom:12px; text-transform:capitalize; }
  .detail-section { margin-bottom:16px; }
  .detail-section h4 { font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em; color:var(--dim); margin-bottom:8px; }
  .rel-item { padding:4px 0; font-size:0.8rem; border-bottom:1px solid var(--border); }
  .rel-arrow { color:var(--accent); margin:0 4px; }
  .attr-row { font-size:0.8rem; padding:2px 0; }
  .attr-key { color:var(--dim); }
  .close-detail { float:right; background:none; border:none; color:var(--dim); cursor:pointer; font-size:1.1rem; }
  .close-detail:hover { color:var(--text); }

  /* Stats */
  .stat-grid { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
  .stat-item { text-align:center; padding:6px; background:rgba(255,255,255,0.02); border-radius:6px; }
  .stat-value { font-size:1.4rem; font-weight:700; color:var(--accent); }
  .stat-label { font-size:0.65rem; color:var(--dim); text-transform:uppercase; letter-spacing:0.03em; }

  /* Events */
  .event-item { padding:5px 0; border-bottom:1px solid rgba(255,255,255,0.03); font-size:0.78rem; line-height:1.3; }
  .event-source { display:inline-block; padding:1px 5px; border-radius:3px; font-size:0.65rem; font-weight:600; margin-right:4px; }
  .event-source.gmail { background:rgba(234,67,53,0.15); color:#EA4335; }
  .event-source.calendar { background:rgba(66,133,244,0.15); color:#4285F4; }
  .event-source.github { background:rgba(168,85,247,0.15); color:#A855F7; }
  .event-source.slack { background:rgba(224,30,90,0.15); color:#E01E5A; }
  .event-source.shopify { background:rgba(150,191,72,0.15); color:#96BF48; }
  .event-source.files { background:rgba(255,179,71,0.15); color:#FFB347; }
  .event-time { color:var(--dim); font-size:0.65rem; }

  /* Situations */
  .sit-item { padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.03); font-size:0.8rem; }
  .sit-urgency { display:inline-block; width:6px; height:6px; border-radius:50%; margin-right:6px; vertical-align:middle; }
  .sit-urgency.urgent { background:var(--red); } .sit-urgency.important { background:var(--yellow); } .sit-urgency.interesting { background:var(--green); }

  /* Source filter */
  .source-filters { display:flex; gap:4px; flex-wrap:wrap; margin-bottom:8px; }
  .source-filter {
    padding:2px 8px; border-radius:4px; font-size:0.65rem; cursor:pointer;
    background:var(--border); color:var(--dim); border:1px solid transparent;
    transition:all 0.15s;
  }
  .source-filter.active { border-color:var(--accent); color:var(--accent); }

  /* Loading & empty */
  .loading { text-align:center; padding:30px; color:var(--dim); font-size:0.85rem; }
  .empty-state { text-align:center; padding:40px 20px; color:var(--dim); }
  .empty-state p { margin-top:8px; font-size:0.8rem; }

  /* Tooltip */
  .tooltip {
    position:fixed; background:var(--card); border:1px solid var(--accent);
    border-radius:8px; padding:10px 14px; font-size:0.78rem; pointer-events:none;
    opacity:0; transition:opacity 0.1s; z-index:1000; max-width:280px;
    box-shadow:0 4px 20px rgba(0,0,0,0.5);
  }
  .tooltip.visible { opacity:1; }
  .tooltip strong { color:var(--accent); }
  .tooltip .tt-type { color:var(--dim); font-size:0.7rem; }
  .tooltip .tt-sources { color:var(--dim); font-size:0.65rem; margin-top:4px; }

  @media (max-width:900px) {
    .main { grid-template-columns:1fr; }
    .right-col { display:none; }
    .bottom-bar { grid-template-columns:1fr; height:auto; }
  }
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <h1>OWL<span>Dashboard</span></h1>
    <input class="search-box" id="search" placeholder="Search entities..." autocomplete="off">
  </div>
  <div class="score-badge" id="score-badge">
    <div class="score-ring" id="score-ring"></div>
    <span id="score-label">Loading...</span>
  </div>
</div>

<div class="main">
  <div class="left-col">
    <div class="graph-area">
      <div id="graph"></div>
      <div class="graph-legend" id="legend"></div>
      <div class="graph-controls">
        <button class="graph-btn active" data-filter="all">All</button>
        <button class="graph-btn" data-filter="person">People</button>
        <button class="graph-btn" data-filter="company">Companies</button>
        <button class="graph-btn" data-filter="project">Projects</button>
      </div>
    </div>
    <div class="bottom-bar">
      <div class="bottom-panel" id="stats-panel">
        <div class="panel-header">World Model</div>
        <div id="stats"><div class="loading">Loading...</div></div>
      </div>
      <div class="bottom-panel" id="events-panel">
        <div class="panel-header">Recent Events <span class="panel-count" id="event-count">0</span></div>
        <div class="source-filters" id="source-filters"></div>
        <div id="events"><div class="loading">Loading...</div></div>
      </div>
      <div class="bottom-panel" id="situations-panel">
        <div class="panel-header">Active Situations <span class="panel-count" id="sit-count">0</span></div>
        <div id="situations"><div class="loading">Loading...</div></div>
      </div>
    </div>
  </div>

  <div class="right-col">
    <div style="padding:12px 16px; border-bottom:1px solid var(--border);">
      <div class="panel-header" style="margin:0">Discoveries <span class="panel-count" id="disc-count">0</span></div>
    </div>
    <div class="disc-scroll" id="discoveries"></div>
    <div class="entity-detail" id="entity-detail"></div>
  </div>
</div>

<div class="tooltip" id="tooltip"></div>

<script>
const API = '';
const typeColors = { person:'#3B82F6', company:'#A855F7', project:'#22C55E', topic:'#FFB347', location:'#EF4444', unknown:'#555' };
const sourceColors = { gmail:'#EA4335', calendar:'#4285F4', github:'#A855F7', slack:'#E01E5A', shopify:'#96BF48', files:'#FFB347' };
let graphData = null, simulation = null, selectedNode = null, activeFilter = 'all', activeSourceFilter = null;
let allEvents = [];

async function fetchJSON(url) { const r = await fetch(API + url); return r.json(); }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ── Score ring ──
function renderScoreRing(total) {
  const ring = document.getElementById('score-ring');
  const pct = total / 100;
  const r = 14, c = Math.PI * 2 * r;
  let color = '#EF4444';
  if (total >= 80) color = '#22C55E'; else if (total >= 60) color = '#FFB347'; else if (total >= 40) color = '#FBBF24'; else if (total >= 20) color = '#F97316';
  ring.innerHTML = \`<svg width="36" height="36"><circle cx="18" cy="18" r="\${r}" fill="none" stroke="var(--border)" stroke-width="3"/><circle cx="18" cy="18" r="\${r}" fill="none" stroke="\${color}" stroke-width="3" stroke-dasharray="\${c * pct} \${c * (1-pct)}" stroke-linecap="round"/></svg><div class="value" style="color:\${color}">\${total}</div>\`;
  let label = 'Sleeping';
  if (total >= 80) label = 'Excellent'; else if (total >= 60) label = 'Good'; else if (total >= 40) label = 'Growing'; else if (total >= 20) label = 'Waking';
  document.getElementById('score-label').textContent = label;
}

// ── Stats ──
async function loadStats() {
  const data = await fetchJSON('/api/stats');
  renderScoreRing(data.score.total);
  const st = data.stats;
  document.getElementById('stats').innerHTML = \`
    <div class="stat-grid">
      <div class="stat-item"><div class="stat-value">\${st.entities}</div><div class="stat-label">Entities</div></div>
      <div class="stat-item"><div class="stat-value">\${st.events}</div><div class="stat-label">Events</div></div>
      <div class="stat-item"><div class="stat-value">\${st.discoveries}</div><div class="stat-label">Discoveries</div></div>
      <div class="stat-item"><div class="stat-value">\${st.situations}</div><div class="stat-label">Situations</div></div>
    </div>\`;
}

// ── Discoveries ──
async function loadDiscoveries() {
  const data = await fetchJSON('/api/discoveries?days=30');
  const el = document.getElementById('discoveries');
  document.getElementById('disc-count').textContent = data.length;
  if (!data.length) { el.innerHTML = '<div class="empty-state"><p>No discoveries yet.<br>Run <code>owl start</code> to begin.</p></div>'; return; }
  el.innerHTML = data.map(d => {
    const conf = Math.round((d.confidence||0)*100);
    const confColor = conf >= 80 ? 'var(--green)' : conf >= 60 ? 'var(--yellow)' : 'var(--red)';
    return \`<div class="disc-item \${d.urgency}" onclick="this.classList.toggle('expanded')">
      <div class="disc-title">\${esc(d.title)}</div>
      <div class="disc-body">\${esc(d.body || '')}</div>
      <div class="disc-meta">
        <span class="disc-tag">\${d.type}</span>
        \${(d.sources||[]).map(s => '<span class="disc-tag">'+s+'</span>').join('')}
        <span>\${d.timestamp?.slice(0,10)||''}</span>
        <span>\${conf}% <span class="conf-bar"><span class="conf-fill" style="width:\${conf}%;background:\${confColor}"></span></span></span>
      </div>
    </div>\`;
  }).join('');
}

// ── Events ──
async function loadEvents() {
  allEvents = await fetchJSON('/api/events?days=7');
  document.getElementById('event-count').textContent = allEvents.length;

  // Build source filters
  const sources = [...new Set(allEvents.map(e => e.source))];
  document.getElementById('source-filters').innerHTML =
    '<span class="source-filter active" data-src="all">All</span>' +
    sources.map(s => \`<span class="source-filter" data-src="\${s}">\${s}</span>\`).join('');

  document.querySelectorAll('.source-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.source-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeSourceFilter = btn.dataset.src === 'all' ? null : btn.dataset.src;
      renderEvents();
    });
  });
  renderEvents();
}

function renderEvents() {
  const filtered = activeSourceFilter ? allEvents.filter(e => e.source === activeSourceFilter) : allEvents;
  const el = document.getElementById('events');
  if (!filtered.length) { el.innerHTML = '<div class="loading">No events</div>'; return; }
  el.innerHTML = filtered.slice(0,40).map(e => \`
    <div class="event-item">
      <span class="event-source \${e.source}">\${e.source}</span>
      \${esc((e.summary||'').slice(0,70))}
      <span class="event-time">\${e.timestamp?.slice(11,16)||''}</span>
    </div>\`).join('');
}

// ── Situations ──
async function loadSituations() {
  const data = await fetchJSON('/api/situations');
  document.getElementById('sit-count').textContent = data.length;
  const el = document.getElementById('situations');
  if (!data.length) { el.innerHTML = '<div class="loading">No active situations</div>'; return; }
  el.innerHTML = data.map(s => \`
    <div class="sit-item">
      <span class="sit-urgency \${s.urgency}"></span>
      \${esc(s.description || '')}
    </div>\`).join('');
}

// ── Entity Detail Sidebar ──
function showEntityDetail(entityId) {
  fetch(API + '/api/entities?days=90').then(r=>r.json()).then(entities => {
    const entity = entities.find(e => e.id === entityId);
    if (!entity) return;
    const el = document.getElementById('entity-detail');
    const discEl = document.getElementById('discoveries');

    // Fetch relationships via graph data
    const rels = (graphData?.edges || []).filter(e => e.source?.id === entityId || e.target?.id === entityId || e.source === entityId || e.target === entityId);
    const attrs = entity.attributes || {};

    el.innerHTML = \`
      <button class="close-detail" onclick="hideEntityDetail()">&times;</button>
      <h3>\${esc(entity.name)}</h3>
      <div class="entity-type">\${entity.type} · Sources: \${(entity.sources||[]).join(', ')}</div>
      \${Object.keys(attrs).length ? '<div class="detail-section"><h4>Attributes</h4>' + Object.entries(attrs).map(([k,v]) => '<div class="attr-row"><span class="attr-key">'+esc(k)+':</span> '+esc(String(v))+'</div>').join('') + '</div>' : ''}
      <div class="detail-section">
        <h4>Connections (\${rels.length})</h4>
        \${rels.length ? rels.slice(0,15).map(r => {
          const other = (r.source?.id||r.source) === entityId ? r.target : r.source;
          const name = other?.name || other;
          return '<div class="rel-item"><span class="rel-arrow">\u2192</span> ' + esc(String(r.type||'related')) + ' <strong>' + esc(String(name)) + '</strong></div>';
        }).join('') : '<div style="color:var(--dim);font-size:0.8rem">No connections yet</div>'}
      </div>
      <div class="detail-section">
        <h4>Timeline</h4>
        <div style="color:var(--dim);font-size:0.78rem">First seen: \${entity.first_seen?.slice(0,10)||'?'}<br>Last seen: \${entity.last_seen?.slice(0,10)||'?'}</div>
      </div>\`;
    el.classList.add('visible');
    discEl.style.display = 'none';
  });
}

function hideEntityDetail() {
  document.getElementById('entity-detail').classList.remove('visible');
  document.getElementById('discoveries').style.display = '';
  deselectNode();
}

// ── Graph ──
async function loadGraph() {
  graphData = await fetchJSON('/api/graph');
  const container = document.getElementById('graph');
  container.innerHTML = '';

  // Legend
  document.getElementById('legend').innerHTML = Object.entries(typeColors).filter(([k])=>k!=='unknown').map(([k,c]) =>
    \`<div class="legend-item"><div class="legend-dot" style="background:\${c}"></div>\${k}</div>\`
  ).join('');

  if (!graphData.nodes?.length) {
    container.innerHTML = '<div class="empty-state" style="padding-top:120px"><h3 style="color:var(--accent)">No graph data yet</h3><p>Run <code>owl start</code> to watch your world</p></div>';
    return;
  }

  const width = container.clientWidth;
  const height = container.clientHeight || 500;

  const svg = d3.select(container).append('svg').attr('viewBox', [0,0,width,height]);

  // Glow filter
  const defs = svg.append('defs');
  const filter = defs.append('filter').attr('id','glow');
  filter.append('feGaussianBlur').attr('stdDeviation','3').attr('result','blur');
  filter.append('feMerge').selectAll('feMergeNode').data(['blur','SourceGraphic']).join('feMergeNode').attr('in', d=>d);

  const g = svg.append('g');

  // Zoom
  const zoom = d3.zoom().scaleExtent([0.3,5]).on('zoom', (e) => g.attr('transform', e.transform));
  svg.call(zoom);

  simulation = d3.forceSimulation(graphData.nodes)
    .force('link', d3.forceLink(graphData.edges).id(d=>d.id).distance(90).strength(d=>(d.strength||0.5)*0.4))
    .force('charge', d3.forceManyBody().strength(-250))
    .force('center', d3.forceCenter(width/2, height/2))
    .force('collision', d3.forceCollide().radius(35));

  const link = g.append('g').selectAll('line').data(graphData.edges).join('line')
    .attr('class','link').attr('stroke', d => typeColors[d.type] || '#333')
    .attr('stroke-width', d => Math.max(0.5, (d.strength||0.5)*2.5));

  const node = g.append('g').selectAll('g').data(graphData.nodes).join('g').attr('class','node')
    .call(d3.drag()
      .on('start',(e,d)=>{if(!e.active) simulation.alphaTarget(0.3).restart(); d.fx=d.x; d.fy=d.y;})
      .on('drag',(e,d)=>{d.fx=e.x; d.fy=e.y;})
      .on('end',(e,d)=>{if(!e.active) simulation.alphaTarget(0); d.fx=null; d.fy=null;})
    );

  node.append('circle')
    .attr('r', d => 5 + (d.importance||0.5)*10)
    .attr('fill', d => typeColors[d.type]||typeColors.unknown)
    .attr('stroke', d => typeColors[d.type]||typeColors.unknown)
    .attr('stroke-width', 1.5)
    .attr('stroke-opacity', 0.3)
    .attr('filter','url(#glow)');

  node.append('text').text(d=>d.name).attr('dx',d=>8+(d.importance||0.5)*10).attr('dy',3);

  // Tooltip
  const tooltip = document.getElementById('tooltip');
  node.on('mouseover',(e,d) => {
    const connCount = graphData.edges.filter(edge => (edge.source?.id||edge.source)===d.id || (edge.target?.id||edge.target)===d.id).length;
    tooltip.innerHTML = \`<strong>\${esc(d.name)}</strong><div class="tt-type">\${d.type}</div><div class="tt-sources">\${connCount} connections</div>\`;
    tooltip.classList.add('visible');
  }).on('mousemove',(e)=>{
    tooltip.style.left=(e.clientX+14)+'px'; tooltip.style.top=(e.clientY-10)+'px';
  }).on('mouseout',()=>tooltip.classList.remove('visible'));

  // Click to select & show detail
  node.on('click',(e,d) => {
    e.stopPropagation();
    selectNode(d, node, link);
    showEntityDetail(d.id);
  });

  svg.on('click', () => { deselectNode(); hideEntityDetail(); });

  simulation.on('tick',()=>{
    link.attr('x1',d=>d.source.x).attr('y1',d=>d.source.y).attr('x2',d=>d.target.x).attr('y2',d=>d.target.y);
    node.attr('transform',d=>\`translate(\${d.x},\${d.y})\`);
  });

  // Filter buttons
  document.querySelectorAll('.graph-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.graph-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      node.classed('dimmed', d => activeFilter !== 'all' && d.type !== activeFilter);
      link.classed('dimmed', d => {
        if (activeFilter === 'all') return false;
        const sType = d.source?.type; const tType = d.target?.type;
        return sType !== activeFilter && tType !== activeFilter;
      });
    });
  });

  // Search
  document.getElementById('search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    if (!q) { node.classed('dimmed',false); link.classed('dimmed',false); return; }
    node.classed('dimmed', d => !d.name.toLowerCase().includes(q));
    link.classed('dimmed', d => {
      const sName = (d.source?.name||'').toLowerCase();
      const tName = (d.target?.name||'').toLowerCase();
      return !sName.includes(q) && !tName.includes(q);
    });
  });
}

function selectNode(d, nodeSelection, linkSelection) {
  selectedNode = d.id;
  const neighbors = new Set();
  graphData.edges.forEach(e => {
    const sid = e.source?.id||e.source; const tid = e.target?.id||e.target;
    if (sid===d.id) neighbors.add(tid);
    if (tid===d.id) neighbors.add(sid);
  });
  neighbors.add(d.id);
  nodeSelection.classed('dimmed', n => !neighbors.has(n.id)).classed('selected', n => n.id===d.id);
  linkSelection.classed('dimmed', e => {
    const sid = e.source?.id||e.source; const tid = e.target?.id||e.target;
    return sid!==d.id && tid!==d.id;
  });
}

function deselectNode() {
  selectedNode = null;
  d3.selectAll('.node').classed('dimmed',false).classed('selected',false);
  d3.selectAll('.link').classed('dimmed',false);
}

// ── Init ──
Promise.all([loadStats(), loadDiscoveries(), loadEvents(), loadSituations(), loadGraph()]);
setInterval(()=>{ loadStats(); loadDiscoveries(); loadEvents(); loadSituations(); }, 60000);
<\/script>
</body>
</html>`;
}
