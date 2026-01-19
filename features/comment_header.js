/**
 * Detect a nearby "Comments (N)" / "N Comments" style header for a candidate.
 *
 * Walks up ancestors (up to maxAncestorDepth), looking for heading-ish elements
 * that:
 *   - mention comments/replies/discussion/etc.
 *   - optionally include a count, sometimes in brackets.
 *
 * Returns:
 *   {
 *     has_comment_count_header: boolean,
 *     comment_count: number | null
 *   }
 */

function detectCommentCountHeader(rootEl, options = {}) {
    if (!rootEl) {
        return {
            has_comment_count_header: false,
            comment_count: null
        };
    }

    const maxAncestorDepth = options.maxAncestorDepth ?? 10;

    const COMMENT_WORDS = [
        "comment", "comments",
        "reply", "replies",
        "answer", "answers",
        "discussion", "discussions",
        "review", "reviews", "response", "responses"
    ];

    function matchesCommentKeyword(str) {
        if (!str) return false;
        const text = String(str).toLowerCase();
        return COMMENT_WORDS.some(kw => text.includes(kw));
    }

    // Extract number from text where comments/replies/etc. appear
   /* function extractCountFromText(text) {
        if (!text) return null;
        const lower = text.toLowerCase().replace(/\s+/g, " ").trim();

        // First make sure it even talks about comments/replies/etc.
        if (!matchesCommentKeyword(lower)) return null;

        // Patterns:
        //   "comments (23)" / "comments: 23" / "comments 23"
        //   "(23) comments" / "23 comments"
        const pattern = new RegExp(
            String.raw`
        \b(?:comments?|replies|answers|discussion|reviews?)\b[^\d]{0,6}\(?(\d{1,5})\)?|
        \(?(\d{1,5})\)?[^\w]{0,6}\b(?:comments?|replies|answers|discussion|reviews?)\b
      `,
            "ix" // ignore case, allow whitespace in pattern
        );

        const match = pattern.exec(lower);
        if (!match) return null;

        const numStr = match[1] || match[2];
        if (!numStr) return null;

        const num = parseInt(numStr, 10);
        return Number.isNaN(num) ? null : num;
    }*/

    function extractCountFromText(text) {
        if (!text) return null;
        const lower = text.toLowerCase().replace(/\s+/g, " ").trim();

        // First ensure keyword present
        if (!matchesCommentKeyword(lower)) return null;

        // REGEX FIXED:
        // Matches:
        //   "comments (23)"
        //   "comments: 23"
        //   "comments 23"
        //   "(23) comments"
        //   "23 comments"
        const pattern = /\b(?:comments?|replies|answers|discussion|reviews?)\b[^\d]{0,6}\(?(\d{1,5})\)?|\(?(\d{1,5})\)?[^\w]{0,6}\b(?:comments?|replies|answers|discussion|reviews?)\b/;

        const match = pattern.exec(lower);
        if (!match) return null;

        const numStr = match[1] || match[2];
        if (!numStr) return null;

        const num = parseInt(numStr, 10);
        return Number.isNaN(num) ? null : num;
    }


    // Sometimes the header text is just "(23)" and the comment-ness is in attributes.
    function extractCountFromBracketOnly(text, el) {
        if (!text || !el) return null;
        const lower = text.toLowerCase().replace(/\s+/g, " ").trim();

        // look for "(23)" or "[23]"
        const m = lower.match(/[\(\[]\s*(\d{1,5})\s*[\)\]]/);
        if (!m) return null;

        // only treat it as a comment count if attributes suggest "comments"
        let attrBlob = (el.className || "") + " " + (el.id || "");
        for (const attr of el.attributes || []) {
            attrBlob += " " + attr.name + " " + attr.value;
        }
        attrBlob = attrBlob.toLowerCase();

        if (!matchesCommentKeyword(attrBlob)) return null;

        const num = parseInt(m[1], 10);
        return Number.isNaN(num) ? null : num;
    }

    // Attributes like data-comments-count="23", comments_count="5", etc.
    function extractCountFromAttributes(el) {
        if (!el || !el.attributes) return null;

        for (const attr of el.attributes) {
            const name = attr.name.toLowerCase();
            const value = (attr.value || "").toLowerCase();

            const isCountName =
                name.includes("count") ||
                name.includes("num") ||
                name.includes("total");

            const looksCommentish =
                matchesCommentKeyword(name) || matchesCommentKeyword(value);

            if (isCountName || looksCommentish) {
                const m = value.match(/\d{1,5}/);
                if (m) {
                    const num = parseInt(m[0], 10);
                    if (!Number.isNaN(num)) return num;
                }
            }
        }
        return null;
    }

    function isHeadingLike(el) {
        if (!el) return false;
        const tag = el.tagName;
        if (/^H[1-6]$/.test(tag)) return true;

        const role = (el.getAttribute("role") || "").toLowerCase();
        if (role === "heading") return true;

        const cls = (el.className || "").toString().toLowerCase();
        if (cls.includes("title") || cls.includes("heading") || cls.includes("header")) {
            return true;
        }

        return false;
    }

    // Collect ancestors up to maxAncestorDepth (including rootEl itself)
    const ancestors = [];
    let current = rootEl;
    let depth = 0;
    while (current && depth <= maxAncestorDepth) {
        ancestors.push(current);
        current = current.parentElement;
        depth++;
    }

    let has_comment_count_header = false;
    let comment_count = null;

    // For each ancestor, search for heading-ish elements that look like comment headers
    for (const ancestor of ancestors) {
        // Limit search: headings + header-ish elements inside this ancestor
        const candidates = ancestor.querySelectorAll(
            "h1,h2,h3,h4,h5,h6,[role='heading'],[class*='title'],[class*='header']"
        );

        for (const headerEl of candidates) {
            const text = (headerEl.textContent || "").trim();

            // 1) Try extracting count directly from text
            let count = extractCountFromText(text);

            // 2) If that failed, try bracket-only pattern + comment-y attrs
            if (count == null) {
                count = extractCountFromBracketOnly(text, headerEl);
            }

            // 3) If still null, check attributes for a data-comments-count-style value
            if (count == null) {
                count = extractCountFromAttributes(headerEl);
            }

            const textBlob = text.toLowerCase();
            const attrsBlob =
                ((headerEl.className || "") + " " + (headerEl.id || "")).toLowerCase();

            const isCommentHeader =
                matchesCommentKeyword(textBlob) || matchesCommentKeyword(attrsBlob);

            if (isCommentHeader || count != null) {
                has_comment_count_header = true;
                if (count != null) {
                    comment_count = count;
                }
                // We can stop once we find the first plausible header
                return { has_comment_count_header, comment_count };
            }
        }
    }

    return { has_comment_count_header, comment_count };
}
