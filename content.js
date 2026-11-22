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

  // ── Селекторы диалога "Блокировщик рекламы обнаружен" ─────────────────────
  const ENFORCEMENT_SELECTORS = [
    // Основной диалог-оверлей (enforcement message)
    "yt-mealmaker-dialog-host",
    "ytd-enforcement-message-view-model",
    // Контейнер диалога
    "yt-playability-error-supported-renderers",
    // Попап с предупреждением
    ".yt-mealmaker-dialog-host",
    // Оверлей который перекрывает плеер
    ".ytd-enforcement-message-view-model"
  ];

  const SKIP_SELECTORS = [
    ".ytp-ad-skip-button-modern",
    ".ytp-skip-ad-button",
    ".ytp-ad-skip-button",
    ".ytp-ad-overlay-close-button",
    ".ytp-ad-skip-button-slot button"
  ];

  let enabled = true;
  let globallyEnabled = true;
  let contextKey = "";
  let lastContextCheck = 0;
  let lastScan = 0;
  let adShowing = false;
  const seenAds = new WeakSet();
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
    // Скрываем рекламу И enforcement-диалог через CSS
    const allSelectors = [...AD_SELECTORS, ...ENFORCEMENT_SELECTORS];
    style.textContent = `
      ${allSelectors.join(",\n")} { display: none !important; }

      /* Разблокировать скролл страницы если диалог его заблокировал */
      body.yt-ad-blocker-active { overflow: auto !important; }

    `;
    document.documentElement.appendChild(style);
  }

  // ── Удалить enforcement-диалог "Блокировщик рекламы обнаружен" ───────────
  function removeEnforcementDialog() {
    if (!enabled) return;
    if (!ENFORCEMENT_SELECTORS.some(selector => document.querySelector(selector))) return;

    // Удалить все элементы диалога из DOM
    for (const selector of ENFORCEMENT_SELECTORS) {
      try {
        document.querySelectorAll(selector).forEach(el => el.remove());
      } catch (_) {}
    }
    document.querySelectorAll("tp-yt-iron-overlay-backdrop").forEach(el => el.remove());

    // Убрать блокировку скролла которую YouTube вешает при диалоге
    document.documentElement?.style?.removeProperty("overflow");
    document.body?.style?.removeProperty("overflow");

    // Восстановить плеер — убрать класс "unplayable" если YouTube его поставил
    const player = document.querySelector(".html5-video-player");
    if (player) {
      player.classList.remove("unplayable-reason");
      player.classList.remove("ytp-error");
    }

    // Если видео на паузе из-за диалога — возобновить воспроизведение
    const video = document.querySelector(".html5-video-player video");
    if (video && video.paused && !video.ended) {
      video.play().catch(() => {});
    }
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
      adShowing = false;
      return;
    }

    const player = document.querySelector(".html5-video-player.ad-showing");
    if (!player) {
      restoreVideo();
      adShowing = false;
      return;
    }

    if (!adShowing) {
      adShowing = true;
      void chrome.runtime.sendMessage({ type: "REPORT_STATS", skipped: 1 }).catch(() => {});
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
    refreshContext();
    if (!enabled) return;
    updateStyle();
    removeEnforcementDialog();
    handlePlayerAd();
    if (Date.now() - lastScan >= 1000) {
      lastScan = Date.now();
      let hidden = 0;
      for (const element of document.querySelectorAll(AD_SELECTORS.join(","))) {
        if (seenAds.has(element)) continue;
        seenAds.add(element);
        hidden++;
      }
      if (hidden) {
        void chrome.runtime.sendMessage({ type: "REPORT_STATS", hidden }).catch(() => {});
      }
    }
  }

  function getContext() {
    const url = new URL(window.location.href);
    const videoId = url.pathname === "/watch"
      ? url.searchParams.get("v")
      : url.pathname.startsWith("/shorts/") ? url.pathname.split("/")[2] : null;
    const channelLink = document.querySelector(
      "ytd-watch-metadata ytd-channel-name a[href], ytd-reel-player-header-renderer a[href]"
    );
    const channelPath = channelLink?.getAttribute("href") || url.pathname;
    const channelId = channelPath.match(/^\/(UC[\w-]{22}|@[\w.-]{3,30}|channel\/UC[\w-]{22})/);
    return {
      videoId: videoId && /^[\w-]{11}$/.test(videoId) ? videoId : null,
      channelId: channelId ? channelId[1].replace(/^channel\//, "") : null
    };
  }

  function refreshContext(force = false) {
    if (!force && Date.now() - lastContextCheck < 500) return Promise.resolve();
    lastContextCheck = Date.now();
    const context = getContext();
    const nextKey = `${window.location.pathname}|${context.videoId}|${context.channelId}`;
    if (!force && nextKey === contextKey) return Promise.resolve();
    contextKey = nextKey;
    return chrome.runtime.sendMessage({ type: "SYNC_TAB_CONTEXT", context })
      .then((state) => {
        if (nextKey === contextKey && state && typeof state.active === "boolean") {
          setActive(state.active);
        }
      })
      .catch(() => {});
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
    if (enabled) setupObserver();
    tick();
  }

  function setActive(active) {
    if (enabled === active) return;
    enabled = active;
    syncInjectedState();
    if (enabled) init();
    else {
      teardownObserver();
      restoreVideo();
      adShowing = false;
      updateStyle();
    }
  }

  function syncInjectedState() {
    window.postMessage({ source: "yt-ad-blocker", enabled }, window.location.origin);
  }

  // ── Загрузить сохранённое состояние ──────────────────────────────────────
  chrome.storage.local.get("enabled", ({ enabled: stored }) => {
    globallyEnabled = stored !== false;
    enabled = globallyEnabled;
    syncInjectedState();
    init();
    refreshContext(true);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if ("enabled" in changes) {
      globallyEnabled = changes.enabled.newValue !== false;
      setActive(globallyEnabled);
    }
    if ("enabled" in changes || "excludedVideos" in changes || "excludedChannels" in changes) {
      refreshContext(true);
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "REFRESH_STATE") return false;
    refreshContext(true).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  });

  document.addEventListener("DOMContentLoaded", () => {
    if (enabled) init();
    refreshContext(true);
  }, { once: true });

  document.addEventListener("yt-navigate-finish", () => refreshContext(true));
  window.addEventListener("popstate", () => refreshContext(true));

  // Fallback-интервал на случай динамического обновления страницы
  window.setInterval(() => {
    tick();
  }, 1500);
})();
