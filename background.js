// background.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchPageSource') {
    // Send message to content script to get the page source
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'getPageSource' }, function(response) {
        if (response && response.pageSource) {
          sendResponse(response);  // Send the page source back to the caller
        } else {
          sendResponse({ pageSource: '' });  // Return an empty string if no page source
        }
      });
    });

    // Keep the message channel open for async response
    return true;
  }
});
