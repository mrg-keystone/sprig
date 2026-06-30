// ===== Extracted from hearth-prototype.html inline <script> (lines 192-447) =====
// REFERENCE GROUND TRUTH — not a deliverable. All data hardcoded, all
// interactions faked in memory. This is the entire "backend" of the prototype.

// ---------- Hardcoded data (the whole "backend") ----------
const SEED_MESSAGES = [
  { id: 1, name: "Marisol Vega",      avatar: "https://i.pravatar.cc/96?img=47", message: "So glad I found this little corner of the internet. It feels like a kitchen with the lights on. Thank you for having me.", minutesAgo: 8 },
  { id: 2, name: "Dev Okafor",        avatar: "https://i.pravatar.cc/96?img=15", message: "Stopping by from the other side of the world. Sending warmth to whoever reads this next. 🌍", minutesAgo: 41 },
  { id: 3, name: "Pilar",             avatar: null,                               message: "First time signing a guestbook since I was a kid at my grandmother's lake house. Lovely to do it again.", minutesAgo: 95 },
  { id: 4, name: "The Whitman House", avatar: null,                               message: "We read these out loud at dinner. Keep them coming — they make the table a little brighter.", minutesAgo: 180 },
  { id: 5, name: "Quinn Adeyemi",     avatar: "https://i.pravatar.cc/96?img=8",   message: "Just passing through. Lovely place. I'll be back.", minutesAgo: 420 },
  { id: 6, name: "Sam",               avatar: null,                               message: "Hello from a rainy Tuesday. This made it a little less grey.", minutesAgo: 1500 },
];

// overflow torture-test entries (one giant unbroken token + a wall of text + a long name)
const OVERFLOW_MESSAGES = [
  {
    id: 901,
    name: "Maximiliana-Featherington-Bartholomew-the-Third-of-Willowbrook-upon-Avon",
    avatar: null,
    message: "I have an extraordinary amount to say and absolutely no intention of using paragraph breaks, so here is one breathless run-on sentence that keeps going and going well past any reasonable length to make certain the card wraps gracefully instead of blowing out the layout, and then for good measure here is an unbreakable token: Supercalifragilisticexpialidocioussuperlongunbreakableurlwithnowhitespaceatallxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    minutesAgo: 2,
  },
  ...SEED_MESSAGES,
];

// mutable working copy (posting mutates this)
let MESSAGES = SEED_MESSAGES.map((m) => ({ ...m }));
let viewState = "loading"; // normal | empty | loading | overflow

// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
}

function timeAgo(min) {
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hour${h > 1 ? "s" : ""} ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  return `${d} day${d > 1 ? "s" : ""} ago`;
}

// rotate warm (non-terracotta) tints for initials avatars
const AVATAR_TINTS = [
  "bg-neutral text-neutral-content",
  "bg-secondary text-secondary-content",
  "bg-accent text-accent-content",
];

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

function skeletonCardHtml() {
  return `<div class="card bg-base-100 border border-base-300 shadow-sm">
    <div class="card-body p-5">
      <div class="flex items-start gap-3">
        <div class="skeleton h-12 w-12 shrink-0 rounded-full"></div>
        <div class="flex flex-col gap-2.5 w-full">
          <div class="skeleton h-4 w-32"></div>
          <div class="skeleton h-3.5 w-full"></div>
          <div class="skeleton h-3.5 w-4/5"></div>
        </div>
      </div>
    </div>
  </div>`;
}

function emptyStateHtml() {
  return `<div class="card bg-base-100 border border-dashed border-base-300">
    <div class="card-body items-center text-center py-16 gap-3">
      <span class="grid place-items-center size-16 rounded-full bg-base-200 text-accent">
        <i data-lucide="feather" class="size-8"></i>
      </span>
      <h3 class="text-2xl">The wall is quiet… for now</h3>
      <p class="text-base-content/60 max-w-sm">No one has signed yet. Be the first to leave a warm note for whoever wanders in next.</p>
      <button class="btn btn-primary mt-2" onclick="focusComposer()">
        <i data-lucide="feather" class="size-[1.2em]"></i> Be the first to sign
      </button>
    </div>
  </div>`;
}

// ---------- Render ----------
function renderWall() {
  const wall = $("#wall");
  const list = viewState === "overflow" ? OVERFLOW_MESSAGES : MESSAGES;

  if (viewState === "loading") {
    wall.innerHTML = Array.from({ length: 4 }, skeletonCardHtml).join("");
    $("#wallCount").textContent = "…";
  } else if (viewState === "empty") {
    wall.innerHTML = emptyStateHtml();
    $("#wallCount").textContent = "0";
  } else {
    wall.innerHTML = list.map((m) => cardHtml(m, m.isNew)).join("");
    list.forEach((m) => { m.isNew = false; }); // only animate once
    $("#wallCount").textContent = list.length;
  }

  // total "signed" count in header — playful fixed base + live wall size
  const base = 47;
  $("#signedCount").textContent = (base + (viewState === "empty" ? 0 : list.length)).toLocaleString();

  // reflect active demo button
  document.querySelectorAll(".js-state").forEach((b) => {
    const on = b.dataset.state === viewState;
    b.classList.toggle("btn-secondary", on);
    b.classList.toggle("btn-soft", on);
    b.classList.toggle("btn-ghost", !on);
  });

  lucide.createIcons();
}

// ---------- Toasts ----------
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

// ---------- Posting (optimistic, in-memory) ----------
let nextId = 1000;
function post() {
  const nameEl = $("#nameInput");
  const msgEl = $("#msgInput");
  const text = msgEl.value.trim();

  if (!text) {
    showToast("warning", "Your note is empty", "Write a few warm words first.");
    msgEl.focus();
    return;
  }

  // optimistic add — appears instantly at the top of the wall
  const entry = {
    id: nextId++,
    name: nameEl.value.trim(),
    avatar: null,
    message: text,
    minutesAgo: 0,
    isNew: true,
  };
  MESSAGES.unshift(entry);
  if (viewState !== "normal") viewState = "normal";
  renderWall();
  showToast("success", "Message posted!", "Thanks for signing the guestbook.");

  nameEl.value = "";
  msgEl.value = "";
  updateCharCount();
  // scroll the fresh entry into view on small screens
  $("#wall").scrollIntoView({ behavior: "smooth", block: "start" });
}

function focusComposer() {
  $("#msgInput").focus();
  $("#msgInput").scrollIntoView({ behavior: "smooth", block: "center" });
}

function updateCharCount() {
  const v = $("#msgInput").value;
  $("#charCount").textContent = `${v.length}/240`;
}

// ---------- Wire up ----------
$("#postBtn").addEventListener("click", post);
$("#msgInput").addEventListener("input", updateCharCount);
$("#msgInput").setAttribute("maxlength", "240");

document.querySelectorAll(".js-state").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.state;
    if (target === "loading") {
      // fake a fetch: show skeletons, then settle back to the real wall
      viewState = "loading";
      renderWall();
      setTimeout(() => { viewState = "normal"; renderWall(); }, 1400);
    } else {
      viewState = target;
      renderWall();
    }
  });
});

$("#errToastBtn").addEventListener("click", () => {
  showToast("error", "Couldn't post your message", "Something went wrong on our end. Give it another try.");
});

// ---------- Boot (fake initial load) ----------
lucide.createIcons();
renderWall(); // shows skeletons (viewState = "loading")
setTimeout(() => { viewState = "normal"; renderWall(); }, 900);
