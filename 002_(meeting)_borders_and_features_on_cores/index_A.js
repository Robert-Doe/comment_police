(() => {
    /********************************************************************
     * Options (tune these first)
     ********************************************************************/
    const OPT = {
        maxElements: 20000,        // hard cap on number of element nodes analyzed
        maxDepth: 2500,             // traversal depth cap
        maxSubtreeTextNodes: 2500, // cap for text-node scanning per element (for speed)
        maxSubtreeElements: 2500,  // cap for element scanning per element (for speed)
        skipTags: new Set(["SCRIPT","STYLE","NOSCRIPT","META","LINK","HEAD"]),
        requireVisible: true,     // skip invisible elements
    };

    /********************************************************************
     * Utility helpers
     ********************************************************************/
    const isElement = (n) => n && n.nodeType === Node.ELEMENT_NODE;

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

    function safeStr(x) {
        try { return String(x ?? ""); } catch { return ""; }
    }

    function normalizeText(str) {
        return safeStr(str).toLowerCase().replace(/\s+/g, " ").trim();
    }

    function squash(str) {
        return safeStr(str).toLowerCase().replace(/[\s_\-:.]+/g, "");
    }

    function cappedTreeWalk(rootEl, whatToShow, maxCount) {
        const out = [];
        const walker = document.createTreeWalker(rootEl, whatToShow, null, false);
        let i = 0;
        while (i < maxCount && walker.nextNode()) {
            out.push(walker.currentNode);
            i++;
        }
        return out;
    }

    /********************************************************************
     * Individual Positive Feature Detectors (adapted from your functions)
     *  - detectTextStats
     *  - detectRelatedKeyword
     *  - detectMicroactions
     *  - detectMetadata
     ********************************************************************/

    // 1) Text stats (mentions/hashtags, link, density, emoji, word count, question marks)
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

        const mentionOrHashtagRegex = /[@#][\w]+/u;
        const urlRegex = /\bhttps?:\/\/\S+|\bwww\.\S+/i;
        const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;

        const textNodes = cappedTreeWalk(rootEl, NodeFilter.SHOW_TEXT, OPT.maxSubtreeTextNodes);

        for (const textNode of textNodes) {
            let text = textNode.nodeValue || "";
            const normalized = text.replace(/\s+/g, " ").trim();
            if (!normalized) continue;

            result.has_text_content = true;

            const len = normalized.length;
            totalTextLen += len;

            // Words
            const words = normalized.split(/\s+/);
            result.text_word_count += words.filter(Boolean).length;

            // Mentions/hashtags
            if (!result.text_contains_mentions_or_hashtags && mentionOrHashtagRegex.test(normalized)) {
                result.text_contains_mentions_or_hashtags = true;
            }

            // Emoji (guard non-ascii for speed)
            if (/[\u0080-\uFFFF]/.test(normalized)) {
                const emojiMatches = normalized.match(emojiRegex);
                if (emojiMatches && emojiMatches.length) {
                    result.emoji_count += emojiMatches.length;
                    result.text_contains_emoji = true;
                }
            }

            // Question marks
            // (fast loop avoids allocations)
            for (let i = 0; i < normalized.length; i++) {
                if (normalized[i] === "?") result.text_question_mark_count++;
            }

            // Link detection
            let thisNodeLinkTextLen = 0;

            const parentEl = textNode.parentElement;
            const insideAnchor = parentEl ? !!parentEl.closest("a[href]") : false;

            if (insideAnchor) {
                thisNodeLinkTextLen += len;
                result.text_contains_links = true;
            } else {
                const urlMatches = normalized.match(urlRegex);
                if (urlMatches) {
                    result.text_contains_links = true;
                    for (const m of urlMatches) thisNodeLinkTextLen += m.length;
                }
            }

            linkTextLen += thisNodeLinkTextLen;
        }

        result.link_density = totalTextLen > 0 ? (linkTextLen / totalTextLen) : 0;
        return result;
    }

    // 2) Related keyword (comment/thread/reply etc.) in attributes/text (lightweight)
    function detectRelatedKeyword(rootEl) {
        if (!rootEl) return { has_related_keyword: false };

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

            // safer: only allow "keyword contains text" when text is not tiny
            for (const kw of RELATED_KEYWORDS) {
                const key = kw.toLowerCase();
                if (text.includes(key)) return true;
                if (text.length >= 5 && key.includes(text)) return true;
            }
            return false;
        }

        let has_related_keyword = false;

        // Check root only + capped subtree elements
        const els = [rootEl, ...cappedTreeWalk(rootEl, NodeFilter.SHOW_ELEMENT, OPT.maxSubtreeElements)];
        for (const el of els) {
            if (!isElement(el)) continue;

            // Prefer attributes over full descendant textContent (less noisy)
            const cls = safeStr(el.className);
            const id = safeStr(el.id);
            if (matchesRelated(cls) || matchesRelated(id)) {
                has_related_keyword = true;
                break;
            }

            // aria-label/title often holds "comments"
            const aria = el.getAttribute?.("aria-label");
            const title = el.getAttribute?.("title");
            if (matchesRelated(aria) || matchesRelated(title)) {
                has_related_keyword = true;
                break;
            }

            // As a last resort: short text only
            const txt = normalizeText(el.textContent || "");
            if (txt && txt.length <= 60 && matchesRelated(txt)) {
                has_related_keyword = true;
                break;
            }

            // Check attribute names/values (capped)
            if (el.attributes) {
                for (const attr of el.attributes) {
                    if (matchesRelated(attr.name) || matchesRelated(attr.value)) {
                        has_related_keyword = true;
                        break;
                    }
                }
            }
            if (has_related_keyword) break;
        }

        return { has_related_keyword };
    }

    // 3) Microactions (reply/like/share/report/etc.)
    function detectMicroactions(rootEl) {
        if (!rootEl) return { has_microaction: false, action_count: 0, matched_tokens: [] };

        const ACTION_TAGS = new Set(["BUTTON", "A", "SPAN", "DIV", "SVG", "IMG"]);
        const TOKENS = [
            "reply","respond","answer","quote",
            "like","upvote","heart","dislike","downvote",
            "share","permalink","copylink","copy link",
            "report","flag","block","mute",
            // (optional extras you mentioned)
            "edit","pin","pinned"
        ];

        function isClickable(el) {
            if (!isElement(el)) return false;
            const tag = el.tagName;
            if (tag === "BUTTON") return true;
            if (tag === "A" && el.hasAttribute("href")) return true;
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
            for (const t of TOKENS) {
                // attributes often contain concatenations like replyButton
                if (s.includes(t)) return t;
            }
            return null;
        }

        function matchTokenInLabel(str) {
            if (!str) return null;
            // tokenize label to avoid "likely" => "like"
            const s = normalizeText(str).replace(/[^\p{L}\p{N}\s]+/gu, " ");
            const parts = new Set(s.split(/\s+/).filter(Boolean));
            for (const t of TOKENS) {
                if (parts.has(t)) return t;
            }
            // allow "copy link" exact phrase
            if (s.includes("copy link")) return "copy link";
            return null;
        }

        const matched = new Set();

        const els = cappedTreeWalk(rootEl, NodeFilter.SHOW_ELEMENT, OPT.maxSubtreeElements);
        for (const el of els) {
            if (!ACTION_TAGS.has(el.tagName)) continue;
            if (!isClickable(el)) continue;

            // Prefer aria/title/alt over textContent
            const aria = el.getAttribute("aria-label") || "";
            const title = el.getAttribute("title") || "";
            const alt = el.getAttribute("alt") || "";
            const labelToken = matchTokenInLabel(`${aria} ${title} ${alt}`);
            if (labelToken) matched.add(labelToken);

            // Short visible text only
            const txt = (el.textContent || "").trim();
            if (txt && txt.length <= 40) {
                const t2 = matchTokenInLabel(txt);
                if (t2) matched.add(t2);
            }

            // Attributes (name + value)
            if (el.attributes) {
                for (const attr of el.attributes) {
                    const t3 = matchTokenInAttr(attr.name) || matchTokenInAttr(attr.value);
                    if (t3) matched.add(t3);
                }
            }
        }

        return {
            has_microaction: matched.size > 0,
            action_count: matched.size,
            matched_tokens: Array.from(matched)
        };
    }

    // 4) Metadata (author/avatar/timestamp)
    function detectMetadata(rootEl) {
        if (!rootEl) return { has_author: false, has_avatar: false, has_timestamp: false };

        const AUTHOR_TAGS = new Set(["A", "SPAN", "DIV"]);
        const AUTHOR_KEYWORDS = ["author","user","username","profile","byline","handle","nickname"];

        const AVATAR_TAGS = new Set(["IMG", "DIV", "SPAN"]);
        const AVATAR_KEYWORDS = ["avatar","userpic","profile-pic","profilepic","user-icon","userphoto","user-photo"];

        const TIMESTAMP_ATTR_NAMES = ["datetime","data-time","data-timestamp","data-created","data-epoch"];

        const RELATIVE_AGE_REGEX = /\b(\d+\s*(sec|second|min|minute|hour|hr|day|week|month|year)s?\s*ago|just now|today|yesterday|\d+\s*[smhdwy]\b)/i;
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

        let has_author = false;
        let has_avatar = false;
        let has_timestamp = false;

        const els = [rootEl, ...cappedTreeWalk(rootEl, NodeFilter.SHOW_ELEMENT, OPT.maxSubtreeElements)];

        for (const el of els) {
            if (!isElement(el)) continue;
            const tag = el.tagName;

            // AUTHOR
            if (!has_author && AUTHOR_TAGS.has(tag)) {
                const attrBlob = [
                    safeStr(el.className),
                    safeStr(el.id),
                    safeStr(el.getAttribute("rel")),
                    safeStr(el.getAttribute("itemprop")),
                    safeStr(el.getAttribute("data-user")),
                    safeStr(el.getAttribute("data-username")),
                    safeStr(el.getAttribute("data-author")),
                ].join(" ");

                if (containsKeyword(attrBlob, AUTHOR_KEYWORDS)) {
                    const t = (el.textContent || "").trim();
                    // simple "name-like" gating
                    const tNorm = normalizeText(t);
                    if (tNorm.length >= 2 && tNorm.length <= 40 && !AUTHOR_KEYWORDS.includes(tNorm)) {
                        has_author = true;
                    }
                }
            }

            // AVATAR
            if (!has_avatar && AVATAR_TAGS.has(tag)) {
                const attrBlob = [
                    safeStr(el.className),
                    safeStr(el.id),
                    safeStr(el.getAttribute("alt")),
                    safeStr(el.getAttribute("title")),
                    safeStr(el.getAttribute("aria-label")),
                    safeStr(el.getAttribute("src")),
                ].join(" ");

                if (containsKeyword(attrBlob, AVATAR_KEYWORDS)) {
                    // avoid huge logos when IMG
                    if (tag === "IMG") {
                        const w = el.naturalWidth || el.width || 0;
                        const h = el.naturalHeight || el.height || 0;
                        if (w && h && (w > 250 || h > 250)) {
                            // too big to be an avatar in most cases
                        } else {
                            has_avatar = true;
                        }
                    } else {
                        has_avatar = true;
                    }
                }
            }

            // TIMESTAMP
            if (!has_timestamp) {
                if (tag === "TIME") {
                    has_timestamp = true;
                } else if (el.attributes) {
                    for (const attr of el.attributes) {
                        if (isTimestampAttrName(attr.name)) {
                            has_timestamp = true;
                            break;
                        }
                    }
                }

                if (!has_timestamp) {
                    const txt = normalizeText(el.textContent || "");
                    // avoid scanning huge text blobs
                    if (txt && txt.length <= 80) {
                        if (RELATIVE_AGE_REGEX.test(txt) || ABSOLUTE_DATE_REGEX.test(txt) || MONTH_NAME_DATE_REGEX.test(txt)) {
                            has_timestamp = true;
                        }
                    }
                }
            }

            if (has_author && has_avatar && has_timestamp) break;
        }

        return { has_author, has_avatar, has_timestamp };
    }

    /********************************************************************
     * Individual Positive Feature Aggregation
     ********************************************************************/
    function computeIndividualPositiveFeatures(el) {
        const textStats = detectTextStats(el);
        const related = detectRelatedKeyword(el);
        const micro = detectMicroactions(el);
        const meta = detectMetadata(el);

        // Derived: emoji-only or mixed
        const emojiOnly = (textStats.emoji_count > 0 && textStats.text_word_count === 0);
        const emojiMixed = (textStats.emoji_count > 0 && textStats.text_word_count > 0);

        // Derived: "text has link with @/#"
        const linkWithMentionOrHash = (textStats.text_contains_links && textStats.text_contains_mentions_or_hashtags);

        // Derived: question?
        const hasQuestion = textStats.text_question_mark_count > 0;

        // Build the feature object (only Individual Positive nodes)
        const features = {
            // has avatar / author / relative time
            has_avatar: meta.has_avatar,
            has_author: meta.has_author,
            has_relative_time_or_timestamp: meta.has_timestamp,

            // text features
            has_text_content: textStats.has_text_content,
            text_word_count: textStats.text_word_count,
            has_question: hasQuestion,
            question_mark_count: textStats.text_question_mark_count,

            // links + @/# features
            text_contains_links: textStats.text_contains_links,
            text_contains_mentions_or_hashtags: textStats.text_contains_mentions_or_hashtags,
            link_density: textStats.link_density,
            link_with_at_or_hash: linkWithMentionOrHash,

            // emoji composition
            text_contains_emoji: textStats.text_contains_emoji,
            emoji_count: textStats.emoji_count,
            emoji_only: emojiOnly,
            emoji_mixed: emojiMixed,

            // attribute contains comment-related keywords
            has_related_keyword: related.has_related_keyword,

            // microactions (reply/edit/pin/like/etc. are inside matched_tokens)
            has_microaction: micro.has_microaction,
            microaction_count: micro.action_count,
            microaction_tokens: micro.matched_tokens
        };

        // Simple score (for ranking / later “local maxima”)
        // You can tune weights later; for now: count booleans + some scaled numerics.
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
            Math.min(1, features.text_word_count / 30) * 0.5; // mild boost for some text

        return { features, score };
    }

    /********************************************************************
     * DOM Traversal + Data Collection
     ********************************************************************/
    const results = [];
    const stack = [{ el: document.body, depth: 0 }];

    let visited = 0;
    while (stack.length && visited < OPT.maxElements) {
        const { el, depth } = stack.pop();
        if (!isElement(el)) continue;
        if (OPT.skipTags.has(el.tagName)) continue;
        if (depth > OPT.maxDepth) continue;
        if (OPT.requireVisible && !isVisible(el)) continue;

        // compute features for this node
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

        // push children (DFS)
        const children = el.children;
        for (let i = children.length - 1; i >= 0; i--) {
            stack.push({ el: children[i], depth: depth + 1 });
        }
    }

    // Sort highest scoring first
    results.sort((a, b) => b.score - a.score);

    /********************************************************************
     * Expose helpers to window for inspection
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
        `✅ Scan complete: analyzed ${results.length} elements. ` +
        `Use __commentFeatureScan.top(20), __commentFeatureScan.highlight(0), __commentFeatureScan.get(0)`
    );
})();
