(() => {
    // Requires:
    // 1) window.__commentFeatureScan.results
    // 2) window.__commentFeatureScan.xpath.byXPathStar (from your XPath grouping script)
    if (!window.__commentFeatureScan?.results?.length) {
        console.warn("Missing __commentFeatureScan.results. Run your scan first.");
        return;
    }
    if (!window.__commentFeatureScan?.xpath?.byXPathStar) {
        console.warn("Missing __commentFeatureScan.xpath.byXPathStar. Run XPath grouping step first.");
        return;
    }

    /********************************************************************
     * CONFIG
     ********************************************************************/
    const CFG = {
        // Core detection
        minGroupSize: 4,
        supportThreshold: 0.8,

        // DOT export
        rootEl: document.body,
        dotFilename: "dom_core_border_plus_heat.dot",
        dotTitle:
            "DOM Core Map (data-paint=true; thick border; fill = #scoring-features matched (0..10))",

        // Border thickness
        paintedPenWidth: 4,
        normalPenWidth: 1.2,

        // 10-slot feature counting
        // 8 full-point boolean features
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
        // 9th "slot"
        questionKey: "has_question",
        // 10th "slot"
        wordSlotAtLeast: 30,

        // 10-step ramp (light -> deepest red)
        colors: [
            "#fff5f0",
            "#fee0d2",
            "#fcbba1",
            "#fc9272",
            "#fb6a4a",
            "#ef3b2c",
            "#cb181d",
            "#a50f15",
            "#7f0000",
            "#4a0000",
        ],

        // Non-painted nodes fill
        nonPaintFill: "white",

        // Clear old paint marks before running
        clearExistingPaint: true,
    };

    /********************************************************************
     * Utils
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

    /********************************************************************
     * Index scan results by element for O(1) feature lookup
     ********************************************************************/
    const byEl = new Map();
    for (const r of window.__commentFeatureScan.results) {
        if (r?.el) byEl.set(r.el, r);
    }

    // Returns integer feature count in [0..10]
    function featureCount(el) {
        const rec = byEl.get(el);
        if (!rec?.features) return 0;

        let c = 0;

        // 8 full-point booleans
        for (const k of CFG.scoreBoolKeys) if (rec.features[k]) c++;

        // question slot
        if (rec.features[CFG.questionKey]) c++;

        // word slot
        const wc = rec.features.text_word_count || 0;
        if (wc >= CFG.wordSlotAtLeast) c++;

        if (c < 0) c = 0;
        if (c > 10) c = 10;
        return c;
    }

    function fillColor(count) {
        if (!count) return "#f0f0f0";
        return CFG.colors[Math.min(10, Math.max(1, count)) - 1];
    }

    /********************************************************************
     * Core detection helpers (median reference matching)
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

        if (candidates.length === 0) return null;
        if (candidates.length === 1) return candidates[0];

        // Tie-break 1: closest tag-index
        let bestDist = Infinity;
        for (const c of candidates) {
            const dist = Math.abs(getTagIndexAmongSameTag(c) - refTagIdx);
            if (dist < bestDist) bestDist = dist;
        }
        const bestDistCands = candidates.filter(
            c => Math.abs(getTagIndexAmongSameTag(c) - refTagIdx) === bestDist
        );
        if (bestDistCands.length === 1) return bestDistCands[0];

        // Tie-break 2: best child-tag containment
        let best2 = null;
        let bestScore = -Infinity;
        for (const c of bestDistCands) {
            const s = containmentScore(refChildTags, childTagMultiset(c));
            if (s > bestScore) {
                bestScore = s;
                best2 = c;
            }
        }
        return best2 || bestDistCands[0];
    }

    function pickMedianSibling(roots) {
        const arr = roots
            .filter(isElement)
            .map((el, idx) => ({ el, idx, count: countSubtreeElements(el) }))
            .sort((a, b) => a.count - b.count);

        const mid = Math.floor(arr.length / 2);
        return arr[mid] || null;
    }

    function paintGroupByReferenceMedian({ group, supportThreshold }) {
        const roots = group.members.map(r => r.el).filter(isElement);
        const n = roots.length;
        if (n === 0) return { paintedCount: 0, xpathStar: group.xpathStar, siblingCount: 0 };

        const refPick = pickMedianSibling(roots);
        if (!refPick) return { paintedCount: 0, xpathStar: group.xpathStar, siblingCount: n };

        const refRoot = refPick.el;
        const refNodes = preorderElements(refRoot);

        const matchMaps = new Array(n).fill(null).map(() => new WeakMap());
        for (let s = 0; s < n; s++) matchMaps[s].set(refRoot, roots[s]);

        let newlyPainted = 0;

        for (const u of refNodes) {
            if (!isElement(u)) continue;

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
            paintedCount: newlyPainted,
            xpathStar: group.xpathStar,
            siblingCount: n,
            refSiblingIndex: refPick.idx,
            refSubtreeCount: refPick.count,
        };
    }

    /********************************************************************
     * DOT builder (whole DOM; thick border on painted; fill heatmap on painted)
     ********************************************************************/
    function buildDotWholePage({ rootEl = document.body, title = CFG.dotTitle } = {}) {
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

        const stack = [rootEl];
        while (stack.length) {
            const el = stack.pop();
            if (!isElement(el)) continue;

            const id = getId(el);

            if (!nodes.has(id)) {
                const painted = hasPaint(el);

                let fill = CFG.nonPaintFill;
                let fontcolor = "gray20";

                if (painted) {
                    const c = featureCount(el);   // 0..10
                    fill = fillColor(c);
                    fontcolor = c >= 6 ? "white" : "black";
                }

                nodes.set(id, {
                    label: tagOnlyLabel(el), // tag only
                    fillcolor: fill,
                    fontcolor,
                    penwidth: painted ? CFG.paintedPenWidth : CFG.normalPenWidth,
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

        let dot = "";
        dot += "digraph DOMCoreBorderPlusHeat {\n";
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

        const groupsAll = [];
        const byXPathStar = window.__commentFeatureScan.xpath.byXPathStar;

        for (const [xpathStar, members] of byXPathStar.entries()) {
            if (!members?.length) continue;
            if (members.length < minGroupSize) continue;
            groupsAll.push({ xpathStar, members });
        }

        const groupSummaries = [];
        for (const g of groupsAll) {
            groupSummaries.push(paintGroupByReferenceMedian({ group: g, supportThreshold }));
        }

        const { dot, nodesCount, edgesCount } = buildDotWholePage({
            rootEl,
            title: dotTitle,
        });

        window.__coreBorderPlusHeat = {
            CFG: {
                minGroupSize,
                supportThreshold,
                paintedPenWidth: CFG.paintedPenWidth,
                scoreBoolKeys: CFG.scoreBoolKeys,
                questionKey: CFG.questionKey,
                wordSlotAtLeast: CFG.wordSlotAtLeast,
                colors: CFG.colors,
            },
            groups: groupsAll,
            groupSummaries,
            dot,
        };

        downloadText(dotFilename, dot);

        console.log("✅ Done: cores marked data-paint=true; thick border + heatmap fill applied on cores.");
        console.table(groupSummaries.map(s => ({
            xpathStar: s.xpathStar,
            siblings: s.siblingCount,
            refSiblingIndex: s.refSiblingIndex,
            refSubtreeCount: s.refSubtreeCount,
            newlyPainted: s.paintedCount
        })));
        console.log(`✅ DOT downloaded as ${dotFilename}`);
        console.log(`DOT stats: nodes=${nodesCount}, edges=${edgesCount}`);
        return { groupSummaries, nodesCount, edgesCount };
    }

    /********************************************************************
     * Public API
     ********************************************************************/
    window.__coreBorderPlusHeatToolkit = { CFG, run, clearPaintOnWholePage };

    console.log(
        "✅ Merged script ready (single __commentFeatureScan name).\n" +
        "Run:\n" +
        "  __coreBorderPlusHeatToolkit.run({ minGroupSize: 4, supportThreshold: 0.8 })\n"
    );
})();
