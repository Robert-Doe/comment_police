(() => {
    if (!window.__commentFeatureScan?.results?.length) {
        console.warn("Run your scan first so __commentFeatureScan.results exists.");
        return;
    }
    if (!window.__commentFeatureScan?.xpath?.byXPathStar) {
        console.warn("Run the XPath grouping step first so __commentFeatureScan.xpath.byXPathStar exists.");
        return;
    }

    /********************************************************************
     * CONFIG (no node caps; only thresholds/filters)
     ********************************************************************/
    const CFG = {
        // Only process xpathStar groups with at least this many siblings
        minGroupSize: 4,

        // Support threshold: e.g., 0.8 means must match in >=80% of siblings
        supportThreshold: 0.8,

        // DOT output
        dotFilename: "dom_painted_cores.dot",
        dotTitle: "DOM Painted Cores (data-paint=true; color = sibling identity)",

        // Whether to clear existing data-paint before running
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

    function tagOnlyLabel(el) {
        return esc(el.tagName.toLowerCase());
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
        // careful: this is global
        document.querySelectorAll('[data-paint="true"]').forEach((el) => {
            el.removeAttribute("data-paint");
        });
    }

    /********************************************************************
     * Palette: each sibling gets its own color (distinct per sibling)
     ********************************************************************/
    const PALETTE = [
        "#8B0000", "#B22222", "#DC143C", "#FF4500", "#FF8C00",
        "#DAA520", "#228B22", "#2E8B57", "#1E90FF", "#4169E1",
        "#6A5ACD", "#8A2BE2", "#9932CC", "#C71585", "#A52A2A",
        "#008B8B", "#20B2AA", "#556B2F", "#708090", "#2F4F4F",
    ];
    const siblingColor = (i) => PALETTE[i % PALETTE.length];

    /********************************************************************
     * Tree traversal helpers (NO caps)
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

    // Preorder traversal of element nodes: visit parent before children
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
        // 1-based index among siblings with same tag
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
        // Map<tagLower, count>
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
        // How well does candidate "contain" reference required child tags?
        // Score = sum over tags of min(refCount, candCount); reject if any refCount > candCount.
        let score = 0;
        for (const [tag, refCount] of refChildTags.entries()) {
            const candCount = candChildTags.get(tag) || 0;
            if (candCount < refCount) return -Infinity; // missing required structure
            score += refCount; // matched all required occurrences
        }
        // Extra children are allowed; no penalty here
        return score;
    }

    /********************************************************************
     * Candidate matching logic (Step 3b/c)
     ********************************************************************/
    function findBestMatchWithinParent({
                                           refNode,
                                           sibParent,
                                       }) {
        if (!isElement(refNode) || !isElement(sibParent)) return null;

        const refTag = refNode.tagName;
        const refTagIdx = getTagIndexAmongSameTag(refNode);
        const refChildCount = refNode.children ? refNode.children.length : 0;
        const refChildTags = childTagMultiset(refNode);

        // candidates among children of sibParent
        const candidates = [];
        const children = sibParent.children;
        for (let i = 0; i < children.length; i++) {
            const c = children[i];
            if (!isElement(c)) continue;
            if (c.tagName !== refTag) continue;

            const candChildCount = c.children ? c.children.length : 0;
            if (candChildCount < refChildCount) continue; // containment rule (>=)

            candidates.push(c);
        }

        if (candidates.length === 0) return null;
        if (candidates.length === 1) return candidates[0];

        // Resolve ambiguity:
        // 1) closest tag-index distance
        let best = null;
        let bestDist = Infinity;

        for (const c of candidates) {
            const candIdx = getTagIndexAmongSameTag(c);
            const dist = Math.abs(candIdx - refTagIdx);
            if (dist < bestDist) {
                bestDist = dist;
                best = c;
            } else if (dist === bestDist) {
                // tie: defer to containment score
                // we keep ties to resolve in next phase
            }
        }

        // collect all with bestDist
        const bestDistCands = candidates.filter(c => Math.abs(getTagIndexAmongSameTag(c) - refTagIdx) === bestDist);
        if (bestDistCands.length === 1) return bestDistCands[0];

        // 2) child tag containment scoring
        let best2 = null;
        let bestScore = -Infinity;
        for (const c of bestDistCands) {
            const candChildTags = childTagMultiset(c);
            const s = containmentScore(refChildTags, candChildTags);
            if (s > bestScore) {
                bestScore = s;
                best2 = c;
            }
        }

        // If all tied and valid, just pick the first stable one
        return best2 || bestDistCands[0];
    }

    /********************************************************************
     * Step 1: choose median-sized sibling as reference
     ********************************************************************/
    function pickMedianSibling(roots) {
        const arr = roots
            .filter(isElement)
            .map((el, idx) => ({ el, idx, count: countSubtreeElements(el) }))
            .sort((a, b) => a.count - b.count);

        const mid = Math.floor(arr.length / 2);
        return arr[mid] || null; // {el, idx, count}
    }

    /********************************************************************
     * Step 3/4/5: Process one xpathStar group using your algorithm
     ********************************************************************/
    function paintGroupByReferenceMedian({
                                             group,               // { xpathStar, members }
                                             supportThreshold,    // e.g., 0.8
                                         }) {
        const roots = group.members.map(r => r.el).filter(isElement);
        const n = roots.length;
        if (n === 0) return { paintedCount: 0, referenceIndex: -1 };

        const refPick = pickMedianSibling(roots);
        if (!refPick) return { paintedCount: 0, referenceIndex: -1 };

        const refRoot = refPick.el;
        const refIndex = refPick.idx;

        // Preorder traversal in reference subtree
        const refNodes = preorderElements(refRoot);

        // For each sibling, maintain mapping: referenceNode -> matchedNode
        // We'll store in WeakMap for each sibling index
        const matchMaps = new Array(n).fill(null).map(() => new WeakMap());

        // Seed: root matches root
        for (let s = 0; s < n; s++) {
            matchMaps[s].set(refRoot, roots[s]);
        }

        let newlyPainted = 0;

        // Traverse reference nodes top-down
        for (const u of refNodes) {
            if (!isElement(u)) continue;

            // For each sibling, attempt to match u using matched parent anchoring
            const parentRef = u.parentElement;

            // If u is refRoot, it's already anchored
            const matched = new Array(n).fill(null);

            for (let s = 0; s < n; s++) {
                // If u is refRoot:
                if (u === refRoot) {
                    matched[s] = roots[s];
                    continue;
                }

                // Find matched parent in sibling s
                const sibParent = parentRef ? matchMaps[s].get(parentRef) : null;
                if (!sibParent || !isElement(sibParent)) {
                    matched[s] = null;
                    continue;
                }

                // Find best match under that parent
                const m = findBestMatchWithinParent({ refNode: u, sibParent });
                matched[s] = m;

                if (m) {
                    matchMaps[s].set(u, m);
                }
            }

            // Compute support
            const matchCount = matched.filter(Boolean).length;
            const support = matchCount / n;

            if (support >= supportThreshold) {
                // Paint reference node and all matched nodes
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
            paintedCount: newlyPainted,
            referenceIndex: refIndex,
            referenceCount: refPick.count,
            siblingCount: n,
            xpathStar: group.xpathStar
        };
    }

    /********************************************************************
     * After painting: map every painted node to its sibling index (for colors)
     *
     * Requirement: each sibling's painted subgraph gets a unique color.
     ********************************************************************/
    function buildPaintedElToSiblingIndexForGroups(groups) {
        // Map<Element, number>
        // If painted nodes overlap across siblings/groups, we keep first seen.
        const elToSiblingIndex = new Map();

        for (const g of groups) {
            const roots = g.members.map(r => r.el).filter(isElement);

            for (let s = 0; s < roots.length; s++) {
                const root = roots[s];
                if (!root) continue;

                // Traverse subtree of this sibling root; mark painted nodes
                const stack = [root];
                while (stack.length) {
                    const el = stack.pop();
                    if (!isElement(el)) continue;

                    if (hasPaint(el)) {
                        if (!elToSiblingIndex.has(el)) elToSiblingIndex.set(el, s);
                    }

                    const children = el.children;
                    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
                }
            }
        }

        return elToSiblingIndex;
    }

    /********************************************************************
     * DOT builder (whole page; collision-free ids; tag-only label)
     ********************************************************************/
    function buildDotWholePage({
                                   rootEl = document.body,
                                   elToSiblingIndex = new Map(),
                                   title = CFG.dotTitle,
                               } = {}) {
        if (!isElement(rootEl)) throw new Error("rootEl must be an Element");

        // Unique DOT ids (no collisions)
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

        const nodes = new Map(); // dotId -> info
        const edges = [];

        const stack = [rootEl];
        while (stack.length) {
            const el = stack.pop();
            if (!isElement(el)) continue;

            const id = getId(el);

            if (!nodes.has(id)) {
                const painted = hasPaint(el) && elToSiblingIndex.has(el);
                const sidx = elToSiblingIndex.get(el);

                const fill = painted ? siblingColor(sidx) : "white";
                const font = painted ? "white" : "gray20";
                const border = painted ? fill : "gray60";

                nodes.set(id, {
                    label: tagOnlyLabel(el),
                    fillcolor: fill,
                    fontcolor: font,
                    bordercolor: border,
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
        dot += "digraph DOMPaintedCores {\n";
        dot += `  graph [rankdir=TB, fontsize=12, labelloc="t", label="${esc(title)}"];\n`;
        dot += '  node  [shape=box, style="rounded,filled", fontsize=9, fontname="Helvetica"];\n';
        dot += '  edge  [color="gray70"];\n\n';

        for (const [id, info] of nodes.entries()) {
            dot += `  ${id} [label="${info.label}", fillcolor="${info.fillcolor}", color="${info.bordercolor}", fontcolor="${info.fontcolor}"];\n`;
        }

        dot += "\n";
        for (const [a, b] of edges) {
            if (nodes.has(a) && nodes.has(b)) dot += `  ${a} -> ${b};\n`;
        }

        dot += "}\n";
        return { dot, nodesCount: nodes.size, edgesCount: edges.length };
    }

    /********************************************************************
     * Run pipeline:
     * 1) Optionally clear existing data-paint
     * 2) For each xpathStar group: paint using median reference algorithm
     * 3) Build DOT and download
     ********************************************************************/
    function run({
                     minGroupSize = CFG.minGroupSize,
                     supportThreshold = CFG.supportThreshold,
                     rootEl = document.body,
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

        // Paint each group
        const groupSummaries = [];
        for (const g of groupsAll) {
            const summary = paintGroupByReferenceMedian({
                group: g,
                supportThreshold,
            });
            groupSummaries.push(summary);
        }

        // Map painted elements -> sibling index (within its group) for coloring
        const elToSiblingIndex = buildPaintedElToSiblingIndexForGroups(groupsAll);

        // DOT
        const { dot, nodesCount, edgesCount } = buildDotWholePage({
            rootEl,
            elToSiblingIndex,
            title: dotTitle,
        });

        // Expose for debugging
        window.__paintCoreMedian = {
            CFG: { minGroupSize, supportThreshold },
            groups: groupsAll,
            groupSummaries,
            elToSiblingIndex,
            dot,
        };

        downloadText(dotFilename, dot);

        console.log("✅ Painted via median reference algorithm.");
        console.table(groupSummaries.map(s => ({
            xpathStar: s.xpathStar,
            siblings: s.siblingCount,
            refSiblingIndex: s.referenceIndex,
            refSubtreeCount: s.referenceCount,
            newlyPainted: s.paintedCount
        })));
        console.log(`✅ DOT saved to window.__paintCoreMedian.dot and downloaded as ${dotFilename}`);
        console.log(`DOT stats: nodes=${nodesCount}, edges=${edgesCount}`);
        return { groupSummaries, nodesCount, edgesCount };
    }

    /********************************************************************
     * Public API (incremental)
     ********************************************************************/
    window.__paintCoreMedianToolkit = {
        CFG,
        run,

        // Useful inspectors:
        clearPaintOnWholePage,
        countSubtreeElements,
        preorderElements,
        getXPathStarGroups: (opts) => {
            const minGroupSize = opts?.minGroupSize ?? CFG.minGroupSize;
            const out = [];
            const byXPathStar = window.__commentFeatureScan.xpath.byXPathStar;
            for (const [xpathStar, members] of byXPathStar.entries()) {
                if (!members?.length) continue;
                if (members.length < minGroupSize) continue;
                out.push({ xpathStar, members });
            }
            out.sort((a, b) => b.members.length - a.members.length);
            return out;
        },
    };

    console.log(
        "✅ __paintCoreMedianToolkit ready.\n" +
        "Run:\n" +
        "  __paintCoreMedianToolkit.run({ minGroupSize: 4, supportThreshold: 0.8 })\n" +
        "Inspect:\n" +
        "  window.__paintCoreMedian.groupSummaries\n" +
        "  window.__paintCoreMedian.elToSiblingIndex\n"
    );
})();
