chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "capture-tab") {
    try {
      chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
        if (chrome.runtime.lastError) {
          sendResponse({
            success: false,
            error: "captureVisibleTab: " + chrome.runtime.lastError.message,
          });
          return;
        }

        if (!dataUrl) {
          sendResponse({
            success: false,
            error: "captureVisibleTab returned empty image",
          });
          return;
        }

        sendResponse({
          success: true,
          dataUrl,
        });
      });
    } catch (e) {
      sendResponse({
        success: false,
        error: "background exception: " + e.message,
      });
    }

    return true;
  }

  if (msg.type === "fetch-consignment-details") {
    fetch(msg.url, { credentials: "include" })
      .then(async (res) => {
        const text = await res.text();
        sendResponse({ success: true, html: text });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });

    return true;
  }
});
