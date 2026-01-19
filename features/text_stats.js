/*
/!**
 * Analyze text content under a root element.
 *
 * Returns:
 * {
 *   has_text_content: boolean,
 *   text_word_count: number,
 *   text_contains_links: boolean,
 *   link_density: number, // 0..1
 *   text_contains_mentions_or_hashtags: boolean,
 *   text_contains_emoji: boolean,
 *   emoji_count: number
 * }
 *!/
function detectTextStats(rootEl) {
    const result = {
        has_text_content: false,
        text_word_count: 0,
        text_contains_links: false,
        link_density: 0,
        text_contains_mentions_or_hashtags: false,
        text_contains_emoji: false,
        emoji_count: 0
    };

    if (!rootEl) return result;

    let totalTextLen = 0;
    let linkTextLen = 0;

    // Regex for mentions / hashtags (simple form)
    const mentionOrHashtagRegex = /[@#][\w]+/u;

    // Regex for URL-like strings in text
    const urlRegex = /\bhttps?:\/\/\S+|\bwww\.\S+/i;

    // Emoji regex (modern browsers support these Unicode properties)
    const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;

    function isInsideLink(node) {
        let el = node.parentNode;
        while (el && el.nodeType === Node.ELEMENT_NODE) {
            if (el.tagName === "A") return true;
            el = el.parentNode;
        }
        return false;
    }

    // Walk TEXT nodes only
    const walker = document.createTreeWalker(
        rootEl,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );

    while (walker.nextNode()) {
        const textNode = walker.currentNode;
        let text = textNode.nodeValue || "";
        // Normalize whitespace
        const normalized = text.replace(/\s+/g, " ").trim();
        if (!normalized) continue;

        result.has_text_content = true;

        const len = normalized.length;
        totalTextLen += len;

        // Word count
        const words = normalized.split(/\s+/);
        result.text_word_count += words.filter(Boolean).length;

        // Mentions / hashtags
        if (!result.text_contains_mentions_or_hashtags &&
            mentionOrHashtagRegex.test(normalized)) {
            result.text_contains_mentions_or_hashtags = true;
        }

        // Emojis
        const emojiMatches = normalized.match(emojiRegex);
        if (emojiMatches && emojiMatches.length > 0) {
            result.emoji_count += emojiMatches.length;
            result.text_contains_emoji = true;
        }

        // Links: via <a> ancestor or URL-like text
        let thisNodeLinkTextLen = 0;
        const insideAnchor = isInsideLink(textNode);

        if (insideAnchor) {
            thisNodeLinkTextLen += len;
            result.text_contains_links = true;
        }

        // URL-like substrings in text not necessarily inside <a>
        const urlMatches = normalized.match(urlRegex);
        if (urlMatches) {
            result.text_contains_links = true;
            // Approx: add URL text length to link text
            for (const m of urlMatches) {
                thisNodeLinkTextLen += m.length;
            }
        }

        linkTextLen += thisNodeLinkTextLen;
    }

    if (totalTextLen > 0) {
        result.link_density = linkTextLen / totalTextLen;
    } else {
        result.link_density = 0;
    }

    return result;
}
*/

/**
 * Analyze text content under a root element.
 *
 * Returns:
 * {
 *   has_text_content: boolean,
 *   text_word_count: number,
 *   text_contains_links: boolean,
 *   link_density: number,
 *   text_contains_mentions_or_hashtags: boolean,
 *   text_contains_emoji: boolean,
 *   emoji_count: number,
 *   text_question_mark_count: number
 * }
 */
function detectTextStats(rootEl) {
    const result = {
        has_text_content: false,
        text_word_count: 0,
        text_contains_links: false,
        link_density: 0,
        text_contains_mentions_or_hashtags: false,
        text_contains_emoji: false,
        emoji_count: 0,
        text_question_mark_count: 0
    };

    if (!rootEl) return result;

    let totalTextLen = 0;
    let linkTextLen = 0;

    // Regex for mentions / hashtags
    const mentionOrHashtagRegex = /[@#][\w]+/u;

    // URL-like text
    const urlRegex = /\bhttps?:\/\/\S+|\bwww\.\S+/i;

    // Emoji detection
    const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;

    function isInsideLink(node) {
        let el = node.parentNode;
        while (el && el.nodeType === Node.ELEMENT_NODE) {
            if (el.tagName === "A") return true;
            el = el.parentNode;
        }
        return false;
    }

    // Walk all TEXT nodes
    const walker = document.createTreeWalker(
        rootEl,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );

    while (walker.nextNode()) {
        const textNode = walker.currentNode;
        let text = textNode.nodeValue || "";

        // Normalize whitespace
        const normalized = text.replace(/\s+/g, " ").trim();
        if (!normalized) continue;

        result.has_text_content = true;

        const len = normalized.length;
        totalTextLen += len;

        // Words
        const words = normalized.split(/\s+/);
        result.text_word_count += words.filter(Boolean).length;

        // Mentions OR hashtags
        if (!result.text_contains_mentions_or_hashtags &&
            mentionOrHashtagRegex.test(normalized)) {
            result.text_contains_mentions_or_hashtags = true;
        }

        // Emoji
        const emojiMatches = normalized.match(emojiRegex);
        if (emojiMatches && emojiMatches.length > 0) {
            result.emoji_count += emojiMatches.length;
            result.text_contains_emoji = true;
        }

        // Count question marks
        const qMarks = normalized.match(/\?/g);
        if (qMarks) {
            result.text_question_mark_count += qMarks.length;
        }

        // Link detection
        let thisNodeLinkTextLen = 0;
        const insideAnchor = isInsideLink(textNode);

        if (insideAnchor) {
            thisNodeLinkTextLen += len;
            result.text_contains_links = true;
        }

        // URL-like strings
        const urlMatches = normalized.match(urlRegex);
        if (urlMatches) {
            result.text_contains_links = true;
            for (const m of urlMatches) {
                thisNodeLinkTextLen += m.length;
            }
        }

        linkTextLen += thisNodeLinkTextLen;
    }

    // link density
    if (totalTextLen > 0) {
        result.link_density = linkTextLen / totalTextLen;
    } else {
        result.link_density = 0;
    }

    return result;
}

