"""Generate graphs for 25CS044 from results.json and the network config."""
import json
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

R = json.load(open("results.json"))
EDGES = [["A","B",2],["A","C",4],["B","C",1],["B","D",7],
         ["C","D",3],["C","E",8],["D","E",2]]
POS = {"A": (0, 0), "B": (1.6, 1.2), "C": (1.6, -1.2), "D": (3.4, 1.2), "E": (3.4, -1.2)}
TREE, CHANGED, GREY = "#1f6feb", "#d9480f", "#b0b7c0"

def draw(ax, edges, pred, title, prev_pred=None, cost_changed=None):
    tree = {frozenset((v, p)) for v, p in pred.items() if p}
    old_tree = {frozenset((v, p)) for v, p in (prev_pred or {}).items() if p}
    for u, v, w in edges:
        k = frozenset((u, v)); x = [POS[u][0], POS[v][0]]; y = [POS[u][1], POS[v][1]]
        if k in tree:
            col = CHANGED if (prev_pred and k not in old_tree) else TREE; lw = 4
        else:
            col, lw = GREY, 1.5
        ax.plot(x, y, color=col, lw=lw, zorder=1)
        mx, my = sum(x) / 2, sum(y) / 2
        hl = cost_changed and k == frozenset(cost_changed)
        ax.text(mx, my, str(w), ha="center", va="center", fontsize=13, fontweight="bold",
                color=CHANGED if hl else "#222",
                bbox=dict(boxstyle="round,pad=0.25", fc="white", ec=CHANGED if hl else GREY),
                zorder=3)
    for n, (x, y) in POS.items():
        ax.scatter([x], [y], s=1400, color="#1b2a41" if n != "A" else "#0b6e4f", zorder=2)
        ax.text(x, y, n, ha="center", va="center", color="white", fontsize=16,
                fontweight="bold", zorder=4)
    ax.set_title(title, fontsize=14, fontweight="bold"); ax.axis("off")
    ax.set_xlim(-0.6, 4.0); ax.set_ylim(-2.0, 2.0)

pred0, pred1 = R["baseline"]["pred"], R["after"]["pred"]
e1 = [[u, v, 6 if {u, v} == {"B", "C"} else w] for u, v, w in EDGES]

fig, ax = plt.subplots(figsize=(7, 4.4))
draw(ax, EDGES, pred0, "Baseline network: shortest-path tree from A")
fig.savefig("graph_network_baseline.png", dpi=200, bbox_inches="tight"); plt.close(fig)

fig, axs = plt.subplots(1, 2, figsize=(13, 4.6))
draw(axs[0], EDGES, pred0, "Before: B-C = 1")
draw(axs[1], e1, pred1, "After: B-C = 6", prev_pred=pred0, cost_changed=("B", "C"))
fig.savefig("graph_before_after.png", dpi=200, bbox_inches="tight"); plt.close(fig)

sw = R["sweep"]; xs = [r["cost_BC"] for r in sw]
fig, ax = plt.subplots(figsize=(8, 4.6))
cols = {"B": "#2a9d8f", "C": "#1f6feb", "D": "#e9a100", "E": "#d9480f"}
for n in "BCDE":
    ax.plot(xs, [r[f"cost_to_{n}"] for r in sw], marker="o", lw=2.4, color=cols[n],
            label=f"to {n}")
ax.axvline(1.5, color="#555", ls="--", lw=1.2)
ax.text(1.65, 6.0, "Next hop for C, D, E switches B → C.\nAt B-C = 2 the paths tie (cost 4); A-C is kept.", fontsize=10, va="top")
ax.set_xlabel("Cost of link B-C"); ax.set_ylabel("Shortest-path cost from A")
ax.set_xticks(xs); ax.set_title("Path cost vs B-C link cost (source A)", fontweight="bold")
ax.grid(alpha=.25); ax.legend(frameon=False, ncol=4, loc="upper center", bbox_to_anchor=(0.5, -0.16))
for s in ("top", "right"): ax.spines[s].set_visible(False)
fig.savefig("graph_sweep.png", dpi=200, bbox_inches="tight"); plt.close(fig)

fig, ax = plt.subplots(figsize=(7, 4))
d0, d1 = R["baseline"]["dist"], R["after"]["dist"]; ns = ["B", "C", "D", "E"]
w = 0.38; idx = range(len(ns))
b0 = ax.bar([i - w/2 for i in idx], [d0[n] for n in ns], w, color=GREY, label="Before (B-C=1)")
b1 = ax.bar([i + w/2 for i in idx], [d1[n] for n in ns], w, color=TREE, label="After (B-C=6)")
for bars in (b0, b1):
    for b in bars: ax.text(b.get_x()+b.get_width()/2, b.get_height()+.1, int(b.get_height()),
                           ha="center", fontsize=11)
ax.set_xticks(list(idx)); ax.set_xticklabels(ns); ax.set_ylabel("Cost from A")
ax.set_title("Path cost per destination", fontweight="bold"); ax.legend(frameon=False)
for s in ("top", "right"): ax.spines[s].set_visible(False)
fig.savefig("graph_cost_comparison.png", dpi=200, bbox_inches="tight"); plt.close(fig)
print("ok")
