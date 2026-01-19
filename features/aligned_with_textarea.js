/**
 * Check if there is a textarea or contenteditable element whose visual width
 * (and horizontal alignment) roughly matches the given root element.
 *
 * This is a hint that the root element is a comment list aligned with its composer.
 *
 * Returns:
 *   { aligned_with_textarea: boolean }
 */
function detectAlignedWithTextarea(rootEl, options = {}) {
    const result = { aligned_with_textarea: false };
    if (!rootEl || !(rootEl instanceof Element)) return result;

    const widthTolerancePx = options.widthTolerancePx ?? 16;  // max allowed width difference
    const xTolerancePx = options.xTolerancePx ?? 16;          // max allowed left-edge difference
    const maxAncestorDepth = options.maxAncestorDepth ?? 6;   // how far up to walk

    const rootRect = rootEl.getBoundingClientRect();
    if (!rootRect || rootRect.width === 0) return result;

    // Helper: is element visible enough to consider?
    function isVisiblyRenderable(el) {
        const style = window.getComputedStyle(el);
        if (!style) return false;
        if (style.display === "none") return false;
        if (style.visibility === "hidden") return false;
        if (style.opacity === "0") return false;
        return el.offsetWidth > 0 && el.offsetHeight > 0;
    }

    // Collect candidate scopes: root, its parent, parent's parent,... up to depth
    const scopes = [];
    let current = rootEl;
    let depth = 0;
    while (current && depth <= maxAncestorDepth) {
        if (current instanceof Element) {
            scopes.push(current);
        }
        current = current.parentElement;
        depth++;
    }

    // For each scope, search for textarea / contenteditable elements
    for (const scope of scopes) {
        // We allow composer "above or below", so search the scope's subtree
        const candidates = scope.querySelectorAll(
            "textarea,[contenteditable='true'],[contenteditable='']"
        );

        for (const el of candidates) {
            if (!isVisiblyRenderable(el)) continue;

            const r = el.getBoundingClientRect();
            if (!r || r.width === 0) continue;

            const widthDiff = Math.abs(r.width - rootRect.width);
            const xDiff = Math.abs(r.left - rootRect.left);

            // Check approximate alignment & similar width
            if (widthDiff <= widthTolerancePx && xDiff <= xTolerancePx) {
                result.aligned_with_textarea = true;
                return result;
            }
        }
    }

    return result;
}
