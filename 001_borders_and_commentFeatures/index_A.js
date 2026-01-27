(() => {
    /********************************************************************
     * Per-node-only comment feature extraction
     *  - NO subtree scanning
     *  - Only: element itself + its attributes + direct text nodes
     ********************************************************************/

    const OPT_LOCAL = {
        maxElements: 20000,
        maxDepth: 120,
        skipTags: new Set(["SCRIPT", "STYLE", "NOSCRIPT", "META", "LINK", "HEAD"]),
        requireVisible: false, // turn on if you want; visibility uses layout info
    };

    /********************************************************************
     * Utilities
     ********************************************************************/
    const isElement = (n) => n && n.nodeType === Node.ELEMENT_NODE;

    function safeStr(x) {
        try { return String(x ?? ""); } catch { return ""; }
    }

    function normalizeText(str) {
        return safeStr(str).toLowerCase().replace(/\s+/g, " ").trim();
    }

    // Direct text nodes ONLY (no descendants)
    function directTextOf(el) {
        if (!isElement(el)) return "";
        let out = "";
        for (let n = el.firstChild; n; n = n.nextSibling) {
            if (n.nodeType === Node.TEXT_NODE && n.nodeValue) out += " " + n.nodeValue;
        }
        return out.replace(/\s+/g, " ").trim();
    }

    function isVisible(el) {
        if (!isElement(el)) return false;
        const rect = el.getBoundingClientRect();
        if (!rect || rect.width === 0 || rect.height === 0) return false;

        const cs = getComputedStyle(el);
        if (!cs) return false;
        if (cs.display === "none") return false;
        if (cs.visibility === "hidden") return false;
        if (parseFloat(cs.opacity) === 0) return false;

        return true;
    }

    /********************************************************************
     * 1) Text stats — PER NODE ONLY
     *    (uses direct text nodes only; anchor/link only if element itself is <a>)
     ********************************************************************/
    function detectTextStatsNode(el) {
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
        if (!isElement(el)) return result;

        const mentionOrHashtagRegex = /[@#][\w]+/u;
        const urlRegex = /\bhttps?:\/\/\S+|\bwww\.\S+/i;
        const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;

        const text = directTextOf(el);
        if (!text) return result;

        result.has_text_content = true;

        const normalized = text.replace(/\s+/g, " ").trim();
        const totalLen = normalized.length;

        // Word count
        const words = normalized.split(/\s+/).filter(Boolean);
        result.text_word_count = words.length;

        // Mentions/hashtags
        result.text_contains_mentions_or_hashtags = mentionOrHashtagRegex.test(normalized);

        // Emoji (guard non-ascii for speed)
        if (/[\u0080-\uFFFF]/.test(normalized)) {
            const matches = normalized.match(emojiRegex);
            if (matches?.length) {
                result.emoji_count = matches.length;
                result.text_contains_emoji = true;
            }
        }

        // Question marks
        for (let i = 0; i < normalized.length; i++) {
            if (normalized[i] === "?") result.text_question_mark_count++;
        }

        // Link detection: only if element itself is an anchor OR if direct text contains URLs
        let linkTextLen = 0;

        if (el.tagName === "A" && el.hasAttribute("href")) {
            result.text_contains_links = true;
            linkTextLen = totalLen;
        } else {
            const urlMatches = normalized.match(urlRegex);
            if (urlMatches) {
                result.text_contains_links = true;
                for (const m of urlMatches) linkTextLen += m.length;
            }
        }

        result.link_density = totalLen > 0 ? (linkTextLen / totalLen) : 0;
        return result;
    }

    /********************************************************************
     * 2) Related keyword — PER NODE ONLY
     *    (checks only this element's attrs + direct text)
     ********************************************************************/
    function detectRelatedKeywordNode(el) {
        if (!isElement(el)) return { has_related_keyword: false };

        const RELATED_KEYWORDS = [
            "comment","comments","commenter","commenting",
            "comment-body","comment_body","commenttext","comment-text",
            "commentlist","comment-list","commentthread","comment-thread",
            "cmt","cmnt",
            "reply","replies","respond","response","responses",
            "replyto","reply-to","in-reply-to",
            "discussion","thread","conversation","conv",
            "message","messages","msg","post","posts","posted",
            "feedback","review","rating",
            "chat","forum","topic",
            "reaction","remark","note","annotation","inline-comment","inlinecomments"
        ];

        function matchesRelated(str) {
            const t = normalizeText(str);
            if (!t) return false;
            return RELATED_KEYWORDS.some(kw => t.includes(kw));
        }

        // Only element-local fields
        if (matchesRelated(el.className) || matchesRelated(el.id)) {
            return { has_related_keyword: true };
        }

        const aria = el.getAttribute?.("aria-label");
        const title = el.getAttribute?.("title");
        if (matchesRelated(aria) || matchesRelated(title)) {
            return { has_related_keyword: true };
        }

        if (el.attributes) {
            for (const attr of el.attributes) {
                if (matchesRelated(attr.name) || matchesRelated(attr.value)) {
                    return { has_related_keyword: true };
                }
            }
        }

        const txt = normalizeText(directTextOf(el));
        if (txt && txt.length <= 60 && matchesRelated(txt)) {
            return { has_related_keyword: true };
        }

        return { has_related_keyword: false };
    }

    /********************************************************************
     * 3) Microactions — PER NODE ONLY
     *    (only counts if THIS element is clickable and contains tokens)
     ********************************************************************/
    function detectMicroactionsNode(el) {
        if (!isElement(el)) return { has_microaction: false, action_count: 0, matched_tokens: [] };

        const TOKENS = [
            "reply","respond","answer","quote",
            "like","upvote","heart","dislike","downvote",
            "share","permalink","copylink","copy link",
            "report","flag","block","mute",
            "edit","pin","pinned"
        ];

        function isClickableSelf(x) {
            const tag = x.tagName;
            if (tag === "BUTTON") return true;
            if (tag === "A" && x.hasAttribute("href")) return true;
            const role = normalizeText(x.getAttribute("role") || "");
            if (role === "button" || role === "link" || role === "menuitem") return true;
            if (typeof x.onclick === "function" || x.hasAttribute("onclick")) return true;
            if (x.hasAttribute("aria-label") || x.hasAttribute("title")) return true;
            if (x.hasAttribute("aria-pressed") || x.hasAttribute("aria-expanded")) return true;
            return false;
        }

        function matchTokenInAttr(str) {
            const s = normalizeText(str);
            if (!s) return null;
            for (const t of TOKENS) {
                if (s.includes(t)) return t; // handles replyButton etc.
            }
            return null;
        }

        function matchTokenInLabel(str) {
            const s = normalizeText(str).replace(/[^\p{L}\p{N}\s]+/gu, " ");
            const parts = new Set(s.split(/\s+/).filter(Boolean));
            for (const t of TOKENS) if (parts.has(t)) return t;
            if (s.includes("copy link")) return "copy link";
            return null;
        }

        if (!isClickableSelf(el)) return { has_microaction: false, action_count: 0, matched_tokens: [] };

        const matched = new Set();

        const aria = el.getAttribute("aria-label") || "";
        const title = el.getAttribute("title") || "";
        const alt = el.getAttribute("alt") || "";
        const t1 = matchTokenInLabel(`${aria} ${title} ${alt}`);
        if (t1) matched.add(t1);

        const txt = directTextOf(el);
        if (txt && txt.length <= 40) {
            const t2 = matchTokenInLabel(txt);
            if (t2) matched.add(t2);
        }

        if (el.attributes) {
            for (const attr of el.attributes) {
                const t3 = matchTokenInAttr(attr.name) || matchTokenInAttr(attr.value);
                if (t3) matched.add(t3);
            }
        }

        return {
            has_microaction: matched.size > 0,
            action_count: matched.size,
            matched_tokens: Array.from(matched),
        };
    }

    /********************************************************************
     * 4) Metadata — PER NODE ONLY
     *    (only triggers if THIS element itself looks like author/avatar/time)
     ********************************************************************/
    function detectMetadataNode(el) {
        if (!el) {
            return { has_author: false, has_avatar: false, has_timestamp: false };
        }

        const AUTHOR_TAGS = new Set(["A", "SPAN", "DIV", "P"]);
        const AUTHOR_KEYWORDS = ["author", "user", "username", "profile", "byline", "handle", "nickname"];

        const AVATAR_TAGS = new Set(["IMG", "DIV", "SPAN", "SVG"]);
        const AVATAR_KEYWORDS = ["avatar", "userpic", "profile-pic", "profilepic", "user-icon", "userphoto", "user-photo"];

        const TIMESTAMP_ATTR_NAMES = ["datetime", "data-time", "data-timestamp", "data-created", "data-epoch"];

        const RELATIVE_AGE_REGEX =
            /\b\d+\s*(sec|second|min|minute|hour|hr|day|week|month|year)s?(?:\s*ago)?\b/i;

        const ABSOLUTE_DATE_REGEX = /\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/;

        const MONTH_NAME_DATE_REGEX = new RegExp(
            String.raw`\b(?:` +
            `(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|` +
            `jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|` +
            `oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)` +
            `\s+\d{1,2},?(?:\s+20\\d{2})?` +
            `|` +
            `\d{1,2}\s+` +
            `(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|` +
            `jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|` +
            `oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)` +
            `,?(?:\s+20\\d{2})?` +
            `)\b`,
            "i"
        );

        function containsKeyword(str, keywords) {
            if (!str) return false;
            const text = String(str).toLowerCase();
            return keywords.some(kw => text.includes(kw));
        }

        function isTimestampAttrName(name) {
            const lower = name.toLowerCase();
            return TIMESTAMP_ATTR_NAMES.includes(lower);
        }

        const USERNAME_REGEX = /^(?:@)?[a-z0-9][a-z0-9._-]{0,31}$/i;
        const EMOJI_REGEX = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;

        function looksLikeUsernameText(raw) {
            if (!raw) return false;

            const text = raw.replace(/\s+/g, " ").trim();
            if (!text) return false;

            const lower = text.toLowerCase();
            if (
                lower === "reply" ||
                lower === "like" ||
                lower === "share" ||
                lower === "report" ||
                lower.includes("hours ago") ||
                lower.includes("minutes ago")
            ) {
                return false;
            }

            const firstToken = text.split(" ")[0];
            if (/^\d+$/.test(firstToken)) return false;

            const cleaned = firstToken.replace(/^[\(\[\{<>"']+|[\)\]\}>,"']+$/g, "");
            const cleanedNoEmoji = cleaned.replace(EMOJI_REGEX, "");

            return USERNAME_REGEX.test(cleanedNoEmoji) || cleaned.startsWith("@");
        }

        function isBoldish(el2) {
            try {
                const fw = window.getComputedStyle(el2).fontWeight;
                if (fw === "bold") return true;
                const num = parseInt(fw, 10);
                return !Number.isNaN(num) && num > 400;
            } catch {
                return false;
            }
        }

        function directTextOf(node) {
            let out = "";
            for (let n = node.firstChild; n; n = n.nextSibling) {
                if (n.nodeType === Node.TEXT_NODE && n.nodeValue) out += " " + n.nodeValue;
            }
            return out;
        }

        let has_author = false;
        let has_avatar = false;
        let has_timestamp = false;

        function checkElement(el2) {
            const tag = el2.tagName;

            if (!has_author && AUTHOR_TAGS.has(tag)) {
                let attrBlob = (el2.className || "") + " " + (el2.id || "");
                for (const attr of el2.attributes || []) {
                    attrBlob += " " + attr.name + " " + attr.value;
                }
                attrBlob = attrBlob.toLowerCase();

                const text = (directTextOf(el2) || "").trim(); // STRICT local
                const usernameish = looksLikeUsernameText(text);
                const keywordish = containsKeyword(attrBlob, AUTHOR_KEYWORDS);

                if ((keywordish && usernameish) || (usernameish && isBoldish(el2))) {
                    has_author = true;
                }
            }

            if (!has_avatar && AVATAR_TAGS.has(tag)) {
                let attrBlob = (el2.className || "") + " " + (el2.id || "");
                for (const attr of el2.attributes || []) {
                    attrBlob += " " + attr.name + " " + attr.value;
                }
                attrBlob = attrBlob.toLowerCase();

                if (containsKeyword(attrBlob, AVATAR_KEYWORDS)) {
                    has_avatar = true;
                }
            }

            if (!has_timestamp) {
                if (tag === "TIME") has_timestamp = true;

                if (!has_timestamp && el2.attributes) {
                    for (const attr of el2.attributes) {
                        if (isTimestampAttrName(attr.name)) {
                            has_timestamp = true;
                            break;
                        }
                    }
                }

                if (!has_timestamp) {
                    const text = (directTextOf(el2) || "").toLowerCase().trim(); // STRICT local
                    if (
                        RELATIVE_AGE_REGEX.test(text) ||
                        ABSOLUTE_DATE_REGEX.test(text) ||
                        MONTH_NAME_DATE_REGEX.test(text)
                    ) {
                        has_timestamp = true;
                    }
                }
            }
        }

        if (el instanceof Element) checkElement(el);

        return { has_author, has_avatar, has_timestamp };
    }

    /********************************************************************
     * Aggregate per-node features + score (same schema as old)
     ********************************************************************/
    function computeIndividualPositiveFeaturesNode(el) {
        const textStats = detectTextStatsNode(el);
        const related = detectRelatedKeywordNode(el);
        const micro = detectMicroactionsNode(el);
        const meta = detectMetadataNode(el);

        const emojiOnly = (textStats.emoji_count > 0 && textStats.text_word_count === 0);
        const emojiMixed = (textStats.emoji_count > 0 && textStats.text_word_count > 0);
        const linkWithMentionOrHash = (textStats.text_contains_links && textStats.text_contains_mentions_or_hashtags);
        const hasQuestion = textStats.text_question_mark_count > 0;

        const features = {
            has_avatar: meta.has_avatar,
            has_author: meta.has_author,
            has_relative_time_or_timestamp: meta.has_timestamp,

            has_text_content: textStats.has_text_content,
            text_word_count: textStats.text_word_count,
            has_question: hasQuestion,
            question_mark_count: textStats.text_question_mark_count,

            text_contains_links: textStats.text_contains_links,
            text_contains_mentions_or_hashtags: textStats.text_contains_mentions_or_hashtags,
            link_density: textStats.link_density,
            link_with_at_or_hash: linkWithMentionOrHash,

            text_contains_emoji: textStats.text_contains_emoji,
            emoji_count: textStats.emoji_count,
            emoji_only: emojiOnly,
            emoji_mixed: emojiMixed,

            has_related_keyword: related.has_related_keyword,

            has_microaction: micro.has_microaction,
            microaction_count: micro.action_count,
            microaction_tokens: micro.matched_tokens,
        };

        const score =
            (features.has_avatar ? 1 : 0) +
            (features.has_author ? 1 : 0) +
            (features.has_relative_time_or_timestamp ? 1 : 0) +
            (features.has_related_keyword ? 1 : 0) +
            (features.has_microaction ? 1 : 0) +
            (features.link_with_at_or_hash ? 1 : 0) +
            (features.emoji_only ? 1 : 0) +
            (features.emoji_mixed ? 1 : 0) +
            (features.has_question ? 0.5 : 0) +
            Math.min(1, (features.text_word_count || 0) / 30) * 0.5;

        return { features, score };
    }

    /********************************************************************
     * Per-node scan over DOM (same traversal idea, but local features)
     ********************************************************************/
    const results = [];
    const stack = [{ el: document.body, depth: 0 }];
    let visited = 0;

    while (stack.length && visited < OPT_LOCAL.maxElements) {
        const { el, depth } = stack.pop();
        if (!isElement(el)) continue;
        if (OPT_LOCAL.skipTags.has(el.tagName)) continue;
        if (depth > OPT_LOCAL.maxDepth) continue;
        if (OPT_LOCAL.requireVisible && !isVisible(el)) continue;

        const { features, score } = computeIndividualPositiveFeaturesNode(el);

        results.push({
            el,
            depth,
            tag: el.tagName,
            id: el.id || "",
            className: safeStr(el.className).slice(0, 140),
            score,
            features,
        });

        visited++;

        const children = el.children;
        for (let i = children.length - 1; i >= 0; i--) {
            stack.push({ el: children[i], depth: depth + 1 });
        }
    }

    results.sort((a, b) => b.score - a.score);

    window.__commentFeatureScanPerNode = {
        OPT_LOCAL,
        results,
        top(n = 20) {
            const slice = results.slice(0, n);
            console.table(slice.map(r => ({
                score: r.score.toFixed(2),
                tag: r.tag,
                id: r.id,
                className: r.className,
                depth: r.depth,
                has_avatar: r.features.has_avatar,
                has_author: r.features.has_author,
                has_time: r.features.has_relative_time_or_timestamp,
                has_micro: r.features.has_microaction,
                micro_cnt: r.features.microaction_count,
                related_kw: r.features.has_related_keyword,
                words: r.features.text_word_count,
                emoji: r.features.emoji_count,
                linkAtHash: r.features.link_with_at_or_hash
            })));
            return slice;
        }
    };

    console.log(
        `✅ Per-node scan complete: analyzed ${results.length} elements.\n` +
        `Use __commentFeatureScanPerNode.top(20) or inspect __commentFeatureScanPerNode.results`
    );
})();
