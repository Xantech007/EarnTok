// ui.js — small helpers shared by every page.
import { authReady, loginUrlFor } from "./firebase.js";

export function escapeHTML(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function formatNumber(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

export function timeAgo(ts) {
  const d = ts && ts.toDate ? ts.toDate() : null;
  if (!d) return "just now";
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 2592000) return Math.floor(s / 86400) + "d ago";
  return d.toLocaleDateString();
}

export const icons = () => window.lucide && window.lucide.createIcons();

let toastTimer;
export function toast(msg) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "fixed top-16 left-1/2 -translate-x-1/2 z-[60] bg-gray-800/90 text-white text-xs px-4 py-2 rounded-full opacity-0 pointer-events-none transition-opacity duration-300 shadow-xl border border-gray-700 max-w-[90%] text-center";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.remove("opacity-0");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("opacity-0"), 2200);
}

/** Bottom navigation. Guests tapping a protected tab go to login.html and return afterwards. */
export async function renderNav(active) {
  const root = document.getElementById("nav-root");
  if (!root) return;
  const user = await authReady;
  const item = (id, href, icon, label, protectedTab) => {
    const to = protectedTab && !user ? loginUrlFor(href) : href;
    const cls = id === active ? "text-white" : "text-gray-400 hover:text-white";
    return `<a href="${to}" aria-label="${label}" class="flex flex-col items-center space-y-0.5 ${cls}">
      <i data-lucide="${icon}" class="w-6 h-6"></i><span>${label}</span></a>`;
  };
  const createTo = user ? "upload.html" : loginUrlFor("upload.html");
  root.className = "relative shrink-0 z-30 bg-black border-t border-gray-800 px-3 pt-2 safe-bottom flex items-center justify-around text-xs font-medium";
  root.innerHTML = `
    ${item("home", "index.html", "home", "Home", false)}
    ${item("friends", "friends.html", "users", "Friends", true)}
    <a href="${createTo}" aria-label="Create video" class="relative flex items-center justify-center active:scale-95 transition">
      <div class="w-11 h-7 rounded-lg bg-tiktok-cyan absolute -left-1"></div>
      <div class="w-11 h-7 rounded-lg bg-tiktok-red absolute -right-1"></div>
      <div class="w-11 h-7 rounded-lg bg-white relative flex items-center justify-center text-black">
        <i data-lucide="plus" class="w-5 h-5 stroke-[3]"></i>
      </div>
    </a>
    ${item("inbox", "inbox.html", "message-square", "Inbox", true)}
    ${item("profile", "profile.html", "user", "Profile", true)}`;
  icons();
}

/** Top bar for inner pages: back arrow + title (+ optional right-hand HTML). */
export function topBar(title, backHref = "index.html", right = "") {
  return `<header class="shrink-0 flex items-center justify-between px-4 pb-3 safe-top border-b border-gray-800 bg-black">
    <a href="${backHref}" aria-label="Back" class="p-1 -ml-1 text-white"><i data-lucide="chevron-left" class="w-6 h-6"></i></a>
    <h1 class="font-bold text-base truncate px-2">${escapeHTML(title)}</h1>
    <div class="min-w-[32px] flex justify-end">${right}</div>
  </header>`;
}
