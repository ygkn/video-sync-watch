const elements = {
  wsUrl: document.getElementById("ws-url"),
  accessKey: document.getElementById("access-key"),
  connectBtn: document.getElementById("connect-btn"),
  error: document.getElementById("error"),
  form: document.getElementById("connection-form"),
  status: document.getElementById("status"),
};

function updateUI(state) {
  // Connection status
  if (state.connected && state.authenticated) {
    elements.connectBtn.textContent = "Connected";
    elements.connectBtn.disabled = true;
    elements.wsUrl.disabled = true;
    elements.accessKey.disabled = true;
    elements.status.style.display = "block";
  } else {
    elements.connectBtn.textContent = "Connect";
    elements.connectBtn.disabled = false;
    elements.wsUrl.disabled = false;
    elements.accessKey.disabled = false;
    elements.status.style.display = "none";
  }

  // Error
  if (state.error) {
    elements.error.textContent = state.error;
    elements.error.style.display = "block";
    setTimeout(() => {
      elements.error.style.display = "none";
    }, 5000);
  }

  // Connection info
  if (state.webSocketUrl) {
    elements.wsUrl.value = state.webSocketUrl;
  }
  if (state.accessKey) {
    elements.accessKey.value = state.accessKey;
  }
}

function requestState() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(
        tabs[0].id,
        { type: "get-state" },
        (response) => {
          if (response) {
            updateUI(response);
          }
        }
      );
    }
  });
}

elements.form.addEventListener("submit", (e) => {
  e.preventDefault();

  const formData = new FormData(elements.form);
  const wsUrl = formData.get("wsUrl");
  const accessKey = formData.get("accessKey");

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(
        tabs[0].id,
        {
          type: "connect",
          wsUrl: wsUrl,
          accessKey: accessKey,
        },
        (response) => {
          if (response && response.success) {
            requestState();
          }
        }
      );
    }
  });
});

// Initial state request
requestState();