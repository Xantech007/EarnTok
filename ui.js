// ui.js — shared UI helpers, navigation renderer, and top bar utilities.
import { authReady, loginUrlFor } from "./firebase.js";

/**
 * Escape HTML special characters to prevent XSS.
 */
export function escapeHTML(s = "") {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

/**
 * Format numbers into TikTok-style compact representations (e.g. 1.2M, 45.8K).
 */
export function formatNumber(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0\$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0\$/, "") + "K";
  return String(n);
}

/**
 * Formats timestamps into relative human-readable strings (e.g. "2m ago", "3h ago").
 */
export function timeAgo(ts) {
  let d = null;
  if (ts && typeof ts.toDate === "function") {
    d = ts.toDate();
  } else if (ts instanceof Date) {
    d = ts;
  } else if (typeof ts === "number" || typeof ts === "string") {
    d = new Date(ts);
  }
  
  if (!d || isNaN(d.getTime())) return "just now";

  const seconds = (Date.now() - d.getTime()) / 1000;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
  if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago";
  if (seconds < 2592000) return Math.floor(seconds / 86400) + "d ago";
  if (seconds < 31536000) return Math.floor(seconds / 2592000) + "mo ago";
  return Math.floor(seconds / 31536000) + "y ago";
}

/**
 * Re-initializes Lucide SVG icons across the current page DOM.
 */
export const icons = () => window.lucide && window.lucide.createIcons();

/**
 * Global toast banner notification system.
 */
let toastTimer;
export function toast(msg) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className =
      "fixed top-16 left-1/2 -translate-x-1/2 z-[100] bg-gray-900/95 text-white text-xs font-medium px-4 py-2.5 rounded-full opacity-0 pointer-events-none transition-all duration-300 shadow-2xl border border-gray-700/80 max-w-[90%] text-center backdrop-blur-md transform -translate-y-2";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.remove("opacity-0", "-translate-y-2");
  el.classList.add("opacity-100", "translate-y-0");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("opacity-100", "translate-y-0");
    el.classList.add("opacity-0", "-translate-y-2");
  }, 2400);
}

/**
 * Renders the authentic TikTok bottom navigation bar.
 * Unauthenticated guests attempting to visit protected tabs are routed to login.html.
 *
 * @param {string} active - Active tab key ('home' | 'friends' | 'inbox' | 'profile')
 * @param {Object} [options] - Optional settings (e.g., { badgeCount: 3 })
 */
export async function renderNav(active, options = {}) {
  const root = document.getElementById("nav-root");
  if (!root) return;

  const user = await authReady;

  const item = (id, href, icon, label, protectedTab, badge = 0) => {
    const to = protectedTab && !user ? loginUrlFor(href) : href;
    const isActive = id === active;
    const activeTextClass = isActive ? "text-white font-bold" : "text-gray-400 hover:text-white font-normal";

    return `
      <a href="${to}" aria-label="${label}" class="relative flex flex-col items-center justify-center flex-1 py-1 space-y-0.5 ${activeTextClass} transition-colors active:scale-95">
        <div class="relative flex items-center justify-center">
          <i data-lucide="${icon}" class="w-6 h-6 stroke-[1.8]"></i>
          ${badge > 0 ? `<span class="absolute -top-1 -right-2 bg-tiktok-red text-white text-[9px] font-extrabold px-1.5 py-0.2 rounded-full min-w-[16px] text-center shadow-md">\${badge > 99 ? '99+' : badge}</span>` : ''}
        </div>
        <span class="text-[10px] tracking-tight leading-none">${label}</span>
      </a>`;
  };

  const createTo = user ? "upload.html" : loginUrlFor("upload.html");

  root.className =
    "relative shrink-0 z-30 bg-black/95 backdrop-blur-lg border-t border-gray-900/80 px-2 pt-2 pb-1 safe-bottom flex items-center justify-between text-xs select-none";

  root.innerHTML = `
    ${item("home", "index.html", "home", "Home", false)}
    ${item("friends", "friends.html", "users", "Friends", true)}
    
    <!-- Authentic TikTok 3D Plus Create Button -->
    <a href="${createTo}" aria-label="Create video" class="relative flex items-center justify-center px-3 group active:scale-90 transition-transform duration-150">
      <div class="relative w-11 h-7 flex items-center justify-center">
        <div class="w-10 h-7 rounded-[8px] bg-tiktok-cyan absolute -left-1 opacity-90 transition-transform group-hover:-translate-x-0.5"></div>
        <div class="w-10 h-7 rounded-[8px] bg-tiktok-red absolute -right-1 opacity-90 transition-transform group-hover:translate-x-0.5"></div>
        <div class="w-10 h-7 rounded-[8px] bg-white relative flex items-center justify-center text-black shadow-md">
          <i data-lucide="plus" class="w-5 h-5 stroke-[3]"></i>
        </div>
      </div>
    </a>

    ${item("inbox", "inbox.html", "message-square", "Inbox", true, options.inboxBadge || 0)}
    ${item("profile", "profile.html", "user", "Profile", true)}
  `;

  icons();
}

/**
 * Standard top header bar for internal pages (e.g. Friends, Inbox, Profile Settings).
 *
 * @param {string} title - Title text displayed in header
 * @param {string} [backHref="index.html"] - Link target for the back button
 * @param {string} [right=""] - Optional HTML content for the right action area
 */
export function topBar(title, backHref = "index.html", right = "") {
  return `
    <header class="shrink-0 flex items-center justify-between px-4 py-3 safe-top border-b border-gray-800/80 bg-black/95 backdrop-blur-md sticky top-0 z-30">
      <a href="${backHref}" aria-label="Back" class="p-1 -ml-1 text-white/90 hover:text-white transition active:scale-95">
        <i data-lucide="chevron-left" class="w-6 h-6 stroke-[2.2]"></i>
      </a>
      <h1 class="font-bold text-base text-white tracking-tight truncate px-2 text-center flex-1">${escapeHTML(title)}</h1>
      <div class="min-w-[32px] flex justify-end items-center text-sm font-semibold text-tiktok-red">${right}</div>
    </header>
  `;
}
