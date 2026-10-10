/**
 * SmartTheme 儲存層 v0.2.6
 * 封裝 chrome.storage.sync：純色主題、黑白名單、方案 C 反轉、Picker 動態補丁與容量防呆。
 */
(function attachSmartThemeStorage(root) {
  "use strict";

  /** 單一項目 siteThemes 最多保留的網域筆數 */
  const MAX_SITE_THEMES = 100;
  /** 黑白名單各自上限，避免 sync 配額溢出 */
  const MAX_DOMAIN_LIST = 200;
  /** 單一網域最多保留的 Picker 選擇器數量 */
  const MAX_PATCH_SELECTORS = 40;
  /** sitePatches 最多保留的網域筆數 */
  const MAX_PATCH_DOMAINS = 80;

  const DEFAULT_GLOBAL_THEME = {
    type: "solid",
    value: "#CCE8CF",
  };

  const DEFAULT_SETTINGS = {
    isEnabled: true,
    mode: "whitelist",
    globalTheme: DEFAULT_GLOBAL_THEME,
    forceInvertText: false,
    whitelistDomains: ["gamer.com.tw", "youtube.com"],
    blacklistDomains: [],
    siteThemes: {},
    sitePatches: {},
  };

  /**
   * 將 chrome.runtime.lastError 轉成可拋出的 Error。
   * @returns {Error|null}
   */
  function readLastError() {
    const message = chrome.runtime && chrome.runtime.lastError
      ? chrome.runtime.lastError.message
      : "";
    return message ? new Error(message) : null;
  }

  /**
   * 取得網域清洗器；若 matcher 尚未載入則做最小清洗。
   * @param {string} value
   * @returns {string}
   */
  function cleanDomain(value) {
    if (root.SmartThemeMatcher && typeof root.SmartThemeMatcher.cleanDomain === "function") {
      return root.SmartThemeMatcher.cleanDomain(value);
    }
    return String(value || "").trim().toLowerCase().replace(/^www\./, "");
  }

  /**
   * Promise 化 chrome.storage.sync.get，並以 try...catch + lastError 防護。
   * @param {string[]|null} keys
   * @returns {Promise<object>}
   */
  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.sync.get(keys, (result) => {
          const lastError = readLastError();
          if (lastError) {
            reject(lastError);
            return;
          }
          resolve(result || {});
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Promise 化 chrome.storage.sync.set，寫入失敗時不會讓呼叫端崩潰。
   * @param {object} items
   * @returns {Promise<void>}
   */
  function storageSet(items) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.sync.set(items, () => {
          const lastError = readLastError();
          if (lastError) {
            reject(lastError);
            return;
          }
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 正規化為純色主題；舊版漸層資料會回落到預設護眼綠。
   * @param {object} theme
   * @returns {{type: 'solid', value: string}}
   */
  function normalizeTheme(theme) {
    if (!theme || typeof theme !== "object") {
      return { ...DEFAULT_GLOBAL_THEME };
    }
    const value = typeof theme.value === "string" ? theme.value.trim() : "";
    const isSolidHex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
    if (theme.type === "gradient" || !isSolidHex) {
      return { ...DEFAULT_GLOBAL_THEME };
    }
    return { type: "solid", value: value.toUpperCase() };
  }

  /**
   * 清洗、去重並截斷網域名單。
   * @param {unknown} list
   * @returns {string[]}
   */
  function normalizeDomainList(list) {
    if (!Array.isArray(list)) {
      return [];
    }
    const unique = [];
    const seen = new Set();
    list.forEach((item) => {
      const domain = cleanDomain(item);
      if (!domain || seen.has(domain)) {
        return;
      }
      seen.add(domain);
      unique.push(domain);
    });
    return unique.slice(0, MAX_DOMAIN_LIST);
  }

  /**
   * 過濾可能破壞樣式表的選擇器，只允許 id、class、tag 與 nth-of-type。
   * @param {unknown} selector
   * @returns {string}
   */
  function sanitizeSelector(selector) {
    const value = String(selector || "").trim();
    if (!value || value.length > 180) {
      return "";
    }
    if (/[{}]|\/\*|\*\/|@|expression|url\s*\(/i.test(value)) {
      return "";
    }
    const allowed = /^([a-zA-Z][\w-]*|#[A-Za-z][\w-]*|\.[A-Za-z_][\w-]*|[a-zA-Z][\w-]*:nth-of-type\(\d+\))$/;
    return allowed.test(value) ? value : "";
  }

  /**
   * 正規化各網域的 Picker 動態補丁。
   * @param {unknown} raw
   * @returns {object}
   */
  function normalizeSitePatches(raw) {
    if (!raw || typeof raw !== "object") {
      return {};
    }
    const next = {};
    Object.keys(raw).forEach((host) => {
      const domain = cleanDomain(host);
      if (!domain) {
        return;
      }
      const entry = raw[host];
      const sourceList = Array.isArray(entry)
        ? entry
        : (entry && Array.isArray(entry.selectors) ? entry.selectors : []);
      const selectors = [];
      const seen = new Set();
      sourceList.forEach((item) => {
        const selector = sanitizeSelector(item);
        if (!selector || seen.has(selector)) {
          return;
        }
        seen.add(selector);
        selectors.push(selector);
      });
      if (selectors.length === 0) {
        return;
      }
      next[domain] = {
        selectors: selectors.slice(0, MAX_PATCH_SELECTORS),
        updatedAt: Number(entry && entry.updatedAt) || Date.now(),
      };
    });
    return next;
  }

  /**
   * 把選擇器寫入指定網域補丁，重複則移到最前，超額時 LRU 淘汰網域。
   * @param {object} sitePatches
   * @param {string} hostname
   * @param {string} selector
   * @returns {object}
   */
  function upsertSitePatch(sitePatches, hostname, selector) {
    const domain = cleanDomain(hostname);
    const cleanSelector = sanitizeSelector(selector);
    if (!domain || !cleanSelector) {
      return sitePatches && typeof sitePatches === "object" ? { ...sitePatches } : {};
    }
    const next = { ...(sitePatches || {}) };
    const current = next[domain] && Array.isArray(next[domain].selectors)
      ? next[domain].selectors.filter((item) => item !== cleanSelector)
      : [];
    current.unshift(cleanSelector);
    next[domain] = {
      selectors: current.slice(0, MAX_PATCH_SELECTORS),
      updatedAt: Date.now(),
    };
    const keys = Object.keys(next);
    if (keys.length <= MAX_PATCH_DOMAINS) {
      return next;
    }
    const sortedByAge = keys.sort((a, b) => {
      const timeA = Number(next[a] && next[a].updatedAt) || 0;
      const timeB = Number(next[b] && next[b].updatedAt) || 0;
      return timeA - timeB;
    });
    const overflow = keys.length - MAX_PATCH_DOMAINS;
    for (let index = 0; index < overflow; index += 1) {
      delete next[sortedByAge[index]];
    }
    return next;
  }

  /**
   * 把 Picker 選擇器編成可併入 domainFixCSS 的文字／背景修補。
   * @param {object} sitePatches
   * @param {string} hostname
   * @returns {string}
   */
  function getSitePatchCss(sitePatches, hostname) {
    const cleanHost = cleanDomain(hostname);
    if (!cleanHost || !sitePatches || typeof sitePatches !== "object") {
      return "";
    }
    const selectors = [];
    const seen = new Set();
    Object.keys(sitePatches).forEach((key) => {
      const cleanKey = cleanDomain(key);
      if (!cleanKey || (cleanHost !== cleanKey && !cleanHost.endsWith("." + cleanKey))) {
        return;
      }
      const list = sitePatches[key] && Array.isArray(sitePatches[key].selectors)
        ? sitePatches[key].selectors
        : [];
      list.forEach((item) => {
        const selector = sanitizeSelector(item);
        if (!selector || seen.has(selector)) {
          return;
        }
        seen.add(selector);
        selectors.push(selector);
      });
    });
    return selectors.map((selector) => `
${selector} {
  background-color: var(--st-bg-color) !important;
  color: var(--st-text-color) !important;
}
`).join("\n");
  }

  /**
   * 正規化黑白名單模式。
   * @param {unknown} mode
   * @returns {'whitelist'|'blacklist'}
   */
  function normalizeMode(mode) {
    return mode === "blacklist" ? "blacklist" : "whitelist";
  }

  /**
   * LRU：寫入新網域後若超過上限，刪除 updatedAt 最舊的紀錄。
   * @param {object} siteThemes
   * @param {string} hostname
   * @param {object} theme
   * @returns {object}
   */
  function upsertSiteThemeWithLru(siteThemes, hostname, theme) {
    const next = { ...(siteThemes || {}) };
    next[hostname] = {
      ...normalizeTheme(theme),
      updatedAt: Date.now(),
    };
    const keys = Object.keys(next);
    if (keys.length <= MAX_SITE_THEMES) {
      return next;
    }
    const sortedByAge = keys.sort((a, b) => {
      const timeA = Number(next[a] && next[a].updatedAt) || 0;
      const timeB = Number(next[b] && next[b].updatedAt) || 0;
      return timeA - timeB;
    });
    const overflow = keys.length - MAX_SITE_THEMES;
    for (let index = 0; index < overflow; index += 1) {
      delete next[sortedByAge[index]];
    }
    return next;
  }

  /**
   * 把 storage 原始資料補齊成 v0.2.6 Schema。
   * @param {object} stored
   * @returns {object}
   */
  function hydrateSettings(stored) {
    const source = stored && typeof stored === "object" ? stored : {};
    return {
      isEnabled: typeof source.isEnabled === "boolean"
        ? source.isEnabled
        : DEFAULT_SETTINGS.isEnabled,
      mode: normalizeMode(source.mode),
      globalTheme: normalizeTheme(source.globalTheme),
      forceInvertText: Boolean(source.forceInvertText),
      whitelistDomains: Array.isArray(source.whitelistDomains)
        ? normalizeDomainList(source.whitelistDomains)
        : [...DEFAULT_SETTINGS.whitelistDomains],
      blacklistDomains: normalizeDomainList(source.blacklistDomains),
      siteThemes: source.siteThemes && typeof source.siteThemes === "object"
        ? source.siteThemes
        : {},
      sitePatches: normalizeSitePatches(source.sitePatches),
    };
  }

  /**
   * 讀取並補齊完整設定。
   * @returns {Promise<object>}
   */
  async function getSettings() {
    try {
      const stored = await storageGet([
        "isEnabled",
        "mode",
        "globalTheme",
        "forceInvertText",
        "whitelistDomains",
        "blacklistDomains",
        "siteThemes",
        "sitePatches",
      ]);
      return hydrateSettings(stored);
    } catch (error) {
      console.error("SmartTheme 讀取設定失敗：", error);
      return hydrateSettings(DEFAULT_SETTINGS);
    }
  }

  /**
   * 安裝或升級時寫入缺漏欄位，不覆蓋使用者既有資料。
   * @returns {Promise<void>}
   */
  async function initializeDefaults() {
    try {
      const stored = await storageGet(null);
      const patch = {};
      if (typeof stored.isEnabled !== "boolean") {
        patch.isEnabled = DEFAULT_SETTINGS.isEnabled;
      }
      if (stored.mode !== "whitelist" && stored.mode !== "blacklist") {
        patch.mode = DEFAULT_SETTINGS.mode;
      }
      if (!stored.globalTheme) {
        patch.globalTheme = DEFAULT_GLOBAL_THEME;
      }
      if (typeof stored.forceInvertText !== "boolean") {
        patch.forceInvertText = DEFAULT_SETTINGS.forceInvertText;
      }
      if (!Array.isArray(stored.whitelistDomains)) {
        patch.whitelistDomains = DEFAULT_SETTINGS.whitelistDomains;
      }
      if (!Array.isArray(stored.blacklistDomains)) {
        patch.blacklistDomains = DEFAULT_SETTINGS.blacklistDomains;
      }
      if (!stored.siteThemes || typeof stored.siteThemes !== "object") {
        patch.siteThemes = {};
      }
      if (!stored.sitePatches || typeof stored.sitePatches !== "object") {
        patch.sitePatches = {};
      }
      if (Object.keys(patch).length > 0) {
        await storageSet(patch);
      }
    } catch (error) {
      console.error("SmartTheme 初始化預設設定失敗：", error);
    }
  }

  /**
   * 寫入全域總開關。
   * @param {boolean} isEnabled
   * @returns {Promise<void>}
   */
  async function setEnabled(isEnabled) {
    try {
      await storageSet({ isEnabled: Boolean(isEnabled) });
    } catch (error) {
      console.error("SmartTheme 寫入開關失敗：", error);
      throw error;
    }
  }

  /**
   * 切換白名單 / 黑名單模式。
   * @param {'whitelist'|'blacklist'} mode
   * @returns {Promise<void>}
   */
  async function setMode(mode) {
    try {
      await storageSet({ mode: normalizeMode(mode) });
    } catch (error) {
      console.error("SmartTheme 寫入模式失敗：", error);
      throw error;
    }
  }

  /**
   * 寫入方案 C：強制反轉文字黑白。
   * @param {boolean} forceInvertText
   * @returns {Promise<void>}
   */
  async function setForceInvertText(forceInvertText) {
    try {
      await storageSet({ forceInvertText: Boolean(forceInvertText) });
    } catch (error) {
      console.error("SmartTheme 寫入文字反轉失敗：", error);
      throw error;
    }
  }

  /**
   * 寫入全域純色主題。
   * @param {object} theme
   * @returns {Promise<void>}
   */
  async function setGlobalTheme(theme) {
    try {
      await storageSet({ globalTheme: normalizeTheme(theme) });
    } catch (error) {
      console.error("SmartTheme 寫入全域主題失敗：", error);
      throw error;
    }
  }

  /**
   * 把 Picker 選到的選擇器寫入該網域動態補丁。
   * @param {string} hostname
   * @param {string} selector
   * @returns {Promise<{selector: string, domain: string}>}
   */
  async function addSitePatch(hostname, selector) {
    const domain = cleanDomain(hostname);
    const cleanSelector = sanitizeSelector(selector);
    if (!domain) {
      throw new Error("無效的主網域，拒絕寫入補丁。");
    }
    if (!cleanSelector) {
      throw new Error("無效的選擇器，已拒絕寫入。");
    }
    try {
      const settings = await getSettings();
      const sitePatches = upsertSitePatch(settings.sitePatches, domain, cleanSelector);
      await storageSet({ sitePatches });
      return { selector: cleanSelector, domain };
    } catch (error) {
      console.error("SmartTheme 寫入區塊補丁失敗：", error);
      throw error;
    }
  }

  /**
   * 以清洗後網域寫入網站獨立純色，超額時 LRU 淘汰。
   * @param {string} hostname
   * @param {object} theme
   * @returns {Promise<void>}
   */
  async function setSiteTheme(hostname, theme) {
    const domain = cleanDomain(hostname);
    if (!domain) {
      throw new Error("無效的主網域，拒絕寫入完整 URL。");
    }
    try {
      const settings = await getSettings();
      const siteThemes = upsertSiteThemeWithLru(settings.siteThemes, domain, theme);
      await storageSet({ siteThemes });
    } catch (error) {
      console.error("SmartTheme 寫入網站主題失敗：", error);
      throw error;
    }
  }

  /**
   * 移除指定網域的獨立主題。
   * @param {string} hostname
   * @returns {Promise<void>}
   */
  async function removeSiteTheme(hostname) {
    const domain = cleanDomain(hostname);
    if (!domain) {
      return;
    }
    try {
      const settings = await getSettings();
      if (!settings.siteThemes[domain]) {
        return;
      }
      const siteThemes = { ...settings.siteThemes };
      delete siteThemes[domain];
      await storageSet({ siteThemes });
    } catch (error) {
      console.error("SmartTheme 移除網站主題失敗：", error);
      throw error;
    }
  }

  /**
   * 把網域加入指定名單，並從另一份名單移除，避免互相打架。
   * @param {'whitelist'|'blacklist'} listName
   * @param {string} hostname
   * @returns {Promise<object>}
   */
  async function addDomainToList(listName, hostname) {
    const domain = cleanDomain(hostname);
    if (!domain) {
      throw new Error("無效的主網域。");
    }
    try {
      const settings = await getSettings();
      const whitelistDomains = settings.whitelistDomains.filter((item) => item !== domain);
      const blacklistDomains = settings.blacklistDomains.filter((item) => item !== domain);
      if (listName === "blacklist") {
        blacklistDomains.unshift(domain);
      } else {
        whitelistDomains.unshift(domain);
      }
      const patch = {
        whitelistDomains: normalizeDomainList(whitelistDomains),
        blacklistDomains: normalizeDomainList(blacklistDomains),
      };
      await storageSet(patch);
      return patch;
    } catch (error) {
      console.error("SmartTheme 加入名單失敗：", error);
      throw error;
    }
  }

  /**
   * 從指定名單移除網域。
   * @param {'whitelist'|'blacklist'} listName
   * @param {string} hostname
   * @returns {Promise<object>}
   */
  async function removeDomainFromList(listName, hostname) {
    const domain = cleanDomain(hostname);
    if (!domain) {
      return { whitelistDomains: [], blacklistDomains: [] };
    }
    try {
      const settings = await getSettings();
      const key = listName === "blacklist" ? "blacklistDomains" : "whitelistDomains";
      const nextList = settings[key].filter((item) => item !== domain);
      const patch = { [key]: nextList };
      await storageSet(patch);
      return patch;
    } catch (error) {
      console.error("SmartTheme 移除名單失敗：", error);
      throw error;
    }
  }

  /**
   * 批次覆寫白名單或黑名單（Options 頁使用）。
   * @param {'whitelist'|'blacklist'} listName
   * @param {string[]} domains
   * @returns {Promise<void>}
   */
  async function setDomainList(listName, domains) {
    try {
      const key = listName === "blacklist" ? "blacklistDomains" : "whitelistDomains";
      await storageSet({ [key]: normalizeDomainList(domains) });
    } catch (error) {
      console.error("SmartTheme 覆寫名單失敗：", error);
      throw error;
    }
  }

  /**
   * 依黑白名單判斷這個網域現在該不該套主題。
   * @param {object} settings
   * @param {string} hostname
   * @returns {boolean}
   */
  function shouldApplyTheme(settings, hostname) {
    if (!settings || !settings.isEnabled) {
      return false;
    }
    const matcher = root.SmartThemeMatcher;
    const match = matcher
      ? matcher.isDomainMatch.bind(matcher)
      : function fallbackMatch(host, list) {
        const cleanHost = cleanDomain(host);
        return (list || []).some((item) => cleanHost === item || cleanHost.endsWith("." + item));
      };
    if (settings.mode === "blacklist") {
      return !match(hostname, settings.blacklistDomains || []);
    }
    return match(hostname, settings.whitelistDomains || []);
  }

  /**
   * 解析最終純色：網站獨立主題優先，否則用全域主題。
   * @param {object} settings
   * @param {string} hostname
   * @returns {{type: 'solid', value: string}|null}
   */
  function resolveTheme(settings, hostname) {
    if (!shouldApplyTheme(settings, hostname)) {
      return null;
    }
    const domain = cleanDomain(hostname);
    const siteTheme = domain && settings.siteThemes ? settings.siteThemes[domain] : null;
    if (siteTheme) {
      return normalizeTheme(siteTheme);
    }
    return normalizeTheme(settings.globalTheme);
  }

  /**
   * 匯出可備份的 JSON 物件。
   * @returns {Promise<object>}
   */
  async function exportSettings() {
    const settings = await getSettings();
    return {
      version: "0.2.6",
      exportedAt: new Date().toISOString(),
      ...settings,
    };
  }

  /**
   * 從 JSON 匯入設定；格式錯誤時拋出，避免寫入半套資料。
   * @param {object} payload
   * @returns {Promise<object>}
   */
  async function importSettings(payload) {
    if (!payload || typeof payload !== "object") {
      throw new Error("匯入資料不是有效的 JSON 物件。");
    }
    try {
      const next = hydrateSettings(payload);
      await storageSet(next);
      return next;
    } catch (error) {
      console.error("SmartTheme 匯入設定失敗：", error);
      throw error;
    }
  }

  root.SmartThemeStorage = {
    MAX_SITE_THEMES,
    MAX_DOMAIN_LIST,
    MAX_PATCH_SELECTORS,
    MAX_PATCH_DOMAINS,
    DEFAULT_GLOBAL_THEME,
    DEFAULT_SETTINGS,
    getSettings,
    initializeDefaults,
    setEnabled,
    setMode,
    setForceInvertText,
    setGlobalTheme,
    addSitePatch,
    getSitePatchCss,
    sanitizeSelector,
    setSiteTheme,
    removeSiteTheme,
    addDomainToList,
    removeDomainFromList,
    setDomainList,
    shouldApplyTheme,
    resolveTheme,
    exportSettings,
    importSettings,
    cleanDomain,
    normalizeTheme,
    normalizeDomainList,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
