/* theme.js — dark mode, persisted, shared by every page */
(function () {
  const KEY = "pp_theme";
  const saved = localStorage.getItem(KEY) || "light";
  document.documentElement.setAttribute("data-theme", saved);

  function apply(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(KEY, theme);
    document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
      btn.setAttribute("aria-pressed", theme === "dark");
    });
    document.dispatchEvent(new CustomEvent("themechange", { detail: { theme } }));
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
      btn.setAttribute("aria-pressed", saved === "dark");
      btn.addEventListener("click", () => {
        const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
        apply(next);
      });
    });
  });

  window.ThemeAPI = { apply };
})();
