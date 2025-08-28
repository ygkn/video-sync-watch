(() => {
  "use strict";

  const CONFIG = {
    debug: true,
    checkInterval: 1000,
    stateUpdateInterval: 500,
  };

  const state = {
    webSocketUrl: null,
    accessKey: null,
    connected: false,
    authenticated: false,
    participants: 0,
    videoDetected: false,
    error: null,
  };

  let webSocket = null;
  let reconnectTimerId = null;
  let video = null;
  let lastVideoState = null;
  let stateTimer = null;
  let isControlledSync = false;
  let isActive = false; // Only activate after connection
  let observer = null;
  let checkInterval = null;

  const log = (...args) => {
    if (CONFIG.debug) {
      const timestamp = new Date().toISOString();
      const context = window.self === window.top ? "Top" : "Frame";
      console.log(`[${timestamp}] [SyncWatch:${context}]`, ...args);
    }
  };

  log("Content script loaded in:", window.location.href);

  // Video detection and control functions
  function findVideo() {
    const videos = document.querySelectorAll("video");
    
    if (videos.length === 0) {
      return null;
    }
    
    // First priority: currently playing video
    for (const v of videos) {
      if (!v.paused && v.readyState >= 2) {
        log("Found playing video");
        return v;
      }
    }
    
    // Second priority: paused video with currentTime > 0
    for (const v of videos) {
      if (v.currentTime > 0) {
        log("Found paused video with progress");
        return v;
      }
    }
    
    // Third priority: video with src
    for (const v of videos) {
      if (v.src || v.currentSrc) {
        log("Found video with source");
        return v;
      }
    }
    
    // Fallback: first video
    log("Found video element (fallback)");
    return videos[0];
  }

  function getVideoState() {
    if (!video) return null;

    return {
      currentTime: video.currentTime,
      paused: video.paused,
      playbackRate: video.playbackRate,
    };
  }

  function sendVideoState() {
    if (!video || !webSocket || webSocket.readyState !== WebSocket.OPEN || !state.authenticated) return;

    const videoState = getVideoState();
    if (JSON.stringify(videoState) !== JSON.stringify(lastVideoState)) {
      lastVideoState = videoState;
      const message = {
        type: "sync",
        action: "state-update",
        data: videoState,
      };
      webSocket.send(JSON.stringify(message));
      log("Sent video state:", {
        currentTime: videoState.currentTime.toFixed(2),
        paused: videoState.paused,
      });
    }
  }

  function attachVideoListeners() {
    if (!video) return;

    const events = ["play", "pause", "seeked", "ratechange"];

    for (const event of events) {
      video.addEventListener(event, () => {
        if (!isControlledSync) {
          log(`Video event: ${event}`, {
            currentTime: video.currentTime.toFixed(2),
            paused: video.paused,
          });
          sendVideoState();
        } else {
          log(`Video event (controlled): ${event} - skipping sync`);
        }
      });
    }

    video.addEventListener("timeupdate", () => {
      if (
        !isControlledSync &&
        Math.abs(video.currentTime - (lastVideoState?.currentTime || 0)) > 1
      ) {
        sendVideoState();
      }
    });

    if (stateTimer) {
      clearInterval(stateTimer);
    }
    stateTimer = setInterval(sendVideoState, CONFIG.stateUpdateInterval);

    log("Video listeners attached");
  }

  function applyVideoState(videoState) {
    if (!video || !videoState) return;

    isControlledSync = true;
    log("Applying received video state:", {
      currentTime: videoState.currentTime?.toFixed(2),
      paused: videoState.paused,
    });

    try {
      if (
        videoState.paused !== undefined &&
        video.paused !== videoState.paused
      ) {
        if (videoState.paused) {
          log("Pausing video");
          video.pause();
        } else {
          log("Playing video");
          video.play().catch((e) => {
            log("Play failed:", e.message);
          });
        }
      }

      if (
        videoState.currentTime !== undefined &&
        Math.abs(video.currentTime - videoState.currentTime) > 0.5
      ) {
        log(
          `Seeking from ${video.currentTime.toFixed(
            2
          )} to ${videoState.currentTime.toFixed(2)}`
        );
        video.currentTime = videoState.currentTime;
      }

      if (
        videoState.playbackRate !== undefined &&
        video.playbackRate !== videoState.playbackRate
      ) {
        video.playbackRate = videoState.playbackRate;
      }
    } catch (e) {
      log("Error applying video state:", e);
    }

    setTimeout(() => {
      isControlledSync = false;
    }, 200);
  }

  function checkForVideo() {
    if (!isActive) return; // Don't check if not connected
    
    const newVideo = findVideo();

    if (newVideo && newVideo !== video) {
      // Clean up old video if exists
      if (video) {
        log("Switching from old video to new video");
        if (stateTimer) {
          clearInterval(stateTimer);
          stateTimer = null;
        }
      }
      
      video = newVideo;
      state.videoDetected = true;
      log("Video element attached:", {
        src: video.src || video.currentSrc,
        paused: video.paused,
        currentTime: video.currentTime
      });

      attachVideoListeners();
      sendVideoState();
      updateBadge();
    } else if (!newVideo && video) {
      log("Video element lost");
      video = null;
      lastVideoState = null;
      state.videoDetected = false;

      if (stateTimer) {
        clearInterval(stateTimer);
        stateTimer = null;
      }

      updateBadge();
    }
  }

  // WebSocket functions
  function connectWebSocket() {
    if (
      typeof state.webSocketUrl !== "string" ||
      state.webSocketUrl.length === 0 ||
      typeof state.accessKey !== "string" ||
      state.accessKey.length === 0
    ) {
      log("WebSocket URL or Access Key not configured");
      return;
    }

    if (webSocket !== null) {
      webSocket.close();
    }

    log("Attempting WebSocket connection:", state.webSocketUrl);
    webSocket = new WebSocket(state.webSocketUrl);
    
    // Start video detection when connecting
    if (!isActive) {
      startVideoDetection();
    }

    webSocket.onopen = () => {
      log("WebSocket connected successfully");
      state.connected = true;

      if (reconnectTimerId !== null) {
        clearTimeout(reconnectTimerId);
        reconnectTimerId = null;
      }

      const authMessage = {
        type: "auth",
        accessKey: state.accessKey,
      };
      webSocket.send(JSON.stringify(authMessage));
      log("Sent authentication request");

      updateBadge();
    };

    webSocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        log("WebSocket message:", message);

        switch (message.type) {
          case "authenticated":
            state.authenticated = true;
            state.participants = message.participants;
            log(
              "Authentication successful. Participants:",
              message.participants
            );
            updateBadge();
            break;
          case "sync":
            // Receive sync commands from other clients
            if (message.action === "state-update") {
              applyVideoState(message.data);
            }
            break;
          case "participant-update":
            state.participants = message.participants;
            log("Participants updated:", message.participants);
            break;
          case "error":
            console.error("[SyncWatch] Server error:", message.message);
            state.error = message.message;
            break;
        }
      } catch (error) {
        console.error("[SyncWatch] Error parsing message:", error);
      }
    };

    webSocket.onclose = (event) => {
      log("WebSocket disconnected", { code: event.code, reason: event.reason });
      state.connected = false;
      state.authenticated = false;
      updateBadge();

      reconnectTimerId = setTimeout(() => {
        if (
          typeof state.webSocketUrl === "string" &&
          state.webSocketUrl.length > 0 &&
          typeof state.accessKey === "string" &&
          state.accessKey.length > 0
        ) {
          log("Attempting to reconnect...");
          connectWebSocket();
        }
      }, 5000);
    };

    webSocket.onerror = (error) => {
      console.error("[SyncWatch] WebSocket error:", error);
      state.error = "Connection error";
    };
  }

  function disconnect() {
    log("Disconnecting from server");
    if (webSocket !== null) {
      webSocket.close();
      webSocket = null;
    }
    if (reconnectTimerId !== null) {
      clearTimeout(reconnectTimerId);
      reconnectTimerId = null;
    }
    state.connected = false;
    state.authenticated = false;
    
    // Stop video detection when disconnecting
    stopVideoDetection();
    
    updateBadge();
  }

  // Badge update
  function updateBadge() {
    let badgeText = "";
    let badgeColor = "#666666";
    
    if (state.connected) {
      if (state.authenticated) {
        badgeText = "✓";
        badgeColor = "#4caf50";
      } else {
        badgeText = "...";
        badgeColor = "#ff9800";
      }
    } else if (isActive) {
      // Trying to connect
      badgeText = "?";
      badgeColor = "#2196f3";
    }
    // If not active, show nothing (default gray)

    chrome.runtime.sendMessage({
      type: "update-badge",
      text: badgeText,
      color: badgeColor,
    });
  }

  // Message handling from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.type) {
      case "get-state":
        sendResponse({
          ...state,
          hasVideo: video !== null,
        });
        break;

      case "connect":
        log("Received connect request from popup", { wsUrl: request.wsUrl });
        state.webSocketUrl = request.wsUrl;
        state.accessKey = request.accessKey;
        connectWebSocket();
        sendResponse({ success: true });
        break;
    }
    return true;
  });

  // Video detection functions
  function startVideoDetection() {
    if (isActive) return; // Already active
    
    isActive = true;
    log("Starting video detection");
    
    // Create and start MutationObserver
    if (!observer) {
      observer = new MutationObserver(() => {
        checkForVideo();
      });
    }
    
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
      log("MutationObserver started");
    }
    
    // Start periodic check
    if (!checkInterval) {
      checkInterval = setInterval(checkForVideo, CONFIG.checkInterval);
    }
    
    // Initial check
    checkForVideo();
  }
  
  function stopVideoDetection() {
    if (!isActive) return; // Already inactive
    
    isActive = false;
    log("Stopping video detection");
    
    // Stop observer
    if (observer) {
      observer.disconnect();
    }
    
    // Stop interval
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
    
    // Clean up video
    if (video) {
      if (stateTimer) {
        clearInterval(stateTimer);
        stateTimer = null;
      }
      video = null;
      lastVideoState = null;
      state.videoDetected = false;
    }
  }
  
  // Listen for play events on any video element (using capture phase)
  document.addEventListener("play", (event) => {
    if (isActive && event.target instanceof HTMLVideoElement) {
      const playingVideo = event.target;
      if (playingVideo !== video) {
        log("Detected video play event, switching to playing video");
        checkForVideo();
      }
    }
  }, true);
  
  // Initial badge update
  updateBadge();
})();
