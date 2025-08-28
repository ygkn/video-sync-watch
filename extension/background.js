// Logging function
function log(message, data) {
  const timestamp = new Date().toISOString();
  if (data !== undefined) {
    console.log(`[${timestamp}] [Background]`, message, data);
  } else {
    console.log(`[${timestamp}] [Background]`, message);
  }
}

// Badge update handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'update-badge') {
    if (sender.tab && sender.tab.id) {
      log('Updating badge', { 
        tabId: sender.tab.id, 
        text: request.text, 
        color: request.color,
        url: sender.tab.url
      });
      
      chrome.action.setBadgeText({
        text: request.text || '',
        tabId: sender.tab.id
      });
      
      chrome.action.setBadgeBackgroundColor({
        color: request.color || '#666',
        tabId: sender.tab.id
      });
    }
  }
});

// Log extension startup
log('Extension background script loaded');