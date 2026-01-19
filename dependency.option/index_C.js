(() => {
    if (!window.__commentFeatureScan?.results?.length) {
        console.warn("Run your scan first so __commentFeatureScan.results exists.");
        return;
    }

    /********************************************************************
     * CONFIG — tune these
     ********************************************************************/
    const CFG = {
        // Which subtree to visualize:
        // - Use document.body for global view
        // - Or use a specific candidate: __commentFeatureScan.results[0].el
        rootEl: document.body,

        // Size limits (DOT gets huge fast)
        maxNodes: 20000,
        maxDepth: 1000,

        // Define what "red" means:
        // If ANY of these fields are true / positive, node becomes red.
        // These correspond to "Individual Positive" signals you’re tracking.
        redIfAny: [
            "has_avatar",
            "has_author",
            "has_relative_time_or_timestamp",
            "has_microaction",
            "has_related_keyword",
            "link_with_at_or_hash",
            "emoji_only",
            "emoji_mixed",
            "has_question",
            // include if you want: node has meaningful text
            // "has_text_content",
        ],

        // Also treat word count as a trigger if >= threshold (optional)
        redIfWordCountAtLeast: 6,

        // Label options
        labelMaxLen: 60,
        showXpathStarIfPresent: false, // only if you already attached xpathStar
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
        // Make a stable-ish DOT id from the element's path in the DOM
        // (not XPath, just a hashed identity)
        const path = [];
        let cur = el;
        while (cur && cur.nodeType === 1 && path.length < 12) {
            const tag = cur.tagName.toLowerCase();
            // index among same-tag siblings
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

    function shortLabel(el, rec) {
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : "";
        const cls = el.className ? "." + String(el.className).trim().split(/\s+/).slice(0, 2).join(".") : "";
        let text = "";

        // include tiny text snippet if it exists (helps visually)
        const t = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (t) text = " — " + t.slice(0, CFG.labelMaxLen);

        let extra = "";
        if (rec?.features) {
            const fired = [];
            for (const k of CFG.redIfAny) if (rec.features[k]) fired.push(k);
            const wc = rec.features.text_word_count || 0;
            if (CFG.redIfWordCountAtLeast && wc >= CFG.redIfWordCountAtLeast) fired.push(`wc>=${CFG.redIfWordCountAtLeast}`);
            if (fired.length) extra = `\\n[${fired.slice(0, 4).join(", ")}${fired.length > 4 ? ", ..." : ""}]`;
        }

        let star = "";
        if (CFG.showXpathStarIfPresent && rec?.xpathStar) {
            star = `\\n${rec.xpathStar}`;
        }

        return esc(`${tag}${id}${cls}${text}${extra}${star}`);
    }

    function isRed(rec) {
        if (!rec?.features) return false;

        for (const k of CFG.redIfAny) {
            if (rec.features[k]) return true;
        }

        const wc = rec.features.text_word_count || 0;
        if (CFG.redIfWordCountAtLeast && wc >= CFG.redIfWordCountAtLeast) return true;

        return false;
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
    const nodes = new Map(); // id -> { label, red }

    const stack = [{ el: root, depth: 0 }];
    let count = 0;

    while (stack.length && count < CFG.maxNodes) {
        const { el, depth } = stack.pop();
        if (!el || el.nodeType !== 1) continue;
        if (depth > CFG.maxDepth) continue;

        const rec = byEl.get(el);
        const id = nodeId(el);

        if (!nodes.has(id)) {
            nodes.set(id, {
                label: shortLabel(el, rec),
                red: isRed(rec)
            });
            count++;
        }

        // children
        const children = el.children;
        for (let i = children.length - 1; i >= 0; i--) {
            const child = children[i];
            if (!child || child.nodeType !== 1) continue;

            const cid = nodeId(child);
            edges.push([id, cid]);

            stack.push({ el: child, depth: depth + 1 });
        }
    }

    // Build DOT
    let dot = "";
    dot += "digraph DOMRedMap {\n";
    dot += '  graph [rankdir=TB, fontsize=12, labelloc="t", label="DOM Red Map (red = any Individual Positive feature)"];\n';
    dot += '  node  [shape=box, style="rounded", fontsize=9, fontname="Helvetica"];\n';
    dot += '  edge  [color="gray70"];\n\n';

    // Nodes
    for (const [id, info] of nodes.entries()) {
        if (info.red) {
            dot += `  ${id} [label="${info.label}", color="red", fontcolor="red"];\n`;
        } else {
            dot += `  ${id} [label="${info.label}", color="gray60", fontcolor="gray20"];\n`;
        }
    }

    dot += "\n";
    // Edges (only draw edges where both endpoints are included)
    for (const [a, b] of edges) {
        if (nodes.has(a) && nodes.has(b)) dot += `  ${a} -> ${b};\n`;
    }

    dot += "}\n";

    window.__domRedDot = dot;
    console.log("✅ DOT saved to window.__domRedDot");
    downloadText("dom_red_map.dot", dot);
    console.log("⬇️ Downloaded dom_red_map.dot");
})();
