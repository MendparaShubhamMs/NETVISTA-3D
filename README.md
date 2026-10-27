# Dijkstra SPF Visualiser — 25CS044

> **Link-state shortest paths after cost changes**  
> University Networking Project · Research question: *How do SPF routes change when link costs are adjusted?*

---

## Quick Start

1. Open `index.html` in any modern browser (Chrome, Firefox, Edge, Safari).  
   **No server, no build step, no dependencies to install.**
2. Press **▶ Play** (or `Space`) to animate the algorithm.
3. Use **← / →** arrow keys to step backward/forward one step at a time.
4. The **Verification: PASS** badge in the header confirms the built-in self-test passed.

---

## File Structure

```
index.html   — Page structure; all HTML sections
style.css    — Design system, layout, SVG styles, animations
app.js       — Algorithm, rendering, UI logic (sections documented below)
README.md    — This file
```

---

## Default Network

| Edge | Cost |
|------|------|
| A–B  | 2    |
| A–C  | 4    |
| B–C  | 1    |
| B–D  | 7    |
| C–D  | 3    |
| C–E  | 8    |
| D–E  | 2    |

Source router: **A** (selectable in the header).

---

## Algorithm Steps → UI Mapping

| Phase | What Dijkstra does | What you see in the UI |
|---|---|---|
| **Initialise** | `dist[A]=0`, all others `∞`. Source pushed to PQ. | Init log entry; SVG shows source in green. |
| **Extract-Min** | Node with smallest `dist` is removed from the PQ. | Node turns pink/magenta in SVG; "Extract X (dist=…)" appears in log. |
| **Relax edges** | For each neighbour `v` of extracted node `u`: if `dist[u]+w < dist[v]` → update `dist[v]` and `pred[v]`. | Green edge flash + "↓ Updated" in Distance table if improved; grey pulse if not. |
| **Repeat** | Loop until PQ is empty. | Each loop iteration = one ▶ step. |
| **Finalise** | All reachable nodes settled. SPF tree complete. | Bold indigo edges form the SPF tree; Routing Table is populated. |

### Tie-break rule
When two nodes have equal tentative distance, the node with the **lexicographically smaller name** (e.g., `B` before `C`) is settled first. This is stated in the log and in the README section of the page.

---

## Features

### Core Animation
- **Play / Pause / Next / Prev / Reset** + **Speed slider** (1×–10×).
- SVG network canvas: colour-coded nodes (unvisited, in-queue, current, settled, source) and edges (default, SPF-tree, relaxed-good, relaxed-bad).
- Distance table, Predecessor table, Priority Queue table, and Settled Set — all live-updated each step.
- Plain-English log (e.g. `Extract B (dist=2). Relax: ✓ update C (2+1=3 < ∞), pred=B | ✗ D (2+7=9 ≥ ∞)`).
- Final routing table: Destination | Total Cost | Path | Next Hop.

### Experiment Panel
1. Choose any edge from the dropdown.
2. Enter a new cost (must be ≥ 1).
3. Click **Run Experiment**.
4. See:
   - Side-by-side SVG networks (Before / After) with changed paths highlighted in amber.
   - Before / After routing tables with differing cells highlighted.
   - Change summary listing which destinations changed cost, path, or next hop.
   - Metrics comparison (relaxations, improvements, settled count).

### Sweep Analysis
Vary the chosen edge's cost from any `min` to `max` value and plot path costs to all destinations as a **Chart.js line chart**. Markers (diamond shapes) indicate where the next hop changes. Includes a full sweep data table.

### Self-Test
On load, `verifySelf()` in `app.js` checks:

**Baseline (source A, default costs):**

| Dest | Expected Cost | Expected Path | Expected Next Hop |
|------|--------------|--------------|-------------------|
| B | 2 | A→B | B |
| C | 3 | A→B→C | B |
| D | 6 | A→B→C→D | B |
| E | 8 | A→B→C→D→E | B |

**After raising B–C to 6:**

| Dest | Expected Cost | Expected Path | Expected Next Hop |
|------|--------------|--------------|-------------------|
| B | 2 | A→B | B |
| C | 4 | A→C | C |
| D | 7 | A→C→D | C |
| E | 9 | A→C→D→E | C |

Additionally, a **brute-force simple-path enumerator** confirms Dijkstra's shortest distances match the true minimum over all simple paths.

### Export
| Button | Output |
|--------|--------|
| Export Config | `network_config.json` |
| Import Config | Load any JSON config matching the schema |
| ⬇ CSV (routing) | `routing_table.csv` |
| ⬇ JSON (routing) | `routing_table.json` |
| ⬇ Export CSV/JSON (experiment) | `experiment_result.csv/.json` |
| ⬇ Sweep CSV/JSON | `sweep_result.csv/.json` |
| 🖼 PNG | `sweep_chart.png` |
| 🖼 SVG | `network.svg` |

### Edge Editor
Click **✏ Edit Edges** to open a modal and change any edge cost, add edges, or remove edges. Changes reset and rerun the algorithm automatically.

---

## Config Schema (JSON import/export)

```json
{
  "nodes": ["A", "B", "C", "D", "E"],
  "edges": [
    { "u": "A", "v": "B", "cost": 2 }
  ],
  "nodePositions": {
    "A": { "x": 100, "y": 200 }
  },
  "source": "A",
  "tieBreakRule": "alphabetical"
}
```

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `→` | Next step |
| `←` | Previous step |
| `R` | Reset |

---

## Dependencies

- **Chart.js 4.4** (loaded via CDN) — sweep line chart only
- **Google Fonts** (Inter + JetBrains Mono) — typography only
- Zero npm packages, zero build tools

---

## Code Structure (app.js sections)

| Section | Lines | Purpose |
|---------|-------|---------|
| 1. CONFIG | top | `defaultConfig` object — network topology |
| 2. STATE | — | Mutable runtime variables (`steps`, `currentStep`, etc.) |
| 3. DIJKSTRA | `runDijkstra()` | Core algorithm with step snapshots |
| 4. BRUTE FORCE | `bruteForceShortestPaths()` | O(n!) path enumerator for verification |
| 5. SVG RENDERER | `renderGraph()` | Draws nodes, edges, labels, animations |
| 6. TABLE UPDATER | `updateDistTable()` etc. | Syncs DOM tables to algorithm state |
| 7. LOG | `addLog()` | Appends plain-English entries |
| 8. ANIMATION | `stepForward()` / `startPlay()` | Step & play/pause logic |
| 9. EXPERIMENT | `runExperiment()` | Before/after comparison |
| 10. SWEEP | `runSweep()` | Cost sweep + Chart.js |
| 11. EXPORT | `exportRoutingCSV()` etc. | File downloads |
| 12. EDGE EDITOR | `openEdgeEditor()` | Modal for topology edits |
| 13. INIT | `DOMContentLoaded` | Event wiring, bootstrap |
