/**
 * app.js — Dijkstra SPF Visualiser  (25CS044)
 * ============================================
 * Sections:
 *   1. CONFIG          — default network topology (edit here)
 *   2. STATE           — all mutable runtime state
 *   3. DIJKSTRA        — core algorithm + step recorder
 *   4. BRUTE FORCE     — simple-path enumerator for verification
 *   5. SVG RENDERER    — draw/update the network graph
 *   6. TABLE UPDATER   — sync distance / pred / queue tables
 *   7. LOG             — step-log panel helpers
 *   8. ANIMATION       — play / pause / step controls
 *   9. EXPERIMENT      — before/after comparison
 *  10. SWEEP           — cost-sweep chart (Chart.js)
 *  11. EXPORT          — CSV / JSON / PNG / SVG helpers
 *  12. EDGE EDITOR     — modal for editing edge costs
 *  13. INIT            — wire everything together on load
 */

'use strict';

/* ═══════════════════════════════════════════════════════════
   1. CONFIG — default network (editable / importable)
   ═══════════════════════════════════════════════════════════ */

/**
 * defaultConfig: the canonical starting network.
 * edges: undirected; each edge stored once with u < v alphabetically.
 * nodePositions: SVG coords inside a 560×400 viewBox.
 */
const defaultConfig = {
  nodes: ['A', 'B', 'C', 'D', 'E'],
  edges: [
    { u: 'A', v: 'B', cost: 2 },
    { u: 'A', v: 'C', cost: 4 },
    { u: 'B', v: 'C', cost: 1 },
    { u: 'B', v: 'D', cost: 7 },
    { u: 'C', v: 'D', cost: 3 },
    { u: 'C', v: 'E', cost: 8 },
    { u: 'D', v: 'E', cost: 2 }
  ],
  nodePositions: {
    A: { x: 100, y: 200 },
    B: { x: 240, y:  80 },
    C: { x: 320, y: 220 },
    D: { x: 430, y:  80 },
    E: { x: 480, y: 300 }
  },
  source: 'A',
  tieBreakRule: 'alphabetical'  // lowest node name wins on equal distance
};

/* ═══════════════════════════════════════════════════════════
   2. STATE
   ═══════════════════════════════════════════════════════════ */

let config = JSON.parse(JSON.stringify(defaultConfig));   // deep copy — mutable

/** steps[]: recorded snapshots of each Dijkstra iteration */
let steps = [];
let currentStep = -1;   // -1 = not started
let playTimer = null;
let isPlaying = false;
let sweepChartInstance = null;

/** Experiment results cached for export */
let lastExpResult = null;
let lastSweepResult = null;

/** Snapshot of edges before opening editor, used for cancel/revert */
let editorPreEditEdges = null;

/* ═══════════════════════════════════════════════════════════
   3. DIJKSTRA — core algorithm with step recording
   ═══════════════════════════════════════════════════════════ */

/**
 * buildAdjacency(nodes, edges)
 * Returns: { node: [ {neighbor, cost}, ... ] }
 */
function buildAdjacency(nodes, edges) {
  const adj = {};
  nodes.forEach(n => (adj[n] = []));
  edges.forEach(({ u, v, cost }) => {
    adj[u].push({ neighbor: v, cost });
    adj[v].push({ neighbor: u, cost });
  });
  return adj;
}

/**
 * runDijkstra(nodes, edges, source)
 *
 * Executes Dijkstra's algorithm and records one "step" per
 * extract-min operation (settling one node).
 *
 * Tie-break rule: when two nodes have equal tentative distance
 * the one with the lexicographically smaller name is settled first.
 *
 * Returns { steps, finalDist, finalPred, metrics }
 *   steps[i] = {
 *     settled,        // node just extracted
 *     dist,           // distance map snapshot
 *     pred,           // predecessor map snapshot
 *     queue,          // priority queue snapshot  [{dist, node}]
 *     settledSet,     // set of settled nodes
 *     relaxations,    // [{edge:{u,v,cost}, improved, newDist}]
 *     logMsg          // plain-English description
 *   }
 */
function runDijkstra(nodes, edges, source) {
  const adj = buildAdjacency(nodes, edges);
  const INF = Infinity;

  // Initialise distances and predecessors
  const dist = {};
  const pred = {};
  nodes.forEach(n => { dist[n] = INF; pred[n] = null; });
  dist[source] = 0;

  // Priority queue: simple array sorted on each pop (fine for ≤100 nodes)
  // Each entry: { d, node }
  // Tie-break: lower d first, then alphabetical node name
  let pq = [{ d: 0, node: source }];
  const settled = new Set();

  const recordedSteps = [];
  let totalRelaxations = 0;
  let totalImprovements = 0;

  // Record init step
  recordedSteps.push({
    settled: null,
    dist: { ...dist },
    pred: { ...pred },
    queue: [...pq],
    settledSet: new Set(settled),
    relaxations: [],
    logMsg: `Initialise: dist[${source}]=0, all others=∞. Add ${source} to priority queue.`,
    type: 'init'
  });

  while (pq.length > 0) {
    // Extract-Min with tie-break (alphabetical on equal distance)
    pq.sort((a, b) => a.d !== b.d ? a.d - b.d : a.node.localeCompare(b.node));
    const { d, node: u } = pq.shift();

    // Skip stale entries (lazy deletion)
    if (settled.has(u)) continue;
    if (d > dist[u]) continue;

    settled.add(u);
    const stepRelaxations = [];

    // Relax all edges from u
    const neighbors = adj[u] || [];
    neighbors.forEach(({ neighbor: v, cost: w }) => {
      if (settled.has(v)) return;  // already finalised
      totalRelaxations++;

      const newDist = dist[u] + w;
      const improved = newDist < dist[v];

      const edgeObj = findEdge(edges, u, v);
      stepRelaxations.push({ edge: edgeObj, improved, newDist, oldDist: dist[v], neighbor: v, w });

      if (improved) {
        dist[v] = newDist;
        pred[v] = u;
        totalImprovements++;
        // Insert or update in queue (lazy: just push, skip stale on extract)
        pq.push({ d: newDist, node: v });
      }
    });

    // Build log message for this step
    const relaxDesc = stepRelaxations.map(r => {
      const costStr = dist[u] === INF ? '∞' : dist[u];
      const result = r.improved
        ? `✓ update ${r.neighbor} (${costStr}+${r.w}=${r.newDist} < ${r.oldDist === INF ? '∞' : r.oldDist}), pred=${u}`
        : `✗ ${r.neighbor} (${costStr}+${r.w}=${r.newDist} ≥ ${r.oldDist === INF ? '∞' : r.oldDist})`;
      return result;
    }).join(' | ') || 'No unsettled neighbours.';

    recordedSteps.push({
      settled: u,
      dist: { ...dist },
      pred: { ...pred },
      queue: pq.filter(x => !settled.has(x.node))
               .sort((a, b) => a.d !== b.d ? a.d - b.d : a.node.localeCompare(b.node))
               .filter((x, i, arr) => arr.findIndex(y => y.node === x.node) === i), // dedupe
      settledSet: new Set(settled),
      relaxations: stepRelaxations,
      logMsg: `Extract ${u} (dist=${dist[u] === INF ? '∞' : dist[u]}). Relax: ${relaxDesc}`,
      type: 'extract'
    });
  }

  // Done
  recordedSteps.push({
    settled: null,
    dist: { ...dist },
    pred: { ...pred },
    queue: [],
    settledSet: new Set(settled),
    relaxations: [],
    logMsg: `Algorithm complete. All ${settled.size} reachable nodes settled.`,
    type: 'done'
  });

  return {
    steps: recordedSteps,
    finalDist: dist,
    finalPred: pred,
    metrics: {
      relaxations: totalRelaxations,
      improvements: totalImprovements,
      settled: settled.size
    }
  };
}

