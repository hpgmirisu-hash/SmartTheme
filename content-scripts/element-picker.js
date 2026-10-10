/**
 * SmartTheme Element Picker v0.2.6
 * 視覺化點選區塊，寫入該網域動態補丁；點擊時攔截超連結跳轉。
 */
(function smartThemeElementPicker() {
  "use strict";

  const HOVER_CLASS = "smart-theme-picker-hover";
  const PICKING_CLASS = "smart-theme-picking";
  const PICKER_STYLE_ID = "smart-theme-picker-style";
  const PICKER_CSS = `
    html.${PICKING_CLASS},
    html.${PICKING_CLASS} * {
      cursor: crosshair !important;
    }
    .${HOVER_CLASS} {
      outline: 2px solid #3b82f6 !important;
      outline-offset: 2px !important;
    }
  `;

  let picking = false;
  let hovered = null;
  let swallowClicks = false;
  let swallowTimer = 0;

  /**
   * 確保 Picker 專用樣式存在，避免寫進主題 style 後被整段覆蓋。
   */
  function ensurePickerStyle() {
    if (document.getElementById(PICKER_STYLE_ID)) {
      return;
    }
    const style = document.createElement("style");
    style.id = PICKER_STYLE_ID;
    style.textContent = PICKER_CSS;
    const target = document.documentElement || document.head;
    if (target) {
      target.appendChild(style);
    }
  }

  /**
   * 從 DOM 元素抽出特徵選擇器：優先 ID，其次語意 class，最後 tag:nth-of-type。
   * @param {Element} element
   * @returns {string}
   */
  function getFeatureSelector(element) {
    if (!element || element.nodeType !== 1) {
      return "";
    }
    if (element.id && /^[A-Za-z][\w-]*$/.test(element.id)) {
      return `#${element.id}`;
    }
    const classes = Array.from(element.classList || []).filter((name) => {
      if (!name || name.startsWith("smart-theme")) {
        return false;
      }
      if (name.length > 36) {
        return false;
      }
      return /^[A-Za-z_][\w-]*$/.test(name);
    });
    const preferred = classes.find((name) => {
      return /(menu|header|nav|main|content|sidebar|footer|container|wrapper|toolbar)/i.test(name);
    }) || classes[0];
    if (preferred) {
      return `.${preferred}`;
    }
    const tag = String(element.tagName || "").toLowerCase();
    if (!tag || tag === "html" || tag === "body") {
      return tag;
    }
    const parent = element.parentElement;
    if (!parent) {
      return tag;
    }
    const sameTag = Array.from(parent.children).filter((node) => node.tagName === element.tagName);
    if (sameTag.length > 1) {
      return `${tag}:nth-of-type(${sameTag.indexOf(element) + 1})`;
    }
    return tag;
  }

  /**
   * 略過 svg 內部節點與 html，改選較有意義的外層元素。
   * @param {EventTarget|null} target
   * @returns {Element|null}
   */
  function resolvePickTarget(target) {
    if (!(target instanceof Element)) {
      return null;
    }
    const fromSvg = target.closest ? target.closest("svg") : null;
    const element = fromSvg && fromSvg.parentElement ? fromSvg.parentElement : target;
    if (element.id === PICKER_STYLE_ID || element.id === "smart-theme-style") {
      return null;
    }
    return element;
  }

  /**
   * 更新懸停高亮外框。
   * @param {Element|null} next
   */
  function setHovered(next) {
    if (hovered && hovered !== next) {
      hovered.classList.remove(HOVER_CLASS);
    }
    hovered = next;
    if (hovered) {
      hovered.classList.add(HOVER_CLASS);
    }
  }

  /**
   * 攔截網頁原本的點擊／導覽，避免選取時跟著跳轉。
   * @param {Event} event
   */
  function suppressNativeAction(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  /**
   * @param {MouseEvent} event
   */
  function onMouseOver(event) {
    if (!picking) {
      return;
    }
    const element = resolvePickTarget(event.target);
    if (!element) {
      return;
    }
    setHovered(element);
  }

  /**
   * @param {KeyboardEvent} event
   */
  function onKeyDown(event) {
    if (!picking) {
      return;
    }
    if (event.key === "Escape" || event.key === "Esc") {
      suppressNativeAction(event);
      stopPicker();
    }
  }

  /**
   * 選取結束後短暫吞掉後續 click，避免超連結仍被觸發。
   */
  function armClickSwallow() {
    swallowClicks = true;
    if (swallowTimer) {
      clearTimeout(swallowTimer);
    }
    swallowTimer = setTimeout(() => {
      swallowClicks = false;
      swallowTimer = 0;
    }, 400);
  }

  /**
   * @param {Event} event
   */
  function onClickCapture(event) {
    if (picking || swallowClicks) {
      suppressNativeAction(event);
    }
  }

  /**
   * 在 pointerdown 完成選取，避免 click 與 pointerdown 各寫入一次。
   * @param {Event} event
   */
  function onPick(event) {
    if (!picking) {
      if (swallowClicks) {
        suppressNativeAction(event);
      }
      return;
    }
    suppressNativeAction(event);
    const element = resolvePickTarget(event.target) || hovered;
    if (!element) {
      return;
    }
    const rawSelector = getFeatureSelector(element);
    const selector = SmartThemeStorage.sanitizeSelector(rawSelector);
    if (!selector) {
      stopPicker();
      return;
    }
    SmartThemeStorage.addSitePatch(window.location.hostname, selector)
      .catch((error) => {
        console.error("SmartTheme Picker 寫入失敗：", error);
      })
      .finally(() => {
        armClickSwallow();
        stopPicker();
      });
  }

  /**
   * 進入 Picker 模式並綁定捕捉階段事件。
   */
  function startPicker() {
    ensurePickerStyle();
    if (picking) {
      return;
    }
    picking = true;
    if (document.documentElement) {
      document.documentElement.classList.add(PICKING_CLASS);
    }
    document.addEventListener("mouseover", onMouseOver, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPick, true);
  }

  /**
   * 離開 Picker 模式並還原游標與外框。
   */
  function stopPicker() {
    picking = false;
    setHovered(null);
    if (document.documentElement) {
      document.documentElement.classList.remove(PICKING_CLASS);
    }
    document.removeEventListener("mouseover", onMouseOver, true);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("pointerdown", onPick, true);
  }

  /**
   * 接收 Popup 的進入／離開指令。
   */
  function listenPopupMessages() {
    try {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        try {
          const type = message && message.type;
          if (type === "SMART_THEME_START_PICKER") {
            startPicker();
            sendResponse({ ok: true, picking: true });
            return false;
          }
          if (type === "SMART_THEME_STOP_PICKER") {
            stopPicker();
            sendResponse({ ok: true, picking: false });
            return false;
          }
        } catch (error) {
          console.error("SmartTheme Picker 處理訊息失敗：", error);
          sendResponse({ ok: false });
        }
        return false;
      });
    } catch (error) {
      console.error("SmartTheme Picker 註冊訊息失敗：", error);
    }
  }

  document.addEventListener("click", onClickCapture, true);
  document.addEventListener("auxclick", onClickCapture, true);
  listenPopupMessages();
})();
