/* =========================================================================
   auth.js
   Demo-only client-side session handling. See config.js for notes on
   swapping this for a real authenticated backend before production use.
   ========================================================================= */

const Session = {
  KEY: "pp_session",
  save(user) { sessionStorage.setItem(this.KEY, JSON.stringify(user)); },
  get() { try { return JSON.parse(sessionStorage.getItem(this.KEY)); } catch { return null; } },
  clear() { sessionStorage.removeItem(this.KEY); },
  guard(requiredRole) {
    const user = this.get();
    if (!user || user.role !== requiredRole) {
      window.location.href = "index.html";
      return null;
    }
    return user;
  },
};

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("loginForm");
  if (!form) return;

  const roleTabs = document.querySelectorAll(".role-tab");
  const idLabel = document.getElementById("idLabel");
  const idInput = document.getElementById("loginId");
  const hint = document.getElementById("credHint");
  let role = "employee";

  const roleCopy = {
    employee: { label: "Employee ID or email", placeholder: "EMP001 or your email", hint: "Demo: EMP001 / employee123" },
    admin: { label: "Admin username", placeholder: "admin", hint: "Demo: admin / admin123" },
  };

  roleTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      roleTabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      role = tab.dataset.role;
      const copy = roleCopy[role];
      idLabel.textContent = copy.label;
      idInput.placeholder = copy.placeholder;
      hint.textContent = copy.hint;
      document.getElementById("loginPanel").dataset.role = role;
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!Utils.checkLiveConfig()) return;
    const btn = form.querySelector("button[type=submit]");
    const errorEl = document.getElementById("loginError");
    errorEl.textContent = "";
    btn.classList.add("loading");
    btn.disabled = true;

    const identifier = idInput.value.trim();
    const password = document.getElementById("loginPassword").value;

    await new Promise((r) => setTimeout(r, 650)); // simulate network round-trip

    try {
      const result = await DataService.login(role, identifier, password);
      if (!result.ok) {
        errorEl.textContent = result.message;
        form.classList.remove("shake");
        void form.offsetWidth;
        form.classList.add("shake");
        btn.classList.remove("loading");
        btn.disabled = false;
        return;
      }
      Session.save(result.user);
      btn.classList.add("success");
      setTimeout(() => {
        window.location.href = role === "admin" ? "admin.html" : "employee.html";
      }, 450);
    } catch (err) {
      errorEl.textContent = "Something went wrong. Please try again.";
      btn.classList.remove("loading");
      btn.disabled = false;
    }
  });
});
