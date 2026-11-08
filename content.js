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
    "ytd-banner-promo-renderer",
    "ytd-statement-banner-renderer",
    "ytd-rich-item-renderer[is-ad]",
    "#player-ads",
    "#masthead-ad",
    ".ytp-ad-overlay-container",
    ".ytp-ad-text-overlay",
    ".ytp-ad-image-overlay",
    ".ytp-ad-module",
    ".ytp-ad-player-overlay",
    ".ytp-ad-player-overlay-layout",
    ".video-ads",
    "ytd-action-companion-ad-renderer",
    "ytd-watch-next-secondary-results-renderer ytd-compact-promoted-video-renderer"
  ];

  const SKIP_SELECTORS = [
    ".ytp-ad-skip-button-modern",
    ".ytp-skip-ad-button",
    ".ytp-ad-skip-button",
    ".ytp-ad-overlay-close-button",
    ".ytp-ad-skip-button-slot button"
  ];

  let enabled = true;
  let savedMuted = false;
  let savedRate = 1;
  let savedVideo = null;
  let observer = null;
  let skipAttempts = 0;

  // ── CSS-скрытие рекламных блоков ──────────────────────────────────────────
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

  // ── Восстановить нормальное воспроизведение после рекламы ─────────────────
  function restoreVideo() {
    if (!savedVideo) return;
    savedVideo.muted = savedMuted;
    savedVideo.playbackRate = savedRate;
    savedVideo = null;
    skipAttempts = 0;
  }

  // ── Нажать кнопку «Пропустить» если она доступна ─────────────────────────
  function tryClickSkip(player) {
    for (const sel of SKIP_SELECTORS) {
      const btn = player.querySelector(sel);
      if (btn && !btn.disabled && btn.getClientRects().length > 0) {
        btn.click();
        return true;
      }
    }
    return false;
  }

  // ── Основная логика обработки рекламы в плеере ───────────────────────────
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

    // 1) Попробовать нажать «Пропустить»
    tryClickSkip(player);

    const video = player.querySelector("video");
    if (!video) return;

    // Сохранить исходное состояние видео
    if (savedVideo !== video) {
      restoreVideo();
      savedVideo = video;
      savedMuted = video.muted;
      savedRate = video.playbackRate;
      skipAttempts = 0;
    }

    // 2) Мгновенный прыжок к концу рекламного видео
    if (isFinite(video.duration) && video.duration > 0) {
      video.currentTime = video.duration;
    }

    // 3) Заглушить на время рекламы
    video.muted = true;

    // 4) Запасной вариант: ускорение — только если прыжок не работает несколько тиков
    skipAttempts++;
    if (skipAttempts > 4 && video.playbackRate < 16) {
      video.playbackRate = 16;
    }
  }

  function tick() {
    updateStyle();
    handlePlayerAd();
  }

  // ── MutationObserver: мгновенная реакция при появлении рекламы ───────────
  function setupObserver() {
    if (observer) return;
    const target = document.body || document.documentElement;
    if (!target) return;
    observer = new MutationObserver(tick);
    observer.observe(target, {
      childList: true,
      subtree: true,
      attributeFilter: ["class"]
    });
  }

  function teardownObserver() {
    observer?.disconnect();
    observer = null;
  }

  function init() {
    updateStyle();
    setupObserver();
    tick();
  }

  // ── Загрузить сохранённое состояние ──────────────────────────────────────
  chrome.storage.local.get("enabled", ({ enabled: stored }) => {
    enabled = stored !== false;
    init();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !("enabled" in changes)) return;
    enabled = changes.enabled.newValue !== false;
    if (!enabled) {
      teardownObserver();
      restoreVideo();
    } else {
      init();
    }
    updateStyle();
  });

  document.addEventListener("DOMContentLoaded", init, { once: true });

  // Fallback-интервал на случай динамического обновления страницы
  window.setInterval(tick, 300);
})();
