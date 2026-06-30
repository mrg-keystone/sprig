/* ============================================================================
   message-composer — EXTRACTED JS (reference ground truth, NOT a deliverable)
   ----------------------------------------------------------------------------
   Verbatim slice of the in-memory script in hearth-prototype.html that drives
   the composer (the optimistic-write island): the live char-count, the
   maxlength clamp, the empty-guard, and the optimistic post().

   CROSS-UNIT DEPENDENCIES (defined elsewhere in the source, included/annotated
   here only so post() is readable — they belong to OTHER units):
     - renderWall(), MESSAGES, viewState  -> the "wall" unit. post() mutates
       MESSAGES and calls renderWall(), which does a FULL innerHTML rebuild of
       the whole wall + a document-wide lucide.createIcons() on every post.
       (See jank.md — this is the island's headline JS jank source.)
     - showToast()                        -> the "toast" unit. post() fires a
       success toast; the empty-guard fires a warning toast.
   ============================================================================ */

// ---------- Helpers (shared) ----------
const $ = (sel) => document.querySelector(sel);

// ---------- Live char count (input handler) ----------
// Wired: $("#msgInput").addEventListener("input", updateCharCount)
// Plain textContent write, no layout read — cheap, fires every keystroke.
function updateCharCount() {
  const v = $("#msgInput").value;
  $("#charCount").textContent = `${v.length}/240`;
}

// ---------- Focus helper (used by the empty-state CTA in the wall) ----------
function focusComposer() {
  $("#msgInput").focus();
  $("#msgInput").scrollIntoView({ behavior: "smooth", block: "center" });
}

// ---------- Optimistic post (the island's core) ----------
let nextId = 1000;
function post() {
  const nameEl = $("#nameInput");
  const msgEl = $("#msgInput");
  const text = msgEl.value.trim();

  if (!text) {
    // EMPTY GUARD: warning toast + refocus, no write.
    showToast("warning", "Your note is empty", "Write a few warm words first.");
    msgEl.focus();
    return;
  }

  // OPTIMISTIC ADD — appears instantly at the top of the wall (no network).
  const entry = {
    id: nextId++,
    name: nameEl.value.trim(),
    avatar: null,
    message: text,
    minutesAgo: 0,
    isNew: true,            // -> cardHtml() tags it .animate-rise (wall unit)
  };
  MESSAGES.unshift(entry);
  if (viewState !== "normal") viewState = "normal";
  renderWall();             // FULL wall innerHTML rebuild + lucide.createIcons() (see jank.md)
  showToast("success", "Message posted!", "Thanks for signing the guestbook.");

  // reset the composer
  nameEl.value = "";
  msgEl.value = "";
  updateCharCount();        // back to 0/240
  // scroll the fresh entry into view on small screens
  $("#wall").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- Wire-up (composer's listeners) ----------
$("#postBtn").addEventListener("click", post);
$("#msgInput").addEventListener("input", updateCharCount);
$("#msgInput").setAttribute("maxlength", "240");   // hard clamp on typed input

/* ----------------------------------------------------------------------------
   showToast() — belongs to the "toast" unit; included verbatim because post()
   calls it. NOTE for the jank pass: its auto-dismiss is setTimeout-driven and
   the fade-out is an inline-style transition (opacity/transform .25s). That is
   a toast-unit finding, not a composer finding.
   ---------------------------------------------------------------------------- */
function showToast(kind, title, body) {
  const tones = {
    success: { cls: "alert-success", icon: "party-popper" },
    error:   { cls: "alert-error",   icon: "circle-alert" },
    warning: { cls: "alert-warning", icon: "triangle-alert" },
    info:    { cls: "alert-soft alert-info", icon: "info" },
  };
  const t = tones[kind] || tones.info;
  const el = document.createElement("div");
  el.className = `alert ${t.cls} animate-rise shadow-lg`;
  el.setAttribute("role", "alert");
  el.innerHTML = `<i data-lucide="${t.icon}" class="size-5 shrink-0"></i>
    <div>
      <h3 class="font-bold">${escapeHtml(title)}</h3>
      ${body ? `<div class="text-xs opacity-90">${escapeHtml(body)}</div>` : ""}
    </div>`;
  $("#toasts").appendChild(el);
  lucide.createIcons();
  setTimeout(() => {
    el.style.transition = "opacity .25s, transform .25s";
    el.style.opacity = "0";
    el.style.transform = "translateY(8px)";
    setTimeout(() => el.remove(), 260);
  }, 3200);
}

// escapeHtml() — shared helper used by showToast() (and the wall's cardHtml()).
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
