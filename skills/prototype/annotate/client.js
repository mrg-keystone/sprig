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

  // the element the open popover currently targets (tree + css modal act on it)
  var currentEl = null, currentCtx = null;
  // tree picker + css modal + freehand-draw state (created on demand)
  var treeEl = null, treeNodes = null;
  var cssEl = null, cssView = null, cssTextarea = null, cssTarget = null, cssOrigStyle = null;
  var drawCanvas = null, drawCtx = null, drawpopEl = null, drawing = false, drawStrokes = null, drawId = 0;

  function mountUI() {
    host = document.createElement("div");
    host.setAttribute(UI_ATTR, "");
    host.style.cssText = "all:initial;position:fixed;z-index:2147483647;top:0;left:0;";
    document.documentElement.appendChild(host);
    root = host.attachShadow({ mode: "open" });

    // Keep keystrokes typed in the overlay from reaching the prototype's own
    // hotkeys. Key events are composed, so without this they'd bubble out of the
    // shadow root to the page's document/window listeners. We stop them at the
    // shadow-root boundary (bubble phase) — after our own inputs (textarea, the
    // CodeMirror editor) and our document-level capture handlers have already
    // seen them, but before the prototype does.
    ["keydown", "keyup", "keypress"].forEach(function (type) {
      root.addEventListener(type, function (e) { e.stopPropagation(); });
    });

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
    if (drawing) {
      barEl.innerHTML =
        '<span class="lbl drawing">✎ drawing — release ⇧⌘ to add a note</span>';
      barEl.classList.add("armed");
      return;
    }
    var offline = serverOK
      ? ""
      : '<span class="warn" title="No annotate server reachable — feedback is kept in this browser. Use Export to download the JSON.">offline</span>';
    barEl.innerHTML =
      '<button class="dot" data-act="toggle" title="⌘/Ctrl+click an element to annotate · ⇧⌘ drag to draw">●</button>' +
      '<span class="lbl" title="⌘/Ctrl+click an element · in the box: tree / css · ⇧⌘ drag to draw a screenshot note">feedback <b>' + n + "</b></span>" +
      offline +
      '<button class="mini" data-act="list">list</button>' +
      '<button class="mini" data-act="export">export</button>' +
      (n ? '<button class="mini danger" data-act="clear">clear</button>' : "");
    barEl.classList.toggle("armed", armed);
    var dot = barEl.querySelector('[data-act="toggle"]');
    if (dot) dot.classList.toggle("on", armed);
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
      if (!el || !el.isConnected) continue;
      // skip elements hidden by the current "screen" so old badges don't linger
      var cs = window.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
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

  // Open (or re-open) the feedback box for `el`. `seedText` carries an in-progress
  // note across a re-target so a stray click on the wrong child isn't lost.
  function openPopover(el, ctx, seedText) {
    closePopover(); // remove only the old box — keep any open tree/css modal
    currentEl = el;
    currentCtx = ctx;
    var existing = store[ctx.key];
    if (existing && existing.css && ctx.css == null) ctx.css = existing.css;
    popEl = document.createElement("div");
    popEl.className = "pop";
    popEl.innerHTML =
      '<div class="pop-h">' +
      '<span class="pop-sel"></span>' +
      '<button class="pop-x" data-act="cancel">×</button>' +
      "</div>" +
      '<div class="pop-tgt"></div>' +
      '<div class="pop-acts">' +
      '<button class="chip" data-act="tree" title="Pick any element from the HTML tree">⌗ tree</button>' +
      '<button class="chip" data-act="css" title="Edit this element\'s CSS live, save as feedback">{ } css</button>' +
      "</div>" +
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
    ta.value = seedText != null ? seedText : (existing ? existing.feedback : "");
    updateCssDot();

    // position near the element, clamped to viewport
    var r = positionFor(el);
    var pw = 280, ph = 178;
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
      var css = ctx.css ? String(ctx.css).trim() : "";
      if (!text && !css) {
        // nothing to save == delete
        delete store[ctx.key];
        pushEntry(Object.assign({}, ctx, { feedback: "", css: "", _delete: true })).then(after);
      } else {
        var entry = Object.assign({}, ctx, { feedback: text, css: css });
        store[ctx.key] = entry;
        pushEntry(entry).then(after);
      }
    }
    function remove() {
      delete store[ctx.key];
      pushEntry(Object.assign({}, ctx, { feedback: "", _delete: true })).then(after);
    }
    function after() {
      dismissAll();
      renderToolbar();
      renderBadges();
    }

    popEl.addEventListener("click", function (e) {
      var act = e.target.getAttribute("data-act");
      if (act === "save") commit();
      else if (act === "cancel") dismissAll();
      else if (act === "delete") remove();
      else if (act === "tree") openTree();
      else if (act === "css") openCssModal();
    });
    ta.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        dismissAll();
      }
    });
  }

  // Re-point the open popover at a different element (from the tree), keeping the
  // note the user already typed and refreshing the tree's highlight.
  function retarget(el) {
    if (!el || el.nodeType !== 1 || isOurs(el)) return;
    var seed = popEl ? popEl.querySelector(".pop-ta").value : "";
    openPopover(el, contextOf(el), seed);
    updateTreeSelection(el);
  }

  // Mark the css chip when this target has CSS edits attached.
  function updateCssDot() {
    if (!popEl) return;
    var chip = popEl.querySelector('[data-act="css"]');
    if (chip) chip.classList.toggle("has", !!(currentCtx && currentCtx.css && String(currentCtx.css).trim()));
  }

  function closePopover() {
    if (popEl && popEl.parentNode) popEl.parentNode.removeChild(popEl);
    popEl = null;
  }

  // Tear down the whole element-feedback surface (box + tree + css modal).
  function dismissAll() {
    closeCssModal();
    closeTree();
    closePopover();
    currentEl = null;
    currentCtx = null;
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
      var e = store[k];
      var hasCss = e.css && String(e.css).trim();
      if (e.kind === "drawing") {
        rowEls[i].querySelector(".rk").textContent = "✎ drawing" + (e.image ? " · " + e.image : "");
      } else {
        rowEls[i].querySelector(".rk").textContent = k + (hasCss ? "   { } css" : "");
      }
      var fb = e.feedback || "";
      if (hasCss) fb = (fb ? fb + "  —  " : "") + collapse(e.css).replace(/\n/g, " ");
      rowEls[i].querySelector(".rf").textContent = fb || "(no note)";
    });
    listEl.addEventListener("click", function (e) {
      if (e.target.getAttribute("data-act") === "closelist") showList(false);
    });
  }

  /* ---------- DevTools-style hover inspector ---------- */

  var inspecting = false;
  var lastTarget = null;

  // The page-hover inspector (driven by ⌘/Ctrl on mousemove): suppressed while a
  // popover/modal/draw is active so it doesn't fight with them.
  function showInspect(el) {
    if (popEl || cssEl || drawing) {
      hideInspect();
      return;
    }
    drawInspect(el);
  }

  // Draw the outline + size label for an element. No suppression guard — the tree
  // picker calls this to highlight nodes even while the popover is open.
  function drawInspect(el) {
    if (!el || el.nodeType !== 1 || isOurs(el)) {
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
      if (e.key === "Escape") {
        if (cssEl) { revertLive(); closeCssModal(); return; }
        if (drawpopEl || drawing) { clearDraw(); return; }
        if (treeEl) { closeTree(); return; }
      }
      // keys typed inside our boxes must not arm draw/inspect (Escape above still closes)
      if (isOurs(e.target)) return;
      // ⇧⌘ / ⇧Ctrl → freehand draw mode; plain ⌘/Ctrl → hover inspector
      if ((e.metaKey || e.ctrlKey) && e.shiftKey) { enterDraw(); return; }
      if ((e.key === "Meta" || e.key === "Control") && !inspecting && !drawing) startInspect();
    },
    true
  );
  document.addEventListener(
    "keyup",
    function (e) {
      if (drawing) {
        // ⇧⌘ released (either key) → stop capturing, ask for a note
        if (!((e.metaKey || e.ctrlKey) && e.shiftKey)) finishDraw();
        return;
      }
      if (isOurs(e.target)) return; // ignore key releases from inside our boxes
      if (e.key === "Meta" || e.key === "Control" || e.key === "Shift") stopInspect();
    },
    true
  );
  window.addEventListener("blur", function () {
    stopInspect();
    if (drawing) finishDraw();
  });

  document.addEventListener(
    "click",
    function (e) {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return; // ⇧ is reserved for drawing
      var t = e.target;
      if (isOurs(t)) return;
      e.preventDefault();
      e.stopPropagation();
      hideInspect();
      closeTree();
      closeCssModal();
      openPopover(t, contextOf(t));
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

  /* ---------- tree picker (DevTools-style element selection) ---------- */

  // Element children we'll show in the tree — skip our own UI and non-visual tags.
  function childrenOf(el) {
    if (!el || !el.children) return [];
    return Array.prototype.filter.call(el.children, function (c) {
      if (isOurs(c) || (c.getAttribute && c.getAttribute(UI_ATTR) != null)) return false;
      var t = c.tagName;
      return t !== "SCRIPT" && t !== "STYLE" && t !== "LINK" && t !== "META" &&
        t !== "NOSCRIPT" && t !== "TEMPLATE";
    });
  }

  function nodeLabel(el) {
    var s = looseSelectorOf(el);
    if (!childrenOf(el).length) {
      var t = collapse(el.textContent || "");
      if (t) s += '  "' + truncate(t, 18) + '"';
    }
    return s;
  }

  // Chain from <body> down to `el` (inclusive) — the rows we auto-expand.
  function ancestorsTo(el) {
    var arr = [], n = el;
    while (n && n.nodeType === 1) {
      arr.unshift(n);
      if (n === document.body) break;
      n = n.parentElement;
    }
    return arr;
  }

  function openTree() {
    closeTree();
    treeEl = document.createElement("div");
    treeEl.className = "tree";
    treeEl.innerHTML =
      '<div class="tree-h">html tree' +
      '<span class="tree-hint">hover = highlight · click = select</span>' +
      '<button class="pop-x" data-act="closetree">×</button></div>' +
      '<div class="tree-body"></div>';
    root.appendChild(treeEl);
    treeNodes = new Map();
    var path = ancestorsTo(currentEl || document.body);
    renderNode(document.body, treeEl.querySelector(".tree-body"), 0, path);
    treeEl.addEventListener("click", onTreeClick);
    treeEl.addEventListener("mouseover", onTreeHover);
    treeEl.addEventListener("mouseleave", hideInspect);
    var cur = treeNodes.get(currentEl);
    if (cur) cur.scrollIntoView({ block: "center" });
  }

  function renderNode(el, container, depth, path) {
    var hasKids = childrenOf(el).length > 0;
    var onPath = path.indexOf(el) >= 0;
    var row = document.createElement("div");
    row.className = "tnode" + (el === currentEl ? " cur" : "");
    row.style.paddingLeft = 6 + depth * 12 + "px";
    row.__el = el;
    row.__depth = depth;
    row.__rendered = false;
    row.innerHTML =
      (hasKids
        ? '<span class="ttog">' + (onPath ? "▾" : "▸") + "</span>"
        : '<span class="ttog tspace"></span>') +
      '<span class="ttag"></span>';
    row.querySelector(".ttag").textContent = nodeLabel(el);
    container.appendChild(row);
    treeNodes.set(el, row);
    var kids = document.createElement("div");
    kids.className = "tkids";
    container.appendChild(kids);
    row.__kids = kids;
    if (onPath && hasKids) expandNode(row, path);
    return row;
  }

  function expandNode(row, path) {
    if (!row.__rendered) {
      childrenOf(row.__el).forEach(function (c) {
        renderNode(c, row.__kids, row.__depth + 1, path || []);
      });
      row.__rendered = true;
    }
    row.__kids.style.display = "";
    var tog = row.querySelector(".ttog");
    if (tog) tog.textContent = "▾";
  }

  function collapseNode(row) {
    row.__kids.style.display = "none";
    var tog = row.querySelector(".ttog");
    if (tog) tog.textContent = "▸";
  }

  function onTreeClick(e) {
    if (e.target.getAttribute && e.target.getAttribute("data-act") === "closetree") {
      closeTree();
      return;
    }
    var row = e.target.closest ? e.target.closest(".tnode") : null;
    if (!row) return;
    if (e.target.classList && e.target.classList.contains("ttog")) {
      if (!childrenOf(row.__el).length) return;
      if (row.__rendered && row.__kids.style.display !== "none") collapseNode(row);
      else expandNode(row, ancestorsTo(currentEl || row.__el));
      return;
    }
    retarget(row.__el);
  }

  function onTreeHover(e) {
    var row = e.target.closest ? e.target.closest(".tnode") : null;
    if (row) drawInspect(row.__el);
  }

  // Move the highlight to `el`, expanding the path to it if needed.
  function updateTreeSelection(el) {
    if (!treeEl) return;
    var prev = treeEl.querySelector(".tnode.cur");
    if (prev) prev.classList.remove("cur");
    var path = ancestorsTo(el);
    for (var i = 0; i < path.length; i++) {
      var row = treeNodes.get(path[i]);
      if (row && childrenOf(path[i]).length && (!row.__rendered || row.__kids.style.display === "none")) {
        expandNode(row, path);
      }
    }
    var cur = treeNodes.get(el);
    if (cur) {
      cur.classList.add("cur");
      cur.scrollIntoView({ block: "nearest" });
    }
  }

  function closeTree() {
    if (treeEl && treeEl.parentNode) treeEl.parentNode.removeChild(treeEl);
    treeEl = null;
    treeNodes = null;
    hideInspect();
  }

  /* ---------- css editor (CodeMirror, live preview) ---------- */

  var REF_PROPS = [
    "color", "background-color", "font-size", "font-weight", "line-height",
    "letter-spacing", "padding", "margin", "border", "border-radius",
    "width", "height", "display", "box-shadow",
  ];
  var _cm = null;

  // Lazy-load CodeMirror 6 from a CDN (no build step). Falls back to a textarea
  // if the import fails (offline / CSP).
  function loadCM() {
    if (_cm) return Promise.resolve(_cm);
    return Promise.all([
      import("https://esm.sh/codemirror@6.0.1"),
      import("https://esm.sh/@codemirror/lang-css@6.3.1"),
    ]).then(function (m) {
      _cm = { EditorView: m[0].EditorView, basicSetup: m[0].basicSetup, cssLang: m[1].css };
      return _cm;
    });
  }

  function openCssModal() {
    if (!currentEl) return;
    closeCssModal();
    cssTarget = currentEl;
    cssOrigStyle = cssTarget.getAttribute("style") || "";
    cssEl = document.createElement("div");
    cssEl.className = "cssmodal";
    cssEl.innerHTML =
      '<div class="cssback" data-act="cancel"></div>' +
      '<div class="csscard">' +
      '<div class="cssh"><span class="csssel"></span>' +
      '<button class="pop-x" data-act="cancel">×</button></div>' +
      '<div class="cssref"></div>' +
      '<div class="cssed"></div>' +
      '<div class="cssnote">Edits preview on the page live. <b>Save as feedback</b> records the declarations for /prototype to apply.</div>' +
      '<div class="cssb"><button class="mini" data-act="revert">revert</button>' +
      '<div class="pop-rgt"><button class="mini" data-act="cancel">cancel</button>' +
      '<button class="mini primary" data-act="save">save as feedback</button></div></div>' +
      "</div>";
    root.appendChild(cssEl);
    cssEl.querySelector(".csssel").textContent = currentCtx.selector;
    cssEl.querySelector(".csssel").title = currentCtx.selector;
    buildCssRef(cssEl.querySelector(".cssref"), cssTarget);
    var initial = currentCtx.css != null ? currentCtx.css : declsFromStyle(cssOrigStyle);
    mountEditor(cssEl.querySelector(".cssed"), initial, applyLive);
    if (initial) applyLive(initial);

    cssEl.addEventListener("click", function (e) {
      var act = e.target.getAttribute("data-act");
      if (act === "cancel") {
        revertLive();
        closeCssModal();
      } else if (act === "revert") {
        setEditor("");
        revertLive();
      } else if (act === "save") saveCss();
    });
  }

  function mountEditor(container, initial, onChange) {
    cssView = null;
    cssTextarea = null;
    var ta = document.createElement("textarea");
    ta.className = "cssfallback";
    ta.value = initial || "";
    ta.placeholder = "color: #c2410c;\nfont-size: 18px;\npadding: 12px 16px;";
    ta.addEventListener("input", function () { onChange(ta.value); });
    container.appendChild(ta);
    cssTextarea = ta;

    loadCM().then(function (CM) {
      if (!cssEl || !ta.isConnected) return; // modal closed before CM loaded
      var seed = ta.value; // preserve anything typed before CM finished loading
      var view = new CM.EditorView({
        doc: seed,
        extensions: [
          CM.basicSetup,
          CM.cssLang(),
          CM.EditorView.updateListener.of(function (u) {
            if (u.docChanged) onChange(view.state.doc.toString());
          }),
          CM.EditorView.theme(
            {
              "&": { fontSize: "12px", backgroundColor: "#0f0e0a", color: "#f3eee2", borderRadius: "6px" },
              ".cm-content": { fontFamily: "ui-monospace,Menlo,monospace", caretColor: "#fb923c" },
              ".cm-gutters": { backgroundColor: "#0f0e0a", color: "#6b6453", border: "none" },
              ".cm-activeLine": { backgroundColor: "rgba(255,255,255,.03)" },
              ".cm-activeLineGutter": { backgroundColor: "rgba(255,255,255,.03)" },
              ".cm-scroller": { overflow: "auto", maxHeight: "240px" },
              "&.cm-focused": { outline: "none" },
            },
            { dark: true }
          ),
        ],
        parent: container,
      });
      if (ta.parentNode) ta.parentNode.removeChild(ta);
      cssTextarea = null;
      cssView = view;
      setTimeout(function () { view.focus(); }, 0);
    }).catch(function () { /* keep the textarea fallback */ });
  }

  function getEditor() {
    if (cssView) return cssView.state.doc.toString();
    if (cssTextarea) return cssTextarea.value;
    return "";
  }
  function setEditor(text) {
    if (cssView) cssView.dispatch({ changes: { from: 0, to: cssView.state.doc.length, insert: text } });
    else if (cssTextarea) cssTextarea.value = text;
  }

  // Reference chips of the element's current computed values; click to insert.
  function buildCssRef(container, el) {
    var cs = window.getComputedStyle(el);
    container.innerHTML = '<span class="reflbl">computed — click to add</span>';
    REF_PROPS.forEach(function (p) {
      var v = collapse(cs.getPropertyValue(p));
      if (!v || v === "none" || v === "normal" || v === "auto" || v === "0px" || v === "rgba(0, 0, 0, 0)") return;
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "refchip";
      chip.textContent = p + ": " + truncate(v, 20);
      chip.title = p + ": " + v;
      chip.setAttribute("data-decl", p + ": " + v + ";");
      container.appendChild(chip);
    });
    container.addEventListener("click", function (e) {
      var c = e.target.closest ? e.target.closest(".refchip") : null;
      if (c) insertDecl(c.getAttribute("data-decl"));
    });
  }

  function insertDecl(decl) {
    var cur = getEditor().replace(/\s*$/, "");
    var next = (cur ? cur + "\n" : "") + decl + "\n";
    setEditor(next);
    applyLive(next);
  }

  function declsFromStyle(s) {
    if (!s) return "";
    var parts = s.split(";").map(function (d) { return d.trim(); }).filter(Boolean);
    return parts.length ? parts.join(";\n") + ";" : "";
  }
  function joinStyle(orig, css) {
    return [orig, css].filter(function (x) { return x && x.trim(); }).join(";");
  }
  function applyLive(text) {
    if (!cssTarget) return;
    cssTarget.setAttribute("style", joinStyle(cssOrigStyle, text));
    scheduleReflow();
  }
  function revertLive() {
    if (!cssTarget) return;
    if (cssOrigStyle) cssTarget.setAttribute("style", cssOrigStyle);
    else cssTarget.removeAttribute("style");
    scheduleReflow();
  }

  function saveCss() {
    var css = getEditor().trim();
    currentCtx.css = css;
    applyLive(css); // keep the preview applied
    var text = popEl ? popEl.querySelector(".pop-ta").value.trim() : "";
    if (!css && !text) {
      delete store[currentCtx.key];
      pushEntry(Object.assign({}, currentCtx, { feedback: "", css: "", _delete: true }));
    } else {
      var entry = Object.assign({}, currentCtx, { feedback: text, css: css });
      store[currentCtx.key] = entry;
      pushEntry(entry);
    }
    closeCssModal();
    updateCssDot();
    renderToolbar();
    renderBadges();
  }

  function closeCssModal() {
    if (cssView) { try { cssView.destroy(); } catch (_) {} }
    cssView = null;
    cssTextarea = null;
    if (cssEl && cssEl.parentNode) cssEl.parentNode.removeChild(cssEl);
    cssEl = null;
    cssTarget = null;
  }

  /* ---------- draw mode: ⇧⌘ sketch → screenshot feedback ---------- */

  function ensureDrawCanvas() {
    var dpr = window.devicePixelRatio || 1;
    if (!drawCanvas) {
      drawCanvas = document.createElement("canvas");
      drawCanvas.className = "draw";
      root.appendChild(drawCanvas);
      drawCanvas.addEventListener("mousedown", onDrawDown);
      drawCanvas.addEventListener("mousemove", onDrawMove);
      window.addEventListener("mouseup", onDrawUp, true);
    }
    drawCanvas.style.display = "block";
    drawCanvas.width = Math.round(window.innerWidth * dpr);
    drawCanvas.height = Math.round(window.innerHeight * dpr);
    drawCanvas.style.width = window.innerWidth + "px";
    drawCanvas.style.height = window.innerHeight + "px";
    drawCtx = drawCanvas.getContext("2d");
    drawCtx.scale(dpr, dpr); // draw in CSS pixels
    drawCtx.lineCap = "round";
    drawCtx.lineJoin = "round";
  }

  function enterDraw() {
    if (drawing) return;
    dismissAll(); // one mode at a time — close any element-feedback surface
    drawing = true;
    drawStrokes = [];
    drawCanvas && (drawCanvas.__active = null);
    ensureDrawCanvas();
    drawCanvas.style.pointerEvents = "auto";
    renderToolbar();
  }

  function onDrawDown(e) {
    if (!drawing) return;
    e.preventDefault();
    var s = [{ x: e.clientX, y: e.clientY }];
    drawStrokes.push(s);
    drawCanvas.__active = s;
    renderStrokes();
  }
  function onDrawMove(e) {
    if (!drawing || !drawCanvas.__active) return;
    e.preventDefault();
    drawCanvas.__active.push({ x: e.clientX, y: e.clientY });
    renderStrokes();
  }
  function onDrawUp() {
    if (drawCanvas) drawCanvas.__active = null;
  }

  function renderStrokes() {
    if (!drawCtx) return;
    drawCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    drawCtx.strokeStyle = "#dc2626";
    drawCtx.lineWidth = 3;
    drawStrokes.forEach(function (s) {
      if (!s.length) return;
      drawCtx.beginPath();
      drawCtx.moveTo(s[0].x, s[0].y);
      for (var i = 1; i < s.length; i++) drawCtx.lineTo(s[i].x, s[i].y);
      if (s.length === 1) drawCtx.lineTo(s[0].x + 0.1, s[0].y + 0.1); // a dot
      drawCtx.stroke();
    });
  }

  // ⇧⌘ released — stop capturing; if there's ink, ask for a note, else clean up.
  function finishDraw() {
    if (!drawing) return;
    drawing = false;
    if (drawCanvas) {
      drawCanvas.style.pointerEvents = "none";
      drawCanvas.__active = null;
    }
    renderToolbar();
    var hasInk = drawStrokes && drawStrokes.some(function (s) { return s.length > 0; });
    if (hasInk) openDrawPop();
    else clearDraw();
  }

  function openDrawPop() {
    closeDrawPop();
    drawpopEl = document.createElement("div");
    drawpopEl.className = "drawpop";
    drawpopEl.innerHTML =
      '<div class="pop-h"><span class="pop-sel">✎ drawing</span>' +
      '<button class="pop-x" data-act="discard">×</button></div>' +
      '<div class="pop-tgt">A screenshot of this view + your sketch will be saved.</div>' +
      '<textarea class="pop-ta" rows="2" placeholder="What should change here? (optional)"></textarea>' +
      '<div class="pop-b"><button class="mini danger" data-act="discard">discard</button>' +
      '<div class="pop-rgt"><button class="mini primary" data-act="savedraw">save as feedback</button></div></div>';
    root.appendChild(drawpopEl);
    var ta = drawpopEl.querySelector(".pop-ta");
    setTimeout(function () { ta.focus(); }, 0);
    drawpopEl.addEventListener("click", function (e) {
      var act = e.target.getAttribute("data-act");
      if (act === "discard") clearDraw();
      else if (act === "savedraw") {
        var btn = drawpopEl.querySelector('[data-act="savedraw"]');
        btn.textContent = "saving…";
        btn.disabled = true;
        saveDrawing(ta.value.trim());
      }
    });
    ta.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        saveDrawing(ta.value.trim());
      } else if (e.key === "Escape") {
        e.preventDefault();
        clearDraw();
      }
    });
  }
  function closeDrawPop() {
    if (drawpopEl && drawpopEl.parentNode) drawpopEl.parentNode.removeChild(drawpopEl);
    drawpopEl = null;
  }

  function clearDraw() {
    closeDrawPop();
    drawing = false;
    drawStrokes = [];
    if (drawCtx) drawCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (drawCanvas) {
      drawCanvas.style.display = "none";
      drawCanvas.style.pointerEvents = "none";
      drawCanvas.__active = null;
    }
    renderToolbar();
  }

  function nextDrawId() {
    drawId++;
    return Date.now().toString(36) + "-" + drawId;
  }

  var _h2c = null;
  function loadH2C() {
    if (_h2c) return Promise.resolve(_h2c);
    return import("https://esm.sh/html2canvas@1.4.1").then(function (m) {
      _h2c = m.default || m;
      return _h2c;
    });
  }

  // Rasterize the current viewport (minus our UI) and composite the sketch on top.
  function captureScreenshot() {
    return loadH2C().then(function (html2canvas) {
      var dpr = window.devicePixelRatio || 1;
      return html2canvas(document.documentElement, {
        x: window.scrollX,
        y: window.scrollY,
        width: window.innerWidth,
        height: window.innerHeight,
        scale: dpr,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
        ignoreElements: function (el) {
          return el === host || (el.getAttribute && el.getAttribute(UI_ATTR) != null);
        },
      });
    }).then(function (base) {
      var out = document.createElement("canvas");
      out.width = base.width;
      out.height = base.height;
      var c = out.getContext("2d");
      c.drawImage(base, 0, 0);
      if (drawCanvas) c.drawImage(drawCanvas, 0, 0, out.width, out.height);
      return out.toDataURL("image/png"); // may throw if the page tainted the canvas
    });
  }

  function downloadDataUrl(url, name) {
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  }

  function saveDrawing(note) {
    captureScreenshot().then(function (dataUrl) {
      var key = "draw:" + nextDrawId();
      var meta = {
        key: key,
        kind: "drawing",
        feedback: note || "",
        viewport: {
          w: window.innerWidth, h: window.innerHeight,
          scrollX: window.scrollX, scrollY: window.scrollY,
        },
      };
      if (serverOK && dataUrl) {
        fetch(API + "/shot", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(Object.assign({}, meta, { image: dataUrl })),
        })
          .then(function (r) { if (!r.ok) throw new Error("bad"); return r.json(); })
          .then(function (json) { store = json || store; saveLocal(); afterDraw(); })
          .catch(function () { serverOK = false; offlineDraw(key, meta, dataUrl); });
      } else {
        offlineDraw(key, meta, dataUrl);
      }
    }).catch(function () {
      // screenshot failed (often a CORS-tainted canvas) — keep the note anyway
      var key = "draw:" + nextDrawId();
      var entry = { kind: "drawing", feedback: (note || "") + "  (screenshot unavailable)", image: "" };
      store[key] = entry;
      saveLocal();
      if (serverOK) pushEntry(Object.assign({ key: key }, entry));
      afterDraw();
    });
  }

  function offlineDraw(key, meta, dataUrl) {
    var imgName = (CFG.feedbackName || "feedback") + "." +
      key.replace(/[^a-z0-9]+/gi, "-") + ".png";
    if (dataUrl) downloadDataUrl(dataUrl, imgName);
    var entry = Object.assign({}, meta, { image: imgName });
    delete entry.key;
    store[key] = entry;
    saveLocal();
    afterDraw();
  }

  function afterDraw() {
    clearDraw();
    renderToolbar();
    renderBadges();
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
    ".bar .lbl.drawing{opacity:1;color:#fb923c;font-weight:600}" +
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
    ".list .empty{padding:12px 6px;color:#9b927c}" +
    // popover action chips (tree / css)
    ".pop-acts{display:flex;gap:6px;margin:2px 0 8px}" +
    ".chip{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:6px;background:#f0e9d8;color:#5c5341;font:600 11px/1 ui-monospace,Menlo,monospace;border:1px solid #e0d6bf}" +
    ".chip:hover{background:#e9e0cc;color:#17150f}" +
    ".chip.has{background:#f7e7dd;color:#c2410c;border-color:#e8c8b6}" +
    // tree picker
    ".tree{position:fixed;left:16px;bottom:64px;width:340px;max-height:60vh;display:flex;flex-direction:column;background:#17150f;color:#f3eee2;border-radius:10px;box-shadow:0 16px 50px -12px rgba(0,0,0,.55);z-index:5;pointer-events:auto;font:400 11px/1.5 ui-monospace,Menlo,monospace}" +
    ".tree-h{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #2a2620}" +
    ".tree-h .tree-hint{margin-left:auto;color:#6b6453;font-size:10px;font-weight:500}" +
    ".tree-body{overflow:auto;padding:4px 0}" +
    ".tnode{display:flex;align-items:center;gap:4px;padding:2px 8px 2px 0;white-space:nowrap;cursor:pointer;border-radius:4px}" +
    ".tnode:hover{background:#241f17}" +
    ".tnode.cur{background:#3a2114}" +
    ".tnode.cur .ttag{color:#fb923c}" +
    ".ttog{display:inline-block;width:12px;text-align:center;color:#6b6453;cursor:pointer;flex:none}" +
    ".ttog.tspace{cursor:default}" +
    ".ttag{color:#cfc6b2}" +
    // css editor modal
    ".cssmodal{position:fixed;inset:0;z-index:10;pointer-events:auto}" +
    ".cssback{position:absolute;inset:0;background:rgba(8,7,5,.55)}" +
    ".csscard{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,92vw);max-height:86vh;display:flex;flex-direction:column;gap:8px;background:#1b1813;color:#f3eee2;border:1px solid #2f2a22;border-radius:12px;box-shadow:0 24px 70px -16px rgba(0,0,0,.6);padding:14px}" +
    ".cssh{display:flex;align-items:center;justify-content:space-between;gap:8px}" +
    ".csssel{color:#fb923c;font:600 12px/1.3 ui-monospace,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".cssref{display:flex;flex-wrap:wrap;gap:5px;align-items:center;max-height:84px;overflow:auto}" +
    ".reflbl{color:#6b6453;font:500 10px/1 ui-monospace,Menlo,monospace;margin-right:2px}" +
    ".refchip{all:unset;cursor:pointer;padding:3px 7px;border-radius:5px;background:#26221a;color:#cfc6b2;font:500 10px/1.3 ui-monospace,Menlo,monospace;border:1px solid #322c22}" +
    ".refchip:hover{background:#322c22;color:#fb923c}" +
    ".cssed{border:1px solid #2f2a22;border-radius:6px;overflow:hidden;background:#0f0e0a}" +
    ".cssfallback{width:100%;box-sizing:border-box;min-height:200px;resize:vertical;border:0;outline:none;padding:10px;background:#0f0e0a;color:#f3eee2;font:12px/1.5 ui-monospace,Menlo,monospace}" +
    ".cssnote{color:#9b927c;font:400 11px/1.4 ui-monospace,Menlo,monospace}" +
    ".cssnote b{color:#f3eee2}" +
    ".cssb{display:flex;align-items:center;justify-content:space-between}" +
    ".cssmodal .pop-rgt{display:flex;gap:6px}" +
    // draw mode: canvas + note box
    ".draw{position:fixed;inset:0;z-index:4;cursor:crosshair;touch-action:none}" +
    ".drawpop{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);width:320px;background:#fffdf8;color:#17150f;border:1px solid #d6ccb4;border-radius:10px;box-shadow:0 16px 50px -12px rgba(23,21,15,.4);padding:10px;pointer-events:auto;z-index:11;font:400 12px/1.4 ui-monospace,Menlo,monospace}" +
    ".drawpop .pop-sel{color:#c2410c;font-weight:600}" +
    ".drawpop .pop-tgt{color:#6b6453;font-size:11px;margin-bottom:6px;padding:4px 6px;background:#faf6ec;border-radius:6px}" +
    ".drawpop .pop-ta{width:100%;box-sizing:border-box;resize:vertical;border:1px solid #d6ccb4;border-radius:6px;padding:6px;font:inherit;background:#fff;color:#17150f}" +
    ".drawpop .pop-ta:focus{outline:2px solid #f7e7dd;border-color:#c2410c}" +
    ".drawpop .pop-b{display:flex;align-items:center;justify-content:space-between;margin-top:8px}" +
    ".drawpop .mini{background:#ece5d4;color:#17150f}" +
    ".drawpop .mini:hover{background:#e4ddcc}" +
    ".drawpop .mini.primary{background:#c2410c;color:#fff}" +
    ".drawpop .mini.danger{background:#fdeceb;color:#b91c1c}";

  /* ---------- boot ---------- */

  function boot() {
    mountUI();
    barEl.addEventListener("click", onBarClick);
    window.addEventListener("scroll", scheduleReflow, true);
    window.addEventListener("resize", scheduleReflow, true);
    // Single-file prototypes switch "screens" by toggling DOM / display / hash.
    // Reflow on any of those so badges for the old screen don't linger.
    window.addEventListener("hashchange", scheduleReflow);
    window.addEventListener("popstate", scheduleReflow);
    if (window.MutationObserver && document.body) {
      new MutationObserver(scheduleReflow).observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["style", "class", "hidden", "aria-hidden"],
      });
    }
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
