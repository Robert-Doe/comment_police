// file_A.js (PER-NODE FEATURES ONLY; same __commentFeatureScan API)

(() => {
    /********************************************************************
     * Options (tune these first)
     ********************************************************************/
    const OPT = {
        maxElements: Number.MAX_VALUE,        // hard cap on number of element nodes analyzed
        maxDepth: Number.MAX_VALUE,            // traversal depth cap

        // kept for compatibility (no longer used in per-node mode)
        maxSubtreeTextNodes: 2500,
        maxSubtreeElements: 2500,

        skipTags: new Set(["SCRIPT", "STYLE", "NOSCRIPT", "META", "LINK", "HEAD"]),
        requireVisible: true,      // skip invisible elements
    };

    /********************************************************************
     * Utility helpers
     ********************************************************************/
    const isElement = (n) => n && n.nodeType === Node.ELEMENT_NODE;

    // IMPORTANT:
    // - "prune" mode: only returns false when subtree is truly invisible (display:none, visibility:hidden, opacity:0)
    // - "record" mode: also checks rect dimensions to decide whether to record this node as "visible"
    function isVisible(el, mode = "record") {
        if (!isElement(el)) return false;

        const cs = getComputedStyle(el);
        if (!cs) return false;

        if (cs.display === "none") return false;
        if (cs.visibility === "hidden") return false;
        if (parseFloat(cs.opacity) === 0) return false;

        if (mode === "record") {
            const rect = el.getBoundingClientRect();
            if (!rect || rect.width === 0 || rect.height === 0) return false;
        }

        return true;
    }

    function safeStr(x) {
        try { return String(x ?? ""); } catch { return ""; }
    }

    function normalizeText(str) {
        return safeStr(str).toLowerCase().replace(/\s+/g, " ").trim();
    }

    /********************************************************************
     * PER-NODE ONLY helpers
     ********************************************************************/

    // Direct text of the element only (ignores descendant text)
    function directText(el) {
        if (!isElement(el)) return "";
        let out = "";
        for (const n of el.childNodes) {
            if (n && n.nodeType === Node.TEXT_NODE) out += (n.nodeValue || "");
        }
        return out;
    }

    /********************************************************************
     * Individual Positive Feature Detectors (PER-NODE ONLY)
     ********************************************************************/

    // 1) Text stats (per-node: direct text only)
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
        if (!isElement(rootEl)) return result;

        const mentionOrHashtagRegex = /[@#][\w]+/u;
        const urlRegex = /\bhttps?:\/\/\S+|\bwww\.\S+/i;
        const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;

        const raw = directText(rootEl);
        const normalized = raw.replace(/\s+/g, " ").trim();
        if (!normalized) return result;

        result.has_text_content = true;

        const totalTextLen = normalized.length;

        // Words
        const words = normalized.split(/\s+/).filter(Boolean);
        result.text_word_count = words.length;

        // Mentions / hashtags
        result.text_contains_mentions_or_hashtags = mentionOrHashtagRegex.test(normalized);

        // Emoji
        if (/[\u0080-\uFFFF]/.test(normalized)) {
            const emojiMatches = normalized.match(emojiRegex);
            if (emojiMatches && emojiMatches.length) {
                result.emoji_count = emojiMatches.length;
                result.text_contains_emoji = true;
            }
        }

        // Question marks
        let q = 0;
        for (let i = 0; i < normalized.length; i++) {
            if (normalized[i] === "?") q++;
        }
        result.text_question_mark_count = q;

        // Link detection (per-node):
        // - If this element itself is <a href>, treat direct text as link text.
        // - Else detect URL-like strings in direct text.
        let linkTextLen = 0;
        if (rootEl.tagName === "A" && rootEl.hasAttribute("href")) {
            result.text_contains_links = true;
            linkTextLen += totalTextLen;
        } else {
            const urlMatches = normalized.match(urlRegex);
            if (urlMatches) {
                result.text_contains_links = true;
                for (const m of urlMatches) linkTextLen += m.length;
            }
        }

        result.link_density = totalTextLen > 0 ? (linkTextLen / totalTextLen) : 0;

        return result;
    }

    // 2) Related keyword (per-node: only own attrs + direct text)
    function detectRelatedKeyword(rootEl) {
        if (!isElement(rootEl)) return { has_related_keyword: false };

        const RELATED_KEYWORDS = [
            "comment","comments","commenter","commenting",
            "comment-body","comment_body","commenttext","comment-text",
            "commentlist","comment-list","commentthread","comment-thread",
            "cmt","cmnt",
            "reply","replies","respond","response","responses",
            "replyto","reply-to","in-reply-to",
            "discussion","discussions","thread","threads","conversation","conversations","conv",
            "message","messages","msg","msgs","post","posts","posting","posted",
            "feedback","review","reviews","rating","ratings",
            "chat","chats","forum","forums","topic","topics",
            "opinion","opinions","reaction","reactions","remark","remarks","note","notes",
            "annotation","annotations","inline-comment","inlinecomments"
        ];

        function matchesRelated(str) {
            if (!str) return false;
            const text = normalizeText(str);
            if (!text) return false;

            for (const kw of RELATED_KEYWORDS) {
                const key = kw.toLowerCase();
                if (text.includes(key)) return true;
                if (text.length >= 5 && key.includes(text)) return true;
            }
            return false;
        }

        // direct text only
        const t = normalizeText(directText(rootEl));
        if (t && t.length <= 60 && matchesRelated(t)) return { has_related_keyword: true };

        // common attributes
        if (matchesRelated(rootEl.className) || matchesRelated(rootEl.id)) return { has_related_keyword: true };

        // aria/title
        if (matchesRelated(rootEl.getAttribute("aria-label")) || matchesRelated(rootEl.getAttribute("title"))) {
            return { has_related_keyword: true };
        }

        // all attributes
        if (rootEl.attributes) {
            for (const attr of rootEl.attributes) {
                if (matchesRelated(attr.name) || matchesRelated(attr.value)) {
                    return { has_related_keyword: true };
                }
            }
        }

        return { has_related_keyword: false };
    }

    // 3) Microactions (per-node: ONLY the element itself)
    function detectMicroactions(rootEl) {
        if (!isElement(rootEl)) return { has_microaction: false, action_count: 0, matched_tokens: [] };

        const ACTION_TAGS = new Set(["BUTTON", "A", "SPAN", "DIV", "SVG", "IMG"]);
        if (!ACTION_TAGS.has(rootEl.tagName)) {
            return { has_microaction: false, action_count: 0, matched_tokens: [] };
        }

        const TOKENS = [
            "reply","respond","answer","quote",
            "like","upvote","heart","dislike","downvote",
            "share","permalink","copylink","copy link",
            "report","flag","block","mute",
            "edit","pin","pinned"
        ];

        function isClickable(el) {
            if (!isElement(el)) return false;
            if (el.tagName === "BUTTON") return true;
            if (el.tagName === "A" && el.hasAttribute("href")) return true;
            const role = normalizeText(el.getAttribute("role") || "");
            if (role === "button" || role === "link" || role === "menuitem") return true;
            if (typeof el.onclick === "function" || el.hasAttribute("onclick")) return true;
            if (el.hasAttribute("aria-label") || el.hasAttribute("title")) return true;
            if (el.hasAttribute("aria-pressed") || el.hasAttribute("aria-expanded")) return true;
            return false;
        }

        function matchTokenInAttr(str) {
            if (!str) return null;
            const s = normalizeText(str);
            for (const t of TOKENS) if (s.includes(t)) return t;
            return null;
        }

        function matchTokenInLabel(str) {
            if (!str) return null;
            const s = normalizeText(str).replace(/[^\p{L}\p{N}\s]+/gu, " ");
            const parts = new Set(s.split(/\s+/).filter(Boolean));
            for (const t of TOKENS) if (parts.has(t)) return t;
            if (s.includes("copy link")) return "copy link";
            return null;
        }

        if (!isClickable(rootEl)) return { has_microaction: false, action_count: 0, matched_tokens: [] };

        const matched = new Set();

        const aria = rootEl.getAttribute("aria-label") || "";
        const title = rootEl.getAttribute("title") || "";
        const alt = rootEl.getAttribute("alt") || "";
        const t1 = matchTokenInLabel(`${aria} ${title} ${alt}`);
        if (t1) matched.add(t1);

        // direct text only
        const txt = normalizeText(directText(rootEl));
        if (txt && txt.length <= 40) {
            const t2 = matchTokenInLabel(txt);
            if (t2) matched.add(t2);
        }

        // attributes
        if (rootEl.attributes) {
            for (const attr of rootEl.attributes) {
                const t3 = matchTokenInAttr(attr.name) || matchTokenInAttr(attr.value);
                if (t3) matched.add(t3);
            }
        }

        return {
            has_microaction: matched.size > 0,
            action_count: matched.size,
            matched_tokens: Array.from(matched)
        };
    }

    // 4) Metadata (per-node: ONLY the element itself)
    function detectMetadata(rootEl) {
        if (!isElement(rootEl)) return { has_author: false, has_avatar: false, has_timestamp: false };

        const AUTHOR_TAGS = new Set(["A", "SPAN", "DIV", "P"]);
        const AUTHOR_KEYWORDS = ["author","user","username","profile","byline","handle","nickname"];

        const AVATAR_TAGS = new Set(["IMG", "DIV", "SPAN", "SVG"]);
        const AVATAR_KEYWORDS = ["avatar","userpic","profile-pic","profilepic","user-icon","userphoto","user-photo"];

        const TIMESTAMP_ATTR_NAMES = ["datetime","data-time","data-timestamp","data-created","data-epoch"];

        const RELATIVE_AGE_REGEX =
            /\b(\d+\s*(sec|second|min|minute|hour|hr|day|week|month|year)s?\s*ago|just now|today|yesterday|\d+\s*[smhdwy]\b)/i;
        const ABSOLUTE_DATE_REGEX = /\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/;
        const MONTH_NAME_DATE_REGEX = new RegExp(
            String.raw`\b(?:` +
            `(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)` +
            `\s+\d{1,2},?(?:\s+20\d{2})?` +
            `|` +
            `\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)` +
            `,?(?:\s+20\d{2})?` +
            `)\b`, "i"
        );

        function containsKeyword(str, keywords) {
            if (!str) return false;
            const text = normalizeText(str);
            return keywords.some(kw => text.includes(kw));
        }

        function isTimestampAttrName(name) {
            return TIMESTAMP_ATTR_NAMES.includes(safeStr(name).toLowerCase());
        }

        // AUTHOR (per-node): tag + keyword-ish attrs + name-like direct text
        let has_author = false;
        if (AUTHOR_TAGS.has(rootEl.tagName)) {
            const attrBlob = [
                safeStr(rootEl.className),
                safeStr(rootEl.id),
                safeStr(rootEl.getAttribute("rel")),
                safeStr(rootEl.getAttribute("itemprop")),
                safeStr(rootEl.getAttribute("data-user")),
                safeStr(rootEl.getAttribute("data-username")),
                safeStr(rootEl.getAttribute("data-author")),
            ].join(" ");

            if (containsKeyword(attrBlob, AUTHOR_KEYWORDS)) {
                const t = normalizeText(directText(rootEl));
                if (t.length >= 2 && t.length <= 40 && !AUTHOR_KEYWORDS.includes(t)) {
                    has_author = true;
                }
            }
        }

        // AVATAR (per-node): only this element
        let has_avatar = false;
        if (AVATAR_TAGS.has(rootEl.tagName)) {
            const attrBlob = [
                safeStr(rootEl.className),
                safeStr(rootEl.id),
                safeStr(rootEl.getAttribute("alt")),
                safeStr(rootEl.getAttribute("title")),
                safeStr(rootEl.getAttribute("aria-label")),
                safeStr(rootEl.getAttribute("src")),
            ].join(" ");

            if (containsKeyword(attrBlob, AVATAR_KEYWORDS)) {
                if (rootEl.tagName === "IMG") {
                    const w = rootEl.naturalWidth || rootEl.width || 0;
                    const h = rootEl.naturalHeight || rootEl.height || 0;
                    has_avatar = !(w && h && (w > 250 || h > 250));
                } else {
                    has_avatar = true;
                }
            }
        }

        // TIMESTAMP (per-node): tag/attrs/direct text only
        let has_timestamp = false;
        if (rootEl.tagName === "TIME") {
            has_timestamp = true;
        } else if (rootEl.attributes) {
            for (const attr of rootEl.attributes) {
                if (isTimestampAttrName(attr.name)) { has_timestamp = true; break; }
            }
        }

        if (!has_timestamp) {
            const t = normalizeText(directText(rootEl));
            if (t && t.length <= 80) {
                if (RELATIVE_AGE_REGEX.test(t) || ABSOLUTE_DATE_REGEX.test(t) || MONTH_NAME_DATE_REGEX.test(t)) {
                    has_timestamp = true;
                }
            }
        }

        return { has_author, has_avatar, has_timestamp };
    }

    /********************************************************************
     * Individual Positive Feature Aggregation (same output keys)
     ********************************************************************/
    function computeIndividualPositiveFeatures(el) {
        const textStats = detectTextStats(el);
        const related = detectRelatedKeyword(el);
        const micro = detectMicroactions(el);
        const meta = detectMetadata(el);

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
            microaction_tokens: micro.matched_tokens
        };

        // score formula unchanged (10-slot logic)
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
            Math.min(1, features.text_word_count / 30) * 0.5;

        return { features, score };
    }

    /********************************************************************
     * DOM Traversal + Data Collection (same as before)
     ********************************************************************/
    const results = [];
    const stack = [{ el: document.body, depth: 0 }];
    let visited = 0;

    while (stack.length && visited < OPT.maxElements) {
        const { el, depth } = stack.pop();
        if (!isElement(el)) continue;
        if (OPT.skipTags.has(el.tagName)) continue;
        if (depth > OPT.maxDepth) continue;

        // prune traversal only if truly invisible
        if (OPT.requireVisible && !isVisible(el, "prune")) continue;

        // record only if "record-visible"
        const shouldRecord = !OPT.requireVisible || isVisible(el, "record");

        if (shouldRecord) {
            const { features, score } = computeIndividualPositiveFeatures(el);

            results.push({
                el,
                depth,
                tag: el.tagName,
                id: el.id || "",
                className: safeStr(el.className).slice(0, 140),
                score,
                features
            });

            visited++;
        }

        // Always traverse children (and open shadow roots) like before
        const children = [];

        const lightKids = el.children;
        for (let i = 0; i < lightKids.length; i++) children.push(lightKids[i]);

        const sr = el.shadowRoot;
        if (sr && sr.children && sr.children.length) {
            for (let i = 0; i < sr.children.length; i++) children.push(sr.children[i]);
        }

        for (let i = children.length - 1; i >= 0; i--) {
            stack.push({ el: children[i], depth: depth + 1 });
        }
    }

    results.sort((a, b) => b.score - a.score);

    /********************************************************************
     * Expose helpers to window for inspection (same API)
     ********************************************************************/
    window.__commentFeatureScan = {
        OPT,
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
        },
        highlight(i = 0) {
            const r = results[i];
            if (!r) return null;
            r.el.scrollIntoView({ behavior: "smooth", block: "center" });
            r.el.style.outline = "3px solid red";
            setTimeout(() => (r.el.style.outline = ""), 1500);
            console.log("Highlighted:", r);
            return r;
        },
        get(i = 0) {
            return results[i] || null;
        }
    };

    console.log(
        `✅ Scan complete (PER-NODE features): analyzed ${results.length} elements. ` +
        `Use __commentFeatureScan.top(20), __commentFeatureScan.highlight(0), __commentFeatureScan.get(0)`
    );
})();
