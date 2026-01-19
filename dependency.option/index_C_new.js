(() => {
    if (!window.__commentFeatureScan?.results?.length) {
        console.warn("Run your scan first so __commentFeatureScan.results exists.");
        return;
    }

    /********************************************************************
     * CONFIG — tune these
     ********************************************************************/
    const CFG = {
        rootEl: document.body,
        maxNodes: 900,
        maxDepth: 18,

        // The 8 "full-point" boolean features used in scoring
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

        // The two remaining scoring contributions:
        // 9) has_question (0.5 in score) -> count as 1 slot for coloring
        questionKey: "has_question",

        // 10) word-count term (0.5*min(1, wc/30)) saturates at wc>=30
        // Count as 1 slot when wc >= wordSlotAtLeast
        wordSlotAtLeast: 30,

        // 10-step ramp (light -> deepest red)
        // Level 1 corresponds to count=1, Level 10 corresponds to count=10
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

        // Visual label settings
        labelFontSize: 12,
    };

    /********************************************************************
     * Index scan results by element for O(1) lookup
     ********************************************************************/
    const byEl = new Map();
    for (const r of __commentFeatureScan.results) byEl.set(r.el, r);

    /********************************************************************
     * Helpers
     ********************************************************************/
    const esc = (s) =>
        String(s ?? "")
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/\n/g, "\\n");

    function nodeId(el) {
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

    // Returns integer feature count in [0..10]
    function featureCount(rec) {
        if (!rec?.features) return 0;

        let c = 0;

        // 8 full-point boolean features
        for (const k of CFG.scoreBoolKeys) if (rec.features[k]) c++;

        // question "slot"
        if (rec.features[CFG.questionKey]) c++;

        // word-count "slot" (saturating term)
        const wc = rec.features.text_word_count || 0;
        if (wc >= CFG.wordSlotAtLeast) c++;

        // clamp just in case
        if (c < 0) c = 0;
        if (c > 10) c = 10;

        return c;
    }

    // Map count -> fill color (0 => gray, 1..10 => ramp)
    function fillColor(count) {
        if (!count) return "#f0f0f0"; // for 0 features
        return CFG.colors[Math.min(10, Math.max(1, count)) - 1];
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

    /********************************************************************
     * Traverse subtree and build DOT
     ********************************************************************/
    const root = CFG.rootEl;
    if (!root || root.nodeType !== 1) {
        console.warn("CFG.rootEl must be an Element.");
        return;
    }

    const edges = [];
    const nodes = new Map(); // id -> { label, count, fill }

    const stack = [{ el: root, depth: 0 }];
    let countNodes = 0;

    while (stack.length && countNodes < CFG.maxNodes) {
        const { el, depth } = stack.pop();
        if (!el || el.nodeType !== 1) continue;
        if (depth > CFG.maxDepth) continue;

        const rec = byEl.get(el);
        const id = nodeId(el);

        if (!nodes.has(id)) {
            const c = featureCount(rec);       // 0..10
            const fill = fillColor(c);

            nodes.set(id, {
                label: esc(String(c)),           // label is just the number
                count: c,
                fill,
            });
            countNodes++;
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

    /********************************************************************
     * Build DOT
     ********************************************************************/
    let dot = "";
    dot += "digraph DOMFeatureHeatmap {\n";
    dot += '  graph [rankdir=TB, fontsize=12, labelloc="t", label="DOM Feature Heatmap (node label = # scoring-features matched, 0..10)"];\n';
    dot += `  node  [shape=circle, style="filled", fontsize=${CFG.labelFontSize}, fontname="Helvetica", color="gray40"];\n`;
    dot += '  edge  [color="gray70"];\n\n';

    // Nodes: use fillcolor to show intensity; fontcolor switches for readability
    for (const [id, info] of nodes.entries()) {
        const fontcolor = info.count >= 6 ? "white" : "black";
        dot += `  ${id} [label="${info.label}", fillcolor="${info.fill}", fontcolor="${fontcolor}"];\n`;
    }

    dot += "\n";
    for (const [a, b] of edges) {
        if (nodes.has(a) && nodes.has(b)) dot += `  ${a} -> ${b};\n`;
    }
    dot += "}\n";

    window.__domRedDot = dot; // keeping your name for compatibility
    console.log("✅ DOT saved to window.__domRedDot");
    downloadText("dom_feature_heatmap.dot", dot);
    console.log("⬇️ Downloaded dom_feature_heatmap.dot");
})();
