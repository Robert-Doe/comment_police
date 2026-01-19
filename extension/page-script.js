// page-script.js
(() => {
    // These should be visible to the page's own JS (not just the content script).
    window.__MV3_INJECT_DEMO__ = {
        injectedAt: new Date().toISOString(),
        note: "Hello from a script tag injected by an MV3 extension."
    };

    console.log("[mv3-inject-demo] page-script.js ran in the page context.");
    console.log("[mv3-inject-demo] window.__MV3_INJECT_DEMO__ =", window.__MV3_INJECT_DEMO__);

    // Add a marker to the DOM so you can verify injection without DevTools console.
    const badge = document.createElement("div");
    badge.textContent = "Injected by MV3 extension (page context)";
    badge.style.cssText = [
        "position:fixed",
        "bottom:12px",
        "right:12px",
        "z-index:2147483647",
        "background:#111",
        "color:#fff",
        "padding:8px 10px",
        "border-radius:8px",
        "font:12px/1.2 system-ui, sans-serif",
        "box-shadow:0 2px 10px rgba(0,0,0,.35)",
        "opacity:.85"
    ].join(";");

    document.addEventListener("DOMContentLoaded", () => {
        document.documentElement.appendChild(badge);
        setTimeout(() => badge.remove(), 4000);
    });
})();