/** Find an edge object by its two endpoint names (order-independent) */
function findEdge(edges, a, b) {
  return edges.find(e =>
    (e.u === a && e.v === b) || (e.u === b && e.v === a)
  ) || { u: a, v: b, cost: '?' };
}

/**
 * buildRoutingTable(source, nodes, finalDist, finalPred)
 * Returns: [ { dest, cost, path, nextHop } ]
 */
function buildRoutingTable(source, nodes, finalDist, finalPred) {
  return nodes
    .filter(n => n !== source)
    .map(dest => {
      const cost = finalDist[dest];
      const path = reconstructPath(source, dest, finalPred);
      const nextHop = path.length > 1 ? path[1] : null;
      return { dest, cost, path, nextHop };
    });
}

/** Walk predecessor chain to reconstruct path source→dest */
function reconstructPath(source, dest, pred) {
  if (pred[dest] === null && dest !== source) return [];  // unreachable
  const path = [];
  let cur = dest;
  while (cur !== null) {
    path.unshift(cur);
    cur = pred[cur];
  }
  return path;
}

/* ═══════════════════════════════════════════════════════════
   4. BRUTE FORCE — enumerate all simple paths for verification
   ═══════════════════════════════════════════════════════════ */

/**
 * bruteForceShortestPaths(nodes, edges, source)
 * Enumerates every simple path from source to every destination.
 * Returns { [dest]: { cost, path } }
 * Used only for the self-test badge (O(n!) — fine for n≤10).
 */
function bruteForceShortestPaths(nodes, edges, source) {
  const adj = buildAdjacency(nodes, edges);
  const best = {};
  nodes.filter(n => n !== source).forEach(n => { best[n] = { cost: Infinity, path: [] }; });

  function dfs(current, visited, costSoFar, pathSoFar) {
    if (current !== source) {
      if (costSoFar < best[current].cost) {
        best[current] = { cost: costSoFar, path: [...pathSoFar] };
      }
    }
    for (const { neighbor, cost } of (adj[current] || [])) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        dfs(neighbor, visited, costSoFar + cost, [...pathSoFar, neighbor]);
        visited.delete(neighbor);
      }
    }
  }

  const init = new Set([source]);
  dfs(source, init, 0, [source]);
  return best;
}

/**
 * verifySelf()
 * Runs Dijkstra on the default config and compares against
 * the expected results specified in the project brief.
 * Also cross-checks with brute-force.
 * Returns { pass: bool, details: string[] }
 */
function verifySelf() {
  const details = [];
  let pass = true;

  /* ── Baseline expected (from brief) ── */
  const baseExpected = {
    B: { cost: 2, path: ['A','B'],         nextHop: 'B' },
    C: { cost: 3, path: ['A','B','C'],     nextHop: 'B' },
    D: { cost: 6, path: ['A','B','C','D'], nextHop: 'B' },
    E: { cost: 8, path: ['A','B','C','D','E'], nextHop: 'B' }
  };

  const base = runDijkstra(defaultConfig.nodes, defaultConfig.edges, 'A');
  const baseTable = buildRoutingTable('A', defaultConfig.nodes, base.finalDist, base.finalPred);

  baseTable.forEach(({ dest, cost, nextHop, path }) => {
    const exp = baseExpected[dest];
    if (!exp) return;
    const pathStr = path.join('→');
    const expPathStr = exp.path.join('→');
    const ok = cost === exp.cost && nextHop === exp.nextHop && pathStr === expPathStr;
    if (!ok) pass = false;
    details.push(`[Baseline] ${dest}: got cost=${cost} path=${pathStr} nextHop=${nextHop} — ${ok ? 'PASS' : 'FAIL (expected cost='+exp.cost+' path='+expPathStr+' nextHop='+exp.nextHop+')'}`);
  });

  /* ── After raising B-C to 6 ── */
  const afterExpected = {
    B: { cost: 2, path: ['A','B'],         nextHop: 'B' },
    C: { cost: 4, path: ['A','C'],         nextHop: 'C' },
    D: { cost: 7, path: ['A','C','D'],     nextHop: 'C' },
    E: { cost: 9, path: ['A','C','D','E'], nextHop: 'C' }
  };

  const modEdges = defaultConfig.edges.map(e =>
    ((e.u === 'B' && e.v === 'C') || (e.u === 'C' && e.v === 'B'))
      ? { ...e, cost: 6 }
      : e
  );
  const after = runDijkstra(defaultConfig.nodes, modEdges, 'A');
  const afterTable = buildRoutingTable('A', defaultConfig.nodes, after.finalDist, after.finalPred);

  afterTable.forEach(({ dest, cost, nextHop, path }) => {
    const exp = afterExpected[dest];
    if (!exp) return;
    const pathStr = path.join('→');
    const expPathStr = exp.path.join('→');
    const ok = cost === exp.cost && nextHop === exp.nextHop && pathStr === expPathStr;
    if (!ok) pass = false;
    details.push(`[After B-C=6] ${dest}: got cost=${cost} path=${pathStr} nextHop=${nextHop} — ${ok ? 'PASS' : 'FAIL (expected cost='+exp.cost+' path='+expPathStr+' nextHop='+exp.nextHop+')'}`);
  });

  /* ── Brute-force cross-check (baseline) ── */
  const bf = bruteForceShortestPaths(defaultConfig.nodes, defaultConfig.edges, 'A');
  Object.entries(bf).forEach(([dest, { cost: bfCost, path: bfPath }]) => {
    const dijkCost = base.finalDist[dest];
    const ok = bfCost === dijkCost;
    if (!ok) pass = false;
    details.push(`[BruteForce] ${dest}: BF=${bfCost} Dijkstra=${dijkCost} — ${ok ? 'PASS' : 'FAIL'}`);
  });

  return { pass, details };
}

