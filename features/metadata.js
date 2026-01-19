/**
 * Detect metadata inside a candidate element.
 * Returns { has_author, has_avatar, has_timestamp }
 *
 * - has_author: element that looks like a username/author
 * - has_avatar: image/avatar element
 * - has_timestamp: time/age information
 */

function detectMetadata(rootEl) {
    if (!rootEl) {
        return { has_author: false, has_avatar: false, has_timestamp: false };
    }

    // Likely author carriers
    const AUTHOR_TAGS = new Set(["A", "SPAN", "DIV","P"]);
    const AUTHOR_KEYWORDS = [
        "author", "user", "username", "profile", "byline", "handle", "nickname"
    ];

    // Likely avatar carriers
    const AVATAR_TAGS = new Set(["IMG", "DIV", "SPAN","SVG"]);
    const AVATAR_KEYWORDS = [
        "avatar", "userpic", "profile-pic", "profilepic", "user-icon", "userphoto", "user-photo"
    ];

    // Timestamp attribute names
    const TIMESTAMP_ATTR_NAMES = [
        "datetime", "data-time", "data-timestamp", "data-created", "data-epoch"
    ];

    // Timestamp regexes
    const RELATIVE_AGE_REGEX=
        /\b\d+\s*(sec|second|min|minute|hour|hr|day|week|month|year)s?(?:\s*ago)?\b/i

    /*const RELATIVE_AGE_REGEX =
        /\b\d+\s*(sec|second|min|minute|hour|hr|day|week|month|year)s?\s*ago\b/i;*/

    const ABSOLUTE_DATE_REGEX =
        /\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/;

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

    // --- NEW: username-like text check ---
    // Allows:
    //   "Alice"
    //   "@alice"
    //   "alice_01"
    //   "alice-dev"
    //   "alice.dev"  (optional)
    // and tolerates emojis mixed in.
    //
    // We avoid matching purely numeric content.
    const USERNAME_REGEX =
        /^(?:@)?[a-z0-9][a-z0-9._-]{0,31}$/i;

    // Emoji detection for usernames like "alex😄"
    const EMOJI_REGEX = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;

    function looksLikeUsernameText(raw) {
        if (!raw) return false;

        const text = raw.replace(/\s+/g, " ").trim();
        if (!text) return false;

        // Disqualify obvious non-author phrases
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

        // If it has multiple words, still allow it (some names are "John Doe"),
        // but we don't *require* it.
        // We'll check the first token for username-like patterns.
        const firstToken = text.split(" ")[0];

        // If token is purely digits, reject
        if (/^\d+$/.test(firstToken)) return false;

        // Strip surrounding punctuation that sometimes wraps usernames
        const cleaned = firstToken.replace(/^[\(\[\{<>"']+|[\)\]\}>,"']+$/g, "");

        // Remove emoji for the strict username check, but remember if emoji existed
        const emojiMatches = cleaned.match(EMOJI_REGEX);
        const cleanedNoEmoji = cleaned.replace(EMOJI_REGEX, "");

        const isUsernameish =
            USERNAME_REGEX.test(cleanedNoEmoji) ||
            cleaned.startsWith("@"); // accept @ handles even if punctuation weirdness

        // If it’s username-ish, great. Emoji is optional.
        return isUsernameish;
    }

    // font-weight > 400 signal
    function isBoldish(el) {
        try {
            const fw = window.getComputedStyle(el).fontWeight;
            // fontWeight can be "bold", "normal", or numeric string
            if (fw === "bold") return true;
            const num = parseInt(fw, 10);
            return !Number.isNaN(num) && num > 400;
        } catch {
            return false;
        }
    }

    let has_author = false;
    let has_avatar = false;
    let has_timestamp = false;

    const walker = document.createTreeWalker(
        rootEl,
        NodeFilter.SHOW_ELEMENT,
        null,
        false
    );

    function checkElement(el) {
        const tag = el.tagName;

        // ---------- AUTHOR (refined) ----------
        if (!has_author && AUTHOR_TAGS.has(tag)) {
            // Build attribute blob (names+values) for keyword detection
            let attrBlob = (el.className || "") + " " + (el.id || "");
            for (const attr of el.attributes || []) {
                attrBlob += " " + attr.name + " " + attr.value;
            }
            attrBlob = attrBlob.toLowerCase();

            const text = (el.textContent || "").trim();
            const usernameish = looksLikeUsernameText(text);
            const keywordish = containsKeyword(attrBlob, AUTHOR_KEYWORDS);

            // Strong: keywordish + usernameish
            // Medium: usernameish + boldish (often author name styling)
            // We accept either:
            if ((keywordish && usernameish) || (usernameish && isBoldish(el))) {
                has_author = true;
            }
        }

        // ---------- AVATAR ----------
        if (!has_avatar && AVATAR_TAGS.has(tag)) {
            let attrBlob = (el.className || "") + " " + (el.id || "");
            for (const attr of el.attributes || []) {
                attrBlob += " " + attr.name + " " + attr.value;
            }
            attrBlob = attrBlob.toLowerCase();

            if (containsKeyword(attrBlob, AVATAR_KEYWORDS)) {
                has_avatar = true;
            }
        }

        // ---------- TIMESTAMP ----------
        if (!has_timestamp) {
            if (tag === "TIME") {
                has_timestamp = true;
            }

            if (!has_timestamp && el.attributes) {
                for (const attr of el.attributes) {
                    if (isTimestampAttrName(attr.name)) {
                        has_timestamp = true;
                        break;
                    }
                }
            }

            if (!has_timestamp) {
                const text = (el.textContent || "").toLowerCase().trim();
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

    // check rootEl itself
    if (rootEl instanceof Element) checkElement(rootEl);

    while (walker.nextNode()) {
        checkElement(walker.currentNode);
        if (has_author && has_avatar && has_timestamp) break;
    }

    return { has_author, has_avatar, has_timestamp };
}
