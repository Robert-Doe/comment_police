(() => {
    /********************************************************************
     * REQUIREMENTS
     ********************************************************************/
    if (!window.__commentFeatureScan?.results?.length) {
        console.warn("Missing __commentFeatureScan.results. Run your scan first.");
        return;
    }
    if (!window.__commentFeatureScan?.xpath?.byXPathStar) {
        console.warn("Missing __commentFeatureScan.xpath.byXPathStar. Run XPath grouping step first.");
        return;
    }

    /********************************************************************
     * CONFIG
     ********************************************************************/
    const CFG = {
        // core detection
        minGroupSize: 4,
        supportThreshold: 0.8,

        // DOT
        rootEl: document.body,
        dotFilename: "feature_colouring_bordered_cores.dot",
        dotTitle:
            "DOM Core Map (core: thick border; fill = per-node #scoring-features matched (0..10); label=tag only)",

        // borders
        paintedPenWidth: 4,
        normalPenWidth: 1.2,

        // 10-slot feature composition (matches your scoring slots)
        scoreBoolKeys: [
            "has_avatar",
            "has_author",
            "has_relative_time_or_timestamp",
            "has_microaction",
            "has_related_keyword",
            "link_with_at_or_hash",
            "emoji_only",
            "emoji_mixed",
        ],
        questionKey: "has_question",
        wordSlotAtLeast: 30,

        // heat ramp 1..10
        colors: [
            "#fff5f0",
            "#fee0d2",
            "#fcbba1",
            "#fc9272",
            "#fb6a4a",
            "#ef3b2c",
            "#cb181d",
            "#a50f15",
            "#7f0000",
            "#4a0000",
        ],
        nonPaintFill: "white",

        clearExistingPaint: true,
    };

    /********************************************************************
     * Small utilities
     ********************************************************************/
    const esc = (s) =>
        String(s ?? "")
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/\n/g, "\\n");

    function downloadText(filename, text) {
        const blob = new Blob([text], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 500);
    }

    function isElement(el) {
        return el && el.nodeType === 1;
    }

    function setPaint(el) {
        try { el.setAttribute("data-paint", "true"); } catch {}
    }

    function hasPaint(el) {
        try { return el.getAttribute("data-paint") === "true"; } catch { return false; }
    }

    function clearPaintOnWholePage() {
        document.querySelectorAll('[data-paint="true"]').forEach((el) => {
            el.removeAttribute("data-paint");
        });
    }

    function tagOnlyLabel(el) {
        return esc(el.tagName.toLowerCase());
    }

    function safeStr(x) {
        try { return String(x ?? ""); } catch { return ""; }
    }

    function normalizeText(str) {
        return safeStr(str).toLowerCase().replace(/\s+/g, " ").trim();
    }

    /********************************************************************
     * PER-NODE FEATURE DETECTORS (NO DESCENDANT TRAVERSAL)
     * These are the functions we “extract” to guarantee per-node semantics.
     ********************************************************************/

    // Get ONLY the node's direct text (ignores descendant text)
    function directText(el) {
        if (!isElement(el)) return "";
        let out = "";
        for (const n of el.childNodes) {
            if (n && n.nodeType === Node.TEXT_NODE) out += (n.nodeValue || "");
        }
        return out;
    }

    // 1) Per-node text stats (only direct text nodes)
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

        const raw = directText(el);
        const normalized = raw.replace(/\s+/g, " ").trim();
        if (!normalized) return result;

        result.has_text_content = true;

        const totalTextLen = normalized.length;

        // word count
        const words = normalized.split(/\s+/).filter(Boolean);
        result.text_word_count = words.length;

        // mentions / hashtags
        result.text_contains_mentions_or_hashtags = mentionOrHashtagRegex.test(normalized);

        // emoji
        if (/[\u0080-\uFFFF]/.test(normalized)) {
            const m = normalized.match(emojiRegex);
            if (m?.length) {
                result.emoji_count = m.length;
                result.text_contains_emoji = true;
            }
        }

        // question marks
        let q = 0;
        for (let i = 0; i < normalized.length; i++) if (normalized[i] === "?") q++;
        result.text_question_mark_count = q;

        // link detection:
        // - if element itself is <a href> treat direct text as link text
        // - else detect URL-like strings inside direct text
        let linkTextLen = 0;
        if (el.tagName === "A" && el.hasAttribute("href")) {
            result.text_contains_links = true;
            linkTextLen += totalTextLen;
        } else {
            const urlMatches = normalized.match(urlRegex);
            if (urlMatches) {
                result.text_contains_links = true;
                for (const m2 of urlMatches) linkTextLen += m2.length;
            }
        }

        result.link_density = totalTextLen > 0 ? (linkTextLen / totalTextLen) : 0;
        return result;
    }

    // 2) Per-node related keyword (only element's own attrs + direct text)
    function detectRelatedKeywordNode(el) {
        if (!isElement(el)) return { has_related_keyword: false };

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

            // same “both directions” idea, but guard tiny strings to avoid noise
            for (const kw of RELATED_KEYWORDS) {
                const key = kw.toLowerCase();
                if (text.includes(key)) return true;
                if (text.length >= 5 && key.includes(text)) return true;
            }
            return false;
        }

        // direct text only
        const t = normalizeText(directText(el));
        if (t && t.length <= 60 && matchesRelated(t)) return { has_related_keyword: true };

        // common attributes
        if (matchesRelated(el.className) || matchesRelated(el.id)) return { has_related_keyword: true };

        // aria/ title
        if (matchesRelated(el.getAttribute("aria-label")) || matchesRelated(el.getAttribute("title"))) {
            return { has_related_keyword: true };
        }

        // all attributes
        if (el.attributes) {
            for (const attr of el.attributes) {
                if (matchesRelated(attr.name) || matchesRelated(attr.value)) {
                    return { has_related_keyword: true };
                }
            }
        }

        return { has_related_keyword: false };
    }

    // 3) Per-node microactions (ONLY the element itself)
    function detectMicroactionsNode(el) {
        if (!isElement(el)) return { has_microaction: false, action_count: 0, matched_tokens: [] };

        const ACTION_TAGS = new Set(["BUTTON", "A", "SPAN", "DIV", "SVG", "IMG"]);
        if (!ACTION_TAGS.has(el.tagName)) return { has_microaction: false, action_count: 0, matched_tokens: [] };

        const TOKENS = [
            "reply","respond","answer","quote",
            "like","upvote","heart","dislike","downvote",
            "share","permalink","copylink","copy link",
            "report","flag","block","mute",
            "edit","pin","pinned"
        ];

        function isClickable(x) {
            if (!isElement(x)) return false;
            if (x.tagName === "BUTTON") return true;
            if (x.tagName === "A" && x.hasAttribute("href")) return true;
            const role = normalizeText(x.getAttribute("role") || "");
            if (role === "button" || role === "link" || role === "menuitem") return true;
            if (typeof x.onclick === "function" || x.hasAttribute("onclick")) return true;
            if (x.hasAttribute("aria-label") || x.hasAttribute("title")) return true;
            if (x.hasAttribute("aria-pressed") || x.hasAttribute("aria-expanded")) return true;
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

        if (!isClickable(el)) return { has_microaction: false, action_count: 0, matched_tokens: [] };

        const matched = new Set();

        const aria = el.getAttribute("aria-label") || "";
        const title = el.getAttribute("title") || "";
        const alt = el.getAttribute("alt") || "";
        const t1 = matchTokenInLabel(`${aria} ${title} ${alt}`);
        if (t1) matched.add(t1);

        // direct text only
        const txt = normalizeText(directText(el));
        if (txt && txt.length <= 40) {
            const t2 = matchTokenInLabel(txt);
            if (t2) matched.add(t2);
        }

        // attributes
        if (el.attributes) {
            for (const attr of el.attributes) {
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

    // 4) Per-node metadata (ONLY the element itself)
    function detectMetadataNode(el) {
        if (!isElement(el)) return { has_author: false, has_avatar: false, has_timestamp: false };

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

        // AUTHOR (per-node): must be author-ish tag + keyword-ish attrs + name-like direct text
        let has_author = false;
        if (AUTHOR_TAGS.has(el.tagName)) {
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
                const t = normalizeText(directText(el));
                if (t.length >= 2 && t.length <= 40 && !AUTHOR_KEYWORDS.includes(t)) {
                    has_author = true;
                }
            }
        }

        // AVATAR (per-node): only this element
        let has_avatar = false;
        if (AVATAR_TAGS.has(el.tagName)) {
            const attrBlob = [
                safeStr(el.className),
                safeStr(el.id),
                safeStr(el.getAttribute("alt")),
                safeStr(el.getAttribute("title")),
                safeStr(el.getAttribute("aria-label")),
                safeStr(el.getAttribute("src")),
            ].join(" ");
            if (containsKeyword(attrBlob, AVATAR_KEYWORDS)) {
                if (el.tagName === "IMG") {
                    const w = el.naturalWidth || el.width || 0;
                    const h = el.naturalHeight || el.height || 0;
                    has_avatar = !(w && h && (w > 250 || h > 250));
                } else {
                    has_avatar = true;
                }
            }
        }

        // TIMESTAMP (per-node): tag/attrs/direct text only
        let has_timestamp = false;
        if (el.tagName === "TIME") {
            has_timestamp = true;
        } else if (el.attributes) {
            for (const attr of el.attributes) {
                if (isTimestampAttrName(attr.name)) { has_timestamp = true; break; }
            }
        }
        if (!has_timestamp) {
            const t = normalizeText(directText(el));
            if (t && t.length <= 80) {
                if (RELATIVE_AGE_REGEX.test(t) || ABSOLUTE_DATE_REGEX.test(t) || MONTH_NAME_DATE_REGEX.test(t)) {
                    has_timestamp = true;
                }
            }
        }

        return { has_author, has_avatar, has_timestamp };
    }

    // Aggregate per-node positives (same “feature names” you used before)
    function computePerNodeFeatures(el) {
        const textStats = detectTextStatsNode(el);
        const related = detectRelatedKeywordNode(el);
        const micro = detectMicroactionsNode(el);
        const meta = detectMetadataNode(el);

        const emojiOnly = (textStats.emoji_count > 0 && textStats.text_word_count === 0);
        const emojiMixed = (textStats.emoji_count > 0 && textStats.text_word_count > 0);
        const linkWithMentionOrHash = (textStats.text_contains_links && textStats.text_contains_mentions_or_hashtags);
        const hasQuestion = textStats.text_question_mark_count > 0;

        return {
            // metadata
            has_avatar: meta.has_avatar,
            has_author: meta.has_author,
            has_relative_time_or_timestamp: meta.has_timestamp,

            // text
            has_text_content: textStats.has_text_content,
            text_word_count: textStats.text_word_count,
            has_question: hasQuestion,
            question_mark_count: textStats.text_question_mark_count,

            // links + @/# combo
            text_contains_links: textStats.text_contains_links,
            text_contains_mentions_or_hashtags: textStats.text_contains_mentions_or_hashtags,
            link_density: textStats.link_density,
            link_with_at_or_hash: linkWithMentionOrHash,

            // emoji composition
            text_contains_emoji: textStats.text_contains_emoji,
            emoji_count: textStats.emoji_count,
            emoji_only: emojiOnly,
            emoji_mixed: emojiMixed,

            // related keyword
            has_related_keyword: related.has_related_keyword,

            // microactions
            has_microaction: micro.has_microaction,
            microaction_count: micro.action_count,
            microaction_tokens: micro.matched_tokens
        };
    }

    // 0..10 slots, computed PER NODE (no descendant traversal)
    function perNodeFeatureCount(el) {
        const f = computePerNodeFeatures(el);

        let c = 0;
        for (const k of CFG.scoreBoolKeys) if (f[k]) c++;

        if (f[CFG.questionKey]) c++;

        const wc = f.text_word_count || 0;
        if (wc >= CFG.wordSlotAtLeast) c++;

        if (c < 0) c = 0;
        if (c > 10) c = 10;

        return c;
    }

    function fillColor(count) {
        if (!count) return "#f0f0f0";
        return CFG.colors[Math.min(10, Math.max(1, count)) - 1];
    }

    /********************************************************************
     * CORE MATCHING (structural; uses subtree)
     ********************************************************************/
    function countSubtreeElements(rootEl) {
        let count = 0;
        const stack = [rootEl];
        while (stack.length) {
            const el = stack.pop();
            if (!isElement(el)) continue;
            count++;
            const children = el.children;
            for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
        }
        return count;
    }

    function preorderElements(rootEl) {
        const out = [];
        const stack = [rootEl];
        while (stack.length) {
            const el = stack.pop();
            if (!isElement(el)) continue;
            out.push(el);
            const children = el.children;
            for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
        }
        return out;
    }

    function getTagIndexAmongSameTag(el) {
        const tag = el.tagName;
        let idx = 1;
        let sib = el.previousElementSibling;
        while (sib) {
            if (sib.tagName === tag) idx++;
            sib = sib.previousElementSibling;
        }
        return idx;
    }

    function childTagMultiset(el) {
        const m = new Map();
        if (!isElement(el)) return m;
        const children = el.children;
        for (let i = 0; i < children.length; i++) {
            const t = children[i].tagName.toLowerCase();
            m.set(t, (m.get(t) || 0) + 1);
        }
        return m;
    }

    function containmentScore(refChildTags, candChildTags) {
        let score = 0;
        for (const [tag, refCount] of refChildTags.entries()) {
            const candCount = candChildTags.get(tag) || 0;
            if (candCount < refCount) return -Infinity;
            score += refCount;
        }
        return score;
    }

    function findBestMatchWithinParent({ refNode, sibParent }) {
        if (!isElement(refNode) || !isElement(sibParent)) return null;

        const refTag = refNode.tagName;
        const refTagIdx = getTagIndexAmongSameTag(refNode);
        const refChildCount = refNode.children ? refNode.children.length : 0;
        const refChildTags = childTagMultiset(refNode);

        const candidates = [];
        const children = sibParent.children;
        for (let i = 0; i < children.length; i++) {
            const c = children[i];
            if (!isElement(c)) continue;
            if (c.tagName !== refTag) continue;

            const candChildCount = c.children ? c.children.length : 0;
            if (candChildCount < refChildCount) continue; // containment tolerance
            candidates.push(c);
        }

        if (!candidates.length) return null;
        if (candidates.length === 1) return candidates[0];

        // tie-break 1: closest tag-index
        let bestDist = Infinity;
        for (const c of candidates) {
            const dist = Math.abs(getTagIndexAmongSameTag(c) - refTagIdx);
            if (dist < bestDist) bestDist = dist;
        }
        const bestDistCands = candidates.filter(
            c => Math.abs(getTagIndexAmongSameTag(c) - refTagIdx) === bestDist
        );
        if (bestDistCands.length === 1) return bestDistCands[0];

        // tie-break 2: best child-tag containment
        let best = null;
        let bestScore = -Infinity;
        for (const c of bestDistCands) {
            const s = containmentScore(refChildTags, childTagMultiset(c));
            if (s > bestScore) {
                bestScore = s;
                best = c;
            }
        }
        return best || bestDistCands[0];
    }

    function pickMedianSibling(roots) {
        const arr = roots
            .filter(isElement)
            .map((el, idx) => ({ el, idx, count: countSubtreeElements(el) }))
            .sort((a, b) => a.count - b.count);
        const mid = Math.floor(arr.length / 2);
        return arr[mid] || null;
    }

    function paintGroupByReferenceMedian({ xpathStar, members, supportThreshold }) {
        const roots = members.map(r => r.el).filter(isElement);
        const n = roots.length;
        if (!n) return { xpathStar, siblingCount: 0, paintedCount: 0 };

        const refPick = pickMedianSibling(roots);
        if (!refPick) return { xpathStar, siblingCount: n, paintedCount: 0 };

        const refRoot = refPick.el;
        const refNodes = preorderElements(refRoot);

        const matchMaps = new Array(n).fill(null).map(() => new WeakMap());
        for (let s = 0; s < n; s++) matchMaps[s].set(refRoot, roots[s]);

        let newlyPainted = 0;

        for (const u of refNodes) {
            const parentRef = u.parentElement;
            const matched = new Array(n).fill(null);

            for (let s = 0; s < n; s++) {
                if (u === refRoot) {
                    matched[s] = roots[s];
                    continue;
                }

                const sibParent = parentRef ? matchMaps[s].get(parentRef) : null;
                if (!sibParent || !isElement(sibParent)) {
                    matched[s] = null;
                    continue;
                }

                const m = findBestMatchWithinParent({ refNode: u, sibParent });
                matched[s] = m;
                if (m) matchMaps[s].set(u, m);
            }

            const matchCount = matched.filter(Boolean).length;
            const support = matchCount / n;

            if (support >= supportThreshold) {
                if (!hasPaint(u)) { setPaint(u); newlyPainted++; }
                for (const m of matched) {
                    if (m && !hasPaint(m)) { setPaint(m); newlyPainted++; }
                }
            }
        }

        return {
            xpathStar,
            siblingCount: n,
            refSiblingIndex: refPick.idx,
            refSubtreeCount: refPick.count,
            paintedCount: newlyPainted,
        };
    }

    /********************************************************************
     * DOT BUILDER (whole page)
     * - label: tag only
     * - if data-paint=true: thick border + per-node heat fill
     ********************************************************************/
    function buildDotWholePage({ rootEl = document.body, title = CFG.dotTitle } = {}) {
        if (!isElement(rootEl)) throw new Error("rootEl must be an Element");

        const idMap = new WeakMap();
        let nextId = 1;
        const getId = (el) => {
            let id = idMap.get(el);
            if (!id) {
                id = "n" + (nextId++);
                idMap.set(el, id);
            }
            return id;
        };

        const nodes = new Map();
        const edges = [];

        const stack = [rootEl];
        while (stack.length) {
            const el = stack.pop();
            if (!isElement(el)) continue;

            const id = getId(el);

            if (!nodes.has(id)) {
                const painted = hasPaint(el);

                let fill = CFG.nonPaintFill;
                let fontcolor = "gray20";
                let penwidth = CFG.normalPenWidth;

                if (painted) {
                    // IMPORTANT: per-node feature evaluation happens HERE
                    const c = perNodeFeatureCount(el); // 0..10, per-node only
                    fill = fillColor(c);
                    fontcolor = c >= 6 ? "white" : "black";
                    penwidth = CFG.paintedPenWidth;
                }

                nodes.set(id, {
                    label: tagOnlyLabel(el),
                    fillcolor: fill,
                    fontcolor,
                    penwidth,
                    color: "gray20",
                });
            }

            const children = el.children;
            for (let i = children.length - 1; i >= 0; i--) {
                const c = children[i];
                if (!isElement(c)) continue;
                edges.push([id, getId(c)]);
                stack.push(c);
            }
        }

        let dot = "";
        dot += "digraph DOMCoreBorderPlusPerNodeFeatureHeat {\n";
        dot += `  graph [rankdir=TB, fontsize=12, labelloc="t", label="${esc(title)}"];\n`;
        dot += '  node  [shape=box, style="rounded,filled", fontsize=9, fontname="Helvetica"];\n';
        dot += '  edge  [color="gray70"];\n\n';

        for (const [id, info] of nodes.entries()) {
            dot += `  ${id} [label="${info.label}", fillcolor="${info.fillcolor}", fontcolor="${info.fontcolor}", color="${info.color}", penwidth=${info.penwidth}];\n`;
        }

        dot += "\n";
        for (const [a, b] of edges) {
            if (nodes.has(a) && nodes.has(b)) dot += `  ${a} -> ${b};\n`;
        }
        dot += "}\n";

        return { dot, nodesCount: nodes.size, edgesCount: edges.length };
    }

    /********************************************************************
     * RUN
     ********************************************************************/
    function run({
                     minGroupSize = CFG.minGroupSize,
                     supportThreshold = CFG.supportThreshold,
                     rootEl = CFG.rootEl,
                     dotFilename = CFG.dotFilename,
                     dotTitle = CFG.dotTitle,
                     clearExistingPaint = CFG.clearExistingPaint,
                 } = {}) {
        if (clearExistingPaint) clearPaintOnWholePage();

        const byXPathStar = window.__commentFeatureScan.xpath.byXPathStar;

        const groups = [];
        for (const [xpathStar, members] of byXPathStar.entries()) {
            if (!members?.length) continue;
            if (members.length < minGroupSize) continue;
            groups.push({ xpathStar, members });
        }

        const summaries = [];
        for (const g of groups) {
            summaries.push(
                paintGroupByReferenceMedian({
                    xpathStar: g.xpathStar,
                    members: g.members,
                    supportThreshold
                })
            );
        }

        const { dot, nodesCount, edgesCount } = buildDotWholePage({
            rootEl,
            title: dotTitle,
        });

        window.__commentFeatureScan.coreBorderPlusPerNodeHeat = {
            CFG,
            summaries,
            dot,
        };

        downloadText(dotFilename, dot);

        console.log("✅ Done: core nodes painted; thick border; per-node feature heat applied ONLY by per-node detectors.");
        console.table(summaries.map(s => ({
            xpathStar: s.xpathStar,
            siblings: s.siblingCount,
            refSiblingIndex: s.refSiblingIndex,
            refSubtreeCount: s.refSubtreeCount,
            newlyPainted: s.paintedCount
        })));
        console.log(`✅ DOT downloaded as ${dotFilename}`);
        console.log(`DOT stats: nodes=${nodesCount}, edges=${edgesCount}`);

        return { summaries, nodesCount, edgesCount };
    }

    /********************************************************************
     * Expose a single entry point under __commentFeatureScan
     ********************************************************************/
    window.__commentFeatureScan.runCoreBorderPlusPerNodeHeat = run;

    console.log(
        "✅ Ready.\n" +
        "Run:\n" +
        "  __commentFeatureScan.runCoreBorderPlusPerNodeHeat({ minGroupSize: 4, supportThreshold: 0.8 })"
    );
})();