/* ═══════════════════════════════════════════════════════════
   5. SVG RENDERER
   ═══════════════════════════════════════════════════════════ */

/** Canonical node radius */
const NODE_R = 22;

/**
 * renderGraph(svgEl, nodes, edges, positions, options)
 *
 * options: {
 *   highlightEdge: {u,v} | null,
 *   treeEdges: Set of "u-v" strings,
 *   settledNodes: Set,
 *   currentNode: string | null,
 *   sourceNode: string,
 *   relaxations: [{edge,improved}],
 *   dist: {node: number},
 *   changedEdge: {u,v} | null,       // for experiment view
 *   altPathEdges: Set,               // for experiment "after" view
 *   interactive: bool
 * }
 */
function renderGraph(svgEl, nodes, edges, positions, options = {}) {
  const {
    treeEdges = new Set(),
    settledNodes = new Set(),
    currentNode = null,
    sourceNode = config.source,
    relaxations = [],
    dist = null,
    changedEdge = null,
    altPathEdges = null,
    interactive = false
  } = options;

  // Build relaxation lookup
  const relaxMap = {};
  relaxations.forEach(r => {
    const key = edgeKey(r.edge.u, r.edge.v);
    relaxMap[key] = r;
  });

  svgEl.innerHTML = `
    <defs>
      <filter id="glow-${svgEl.id}">
        <feGaussianBlur stdDeviation="3" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>`;

  const ns = 'http://www.w3.org/2000/svg';

  /* ── Draw edges ── */
  edges.forEach(edge => {
    const { u, v, cost } = edge;
    const pu = positions[u], pv = positions[v];
    if (!pu || !pv) return;

    const key = edgeKey(u, v);
    const isTree = treeEdges.has(key);
    const rel = relaxMap[key];
    const isChanged = changedEdge &&
      ((changedEdge.u === u && changedEdge.v === v) ||
       (changedEdge.u === v && changedEdge.v === u));
    const isAltPath = altPathEdges && altPathEdges.has(key);

    // Line
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', pu.x); line.setAttribute('y1', pu.y);
    line.setAttribute('x2', pv.x); line.setAttribute('y2', pv.y);
    line.setAttribute('class', 'edge-line');

    if (isAltPath) {
      line.setAttribute('class', 'edge-line tree');
      line.setAttribute('stroke', 'var(--accent-warning)');
    } else if (isChanged) {
      line.setAttribute('class', 'edge-line changed');
    } else if (rel) {
      line.setAttribute('class', rel.improved ? 'edge-line relaxing-good' : 'edge-line relaxing-bad');
    } else if (isTree) {
      line.setAttribute('class', 'edge-line tree');
    }

    svgEl.appendChild(line);

    // Animate pulse on relaxed edges
    if (rel) {
      const midX = (pu.x + pv.x) / 2;
      const midY = (pu.y + pv.y) / 2;
      const pulse = document.createElementNS(ns, 'circle');
      pulse.setAttribute('cx', midX); pulse.setAttribute('cy', midY);
      pulse.setAttribute('class', 'pulse-ring');
      pulse.setAttribute('stroke', rel.improved ? 'var(--clr-edge-relax-good)' : 'var(--clr-edge-relax-bad)');
      svgEl.appendChild(pulse);
    }

    // Cost label
    const midX = (pu.x + pv.x) / 2;
    const midY = (pu.y + pv.y) / 2;
    // Small offset to avoid overlap with the line
    const dx = pv.y - pu.y, dy = pu.x - pv.x;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const ox = (dx / len) * 14;
    const oy = (dy / len) * 14;

    const lbl = document.createElementNS(ns, 'text');
    lbl.setAttribute('x', midX + ox); lbl.setAttribute('y', midY + oy);
    lbl.setAttribute('class', isChanged ? 'edge-label changed-cost' : (rel && rel.improved ? 'edge-label highlight' : 'edge-label'));
    lbl.textContent = cost;
    svgEl.appendChild(lbl);
  });

  /* ── Draw nodes ── */
  nodes.forEach(node => {
    const pos = positions[node];
    if (!pos) return;

    const isSource   = node === sourceNode;
    const isSettled  = settledNodes.has(node);
    const isCurrent  = node === currentNode;
    const inQueue    = dist !== null && dist[node] < Infinity && !isSettled && !isCurrent;

    // Circle
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', pos.x); circle.setAttribute('cy', pos.y);
    circle.setAttribute('r', NODE_R);

    let cls = 'node-circle';
    if (isCurrent)      cls += ' current';
    else if (isSettled) cls += ' settled';
    else if (isSource)  cls += ' source';
    else if (inQueue)   cls += ' in-queue';

    circle.setAttribute('class', cls);
    if (interactive) {
      circle.style.cursor = 'pointer';
      circle.setAttribute('data-node', node);
    }
    svgEl.appendChild(circle);

    // Node label
    const label = document.createElementNS(ns, 'text');
    label.setAttribute('x', pos.x); label.setAttribute('y', pos.y - (dist !== null ? 4 : 0));
    label.setAttribute('class', 'node-label');
    label.textContent = node;
    svgEl.appendChild(label);

    // Distance sub-label (shown during / after algorithm)
    if (dist !== null) {
      const d = dist[node];
      const distLabel = document.createElementNS(ns, 'text');
      distLabel.setAttribute('x', pos.x); distLabel.setAttribute('y', pos.y + 12);
      distLabel.setAttribute('class', 'node-dist' + (d < Infinity ? ' updated' : ''));
      distLabel.textContent = d === Infinity ? '∞' : d;
      svgEl.appendChild(distLabel);
    }
  });
}

/** Canonical edge key (always smaller node first) */
function edgeKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** Compute the tree edges from predecessor map */
function computeTreeEdges(pred) {
  const keys = new Set();
  Object.entries(pred).forEach(([v, u]) => {
    if (u !== null) keys.add(edgeKey(u, v));
  });
  return keys;
}

/* ═══════════════════════════════════════════════════════════
   6. TABLE UPDATER
   ═══════════════════════════════════════════════════════════ */

