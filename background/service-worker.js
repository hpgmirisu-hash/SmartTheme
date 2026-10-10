/**
 * SmartTheme Service Worker
 * 負責安裝事件與 v0.2.6 預設 Schema 初始化。
 */
importScripts("../utils/url-matcher.js", "../utils/storage.js");

/**
 * 插件首次安裝或版本更新時，補齊 mode、forceInvertText 與黑白名單。
 */
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await SmartThemeStorage.initializeDefaults();
  } catch (error) {
    console.error("SmartTheme 安裝初始化失敗：", error);
  }
});

/**
 * Service Worker 被喚醒時再確認一次預設欄位。
 */
chrome.runtime.onStartup.addListener(async () => {
  try {
    await SmartThemeStorage.initializeDefaults();
  } catch (error) {
    console.error("SmartTheme 啟動初始化失敗：", error);
  }
});
