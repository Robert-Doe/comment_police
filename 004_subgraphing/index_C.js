// file_C.js (clusters = union parent container of suspected xpathStar groups;
//            borders for core nodes; heat for ANY node with featureCount>0)

(() => {
    /********************************************************************
     * REQUIREMENTS
     ********************************************************************/
    if (!window.__commentFeatureScan?.results?.length) {
        console.warn("Missing __commentFeatureScan.results. Run file_A scan first.");
        return;
    }
    if (!window.__commentFeatureScan?.xpath?.byXPathStar) {
        console.warn("Missing __commentFeatureScan.xpath.byXPathStar. Run file_B (XPath grouping) first.");
        return;
    }

    /********************************************************************
     * CONFIG
     ********************************************************************/
    const CFG = {
        // core detection (structural)
        minGroupSize: 4,
        supportThreshold: 0.8,

        // "suspected comment group" detection
        // If true: use record.features.has_related_keyword on any sibling root to suspect group
        // If false: fall back to xpathStar string heuristic only
        suspectByFeatureFlag: true,

        // DOT
        rootEl: document.body,
        dotFilename: `${window.location.hostname}`+".dot",
        dotTitle:
            "DOM Core Map (core: thick border; fill = per-node #scoring-features matched (0..10) for ANY node with count>0; label=tag only; clusters = union parent container of suspected xpathStar groups)",

        // borders
        paintedPenWidth: 4,
        normalPenWidth: 1.2,

        // scoring slots (must match file_A semantics)
        scoreBoolKeys: [
            "has_avatar",
            "has_author",
            "has_relative_time_or_timestamp",
            "has_microaction",
            "has_related_keyword",
            "link_with_at_or_hash",
            "emoji_only",
            "emoji_mixed",
        ],
        questionKey: "has_question",
        wordSlotAtLeast: 30,

        // Stronger / darker heat ramp (10 steps)
        colors: [
            "#fee0d2",
            "#fcbba1",
            "#fc9272",
            "#fb6a4a",
            "#ef3b2c",
            "#cb181d",
            "#a50f15",
            "#67000d",
            "#3a0008",
            "#260000",
        ],

        // Painted-but-0-features should be plain white (and also non-painted)
        nonPaintFill: "white",

        // cluster styling
        clusterPenWidth: 2.5,
        clusterStyle: "rounded",
        clusterColor: "gray35",     // outline color
        clusterLabelColor: "gray15",
        clusterMargin: 10,

        clearExistingPaint: true,
    };

    /********************************************************************
     * Build fast lookup: Element -> scan record
     ********************************************************************/
    const byEl = new Map();
    for (const r of window.__commentFeatureScan.results) {
        if (r?.el) byEl.set(r.el, r);
    }

    /********************************************************************
     * Small utilities
     ********************************************************************/
    const esc = (s) =>
        String(s ?? "")
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/\n/g, "\\n");

    function downloadText(filename, text) {
        const blob = new Blob([text], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 500);
    }

    function isElement(el) {
        return el && el.nodeType === 1;
    }

    function setPaint(el) {
        try { el.setAttribute("data-paint", "true"); } catch {}
    }

    function hasPaint(el) {
        try { return el.getAttribute("data-paint") === "true"; } catch { return false; }
    }

    function clearPaintOnWholePage() {
        document.querySelectorAll('[data-paint="true"]').forEach((el) => {
            el.removeAttribute("data-paint");
        });
    }

    function tagOnlyLabel(el) {
        return esc(el.tagName.toLowerCase());
    }

    function fillColor(count) {
        // painted-but-0-features and non-painted 0-features => white
        if (!count || count <= 0) return CFG.nonPaintFill;
        return CFG.colors[Math.min(10, Math.max(1, count)) - 1];
    }

    /********************************************************************
     * Feature counting from file_A record (PER-NODE semantics assumed)
     ********************************************************************/
    function featureCountFromRecord(rec) {
        if (!rec?.features) return 0;

        let c = 0;

        for (const k of CFG.scoreBoolKeys) if (rec.features[k]) c++;
        if (rec.features[CFG.questionKey]) c++;

        const wc = rec.features.text_word_count || 0;
        if (wc >= CFG.wordSlotAtLeast) c++;

        if (c < 0) c = 0;
        if (c > 10) c = 10;
        return c;
    }

    function perNodeFeatureCount(el) {
        const rec = byEl.get(el);
        return featureCountFromRecord(rec);
    }

    /********************************************************************
     * CORE MATCHING (structural subtree matching is fine here)
     ********************************************************************/
    function countSubtreeElements(rootEl) {
        let count = 0;
        const stack = [rootEl];
        while (stack.length) {
            const el = stack.pop();
            if (!isElement(el)) continue;
            count++;
            const children = el.children;
            for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
        }
        return count;
    }

    function preorderElements(rootEl) {
        const out = [];
        const stack = [rootEl];
        while (stack.length) {
            const el = stack.pop();
            if (!isElement(el)) continue;
            out.push(el);
            const children = el.children;
            for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
        }
        return out;
    }

    function getTagIndexAmongSameTag(el) {
        const tag = el.tagName;
        let idx = 1;
        let sib = el.previousElementSibling;
        while (sib) {
            if (sib.tagName === tag) idx++;
            sib = sib.previousElementSibling;
        }
        return idx;
    }

    function childTagMultiset(el) {
        const m = new Map();
        if (!isElement(el)) return m;
        const children = el.children;
        for (let i = 0; i < children.length; i++) {
            const t = children[i].tagName.toLowerCase();
            m.set(t, (m.get(t) || 0) + 1);
        }
        return m;
    }

    function containmentScore(refChildTags, candChildTags) {
        let score = 0;
        for (const [tag, refCount] of refChildTags.entries()) {
            const candCount = candChildTags.get(tag) || 0;
            if (candCount < refCount) return -Infinity;
            score += refCount;
        }
        return score;
    }

    function findBestMatchWithinParent({ refNode, sibParent }) {
        if (!isElement(refNode) || !isElement(sibParent)) return null;

        const refTag = refNode.tagName;
        const refTagIdx = getTagIndexAmongSameTag(refNode);
        const refChildCount = refNode.children ? refNode.children.length : 0;
        const refChildTags = childTagMultiset(refNode);

        const candidates = [];
        const children = sibParent.children;
        for (let i = 0; i < children.length; i++) {
            const c = children[i];
            if (!isElement(c)) continue;
            if (c.tagName !== refTag) continue;

            const candChildCount = c.children ? c.children.length : 0;
            if (candChildCount < refChildCount) continue;
            candidates.push(c);
        }

        if (!candidates.length) return null;
        if (candidates.length === 1) return candidates[0];

        // tie-break 1: closest tag-index
        let bestDist = Infinity;
        for (const c of candidates) {
            const dist = Math.abs(getTagIndexAmongSameTag(c) - refTagIdx);
            if (dist < bestDist) bestDist = dist;
        }
        const bestDistCands = candidates.filter(
            c => Math.abs(getTagIndexAmongSameTag(c) - refTagIdx) === bestDist
        );
        if (bestDistCands.length === 1) return bestDistCands[0];

        // tie-break 2: best child-tag containment
        let best = null;
        let bestScore = -Infinity;
        for (const c of bestDistCands) {
            const s = containmentScore(refChildTags, childTagMultiset(c));
            if (s > bestScore) {
                bestScore = s;
                best = c;
            }
        }
        return best || bestDistCands[0];
    }

    function pickMedianSibling(roots) {
        const arr = roots
            .filter(isElement)
            .map((el, idx) => ({ el, idx, count: countSubtreeElements(el) }))
            .sort((a, b) => a.count - b.count);
        const mid = Math.floor(arr.length / 2);
        return arr[mid] || null;
    }

    function paintGroupByReferenceMedian({ xpathStar, members, supportThreshold }) {
        const roots = members.map(r => r.el).filter(isElement);
        const n = roots.length;
        if (!n) return { xpathStar, siblingCount: 0, paintedCount: 0 };

        const refPick = pickMedianSibling(roots);
        if (!refPick) return { xpathStar, siblingCount: n, paintedCount: 0 };

        const refRoot = refPick.el;
        const refNodes = preorderElements(refRoot);

        const matchMaps = new Array(n).fill(null).map(() => new WeakMap());
        for (let s = 0; s < n; s++) matchMaps[s].set(refRoot, roots[s]);

        let newlyPainted = 0;

        for (const u of refNodes) {
            const parentRef = u.parentElement;
            const matched = new Array(n).fill(null);

            for (let s = 0; s < n; s++) {
                if (u === refRoot) {
                    matched[s] = roots[s];
                    continue;
                }

                const sibParent = parentRef ? matchMaps[s].get(parentRef) : null;
                if (!sibParent || !isElement(sibParent)) {
                    matched[s] = null;
                    continue;
                }

                const m = findBestMatchWithinParent({ refNode: u, sibParent });
                matched[s] = m;
                if (m) matchMaps[s].set(u, m);
            }

            const matchCount = matched.filter(Boolean).length;
            const support = matchCount / n;

            if (support >= supportThreshold) {
                if (!hasPaint(u)) { setPaint(u); newlyPainted++; }
                for (const m of matched) {
                    if (m && !hasPaint(m)) { setPaint(m); newlyPainted++; }
                }
            }
        }

        return {
            xpathStar,
            siblingCount: n,
            refSiblingIndex: refPick.idx,
            refSubtreeCount: refPick.count,
            paintedCount: newlyPainted,
        };
    }

    /********************************************************************
     * SUSPECTED GROUPS -> UNION CONTAINER (PARENT OF THE STARRED NODE)
     *
     * For xpathStar group like ".../span[2]/h3[*]"
     * members are the h3 siblings; their parent is span[2]
     * We cluster the span[2] subtree (span[2] + all descendants).
     ********************************************************************/
    function groupLooksSuspected(xpathStar, members) {
        if (!members?.length) return false;

        // Option A: use file_A per-node feature "has_related_keyword" on sibling roots
        if (CFG.suspectByFeatureFlag) {
            for (const m of members) {
                const rec = byEl.get(m.el);
                if (rec?.features?.has_related_keyword) return true;
            }
        }

        // Option B: fallback to xpathStar string heuristic
        const s = String(xpathStar || "").toLowerCase();
        if (s.includes("comment") || s.includes("reply") || s.includes("thread")) return true;

        return false;
    }

    function getUnionContainerForXPathStar(members) {
        // direct parent of the starred node (siblings share same parent)
        const first = members?.[0]?.el;
        const parent = first?.parentElement;
        return isElement(parent) ? parent : null;
    }

    function collectSubtreeElements(rootEl) {
        const out = [];
        const stack = [rootEl];
        while (stack.length) {
            const el = stack.pop();
            if (!isElement(el)) continue;
            out.push(el);
            const children = el.children;
            for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
        }
        return out;
    }

    /********************************************************************
     * DOT BUILDER (whole page)
     *
     * CHANGES YOU ASKED FOR:
     * 1) core border still only for data-paint=true
     * 2) heat fill applies to ANY node with featureCount>0 (painted or not)
     * 3) clusters: ONE cluster per suspected xpathStar group,
     *    wrapping the UNION CONTAINER = parent of the starred node + all its descendants
     ********************************************************************/
    function buildDotWholePage({
                                   rootEl = document.body,
                                   title = CFG.dotTitle,
                                   clusters = [], // array of { xpathStar, containerEl }
                               } = {}) {
        if (!isElement(rootEl)) throw new Error("rootEl must be an Element");

        const idMap = new WeakMap();
        let nextId = 1;

        const getId = (el) => {
            let id = idMap.get(el);
            if (!id) {
                id = "n" + (nextId++);
                idMap.set(el, id);
            }
            return id;
        };

        const nodes = new Map();
        const edges = [];

        // traverse whole page
        const stack = [rootEl];
        while (stack.length) {
            const el = stack.pop();
            if (!isElement(el)) continue;

            const id = getId(el);

            if (!nodes.has(id)) {
                const painted = hasPaint(el);

                // base visuals
                let fill = CFG.nonPaintFill; // default white
                let fontcolor = "gray20";
                let penwidth = CFG.normalPenWidth;

                // core border only if painted
                if (painted) penwidth = CFG.paintedPenWidth;

                // heat fill for ANY node whose featureCount > 0
                const c = perNodeFeatureCount(el);
                if (c > 0) {
                    fill = fillColor(c);
                    fontcolor = c >= 6 ? "white" : "black";
                } else {
                    // painted-but-0-features stays white per your rule
                    fill = CFG.nonPaintFill;
                    fontcolor = "gray20";
                }

                nodes.set(id, {
                    label: tagOnlyLabel(el),
                    fillcolor: fill,
                    fontcolor,
                    penwidth,
                    color: "gray20",
                });
            }

            const children = el.children;
            for (let i = children.length - 1; i >= 0; i--) {
                const c = children[i];
                if (!isElement(c)) continue;
                edges.push([id, getId(c)]);
                stack.push(c);
            }
        }

        // Build DOT
        let dot = "";
        dot += "digraph DOMCoreBorderPlusPerNodeFeatureHeat {\n";
        dot += `  graph [rankdir=TB, fontsize=12, labelloc="t", label="${esc(title)}"];\n`;
        dot += '  node  [shape=box, style="rounded,filled", fontsize=9, fontname="Helvetica"];\n';
        dot += '  edge  [color="gray70"];\n\n';

        // clusters FIRST (Graphviz likes subgraphs before edges sometimes)
        // One cluster per suspected xpathStar union container
        for (let i = 0; i < clusters.length; i++) {
            const { xpathStar, containerEl } = clusters[i];
            if (!isElement(containerEl)) continue;

            const clusterId = `cluster_${i + 1}`;

            // include container + all descendants
            const els = collectSubtreeElements(containerEl);
            const nodeIds = [];
            for (const el of els) {
                nodeIds.push(getId(el));
            }

            dot += `  subgraph ${clusterId} {\n`;
            dot += `    label="${esc(xpathStar)}";\n`;
            dot += `    fontcolor="${CFG.clusterLabelColor}";\n`;
            dot += `    color="${CFG.clusterColor}";\n`;
            dot += `    penwidth=${CFG.clusterPenWidth};\n`;
            dot += `    style="${CFG.clusterStyle}";\n`;
            dot += `    margin=${CFG.clusterMargin};\n`;

            // list nodes in this cluster
            for (const nid of nodeIds) dot += `    ${nid};\n`;

            dot += "  }\n\n";
        }

        // nodes
        for (const [id, info] of nodes.entries()) {
            dot += `  ${id} [label="${info.label}", fillcolor="${info.fillcolor}", fontcolor="${info.fontcolor}", color="${info.color}", penwidth=${info.penwidth}];\n`;
        }

        dot += "\n";

        // edges
        for (const [a, b] of edges) {
            if (nodes.has(a) && nodes.has(b)) dot += `  ${a} -> ${b};\n`;
        }

        dot += "}\n";

        return { dot, nodesCount: nodes.size, edgesCount: edges.length, clustersCount: clusters.length };
    }

    /********************************************************************
     * RUN
     ********************************************************************/
    function run({
                     minGroupSize = CFG.minGroupSize,
                     supportThreshold = CFG.supportThreshold,
                     rootEl = CFG.rootEl,
                     dotFilename = CFG.dotFilename,
                     dotTitle = CFG.dotTitle,
                     clearExistingPaint = CFG.clearExistingPaint,
                 } = {}) {
        if (clearExistingPaint) clearPaintOnWholePage();

        const byXPathStar = window.__commentFeatureScan.xpath.byXPathStar;

        // Candidate groups (structural repeat groups)
        const groups = [];
        for (const [xpathStar, members] of byXPathStar.entries()) {
            if (!members?.length) continue;
            if (members.length < minGroupSize) continue;
            groups.push({ xpathStar, members });
        }

        // 1) core paint (data-paint=true) per group
        const summaries = [];
        for (const g of groups) {
            summaries.push(
                paintGroupByReferenceMedian({
                    xpathStar: g.xpathStar,
                    members: g.members,
                    supportThreshold,
                })
            );
        }

        // 2) build union-container clusters for suspected groups
        const clusters = [];
        for (const g of groups) {
            if (!groupLooksSuspected(g.xpathStar, g.members)) continue;

            const containerEl = getUnionContainerForXPathStar(g.members);
            if (!containerEl) continue;

            clusters.push({
                xpathStar: g.xpathStar,
                containerEl,
            });
        }

        // 3) DOT
        const { dot, nodesCount, edgesCount, clustersCount } = buildDotWholePage({
            rootEl,
            title: dotTitle,
            clusters,
        });

        window.__commentFeatureScan.coreBorderPlusPerNodeHeat = {
            CFG,
            summaries,
            clusters: clusters.map(c => ({
                xpathStar: c.xpathStar,
                containerTag: c.containerEl?.tagName?.toLowerCase?.() || "",
            })),
            dot,
        };

        downloadText(dotFilename, dot);

        console.log("✅ Done:");
        console.log("- core nodes painted (data-paint=true) => thick border");
        console.log("- heat applied to ANY node with featureCount>0 (painted or not)");
        console.log("- suspected xpathStar groups => ONE cluster around UNION CONTAINER (parent of starred node + subtree)");
        console.table(summaries.map(s => ({
            xpathStar: s.xpathStar,
            siblings: s.siblingCount,
            refSiblingIndex: s.refSiblingIndex,
            refSubtreeCount: s.refSubtreeCount,
            newlyPainted: s.paintedCount,
        })));
        console.log(`✅ clusters created: ${clustersCount}`);
        console.log(`✅ DOT downloaded as ${dotFilename}`);
        console.log(`DOT stats: nodes=${nodesCount}, edges=${edgesCount}`);

        return { summaries, nodesCount, edgesCount, clustersCount };
    }

    /********************************************************************
     * Expose entry point
     ********************************************************************/
    window.__commentFeatureScan.runCoreBorderPlusPerNodeHeat = run;

    console.log(
        "✅ Ready.\n" +
        "Run:\n" +
        "  __commentFeatureScan.runCoreBorderPlusPerNodeHeat({ minGroupSize: 4, supportThreshold: 0.8 })"
    );
})();