function updateDistTable(dist, prevDist, currentNode, settledSet, sourceNode) {
  const tbody = document.getElementById('distTableBody');
  tbody.innerHTML = '';
  config.nodes.forEach(node => {
    const d = dist[node];
    const prev = prevDist ? prevDist[node] : Infinity;
    const improved = prev !== undefined && d < prev;
    const tr = document.createElement('tr');
    let rowClass = '';
    if (node === currentNode)    rowClass = 'row--current';
    else if (node === sourceNode) rowClass = 'row--source';
    else if (settledSet.has(node)) rowClass = 'row--settled';
    if (rowClass) tr.className = rowClass;

    tr.innerHTML = `
      <td>${node}</td>
      <td class="${d === Infinity ? 'cell--infinity' : improved ? 'cell--improved' : ''}">
        ${d === Infinity ? '∞' : d}
      </td>
      <td>${improved ? '<span class="pill pill--green">↓ Updated</span>' : ''}</td>`;
    tbody.appendChild(tr);
  });
}

function updatePredTable(pred, currentNode, settledSet) {
  const tbody = document.getElementById('predTableBody');
  tbody.innerHTML = '';
  config.nodes.forEach(node => {
    const tr = document.createElement('tr');
    let rowClass = '';
    if (node === currentNode)    rowClass = 'row--current';
    else if (settledSet.has(node)) rowClass = 'row--settled';
    if (rowClass) tr.className = rowClass;
    tr.innerHTML = `<td>${node}</td><td>${pred[node] !== null ? pred[node] : '<span class="cell--infinity">—</span>'}</td>`;
    tbody.appendChild(tr);
  });
}

function updateQueueTable(queue) {
  const tbody = document.getElementById('queueTableBody');
  tbody.innerHTML = '';
  if (queue.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" style="color:var(--text-muted);font-style:italic;text-align:center">Empty</td></tr>';
    return;
  }
  queue.forEach(({ d, node }) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${d === Infinity ? '∞' : d}</td><td>${node}</td>`;
    tbody.appendChild(tr);
  });
}

function updateSettledChips(settledSet) {
  const chips = document.getElementById('settledChips');
  chips.innerHTML = '';
  [...settledSet].forEach(node => {
    const chip = document.createElement('div');
    chip.className = 'node-chip';
    chip.textContent = node;
    chips.appendChild(chip);
  });
  if (settledSet.size === 0) {
    chips.innerHTML = '<span style="color:var(--text-muted);font-size:12px;font-style:italic">No nodes settled yet.</span>';
  }
}

function updateRoutingTable(routingTable) {
  const tbody = document.getElementById('routingTableBody');
  tbody.innerHTML = '';
  if (!routingTable || routingTable.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-muted);text-align:center">Run the algorithm first.</td></tr>';
    return;
  }
  routingTable.forEach(({ dest, cost, path, nextHop }) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${dest}</td>
      <td>${cost === Infinity ? '∞' : cost}</td>
      <td>${path.join(' → ') || '<span class="cell--infinity">unreachable</span>'}</td>
      <td>${nextHop || '—'}</td>`;
    tbody.appendChild(tr);
  });
}

/* ═══════════════════════════════════════════════════════════
   7. LOG HELPERS
   ═══════════════════════════════════════════════════════════ */

function addLog(msg, type = 'info') {
  const scroll = document.getElementById('logScroll');
  // Remove hint if present
  const hint = scroll.querySelector('.log-hint');
  if (hint) hint.remove();

  const entry = document.createElement('div');
  entry.className = `log-entry log-entry--${type}`;
  entry.textContent = msg;
  scroll.appendChild(entry);
  scroll.scrollTop = scroll.scrollHeight;
}

function clearLog() {
  const scroll = document.getElementById('logScroll');
  scroll.innerHTML = '<div class="log-hint">Run the algorithm to see step-by-step explanations here.</div>';
}

/* ═══════════════════════════════════════════════════════════
   8. ANIMATION — play / step controls
   ═══════════════════════════════════════════════════════════ */

/** Rebuild steps from current config & source */
function rebuildSteps() {
  const result = runDijkstra(config.nodes, config.edges, config.source);
  steps = result.steps;
  currentStep = -1;
  isPlaying = false;
  clearInterval(playTimer);
  playTimer = null;

  document.getElementById('stepNum').textContent = '0';
  document.getElementById('stepTotal').textContent = steps.length;
  document.getElementById('btnPlay').textContent = '▶ Play';
  document.getElementById('btnPrev').disabled = true;
  document.getElementById('btnNext').disabled = false;

  // Clear routing table
  document.getElementById('routingTableBody').innerHTML =
    '<tr><td colspan="4" style="color:var(--text-muted);text-align:center">Run the algorithm first.</td></tr>';
  document.getElementById('metricsBase').textContent = '—';

  clearLog();
  drawInitial();
}

function drawInitial() {
  const svgEl = document.getElementById('networkSVG');
  renderGraph(svgEl, config.nodes, config.edges, config.nodePositions, {
    sourceNode: config.source,
    dist: null
  });
}

/** Apply step at index i */
function applyStep(i) {
  if (i < 0 || i >= steps.length) return;
  const step = steps[i];

  const prevDist = i > 0 ? steps[i - 1].dist : null;
  const prevSettled = i > 0 ? steps[i - 1].settledSet : new Set();

  // Update SVG
  const svgEl = document.getElementById('networkSVG');
  renderGraph(svgEl, config.nodes, config.edges, config.nodePositions, {
    treeEdges: computeTreeEdges(step.pred),
    settledNodes: step.settledSet,
    currentNode: step.settled,
    sourceNode: config.source,
    relaxations: step.relaxations,
    dist: step.dist
  });

  // Update tables
  updateDistTable(step.dist, prevDist, step.settled, step.settledSet, config.source);
  updatePredTable(step.pred, step.settled, step.settledSet);
  updateQueueTable(step.queue);
  updateSettledChips(step.settledSet);

  // Log
  addLog(step.logMsg, step.type === 'extract' ? 'extract' : step.type === 'done' ? 'done' : step.type === 'init' ? 'init' : 'info');

  // Step counter
  document.getElementById('stepNum').textContent = i + 1;

  // On final step, build routing table
  if (step.type === 'done') {
    const result = runDijkstra(config.nodes, config.edges, config.source);
    const rt = buildRoutingTable(config.source, config.nodes, result.finalDist, result.finalPred);
    updateRoutingTable(rt);
    const m = result.metrics;
    document.getElementById('metricsBase').textContent =
      `Relaxations: ${m.relaxations} | Improvements: ${m.improvements} | Settled: ${m.settled}`;
    addLog(`Routing table built. Relaxations=${m.relaxations}, Improvements=${m.improvements}, Settled=${m.settled}`, 'done');
  }
}

function stepForward() {
  if (currentStep < steps.length - 1) {
    currentStep++;
    applyStep(currentStep);
    document.getElementById('btnPrev').disabled = currentStep <= 0;
    document.getElementById('btnNext').disabled = currentStep >= steps.length - 1;
  } else {
    stopPlay();
    document.getElementById('btnNext').disabled = true;
  }
}

