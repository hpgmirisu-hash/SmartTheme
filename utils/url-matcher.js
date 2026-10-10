/**
 * SmartTheme 網域清洗與比對工具
 * 統一去掉 protocol、www、路徑與埠號，避免名單比對失準。
 */
(function attachSmartThemeMatcher(root) {
  "use strict";

  /**
   * 把完整 URL 或 hostname 清洗成可比對的主網域。
   * @param {string} urlOrHostname
   * @returns {string}
   */
  function cleanDomain(urlOrHostname) {
    if (!urlOrHostname) {
      return "";
    }
    let hostname = String(urlOrHostname).trim().toLowerCase();
    if (!hostname) {
      return "";
    }
    try {
      if (hostname.includes("://")) {
        hostname = new URL(hostname).hostname;
      }
      return hostname.replace(/^www\./, "").split("/")[0].split(":")[0];
    } catch (error) {
      console.error("SmartTheme 網域清洗失敗：", error);
      return hostname.replace(/^www\./, "").split("/")[0].split(":")[0];
    }
  }

  /**
   * 判斷目前主機是否命中名單（支援子網域，例如 www / m / forum）。
   * @param {string} currentHost
   * @param {string[]} domainList
   * @returns {boolean}
   */
  function isDomainMatch(currentHost, domainList) {
    const cleanHost = cleanDomain(currentHost);
    if (!cleanHost || !Array.isArray(domainList)) {
      return false;
    }
    return domainList.some((domain) => {
      const cleanTarget = cleanDomain(domain);
      if (!cleanTarget) {
        return false;
      }
      return cleanHost === cleanTarget || cleanHost.endsWith("." + cleanTarget);
    });
  }

  root.SmartThemeMatcher = {
    cleanDomain,
    isDomainMatch,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
