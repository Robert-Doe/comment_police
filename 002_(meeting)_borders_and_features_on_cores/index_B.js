(() => {
    if (!window.__commentFeatureScan?.results) {
        console.warn("Run the scan first so __commentFeatureScan.results exists.");
        return;
    }

    /********************************************************************
     * XPath helpers
     ********************************************************************/
    function getElementIndexAmongSameTag(el) {
        // 1-based index among siblings with same tag name (XPath convention)
        const tag = el.tagName;
        let idx = 1;
        let sib = el.previousElementSibling;
        while (sib) {
            if (sib.tagName === tag) idx++;
            sib = sib.previousElementSibling;
        }
        return idx;
    }

    function getXPathParts(el) {
        // Returns array from root->leaf, each part like "div[2]"
        const parts = [];
        let cur = el;

        while (cur && cur.nodeType === Node.ELEMENT_NODE) {
            const tag = cur.tagName.toLowerCase();

            // Stop at html to keep it clean, but include html
            const index = getElementIndexAmongSameTag(cur);
            parts.push(`${tag}[${index}]`);

            if (tag === "html") break;
            cur = cur.parentElement;
        }

        return parts.reverse();
    }

    function toXPath(parts) {
        return "/" + parts.join("/");
    }

    function getXPath(el) {
        return toXPath(getXPathParts(el));
    }

    function getParentXPath(el) {
        if (!el || !el.parentElement) return null;
        return getXPath(el.parentElement);
    }

    // Replace last segment index with [*] (conceptual sibling wildcard)
    function getXPathStar(el) {
        const parts = getXPathParts(el);
        if (parts.length === 0) return null;

        // turn "div[3]" into "div[*]"
        const last = parts[parts.length - 1];
        const starred = last.replace(/\[\d+\]$/, "[*]");
        parts[parts.length - 1] = starred;

        return toXPath(parts);
    }

    /********************************************************************
     * Grouping
     ********************************************************************/
    const results = window.__commentFeatureScan.results;

    // Add xpaths to each result record
    for (const r of results) {
        try {
            r.xpath = getXPath(r.el);
            r.parentXPath = getParentXPath(r.el);
            r.xpathStar = getXPathStar(r.el);
            r.tagLower = r.tag.toLowerCase();
        } catch (e) {
            r.xpath = null;
            r.parentXPath = null;
            r.xpathStar = null;
        }
    }

    // Group: all results that share the same parentXPath (siblings, any tag)
    const byParentXPath = new Map();
    for (const r of results) {
        if (!r.parentXPath) continue;
        if (!byParentXPath.has(r.parentXPath)) byParentXPath.set(r.parentXPath, []);
        byParentXPath.get(r.parentXPath).push(r);
    }

    // Group: all results that share the same xpathStar (siblings of same tag under same parent)
    const byXPathStar = new Map();
    for (const r of results) {
        if (!r.xpathStar) continue;
        if (!byXPathStar.has(r.xpathStar)) byXPathStar.set(r.xpathStar, []);
        byXPathStar.get(r.xpathStar).push(r);
    }

    // Sort each group by actual DOM order (optional)
    function domOrderSort(a, b) {
        if (a.el === b.el) return 0;
        const pos = a.el.compareDocumentPosition(b.el);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
    }
    for (const arr of byParentXPath.values()) arr.sort(domOrderSort);
    for (const arr of byXPathStar.values()) arr.sort(domOrderSort);

    /********************************************************************
     * Helper query functions
     ********************************************************************/
    function summarize(r) {
        return {
            score: Number(r.score.toFixed?.(2) ?? r.score),
            tag: r.tag,
            id: r.id,
            className: r.className,
            xpath: r.xpath,
            xpathStar: r.xpathStar,
            parentXPath: r.parentXPath,
            has_avatar: r.features?.has_avatar,
            has_author: r.features?.has_author,
            has_time: r.features?.has_relative_time_or_timestamp,
            has_micro: r.features?.has_microaction,
            related_kw: r.features?.has_related_keyword,
            words: r.features?.text_word_count,
            emoji: r.features?.emoji_count
        };
    }

    // Given an index in results[], return sibling group (same parent)
    function siblingsByIndex(i) {
        const r = results[i];
        if (!r?.parentXPath) return [];
        return byParentXPath.get(r.parentXPath) || [];
    }

    // Given an index in results[], return same-tag siblings (xpathStar)
    function sameTagSiblingsByIndex(i) {
        const r = results[i];
        if (!r?.xpathStar) return [];
        return byXPathStar.get(r.xpathStar) || [];
    }

    // Find "best" sibling groups to inspect:
    // groups with many members and high average score
    function topSiblingGroups({ minSize = 4, topN = 10 } = {}) {
        const groups = [];

        for (const [parentXPath, arr] of byParentXPath.entries()) {
            if (arr.length < minSize) continue;
            const sum = arr.reduce((s, x) => s + (x.score || 0), 0);
            const avg = sum / arr.length;
            const max = Math.max(...arr.map(x => x.score || 0));
            groups.push({ parentXPath, size: arr.length, avgScore: avg, maxScore: max, members: arr });
        }

        groups.sort((a, b) => (b.avgScore - a.avgScore) || (b.size - a.size));
        return groups.slice(0, topN);
    }

    function highlightGroup(arr) {
        if (!arr?.length) return;
        for (const r of arr) {
            r.el.style.outline = "2px solid orange";
        }
        setTimeout(() => {
            for (const r of arr) r.el.style.outline = "";
        }, 1500);
    }

    function getCommonParent(arr) {
        if (!arr?.length) return null;
        return arr[0].el.parentElement || null;
    }

    /********************************************************************
     * Attach to __commentFeatureScan
     ********************************************************************/
    window.__commentFeatureScan.xpath = {
        getXPath,
        getXPathStar,
        getParentXPath,
        byParentXPath,
        byXPathStar,
        siblingsByIndex,
        sameTagSiblingsByIndex,
        topSiblingGroups,
        highlightGroup,
        getCommonParent,
        summarize,
    };

    console.log(
        "✅ XPath + sibling grouping ready.\n" +
        "Try:\n" +
        "  __commentFeatureScan.xpath.siblingsByIndex(0)\n" +
        "  __commentFeatureScan.xpath.sameTagSiblingsByIndex(0)\n" +
        "  __commentFeatureScan.xpath.topSiblingGroups({minSize:4, topN:10})\n" +
        "  __commentFeatureScan.xpath.highlightGroup(__commentFeatureScan.xpath.siblingsByIndex(0))"
    );
})();