function stepBackward() {
  if (currentStep > 0) {
    currentStep--;
    applyStep(currentStep);
    document.getElementById('btnNext').disabled = false;
  } else if (currentStep === 0) {
    currentStep = -1;
    clearLog();
    drawInitial();
    updateDistTable(
      Object.fromEntries(config.nodes.map(n => [n, Infinity])),
      null, null, new Set(), config.source
    );
    updatePredTable(Object.fromEntries(config.nodes.map(n => [n, null])), null, new Set());
    updateQueueTable([]);
    updateSettledChips(new Set());
    document.getElementById('stepNum').textContent = '0';
    document.getElementById('btnPrev').disabled = true;
    document.getElementById('btnNext').disabled = false;
  }
}

function getSpeedMs() {
  const v = parseInt(document.getElementById('speedSlider').value);
  // v=1 → 2000ms, v=10 → 200ms
  return Math.round(2200 - v * 200);
}

function startPlay() {
  isPlaying = true;
  document.getElementById('btnPlay').textContent = '⏸ Pause';
  playTimer = setInterval(() => {
    if (currentStep >= steps.length - 1) {
      stopPlay();
    } else {
      stepForward();
    }
  }, getSpeedMs());
}

function stopPlay() {
  isPlaying = false;
  clearInterval(playTimer);
  playTimer = null;
  document.getElementById('btnPlay').textContent = '▶ Play';
}

function togglePlay() {
  if (isPlaying) {
    stopPlay();
  } else {
    if (currentStep >= steps.length - 1) {
      // Restart
      currentStep = -1;
      clearLog();
      drawInitial();
    }
    startPlay();
  }
}

/* ═══════════════════════════════════════════════════════════
   9. EXPERIMENT PANEL
   ═══════════════════════════════════════════════════════════ */

function populateEdgeSelects() {
  const selects = ['expEdgeSelect', 'sweepEdgeSelect'];
  selects.forEach(id => {
    const sel = document.getElementById(id);
    sel.innerHTML = '';
    config.edges.forEach(e => {
      const opt = document.createElement('option');
      opt.value = `${e.u}-${e.v}`;
      opt.textContent = `${e.u}–${e.v} (cost ${e.cost})`;
      sel.appendChild(opt);
    });
    // Default: B-C
    const bcOpt = [...sel.options].find(o => o.value === 'B-C' || o.value === 'C-B');
    if (bcOpt) { bcOpt.selected = true; }
  });
}

/**
 * runExperiment(): run SPF before & after the cost change,
 * render comparison networks and tables.
 */
