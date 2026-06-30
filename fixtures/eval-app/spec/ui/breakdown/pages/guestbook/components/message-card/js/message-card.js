/* ───────────────────────────────────────────────────────────────────────────
   message-card — EXTRACTED SOURCE JS (reference ground truth, NOT deliverable)
   Lifted verbatim from the inline <script> in hearth-prototype.html.
   These are the functions that build one card's markup + the trigger that
   applies the `animate-rise` entrance class.
   ─────────────────────────────────────────────────────────────────────────── */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// "Jane Doe" -> "JD" ; "Pilar" -> "P" ; "" / whitespace -> "?"
function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
}

// minutesAgo -> relative label: "just now" | "N min ago" | "N hour(s) ago" | "yesterday" | "N days ago"
function timeAgo(min) {
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hour${h > 1 ? "s" : ""} ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  return `${d} day${d > 1 ? "s" : ""} ago`;
}

// initials-avatar tint rotation, picked by `m.id % 3` (warm, non-terracotta)
const AVATAR_TINTS = [
  "bg-neutral text-neutral-content",
  "bg-secondary text-secondary-content",
  "bg-accent text-accent-content",
];

// avatar slot: real photo when m.avatar is set, otherwise a tinted initials placeholder
function avatarHtml(m) {
  if (m.avatar) {
    return `<div class="avatar">
      <div class="w-12 rounded-full ring-1 ring-base-300">
        <img alt="" src="${escapeHtml(m.avatar)}" />
      </div>
    </div>`;
  }
  const tint = AVATAR_TINTS[m.id % AVATAR_TINTS.length];
  return `<div class="avatar avatar-placeholder">
    <div class="${tint} w-12 rounded-full">
      <span class="text-base font-semibold">${escapeHtml(initials(m.name))}</span>
    </div>
  </div>`;
}

// THE CARD. `isNew` is the ONLY motion trigger: it appends `animate-rise`.
// Empty/blank name renders as "Anonymous guest".
function cardHtml(m, isNew) {
  const name = (m.name || "").trim() || "Anonymous guest";
  return `<article class="card bg-base-100 border border-base-300 shadow-sm ${isNew ? "animate-rise" : ""}">
    <div class="card-body gap-3 p-5">
      <div class="flex items-start gap-3">
        ${avatarHtml(m)}
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span class="font-semibold break-words">${escapeHtml(name)}</span>
            <span class="badge badge-soft badge-secondary badge-sm shrink-0">
              <i data-lucide="clock" class="size-[0.85em]"></i> ${timeAgo(m.minutesAgo)}
            </span>
          </div>
          <p class="mt-1.5 text-base-content/85 leading-relaxed break-words [overflow-wrap:anywhere]">${escapeHtml(m.message)}</p>
        </div>
      </div>
    </div>
  </article>`;
}

/* ── Trigger context (from post() + renderWall()) ────────────────────────────
   The entrance fires for exactly one render after a card is posted:

     const entry = { id: nextId++, name: nameEl.value.trim(), avatar: null,
                     message: text, minutesAgo: 0, isNew: true };   // <- isNew set
     MESSAGES.unshift(entry);
     renderWall();   // cardHtml(m, m.isNew) -> new card gets `animate-rise`
     // then renderWall does: list.forEach((m) => { m.isNew = false; });  // animate ONCE

   IMPORTANT (see jank.md): renderWall() rebuilds the ENTIRE wall via
   `wall.innerHTML = list.map(...).join("")` and re-runs `lucide.createIcons()`
   over every card on each post — a synchronous long task, not part of the
   compositor-friendly animation itself. */
