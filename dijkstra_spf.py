"""25CS044 - Link-state shortest paths after cost changes.

Dijkstra (SPF) on a 5-node network. Prints a stepwise trace of extractions and
relaxations, distance/predecessor tables and next hops, then raises one edge
cost and compares. Also sweeps that edge cost and verifies against brute force.

Usage: python dijkstra_spf.py [config.json]
"""
import heapq, itertools, json, sys, csv

DEFAULT = {
    "source": "A",
    "edges": [["A","B",2],["A","C",4],["B","C",1],["B","D",7],
              ["C","D",3],["C","E",8],["D","E",2]],
    "change": {"edge": ["B","C"], "new_cost": 6},
    "sweep": {"min": 1, "max": 10},
}

def graph(edges):
    g = {}
    for u, v, w in edges:
        g.setdefault(u, {})[v] = w
        g.setdefault(v, {})[u] = w
    return g

def spf(g, src):
    """Dijkstra with full trace. Ties broken by lowest node name."""
    INF = float("inf")
    dist = {n: INF for n in g}; pred = {n: None for n in g}
    dist[src] = 0
    pq = [(0, src)]; settled = []; steps = []
    relax = upd = 0
    while pq:
        d, u = heapq.heappop(pq)
        if u in settled or d > dist[u]:
            continue
        settled.append(u)
        steps.append({"type": "extract", "node": u, "dist": d})
        for v in sorted(g[u]):
            if v in settled:
                continue
            relax += 1
            cand = d + g[u][v]
            old = dist[v]
            better = cand < old
            if better:
                dist[v] = cand; pred[v] = u; upd += 1
                heapq.heappush(pq, (cand, v))
            steps.append({"type": "relax", "u": u, "v": v, "cand": cand,
                          "old": old, "updated": better})
    return dist, pred, steps, {"relaxations": relax, "updates": upd,
                               "settled": len(settled)}

def path_to(pred, dst):
    p = []
    while dst is not None:
        p.append(dst); dst = pred[dst]
    return p[::-1]

def next_hops(pred, src):
    out = {}
    for n in pred:
        if n == src: continue
        p = path_to(pred, n)
        out[n] = p[1] if len(p) > 1 else None
    return out

def brute_force(g, src, dst):
    best = float("inf"); nodes = [n for n in g if n not in (src, dst)]
    for r in range(len(nodes) + 1):
        for mid in itertools.permutations(nodes, r):
            p = [src, *mid, dst]; c = 0; ok = True
            for a, b in zip(p, p[1:]):
                if b not in g[a]: ok = False; break
                c += g[a][b]
            if ok: best = min(best, c)
    return best

def verify(g, dist, src):
    return all(dist[n] == brute_force(g, src, n) for n in g if n != src)

def fmt_trace(steps):
    lines = []
    for i, s in enumerate(steps, 1):
        if s["type"] == "extract":
            lines.append(f"  Extract {s['node']} (dist {s['dist']}) -> settled")
        else:
            old = "inf" if s["old"] == float("inf") else s["old"]
            res = "UPDATE" if s["updated"] else "no change"
            lines.append(f"    Relax {s['u']}-{s['v']}: {s['cand']} vs {old} -> {res}")
    return "\n".join(lines)

def report(title, g, src):
    dist, pred, steps, m = spf(g, src)
    nh = next_hops(pred, src)
    print(f"\n=== {title} ===")
    print(fmt_trace(steps))
    print(f"  {'Dest':<5}{'Cost':<6}{'Pred':<6}{'Next hop':<10}Path")
    for n in sorted(g):
        if n == src: continue
        print(f"  {n:<5}{dist[n]:<6}{str(pred[n]):<6}{str(nh[n]):<10}"
              f"{'-'.join(path_to(pred, n))}")
    ok = verify(g, dist, src)
    print(f"  Metrics: {m}  | brute-force verification: {'PASS' if ok else 'FAIL'}")
    return dist, pred, nh, steps, m, ok

def main():
    cfg = DEFAULT
    if len(sys.argv) > 1:
        cfg = json.load(open(sys.argv[1]))
    src = cfg["source"]; edges = cfg["edges"]
    a, b = cfg["change"]["edge"]; new = cfg["change"]["new_cost"]

    g0 = graph(edges)
    r0 = report("BASELINE", g0, src)
    edges1 = [[u, v, (new if {u, v} == {a, b} else w)] for u, v, w in edges]
    g1 = graph(edges1)
    r1 = report(f"AFTER raising {a}-{b} to {new}", g1, src)

    print("\n=== COMPARISON ===")
    print(f"  {'Dest':<5}{'Cost':<12}{'Next hop':<12}Path change")
    for n in sorted(g0):
        if n == src: continue
        print(f"  {n:<5}{r0[0][n]}->{r1[0][n]:<8}{r0[2][n]}->{r1[2][n]:<8}"
              f"{'-'.join(path_to(r0[1], n))} => {'-'.join(path_to(r1[1], n))}")

    rows = []
    for c in range(cfg["sweep"]["min"], cfg["sweep"]["max"] + 1):
        e = [[u, v, (c if {u, v} == {a, b} else w)] for u, v, w in edges]
        d, p, _, m = spf(graph(e), src)
        h = next_hops(p, src)
        row = {"cost_" + a + b: c}
        for n in sorted(g0):
            if n == src: continue
            row["cost_to_" + n] = d[n]; row["nexthop_" + n] = h[n]
        row["relaxations"] = m["relaxations"]; row["updates"] = m["updates"]
        rows.append(row)
    with open("sweep_results.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
    print("\n=== SWEEP (sweep_results.csv written) ===")
    for r in rows:
        print("  ", r)

    out = {"baseline": {"dist": r0[0], "pred": r0[1], "next_hop": r0[2], "metrics": r0[4]},
           "after": {"dist": r1[0], "pred": r1[1], "next_hop": r1[2], "metrics": r1[4]},
           "verified": r0[5] and r1[5], "sweep": rows}
    json.dump(out, open("results.json", "w"), indent=2)

if __name__ == "__main__":
    main()