function runExperiment() {
  const sel = document.getElementById('expEdgeSelect').value;
  const [eu, ev] = sel.split('-');
  const newCost = parseInt(document.getElementById('expNewCost').value);

  if (!newCost || newCost <= 0) {
    showToast('Edge cost must be ≥ 1', 'error');
    addLog('Warning: invalid cost ≤ 0 rejected.', 'warn');
    return;
  }

  const origEdge = config.edges.find(e =>
    (e.u === eu && e.v === ev) || (e.u === ev && e.v === eu)
  );
  if (!origEdge) { showToast('Edge not found', 'error'); return; }

  if (newCost === origEdge.cost) {
    showToast('Cost unchanged — no experiment to run.', 'warn');
    return;
  }

  // Before
  const beforeResult = runDijkstra(config.nodes, config.edges, config.source);
  const beforeRT = buildRoutingTable(config.source, config.nodes, beforeResult.finalDist, beforeResult.finalPred);

  // After — replace cost
  const afterEdges = config.edges.map(e =>
    ((e.u === eu && e.v === ev) || (e.u === ev && e.v === eu))
      ? { ...e, cost: newCost }
      : e
  );
  const afterResult = runDijkstra(config.nodes, afterEdges, config.source);
  const afterRT = buildRoutingTable(config.source, config.nodes, afterResult.finalDist, afterResult.finalPred);

  // Cache for export
  lastExpResult = { edge: { u: eu, v: ev, oldCost: origEdge.cost, newCost }, beforeRT, afterRT, beforeMetrics: beforeResult.metrics, afterMetrics: afterResult.metrics };

  // Render side-by-side networks
  renderStaticGraph('svgBefore', config.nodes, config.edges, beforeResult.finalPred, null);
  renderStaticGraph('svgAfter',  config.nodes, afterEdges,  afterResult.finalPred,  { u: eu, v: ev }, beforeResult.finalPred);

  // Fill tables
  fillCompareTable('beforeRoutingBody', beforeRT, null);
  fillCompareTable('afterRoutingBody',  afterRT,  beforeRT);

  document.getElementById('metricsBeforeExp').textContent =
    `Relaxations: ${beforeResult.metrics.relaxations} | Improvements: ${beforeResult.metrics.improvements} | Settled: ${beforeResult.metrics.settled}`;
  document.getElementById('metricsAfterExp').textContent =
    `Relaxations: ${afterResult.metrics.relaxations} | Improvements: ${afterResult.metrics.improvements} | Settled: ${afterResult.metrics.settled}`;

  // Build change summary
  buildChangeSummary(beforeRT, afterRT, eu, ev, origEdge.cost, newCost);

  document.getElementById('experimentBody').classList.remove('hidden');
  document.getElementById('experimentBody').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderStaticGraph(svgId, nodes, edges, pred, changedEdge, beforePred) {
  const svgEl = document.getElementById(svgId);
  const treeEdges = computeTreeEdges(pred);
  const beforeTreeEdges = beforePred ? computeTreeEdges(beforePred) : null;

  // altPathEdges: edges in after-tree but NOT in before-tree
  let altPathEdges = null;
  if (beforeTreeEdges) {
    altPathEdges = new Set([...treeEdges].filter(k => !beforeTreeEdges.has(k)));
  }

  renderGraph(svgEl, nodes, edges, config.nodePositions, {
    treeEdges,
    settledNodes: new Set(nodes),
    currentNode: null,
    sourceNode: config.source,
    relaxations: [],
    dist: runDijkstra(nodes, edges, config.source).finalDist,
    changedEdge,
    altPathEdges
  });
}

function fillCompareTable(tbodyId, rt, compareRT) {
  const tbody = document.getElementById(tbodyId);
  tbody.innerHTML = '';
  rt.forEach(row => {
    const compare = compareRT ? compareRT.find(r => r.dest === row.dest) : null;
    const costChanged = compare && row.cost !== compare.cost;
    const pathChanged = compare && row.path.join('→') !== compare.path.join('→');
    const hopChanged  = compare && row.nextHop !== compare.nextHop;
    const anyChanged  = costChanged || pathChanged || hopChanged;

    const tr = document.createElement('tr');
    if (anyChanged) tr.className = 'row--changed';
    tr.innerHTML = `
      <td>${row.dest}</td>
      <td class="${costChanged ? 'cell--diff' : ''}">${row.cost === Infinity ? '∞' : row.cost}</td>
      <td class="${pathChanged ? 'cell--diff' : ''}">${row.path.join(' → ') || '—'}</td>
      <td class="${hopChanged  ? 'cell--diff' : ''}">${row.nextHop || '—'}</td>`;
    tbody.appendChild(tr);
  });
}

function buildChangeSummary(beforeRT, afterRT, eu, ev, oldCost, newCost) {
  const div = document.getElementById('changeSummary');
  div.innerHTML = `<h3>&#128270; Change Summary — ${eu}–${ev} cost ${oldCost} → ${newCost}</h3>`;

  let anyChange = false;
  afterRT.forEach(after => {
    const before = beforeRT.find(r => r.dest === after.dest);
    if (!before) return;
    const costChanged = after.cost !== before.cost;
    const pathChanged = after.path.join('→') !== before.path.join('→');
    const hopChanged  = after.nextHop !== before.nextHop;
    if (!costChanged && !pathChanged && !hopChanged) return;
    anyChange = true;

    const item = document.createElement('div');
    item.className = 'change-item';
    const icon = after.cost < before.cost ? '📉' : '📈';
    const costDiff = after.cost === Infinity ? '∞' : after.cost;
    const beforeCost = before.cost === Infinity ? '∞' : before.cost;
    item.innerHTML = `
      <span class="change-icon">${icon}</span>
      <span class="change-dest">${after.dest}</span>
      <span class="change-detail">
        Cost: <strong>${beforeCost} → ${costDiff}</strong>${costChanged ? ' &#9888;' : ''}&nbsp;|&nbsp;
        Path: <strong>${before.path.join('→')} → ${after.path.join('→') || 'unreachable'}</strong>&nbsp;|&nbsp;
        Next Hop: <strong>${before.nextHop || '—'} → ${after.nextHop || '—'}</strong>
      </span>`;
    div.appendChild(item);
  });

  if (!anyChange) {
    div.innerHTML += '<div class="no-change">No routing changes detected — all paths remain the same.</div>';
  }
}

/* ═══════════════════════════════════════════════════════════
   10. SWEEP ANALYSIS — Chart.js
   ═══════════════════════════════════════════════════════════ */

const CHART_COLORS = [
  '#6366f1','#22c55e','#f59e0b','#ec4899','#0ea5e9',
  '#a78bfa','#fb923c','#34d399','#f87171','#38bdf8'
];

function runSweep() {
  const sel = document.getElementById('sweepEdgeSelect').value;
  const [eu, ev] = sel.split('-');
  const minVal = parseInt(document.getElementById('sweepMin').value) || 1;
  const maxVal = parseInt(document.getElementById('sweepMax').value) || 10;

  if (minVal < 1) { showToast('Min cost must be ≥ 1', 'error'); return; }
  if (maxVal <= minVal) { showToast('Max must be > Min', 'error'); return; }

  const dests = config.nodes.filter(n => n !== config.source);
  const xLabels = [];
  const seriesData = {}; // dest → [cost values]
  const nextHopData = {}; // dest → [nextHop values]
  dests.forEach(d => { seriesData[d] = []; nextHopData[d] = []; });

  const rows = [];

  for (let c = minVal; c <= maxVal; c++) {
    xLabels.push(c);
    const sweepEdges = config.edges.map(e =>
      ((e.u === eu && e.v === ev) || (e.u === ev && e.v === eu))
        ? { ...e, cost: c }
        : e
    );
    const res = runDijkstra(config.nodes, sweepEdges, config.source);
    const rt = buildRoutingTable(config.source, config.nodes, res.finalDist, res.finalPred);
    const row = { cost: c };
    dests.forEach(d => {
      const entry = rt.find(r => r.dest === d);
      const pathCost = entry ? entry.cost : Infinity;
      const nh = entry ? entry.nextHop : '—';
      seriesData[d].push(pathCost === Infinity ? null : pathCost);
      nextHopData[d].push(nh);
      row[d] = { pathCost, nextHop: nh };
    });
    rows.push(row);
  }

  lastSweepResult = { edge: sel, minVal, maxVal, rows, dests };

  // Build Chart.js datasets
  const datasets = dests.map((d, i) => {
    const color = CHART_COLORS[i % CHART_COLORS.length];
    return {
      label: `→ ${d}`,
      data: seriesData[d],
      borderColor: color,
      backgroundColor: color + '22',
      tension: 0.3,
      pointRadius: 5,
      pointHoverRadius: 8,
      fill: false
    };
  });

  // Draw markers where next hop changes
  const markerDatasets = dests.map((d, i) => {
    const color = CHART_COLORS[i % CHART_COLORS.length];
    const markerData = xLabels.map((c, idx) => {
      const nh = nextHopData[d][idx];
      const prevNh = idx > 0 ? nextHopData[d][idx - 1] : null;
      return nh !== prevNh && prevNh !== null ? { x: c, y: seriesData[d][idx] } : null;
    }).filter(Boolean);
    return {
      label: `${d} hop change`,
      data: markerData,
      type: 'scatter',
      pointRadius: 9,
      pointStyle: 'rectRot',
      backgroundColor: color,
      borderColor: '#fff',
      borderWidth: 2,
      showLine: false
    };
  });

  // Destroy old chart
  if (sweepChartInstance) sweepChartInstance.destroy();

  const ctx = document.getElementById('sweepChart').getContext('2d');
  sweepChartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels: xLabels, datasets: [...datasets, ...markerDatasets] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: '#94a3b8', font: { family: 'Inter', size: 12 }, filter: item => !item.text.includes('hop change') }
        },
        title: {
          display: true,
          text: `Path cost from ${config.source} as edge ${eu}–${ev} cost varies`,
          color: '#f0f4ff',
          font: { size: 14, weight: '600', family: 'Inter' }
        },
        tooltip: {
          backgroundColor: '#1a2235',
          borderColor: '#334f78',
          borderWidth: 1,
          titleColor: '#f0f4ff',
          bodyColor: '#94a3b8',
          callbacks: {
            footer: (items) => {
              const ci = items[0].dataIndex;
              return dests.map(d => `${d} next hop: ${nextHopData[d][ci]}`).join('\n');
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: `${eu}–${ev} cost`, color: '#94a3b8' },
          ticks: { color: '#94a3b8' },
          grid: { color: '#1f3050' }
        },
        y: {
          title: { display: true, text: 'Path cost', color: '#94a3b8' },
          ticks: { color: '#94a3b8' },
          grid: { color: '#1f3050' }
        }
      }
    }
  });

  // Build sweep table
  buildSweepTable(dests, rows);

  document.getElementById('sweepBody').classList.remove('hidden');
  document.getElementById('sweepBody').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function buildSweepTable(dests, rows) {
  const head = document.getElementById('sweepTableHead');
  const body = document.getElementById('sweepTableBody');

  head.innerHTML = `<tr><th>Edge Cost</th>${dests.map(d => `<th>→ ${d} Cost</th><th>→ ${d} Hop</th>`).join('')}</tr>`;
  body.innerHTML = '';

  rows.forEach((row, rowIdx) => {
    const tr = document.createElement('tr');
    let cells = `<td>${row.cost}</td>`;
    dests.forEach(d => {
      const prev = rowIdx > 0 ? rows[rowIdx - 1][d] : null;
      const hopChanged = prev && row[d].nextHop !== prev.nextHop;
      const costChanged = prev && row[d].pathCost !== prev.pathCost;
      cells += `<td class="${costChanged ? 'cell--diff' : ''}">${row[d].pathCost === Infinity ? '∞' : row[d].pathCost}</td>`;
      cells += `<td class="${hopChanged ? 'cell--diff' : ''}">${row[d].nextHop || '—'}</td>`;
    });
    tr.innerHTML = cells;
    body.appendChild(tr);
  });
}

