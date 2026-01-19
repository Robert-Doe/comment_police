/**
 * Detect microaction signals inside a candidate element.
 * Returns { has_microaction: boolean, action_count: number }
 */

function detectMicroactions(rootEl) {
    if (!rootEl) return { has_microaction: false, action_count: 0 };

    // Allowed tags that commonly carry interaction actions
    const ACTION_TAGS = new Set(["BUTTON", "A", "SPAN", "DIV", "SVG", "IMG"]);

    // All microaction keywords (normalized to lowercase)
    const MICROACTION_KEYWORDS = [
        // reply
        "reply", "respond", "answer", "quote",

        // vote/like
        "like", "upvote", "heart", "dislike", "downvote",

        // share/permalink
        "share", "permalink", "copylink", "copy link",

        // report/moderation
        "report", "flag", "block", "mute"
    ];

    // Normalize tokens for boundary-safe matching
    const tokens = MICROACTION_KEYWORDS.map(t => t.toLowerCase());

    let has_microaction = false;
    let action_count = 0; // number of *distinct* categories matched

    // Deduplicate categories encountered
    const matchedCategories = new Set();

    /**
     * Check if a string contains any token
     */
    function matchTokens(str) {
        if (!str) return null;
        const text = str.toLowerCase();

        for (const token of tokens) {
            // Use boundary-safe: check as whole word or simple substring
            if (text.includes(token)) {
                return token; // return the actual matched token
            }
        }
        return null;
    }

    /**
     * Traverse all descendants (including root)
     */
    const walker = document.createTreeWalker(
        rootEl,
        NodeFilter.SHOW_ELEMENT,
        null,
        false
    );

    while (walker.nextNode()) {
        const el = walker.currentNode;

        // Must match one of the allowed tags
        if (!ACTION_TAGS.has(el.tagName)) continue;

        // 1. Check textContent
        const tokenFromText = matchTokens(el.textContent);
        if (tokenFromText) {
            has_microaction = true;
            matchedCategories.add(tokenFromText);
        }

        // 2. Check all attributes (both name and value)
        for (const attr of el.attributes) {
            const tokenFromName = matchTokens(attr.name);
            if (tokenFromName) {
                has_microaction = true;
                matchedCategories.add(tokenFromName);
            }

            const tokenFromValue = matchTokens(attr.value);
            if (tokenFromValue) {
                has_microaction = true;
                matchedCategories.add(tokenFromValue);
            }
        }
    }

    // Distinct action types found
    action_count = matchedCategories.size;

    return { has_microaction, action_count };
}
