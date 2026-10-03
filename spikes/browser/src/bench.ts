// Empty extension-origin page used by the Playwright driver as a place to run chrome.* calls from.
(window as unknown as { __ready: boolean }).__ready = true;
