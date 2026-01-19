/**
 * Detect whether a candidate element (and its descendants)
 * contains any "comment-related" keyword in:
 *   - attribute names
 *   - attribute values
 *   - text content
 *
 * Returns: { has_related_keyword: boolean }
 */

function detectRelatedKeyword(rootEl) {
    if (!rootEl) {
        return { has_related_keyword: false };
    }

    // ~50-ish tokens that often show up around comments / replies / threads
    const RELATED_KEYWORDS = [
        // core "comment" variants
        "comment", "comments", "commenter", "commenting",
        "comment-body", "comment_body", "commenttext", "comment-text",
        "commentlist", "comment-list", "commentthread", "comment-thread",

        // short forms
        "cmt", "cmnt",

        // reply / response
        "reply", "replies", "respond", "response", "responses",
        "replyto", "reply-to", "in-reply-to",

        // discussion / thread / conversation
        "discussion", "discussions", "thread", "threads",
        "conversation", "conversations", "conv",

        // message / post
        "message", "messages", "msg", "msgs",
        "post", "posts", "posting", "posted",

        // feedback / review / rating
        "feedback", "review", "reviews", "rating", "ratings",

        // general talk-ish
        "chat", "chats", "forum", "forums", "topic", "topics",

        // opinion / reaction / remark / note
        "opinion", "opinions", "reaction", "reactions",
        "remark", "remarks", "note", "notes",

        // annotations (inline comments)
        "annotation", "annotations", "inline-comment", "inlinecomments"
    ];

    // helper: does a string relate to any keyword?
    function matchesRelated(str) {
        if (!str) return false;
        const text = String(str).toLowerCase();

        for (const kw of RELATED_KEYWORDS) {
            const key = kw.toLowerCase();

            // substring in BOTH directions (as requested)
            // - attribute contains keyword
            // - keyword contains attribute (useful if attribute is short token)
            if (text.includes(key) || key.includes(text)) {
                return true;
            }
        }
        return false;
    }

    let has_related_keyword = false;

    const walker = document.createTreeWalker(
        rootEl,
        NodeFilter.SHOW_ELEMENT,
        null,
        false
    );

    function checkElement(el) {
        // 1. Check element's own text content
        const text = (el.textContent || "").trim();
        if (matchesRelated(text)) {
            has_related_keyword = true;
            return;
        }

        // 2. Check common attribute bundles directly
        if (matchesRelated(el.className)) {
            has_related_keyword = true;
            return;
        }
        if (matchesRelated(el.id)) {
            has_related_keyword = true;
            return;
        }

        // 3. Check all attributes: names AND values
        if (el.attributes) {
            for (const attr of el.attributes) {
                const attrName  = attr.name.toLowerCase();
                const attrValue = (attr.value || "").toLowerCase();

                if (matchesRelated(attrName) || matchesRelated(attrValue)) {
                    has_related_keyword = true;
                    return;
                }
            }
        }
    }

    // check rootEl itself
    checkElement(rootEl);

    while (!has_related_keyword && walker.nextNode()) {
        const el = walker.currentNode;
        checkElement(el);
    }

    return { has_related_keyword };
}
