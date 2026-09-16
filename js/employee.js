/* =========================================================================
   employee.js — powers employee.html
   ========================================================================= */

(async function () {
  const user = Session.guard("employee");
  if (!user) return;
  if (!Utils.checkLiveConfig()) return;

  let employee = null;
  let records = [];        // full attendance history, newest last
  let recordsByDate = {};  // date -> record
  let calCursor = new Date();
  let historyPage = 1;
  let currentReqFilter = "";
  const HISTORY_PAGE_SIZE = 10;

  /* --------------------------- shell wiring --------------------------- */
  document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      switchView(item.dataset.view);
    });
  });
  document.querySelectorAll("[data-goto]").forEach((el) => {
    el.style.cursor = "pointer";
    el.addEventListener("click", () => switchView(el.dataset.goto));
  });
  function switchView(view) {
    document.querySelectorAll(".nav-item[data-view]").forEach((n) => n.classList.toggle("active", n.dataset.view === view));
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("scrim").classList.remove("show");
  }
  document.getElementById("hamburger").addEventListener("click", () => {
    document.getElementById("sidebar").classList.add("open");
    document.getElementById("scrim").classList.add("show");
  });
  document.getElementById("scrim").addEventListener("click", () => {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("scrim").classList.remove("show");
  });
  document.getElementById("logoutBtn").addEventListener("click", (e) => {
    e.preventDefault();
    Session.clear();
    window.location.href = "index.html";
  });
  document.getElementById("notifBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const panel = document.getElementById("notifPanel");
    const willShow = !panel.classList.contains("show");
    panel.classList.toggle("show", willShow);
    if (willShow) loadNotifications();
  });
  document.addEventListener("click", (e) => {
    const panel = document.getElementById("notifPanel");
    if (panel && !e.target.closest(".notif-wrap")) panel.classList.remove("show");
  });
  document.getElementById("helpBtn").addEventListener("click", () => {
    Utils.toast("Need help? Reach HR at hr@simplyconnect.com or check the Leave & Requests page for how-tos.");
  });
  document.getElementById("topAvatarBtn").addEventListener("click", () => switchView("profile"));
  document.addEventListener("themechange", () => refreshAllCharts());

  function tickTopClock() {
    const t = new Date().toLocaleTimeString("en-US", { hour12: false });
    const c1 = document.getElementById("topClock"); if (c1) c1.textContent = t;
    const c2 = document.getElementById("heroClock"); if (c2) c2.textContent = t;
  }
  tickTopClock();
  setInterval(tickTopClock, 1000);

  /* ------------------------------ load --------------------------------- */
  try {
    const [employees, attendance] = await Promise.all([
      DataService.fetchEmployees(),
      DataService.fetchAttendance({}),
    ]);
    employee = employees.find((e) => e.id === user.id) || employees[0];
    records = (await DataService.fetchAttendance({ empId: employee.id })).sort((a, b) => a.date.localeCompare(b.date));
    recordsByDate = Object.fromEntries(records.map((r) => [r.date, r]));
  } catch (err) {
    Utils.toast("Could not load attendance data. " + err.message, "error", 5000);
    return;
  }

  document.getElementById("sideAvatar").textContent = Utils.initials(employee.name);
  document.getElementById("topAvatarBtn").textContent = Utils.initials(employee.name);
  document.getElementById("sideName").textContent = employee.name;
  document.getElementById("sideRole").textContent = employee.designation;
  document.getElementById("greeting").textContent = `Welcome back, ${employee.name.split(" ")[0]}`;
  document.getElementById("todayLongDate").textContent = Utils.fmtLongDate(Utils.todayStr());

  // Each section renders independently: if one throws (e.g. a chart, or a
  // sheet column that's missing/empty for this employee), it's logged to
  // the console but every OTHER section — profile, leave, payroll — still
  // renders. Previously these ran as plain sequential calls, so a single
  // error anywhere in this list silently stopped everything after it.
  function safeRender(name, fn) {
    try { fn(); } catch (err) { console.error(`[employee.js] ${name} failed:`, err); }
  }
  safeRender("renderOverview", renderOverview);
  safeRender("renderCalendar", renderCalendar);
  safeRender("renderStats", renderStats);
  safeRender("renderHistory", renderHistory);
  safeRender("renderProfile", renderProfile);
  safeRender("renderLeaveView", renderLeaveView);
  safeRender("renderPayrollView", renderPayrollView);
  safeRender("renderSettingsView", renderSettingsView);
  safeRender("refreshNotifDot", refreshNotifDot);

  window.addEventListener("resize", Utils.debounce(refreshAllCharts, 200));
  function refreshAllCharts() {
    safeRender("renderOverview", () => renderOverview(true));
    safeRender("renderStats", () => renderStats(true));
    safeRender("renderProfile", () => renderProfile(true));
  }

  /* ------------------------------ notifications ------------------------------ */
  async function refreshNotifDot() {
    try {
      const rows = await DataService.fetchNotifications("employee", employee.id);
      document.getElementById("notifDot").classList.toggle("hidden", !rows.some((n) => !n.read));
    } catch { /* non-critical */ }
  }
  async function loadNotifications() {
    const rows = await DataService.fetchNotifications("employee", employee.id);
    const list = document.getElementById("notifList");
    list.innerHTML = rows.length ? rows.map((n) => `
      <div class="notif-item${n.read ? "" : " unread"}">
        <span class="n-dot" style="background:var(--${n.tone})"></span>
        <div>
          <div class="n-title">${n.title}</div>
          <div class="n-body">${n.body}</div>
          <div class="n-time">${Utils.relTime(n.time)}</div>
        </div>
      </div>`).join("") : `<div class="empty-state">No notifications yet.</div>`;
    refreshNotifDot();
  }
  document.getElementById("markAllReadBtn").addEventListener("click", async () => {
    await DataService.markNotificationsRead("employee", employee.id);
    loadNotifications();
    Utils.toast("All notifications marked as read.");
  });
  setInterval(refreshNotifDot, APP_CONFIG.NOTIF_POLL_INTERVAL_MS);

  /* ------------------------------ leave & requests ------------------------------ */
  async function renderLeaveView() {
    const bal = await DataService.fetchLeaveBalances(employee.id);
    const totalAll = Object.values(bal).reduce((s, b) => s + b.total, 0);
    const usedAll = Object.values(bal).reduce((s, b) => s + b.used, 0);
    const summaryCard = leaveRingCard("Annual entitlement", totalAll, usedAll, true);
    const typeCards = Object.entries(bal).map(([type, b]) => leaveRingCard(`${type} leave`, b.total, b.used));
    document.getElementById("leaveBalanceRow").innerHTML = summaryCard + typeCards.join("");

    await loadMyRequests();

    document.querySelectorAll("#myReqTabs .request-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll("#myReqTabs .request-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        currentReqFilter = tab.dataset.status;
        loadMyRequests();
      });
    });
  }
  async function loadMyRequests() {
    const rows = await DataService.fetchRequests({ empId: employee.id, status: currentReqFilter || undefined });
    document.getElementById("myRequestsBody").innerHTML = rows.map((r) => `
      <tr>
        <td data-label="Type">${r.type}</td>
        <td data-label="Dates" class="mono" style="font-size:12.5px;">${r.type === "Leave" ? `${r.leaveType} · ${Utils.fmtShortDate(r.from)} → ${Utils.fmtShortDate(r.to)}` : `${Utils.fmtShortDate(r.date)} · ${r.requestedPunchIn}–${r.requestedPunchOut}`}</td>
        <td data-label="Reason" style="max-width:220px;white-space:normal;">${r.reason}</td>
        <td data-label="Submitted">${Utils.relTime(r.createdAt)}</td>
        <td data-label="Status"><span class="badge badge-${r.status.toLowerCase()}">${r.status}</span></td>
      </tr>`).join("") || `<tr><td colspan="5">${emptyRow("No requests in this filter.")}</td></tr>`;
  }

  document.getElementById("openLeaveBtn").addEventListener("click", () => {
    const overlay = Utils.openModal("Apply Leave", `
      <form id="leaveForm">
        <div class="field"><label>Leave type</label>
          <select class="select" id="lvType" style="width:100%;">
            <option>Casual</option><option>Sick</option>
          </select>
        </div>
        <div class="form-row-2">
          <div class="field"><label>From</label><input type="date" id="lvFrom" required></div>
          <div class="field"><label>To</label><input type="date" id="lvTo" required></div>
        </div>
        <div class="field"><label>Reason</label><textarea class="field-textarea" id="lvReason" placeholder="Briefly describe your reason…" required></textarea></div>
      </form>`, {
      footHtml: `<button class="btn btn-ghost btn-sm" id="lvCancel">Cancel</button><button class="btn btn-primary btn-sm" id="lvSubmit" style="width:auto;">Submit request</button>`,
    });
    overlay.querySelector("#lvCancel").addEventListener("click", Utils.closeModal);
    overlay.querySelector("#lvSubmit").addEventListener("click", async () => {
      const submitBtn = overlay.querySelector("#lvSubmit");
      if (submitBtn.disabled) return; // already submitting — ignore extra clicks
      const from = document.getElementById("lvFrom").value, to = document.getElementById("lvTo").value;
      const leaveType = document.getElementById("lvType").value;
      const reason = document.getElementById("lvReason").value.trim();
      if (!from || !to || !reason) { Utils.toast("Please fill in all fields.", "error"); return; }
      if (to < from) { Utils.toast("End date can't be before the start date.", "error"); return; }
      submitBtn.disabled = true;
      const originalLabel = submitBtn.textContent;
      submitBtn.textContent = "Submitting…";
      try {
        const bal = (await DataService.fetchLeaveBalances(employee.id))[leaveType];
        const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
        if (bal && days > bal.total - bal.used) {
          Utils.toast(`You only have ${bal.total - bal.used} ${leaveType} day(s) remaining.`, "error");
          return;
        }
        await DataService.submitLeaveRequest({ empId: employee.id, leaveType, from, to, reason });
        showRequestConfirmation("Leave request submitted", `Your ${leaveType} leave from ${Utils.fmtShortDate(from)} to ${Utils.fmtShortDate(to)} has been sent to your admin for approval. You'll be notified once it's reviewed.`);
        renderLeaveView();
      } catch (err) {
        Utils.toast("Could not submit request. " + err.message, "error", 5000);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      }
    });
  });

  document.getElementById("openRegularizeBtn").addEventListener("click", () => {
    const overlay = Utils.openModal("Request punch correction", `
      <form id="regForm">
        <div class="field"><label>Date</label><input type="date" id="regDate" max="${Utils.todayStr()}" required></div>
        <div class="form-row-2">
          <div class="field"><label>Correct punch in</label><input type="time" id="regIn" required></div>
          <div class="field"><label>Correct punch out</label><input type="time" id="regOut" required></div>
        </div>
        <div class="field"><label>Reason</label><textarea class="field-textarea" id="regReason" placeholder="e.g. biometric misread, forgot to punch…" required></textarea></div>
      </form>`, {
      footHtml: `<button class="btn btn-ghost btn-sm" id="regCancel">Cancel</button><button class="btn btn-primary btn-sm" id="regSubmit" style="width:auto;">Submit request</button>`,
    });
    overlay.querySelector("#regCancel").addEventListener("click", Utils.closeModal);
    overlay.querySelector("#regSubmit").addEventListener("click", async () => {
      const submitBtn = overlay.querySelector("#regSubmit");
      if (submitBtn.disabled) return;
      const date = document.getElementById("regDate").value;
      const inT = document.getElementById("regIn").value, outT = document.getElementById("regOut").value;
      const reason = document.getElementById("regReason").value.trim();
      if (!date || !inT || !outT || !reason) { Utils.toast("Please fill in all fields.", "error"); return; }
      submitBtn.disabled = true;
      const originalLabel = submitBtn.textContent;
      submitBtn.textContent = "Submitting…";
      try {
        await DataService.submitRegularizationRequest({
          empId: employee.id, date, requestedPunchIn: to12h(inT), requestedPunchOut: to12h(outT), reason,
        });
        showRequestConfirmation("Correction request submitted", `Your punch-correction request for ${Utils.fmtShortDate(date)} has been sent to your admin for approval.`);
        renderLeaveView();
      } catch (err) {
        Utils.toast("Could not submit request. " + err.message, "error", 5000);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      }
    });
  });

  function showRequestConfirmation(title, message) {
    const overlay = Utils.openModal(title, `
      <div style="text-align:center;padding:10px 0 4px;">
        <div style="width:52px;height:52px;border-radius:50%;background:var(--ok-bg);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>
        </div>
        <p style="color:var(--muted);font-size:13.5px;line-height:1.6;">${message}</p>
      </div>`, {
      footHtml: `<button class="btn btn-primary btn-sm" id="reqConfirmClose" style="width:auto;margin:0 auto;">Got it</button>`,
    });
    overlay.querySelector("#reqConfirmClose").addEventListener("click", Utils.closeModal);
  }

  /* ------------------------------ payroll ------------------------------ */
  async function renderPayrollView() {
    const sel = document.getElementById("payslipMonthSelect");
    if (!sel.options.length) {
      const months = [...new Set(records.map((r) => r.date.slice(0, 7)))].sort().reverse();
      months.forEach((ym) => {
        const [y, m] = ym.split("-");
        const opt = document.createElement("option");
        opt.value = ym; opt.textContent = `${Utils.MONTHS[+m - 1]} ${y}`;
        sel.appendChild(opt);
      });
      sel.addEventListener("change", () => drawPayslip(sel.value));
    }
    drawPayslip(sel.value || sel.options[0]?.value || Utils.todayStr().slice(0, 7));
    document.getElementById("downloadPayslipBtn").addEventListener("click", () => {
      document.title = `Payslip - ${employee.empCode} - ${sel.options[sel.selectedIndex]?.textContent || ""}`;
      document.body.classList.add("printing-payslip");
      window.print();
    });
    window.addEventListener("afterprint", () => {
      document.body.classList.remove("printing-payslip");
      document.title = "My Attendance — Simply Connect";
    });
  }
  async function drawPayslip(ym) {
    const slip = await DataService.fetchPayslip(employee.id, ym);
    const [y, m] = ym.split("-");
    document.getElementById("payslipContainer").innerHTML = `
      <div class="payslip-card">
        <div class="payslip-head">
          <div style="display:flex;align-items:center;gap:12px;">
            <div class="logo-chip" style="padding:6px 9px;"><img src="assets/logo.png" alt="Simply Connect" style="height:18px;width:auto;display:block;"></div>
            <div>
              <div style="font-size:12px;color:#B9C0DA;margin-bottom:4px;">Payslip for ${slip.status === "Finalized" ? '<span style="color:var(--ok);font-weight:700;">· Finalized</span>' : '<span style="color:var(--warn);font-weight:700;">· Live preview</span>'}</div>
              <h3 style="font-size:19px;">${Utils.MONTHS[+m - 1]} ${y}</h3>
              <div style="font-size:12.5px;color:#B9C0DA;margin-top:6px;">${slip.empName} · ${slip.empCode} · ${slip.department}</div>
            </div>
          </div>
          <div class="ps-net"><span>Net pay</span><b>${Utils.fmtCurrency(slip.net)}</b></div>
        </div>
        <div class="payslip-body">
          <div class="ps-section-label">Attendance summary</div>
          <div class="ps-line"><span>Working days</span><b>${slip.workDays}</b></div>
          <div class="ps-line"><span>Present / Late</span><b>${slip.present}</b></div>
          <div class="ps-line"><span>Late arrivals</span><b>${slip.late}${slip.late ? ` (${slip.lateDeductionDays} day${slip.lateDeductionDays === 1 ? "" : "s"} deducted, every ${APP_CONFIG.LATE_STRIKES_PER_DEDUCTION})` : ""}</b></div>
          <div class="ps-line"><span>Absent (unapproved)</span><b>${slip.absent}</b></div>
          <div class="ps-line"><span>Half days</span><b>${slip.halfDays}</b></div>
          <div class="ps-section-label">Earnings</div>
          <div class="ps-line"><span>Base salary</span><b>${Utils.fmtCurrency(slip.baseSalary)}</b></div>
          <div class="ps-line"><span>Allowances</span><b>${Utils.fmtCurrency(slip.allowances)}</b></div>
          ${slip.overtimeHours ? `<div class="ps-line"><span>Overtime (${slip.overtimeHours}h @ ${Utils.fmtCurrency(slip.overtimeRate)}/h)</span><b>${Utils.fmtCurrency(slip.overtimeAmount)}</b></div>` : ""}
          <div class="ps-line"><span>Gross pay</span><b>${Utils.fmtCurrency(slip.gross)}</b></div>
          <div class="ps-section-label">Deductions</div>
          <div class="ps-line"><span>Absence, late-strikes &amp; half-days</span><b>-${Utils.fmtCurrency(slip.deduction)}</b></div>
          <div class="ps-line total"><span>Net pay</span><b>${Utils.fmtCurrency(slip.net)}</b></div>
        </div>
      </div>`;
  }

  /* ------------------------------ settings ------------------------------ */
  function renderSettingsView() {
    document.getElementById("setEmail").value = employee.email;
    document.getElementById("setPhone").value = employee.phone;
    document.getElementById("settingsForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("setEmail").value.trim();
      const phone = document.getElementById("setPhone").value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) { Utils.toast("Please enter a valid email address.", "error"); return; }
      const updated = await DataService.updateEmployee(employee.id, { email, phone });
      employee.email = updated.email; employee.phone = updated.phone;
      renderProfile();
      Utils.toast("Contact details updated.");
    });
    document.getElementById("passwordForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const p1 = document.getElementById("setPass1").value, p2 = document.getElementById("setPass2").value;
      if (p1.length < 6) { Utils.toast("Password must be at least 6 characters.", "error"); return; }
      if (p1 !== p2) { Utils.toast("Passwords don't match.", "error"); return; }
      document.getElementById("passwordForm").reset();
      Utils.toast("Password updated.");
    });
    document.getElementById("resetDemoBtn").addEventListener("click", async () => {
      const ok = await Utils.confirmDialog("This clears all demo data on this device — including any requests you've submitted — and reloads the app with a fresh sample dataset. This can't be undone.", { confirmLabel: "Reset everything", tone: "danger" });
      if (!ok) return;
      await DataService.resetDemoData();
      Session.clear();
      window.location.href = "index.html";
    });
  }

  /* ------------------------------ overview ------------------------------ */
  function renderOverview(chartsOnly) {
    const today = recordsByDate[Utils.todayStr()];
    const statusMap = {
      Present: { pill: "pill-present", label: "Present" },
      Late: { pill: "pill-late", label: "Late" },
      Absent: { pill: "pill-absent", label: "Absent" },
      "Half Day": { pill: "pill-halfday", label: "Half Day" },
      "On Leave": { pill: "pill-leave", label: "On Leave" },
      Weekend: { pill: "pill-weekend", label: "Weekend" },
    };
    if (!chartsOnly) {
      const st = statusMap[today?.status] || { pill: "pill-weekend", label: "Not yet punched" };
      const pill = document.getElementById("todayStatusPill");
      pill.className = `status-pill ${st.pill}`;
      pill.innerHTML = `<span class="dotting"></span> ${st.label}`;

      document.getElementById("heroPunchIn").textContent = today?.punchIn || "--:--";
      document.getElementById("heroPunchOut").textContent = today?.punchOut || (today?.punchIn ? "Still in" : "--:--");
      document.getElementById("heroShift").textContent = `${to12h(employee.shiftStart)}–${to12h(employee.shiftEnd)}`;

      let workedH = today?.workingHours;
      if (today?.punchIn && !today?.punchOut) {
        workedH = liveWorkedHours(today.punchIn);
      }
      document.getElementById("heroWorked").textContent = workedH != null ? hoursToHM(workedH) : "0h 0m";
      const pct = Math.min(100, Math.round(((workedH || 0) / 8) * 100));
      document.getElementById("heroProgressBar").style.width = pct + "%";
      document.getElementById("heroProgressLabel").textContent = `${pct}% of your 8h target`;

      // stat cards (30-day window)
      const last30 = lastNDays(records, 30).filter((r) => r.status !== "Weekend");
      const present = last30.filter((r) => r.status === "Present").length;
      const late = last30.filter((r) => r.status === "Late").length;
      const absent = last30.filter((r) => r.status === "Absent").length;
      const avgHours = average(last30.filter((r) => r.workingHours).map((r) => r.workingHours));

      document.getElementById("statCardsRow").innerHTML = [
        statCard("Present days", present, "ok", iconCheck(), "30d"),
        statCard("Late days", late, "warn", iconClock(), "30d"),
        statCard("Absent days", absent, "danger", iconX(), "30d"),
        statCard("Avg. working hrs", avgHours.toFixed(1) + "h", "info", iconBar(), "30d"),
      ].join("");
      document.querySelectorAll("#statCardsRow .val[data-count]").forEach((el) => {
        Utils.countUp(el, +el.dataset.count, { decimals: el.dataset.decimals ? 1 : 0, suffix: el.dataset.suffix || "" });
      });

      // recent activity
      const recent = [...records].filter((r) => r.status !== "Weekend").slice(-6).reverse();
      document.getElementById("recentActivityList").innerHTML = recent.map((r) => `
        <div class="live-feed-item">
          <span class="badge badge-${slug(r.status)}">${r.status}</span>
          <div style="flex:1;">
            <div style="font-size:13px;font-weight:600;">${Utils.fmtShortDate(r.date)}</div>
            <div style="font-size:11.5px;color:var(--muted);">${r.punchIn ? `In ${r.punchIn}` : "No punch"}${r.punchOut ? ` · Out ${r.punchOut}` : ""}</div>
          </div>
          <div class="mono" style="font-size:12px;color:var(--muted);">${r.workingHours ? r.workingHours.toFixed(1) + "h" : "—"}</div>
        </div>`).join("") || emptyRow("No recent activity yet.");
    }

    // month donut
    const monthRows = records.filter((r) => r.date.startsWith(Utils.todayStr().slice(0, 7)) && r.status !== "Weekend");
    Utils.drawDonutChart(document.getElementById("monthDonut"), donutSegments(monthRows), {
      centerLabel: monthRows.length ? Math.round((monthRows.filter(r=>r.status==="Present"||r.status==="Late").length / monthRows.length) * 100) + "%" : "—",
      centerSub: "attendance",
    });

    // 14-day hours trend
    const last14 = lastNDays(records, 14);
    Utils.drawLineChart(
      document.getElementById("hoursTrendChart"),
      last14.map((r) => r.date.slice(8)),
      last14.map((r) => r.workingHours || 0)
    );
  }

  function liveWorkedHours(punchInStr) {
    const [time, ampm] = punchInStr.split(" ");
    let [h, m] = time.split(":").map(Number);
    if (ampm === "PM" && h !== 12) h += 12;
    if (ampm === "AM" && h === 12) h = 0;
    const punchIn = new Date();
    punchIn.setHours(h, m, 0, 0);
    const diffMs = Date.now() - punchIn.getTime();
    return Math.max(0, diffMs / 3600000);
  }
  setInterval(() => {
    const today = recordsByDate[Utils.todayStr()];
    if (today?.punchIn && !today?.punchOut && document.getElementById("view-overview").classList.contains("active")) {
      const worked = liveWorkedHours(today.punchIn);
      document.getElementById("heroWorked").textContent = hoursToHM(worked);
      const pct = Math.min(100, Math.round((worked / 8) * 100));
      document.getElementById("heroProgressBar").style.width = pct + "%";
      document.getElementById("heroProgressLabel").textContent = `${pct}% of your 8h target`;
    }
  }, 30000);

  /* ------------------------------ calendar ------------------------------ */
  function renderCalendar() {
    const dowRow = document.getElementById("calDowRow");
    dowRow.innerHTML = Utils.DOW.map((d) => `<div class="cal-dow">${d}</div>`).join("");

    const y = calCursor.getFullYear(), m = calCursor.getMonth();
    document.getElementById("calMonthLabel").textContent = `${Utils.MONTHS[m]} ${y}`;
    const firstDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const grid = document.getElementById("calGrid");
    let html = "";
    for (let i = 0; i < firstDow; i++) html += `<div class="cal-day empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const rec = recordsByDate[dateStr];
      const isToday = dateStr === Utils.todayStr();
      const isFuture = dateStr > Utils.todayStr();
      const colorVar = rec && !isFuture ? Utils.statusColorVar(rec.status) : null;
      html += `<div class="cal-day${isToday ? " today" : ""}" data-date="${dateStr}" style="animation-delay:${d * 0.01}s">
        <span class="d-num">${d}</span>
        ${colorVar ? `<span class="d-dot" style="background:var(${colorVar})"></span>` : ""}
      </div>`;
    }
    grid.innerHTML = html;
    grid.querySelectorAll(".cal-day[data-date]").forEach((el) => {
      el.addEventListener("click", () => showDayDetail(el.dataset.date));
    });
  }
  document.getElementById("calPrev").addEventListener("click", () => { calCursor.setMonth(calCursor.getMonth() - 1); renderCalendar(); });
  document.getElementById("calNext").addEventListener("click", () => { calCursor.setMonth(calCursor.getMonth() + 1); renderCalendar(); });

  function showDayDetail(dateStr) {
    const rec = recordsByDate[dateStr];
    const body = document.getElementById("dayDetailBody");
    if (!rec || rec.date > Utils.todayStr()) {
      body.innerHTML = `<p style="color:var(--muted)">No record for ${Utils.fmtShortDate(dateStr)} yet.</p>`;
      return;
    }
    body.innerHTML = `
      <div style="margin-bottom:14px;">
        <span class="badge badge-${slug(rec.status)}">${rec.status}</span>
        <div style="margin-top:8px;font-weight:600;">${Utils.fmtLongDate(rec.date)}</div>
      </div>
      <div class="two-col-info">
        <div class="info-item"><span>Punch in</span><b class="mono">${rec.punchIn || "—"}</b></div>
        <div class="info-item"><span>Punch out</span><b class="mono">${rec.punchOut || "—"}</b></div>
        <div class="info-item"><span>Working hours</span><b class="mono">${rec.workingHours ? rec.workingHours.toFixed(2) + "h" : "—"}</b></div>
        <div class="info-item"><span>Late by</span><b class="mono">${rec.lateBy ? rec.lateBy + " min" : "—"}</b></div>
      </div>`;
  }

  /* ------------------------------ statistics ------------------------------ */
  function monthOptions() {
    const months = [...new Set(records.map((r) => r.date.slice(0, 7)))].sort().reverse();
    return months;
  }
  function populateStatsMonths() {
    const sel = document.getElementById("statsMonthSelect");
    if (sel.options.length) return;
    monthOptions().forEach((ym) => {
      const [y, m] = ym.split("-");
      const opt = document.createElement("option");
      opt.value = ym;
      opt.textContent = `${Utils.MONTHS[+m - 1]} ${y}`;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", () => renderStats());
  }

  function renderStats(chartsOnly) {
    populateStatsMonths();
    const sel = document.getElementById("statsMonthSelect");
    const ym = sel.value || sel.options[0]?.value || Utils.todayStr().slice(0, 7);
    sel.value = ym;
    const monthRows = records.filter((r) => r.date.startsWith(ym));
    const workRows = monthRows.filter((r) => r.status !== "Weekend");

    if (!chartsOnly) {
      const present = workRows.filter((r) => r.status === "Present").length;
      const late = workRows.filter((r) => r.status === "Late").length;
      const absent = workRows.filter((r) => r.status === "Absent").length;
      const totalHours = sum(workRows.map((r) => r.workingHours || 0));
      document.getElementById("statsSummaryRow").innerHTML = [
        statCard("Present days", present, "ok", iconCheck()),
        statCard("Late days", late, "warn", iconClock()),
        statCard("Absent days", absent, "danger", iconX()),
        statCard("Total hours logged", totalHours.toFixed(1) + "h", "info", iconBar()),
      ].join("");
      document.querySelectorAll("#statsSummaryRow .val[data-count]").forEach((el) => {
        Utils.countUp(el, +el.dataset.count, { suffix: el.dataset.suffix || "" });
      });
    }

    Utils.drawBarChart(
      document.getElementById("statsBarChart"),
      workRows.map((r) => r.date.slice(8)),
      workRows.map((r) => r.workingHours || 0)
    );
    Utils.drawDonutChart(document.getElementById("statsDonutChart"), donutSegments(workRows), {
      centerLabel: workRows.length ? Math.round((workRows.filter(r=>r.status==="Present"||r.status==="Late").length / workRows.length) * 100) + "%" : "—",
      centerSub: "attendance",
    });
  }

  /* ------------------------------ history ------------------------------ */
  function renderHistory() {
    const searchEl = document.getElementById("historySearch");
    const statusEl = document.getElementById("historyStatusFilter");
    const fromEl = document.getElementById("historyFrom");
    const toEl = document.getElementById("historyTo");
    [searchEl, statusEl, fromEl, toEl].forEach((el) => el.addEventListener("input", () => { historyPage = 1; draw(); }));
    document.getElementById("exportHistoryBtn").addEventListener("click", () => {
      Utils.downloadCSV(`${employee.empCode}-attendance.csv`, filteredRows());
      Utils.toast("Attendance history exported.");
    });

    function filteredRows() {
      const q = searchEl.value.trim().toLowerCase();
      return [...records].reverse().filter((r) => {
        if (r.status === "Weekend" && !statusEl.value) return false;
        if (statusEl.value && r.status !== statusEl.value) return false;
        if (fromEl.value && r.date < fromEl.value) return false;
        if (toEl.value && r.date > toEl.value) return false;
        if (q && !(r.date.includes(q) || r.status.toLowerCase().includes(q))) return false;
        return true;
      });
    }

    function draw() {
      const rows = filteredRows();
      const totalPages = Math.max(1, Math.ceil(rows.length / HISTORY_PAGE_SIZE));
      historyPage = Math.min(historyPage, totalPages);
      const pageRows = rows.slice((historyPage - 1) * HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE);

      document.getElementById("historyTableBody").innerHTML = pageRows.map((r) => `
        <tr>
          <td data-label="Date">${Utils.fmtShortDate(r.date)}</td>
          <td data-label="Status"><span class="badge badge-${slug(r.status)}">${r.status}</span></td>
          <td data-label="Punch In" class="mono">${r.punchIn || "—"}</td>
          <td data-label="Punch Out" class="mono">${r.punchOut || "—"}</td>
          <td data-label="Working hours" class="mono">${r.workingHours ? r.workingHours.toFixed(2) + "h" : "—"}</td>
          <td data-label="Late by" class="mono">${r.lateBy ? r.lateBy + " min" : "—"}</td>
        </tr>`).join("") || `<tr><td colspan="6">${emptyRow("No records match your filters.")}</td></tr>`;

      document.getElementById("historyPagination").innerHTML = `
        <span>${rows.length} record${rows.length === 1 ? "" : "s"} · page ${historyPage} of ${totalPages}</span>
        <div class="pg-btns">
          <button class="pg-btn" id="hpPrev" ${historyPage === 1 ? "disabled" : ""}>‹</button>
          <button class="pg-btn" id="hpNext" ${historyPage === totalPages ? "disabled" : ""}>›</button>
        </div>`;
      const prevBtn = document.getElementById("hpPrev"), nextBtn = document.getElementById("hpNext");
      if (prevBtn) prevBtn.addEventListener("click", () => { historyPage--; draw(); });
      if (nextBtn) nextBtn.addEventListener("click", () => { historyPage++; draw(); });
    }
    draw();
  }

  /* ------------------------------ profile ------------------------------ */
  function renderProfile(chartsOnly) {
    if (!chartsOnly) {
      document.getElementById("profAvatar").textContent = Utils.initials(employee.name);
      document.getElementById("profName").textContent = employee.name;
      document.getElementById("profDesig").textContent = `${employee.designation} · ${employee.department}`;
      document.getElementById("profInfoGrid").innerHTML = [
        ["Employee ID", employee.empCode],
        ["Email", employee.email],
        ["Phone", employee.phone],
        ["Department", employee.department],
        ["Designation", employee.designation],
        ["Date of joining", Utils.fmtShortDate(employee.dateOfJoining)],
        ["Shift", `${to12h(employee.shiftStart)} – ${to12h(employee.shiftEnd)}`],
        ["Status", employee.status],
      ].map(([k, v]) => `<div class="info-item"><span>${k}</span><b>${v}</b></div>`).join("");
    }
    const rows = records.filter((r) => r.status !== "Weekend");
    Utils.drawDonutChart(document.getElementById("profileDonut"), donutSegments(rows), {
      centerLabel: rows.length ? Math.round((rows.filter(r=>r.status==="Present"||r.status==="Late").length / rows.length) * 100) + "%" : "—",
      centerSub: "present rate",
    });
  }

  /* ------------------------------ helpers ------------------------------ */
  function donutSegments(rows) {
    const c = { Present: 0, Late: 0, Absent: 0, "Half Day": 0, "On Leave": 0 };
    rows.forEach((r) => { if (c[r.status] !== undefined) c[r.status]++; });
    return [
      { value: c.Present, color: cssv("--ok") },
      { value: c.Late, color: cssv("--warn") },
      { value: c.Absent, color: cssv("--danger") },
      { value: c["Half Day"] + c["On Leave"], color: cssv("--info") },
    ];
  }
  function cssv(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function lastNDays(rows, n) { return rows.slice(-n); }
  function average(arr) { return arr.length ? sum(arr) / arr.length : 0; }
  function sum(arr) { return arr.reduce((a, b) => a + b, 0); }
  function slug(status) { return status.toLowerCase().replace(/\s+/g, ""); }
  function hoursToHM(h) { const hh = Math.floor(h); const mm = Math.round((h - hh) * 60); return `${hh}h ${mm}m`; }
  function to12h(t) {
    let [h, m] = t.split(":").map(Number);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${String(h12).padStart(2,"0")}:${String(m).padStart(2,"0")} ${ampm}`;
  }
  function emptyRow(msg) { return `<div class="empty-state">${msg}</div>`; }
  function leaveRingCard(label, total, used, emphasize) {
    const remaining = total - used;
    const pct = total ? used / total : 0;
    const circumference = 2 * Math.PI * 34;
    const offset = circumference * (1 - pct);
    return `<div class="card leave-bal-card"${emphasize ? ' style="border-color:var(--accent);"' : ""}>
      <div class="leave-bal-ring">
        <svg width="84" height="84" viewBox="0 0 84 84">
          <circle class="track" cx="42" cy="42" r="34"/>
          <circle class="fill" cx="42" cy="42" r="34" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"/>
        </svg>
        <span class="lbl">${remaining}</span>
      </div>
      <div style="font-weight:600;font-size:13.5px;">${label}</div>
      <div style="color:var(--muted);font-size:12px;">${used} used of ${total} days</div>
    </div>`;
  }
  function statCard(label, value, tone, icon, tag) {
    const isNumber = typeof value === "number";
    return `<div class="card stat-card">
      <div class="icon-badge" style="background:var(--${tone}-bg);color:var(--${tone});">${icon}</div>
      <div class="val mono" ${isNumber ? `data-count="${value}"` : ""}>${isNumber ? "0" : value}</div>
      <div class="lbl">${label}${tag ? ` · ${tag}` : ""}</div>
    </div>`;
  }
  function iconCheck() { return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>`; }
  function iconClock() { return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`; }
  function iconX() { return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>`; }
  function iconBar() { return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 20V10M10 20V4M17 20v-7"/></svg>`; }
})();
