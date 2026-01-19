(() => {
    // Preconditions
    if (!window.__commentFeatureScan?.results?.length) {
        console.warn("Run your scan first so __commentFeatureScan.results exists.");
        return;
    }
    if (!window.__commentFeatureScan?.xpath?.byXPathStar) {
        console.warn("Run the XPath grouping step first so __commentFeatureScan.xpath.byXPathStar exists.");
        return;
    }

    /********************************************************************
     * CONFIG
     ********************************************************************/
    const CFG = {
        rootEl: document.body, // whole page

        // DOT size limits
        maxNodes: 20000,
        maxDepth: 1500,

        // "Core" selection heuristic per xpathStar group:
        // choose the sibling root with the smallest subtree (element count).
        coreCountMaxNodes: 4000, // cap per subtree counting (speed)
        coreCountMaxDepth: 1000,   // cap per subtree counting (speed)

        // Only consider xpathStar groups of at least this size
        minGroupSize: 2,

        // Color the nodes inside each core subtree (not just the core root)
        colorEntireCoreSubtree: true,

        // If core subtrees overlap across groups, keep the first color assignment
        keepFirstColorOnOverlap: true,

        // Download file name
        dotFilename: "dom_core_groups.dot",
    };

    /********************************************************************
     * Index scan results by element (optional metadata)
     ********************************************************************/
    const byEl = new Map();
    for (const r of window.__commentFeatureScan.results) byEl.set(r.el, r);

    /********************************************************************
     * Helpers
     ********************************************************************/
    const esc = (s) =>
        String(s ?? "")
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/\n/g, "\\n");

    function nodeId(el) {
        // Stable-ish DOT id derived from DOM path indices
        const path = [];
        let cur = el;
        while (cur && cur.nodeType === 1 && path.length < 12) {
            const tag = cur.tagName.toLowerCase();
            let idx = 1;
            let sib = cur.previousElementSibling;
            while (sib) {
                if (sib.tagName === cur.tagName) idx++;
                sib = sib.previousElementSibling;
            }
            path.push(`${tag}[${idx}]`);
            cur = cur.parentElement;
        }
        const s = path.reverse().join("/");
        let h = 0;
        for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
        return "n" + Math.abs(h);
    }

    // ✅ Tag-only labels (no id/class/text)
    function tagOnlyLabel(el) {
        return esc(el.tagName.toLowerCase());
    }

    function downloadText(filename, text) {
        const blob = new Blob([text], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 500);
    }

    function cappedSubtreeElementCount(root, maxNodes, maxDepth) {
        // Counts ELEMENT nodes in root subtree, capped
        let count = 0;
        const stack = [{ el: root, depth: 0 }];
        while (stack.length && count < maxNodes) {
            const { el, depth } = stack.pop();
            if (!el || el.nodeType !== 1) continue;
            if (depth > maxDepth) continue;
            count++;
            const children = el.children;
            for (let i = children.length - 1; i >= 0; i--) {
                stack.push({ el: children[i], depth: depth + 1 });
            }
        }
        return count;
    }

    function collectSubtreeElements(root, maxNodes, maxDepth) {
        const out = [];
        const stack = [{ el: root, depth: 0 }];
        while (stack.length && out.length < maxNodes) {
            const { el, depth } = stack.pop();
            if (!el || el.nodeType !== 1) continue;
            if (depth > maxDepth) continue;
            out.push(el);
            const children = el.children;
            for (let i = children.length - 1; i >= 0; i--) {
                stack.push({ el: children[i], depth: depth + 1 });
            }
        }
        return out;
    }

    /********************************************************************
     * Color palette (distinct, repeats if more groups than colors)
     ********************************************************************/
    const PALETTE = [
        "#8B0000", // deep red
        "#B22222",
        "#DC143C",
        "#FF4500",
        "#FF8C00",
        "#DAA520",
        "#228B22",
        "#2E8B57",
        "#1E90FF",
        "#4169E1",
        "#6A5ACD",
        "#8A2BE2",
        "#9932CC",
        "#C71585",
        "#A52A2A",
        "#008B8B",
        "#20B2AA",
        "#556B2F",
        "#708090",
        "#2F4F4F",
    ];

    /********************************************************************
     * 1) Build core for each xpathStar group
     ********************************************************************/
    const byXPathStar = window.__commentFeatureScan.xpath.byXPathStar;

    // Filter groups by size
    const groups = [];
    for (const [star, members] of byXPathStar.entries()) {
        if (!members?.length) continue;
        if (members.length < CFG.minGroupSize) continue;
        groups.push({ xpathStar: star, members });
    }
    groups.sort((a, b) => b.members.length - a.members.length);

    // For each group, pick core root = smallest subtree
    const coreGroups = groups
        .map((g, idx) => {
            let best = null;
            let bestCount = Infinity;

            for (const r of g.members) {
                const el = r.el;
                if (!el || el.nodeType !== 1) continue;
                const c = cappedSubtreeElementCount(el, CFG.coreCountMaxNodes, CFG.coreCountMaxDepth);
                if (c < bestCount) {
                    bestCount = c;
                    best = r;
                }
            }

            const color = PALETTE[idx % PALETTE.length];
            return {
                xpathStar: g.xpathStar,
                size: g.members.length,
                color,
                core: best,
                coreSubtreeCount: bestCount === Infinity ? 0 : bestCount,
            };
        })
        .filter((x) => x.core?.el);

    // Element -> color map, based on membership in core subtree
    const elToColor = new Map();

    for (const cg of coreGroups) {
        const coreEl = cg.core.el;
        const color = cg.color;

        const targets = CFG.colorEntireCoreSubtree
            ? collectSubtreeElements(coreEl, CFG.coreCountMaxNodes, CFG.coreCountMaxDepth)
            : [coreEl];

        for (const el of targets) {
            if (!el || el.nodeType !== 1) continue;

            if (CFG.keepFirstColorOnOverlap) {
                if (!elToColor.has(el)) elToColor.set(el, color);
            } else {
                elToColor.set(el, color);
            }
        }
    }

    console.log(`✅ Found ${coreGroups.length} repeating xpathStar groups (>=${CFG.minGroupSize}).`);
    console.table(
        coreGroups.map((g, i) => ({
            idx: i,
            groupSize: g.size,
            color: g.color,
            xpathStar: g.xpathStar,
            coreTag: g.core.tag,
            coreId: g.core.id,
            coreClass: g.core.className,
            coreSubtreeCount: g.coreSubtreeCount,
        }))
    );

    /********************************************************************
     * 2) Build DOT for the whole page; color nodes in any core subtree
     ********************************************************************/
    const root = CFG.rootEl;
    if (!root || root.nodeType !== 1) {
        console.warn("CFG.rootEl must be an Element.");
        return;
    }

    const edges = [];
    const nodes = new Map(); // id -> { label, fillcolor, fontcolor, bordercolor }

    const stack = [{ el: root, depth: 0 }];
    let count = 0;

    while (stack.length && count < CFG.maxNodes) {
        const { el, depth } = stack.pop();
        if (!el || el.nodeType !== 1) continue;
        if (depth > CFG.maxDepth) continue;

        const id = nodeId(el);
        if (!nodes.has(id)) {
            const inCore = elToColor.has(el);
            const fill = elToColor.get(el) || "white";
            nodes.set(id, {
                label: tagOnlyLabel(el), // ✅ ONLY tag name
                fillcolor: fill,
                fontcolor: inCore ? "white" : "gray20",
                bordercolor: inCore ? fill : "gray60",
            });
            count++;
        }

        const children = el.children;
        for (let i = children.length - 1; i >= 0; i--) {
            const child = children[i];
            if (!child || child.nodeType !== 1) continue;

            const cid = nodeId(child);
            edges.push([id, cid]);
            stack.push({ el: child, depth: depth + 1 });
        }
    }

    let dot = "";
    dot += "digraph DOMCoreGroups {\n";
    dot += '  graph [rankdir=TB, fontsize=12, labelloc="t", label="DOM Core Groups (colored = core subtrees by xpathStar)"];\n';
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

    window.__domCoreGroupsDot = dot;
    window.__domCoreGroups = {
        CFG,
        coreGroups,
        elToColor,
        explain() {
            return {
                coreGroupCount: coreGroups.length,
                note:
                    "coreGroups[i].core.el is the chosen core root for each xpathStar group; elToColor maps element->group color (core subtree membership). Node labels are tag-only.",
            };
        },
    };

    console.log("✅ DOT saved to window.__domCoreGroupsDot and metadata to window.__domCoreGroups");
    downloadText(CFG.dotFilename, dot);
    console.log(`⬇️ Downloaded ${CFG.dotFilename}`);
})();
