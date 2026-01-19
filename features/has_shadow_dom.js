/**
 * Detect whether a root node is itself a shadow host, has any
 * shadow-host descendants, or is inside a shadow DOM.
 *
 * Returns: { has_shadow_dom: boolean }
 */
function detectShadowDom(rootEl) {
    const result = { has_shadow_dom: false };
    if (!rootEl) return result;

    // 1. Is this node itself inside a shadow DOM?
    //    (its root node is a ShadowRoot instead of Document)
    if (typeof rootEl.getRootNode === "function") {
        const rootNode = rootEl.getRootNode();
        if (rootNode instanceof ShadowRoot) {
            result.has_shadow_dom = true;
            return result;
        }
    }

    // Helper: does this element host a shadow root?
    function isShadowHost(el) {
        // shadowRoot is non-null for open shadow roots, and exists for closed too,
        // but you can't access it in closed mode. For open shadows, this works:
        return !!el.shadowRoot;
    }

    // 2. Check if the rootEl itself is a shadow host
    if (rootEl instanceof Element && isShadowHost(rootEl)) {
        result.has_shadow_dom = true;
        return result;
    }

    // 3. Walk descendants and check if any is a shadow host
    const walker = document.createTreeWalker(
        rootEl,
        NodeFilter.SHOW_ELEMENT,
        null,
        false
    );

    while (walker.nextNode()) {
        const el = walker.currentNode;
        if (isShadowHost(el)) {
            result.has_shadow_dom = true;
            break;
        }
    }

    return result;
}
