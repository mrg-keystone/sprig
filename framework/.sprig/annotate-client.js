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

  var CFG = window.__SPRIG_ANNOTATE__ || window.__ANNOTATE__ || {};
  var MODE = CFG.mode || "prototype";
  // "prototype" → key a click to the ELEMENT (CSS selector); "build" → to the sprig
  // COMPONENT that owns it (via the scope-id marker). The overlay/visual layer is
  // identical; only resolve / save / list / remove + the popover label switch on this.
  var BUILD = MODE === "build";
  var COMPS = CFG.components || {}; // build mode: scopeId -> {selector, component, kind, isolateUrl}
  var API = "/__annotate";
  var UI_ATTR = "data-fbk-ui"; // marks our own DOM so we never annotate ourselves

  // xpath -> entry. Keyed by `key` field (the locator) on the server, but we
  // track locally by key too.
  var store = {}; // key -> entry
  var serverOK = true;
  var lsKey = "__annotate__" + (CFG.file || MODE || location.pathname);

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

  // BUILD mode: resolve a clicked element to its owning sprig COMPONENT via the
  // view-encapsulation scope-id marker the SSR renderer stamps (`<div s1a2b3c4d>`),
  // with the <sprig-island data-sel> fallback. Falls back to a selector when unmapped.
  var SCOPE_RE = /^s[0-9a-f]{8}$/;
  function buildContextOf(el) {
    var node = el, comp = null, id = null;
    while (node && node.nodeType === 1) {
      if (node.getAttributeNames) {
        var names = node.getAttributeNames();
        for (var i = 0; i < names.length; i++) {
          if (SCOPE_RE.test(names[i]) && COMPS[names[i]]) { id = names[i]; comp = COMPS[id]; break; }
        }
      }
      if (comp) break;
      if (node.matches && node.matches("sprig-island[data-sel]")) {
        var sel = node.getAttribute("data-sel");
        for (var k in COMPS) if (COMPS[k].selector === sel) { id = k; comp = COMPS[k]; break; }
        if (comp) break;
      }
      node = node.parentElement;
    }
    if (comp) {
      return {
        key: comp.component, selector: comp.selector, label: comp.selector,
        component: comp.component, kind: comp.kind, isolateUrl: comp.isolateUrl || "",
        // the SPECIFIC element clicked (so the note says which element within the component,
        // and isolate can locate it) — distinct from the component selector.
        elSelector: looseSelectorOf(el),
        scope: id, text: truncate(el.textContent, 140),
      };
    }
    var loose = looseSelectorOf(el);
    return {
      key: "unresolved:" + loose, selector: loose, label: loose, component: "",
      kind: "unresolved", isolateUrl: "", scope: null, elSelector: loose, text: truncate(el.textContent, 140), unresolved: true,
    };
  }
  function resolveCtx(el) { return BUILD ? buildContextOf(el) : contextOf(el); }

  // Real annotation keys (the build store carries a leading `_howto` string we must skip).
  function storeKeys() {
    return Object.keys(store).filter(function (k) {
      return k !== "_howto" && store[k] && typeof store[k] === "object";
    });
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

  // BUILD mode persistence: append a note to the resolved COMPONENT (server keys by
  // component path), or remove a component's whole entry. The server returns the new store.
  function buildSave(ctx, note) {
    return fetch(API + "/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: ctx.scope, selector: ctx.selector, note: note }),
    })
      .then(function (r) { if (!r.ok) throw new Error("bad"); return r.json(); })
      .then(function (json) { store = json || store; saveLocal(); })
      .catch(function () { serverOK = false; saveLocal(); renderToolbar(); });
  }
  function buildRemove(key) {
    return fetch(API + "/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ _delete: key }),
    })
      .then(function (r) { return r.json(); })
      .then(function (json) { store = json || store; saveLocal(); })
      .catch(function () {});
  }
  // Editing a component's notes from the list REPLACES them (one note per non-empty line),
  // vs a fresh ⌘-click which appends. Empty → the server drops the entry.
  function buildSetNotes(key, text) {
    var notes = String(text).split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
    return fetch(API + "/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ _set: key, notes: notes }),
    })
      .then(function (r) { return r.json(); })
      .then(function (json) { store = json || store; saveLocal(); })
      .catch(function () { serverOK = false; saveLocal(); renderToolbar(); });
  }

  /* ---------- UI (isolated in a shadow root) ---------- */

  var host, root, popEl, barEl, layerEl, inspectBox, inspectLabel, selBox;

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

    // Persistent highlight on the element the popover currently targets — survives mouse-out
    // (unlike the transient hover inspector), so a tree-picked element stays boxed on the page.
    selBox = document.createElement("div");
    selBox.className = "selbox";
    root.appendChild(selBox);

    barEl = document.createElement("div");
    barEl.className = "bar";
    root.appendChild(barEl);

    renderToolbar();
    renderBadges();
  }

  function entryCount() {
    return storeKeys().length;
  }

  function renderToolbar() {
    var n = entryCount();
    if (drawing) {
      barEl.innerHTML =
        '<span class="lbl drawing">✎ drawing — release ⇧⌘ to add a note</span>';
      barEl.classList.add("armed");
      updateBar();
      return;
    }
    var offline = serverOK
      ? ""
      : '<span class="warn" title="No annotate server reachable — feedback is kept in this browser. Use Export to download the JSON.">offline</span>';
    barEl.innerHTML =
      '<button class="dot" data-act="toggle" title="⌘/Ctrl+click an element to annotate · ⇧⌘ drag to draw">●</button>' +
      '<span class="lbl" data-act="list" title="Click to list every note — then click a row to reopen & edit it">' + (BUILD ? "components" : "feedback") + ' <b>' + n + "</b></span>" +
      offline +
      '<button class="mini" data-act="list">list</button>' +
      '<button class="mini" data-act="export">export</button>' +
      (n ? '<button class="mini danger" data-act="clear">clear</button>' : "");
    barEl.classList.toggle("armed", armed);
    var dot = barEl.querySelector('[data-act="toggle"]');
    if (dot) dot.classList.toggle("on", armed);
    updateBar();
  }

  function positionFor(el) {
    var r = el.getBoundingClientRect();
    return r;
  }

  function renderBadges() {
    if (!layerEl) return;
    layerEl.innerHTML = "";
    var keys = storeKeys();
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
    if (BUILD) {
      // map the component back to its scope-id marker → first element that carries it
      var sid = entry.scope;
      if (!sid) for (var id in COMPS) if (COMPS[id].component === entry.component) { sid = id; break; }
      if (sid) { try { return document.querySelector("[" + sid + "]"); } catch (_) {} }
      return null;
    }
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
    raiseHost(); // sit above any app modal before drawing the note box / selection
    currentEl = el;
    currentCtx = ctx;
    var existing = store[ctx.key];
    if (!BUILD && existing && existing.css && ctx.css == null) ctx.css = existing.css;
    popEl = document.createElement("div");
    popEl.className = "pop";
    // The seam: in BUILD a single "save" writes a note to the component (no inline source
    // patch — there's no throwaway HTML); in PROTOTYPE the split inline|json save stays.
    var saveBtns = BUILD
      ? '<button class="mini primary" data-act="save" title="Save this note for the component (⌘/Ctrl+Enter)">save</button>'
      : '<span class="savesplit">save:' +
        '<button class="mini primary" data-act="save-inline" title="Write data-note onto the element in the SOURCE html (⌘/Ctrl+Enter)">inline</button>' +
        '<button class="mini" data-act="save-json" title="Write to the sibling feedback.json">json</button>' +
        "</span>";
    var delBtn = existing
      ? '<button class="mini danger" data-act="delete">' + (BUILD ? "remove all" : "delete") + "</button>"
      : "<span></span>";
    popEl.innerHTML =
      '<div class="pop-h">' +
      '<span class="pop-sel"></span>' +
      '<button class="pop-x" data-act="cancel">×</button>' +
      "</div>" +
      (BUILD ? '<div class="pop-sub"></div>' : "") +
      '<div class="pop-tgt"></div>' +
      '<div class="pop-acts">' +
      '<button class="chip" data-act="tree" title="Pick any element from the HTML tree">⌗ tree</button>' +
      '<button class="chip" data-act="css" title="Edit this element\'s CSS live, save as feedback">{ } css</button>' +
      "</div>" +
      '<textarea class="pop-ta" rows="3" placeholder="' +
      (BUILD ? "What should change about this component?" : "What should change here?") + '"></textarea>' +
      '<div class="pop-msg"></div>' +
      '<div class="pop-b">' +
      delBtn +
      '<div class="pop-rgt">' +
      '<button class="mini" data-act="cancel">cancel</button>' +
      saveBtns +
      "</div></div>";
    root.appendChild(popEl);
    updateBar(); // a note box is open → keep the bar expanded
    dragByHeader(popEl, popEl.querySelector(".pop-h")); // header-drag the note box

    var selEl = popEl.querySelector(".pop-sel");
    selEl.textContent = ctx.selector;
    selEl.title = BUILD ? (ctx.component || ctx.selector) : ctx.selector; // full path on hover
    if (BUILD) {
      var sub = popEl.querySelector(".pop-sub");
      if (sub) {
        sub.innerHTML = '<span class="pop-comp"></span>' +
          (ctx.isolateUrl ? ' <a class="pop-iso" target="_blank" rel="noopener">open in isolate ↗</a>' : "");
        sub.querySelector(".pop-comp").textContent = (ctx.component || "(unmapped)") + " · " + ctx.kind +
          (ctx.elSelector && ctx.elSelector !== ctx.selector ? " · on " + ctx.elSelector : "");
        if (ctx.isolateUrl) sub.querySelector(".pop-iso").href = ctx.isolateUrl;
      }
    }
    popEl.querySelector(".pop-tgt").textContent = ctx.text || "(no text)";
    var ta = popEl.querySelector(".pop-ta");
    // build appends a NEW note each save (server keeps notes[]), so don't seed an "existing"
    ta.value = seedText != null ? seedText : (!BUILD && existing ? existing.feedback : "");
    updateCssDot();

    // position near the element (clamped to viewport); if there's no live element — e.g. editing
    // a note from the list whose element isn't on the current screen/route — center it instead.
    var pw = 280, ph = 178;
    if (el) {
      var r = positionFor(el);
      var left = Math.min(Math.max(8, r.left), window.innerWidth - pw - 8);
      var top = r.bottom + 8;
      if (top + ph > window.innerHeight) top = Math.max(8, r.top - ph - 8);
      popEl.style.left = left + "px";
      popEl.style.top = top + "px";
      showSel(el); // box the target on the page (persists until dismissed)
    } else {
      popEl.style.left = Math.max(8, (window.innerWidth - pw) / 2) + "px";
      popEl.style.top = Math.max(8, (window.innerHeight - ph) / 2) + "px";
      hideSel();
    }

    setTimeout(function () {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }, 0);

    function showMsg(t) {
      var el = popEl && popEl.querySelector(".pop-msg");
      if (el) { el.textContent = t || ""; el.style.display = t ? "block" : "none"; }
    }
    // `json` → sibling feedback.json (selector-keyed). `inline` → a data-note attribute
    // written into the SOURCE html on the element itself.
    function commit(mode) {
      var text = ta.value.trim();
      var css = ctx.css ? String(ctx.css).trim() : "";
      if (BUILD) {
        if (!text && !css) {
          // emptying an edited entry removes it; a fresh empty note just closes
          if (ctx._editNotes) buildRemove(ctx.key).then(after);
          else dismissAll();
          return;
        }
        var body = css ? (text ? text + "\n" : "") + "CSS: " + collapse(css) : text;
        if (ctx._editNotes) {
          // editing from the list REPLACES the component's notes (lines already carry their element)
          buildSetNotes(ctx.key, body).then(after);
        } else {
          // a fresh click APPENDS, tagged with the SPECIFIC element so the note is precise in isolate
          buildSave(ctx, ctx.elSelector ? ctx.elSelector + " — " + body : body).then(after);
        }
        return;
      }
      if (mode === "inline") return commitInline(text, css);
      commitJson(text, css);
    }
    function commitJson(text, css) {
      if (!text && !css) {
        delete store[ctx.key];
        pushEntry(Object.assign({}, ctx, { feedback: "", css: "", _delete: true })).then(after);
      } else {
        var entry = Object.assign({}, ctx, { feedback: text, css: css });
        store[ctx.key] = entry;
        pushEntry(entry).then(after);
      }
    }
    function commitInline(text, css) {
      // inline patches the live element's source — needs a live element. When editing a note
      // from the list whose element isn't on this screen, there's nothing to patch → fall back to json.
      if (!currentEl) { commitJson(text, css); return; }
      // reflect on the live DOM at once (visual confirmation), then patch the source file
      if (text) currentEl.setAttribute("data-note", text);
      else currentEl.removeAttribute("data-note");
      if (css) currentEl.setAttribute("data-note-css", css.replace(/\s*\n\s*/g, " "));
      else currentEl.removeAttribute("data-note-css");
      postInline(Object.assign({}, inlineDescriptor(currentEl), {
        note: text, css: css, remove: !text && !css,
      })).then(function (res) {
        if (res && res.ok) { after(); return; }
        // JS-rendered element → not in the source HTML. Don't lose the note: save it to feedback.json.
        showMsg("Element is JS-rendered — saved to feedback.json instead.");
        setTimeout(function () { commitJson(text, css); }, 900);
      });
    }
    function remove() {
      if (BUILD) { buildRemove(ctx.key).then(after); return; }
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
      if (act === "save") commit("build");
      else if (act === "save-inline") commit("inline");
      else if (act === "save-json") commit("json");
      else if (act === "cancel") dismissAll();
      else if (act === "delete") remove();
      else if (act === "tree") openTree();
      else if (act === "css") openCssModal();
    });
    ta.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        commit(BUILD ? "build" : "inline"); // ⌘/Ctrl+Enter → the primary save
      } else if (e.key === "Escape") {
        e.preventDefault();
        dismissAll();
      }
    });
  }

  // Describe `el` for the inline source-patch: tag + class-set (+id) and its index among
  // same-signature elements in live document order — which the server matches against source.
  function inlineDescriptor(el) {
    var tag = el.tagName.toLowerCase();
    var classes = (el.getAttribute("class") || "").trim();
    var id = el.id || "";
    var sel = tag + (id ? "#" + cssEscape(id) : "") +
      classes.split(/\s+/).filter(Boolean).map(function (c) { return "." + cssEscape(c); }).join("");
    var all = Array.prototype.filter.call(document.querySelectorAll(sel), function (n) { return !isOurs(n); });
    var idx = all.indexOf(el);
    return { tag: tag, classes: classes, id: id, idx: idx < 0 ? 0 : idx };
  }
  function cssEscape(s) {
    return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }
  function postInline(payload) {
    return fetch("/__annotate/inline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }).then(function (r) { return r.json(); }).catch(function () { return { ok: false }; });
  }

  // Re-point the open popover at a different element (from the tree), keeping the
  // note the user already typed and refreshing the tree's highlight.
  function retarget(el) {
    if (!el || el.nodeType !== 1 || isOurs(el)) return;
    var seed = popEl ? popEl.querySelector(".pop-ta").value : "";
    openPopover(el, resolveCtx(el), seed);
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
    hideSel();
    currentEl = null;
    currentCtx = null;
    updateBar(); // nothing open → collapse the bar back to its peek dot
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
    if (!on) { updateBar(); return; }
    listEl = document.createElement("div");
    listEl.className = "list";
    var keys = storeKeys();
    var rows = keys
      .map(function (k, i) {
        return (
          '<div class="row" data-i="' + i + '" title="Click to reopen and edit">' +
          '<span class="n">' + (i + 1) + "</span>" +
          '<div class="rc"><div class="rk"></div><div class="rf"></div></div>' +
          "</div>"
        );
      })
      .join("");
    listEl.innerHTML =
      '<div class="list-h">annotations <b>' + keys.length + "</b>" +
      '<span class="list-hint">click a row to edit</span>' +
      '<button class="pop-x" data-act="closelist">×</button></div>' +
      (rows || '<div class="empty">cmd/ctrl+click an element to add feedback</div>');
    root.appendChild(listEl);
    // fill text safely
    var rowEls = listEl.querySelectorAll(".row");
    keys.forEach(function (k, i) {
      var e = store[k];
      if (BUILD) {
        rowEls[i].querySelector(".rk").textContent = e.selector + (e.component ? "  " + e.component : "");
        rowEls[i].querySelector(".rf").textContent = (e.notes || []).join("  ·  ") || "(no note)";
        return;
      }
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
      if (e.target.getAttribute("data-act") === "closelist") { showList(false); return; }
      var row = e.target.closest ? e.target.closest(".row") : null;
      if (row && row.dataset.i != null) editEntry(keys[parseInt(row.dataset.i, 10)]);
    });
    updateBar(); // list open → keep the bar expanded
  }

  // Re-open the editor for an already-saved annotation (from the list), so notes can be edited
  // even after the popover was closed. Re-locates the element (best-effort) and seeds the note.
  function editEntry(key) {
    var entry = store[key];
    if (!entry || typeof entry !== "object") return;
    showList(false); // focus on editing; the bar reopens the list later
    var el = locate(entry); // may be null (element not on the current screen/route) → detached edit
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "center", behavior: "smooth" });
    if (BUILD) {
      var ctx = {
        key: key, selector: entry.selector, label: entry.selector,
        component: entry.component, kind: entry.kind, isolateUrl: entry.isolateUrl || "",
        scope: scopeForComponent(entry.component), text: "", _editNotes: true,
      };
      openPopover(el, ctx, (entry.notes || []).join("\n"));
    } else {
      // the stored entry has its `key` stripped (the server keys by it) — restore it so
      // existing-detection, delete, and the overwrite-on-save all resolve to this entry.
      openPopover(el, Object.assign({}, entry, { key: key }), entry.feedback || "");
    }
  }
  function scopeForComponent(comp) {
    for (var id in COMPS) if (COMPS[id].component === comp) return id;
    return null;
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

  // Persistent box around the popover's current target (the selected element). Unlike the
  // hover inspector it is NOT cleared on mouse-out — it tracks `currentEl` until the popover
  // is dismissed, so you always see which element you're annotating / picked from the tree.
  function showSel(el) {
    if (!selBox || !el || el.nodeType !== 1 || isOurs(el)) { hideSel(); return; }
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) { hideSel(); return; }
    selBox.style.cssText =
      "left:" + r.left + "px;top:" + r.top + "px;width:" + r.width + "px;height:" + r.height + "px;display:block";
  }

  function hideSel() {
    if (selBox) selBox.style.display = "none";
  }

  // Keep the persistent box glued to its element when the page scrolls or resizes.
  function syncSel() {
    if (selBox && selBox.style.display === "block" && currentEl) showSel(currentEl);
  }

  function startInspect() {
    inspecting = true;
    raiseHost(); // jump above any open modal the moment annotate activates
    if (lastTarget) showInspect(lastTarget);
  }

  function stopInspect() {
    inspecting = false;
    hideInspect();
  }

  // Keep the overlay above app **modals**. Our host is at the max z-index (2147483647), but a
  // modal that portals to the end of <body>/<html> AFTER we mounted — and uses that same max —
  // wins the tie by DOM order and covers the highlight. Re-appending the host so it's the LAST
  // child of <html> wins the tie back. No-op when already last (so it never churns the DOM, and
  // never re-parents while a focused popover is open elsewhere in the tree).
  function raiseHost() {
    if (host && document.documentElement.lastElementChild !== host) {
      document.documentElement.appendChild(host);
    }
  }

  /* ---------- events ---------- */

  var armed = true; // cmd/ctrl+click always works; this also enables plain-click capture when on
  var uiHidden = false; // ⌘+Ctrl "clean view": all annotate UI hidden, JSON kept on disk
  var chordUsed = false; // debounce so a held ⌘+Ctrl toggles once, not on every key-repeat

  // "Peek": the bar sits as a faint corner dot so the app shows in full glory, and expands to
  // the full toolbar only when you HOVER it or HOLD ⌘/Ctrl (the annotate modifier), or while a
  // feedback surface is open. ⌘+Ctrl clean-view (below) still hides everything for screenshots.
  var barHover = false, modHeld = false;
  function updateBar() {
    if (!barEl) return;
    var expanded = barHover || modHeld || !!popEl || !!listEl || !!treeEl || !!cssEl || !!drawpopEl || drawing;
    barEl.classList.toggle("peek", !expanded);
  }

  function isOurs(el) {
    return el && (el === host || (el.closest && el.getRootNode && el.getRootNode() === root));
  }

  // ⌘+Ctrl toggles a clean view: hide every annotate overlay (badges, boxes, bar, open
  // panels) so the bare prototype is visible/screenshot-able. The feedback JSON on disk is
  // untouched — press ⌘+Ctrl again to bring the UI back.
  function toggleUi() {
    uiHidden = !uiHidden;
    if (uiHidden) {
      dismissAll();
      stopInspect();
      hideSel();
    }
    if (host) host.style.display = uiHidden ? "none" : "";
  }

  // Track the pointer for the ⌘/Ctrl-held inspector. We listen on BOTH mousemove and pointermove
  // because Chrome's device/mobile emulation simulates touch and won't dispatch mousemove —
  // pointermove still fires for the emulated mouse, keeping the highlight alive.
  function onHover(e) {
    lastTarget = e.target;
    // The page-hover inspector must not run while a popover / tree / css panel is open —
    // otherwise it clobbers the tree's own row-hover highlight on every move.
    if (inspecting && !treeEl && !popEl && !cssEl) showInspect(e.target);
  }
  document.addEventListener("mousemove", onHover, true);
  document.addEventListener("pointermove", onHover, true);

  // Touch / mobile emulation has NO hover, so a finger (or emulated tap) never produces a move
  // until it presses. Preview the inspect box on pointerdown while ⌘/Ctrl is held — so the
  // highlight DOES appear in device mode; the click that follows still opens the note.
  document.addEventListener(
    "pointerdown",
    function (e) {
      if (uiHidden || drawing || popEl || cssEl || treeEl) return;
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return;
      if (isOurs(e.target)) return;
      raiseHost(); // a ⌘-press on a modal's element → make sure our highlight sits above it
      lastTarget = e.target;
      drawInspect(e.target);
    },
    true,
  );

  document.addEventListener(
    "keydown",
    function (e) {
      if (e.key === "Escape") {
        if (cssEl) { revertLive(); closeCssModal(); return; }
        if (drawpopEl || drawing) { clearDraw(); return; }
        if (treeEl) { closeTree(); return; }
      }
      // ⌘+Ctrl (no Shift) → toggle the clean view (hide/show all annotate UI). Checked before
      // the isOurs guard so it works with focus anywhere; debounced against key-repeat.
      if (e.metaKey && e.ctrlKey && !e.shiftKey) {
        if (!chordUsed) { chordUsed = true; toggleUi(); }
        return;
      }
      if (uiHidden) return; // clean view armed → no inspect/draw until ⌘+Ctrl restores the UI
      // keys typed inside our boxes must not arm draw/inspect (Escape above still closes)
      if (isOurs(e.target)) return;
      // ⇧⌘ / ⇧Ctrl → freehand draw mode; plain ⌘/Ctrl → hover inspector + reveal the bar
      if ((e.metaKey || e.ctrlKey) && e.shiftKey) { enterDraw(); return; }
      if (e.key === "Meta" || e.key === "Control") { modHeld = true; updateBar(); }
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
      // A modifier release ALWAYS clears the inspector + re-arms the chord — even when focus
      // is inside our textarea/editor (keyup target isOurs). Otherwise ⌘ stays "stuck" held
      // after a ⌘+click (which focuses the popover textarea), so the page-hover inspector keeps
      // fighting the tree highlight until the window is re-focused (the "switch Spaces" symptom).
      if (e.key === "Meta" || e.key === "Control" || e.key === "Shift") {
        chordUsed = false;
        modHeld = false;
        stopInspect();
        updateBar();
      }
    },
    true
  );
  window.addEventListener("blur", function () {
    stopInspect();
    modHeld = false; // a held ⌘ never "sticks" after tabbing away
    updateBar();
    if (drawing) finishDraw();
  });
  // keep the persistent selection box glued to its element through scroll/resize
  window.addEventListener("scroll", syncSel, true);
  window.addEventListener("resize", syncSel);

  document.addEventListener(
    "click",
    function (e) {
      if (uiHidden) return; // clean view → annotate clicks are inert until UI is restored
      var t = e.target;
      // Click outside any open feedback surface (popover / tree / css panel and their
      // children) → just close it. A plain click only; ⌘/Ctrl falls through to re-target.
      if ((popEl || treeEl || cssEl) && !isOurs(t) && !(e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        if (cssEl) revertLive(); // unsaved live edits → undo, same as cancel
        dismissAll();
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return; // ⇧ is reserved for drawing
      if (isOurs(t)) return;
      e.preventDefault();
      e.stopPropagation();
      hideInspect();
      closeTree();
      closeCssModal();
      openPopover(t, resolveCtx(t));
    },
    true
  );

  // toolbar / list actions
  document.addEventListener("DOMContentLoaded", function () {});

  function onBarClick(e) {
    // resolve the nearest [data-act] so clicking the label's inner <b> still counts
    var t = e.target.closest ? e.target.closest("[data-act]") : e.target;
    var act = t && t.getAttribute("data-act");
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
    dragByHeader(treeEl, treeEl.querySelector(".tree-h")); // header-drag the tree panel
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
      '<div class="csscard">' +
      '<div class="cssh"><span class="csssel"></span>' +
      '<button class="pop-x" data-act="cancel">×</button></div>' +
      '<div class="cssref"></div>' +
      '<div class="cssed"></div>' +
      '<div class="cssnote">Edits preview on the page live. <b>Apply</b> attaches the declarations to this note — then pick <b>inline</b> or <b>json</b> back in the note box.</div>' +
      '<div class="cssb"><button class="mini" data-act="revert">revert</button>' +
      '<div class="pop-rgt"><button class="mini" data-act="cancel">cancel</button>' +
      '<button class="mini primary" data-act="apply">apply</button></div></div>' +
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
      } else if (act === "apply") applyCss();
    });

    // Drag the panel by its header so it never permanently hides the element you're styling.
    dragByHeader(cssEl.querySelector(".csscard"), cssEl.querySelector(".cssh"));
  }

  // Make `card` draggable by `handle`; switches the card to left/top positioning on first drag.
  function dragByHeader(card, handle) {
    if (!card || !handle) return;
    handle.addEventListener("mousedown", function (e) {
      if (e.target.closest("button")) return; // let the × button click through
      e.preventDefault();
      var r = card.getBoundingClientRect();
      var dx = e.clientX - r.left, dy = e.clientY - r.top;
      card.style.right = "auto"; // switch to left/top positioning regardless of original anchor
      card.style.bottom = "auto";
      card.style.left = r.left + "px";
      card.style.top = r.top + "px";
      function move(ev) {
        card.style.left = Math.max(4, Math.min(window.innerWidth - 40, ev.clientX - dx)) + "px";
        card.style.top = Math.max(4, Math.min(window.innerHeight - 40, ev.clientY - dy)) + "px";
      }
      function up() {
        document.removeEventListener("mousemove", move, true);
        document.removeEventListener("mouseup", up, true);
      }
      document.addEventListener("mousemove", move, true);
      document.addEventListener("mouseup", up, true);
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

  // Attach the declarations to the current note (keeping the live preview) and return to the
  // note box — persistence (inline → data-note-css, or json) happens there via the split save.
  function applyCss() {
    currentCtx.css = getEditor().trim();
    applyLive(currentCtx.css); // keep the preview applied
    var seed = popEl ? popEl.querySelector(".pop-ta").value : undefined; // keep the typed note
    closeCssModal();
    updateCssDot();
    if (currentEl && currentCtx) openPopover(currentEl, currentCtx, seed); // back to the note box
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
    // html2canvas-PRO: a maintained fork with the same API that supports modern CSS color
    // functions — `oklch()` / `lab()` / `color-mix()`. Plain html2canvas@1.4.1 THROWS on oklch,
    // which sprig/daisyUI design systems use by default → the "(screenshot unavailable)" bug.
    return import("https://esm.sh/html2canvas-pro@1").then(function (m) {
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

  // Persist a captured drawing (PNG data URL) as a feedback entry via /shot (offline → download).
  function persistDrawing(note, dataUrl) {
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
  }

  function saveDrawing(note) {
    captureScreenshot()
      .then(function (dataUrl) { persistDrawing(note, dataUrl); })
      .catch(function () {
        // page raster failed (a style the rasterizer can't handle, or a CORS-tainted canvas).
        // Still save the SKETCH itself so the drawing is NEVER lost — the user did draw it.
        var url = "";
        try { url = drawCanvas ? drawCanvas.toDataURL("image/png") : ""; } catch (_) { url = ""; }
        if (url) {
          persistDrawing((note || "") + "  (sketch only — page capture failed)", url);
        } else {
          var key = "draw:" + nextDrawId();
          var entry = { kind: "drawing", feedback: (note || "") + "  (screenshot unavailable)", image: "" };
          store[key] = entry;
          saveLocal();
          if (serverOK) pushEntry(Object.assign({ key: key }, entry));
          afterDraw();
        }
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
    ".selbox{position:fixed;display:none;pointer-events:none;border:2px solid #c2410c;border-radius:4px;box-shadow:0 0 0 1px rgba(255,255,255,.25),0 0 0 5px rgba(194,65,12,.18)}" +
    ".inspect-lbl{position:fixed;display:none;pointer-events:none;background:#17150f;color:#f3eee2;font:600 11px/1 ui-monospace,Menlo,monospace;padding:5px 7px;border-radius:5px;white-space:nowrap;box-shadow:0 4px 14px -4px rgba(0,0,0,.5)}" +
    ".inspect-lbl b{color:#fb923c;font-weight:700}" +
    ".inspect-lbl span{color:#9b927c;font-weight:500}" +
    ".outline{position:fixed;border:2px solid #c2410c;border-radius:4px;box-shadow:0 0 0 2px rgba(194,65,12,.18);pointer-events:none}" +
    ".badge{position:fixed;transform:translate(-60%,-60%);min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#c2410c;color:#fff;font:600 10px/16px ui-monospace,Menlo,monospace;text-align:center;pointer-events:none}" +
    ".bar{position:fixed;right:16px;bottom:16px;display:flex;align-items:center;gap:8px;padding:6px 8px;background:#17150f;color:#f3eee2;border-radius:10px;box-shadow:0 8px 30px -8px rgba(0,0,0,.5);font:500 12px/1 ui-monospace,Menlo,monospace;pointer-events:auto;transition:opacity .14s ease,padding .14s ease}" +
    // peek: collapsed to a faint corner dot so the app shows in full glory; hover (or ⌘/Ctrl) expands it
    ".bar.peek{opacity:.3;padding:5px 6px;gap:0;box-shadow:0 4px 14px -6px rgba(0,0,0,.5)}" +
    ".bar.peek:hover{opacity:1}" +
    ".bar.peek .lbl,.bar.peek .mini,.bar.peek .warn{display:none}" +
    ".bar .lbl{opacity:.85;cursor:pointer}.bar .lbl:hover{opacity:1}.bar .lbl b{color:#fb923c}" +
    ".bar .lbl.drawing{opacity:1;color:#fb923c;font-weight:600}" +
    ".bar .dot{all:unset;cursor:pointer;color:#6b6453;font-size:11px}" +
    ".bar .dot.on{color:#fb923c}" +
    ".bar .warn{color:#fbbf24;font-size:11px;cursor:help}" +
    ".mini{all:unset;cursor:pointer;padding:4px 8px;border-radius:6px;background:#2a2620;color:#f3eee2;font:500 11px/1 ui-monospace,Menlo,monospace}" +
    ".mini:hover{background:#3a342a}" +
    ".mini.primary{background:#c2410c}.mini.primary:hover{background:#9a3412}" +
    ".mini.danger{background:#3a2420;color:#fca5a5}.mini.danger:hover{background:#4a2a24}" +
    ".pop{position:fixed;width:280px;background:#fffdf8;color:#17150f;border:1px solid #d6ccb4;border-radius:10px;box-shadow:0 16px 50px -12px rgba(23,21,15,.4);padding:10px;pointer-events:auto;font:400 12px/1.4 ui-monospace,Menlo,monospace}" +
    ".pop-h{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;cursor:move;user-select:none}" +
    ".pop-sel{color:#c2410c;font-weight:600;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    ".pop-sub{font:500 10px/1.3 ui-monospace,Menlo,monospace;color:#6b6453;margin:-2px 0 6px;word-break:break-all}" +
    ".pop-sub .pop-comp{color:#9a3412}" +
    ".pop-iso{color:#0369a1;text-decoration:none}.pop-iso:hover{text-decoration:underline}" +
    ".pop-msg{display:none;margin-top:6px;padding:5px 7px;border-radius:6px;background:#fbe9e0;color:#9a3412;font-size:11px;line-height:1.3}" +
    ".savesplit{display:inline-flex;align-items:center;gap:4px;color:#6b6453;font-size:11px}" +
    ".savesplit .mini{padding:4px 7px}" +
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
    ".list-hint{margin-left:auto;margin-right:8px;color:#6b6453;font-size:10px;font-weight:500}" +
    ".list .row{display:flex;gap:8px;padding:6px 4px;border-bottom:1px solid #221f18;cursor:pointer;border-radius:5px}" +
    ".list .row:hover{background:#241f17}" +
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
    ".tree-h{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #2a2620;cursor:move;user-select:none}" +
    ".tree-h .tree-hint{margin-left:auto;color:#6b6453;font-size:10px;font-weight:500}" +
    ".tree-body{overflow:auto;padding:4px 0}" +
    ".tnode{display:flex;align-items:center;gap:4px;padding:2px 8px 2px 0;white-space:nowrap;cursor:pointer;border-radius:4px}" +
    ".tnode:hover{background:#241f17}" +
    ".tnode.cur{background:#3a2114}" +
    ".tnode.cur .ttag{color:#fb923c}" +
    ".ttog{display:inline-block;width:12px;text-align:center;color:#6b6453;cursor:pointer;flex:none}" +
    ".ttog.tspace{cursor:default}" +
    ".ttag{color:#cfc6b2}" +
    // css editor — a NON-modal floating panel (no page-dimming backdrop) so live edits
    // are visible on the bright page underneath; drag it by the header to uncover the target.
    ".cssmodal{position:fixed;inset:0;z-index:10;pointer-events:none}" +
    ".csscard{position:fixed;right:16px;top:16px;width:min(440px,40vw);max-height:calc(100vh - 32px);display:flex;flex-direction:column;gap:8px;background:#1b1813;color:#f3eee2;border:1px solid #2f2a22;border-radius:12px;box-shadow:0 24px 70px -16px rgba(0,0,0,.6);padding:14px;pointer-events:auto}" +
    ".cssh{display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:move;user-select:none}" +
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
    // peek/expand: hovering the corner dot reveals the full toolbar; leaving collapses it
    // (unless ⌘/Ctrl is held or a feedback surface is open).
    barEl.addEventListener("mouseenter", function () { barHover = true; updateBar(); });
    barEl.addEventListener("mouseleave", function () { barHover = false; updateBar(); });
    updateBar(); // start collapsed → the app shows in full glory
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
    // Re-check the persistent badges against the json every second: pullState refreshes `store`
    // from the source of truth, and renderBadges only draws entries still present — so a square
    // whose entry was removed from the feedback json (by the LLM, a build pass, or a hand edit)
    // disappears within ~1s instead of lingering.
    setInterval(function () {
      pullState().then(renderBadges);
    }, 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
