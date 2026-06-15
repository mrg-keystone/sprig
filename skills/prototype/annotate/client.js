/* ============================================================
 * prototype annotate — injected feedback overlay
 *
 * cmd/ctrl + click any element -> a small input box opens ->
 * type feedback, Save. The annotation is stored keyed by a
 * grep-able locator (a CSS-ish selector + the visible text),
 * with rich context in the value so /prototype can find the
 * element in source whether it's static markup or produced by
 * a render() function.
 *
 * This file is injected verbatim by serve.ts inside a <script>
 * tag, after a window.__ANNOTATE__ config object is defined.
 * It is self-contained: no imports, no build step.
 * ========================================================== */
(function () {
  "use strict";

  var CFG = window.__ANNOTATE__ || {};
  var API = "/__annotate";
  var UI_ATTR = "data-fbk-ui"; // marks our own DOM so we never annotate ourselves

  // xpath -> entry. Keyed by `key` field (the locator) on the server, but we
  // track locally by key too.
  var store = {}; // key -> entry
  var serverOK = true;
  var lsKey = "__annotate__" + (CFG.file || location.pathname);

  /* ---------- locator capture (the important part) ---------- */

  function collapse(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }
  function truncate(s, n) {
    s = collapse(s);
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function cssEsc(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, "\\$&");
  }

  function classListOf(el) {
    return (el.getAttribute("class") || "")
      .split(/\s+/)
      .filter(Boolean)
      .filter(function (c) {
        return c.indexOf("__fbk") !== 0; // never leak our own classes
      });
  }

  // A short, readable, NON-unique selector: tag#id.cls.cls (for labels only).
  function looseSelectorOf(el) {
    if (!el || el.nodeType !== 1) return "";
    var tag = el.tagName.toLowerCase();
    var sel = tag;
    if (el.id) sel += "#" + el.id;
    var cls = classListOf(el);
    if (!el.id && cls.length) sel += "." + cls.slice(0, 3).join(".");
    return sel;
  }

  // One step of a selector path: tag#id or tag.cls.cls (no positions yet).
  function stepSelector(el) {
    var tag = el.tagName.toLowerCase();
    if (el.id) return tag + "#" + cssEsc(el.id);
    var cls = classListOf(el);
    return cls.length ? tag + "." + cls.slice(0, 3).map(cssEsc).join(".") : tag;
  }

  function nthOfParent(el) {
    var i = 1, sib = el;
    while ((sib = sib.previousElementSibling)) i++;
    return i;
  }

  function isUnique(sel) {
    try {
      return document.querySelectorAll(sel).length === 1;
    } catch (_) {
      return false;
    }
  }

  // A GUARANTEED-UNIQUE CSS selector (DevTools "Copy selector" style): walk up
  // from the element, add :nth-child where siblings share a step, short-circuit
  // at a unique id or as soon as the accumulated path matches exactly one node.
  function uniqueSelectorOf(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id && isUnique("#" + cssEsc(el.id))) return "#" + cssEsc(el.id);
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      if (node.id && isUnique("#" + cssEsc(node.id))) {
        parts.unshift("#" + cssEsc(node.id));
        break;
      }
      var step = stepSelector(node);
      var parent = node.parentElement;
      if (parent) {
        var twins = Array.prototype.filter.call(parent.children, function (c) {
          return stepSelector(c) === step;
        });
        if (twins.length > 1) step += ":nth-child(" + nthOfParent(node) + ")";
      }
      parts.unshift(step);
      if (isUnique(parts.join(" > "))) return parts.join(" > ");
      node = parent;
    }
    return parts.join(" > ");
  }

  // Ancestor trail, e.g. "main#stage > section.panel > button.btn.primary".
  function trailOf(el) {
    var parts = [];
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && node !== document.documentElement && depth < 7) {
      if (node.getAttribute(UI_ATTR) == null) parts.unshift(looseSelectorOf(node));
      node = node.parentElement;
      depth++;
    }
    return parts.join(" > ");
  }

  // Absolute positional xpath — kept only as a last-resort hint.
  function xpathOf(el) {
    if (!el || el.nodeType !== 1) return "";
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node !== document) {
      var tag = node.nodeName.toLowerCase();
      var idx = 1;
      var sib = node.previousElementSibling;
      while (sib) {
        if (sib.nodeName.toLowerCase() === tag) idx++;
        sib = sib.previousElementSibling;
      }
      parts.unshift(tag + "[" + idx + "]");
      node = node.parentElement;
    }
    return "/" + parts.join("/");
  }

  // Everything we capture about a clicked element. The KEY is the unique
  // selector, so two same-looking elements (e.g. several div.num) never collide.
  function contextOf(el) {
    var uniq = uniqueSelectorOf(el);
    var loose = looseSelectorOf(el);
    var ctx = {
      selector: uniq, // unique, querySelector-resolvable
      label: loose, // short & readable, for display only
      id: el.id || "",
      classes: collapse(classListOf(el).join(" ")),
      tag: el.tagName.toLowerCase(),
      text: truncate(el.textContent, 140),
      html: truncate(el.outerHTML, 400),
      trail: trailOf(el),
      xpath: xpathOf(el),
    };
    ctx.key = uniq;
    return ctx;
  }

  /* ---------- persistence ---------- */

  function loadLocal() {
    try {
      var raw = localStorage.getItem(lsKey);
      if (raw) store = JSON.parse(raw) || {};
    } catch (_) {}
  }
  function saveLocal() {
    try {
      localStorage.setItem(lsKey, JSON.stringify(store));
    } catch (_) {}
  }

  function pullState() {
    return fetch(API + "/state", { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("bad");
        return r.json();
      })
      .then(function (json) {
        serverOK = true;
        store = json || {};
        saveLocal();
      })
      .catch(function () {
        serverOK = false;
        loadLocal();
      });
  }

  function pushEntry(entry) {
    if (!serverOK) {
      saveLocal();
      return Promise.resolve();
    }
    return fetch(API + "/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("bad");
        return r.json();
      })
      .then(function (json) {
        store = json || store;
        saveLocal();
      })
      .catch(function () {
        serverOK = false;
        saveLocal();
        renderToolbar();
      });
  }

  /* ---------- UI (isolated in a shadow root) ---------- */

  var host, root, popEl, barEl, layerEl, inspectBox, inspectLabel;

  function mountUI() {
    host = document.createElement("div");
    host.setAttribute(UI_ATTR, "");
    host.style.cssText = "all:initial;position:fixed;z-index:2147483647;top:0;left:0;";
    document.documentElement.appendChild(host);
    root = host.attachShadow({ mode: "open" });

    var style = document.createElement("style");
    style.textContent = CSS;
    root.appendChild(style);

    // overlay layer for element outlines/badges (pointer-events: none)
    layerEl = document.createElement("div");
    layerEl.className = "layer";
    root.appendChild(layerEl);

    // DevTools-style hover inspector (shown while ⌘/Ctrl is held)
    inspectBox = document.createElement("div");
    inspectBox.className = "inspect";
    root.appendChild(inspectBox);
    inspectLabel = document.createElement("div");
    inspectLabel.className = "inspect-lbl";
    inspectLabel.innerHTML = '<b></b><span></span>';
    root.appendChild(inspectLabel);

    barEl = document.createElement("div");
    barEl.className = "bar";
    root.appendChild(barEl);

    renderToolbar();
    renderBadges();
  }

  function entryCount() {
    return Object.keys(store).length;
  }

  function renderToolbar() {
    var n = entryCount();
    var offline = serverOK
      ? ""
      : '<span class="warn" title="No annotate server reachable — feedback is kept in this browser. Use Export to download the JSON.">offline</span>';
    barEl.innerHTML =
      '<button class="dot" data-act="toggle" title="Toggle annotate mode">●</button>' +
      '<span class="lbl">feedback <b>' + n + "</b></span>" +
      offline +
      '<button class="mini" data-act="list">list</button>' +
      '<button class="mini" data-act="export">export</button>' +
      (n ? '<button class="mini danger" data-act="clear">clear</button>' : "");
    barEl.classList.toggle("armed", armed);
    barEl.querySelector('[data-act="toggle"]').classList.toggle("on", armed);
  }

  function positionFor(el) {
    var r = el.getBoundingClientRect();
    return r;
  }

  function renderBadges() {
    if (!layerEl) return;
    layerEl.innerHTML = "";
    var keys = Object.keys(store);
    for (var i = 0; i < keys.length; i++) {
      var entry = store[keys[i]];
      var el = locate(entry);
      if (!el) continue;
      var r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      var box = document.createElement("div");
      box.className = "outline";
      box.style.cssText =
        "left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px;";
      var tag = document.createElement("div");
      tag.className = "badge";
      tag.textContent = i + 1;
      tag.style.cssText = "left:" + r.left + "px;top:" + r.top + "px;";
      layerEl.appendChild(box);
      layerEl.appendChild(tag);
    }
  }

  // Find the live element for an annotation (best-effort, for badge placement).
  function locate(entry) {
    if (entry.selector) {
      try {
        var bySel = document.querySelector(entry.selector);
        if (bySel) return bySel;
      } catch (_) {}
    }
    if (entry.xpath) {
      try {
        var byX = document.evaluate(
          entry.xpath,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null
        ).singleNodeValue;
        if (byX) return byX;
      } catch (_) {}
    }
    return null;
  }

  /* ---------- popover ---------- */

  function openPopover(el, ctx) {
    closePopover();
    var existing = store[ctx.key];
    popEl = document.createElement("div");
    popEl.className = "pop";
    popEl.innerHTML =
      '<div class="pop-h">' +
      '<span class="pop-sel"></span>' +
      '<button class="pop-x" data-act="cancel">×</button>' +
      "</div>" +
      '<div class="pop-tgt"></div>' +
      '<textarea class="pop-ta" rows="3" placeholder="What should change here?"></textarea>' +
      '<div class="pop-b">' +
      (existing ? '<button class="mini danger" data-act="delete">delete</button>' : "<span></span>") +
      '<div class="pop-rgt">' +
      '<button class="mini" data-act="cancel">cancel</button>' +
      '<button class="mini primary" data-act="save">save</button>' +
      "</div></div>";
    root.appendChild(popEl);

    var selEl = popEl.querySelector(".pop-sel");
    selEl.textContent = ctx.selector;
    selEl.title = ctx.selector; // full unique path on hover
    popEl.querySelector(".pop-tgt").textContent = ctx.text || "(no text)";
    var ta = popEl.querySelector(".pop-ta");
    ta.value = existing ? existing.feedback : "";

    // position near the element, clamped to viewport
    var r = positionFor(el);
    var pw = 280, ph = 150;
    var left = Math.min(Math.max(8, r.left), window.innerWidth - pw - 8);
    var top = r.bottom + 8;
    if (top + ph > window.innerHeight) top = Math.max(8, r.top - ph - 8);
    popEl.style.left = left + "px";
    popEl.style.top = top + "px";

    setTimeout(function () {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }, 0);

    function commit() {
      var text = ta.value.trim();
      var entry = Object.assign({}, ctx, { feedback: text });
      if (!text) {
        // empty save == delete
        delete store[ctx.key];
        pushEntry(Object.assign({}, ctx, { feedback: "", _delete: true })).then(after);
      } else {
        store[ctx.key] = entry;
        pushEntry(entry).then(after);
      }
    }
    function remove() {
      delete store[ctx.key];
      pushEntry(Object.assign({}, ctx, { feedback: "", _delete: true })).then(after);
    }
    function after() {
      closePopover();
      renderToolbar();
      renderBadges();
    }

    popEl.addEventListener("click", function (e) {
      var act = e.target.getAttribute("data-act");
      if (act === "save") commit();
      else if (act === "cancel") closePopover();
      else if (act === "delete") remove();
    });
    ta.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closePopover();
      }
    });
  }

  function closePopover() {
    if (popEl && popEl.parentNode) popEl.parentNode.removeChild(popEl);
    popEl = null;
  }

  /* ---------- export / clear ---------- */

  function exportJSON() {
    var blob = new Blob([JSON.stringify(store, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = (CFG.feedbackName || "feedback") + ".json";
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function clearAll() {
    store = {};
    saveLocal();
    if (serverOK) {
      fetch(API + "/clear", { method: "POST" }).catch(function () {});
    }
    renderToolbar();
    renderBadges();
    showList(false);
  }

  /* ---------- list panel ---------- */

  var listEl = null;
  function showList(on) {
    if (listEl) {
      listEl.remove();
      listEl = null;
    }
    if (!on) return;
    listEl = document.createElement("div");
    listEl.className = "list";
    var keys = Object.keys(store);
    var rows = keys
      .map(function (k, i) {
        var e = store[k];
        return (
          '<div class="row">' +
          '<span class="n">' + (i + 1) + "</span>" +
          '<div class="rc"><div class="rk"></div><div class="rf"></div></div>' +
          "</div>"
        );
      })
      .join("");
    listEl.innerHTML =
      '<div class="list-h">annotations <b>' + keys.length + "</b>" +
      '<button class="pop-x" data-act="closelist">×</button></div>' +
      (rows || '<div class="empty">cmd/ctrl+click an element to add feedback</div>');
    root.appendChild(listEl);
    // fill text safely
    var rowEls = listEl.querySelectorAll(".row");
    keys.forEach(function (k, i) {
      rowEls[i].querySelector(".rk").textContent = k;
      rowEls[i].querySelector(".rf").textContent = store[k].feedback;
    });
    listEl.addEventListener("click", function (e) {
      if (e.target.getAttribute("data-act") === "closelist") showList(false);
    });
  }

  /* ---------- DevTools-style hover inspector ---------- */

  var inspecting = false;
  var lastTarget = null;

  function showInspect(el) {
    if (popEl || !el || el.nodeType !== 1 || isOurs(el)) {
      hideInspect();
      return;
    }
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) {
      hideInspect();
      return;
    }
    inspectBox.style.cssText =
      "left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px;display:block";
    inspectLabel.querySelector("b").textContent = looseSelectorOf(el);
    inspectLabel.querySelector("span").textContent =
      " " + Math.round(r.width) + "×" + Math.round(r.height);
    // place the label just above the box; flip below if there's no room
    var lh = 24;
    var top = r.top - lh - 2;
    if (top < 2) top = Math.min(window.innerHeight - lh - 2, r.bottom + 2);
    var left = Math.max(2, Math.min(r.left, window.innerWidth - 240));
    inspectLabel.style.left = left + "px";
    inspectLabel.style.top = top + "px";
    inspectLabel.style.display = "block";
  }

  function hideInspect() {
    if (inspectBox) inspectBox.style.display = "none";
    if (inspectLabel) inspectLabel.style.display = "none";
  }

  function startInspect() {
    inspecting = true;
    if (lastTarget) showInspect(lastTarget);
  }

  function stopInspect() {
    inspecting = false;
    hideInspect();
  }

  /* ---------- events ---------- */

  var armed = true; // cmd/ctrl+click always works; this also enables plain-click capture when on

  function isOurs(el) {
    return el && (el === host || (el.closest && el.getRootNode && el.getRootNode() === root));
  }

  document.addEventListener(
    "mousemove",
    function (e) {
      lastTarget = e.target;
      if (inspecting) showInspect(e.target);
    },
    true
  );

  document.addEventListener(
    "keydown",
    function (e) {
      if ((e.key === "Meta" || e.key === "Control") && !inspecting) startInspect();
    },
    true
  );
  document.addEventListener(
    "keyup",
    function (e) {
      if (e.key === "Meta" || e.key === "Control") stopInspect();
    },
    true
  );
  window.addEventListener("blur", stopInspect);

  document.addEventListener(
    "click",
    function (e) {
      if (!(e.metaKey || e.ctrlKey)) return;
      var t = e.target;
      if (isOurs(t)) return;
      e.preventDefault();
      e.stopPropagation();
      hideInspect();
      var ctx = contextOf(t);
      openPopover(t, ctx);
    },
    true
  );

  // toolbar / list actions
  document.addEventListener("DOMContentLoaded", function () {});

  function onBarClick(e) {
    var act = e.target.getAttribute("data-act");
    if (!act) return;
    if (act === "toggle") {
      armed = !armed;
      renderToolbar();
    } else if (act === "export") exportJSON();
    else if (act === "clear") {
      if (confirm("Clear all feedback?")) clearAll();
    } else if (act === "list") showList(!listEl);
  }

  var reflow;
  function scheduleReflow() {
    if (reflow) return;
    reflow = requestAnimationFrame(function () {
      reflow = null;
      renderBadges();
    });
  }

  /* ---------- styles ---------- */

  var CSS =
    ".layer{position:fixed;inset:0;pointer-events:none}" +
    ".inspect{position:fixed;display:none;pointer-events:none;background:rgba(194,65,12,.12);border:1px solid rgba(194,65,12,.55);box-shadow:0 0 0 1px rgba(194,65,12,.2)}" +
    ".inspect-lbl{position:fixed;display:none;pointer-events:none;background:#17150f;color:#f3eee2;font:600 11px/1 ui-monospace,Menlo,monospace;padding:5px 7px;border-radius:5px;white-space:nowrap;box-shadow:0 4px 14px -4px rgba(0,0,0,.5)}" +
    ".inspect-lbl b{color:#fb923c;font-weight:700}" +
    ".inspect-lbl span{color:#9b927c;font-weight:500}" +
    ".outline{position:fixed;border:2px solid #c2410c;border-radius:4px;box-shadow:0 0 0 2px rgba(194,65,12,.18);pointer-events:none}" +
    ".badge{position:fixed;transform:translate(-60%,-60%);min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#c2410c;color:#fff;font:600 10px/16px ui-monospace,Menlo,monospace;text-align:center;pointer-events:none}" +
    ".bar{position:fixed;right:16px;bottom:16px;display:flex;align-items:center;gap:8px;padding:6px 8px;background:#17150f;color:#f3eee2;border-radius:10px;box-shadow:0 8px 30px -8px rgba(0,0,0,.5);font:500 12px/1 ui-monospace,Menlo,monospace;pointer-events:auto}" +
    ".bar .lbl{opacity:.85}.bar .lbl b{color:#fb923c}" +
    ".bar .dot{all:unset;cursor:pointer;color:#6b6453;font-size:11px}" +
    ".bar .dot.on{color:#fb923c}" +
    ".bar .warn{color:#fbbf24;font-size:11px;cursor:help}" +
    ".mini{all:unset;cursor:pointer;padding:4px 8px;border-radius:6px;background:#2a2620;color:#f3eee2;font:500 11px/1 ui-monospace,Menlo,monospace}" +
    ".mini:hover{background:#3a342a}" +
    ".mini.primary{background:#c2410c}.mini.primary:hover{background:#9a3412}" +
    ".mini.danger{background:#3a2420;color:#fca5a5}.mini.danger:hover{background:#4a2a24}" +
    ".pop{position:fixed;width:280px;background:#fffdf8;color:#17150f;border:1px solid #d6ccb4;border-radius:10px;box-shadow:0 16px 50px -12px rgba(23,21,15,.4);padding:10px;pointer-events:auto;font:400 12px/1.4 ui-monospace,Menlo,monospace}" +
    ".pop-h{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}" +
    ".pop-sel{color:#c2410c;font-weight:600;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".pop-x{all:unset;cursor:pointer;color:#9b927c;font-size:16px;line-height:1;padding:0 2px}" +
    ".pop-tgt{color:#6b6453;font-size:11px;max-height:34px;overflow:hidden;margin-bottom:6px;padding:4px 6px;background:#faf6ec;border-radius:6px}" +
    ".pop-ta{width:100%;box-sizing:border-box;resize:vertical;border:1px solid #d6ccb4;border-radius:6px;padding:6px;font:inherit;background:#fff;color:#17150f}" +
    ".pop-ta:focus{outline:2px solid #f7e7dd;border-color:#c2410c}" +
    ".pop-b{display:flex;align-items:center;justify-content:space-between;margin-top:8px}" +
    ".pop-rgt{display:flex;gap:6px}" +
    ".pop .mini{background:#ece5d4;color:#17150f}.pop .mini:hover{background:#e4ddcc}" +
    ".pop .mini.primary{background:#c2410c;color:#fff}" +
    ".pop .mini.danger{background:#fdeceb;color:#b91c1c}" +
    ".list{position:fixed;right:16px;bottom:64px;width:340px;max-height:50vh;overflow:auto;background:#17150f;color:#f3eee2;border-radius:10px;box-shadow:0 16px 50px -12px rgba(0,0,0,.5);padding:8px;pointer-events:auto;font:400 11px/1.4 ui-monospace,Menlo,monospace}" +
    ".list-h{display:flex;align-items:center;gap:6px;justify-content:space-between;padding:4px 4px 8px;border-bottom:1px solid #2a2620;margin-bottom:6px}" +
    ".list-h b{color:#fb923c}" +
    ".list .row{display:flex;gap:8px;padding:6px 4px;border-bottom:1px solid #221f18}" +
    ".list .n{color:#fb923c;font-weight:700;min-width:16px}" +
    ".list .rk{color:#9b927c;word-break:break-all}" +
    ".list .rf{color:#f3eee2;margin-top:2px}" +
    ".list .empty{padding:12px 6px;color:#9b927c}";

  /* ---------- boot ---------- */

  function boot() {
    mountUI();
    barEl.addEventListener("click", onBarClick);
    window.addEventListener("scroll", scheduleReflow, true);
    window.addEventListener("resize", scheduleReflow, true);
    pullState().then(function () {
      renderToolbar();
      renderBadges();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
