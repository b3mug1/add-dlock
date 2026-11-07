"use strict";

(() => {
  const STYLE_ID = "yt-ad-blocker-style";
  const AD_SELECTORS = [
    "ytd-ad-slot-renderer",
    "ytd-display-ad-renderer",
    "ytd-in-feed-ad-layout-renderer",
    "ytd-promoted-video-renderer",
    "ytd-promoted-sparkles-web-renderer",
    "ytd-search-pyv-renderer",
    "#player-ads",
    ".ytp-ad-overlay-container"
  ];
  const SKIP_SELECTORS = [
    ".ytp-ad-skip-button-modern",
    ".ytp-skip-ad-button",
    ".ytp-ad-skip-button",
    ".ytp-ad-overlay-close-button"
  ];

  let enabled = true;
  let videoState = null;

  function updateStyle() {
    const existing = document.getElementById(STYLE_ID);
    if (!enabled) {
      existing?.remove();
      return;
    }
    if (existing || !document.documentElement) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `${AD_SELECTORS.join(",\n")} { display: none !important; }`;
    document.documentElement.appendChild(style);
  }

  function restoreVideo() {
    if (!videoState) return;
    const { video, muted, playbackRate } = videoState;
    if (video.muted) video.muted = muted;
    if (video.playbackRate === 16) video.playbackRate = playbackRate;
    videoState = null;
  }

  function handlePlayerAd() {
    if (!enabled) {
      restoreVideo();
      return;
    }

    const player = document.querySelector(".html5-video-player.ad-showing");
    if (!player) {
      restoreVideo();
      return;
    }

    for (const selector of SKIP_SELECTORS) {
      const button = player.querySelector(selector);
      if (button && button.getClientRects().length > 0 && !button.disabled) {
        button.click();
      }
    }

    const video = player.querySelector("video");
    if (!video) return;
    if (videoState?.video !== video) {
      restoreVideo();
      videoState = { video, muted: video.muted, playbackRate: video.playbackRate };
    }
    video.muted = true;
    video.playbackRate = 16;
  }

  function tick() {
    updateStyle();
    handlePlayerAd();
  }

  chrome.storage.local.get("enabled", ({ enabled: storedEnabled }) => {
    enabled = storedEnabled !== false;
    tick();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.enabled) return;
    enabled = changes.enabled.newValue !== false;
    tick();
  });

  document.addEventListener("DOMContentLoaded", tick, { once: true });
  window.setInterval(tick, 500);
})();
