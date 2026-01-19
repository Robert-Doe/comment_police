
/**
 * Detect whether the subtree contains a "more options" / "show more" button/link.
 *
 * Returns:
 *   { has_more_options_button: boolean }
 */
function detectMoreOptionsButton(rootEl) {
    const result = { has_more_options_button: false };
    if (!rootEl || !(rootEl instanceof Element)) return result;

    const CANDIDATE_TAGS = new Set(["BUTTON", "A", "SPAN", "DIV"]);

    // Common words around "more" controls
    const MORE_BASE_WORDS = [
        "more", "all", "rest", "other", "additional", "extra"
    ];

    const MORE_CONTEXT_WORDS = [
        "replies", "comments", "answers", "messages",
        "posts", "items", "results", "reactions"
    ];

    const MENU_WORDS = [
        "options", "option", "menu", "actions", "action",
        "settings", "details", "overflow"
    ];

    const ELLIPSIS_CHARS = ["…", "⋯", "..."];

    // Simple clickable heuristic
    function isElementClickable(el) {
        if (!el || !(el instanceof Element)) return false;
        const tag = el.tagName;

        if (tag === "A" && el.hasAttribute("href")) return true;
        if (tag === "BUTTON") return true;
        if (el.hasAttribute("role")) {
            const role = el.getAttribute("role").toLowerCase();
            if (role === "button" || role === "link" || role === "menuitem") return true;
        }
        if (typeof el.onclick === "function" || el.hasAttribute("onclick")) return true;
        if (el.tabIndex >= 0) return true;

        return false;
    }

    function normalizeText(str) {
        return (str || "").toLowerCase().replace(/\s+/g, " ").trim();
    }

    // Remove spaces/punctuation to catch creative spellings, e.g. "show_more"
    function squash(str) {
        return (str || "").toLowerCase().replace(/[\s_\-:.]+/g, "");
    }

    // Does string contain something like "show more", "view all", "load more replies", etc.?
    function matchesMoreLabel(text) {
        if (!text) return false;
        const norm = normalizeText(text);
        const squashed = squash(text);

        if (!norm && !squashed) return false;

        // Direct phrases
        const directPatterns = [
            /\bshow\s+(more|all)\b/,
            /\bview\s+(more|all)\b/,
            /\bsee\s+(more|all)\b/,
            /\bload\s+(more|all)\b/,
            /\bread\s+more\b/,
            /\bexpand\b/,
            /\bcollapse\b/,
            /\bopen\s+menu\b/,
            /\bmore\s+options?\b/,
            /\bmore\s+actions?\b/,
            /\bmore\s+settings\b/,
            /\bmore\s+details\b/
        ];
        if (directPatterns.some(re => re.test(norm))) {
            return true;
        }

        // "more replies", "all comments", "more comments", etc.
        for (const more of MORE_BASE_WORDS) {
            for (const ctx of MORE_CONTEXT_WORDS) {
                const re = new RegExp(`\\b${more}\\s+${ctx}\\b`);
                if (re.test(norm)) return true;
            }
        }

        // Just ellipsis-like text: "…", "⋯", "..."
        if (ELLIPSIS_CHARS.some(ch => norm === ch || norm === ch.trim())) {
            return true;
        }

        // Squashed patterns: "showmore", "viewall", "loadmorecomments", "moreoptions"
        const squashedPatterns = [
            "showmore", "viewmore", "seemore", "loadmore", "readmore", "expandall",
            "moreoptions", "moreactions", "morecomments", "morereplies"
        ];
        if (squashedPatterns.some(p => squashed.includes(p) || p.includes(squashed))) {
            return true;
        }

        // If it contains "more" and any menu-ish word near it, consider it a hit
        if (norm.includes("more")) {
            if (MENU_WORDS.some(w => norm.includes(w))) return true;
            if (MORE_CONTEXT_WORDS.some(w => norm.includes(w))) return true;
        }

        return false;
    }

    // Check element via text + attributes
    function elementLooksLikeMoreButton(el) {
        if (!CANDIDATE_TAGS.has(el.tagName)) return false;
        if (!isElementClickable(el)) return false;

        // 1. Text content
        const text = normalizeText(el.textContent || "");
        if (matchesMoreLabel(text)) return true;

        // 2. aria-label / title
        const ariaLabel = normalizeText(el.getAttribute("aria-label") || "");
        const title = normalizeText(el.getAttribute("title") || "");
        if (matchesMoreLabel(ariaLabel) || matchesMoreLabel(title)) {
            return true;
        }

        // 3. class / id / data-* attributes
        let attrBlob = (el.className || "") + " " + (el.id || "");
        for (const attr of el.attributes || []) {
            attrBlob += " " + attr.name + " " + attr.value;
        }

        const blobNorm = normalizeText(attrBlob);
        const blobSquashed = squash(attrBlob);

        // Common class/id patterns: "more-options", "overflow-menu", "ellipsis", "kebab-menu"
        const classIdPatterns = [
            "moreoptions", "more-actions", "moreactions", "overflowmenu",
            "overflow-menu", "ellipsis", "kebab", "contextmenu", "dropdown"
        ];

        if (classIdPatterns.some(p => blobSquashed.includes(p))) {
            return true;
        }

        // Attribute blob mentions "more" with menu-ish words
        if (blobNorm.includes("more")) {
            if (MENU_WORDS.some(w => blobNorm.includes(w))) return true;
            if (MORE_CONTEXT_WORDS.some(w => blobNorm.includes(w))) return true;
        }

        return false;
    }

    const walker = document.createTreeWalker(
        rootEl,
        NodeFilter.SHOW_ELEMENT,
        null,
        false
    );

    // also check rootEl itself
    if (elementLooksLikeMoreButton(rootEl)) {
        result.has_more_options_button = true;
        return result;
    }

    while (walker.nextNode()) {
        const el = walker.currentNode;
        if (elementLooksLikeMoreButton(el)) {
            result.has_more_options_button = true;
            break;
        }
    }

    return result;
}
