// file_C.js (uses per-node features already computed in file_A.js; no feature-detectors here)

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
        // core detection
        minGroupSize: 4,
        supportThreshold: 0.8,

        // DOT
        rootEl: document.body,
        dotFilename: `${window.location.hostname}`+".dot",
        dotTitle:
            "DOM Map (core: thick border; fill = per-node #scoring-features matched (0..10) for ANY node with count>0; label=tag only)",

        // borders
        paintedPenWidth: 4,
        normalPenWidth: 1.2,

        // scoring slots (must match file_A scoring semantics)
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
            "#fee0d2", // very light
            "#fcbba1",
            "#fc9272",
            "#fb6a4a",
            "#ef3b2c",
            "#cb181d",
            "#a50f15",
            "#67000d",
            "#3a0008",
            "#260000", // extra deep for max intensity
        ],

        // plain / neutral fill
        nonPaintFill: "white",

        clearExistingPaint: true,
    };

    /********************************************************************
     * Build fast lookup: Element -> scan record
     * (These features are PER-NODE because file_A is per-node.)
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
        try {
            el.setAttribute("data-paint", "true");
        } catch {}
    }

    function hasPaint(el) {
        try {
            return el.getAttribute("data-paint") === "true";
        } catch {
            return false;
        }
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
        // For ANY node: count<=0 => white (so painted-but-0-features is white too)
        if (!count || count <= 0) return CFG.nonPaintFill;
        return CFG.colors[Math.min(10, Math.max(1, count)) - 1];
    }

    /********************************************************************
     * Feature counting (PER-NODE via file_A record)
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
     * CORE MATCHING (structural; subtree-based matching is OK here)
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
            (c) => Math.abs(getTagIndexAmongSameTag(c) - refTagIdx) === bestDist
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
        const roots = members.map((r) => r.el).filter(isElement);
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
                if (!hasPaint(u)) {
                    setPaint(u);
                    newlyPainted++;
                }
                for (const m of matched) {
                    if (m && !hasPaint(m)) {
                        setPaint(m);
                        newlyPainted++;
                    }
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
     * DOT BUILDER (whole page)
     *
     * NEW SEMANTICS:
     * - Border thickness ONLY for data-paint=true (core)
     * - Fill color for ANY node with per-node featureCount > 0
     * - Painted-but-0-features stays white
     * - Unpainted + 0 features stays white
     ********************************************************************/
    function buildDotWholePage({ rootEl = document.body, title = CFG.dotTitle } = {}) {
        if (!isElement(rootEl)) throw new Error("rootEl must be an Element");

        const idMap = new WeakMap();
        let nextId = 1;
        const getId = (el) => {
            let id = idMap.get(el);
            if (!id) {
                id = "n" + nextId++;
                idMap.set(el, id);
            }
            return id;
        };

        const nodes = new Map();
        const edges = [];

        const stack = [rootEl];
        while (stack.length) {
            const el = stack.pop();
            if (!isElement(el)) continue;

            const id = getId(el);

            if (!nodes.has(id)) {
                const painted = hasPaint(el);

                // per-node feature evidence for ALL nodes
                const c = perNodeFeatureCount(el); // 0..10

                // fill: ONLY if c>0, otherwise white
                const fill = fillColor(c);

                // border: ONLY if painted
                const penwidth = painted ? CFG.paintedPenWidth : CFG.normalPenWidth;

                // font: switch when dark fill and meaningful count
                const fontcolor = c >= 6 ? "white" : "black";

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
                const child = children[i];
                if (!isElement(child)) continue;
                edges.push([id, getId(child)]);
                stack.push(child);
            }
        }

        let dot = "";
        dot += "digraph DOMCoreBorderPlusPerNodeFeatureHeat {\n";
        dot += `  graph [rankdir=TB, fontsize=12, labelloc="t", label="${esc(title)}"];\n`;
        dot += '  node  [shape=box, style="rounded,filled", fontsize=9, fontname="Helvetica"];\n';
        dot += '  edge  [color="gray70"];\n\n';

        for (const [id, info] of nodes.entries()) {
            dot += `  ${id} [label="${info.label}", fillcolor="${info.fillcolor}", fontcolor="${info.fontcolor}", color="${info.color}", penwidth=${info.penwidth}];\n`;
        }

        dot += "\n";
        for (const [a, b] of edges) {
            if (nodes.has(a) && nodes.has(b)) dot += `  ${a} -> ${b};\n`;
        }
        dot += "}\n";

        return { dot, nodesCount: nodes.size, edgesCount: edges.length };
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

        const groups = [];
        for (const [xpathStar, members] of byXPathStar.entries()) {
            if (!members?.length) continue;
            if (members.length < minGroupSize) continue;
            groups.push({ xpathStar, members });
        }

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

        const { dot, nodesCount, edgesCount } = buildDotWholePage({
            rootEl,
            title: dotTitle,
        });

        window.__commentFeatureScan.coreBorderPlusPerNodeHeat = {
            CFG,
            summaries,
            dot,
        };

        downloadText(dotFilename, dot);

        console.log(
            "✅ Done: core nodes painted (thick border); ANY node with per-node featureCount>0 gets heat fill; 0-feature nodes stay white."
        );
        console.table(
            summaries.map((s) => ({
                xpathStar: s.xpathStar,
                siblings: s.siblingCount,
                refSiblingIndex: s.refSiblingIndex,
                refSubtreeCount: s.refSubtreeCount,
                newlyPainted: s.paintedCount,
            }))
        );
        console.log(`✅ DOT downloaded as ${dotFilename}`);
        console.log(`DOT stats: nodes=${nodesCount}, edges=${edgesCount}`);

        return { summaries, nodesCount, edgesCount };
    }

    /********************************************************************
     * Expose a single entry point under __commentFeatureScan
     ********************************************************************/
    window.__commentFeatureScan.runCoreBorderPlusPerNodeHeat = run;

    __commentFeatureScan.runCoreBorderPlusPerNodeHeat({ minGroupSize: 4, supportThreshold: 0.8 })
    console.log(
        "✅ Ready.\n" +
        "Run:\n" +
        "  __commentFeatureScan.runCoreBorderPlusPerNodeHeat({ minGroupSize: 4, supportThreshold: 0.8 })"
    );
})();
