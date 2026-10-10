/**
 * SmartTheme Options v0.2.6
 * 大頁面管理黑白名單，並提供 JSON 備份與匯入。
 */
(function smartThemeOptions() {
  "use strict";

  const els = {
    searchInput: document.getElementById("search-input"),
    status: document.getElementById("status"),
    whitelistForm: document.getElementById("whitelist-form"),
    whitelistInput: document.getElementById("whitelist-input"),
    whitelistList: document.getElementById("whitelist-list"),
    blacklistForm: document.getElementById("blacklist-form"),
    blacklistInput: document.getElementById("blacklist-input"),
    blacklistList: document.getElementById("blacklist-list"),
    exportJson: document.getElementById("export-json"),
    importJson: document.getElementById("import-json"),
  };

  let settings = SmartThemeStorage.DEFAULT_SETTINGS;

  /**
   * 顯示操作結果或錯誤訊息。
   * @param {string} message
   */
  function setStatus(message) {
    els.status.textContent = message;
  }

  /**
   * 依搜尋字串過濾並繪製單一名單。
   * @param {HTMLElement} container
   * @param {string[]} domains
   * @param {'whitelist'|'blacklist'} listName
   */
  function renderList(container, domains, listName) {
    const keyword = els.searchInput.value.trim().toLowerCase();
    const filtered = (domains || []).filter((domain) => domain.includes(keyword));
    container.innerHTML = "";
    if (filtered.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = keyword ? "沒有符合搜尋的網域" : "目前沒有網域";
      container.appendChild(empty);
      return;
    }
    filtered.forEach((domain) => {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = domain;
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "remove-btn";
      removeBtn.textContent = "移除";
      removeBtn.addEventListener("click", () => removeDomain(listName, domain));
      item.appendChild(label);
      item.appendChild(removeBtn);
      container.appendChild(item);
    });
  }

  /**
   * 重新繪製白名單與黑名單。
   */
  function renderAll() {
    renderList(els.whitelistList, settings.whitelistDomains, "whitelist");
    renderList(els.blacklistList, settings.blacklistDomains, "blacklist");
  }

  /**
   * 從 storage 重新載入設定。
   */
  async function reload() {
    try {
      settings = await SmartThemeStorage.getSettings();
      renderAll();
    } catch (error) {
      console.error("SmartTheme Options 讀取失敗：", error);
      setStatus("讀取設定失敗。");
    }
  }

  /**
   * 把輸入的 URL 或 hostname 加入指定名單。
   * @param {'whitelist'|'blacklist'} listName
   * @param {string} rawValue
   */
  async function addDomain(listName, rawValue) {
    const domain = SmartThemeMatcher.cleanDomain(rawValue);
    if (!domain) {
      setStatus("請輸入有效網域，不要留空。");
      return;
    }
    try {
      await SmartThemeStorage.addDomainToList(listName, domain);
      await reload();
      setStatus(`已加入 ${domain}`);
    } catch (error) {
      console.error("SmartTheme 加入網域失敗：", error);
      setStatus("加入失敗，請稍後再試。");
    }
  }

  /**
   * 從指定名單移除網域。
   * @param {'whitelist'|'blacklist'} listName
   * @param {string} domain
   */
  async function removeDomain(listName, domain) {
    try {
      await SmartThemeStorage.removeDomainFromList(listName, domain);
      await reload();
      setStatus(`已移除 ${domain}`);
    } catch (error) {
      console.error("SmartTheme 移除網域失敗：", error);
      setStatus("移除失敗，請稍後再試。");
    }
  }

  /**
   * 下載目前設定為 JSON 備份檔。
   */
  async function exportJson() {
    try {
      const payload = await SmartThemeStorage.exportSettings();
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `smarttheme-backup-${Date.now()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus("已匯出 JSON 備份。");
    } catch (error) {
      console.error("SmartTheme 匯出失敗：", error);
      setStatus("匯出失敗。");
    }
  }

  /**
   * 讀取使用者選的 JSON 並覆寫設定。
   * @param {File} file
   */
  async function importJsonFile(file) {
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      await SmartThemeStorage.importSettings(payload);
      await reload();
      setStatus("已匯入設定。");
    } catch (error) {
      console.error("SmartTheme 匯入失敗：", error);
      setStatus("JSON 格式無效，匯入已取消。");
    }
  }

  /**
   * 綁定搜尋、新增、匯入匯出事件。
   */
  function bindEvents() {
    els.searchInput.addEventListener("input", renderAll);

    els.whitelistForm.addEventListener("submit", (event) => {
      event.preventDefault();
      addDomain("whitelist", els.whitelistInput.value);
      els.whitelistInput.value = "";
    });

    els.blacklistForm.addEventListener("submit", (event) => {
      event.preventDefault();
      addDomain("blacklist", els.blacklistInput.value);
      els.blacklistInput.value = "";
    });

    els.exportJson.addEventListener("click", exportJson);
    els.importJson.addEventListener("change", (event) => {
      const file = event.target.files && event.target.files[0];
      importJsonFile(file);
      event.target.value = "";
    });
  }

  bindEvents();
  reload();
})();
