"use strict";

(() => {
  // ─── Selectors ───────────────────────────────────────────────────────────────

  const AD_SELECTORS = [
    // In-feed / sidebar ads
    "ytd-ad-slot-renderer",
    "ytd-display-ad-renderer",
    "ytd-in-feed-ad-layout-renderer",
    "ytd-promoted-video-renderer",
    "ytd-promoted-sparkles-web-renderer",
    "ytd-search-pyv-renderer",
    "ytd-banner-promo-renderer",
    "ytd-statement-banner-renderer",
    "ytd-ad-slot-renderer",
    // Player overlays
    "#player-ads",
    ".ytp-ad-overlay-container",
    ".ytp-ad-overlay-slot",
    ".ytp-ad-text-overlay",
    ".ytp-ad-image-overlay",
    // Shopping / promo panels
    "ytd-action-companion-ad-renderer",
    "ytd-watch-next-secondary-results-renderer ytd-compact-promoted-video-renderer",
    // Masthead
    "#masthead-ad",
    "ytd-rich-item-renderer:has(ytd-ad-slot-renderer)"
  ];

  const SKIP_SELECTORS = [
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-skip-ad-button",
    ".ytp-ad-overlay-close-button"
  ];

  // ─── State ───────────────────────────────────────────────────────────────────

  let enabled = true;
  const STYLE_ID = "yt-ad-blocker-style";

  // ─── CSS Hide ────────────────────────────────────────────────────────────────

  function updateStyle() {
    const existing = document.getElementById(STYLE_ID);
    if (!enabled) {
      existing?.remove();
      return;
    }
    if (existing || !document.documentElement) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `${AD_SELECTORS.join(",\n")} { display: none !important; visibility: hidden !important; }`;
    document.documentElement.appendChild(style);
  }

  // ─── DOM Removal ─────────────────────────────────────────────────────────────

  function removeAdElements() {
    if (!enabled) return;
    for (const selector of AD_SELECTORS) {
      try {
        document.querySelectorAll(selector).forEach(el => el.remove());
      } catch (_) { /* ignore invalid selectors in older Chrome */ }
    }
  }

  // ─── Player Ad Skip / Block ───────────────────────────────────────────────────

  function handlePlayerAd() {
    if (!enabled) return;

    const player = document.querySelector(".html5-video-player.ad-showing");
    if (!player) return;

    // 1. Click any visible skip button immediately
    for (const sel of SKIP_SELECTORS) {
      const btn = player.querySelector(sel);
      if (btn && !btn.disabled && btn.offsetParent !== null) {
        btn.click();
        return; // skip button clicked – done for this tick
      }
    }

    // 2. No skip button yet – try to end the ad by seeking to its end
    const video = player.querySelector("video");
    if (video && isFinite(video.duration) && video.duration > 0) {
      // Seek to just before the end so YouTube marks the ad as "watched"
      // and transitions to the real video.
      video.currentTime = video.duration - 0.01;
    }
  }

  // ─── MutationObserver ────────────────────────────────────────────────────────

  let observer = null;

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(() => {
      removeAdElements();
      handlePlayerAd();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function stopObserver() {
    if (!observer) return;
    observer.disconnect();
    observer = null;
  }

  // ─── Interval fallback ────────────────────────────────────────────────────────

  function tick() {
    updateStyle();
    removeAdElements();
    handlePlayerAd();
  }

  // ─── Init & Storage Sync ─────────────────────────────────────────────────────

  function applyEnabled(val) {
    enabled = val;
    if (enabled) {
      updateStyle();
      removeAdElements();
      startObserver();
    } else {
      document.getElementById(STYLE_ID)?.remove();
      stopObserver();
    }
  }

  chrome.storage.local.get("enabled", ({ enabled: storedEnabled }) => {
    applyEnabled(storedEnabled !== false);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !("enabled" in changes)) return;
    applyEnabled(changes.enabled.newValue !== false);
  });

  // Run immediately and on DOMContentLoaded
  tick();
  document.addEventListener("DOMContentLoaded", tick, { once: true });

  // Fallback interval for edge cases (e.g. dynamically injected ads)
  window.setInterval(tick, 800);

  startObserver();
})();