/* ═══════════════════════════════════════════════════════════
   11. EXPORT HELPERS
   ═══════════════════════════════════════════════════════════ */

function downloadText(filename, content) {
  const a = document.createElement('a');
  a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(content);
  a.download = filename;
  a.click();
}

function downloadJSON(filename, obj) {
  downloadText(filename, JSON.stringify(obj, null, 2));
}

/** Convert array of objects to CSV string */
function toCSV(headers, rows) {
  const lines = [headers.join(',')];
  rows.forEach(row => lines.push(row.map(c => `"${c}"`).join(',')));
  return lines.join('\n');
}

function exportRoutingCSV() {
  const res = runDijkstra(config.nodes, config.edges, config.source);
  const rt = buildRoutingTable(config.source, config.nodes, res.finalDist, res.finalPred);
  const csv = toCSV(['Destination','Total Cost','Path','Next Hop'],
    rt.map(r => [r.dest, r.cost === Infinity ? 'Infinity' : r.cost, r.path.join('→'), r.nextHop || '—']));
  downloadText('routing_table.csv', csv);
  showToast('Routing table exported as CSV', 'success');
}

function exportRoutingJSON() {
  const res = runDijkstra(config.nodes, config.edges, config.source);
  const rt = buildRoutingTable(config.source, config.nodes, res.finalDist, res.finalPred);
  downloadJSON('routing_table.json', rt);
  showToast('Routing table exported as JSON', 'success');
}

function exportConfig() {
  downloadJSON('network_config.json', config);
  showToast('Network config exported', 'success');
}

function exportExpCSV() {
  if (!lastExpResult) { showToast('Run experiment first', 'warn'); return; }
  const { edge, beforeRT, afterRT } = lastExpResult;
  const headers = ['Dest','Before Cost','Before Path','Before NextHop','After Cost','After Path','After NextHop'];
  const rows = beforeRT.map(b => {
    const a = afterRT.find(r => r.dest === b.dest);
    return [b.dest,
      b.cost === Infinity ? 'Infinity' : b.cost, b.path.join('→'), b.nextHop || '—',
      a.cost === Infinity ? 'Infinity' : a.cost, a.path.join('→'), a.nextHop || '—'];
  });
  downloadText('experiment_result.csv', toCSV(headers, rows));
  showToast('Experiment exported as CSV', 'success');
}

function exportExpJSON() {
  if (!lastExpResult) { showToast('Run experiment first', 'warn'); return; }
  downloadJSON('experiment_result.json', lastExpResult);
  showToast('Experiment exported as JSON', 'success');
}

function exportSweepCSV() {
  if (!lastSweepResult) { showToast('Run sweep first', 'warn'); return; }
  const { dests, rows } = lastSweepResult;
  const headers = ['Edge Cost', ...dests.flatMap(d => [`${d} Cost`, `${d} NextHop`])];
  const csvRows = rows.map(row => [row.cost, ...dests.flatMap(d => [
    row[d].pathCost === Infinity ? 'Infinity' : row[d].pathCost,
    row[d].nextHop || '—'
  ])]);
  downloadText('sweep_result.csv', toCSV(headers, csvRows));
  showToast('Sweep exported as CSV', 'success');
}

function exportSweepJSON() {
  if (!lastSweepResult) { showToast('Run sweep first', 'warn'); return; }
  downloadJSON('sweep_result.json', lastSweepResult);
  showToast('Sweep exported as JSON', 'success');
}

function exportChartPNG() {
  if (!sweepChartInstance) { showToast('Run sweep first', 'warn'); return; }
  const url = sweepChartInstance.toBase64Image('image/png', 1);
  const a = document.createElement('a');
  a.href = url; a.download = 'sweep_chart.png'; a.click();
  showToast('Chart exported as PNG', 'success');
}

function exportSVG() {
  const svgEl = document.getElementById('networkSVG');
  const serializer = new XMLSerializer();
  let source = serializer.serializeToString(svgEl);
  source = '<?xml version="1.0" standalone="no"?>\r\n' + source;
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source);
  const a = document.createElement('a'); a.href = url; a.download = 'network.svg'; a.click();
  showToast('SVG exported', 'success');
}

/* ═══════════════════════════════════════════════════════════
   12. EDGE EDITOR MODAL
   ═══════════════════════════════════════════════════════════ */

function openEdgeEditor() {
  // Save a snapshot so cancel/X can revert
  editorPreEditEdges = JSON.parse(JSON.stringify(config.edges));
  const tbody = document.getElementById('edgeEditBody');
  tbody.innerHTML = '';
  config.edges.forEach((edge, i) => {
    const tr = buildEdgeRow(edge, i);
    tbody.appendChild(tr);
  });
  document.getElementById('edgeEditorModal').classList.remove('hidden');
}

function buildEdgeRow(edge, i) {
  const tr = document.createElement('tr');
  tr.dataset.idx = i;
  tr.innerHTML = `
    <td>
      <select class="edge-node-select edge-u" data-i="${i}">
        ${config.nodes.map(n => `<option ${n === edge.u ? 'selected' : ''}>${n}</option>`).join('')}
      </select>
      &nbsp;–&nbsp;
      <select class="edge-node-select edge-v" data-i="${i}">
        ${config.nodes.map(n => `<option ${n === edge.v ? 'selected' : ''}>${n}</option>`).join('')}
      </select>
    </td>
    <td><input type="number" class="edge-cost-input" data-i="${i}" value="${edge.cost}" min="1"/></td>
    <td><button class="btn-remove-edge" data-i="${i}">✕</button></td>`;
  tr.querySelector('.btn-remove-edge').addEventListener('click', () => {
    config.edges.splice(i, 1);
    openEdgeEditor();
  });
  return tr;
}

