const CDP_VERSION = "1.3";

// Track per-tab state
const stateByTab = new Map();

chrome.action.onClicked.addListener(async (tab) => {
    if (!tab?.id) return;
    const tabId = tab.id;

    // Toggle
    if (stateByTab.get(tabId)?.attached) {
        await detach(tabId);
        return;
    }

    await attachAndIntercept(tabId);
});

async function attachAndIntercept(tabId) {
    await cdpAttach(tabId);
    stateByTab.set(tabId, { attached: true, requestIds: new Set() });

    // Enable Fetch interception for the main document
    await cdpSend(tabId, "Fetch.enable", {
        patterns: [
            { urlPattern: "*", resourceType: "Document", requestStage: "Response" }
        ]
    });

    console.log("[CDP] Fetch interception enabled for tab", tabId);
}

async function detach(tabId) {
    try {
        await cdpSend(tabId, "Fetch.disable");
    } catch {}
    try {
        await cdpDetach(tabId);
    } catch {}
    stateByTab.delete(tabId);
    console.log("[CDP] Detached", tabId);
}

chrome.debugger.onEvent.addListener(async (source, method, params) => {
    const tabId = source?.tabId;
    if (!tabId || !stateByTab.get(tabId)?.attached) return;

    if (method === "Fetch.requestPaused") {
        // Only handle main document responses
        const rt = params?.resourceType;
        const isDoc = rt === "Document";
        const requestId = params.requestId;

        if (!isDoc) {
            await continueRequest(tabId, requestId);
            return;
        }

        try {
            // Get response body (HTML)
            const bodyResp = await cdpSend(tabId, "Fetch.getResponseBody", { requestId });
            const html = bodyResp.base64Encoded
                ? atob(bodyResp.body)
                : bodyResp.body;

            console.log("[CDP] Intercepted HTML length:", html.length);

            // --- Your analysis hook ---
            // You can parse html here (no scripts executed).
            // e.g., detect comment containers, count candidates, etc.

            // --- Optional: rewrite to block scripts (SSR-only pages) ---
            // WARNING: rewriting breaks JS-heavy pages. Use carefully.
            const rewritten = rewriteHtmlToNoScript(html);

            await cdpSend(tabId, "Fetch.fulfillRequest", {
                requestId,
                responseCode: 200,
                responseHeaders: [
                    { name: "Content-Type", value: "text/html; charset=utf-8" },
                    // Stronger guarantee: enforce no scripts (still allows CSS/layout)
                    { name: "Content-Security-Policy", value: "script-src 'none'; object-src 'none'; base-uri 'none'" }
                ],
                body: btoa(unescape(encodeURIComponent(rewritten)))
            });

            console.log("[CDP] Fulfilled with rewritten HTML (no-script CSP).");


            await cdpSend(tabId, "Fetch.disable");
            await cdpDetach(tabId);
            stateByTab.delete(tabId);
            console.log("[CDP] Done. Detached.");
        } catch (e) {
            console.warn("[CDP] Intercept failed, continuing:", e);
            await continueRequest(tabId, requestId);
        }
    }
});

function rewriteHtmlToNoScript(html) {
    // Very conservative stripping: remove <script ...>...</script>
    // Also remove inline event handlers like onclick="..."
    // Note: regex HTML parsing is imperfect, but ok as a first prototype.
    let out = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
    out = out.replace(/\son\w+\s*=\s*(['"]).*?\1/gi, "");
    return out;
}

async function continueRequest(tabId, requestId) {
    try {
        await cdpSend(tabId, "Fetch.continueRequest", { requestId });
    } catch (e) {
        console.warn("[CDP] continueRequest failed:", e);
    }
}

function cdpAttach(tabId) {
    return new Promise((resolve, reject) => {
        chrome.debugger.attach({ tabId }, CDP_VERSION, () => {
            const err = chrome.runtime.lastError;
            if (err) reject(err);
            else resolve();
        });
    });
}

function cdpDetach(tabId) {
    return new Promise((resolve, reject) => {
        chrome.debugger.detach({ tabId }, () => {
            const err = chrome.runtime.lastError;
            if (err) reject(err);
            else resolve();
        });
    });
}

function cdpSend(tabId, method, params = {}) {
    return new Promise((resolve, reject) => {
        chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
            const err = chrome.runtime.lastError;
            if (err) reject(err);
            else resolve(result);
        });
    });
}
