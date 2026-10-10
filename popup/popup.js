/**
 * SmartTheme Popup v0.2.6
 * 純色主題、黑白名單快捷切換、當前網站開關與方案 C 反轉。
 */
(function smartThemePopup() {
  "use strict";

  const PRESET_THEMES = [
    { id: "eye-green", name: "護眼綠", type: "solid", value: "#CCE8CF" },
    { id: "light-blue", name: "淡藍色", type: "solid", value: "#7EC8E3" },
    { id: "dark", name: "暗黑模式", type: "solid", value: "#1E293B" },
    { id: "parchment", name: "羊皮紙黃", type: "solid", value: "#F5E6C8" },
  ];

  const els = {
    app: document.querySelector(".app"),
    enableToggle: document.getElementById("enable-toggle"),
    modeWhitelist: document.getElementById("mode-whitelist"),
    modeBlacklist: document.getElementById("mode-blacklist"),
    modeHint: document.getElementById("mode-hint"),
    currentDomain: document.getElementById("current-domain"),
    siteToggle: document.getElementById("site-toggle"),
    siteToggleLabel: document.getElementById("site-toggle-label"),
    invertToggle: document.getElementById("invert-toggle"),
    presetGrid: document.getElementById("preset-grid"),
    customToggle: document.getElementById("custom-toggle"),
    customPanel: document.getElementById("custom-panel"),
    colorPicker: document.getElementById("color-picker"),
    hexInput: document.getElementById("hex-input"),
    applySolid: document.getElementById("apply-solid"),
    elementPickerBtn: document.getElementById("element-picker-btn"),
    openOptions: document.getElementById("open-options"),
    status: document.getElementById("status"),
  };

  let currentHostname = "";
  let settings = SmartThemeStorage.DEFAULT_SETTINGS;

  /**
   * 在狀態列顯示操作結果。
   * @param {string} message
   */
  function setStatus(message) {
    els.status.textContent = message;
  }

  /**
   * 收納式純色面板，節省垂直空間。
   */
  function bindDisclosure() {
    els.customToggle.addEventListener("click", () => {
      const expanded = els.customToggle.getAttribute("aria-expanded") === "true";
      els.customToggle.setAttribute("aria-expanded", String(!expanded));
      els.customPanel.hidden = expanded;
    });
  }

  /**
   * 讀取當前分頁並清洗成主網域。
   * @returns {Promise<string>}
   */
  async function loadCurrentHostname() {
    try {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const tab = tabs[0];
      if (!tab || !tab.url) {
        return "";
      }
      return SmartThemeMatcher.cleanDomain(tab.url);
    } catch (error) {
      console.error("SmartTheme 讀取分頁網域失敗：", error);
      return "";
    }
  }

  /**
   * 正規化使用者輸入的 Hex。
   * @param {string} value
   * @returns {string}
   */
  function normalizeHex(value) {
    const raw = String(value || "").trim();
    if (/^#[0-9a-fA-F]{6}$/.test(raw)) {
      return raw.toUpperCase();
    }
    if (/^[0-9a-fA-F]{6}$/.test(raw)) {
      return `#${raw.toUpperCase()}`;
    }
    return "";
  }

  /**
   * 判斷目前網站是否已在作用中的名單內。
   * @returns {boolean}
   */
  function isCurrentSiteListed() {
    if (!currentHostname) {
      return false;
    }
    const list = settings.mode === "blacklist"
      ? settings.blacklistDomains
      : settings.whitelistDomains;
    return SmartThemeMatcher.isDomainMatch(currentHostname, list);
  }

  /**
   * 寫入全域純色；已開啟分頁會經 storage.onChanged 即時更新。
   * @param {{type: string, value: string}} theme
   */
  async function saveTheme(theme) {
    try {
      await SmartThemeStorage.setGlobalTheme(theme);
      settings = await SmartThemeStorage.getSettings();
      renderSelection();
      setStatus("已套用純色主題");
    } catch (error) {
      console.error("SmartTheme 儲存主題失敗：", error);
      setStatus("儲存失敗，請稍後再試。");
    }
  }

  /**
   * 渲染四個預設護眼色。
   */
  function renderPresets() {
    els.presetGrid.innerHTML = "";
    PRESET_THEMES.forEach((preset) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "preset-btn";
      button.dataset.value = preset.value;
      button.textContent = preset.name;
      button.style.background = preset.value;
      button.style.color = preset.value === "#1E293B" ? "#F8FAFC" : "#0F172A";
      button.addEventListener("click", () => saveTheme(preset));
      els.presetGrid.appendChild(button);
    });
  }

  /**
   * 同步模式按鈕、提示文字與當前網站開關標籤。
   */
  function renderModeAndSite() {
    const isBlacklist = settings.mode === "blacklist";
    els.modeWhitelist.classList.toggle("is-active", !isBlacklist);
    els.modeBlacklist.classList.toggle("is-active", isBlacklist);
    els.modeHint.textContent = isBlacklist
      ? "對全部網站套用，黑名單除外。"
      : "只對白名單網站套用主題。";
    els.siteToggleLabel.textContent = isBlacklist
      ? "加入黑名單（不套用）"
      : "加入白名單（套用主題）";
    els.siteToggle.checked = isCurrentSiteListed();
    els.siteToggle.disabled = !currentHostname;
  }

  /**
   * 標示目前選中的純色並同步 Color Picker。
   */
  function renderSelection() {
    const active = SmartThemeStorage.normalizeTheme(settings.globalTheme);
    document.querySelectorAll(".preset-btn").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.value === active.value);
    });
    const hex = normalizeHex(active.value);
    if (hex) {
      els.colorPicker.value = hex;
      els.hexInput.value = hex;
    }
  }

  /**
   * 同步總開關與方案 C。
   */
  function renderToggles() {
    els.enableToggle.checked = settings.isEnabled;
    els.invertToggle.checked = settings.forceInvertText;
    els.app.classList.toggle("is-disabled", !settings.isEnabled);
  }

  /**
   * 綁定模式、名單、反轉與自訂色事件。
   */
  function bindEvents() {
    bindDisclosure();

    els.enableToggle.addEventListener("change", async () => {
      try {
        await SmartThemeStorage.setEnabled(els.enableToggle.checked);
        settings = await SmartThemeStorage.getSettings();
        renderToggles();
        setStatus(settings.isEnabled ? "插件已啟用" : "插件已關閉");
      } catch (error) {
        console.error("SmartTheme 切換開關失敗：", error);
        setStatus("無法更新開關。");
      }
    });

    els.modeWhitelist.addEventListener("click", () => changeMode("whitelist"));
    els.modeBlacklist.addEventListener("click", () => changeMode("blacklist"));

    els.siteToggle.addEventListener("change", async () => {
      if (!currentHostname) {
        els.siteToggle.checked = false;
        setStatus("這個分頁沒有可用的主網域。");
        return;
      }
      const listName = settings.mode === "blacklist" ? "blacklist" : "whitelist";
      try {
        if (els.siteToggle.checked) {
          await SmartThemeStorage.addDomainToList(listName, currentHostname);
          setStatus(`已加入${listName === "blacklist" ? "黑" : "白"}名單：${currentHostname}`);
        } else {
          await SmartThemeStorage.removeDomainFromList(listName, currentHostname);
          setStatus(`已移出${listName === "blacklist" ? "黑" : "白"}名單`);
        }
        settings = await SmartThemeStorage.getSettings();
        renderModeAndSite();
      } catch (error) {
        console.error("SmartTheme 更新當前網站名單失敗：", error);
        setStatus("無法更新當前網站。");
      }
    });

    els.invertToggle.addEventListener("change", async () => {
      try {
        await SmartThemeStorage.setForceInvertText(els.invertToggle.checked);
        settings = await SmartThemeStorage.getSettings();
        setStatus(settings.forceInvertText ? "已開啟文字反轉" : "已關閉文字反轉");
      } catch (error) {
        console.error("SmartTheme 切換文字反轉失敗：", error);
        setStatus("無法更新文字反轉。");
      }
    });

    els.colorPicker.addEventListener("input", () => {
      els.hexInput.value = els.colorPicker.value.toUpperCase();
    });

    els.hexInput.addEventListener("change", () => {
      const hex = normalizeHex(els.hexInput.value);
      if (!hex) {
        setStatus("請輸入有效的 Hex，例如 #CCE8CF");
        return;
      }
      els.hexInput.value = hex;
      els.colorPicker.value = hex;
    });

    els.applySolid.addEventListener("click", () => {
      const hex = normalizeHex(els.hexInput.value) || els.colorPicker.value;
      saveTheme({ type: "solid", value: hex });
    });

    els.elementPickerBtn.addEventListener("click", startElementPicker);

    els.openOptions.addEventListener("click", () => {
      try {
        chrome.runtime.openOptionsPage();
      } catch (error) {
        console.error("SmartTheme 開啟選項頁失敗：", error);
        setStatus("無法開啟管理頁面。");
      }
    });
  }

  /**
   * 通知當前分頁進入 Element Picker，並關閉 Popup 以免擋住點選。
   */
  async function startElementPicker() {
    try {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const tab = tabs[0];
      if (!tab || tab.id === undefined) {
        setStatus("找不到當前分頁。");
        return;
      }
      await chrome.tabs.sendMessage(tab.id, { type: "SMART_THEME_START_PICKER" });
      window.close();
    } catch (error) {
      console.error("SmartTheme 啟動 Picker 失敗：", error);
      setStatus("無法在這個頁面啟動選擇器，請改開一般網站。");
    }
  }

  /**
   * 切換白名單或黑名單模式。
   * @param {'whitelist'|'blacklist'} mode
   */
  async function changeMode(mode) {
    try {
      await SmartThemeStorage.setMode(mode);
      settings = await SmartThemeStorage.getSettings();
      renderModeAndSite();
      setStatus(mode === "blacklist" ? "已切換為黑名單模式" : "已切換為白名單模式");
    } catch (error) {
      console.error("SmartTheme 切換模式失敗：", error);
      setStatus("無法切換模式。");
    }
  }

  /**
   * Popup 開啟時載入網域與設定。
   */
  async function init() {
    renderPresets();
    bindEvents();
    currentHostname = await loadCurrentHostname();
    els.currentDomain.textContent = currentHostname || "（非一般網頁）";
    try {
      settings = await SmartThemeStorage.getSettings();
    } catch (error) {
      console.error("SmartTheme Popup 讀取設定失敗：", error);
      settings = { ...SmartThemeStorage.DEFAULT_SETTINGS };
    }
    renderToggles();
    renderModeAndSite();
    renderSelection();
  }

  init();
})();
