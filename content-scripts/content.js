/**
 * SmartTheme Content Script v0.2.6
 * 純色覆蓋、0ms 安全掛載、黑白名單比對，並動態拼接網站 Adapter 與 Picker 文字修補。
 */
(function smartThemeContent() {
  "use strict";

  const STYLE_ID = "smart-theme-style";
  const FALLBACK_THEME = { type: "solid", value: "#CCE8CF" };

  /**
   * 解析 Hex 為 RGB；格式異常時回傳中性灰避免 NaN。
   * @param {string} hex
   * @returns {{r: number, g: number, b: number}}
   */
  function hexToRgb(hex) {
    try {
      const cleanHex = String(hex || "").replace("#", "");
      const normalized = cleanHex.length === 3
        ? cleanHex.split("").map((char) => char + char).join("")
        : cleanHex;
      const bigint = parseInt(normalized, 16);
      if (Number.isNaN(bigint)) {
        return { r: 200, g: 200, b: 200 };
      }
      return {
        r: (bigint >> 16) & 255,
        g: (bigint >> 8) & 255,
        b: bigint & 255,
      };
    } catch (error) {
      console.error("SmartTheme hex 解析失敗：", error);
      return { r: 200, g: 200, b: 200 };
    }
  }

  /**
   * YIQ 亮度自動配字色；forceInvert 為方案 C 手動黑白對調。
   * @param {string} hex
   * @param {boolean} forceInvert
   * @returns {string}
   */
  function getContrastTextColor(hex, forceInvert) {
    const rgb = hexToRgb(hex);
    const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    let color = luminance < 0.55 ? "#F8FAFC" : "#0F172A";
    if (forceInvert) {
      color = color === "#F8FAFC" ? "#0F172A" : "#F8FAFC";
    }
    return color;
  }

  /**
   * 組出純色 CSS。domainFixCSS 可含熱門網站 tokens 與 Picker 的 color／background 修補。
   * @param {{type: string, value: string}} theme
   * @param {boolean} forceInvert
   * @param {string} domainFixCSS
   * @returns {string}
   */
  function buildThemeCss(theme, forceInvert, domainFixCSS) {
    const bg = theme && theme.value ? theme.value : FALLBACK_THEME.value;
    const text = getContrastTextColor(bg, Boolean(forceInvert));
    const extraFixes = typeof domainFixCSS === "string" ? domainFixCSS : "";
    return `
:root {
  --st-bg-color: ${bg};
  --st-text-color: ${text};
}
html, body {
  background-color: var(--st-bg-color) !important;
  color: var(--st-text-color);
}
${extraFixes}
`.trim();
  }

  /**
   * 把內建 Adapter 與使用者 Picker 補丁拼成一段 domainFixCSS。
   * @param {object} settings
   * @param {string} hostname
   * @returns {string}
   */
  function composeDomainFixCss(settings, hostname) {
    const staticFix = rootSmartThemeSiteFixes()
      ? rootSmartThemeSiteFixes().getSiteFixCss(hostname)
      : "";
    const patchCss = SmartThemeStorage && typeof SmartThemeStorage.getSitePatchCss === "function"
      ? SmartThemeStorage.getSitePatchCss(settings && settings.sitePatches, hostname)
      : "";
    return [staticFix, patchCss].filter(Boolean).join("\n");
  }

  /**
   * @returns {{getSiteFixCss: Function}|null}
   */
  function rootSmartThemeSiteFixes() {
    return typeof SmartThemeSiteFixes !== "undefined" ? SmartThemeSiteFixes : null;
  }

  /**
   * 防線一：document_start 同步插入樣式；掛載點避開 head 為 null。
   * @returns {HTMLStyleElement|null}
   */
  function injectStyleImmediately() {
    try {
      const existing = document.getElementById(STYLE_ID);
      if (existing) {
        return existing;
      }
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = buildThemeCss(FALLBACK_THEME, false, "");
      const target = document.documentElement || document.head;
      if (target) {
        target.appendChild(style);
      }
      return style;
    } catch (error) {
      console.error("SmartTheme 0ms 注入失敗：", error);
      return null;
    }
  }

  /**
   * 防線二：讀取 sync、比對名單，再拼接 YouTube／Google／巴哈 Adapter 與 Picker 補丁。
   */
  async function refreshFromStorage() {
    try {
      const settings = await SmartThemeStorage.getSettings();
      const style = document.getElementById(STYLE_ID) || injectStyleImmediately();
      if (!style) {
        return;
      }
      const hostname = window.location.hostname;
      if (!SmartThemeStorage.shouldApplyTheme(settings, hostname)) {
        style.textContent = "";
        return;
      }
      const theme = SmartThemeStorage.resolveTheme(settings, hostname) || FALLBACK_THEME;
      const domainFixCSS = composeDomainFixCss(settings, hostname);
      style.textContent = buildThemeCss(theme, settings.forceInvertText, domainFixCSS);
    } catch (error) {
      console.error("SmartTheme 套用失敗：", error);
    }
  }

  /**
   * 監聽 sync 變更，已開啟分頁即時換色。
   */
  function watchStorageChanges() {
    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "sync") {
          return;
        }
        refreshFromStorage();
      });
    } catch (error) {
      console.error("SmartTheme 監聽 storage 失敗：", error);
    }
  }

  injectStyleImmediately();
  refreshFromStorage();
  watchStorageChanges();
})();
