// Light/dark theme toggle, shared by every page.
// The page follows the system setting until the user picks a theme with a [data-theme-toggle] button,
// then the choice is remembered in localStorage.
(function () {
  try {
    const saved = localStorage.getItem("theme");
    if (saved === "light" || saved === "dark") document.documentElement.dataset.theme = saved;
  } catch (e) {}

  function current() {
    const set = document.documentElement.dataset.theme;
    if (set) return set;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function label() {
    document.querySelectorAll("[data-theme-toggle] span").forEach((el) => {
      el.textContent = current() === "dark" ? "Light mode" : "Dark mode";
    });
  }

  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-theme-toggle]")) return;
    const next = current() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch (err) {}
    label();
    document.dispatchEvent(new CustomEvent("themechange"));
  });
  document.addEventListener("DOMContentLoaded", label);
})();
