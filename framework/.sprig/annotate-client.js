/* sprig dev --annotate overlay — ⌘/Ctrl+click an element → note, keyed to the COMPONENT
 * that owns it (resolved from sprig's scope-id marker), saved for "edit in isolation".
 * Injected by `sprig dev --annotate` into the app's HTML. No build step, no deps. */
(() => {
  if (window.__SPRIG_ANNOTATE_BOOTED__) return;
  window.__SPRIG_ANNOTATE_BOOTED__ = true;

  const CFG = window.__SPRIG_ANNOTATE__ || {};
  const COMPS = CFG.components || {}; // { scopeId: { selector, component, kind, isolateUrl } }
  const ID_RE = /^s[0-9a-f]{8}$/; // a sprig view-encapsulation scope marker

  function resolve(el) {
    let n = el;
    while (n && n.nodeType === 1) {
      if (n.getAttributeNames) {
        for (const name of n.getAttributeNames()) {
          if (ID_RE.test(name) && COMPS[name]) return { id: name, ...COMPS[name] };
        }
      }
      if (n.matches && n.matches("sprig-island[data-sel]")) {
        const sel = n.getAttribute("data-sel");
        for (const id in COMPS) if (COMPS[id].selector === sel) return { id, ...COMPS[id] };
      }
      n = n.parentElement;
    }
    return null;
  }

  const css = `
  .sa-pop,.sa-pill{position:fixed;z-index:2147483647;font:13px/1.45 ui-sans-serif,system-ui,sans-serif}
  .sa-pop{background:#111827;color:#f9fafb;border:1px solid #374151;border-radius:10px;
    box-shadow:0 12px 40px rgba(0,0,0,.45);width:330px;padding:12px}
  .sa-pop b{color:#a5b4fc}
  .sa-pop .sa-meta{font-size:11px;color:#9ca3af;margin:2px 0 8px;word-break:break-all}
  .sa-pop .sa-iso-link,.sa-item .sa-iso-link{color:#6ee7b7;text-decoration:none;font-size:11px}
  .sa-pop textarea{width:100%;box-sizing:border-box;min-height:64px;resize:vertical;background:#1f2937;
    color:#f9fafb;border:1px solid #374151;border-radius:7px;padding:7px;font:inherit}
  .sa-pop .sa-row{display:flex;gap:8px;margin-top:8px;justify-content:flex-end}
  .sa-btn{border:0;border-radius:7px;padding:6px 12px;font:inherit;cursor:pointer}
  .sa-save{background:#6366f1;color:#fff}.sa-cancel{background:#374151;color:#d1d5db}
  .sa-pill{right:14px;bottom:14px;background:#111827;color:#f9fafb;border:1px solid #374151;
    border-radius:999px;padding:8px 13px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.4)}
  .sa-pill b{color:#a5b4fc}
  .sa-toast{position:fixed;right:14px;bottom:58px;z-index:2147483647;background:#065f46;color:#ecfdf5;
    border-radius:8px;padding:8px 12px;font:13px ui-sans-serif,system-ui,sans-serif;
    box-shadow:0 6px 20px rgba(0,0,0,.4);opacity:0;transition:opacity .2s}
  .sa-panel{position:fixed;right:14px;bottom:58px;z-index:2147483647;width:380px;max-height:60vh;overflow:auto;
    background:#111827;color:#f9fafb;border:1px solid #374151;border-radius:10px;padding:12px;
    box-shadow:0 12px 40px rgba(0,0,0,.45);font:13px ui-sans-serif,system-ui,sans-serif}
  .sa-panel h4{margin:0 0 8px;font-size:13px;color:#a5b4fc}
  .sa-item{border-top:1px solid #1f2937;padding:7px 0}
  .sa-item .sa-c{color:#fbbf24;font-weight:600}
  .sa-item ul{margin:4px 0 0;padding-left:18px;color:#d1d5db}`;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  document.addEventListener("click", (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.button !== 0) return;
    const el = e.target;
    if (!el || (el.closest && el.closest(".sa-pop,.sa-pill,.sa-panel"))) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    openPopover(el, e.clientX, e.clientY);
  }, true);

  let pop = null;
  function closePop() {
    if (pop) pop.remove();
    pop = null;
  }
  function openPopover(el, x, y) {
    closePop();
    const comp = resolve(el);
    pop = document.createElement("div");
    pop.className = "sa-pop";
    pop.style.left = Math.min(x, innerWidth - 350) + "px";
    pop.style.top = Math.min(y, innerHeight - 210) + "px";
    const link = comp && comp.isolateUrl
      ? ` · <a class="sa-iso-link" href="${comp.isolateUrl}" target="_blank" rel="noopener">open in isolate ↗</a>`
      : "";
    const label = comp
      ? `→ <b>${comp.selector}</b> <span class="sa-meta">${comp.component} · ${comp.kind}${link}</span>`
      : `→ <b>unresolved</b> <span class="sa-meta">no component marker on this element — filed by selector</span>`;
    pop.innerHTML =
      `<div>${label}</div>` +
      `<textarea placeholder="What should change about this component?"></textarea>` +
      `<div class="sa-row"><button class="sa-btn sa-cancel">Cancel</button>` +
      `<button class="sa-btn sa-save">Save → edit in isolation</button></div>`;
    document.body.appendChild(pop);
    const ta = pop.querySelector("textarea");
    ta.focus();
    pop.querySelector(".sa-cancel").onclick = closePop;
    pop.querySelector(".sa-save").onclick = async () => {
      const note = ta.value.trim();
      if (!note) return closePop();
      await fetch("/__annotate/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: comp ? comp.id : null, selector: selectorOf(el), note }),
      });
      closePop();
      toast(comp ? `Noted → ${comp.selector} (edit in isolation)` : "Noted (unresolved — filed by selector)");
      refresh();
    };
    ta.addEventListener("keydown", (k) => {
      if (k.key === "Enter" && (k.metaKey || k.ctrlKey)) pop.querySelector(".sa-save").click();
      if (k.key === "Escape") closePop();
    });
  }

  function selectorOf(el) {
    if (el.id) return el.tagName.toLowerCase() + "#" + el.id;
    const cls = (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || "";
    const c = String(cls).trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
    return el.tagName.toLowerCase() + (c ? "." + c : "");
  }

  function toast(msg) {
    const t = document.createElement("div");
    t.className = "sa-toast";
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => (t.style.opacity = "1"));
    setTimeout(() => {
      t.style.opacity = "0";
      setTimeout(() => t.remove(), 250);
    }, 2200);
  }

  let panel = null;
  const pill = document.createElement("div");
  pill.className = "sa-pill";
  document.body.appendChild(pill);
  pill.onclick = () => (panel ? closePanel() : openPanel());

  function closePanel() {
    if (panel) panel.remove();
    panel = null;
  }
  async function openPanel() {
    const state = await (await fetch("/__annotate/state")).json();
    const entries = Object.entries(state).filter(([k]) => k !== "_howto");
    panel = document.createElement("div");
    panel.className = "sa-panel";
    panel.innerHTML = `<h4>Component notes — edit each in isolation</h4>` +
      (entries.length
        ? entries.map(([k, v]) =>
          `<div class="sa-item"><span class="sa-c">${v.selector}</span> <span class="sa-meta">${v.component}</span>` +
          (v.isolateUrl ? ` <a class="sa-iso-link" href="${v.isolateUrl}" target="_blank" rel="noopener">open in isolate ↗</a>` : "") +
          `<ul>${v.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>` +
          `<button class="sa-btn sa-cancel" data-del="${escapeHtml(k)}" style="margin-top:6px">done — remove</button></div>`
        ).join("")
        : `<div class="sa-meta">No notes yet. ⌘/Ctrl+click an element to add one.</div>`);
    document.body.appendChild(panel);
    panel.querySelectorAll("[data-del]").forEach((b) =>
      b.onclick = async () => {
        await fetch("/__annotate/save", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ _delete: b.getAttribute("data-del") }),
        });
        closePanel();
        openPanel();
        refresh();
      }
    );
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  async function refresh() {
    const state = await (await fetch("/__annotate/state")).json();
    const n = Object.keys(state).filter((k) => k !== "_howto").length;
    pill.innerHTML = `✎ <b>${n}</b> component${n === 1 ? "" : "s"} to edit`;
  }
  refresh();
})();
