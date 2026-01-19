// content.js
(() => {
    // Create a <script> tag that loads a script file from the extension.
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("page-script.js");
    s.type = "text/javascript";
    s.dataset.from = "mv3-inject-demo";

    // Inject as early as possible.
    (document.documentElement || document.head || document.body).appendChild(s);

    // Optional: remove the tag after it loads (the code stays executed).
    s.addEventListener("load", () => s.remove());
})();
