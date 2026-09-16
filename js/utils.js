/* =========================================================================
   utils.js — shared helpers used across login / employee / admin pages
   ========================================================================= */

const Utils = (() => {
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function fmtLongDate(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return `${DOW[dt.getDay()]}, ${MONTHS[m - 1]} ${d}, ${y}`;
  }
  function fmtShortDate(dateStr) {
    if (!dateStr) return "—";
    const [y, m, d] = String(dateStr).split("-").map(Number);
    if (!y || !m || !d) return "—";
    return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
  }
  function statusColorVar(status) {
    return {
      Present: "--ok", Late: "--warn", Absent: "--danger",
      "Half Day": "--info", "On Leave": "--info", Weekend: "--muted-2",
    }[status] || "--muted-2";
  }

  function initials(name) {
    return name.split(" ").filter(Boolean).slice(0, 2).map((s) => s[0]).join("").toUpperCase();
  }

  function toast(message, type = "info", timeout = 3600) {
    let host = document.getElementById("toastHost");
    if (!host) {
      host = document.createElement("div");
      host.id = "toastHost";
      host.className = "toast-host";
      document.body.appendChild(host);
    }
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span class="toast-dot"></span><span>${message}</span>`;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
      el.classList.remove("show");
      setTimeout(() => el.remove(), 300);
    }, timeout);
  }

  function countUp(el, target, opts = {}) {
    const dur = opts.duration || 900;
    const decimals = opts.decimals || 0;
    const suffix = opts.suffix || "";
    const start = performance.now();
    const from = 0;
    function frame(now) {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = from + (target - from) * eased;
      el.textContent = val.toFixed(decimals) + suffix;
      if (p < 1) requestAnimationFrame(frame);
      else el.textContent = target.toFixed(decimals) + suffix;
    }
    requestAnimationFrame(frame);
  }

  function downloadCSV(filename, rows) {
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(",")]
      .concat(rows.map((r) => headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(",")))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function debounce(fn, wait = 250) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  }

  // Live mode is on but the placeholder Apps Script URL hasn't been replaced
  // yet — every fetch will fail. Catch that early with one clear message
  // instead of letting the person hunt through confusing network errors.
  function checkLiveConfig() {
    if (APP_CONFIG.USE_MOCK_DATA) return true;
    if (!APP_CONFIG.GOOGLE_SHEETS_API_URL || APP_CONFIG.GOOGLE_SHEETS_API_URL.includes("REPLACE_WITH")) {
      toast("Live mode is on, but GOOGLE_SHEETS_API_URL in js/config.js is still the placeholder — paste in your deployed Apps Script /exec URL.", "error", 8000);
      return false;
    }
    return true;
  }

  function fmtCurrency(n) {
    return "Rs " + Math.round(n).toLocaleString("en-PK");
  }

  function relTime(iso) {
    if (!iso) return "—";
    const ms = new Date(iso).getTime();
    if (Number.isNaN(ms)) return "—";
    const mins = Math.round((Date.now() - ms) / 60000);
    if (mins < 1) return "just now";
    if (mins === 1) return "1 min ago";
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  /* ------------------------------- modals -------------------------------- */
  function openModal(title, bodyHtml, { footHtml = "", wide = false } = {}) {
    closeModal();
    const overlay = document.createElement("div");
    overlay.className = "overlay show modal-overlay";
    overlay.id = "genericModalOverlay";
    overlay.innerHTML = `
      <div class="modal${wide ? " modal-wide" : ""}" role="dialog" aria-modal="true">
        <div class="modal-head">
          <strong>${title}</strong>
          <button class="drawer-close" id="genericModalClose" aria-label="Close">✕</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
        ${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ""}
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.querySelector(".modal").classList.add("show"));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
    document.getElementById("genericModalClose").addEventListener("click", closeModal);
    return overlay;
  }
  function closeModal() {
    const overlay = document.getElementById("genericModalOverlay");
    if (overlay) overlay.remove();
  }

  function confirmDialog(message, { confirmLabel = "Confirm", tone = "danger" } = {}) {
    return new Promise((resolve) => {
      const overlay = openModal("Please confirm", `<p style="color:var(--muted);font-size:13.5px;line-height:1.6;">${message}</p>`, {
        footHtml: `<button class="btn btn-ghost btn-sm" id="cdCancel">Cancel</button><button class="btn btn-sm" id="cdOk" style="background:var(--${tone});color:#fff;">${confirmLabel}</button>`,
      });
      overlay.querySelector("#cdCancel").addEventListener("click", () => { closeModal(); resolve(false); });
      overlay.querySelector("#cdOk").addEventListener("click", () => { closeModal(); resolve(true); });
    });
  }

  /* ---------------------------- Canvas charts --------------------------- */
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function fitCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, rect.width * dpr);
    canvas.height = Math.max(1, rect.height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: rect.width, h: rect.height };
  }

  function drawBarChart(canvas, labels, values, opts = {}) {
    const { ctx, w, h } = fitCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const pad = { t: 14, r: 8, b: 24, l: 8 };
    const max = Math.max(1, ...values) * 1.15;
    const barW = (w - pad.l - pad.r) / values.length;
    const accent = opts.color || cssVar("--accent");
    const grid = cssVar("--border");
    const text = cssVar("--muted");

    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = pad.t + ((h - pad.t - pad.b) / 3) * i;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    }

    values.forEach((v, i) => {
      const bh = ((h - pad.t - pad.b) * v) / max;
      const x = pad.l + i * barW + barW * 0.22;
      const bw = barW * 0.56;
      const y = h - pad.b - bh;
      const grad = ctx.createLinearGradient(0, y, 0, h - pad.b);
      grad.addColorStop(0, accent);
      grad.addColorStop(1, opts.color2 || cssVar("--accent-2"));
      ctx.fillStyle = grad;
      const r = Math.min(6, bw / 2);
      roundRect(ctx, x, y, bw, Math.max(2, bh), r);
      ctx.fill();

      if (opts.showLabels !== false && labels[i] !== undefined && (labels.length <= 14 || i % Math.ceil(labels.length / 10) === 0)) {
        ctx.fillStyle = text;
        ctx.font = "10px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(labels[i], x + bw / 2, h - 8);
      }
    });
  }

  function drawLineChart(canvas, labels, values, opts = {}) {
    const { ctx, w, h } = fitCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    const pad = { t: 14, r: 10, b: 22, l: 10 };
    const max = Math.max(1, ...values) * 1.2;
    const min = 0;
    const stepX = (w - pad.l - pad.r) / Math.max(1, values.length - 1);
    const accent = opts.color || cssVar("--accent");
    const grid = cssVar("--border");
    const text = cssVar("--muted");

    ctx.strokeStyle = grid;
    for (let i = 0; i <= 3; i++) {
      const y = pad.t + ((h - pad.t - pad.b) / 3) * i;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    }

    const pts = values.map((v, i) => [
      pad.l + i * stepX,
      pad.t + (h - pad.t - pad.b) * (1 - (v - min) / (max - min)),
    ]);

    const area = new Path2D();
    area.moveTo(pts[0][0], h - pad.b);
    pts.forEach((p) => area.lineTo(p[0], p[1]));
    area.lineTo(pts[pts.length - 1][0], h - pad.b);
    area.closePath();
    const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
    grad.addColorStop(0, hexAlpha(accent, 0.28));
    grad.addColorStop(1, hexAlpha(accent, 0.02));
    ctx.fillStyle = grad;
    ctx.fill(area);

    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.4;
    ctx.lineJoin = "round";
    ctx.stroke();

    pts.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p[0], p[1], 3, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();
      if (opts.showLabels !== false && (labels.length <= 10 || i % Math.ceil(labels.length / 7) === 0)) {
        ctx.fillStyle = text;
        ctx.font = "10px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(labels[i], p[0], h - 6);
      }
    });
  }

  function drawDonutChart(canvas, segments, opts = {}) {
    const { ctx, w, h } = fitCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    // Canvas can briefly report 0 width/height right at page load (before
    // the browser has finished laying out the view it sits in). Skip this
    // draw rather than pass a negative radius to ctx.arc(), which throws
    // and — since these render calls run one after another with no
    // try/catch — would stop every later render call (profile, leave,
    // etc.) from ever running. refreshAllCharts() re-draws on resize/tab
    // switch anyway, so this just means "wait for a size that makes sense".
    if (w < 10 || h < 10) return;
    const cx = w / 2, cy = h / 2;
    const rOuter = Math.max(1, Math.min(w, h) / 2 - 4);
    const rInner = Math.max(0, rOuter * (opts.thickness || 0.62));
    const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
    let start = -Math.PI / 2;

    segments.forEach((seg) => {
      const angle = (seg.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, rOuter, start, start + angle);
      ctx.arc(cx, cy, rInner, start + angle, start, true);
      ctx.closePath();
      ctx.fillStyle = seg.color;
      ctx.fill();
      start += angle;
    });

    if (opts.centerLabel) {
      ctx.fillStyle = cssVar("--text");
      ctx.font = "700 20px Sora, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(opts.centerLabel, cx, cy - 6);
      ctx.font = "11px Inter, sans-serif";
      ctx.fillStyle = cssVar("--muted");
      ctx.fillText(opts.centerSub || "", cx, cy + 14);
    }
  }

  function drawSparkline(canvas, values, opts = {}) {
    const { ctx, w, h } = fitCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    if (!values.length) return;
    const max = Math.max(...values, 1), min = Math.min(...values, 0);
    const stepX = w / Math.max(1, values.length - 1);
    const accent = opts.color || cssVar("--accent");
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = i * stepX;
      const y = h - ((v - min) / (max - min || 1)) * (h - 4) - 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function hexAlpha(hex, alpha) {
    if (hex.startsWith("#")) {
      const bigint = parseInt(hex.slice(1), 16);
      const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255;
      return `rgba(${r},${g},${b},${alpha})`;
    }
    return hex;
  }

  return {
    MONTHS, DOW, todayStr, fmtLongDate, fmtShortDate, statusColorVar, initials,
    toast, countUp, downloadCSV, debounce, fmtCurrency, relTime, checkLiveConfig,
    openModal, closeModal, confirmDialog,
    drawBarChart, drawLineChart, drawDonutChart, drawSparkline,
  };
})();
