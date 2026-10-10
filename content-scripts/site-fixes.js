/**
 * 熱門網站 CSS 變數 Adapter（v0.2.6）
 * 覆蓋網站 Design Tokens 與關鍵區塊文字色，避免全域強制 inherit 破壞按鈕。
 */
(function attachSmartThemeSiteFixes(root) {
  "use strict";

  const YOUTUBE_FIX_CSS = `
    :root, html, ytd-app {
      --yt-spec-base-background: var(--st-bg-color) !important;
      --yt-spec-general-background-a: var(--st-bg-color) !important;
      --yt-sys-color-baseline--add-on-green-base-background: var(--st-bg-color) !important;
      --yt-spec-text-primary: var(--st-text-color) !important;
      --yt-spec-text-secondary: var(--st-text-color) !important;
      background-color: var(--st-bg-color) !important;
      color: var(--st-text-color);
    }
  `;

  const GOOGLE_FIX_CSS = `
    :root, html, body {
      --gm-sys-color-surface: var(--st-bg-color) !important;
      --gm-sys-color-on-surface: var(--st-text-color) !important;
      background-color: var(--st-bg-color) !important;
      color: var(--st-text-color);
    }
  `;

  const GAMER_FIX_CSS = `
    :root, body, .theme-header, .mainmenu {
      --anime-background-elevated: var(--st-bg-color) !important;
      background-color: var(--st-bg-color) !important;
    }
    .theme-header,
    .mainmenu,
    .theme-header *,
    .mainmenu * {
      color: var(--st-text-color) !important;
    }
  `;

  const SITE_FIXES = {
    "youtube.com": YOUTUBE_FIX_CSS,
    "google.com": GOOGLE_FIX_CSS,
    "google.com.tw": GOOGLE_FIX_CSS,
    "gamer.com.tw": GAMER_FIX_CSS,
  };

  /**
   * 依清洗後網域找出對應 Adapter（子網域會回落到父網域規則）。
   * @param {string} hostname
   * @returns {string}
   */
  function getSiteFixCss(hostname) {
    try {
      const matcher = root.SmartThemeMatcher;
      const cleanHost = matcher ? matcher.cleanDomain(hostname) : String(hostname || "");
      if (!cleanHost) {
        return "";
      }
      if (SITE_FIXES[cleanHost]) {
        return SITE_FIXES[cleanHost];
      }
      const matchedKey = Object.keys(SITE_FIXES).find((key) => {
        return cleanHost === key || cleanHost.endsWith("." + key);
      });
      return matchedKey ? SITE_FIXES[matchedKey] : "";
    } catch (error) {
      console.error("SmartTheme 取得網站 Adapter 失敗：", error);
      return "";
    }
  }

  root.SITE_FIXES = SITE_FIXES;
  root.SmartThemeSiteFixes = {
    SITE_FIXES,
    getSiteFixCss,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