function applyEdgeEdits() {
  const rows = document.querySelectorAll('#edgeEditBody tr');
  const newEdges = [];
  let valid = true;
  rows.forEach(tr => {
    const u = tr.querySelector('.edge-u').value;
    const v = tr.querySelector('.edge-v').value;
    const cost = parseInt(tr.querySelector('.edge-cost-input').value);
    if (u === v) { showToast(`Edge ${u}–${v}: self-loops not allowed.`, 'error'); valid = false; return; }
    if (!cost || cost <= 0) { showToast(`Edge ${u}–${v}: cost must be ≥ 1.`, 'error'); valid = false; return; }
    newEdges.push({ u, v, cost });
  });
  if (!valid) return;
  config.edges = newEdges;
  document.getElementById('edgeEditorModal').classList.add('hidden');
  populateEdgeSelects();
  rebuildSteps();
  showToast('Edge costs updated. Algorithm reset.', 'success');
}

function addNewEdgeRow() {
  const tbody = document.getElementById('edgeEditBody');
  const newEdge = { u: config.nodes[0], v: config.nodes[1], cost: 1 };
  const i = config.edges.length;
  config.edges.push(newEdge);
  tbody.appendChild(buildEdgeRow(newEdge, i));
}

/* ═══════════════════════════════════════════════════════════
   TOAST
   ═══════════════════════════════════════════════════════════ */

function showToast(msg, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 320);
  }, 3000);
}

/* ═══════════════════════════════════════════════════════════
   13. INIT
   ═══════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

  /* ── Keyboard shortcuts ── */
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    if (e.key === 'ArrowRight') stepForward();
    if (e.key === 'ArrowLeft')  stepBackward();
    if (e.key === 'r' || e.key === 'R') { stopPlay(); rebuildSteps(); }
  });

  /* ── Controls ── */
  document.getElementById('btnPlay').addEventListener('click', togglePlay);
  document.getElementById('btnNext').addEventListener('click', stepForward);
  document.getElementById('btnPrev').addEventListener('click', stepBackward);
  document.getElementById('btnReset').addEventListener('click', () => { stopPlay(); rebuildSteps(); showToast('Algorithm reset', 'info'); });

  document.getElementById('speedSlider').addEventListener('input', function () {
    document.getElementById('speedLabel').textContent = this.value + 'x';
    if (isPlaying) { stopPlay(); startPlay(); }
  });

  document.getElementById('sourceSelect').addEventListener('change', function () {
    config.source = this.value;
    stopPlay();
    rebuildSteps();
  });

  /* ── Tabs ── */
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('tab-btn--active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
      this.classList.add('tab-btn--active');
      document.getElementById(this.dataset.tab).classList.remove('hidden');
    });
  });

  /* ── Log clear ── */
  document.getElementById('btnClearLog').addEventListener('click', clearLog);

  /* ── Export routing table ── */
  document.getElementById('btnExportRoutingCSV').addEventListener('click', exportRoutingCSV);
  document.getElementById('btnExportRoutingJSON').addEventListener('click', exportRoutingJSON);

  /* ── Config import/export ── */
  document.getElementById('btnExportCfg').addEventListener('click', exportConfig);
  document.getElementById('btnImportCfg').addEventListener('click', () => {
    document.getElementById('fileImportCfg').click();
  });
  document.getElementById('fileImportCfg').addEventListener('change', function () {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const imported = JSON.parse(e.target.result);
        if (!imported.nodes || !imported.edges) throw new Error('Missing nodes or edges');
        config = imported;
        config.source = config.source || config.nodes[0];
        // Rebuild source select
        const sel = document.getElementById('sourceSelect');
        sel.innerHTML = '';
        config.nodes.forEach(n => {
          const opt = document.createElement('option');
          opt.value = n; opt.textContent = n;
          if (n === config.source) opt.selected = true;
          sel.appendChild(opt);
        });
        populateEdgeSelects();
        rebuildSteps();
        showToast('Config imported successfully', 'success');
      } catch (err) {
        showToast('Invalid config file: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
    this.value = '';
  });

  /* ── Edge editor ── */
  document.getElementById('btnEditEdges').addEventListener('click', openEdgeEditor);
  document.getElementById('btnCloseEdgeEditor').addEventListener('click', () => {
    // Cancel: revert to state before editor was opened
    if (editorPreEditEdges) {
      config.edges = editorPreEditEdges;
      editorPreEditEdges = null;
    }
    document.getElementById('edgeEditorModal').classList.add('hidden');
    populateEdgeSelects();
    drawInitial();
  });
  document.getElementById('btnApplyEdges').addEventListener('click', applyEdgeEdits);
  document.getElementById('btnAddEdge').addEventListener('click', addNewEdgeRow);

  // Close modal on backdrop click (cancel)
  document.getElementById('edgeEditorModal').addEventListener('click', function (e) {
    if (e.target === this) {
      if (editorPreEditEdges) {
        config.edges = editorPreEditEdges;
        editorPreEditEdges = null;
      }
      this.classList.add('hidden');
      populateEdgeSelects();
      drawInitial();
    }
  });

  /* ── Experiment ── */
  document.getElementById('btnRunExperiment').addEventListener('click', runExperiment);
  document.getElementById('btnExportExpCSV').addEventListener('click', exportExpCSV);
  document.getElementById('btnExportExpJSON').addEventListener('click', exportExpJSON);

  /* ── Sweep ── */
  document.getElementById('btnRunSweep').addEventListener('click', runSweep);
  document.getElementById('btnExportChartPNG').addEventListener('click', exportChartPNG);
  document.getElementById('btnExportSweepCSV').addEventListener('click', exportSweepCSV);
  document.getElementById('btnExportSweepJSON').addEventListener('click', exportSweepJSON);

  /* ── SVG export ── */
  document.getElementById('btnExportSVG').addEventListener('click', exportSVG);

  /* ── Run self-verification ── */
  setTimeout(() => {
    const { pass, details } = verifySelf();
    const badge = document.getElementById('verificationBadge');
    if (pass) {
      badge.className = 'badge badge--pass';
      badge.textContent = '✓ Verification: PASS';
    } else {
      badge.className = 'badge badge--fail';
      badge.textContent = '✗ Verification: FAIL';
    }
    badge.title = details.join('\n');
  }, 200);

  /* ── Bootstrap ── */
  populateEdgeSelects();
  rebuildSteps();

  // Show a welcome toast
  setTimeout(() => showToast('Welcome! Press Play or use arrow keys to step through the algorithm.', 'info'), 600);
});
