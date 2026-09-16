/* =========================================================================
   admin.js — powers admin.html
   ========================================================================= */

(async function () {
  const user = Session.guard("admin");
  if (!user) return;
  if (!Utils.checkLiveConfig()) return;

  let employees = [];
  let allRecords = [];        // every employee, every day
  let recordsByEmp = {};      // empId -> [records]
  let todayRecords = [];      // today's rows only (working days)
  let deptList = [];
  let empPage = 1, repPage = 1;
  let drawEmpTable = () => {};
  let currentReportRows = () => [];
  let currentAdminReqFilter = "Pending";
  const PAGE_SIZE = 10;

  /* --------------------------- shell wiring --------------------------- */
  document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
    item.addEventListener("click", (e) => { e.preventDefault(); switchView(item.dataset.view); });
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
    e.preventDefault(); Session.clear(); window.location.href = "index.html";
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
    Utils.toast("Need help? Check the Reports and Requests pages, or contact support@simplyconnect.com.");
  });
  document.getElementById("topAvatarBtn").addEventListener("click", () => switchView("settings"));
  document.addEventListener("themechange", () => { renderOverviewCharts(); });

  function tickClock() {
    const t = new Date().toLocaleTimeString("en-US", { hour12: false });
    ["topClock", "heroClockAdmin"].forEach((id) => { const el = document.getElementById(id); if (el) el.textContent = t; });
  }
  tickClock();
  setInterval(tickClock, 1000);

  document.getElementById("sideAvatar").textContent = "AD";
  document.getElementById("topAvatarBtn").textContent = "AD";
  document.getElementById("sideName").textContent = user.name;
  document.getElementById("todayLongDate").textContent = Utils.fmtLongDate(Utils.todayStr());
  document.getElementById("liveDateLabel").textContent = Utils.fmtLongDate(Utils.todayStr());

  /* ------------------------------- load --------------------------------- */
  try {
    [employees, allRecords] = await Promise.all([
      DataService.fetchEmployees(),
      DataService.fetchAttendance({}),
    ]);
  } catch (err) {
    Utils.toast("Failed to load data: " + err.message, "error", 5000);
    return;
  }
  recordsByEmp = {};
  employees.forEach((e) => (recordsByEmp[e.id] = []));
  allRecords.forEach((r) => { (recordsByEmp[r.empId] ||= []).push(r); });
  todayRecords = allRecords.filter((r) => r.date === Utils.todayStr() && r.status !== "Weekend");
  deptList = [...new Set(employees.map((e) => e.department))].sort();

  ["empDeptFilter", "repDept"].forEach((id) => {
    const sel = document.getElementById(id);
    deptList.forEach((d) => { const o = document.createElement("option"); o.textContent = d; sel.appendChild(o); });
  });

  // See employee.js for why this is wrapped: without it, one throwing
  // section (most often a chart drawn before its canvas has a real size)
  // silently stops every render call listed after it.
  function safeRender(name, fn) {
    try { fn(); } catch (err) { console.error(`[admin.js] ${name} failed:`, err); }
  }
  safeRender("renderOverview", renderOverview);
  safeRender("renderEmployees", renderEmployees);
  safeRender("renderLive", renderLive);
  safeRender("renderDepartments", renderDepartments);
  safeRender("renderReportsShell", renderReportsShell);
  safeRender("renderSync", renderSync);
  safeRender("renderRequests", renderRequests);
  safeRender("renderPayroll", renderPayroll);
  safeRender("renderSettings", renderSettings);
  safeRender("startLiveFeedSimulation", startLiveFeedSimulation);
  safeRender("refreshNotifDot", refreshNotifDot);
  window.addEventListener("resize", Utils.debounce(renderOverviewCharts, 200));

  /* ------------------------------ notifications ------------------------------ */
  async function refreshNotifDot() {
    try {
      const rows = await DataService.fetchNotifications("admin", null);
      document.getElementById("notifDot").classList.toggle("hidden", !rows.some((n) => !n.read));
    } catch { /* non-critical */ }
  }
  async function loadNotifications() {
    const rows = await DataService.fetchNotifications("admin", null);
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
    await DataService.markNotificationsRead("admin", null);
    loadNotifications();
    Utils.toast("All notifications marked as read.");
  });
  setInterval(refreshNotifDot, APP_CONFIG.NOTIF_POLL_INTERVAL_MS);

  /* ------------------------------ overview ------------------------------ */
  function empById(id) { return employees.find((e) => e.id === id); }

  function renderOverview() {
    const total = employees.length;
    const present = todayRecords.filter((r) => r.status === "Present").length;
    const late = todayRecords.filter((r) => r.status === "Late").length;
    const absent = todayRecords.filter((r) => r.status === "Absent").length;
    const leave = todayRecords.filter((r) => r.status === "On Leave" || r.status === "Half Day").length;

    document.getElementById("kpiRow").innerHTML = [
      kpi("Total employees", total, "info", iconUsers()),
      kpi("Present today", present, "ok", iconCheck(), pct(present, total)),
      kpi("Late today", late, "warn", iconClock(), pct(late, total)),
      kpi("Absent today", absent, "danger", iconX(), pct(absent, total)),
    ].join("");
    document.querySelectorAll("#kpiRow .val[data-count]").forEach((el) => Utils.countUp(el, +el.dataset.count));

    // department mini row (today)
    document.getElementById("deptMiniRow").innerHTML = deptList.slice(0, 6).map((d) => {
      const deptEmps = employees.filter((e) => e.department === d);
      const deptToday = todayRecords.filter((r) => empById(r.empId)?.department === d);
      const p = deptToday.filter((r) => r.status === "Present" || r.status === "Late").length;
      const rate = deptEmps.length ? Math.round((p / deptEmps.length) * 100) : 0;
      return `<div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:6px;">
          <span>${d}</span><b class="mono">${rate}%</b>
        </div>
        <div class="progress-bar"><i style="width:${rate}%"></i></div>
      </div>`;
    }).join("");

    document.getElementById("miniLiveFeed").innerHTML = buildFeedItems(6);
    renderOverviewCharts();
  }

  function renderOverviewCharts() {
    // 14-day company-wide trend: % present+late of active employees
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
      days.push(ds);
    }
    const rates = days.map((ds) => {
      const rows = allRecords.filter((r) => r.date === ds && r.status !== "Weekend");
      if (!rows.length) return 0;
      return Math.round((rows.filter((r) => r.status === "Present" || r.status === "Late").length / rows.length) * 100);
    });
    Utils.drawLineChart(document.getElementById("trendChart"), days.map((d) => d.slice(8)), rates, { showLabels: true });

    const c = { Present: 0, Late: 0, Absent: 0, Other: 0 };
    todayRecords.forEach((r) => {
      if (r.status === "Present") c.Present++;
      else if (r.status === "Late") c.Late++;
      else if (r.status === "Absent") c.Absent++;
      else c.Other++;
    });
    Utils.drawDonutChart(document.getElementById("todayDonut"), [
      { value: c.Present, color: cssv("--ok") },
      { value: c.Late, color: cssv("--warn") },
      { value: c.Absent, color: cssv("--danger") },
      { value: c.Other, color: cssv("--info") },
    ], { centerLabel: employees.length ? Math.round(((c.Present+c.Late)/employees.length)*100)+"%" : "—", centerSub: "present" });
  }

  function buildFeedItems(n) {
    const rows = [...todayRecords].filter((r) => r.punchIn).sort((a, b) => (b._t || 0) - (a._t || 0)).slice(0, n);
    if (!rows.length) return `<div class="empty-state">No punches recorded yet today.</div>`;
    return rows.map((r) => {
      const e = empById(r.empId);
      return `<div class="live-feed-item">
        <div class="avatar" style="width:30px;height:30px;font-size:11px;">${Utils.initials(e?.name || "??")}</div>
        <div style="flex:1;">
          <div style="font-size:13px;font-weight:600;">${e?.name || "Unknown"}</div>
          <div style="font-size:11.5px;color:var(--muted);">${e?.department || ""}</div>
        </div>
        <div style="text-align:right;">
          <span class="badge badge-${r.status.toLowerCase().replace(/\s+/g,"")}">${r.status}</span>
          <div class="mono" style="font-size:11px;color:var(--muted);margin-top:3px;">${r.punchIn}</div>
        </div>
      </div>`;
    }).join("");
  }

  function startLiveFeedSimulation() {
    // Purely cosmetic "live" feel for the demo: periodically re-render the
    // feed list and nudge the sync badge, standing in for a websocket/poll
    // from the biometric middleware described in config.js.
    setInterval(() => {
      if (document.getElementById("view-overview").classList.contains("active")) {
        document.getElementById("miniLiveFeed").innerHTML = buildFeedItems(6);
      }
      if (document.getElementById("view-live").classList.contains("active")) {
        renderLiveTable();
      }
    }, 12000);
  }

  /* ------------------------------ employees ------------------------------ */
  function renderEmployees() {
    const search = document.getElementById("empSearch");
    const deptSel = document.getElementById("empDeptFilter");
    const statusSel = document.getElementById("empStatusFilter");
    [search, deptSel, statusSel].forEach((el) => el.addEventListener("input", () => { empPage = 1; drawEmpTable(); }));
    document.getElementById("exportEmpBtn").addEventListener("click", () => {
      Utils.downloadCSV("employees.csv", filteredEmployees().map((e) => ({
        EmployeeID: e.empCode, Name: e.name, Email: e.email, Department: e.department,
        Designation: e.designation, Status: e.status, DateOfJoining: e.dateOfJoining,
      })));
      Utils.toast("Employee list exported.");
    });
    document.getElementById("addEmpBtn").addEventListener("click", openAddEmployeeModal);

    function filteredEmployees() {
      const q = search.value.trim().toLowerCase();
      return employees.filter((e) => {
        if (deptSel.value && e.department !== deptSel.value) return false;
        if (statusSel.value && e.status !== statusSel.value) return false;
        if (q && !(e.name.toLowerCase().includes(q) || e.empCode.toLowerCase().includes(q) || e.email.toLowerCase().includes(q))) return false;
        return true;
      });
    }
    window.__drawEmpTable = drawEmpTable = function drawEmpTable() {
      const rows = filteredEmployees();
      const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
      empPage = Math.min(empPage, totalPages);
      const pageRows = rows.slice((empPage - 1) * PAGE_SIZE, empPage * PAGE_SIZE);

      document.getElementById("empTableBody").innerHTML = pageRows.map((e) => `
        <tr data-emp="${e.id}">
          <td data-label="Employee"><div class="row-name">
            <div class="avatar" style="background:hsl(${e.hue},60%,45%)">${e.initials}</div>
            <div class="meta"><b>${e.name}</b><span>${e.empCode}</span></div>
          </div></td>
          <td data-label="Department">${e.department}</td>
          <td data-label="Designation">${e.designation}</td>
          <td data-label="Status"><span class="badge badge-${e.status === "Active" ? "present" : "inactive"}">${e.status}</span></td>
          <td data-label="Joined">${Utils.fmtShortDate(e.dateOfJoining)}</td>
          <td data-label=""><button class="btn-icon view-emp-btn" data-emp="${e.id}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg></button></td>
        </tr>`).join("") || `<tr><td colspan="6">${emptyRow("No employees match your filters.")}</td></tr>`;

      document.getElementById("empPagination").innerHTML = `
        <span>${rows.length} employee${rows.length===1?"":"s"} · page ${empPage} of ${totalPages}</span>
        <div class="pg-btns">
          <button class="pg-btn" id="epPrev" ${empPage===1?"disabled":""}>‹</button>
          <button class="pg-btn" id="epNext" ${empPage===totalPages?"disabled":""}>›</button>
        </div>`;
      const p = document.getElementById("epPrev"), n = document.getElementById("epNext");
      if (p) p.addEventListener("click", () => { empPage--; drawEmpTable(); });
      if (n) n.addEventListener("click", () => { empPage++; drawEmpTable(); });

      document.querySelectorAll(".view-emp-btn").forEach((b) => b.addEventListener("click", () => openEmpDrawer(b.dataset.emp)));
      document.querySelectorAll("#empTableBody tr[data-emp]").forEach((tr) => tr.addEventListener("click", (e) => {
        if (!e.target.closest(".view-emp-btn")) openEmpDrawer(tr.dataset.emp);
      }));
    };
    drawEmpTable();
  }

  function openEmpDrawer(empId) {
    const e = empById(empId);
    const rows = (recordsByEmp[empId] || []).filter((r) => r.status !== "Weekend");
    const last30 = rows.slice(-30);
    const present = last30.filter((r) => r.status === "Present").length;
    const late = last30.filter((r) => r.status === "Late").length;
    const absent = last30.filter((r) => r.status === "Absent").length;
    const avgHours = last30.filter(r=>r.workingHours).length ? (sum(last30.map(r=>r.workingHours||0)) / last30.filter(r=>r.workingHours).length) : 0;
    const recent = [...rows].slice(-8).reverse();

    document.getElementById("empDrawerBody").innerHTML = `
      <div class="profile-head" style="margin-bottom:20px;">
        <div class="avatar" style="width:56px;height:56px;font-size:18px;background:hsl(${e.hue},60%,45%)">${e.initials}</div>
        <div><h3>${e.name}</h3><span>${e.designation} · ${e.department}</span></div>
      </div>
      <div class="two-col-info" style="margin-bottom:18px;">
        <div class="info-item"><span>Employee ID</span><b>${e.empCode}</b></div>
        <div class="info-item"><span>Status</span><b>${e.status}</b></div>
        <div class="info-item"><span>Email</span><b style="font-size:12px;">${e.email}</b></div>
        <div class="info-item"><span>Phone</span><b>${e.phone}</b></div>
        <div class="info-item"><span>Joined</span><b>${Utils.fmtShortDate(e.dateOfJoining)}</b></div>
        <div class="info-item"><span>Shift</span><b>${e.shiftStart}–${e.shiftEnd}</b></div>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:18px;">
        <button class="btn btn-ghost btn-sm" id="drawerEditBtn" style="flex:1;">Edit details</button>
        <button class="btn btn-sm" id="drawerStatusBtn" style="flex:1;background:${e.status === "Active" ? "var(--danger-bg)" : "var(--ok-bg)"};color:${e.status === "Active" ? "var(--danger)" : "var(--ok)"};">${e.status === "Active" ? "Deactivate" : "Reactivate"}</button>
      </div>
      <div class="divider"></div>
      <div class="card-title">Last 30 working days</div>
      <div class="grid grid-2" style="margin-bottom:18px;">
        ${miniStat("Present", present, "ok")}${miniStat("Late", late, "warn")}
        ${miniStat("Absent", absent, "danger")}${miniStat("Avg hrs", avgHours.toFixed(1)+"h", "info")}
      </div>
      <div class="card-title">Recent punches</div>
      ${recent.map((r) => `
        <div class="live-feed-item">
          <span class="badge badge-${r.status.toLowerCase().replace(/\s+/g,"")}">${r.status}</span>
          <div style="flex:1;"><div style="font-size:12.5px;">${Utils.fmtShortDate(r.date)}</div></div>
          <div class="mono" style="font-size:11.5px;color:var(--muted);">${r.punchIn || "—"} ${r.punchOut ? "→ " + r.punchOut : ""}</div>
        </div>`).join("") || emptyRow("No punches recorded.")}
    `;
    document.getElementById("empOverlay").classList.add("show");
    document.getElementById("empDrawer").classList.add("show");
    document.getElementById("drawerEditBtn").addEventListener("click", () => openEditEmployeeModal(empId));
    document.getElementById("drawerStatusBtn").addEventListener("click", async () => {
      const newStatus = e.status === "Active" ? "Inactive" : "Active";
      const ok = await Utils.confirmDialog(`${newStatus === "Inactive" ? "Deactivate" : "Reactivate"} ${e.name}? ${newStatus === "Inactive" ? "They will no longer be able to sign in." : "They will regain dashboard access."}`, { confirmLabel: newStatus === "Inactive" ? "Deactivate" : "Reactivate", tone: newStatus === "Inactive" ? "danger" : "ok" });
      if (!ok) return;
      await DataService.setEmployeeStatus(empId, newStatus);
      e.status = newStatus;
      Utils.toast(`${e.name} is now ${newStatus.toLowerCase()}.`);
      closeDrawer();
      drawEmpTable();
      renderDepartments();
    });
  }

  function employeeFormHtml(e = {}) {
    return `
      <form id="empForm">
        <div class="form-row-2">
          <div class="field"><label>Full name</label><input type="text" id="efName" value="${e.name || ""}" required></div>
          <div class="field"><label>Department</label>
            <select class="select" id="efDept" style="width:100%;">${deptList.map((d) => `<option ${e.department === d ? "selected" : ""}>${d}</option>`).join("")}</select>
          </div>
        </div>
        <div class="form-row-2">
          <div class="field"><label>Designation</label><input type="text" id="efDesig" value="${e.designation || ""}" required></div>
          <div class="field"><label>Base salary (PKR)</label><input type="number" id="efSalary" min="0" step="500" value="${e.baseSalary || 45000}" required></div>
        </div>
        <div class="form-row-2">
          <div class="field"><label>Email</label><input type="email" id="efEmail" value="${e.email || ""}" required></div>
          <div class="field"><label>Phone</label><input type="tel" id="efPhone" value="${e.phone || ""}" required></div>
        </div>
      </form>`;
  }
  function openAddEmployeeModal() {
    const overlay = Utils.openModal("Add employee", employeeFormHtml(), {
      footHtml: `<button class="btn btn-ghost btn-sm" id="efCancel">Cancel</button><button class="btn btn-primary btn-sm" id="efSave" style="width:auto;">Add employee</button>`,
    });
    overlay.querySelector("#efCancel").addEventListener("click", Utils.closeModal);
    overlay.querySelector("#efSave").addEventListener("click", async () => {
      const data = readEmployeeForm();
      if (!data) return;
      const emp = await DataService.addEmployee(data);
      employees.push(emp);
      recordsByEmp[emp.id] = [];
      Utils.closeModal();
      Utils.toast(`${emp.name} added as ${emp.empCode}.`);
      drawEmpTable();
      renderDepartments();
    });
  }
  function openEditEmployeeModal(empId) {
    const e = empById(empId);
    const overlay = Utils.openModal("Edit employee", employeeFormHtml(e), {
      footHtml: `<button class="btn btn-ghost btn-sm" id="efCancel">Cancel</button><button class="btn btn-primary btn-sm" id="efSave" style="width:auto;">Save changes</button>`,
    });
    overlay.querySelector("#efCancel").addEventListener("click", Utils.closeModal);
    overlay.querySelector("#efSave").addEventListener("click", async () => {
      const data = readEmployeeForm();
      if (!data) return;
      const updated = await DataService.updateEmployee(empId, data);
      Object.assign(e, updated);
      Utils.closeModal();
      Utils.toast("Employee details updated.");
      drawEmpTable();
      closeDrawer();
    });
  }
  function readEmployeeForm() {
    const name = document.getElementById("efName").value.trim();
    const email = document.getElementById("efEmail").value.trim();
    const phone = document.getElementById("efPhone").value.trim();
    const designation = document.getElementById("efDesig").value.trim();
    const department = document.getElementById("efDept").value;
    const baseSalary = Number(document.getElementById("efSalary").value);
    if (!name || !email || !phone || !designation) { Utils.toast("Please fill in all fields.", "error"); return null; }
    if (!/^\S+@\S+\.\S+$/.test(email)) { Utils.toast("Please enter a valid email address.", "error"); return null; }
    return { name, email, phone, designation, department, baseSalary };
  }
  function miniStat(label, val, tone) {
    return `<div class="card card-flat" style="padding:12px;background:var(--surface-2);">
      <div class="lbl" style="margin-bottom:4px;">${label}</div>
      <div class="val mono" style="font-size:18px;color:var(--${tone});">${val}</div>
    </div>`;
  }
  document.getElementById("drawerClose").addEventListener("click", closeDrawer);
  document.getElementById("empOverlay").addEventListener("click", closeDrawer);
  function closeDrawer() {
    document.getElementById("empOverlay").classList.remove("show");
    document.getElementById("empDrawer").classList.remove("show");
  }

  document.getElementById("globalSearch").addEventListener("input", Utils.debounce((e) => {
    const q = e.target.value.trim();
    if (!q) return;
    switchView("employees");
    document.getElementById("empSearch").value = q;
    document.getElementById("empSearch").dispatchEvent(new Event("input"));
  }, 300));

  /* --------------------------- live attendance --------------------------- */
  function renderLive() {
    const total = employees.length;
    const present = todayRecords.filter((r) => r.status === "Present").length;
    const late = todayRecords.filter((r) => r.status === "Late").length;
    const absent = total - todayRecords.length + todayRecords.filter(r=>r.status==="Absent").length;
    const stillIn = todayRecords.filter((r) => r.punchIn && !r.punchOut).length;
    document.getElementById("liveStatRow").innerHTML = [
      kpi("Punched in today", present + late, "ok", iconCheck()),
      kpi("Currently on premises", stillIn, "info", iconClock()),
      kpi("Late arrivals", late, "warn", iconClock()),
      kpi("Absent", absent, "danger", iconX()),
    ].join("");
    document.querySelectorAll("#liveStatRow .val[data-count]").forEach((el) => Utils.countUp(el, +el.dataset.count));

    document.getElementById("liveSearch").addEventListener("input", Utils.debounce(renderLiveTable, 200));
    document.getElementById("liveStatusFilter").addEventListener("change", renderLiveTable);
    renderLiveTable();
  }
  function renderLiveTable() {
    const q = document.getElementById("liveSearch").value.trim().toLowerCase();
    const statusVal = document.getElementById("liveStatusFilter").value;
    let rows = employees.map((e) => ({ e, r: todayRecords.find((r) => r.empId === e.id) }))
      .filter(({ e, r }) => {
        if (statusVal && (!r || r.status !== statusVal)) return false;
        if (!statusVal && !r) return false; // hide weekend/no-record noise by default
        if (q && !e.name.toLowerCase().includes(q) && !e.empCode.toLowerCase().includes(q)) return false;
        return true;
      });
    document.getElementById("liveTableBody").innerHTML = rows.slice(0, 60).map(({ e, r }) => `
      <tr>
        <td data-label="Employee"><div class="row-name">
          <div class="avatar" style="background:hsl(${e.hue},60%,45%)">${e.initials}</div>
          <div class="meta"><b>${e.name}</b><span>${e.empCode}</span></div>
        </div></td>
        <td data-label="Department">${e.department}</td>
        <td data-label="Status">${r ? `<span class="badge badge-${r.status.toLowerCase().replace(/\s+/g,"")}">${r.status}</span>` : `<span class="badge badge-absent">Absent</span>`}</td>
        <td data-label="Punch In" class="mono">${r?.punchIn || "—"}</td>
        <td data-label="Punch Out" class="mono">${r?.punchOut || (r?.punchIn ? "Still in" : "—")}</td>
        <td data-label="Working hours" class="mono">${r?.workingHours ? r.workingHours.toFixed(2)+"h" : "—"}</td>
      </tr>`).join("") || `<tr><td colspan="6">${emptyRow("No matching employees.")}</td></tr>`;
  }

  /* ------------------------------ departments ------------------------------ */
  function renderDepartments() {
    document.getElementById("deptGrid").innerHTML = deptList.map((d) => {
      const deptEmps = employees.filter((e) => e.department === d);
      const deptToday = todayRecords.filter((r) => empById(r.empId)?.department === d);
      const present = deptToday.filter((r) => r.status === "Present" || r.status === "Late").length;
      const late = deptToday.filter((r) => r.status === "Late").length;
      const rate = deptEmps.length ? Math.round((present / deptEmps.length) * 100) : 0;
      const deptRecordsAll = deptEmps.flatMap((e) => recordsByEmp[e.id] || []).filter((r) => r.workingHours);
      const avgHours = deptRecordsAll.length ? sum(deptRecordsAll.map((r) => r.workingHours)) / deptRecordsAll.length : 0;
      return `<div class="card dept-card">
        <div class="dept-card-top"><h4>${d}</h4><span>${deptEmps.length} employees</span></div>
        <div class="progress-bar"><i style="width:${rate}%"></i></div>
        <div class="dept-stats-row"><span>Present today</span><b>${present}/${deptEmps.length}</b></div>
        <div class="dept-stats-row"><span>Late today</span><b>${late}</b></div>
        <div class="dept-stats-row"><span>Avg. working hrs</span><b>${avgHours.toFixed(1)}h</b></div>
      </div>`;
    }).join("");
  }

  /* ------------------------------ reports ------------------------------ */
  function renderReportsShell() {
    const from = document.getElementById("repFrom"), to = document.getElementById("repTo");
    const d = new Date(); const past = new Date(); past.setDate(d.getDate() - 30);
    to.value = Utils.todayStr();
    from.value = `${past.getFullYear()}-${String(past.getMonth()+1).padStart(2,"0")}-${String(past.getDate()).padStart(2,"0")}`;
    document.getElementById("repGenerate").addEventListener("click", () => { repPage = 1; generateReport(); });
    document.getElementById("exportRepBtn").addEventListener("click", () => {
      Utils.downloadCSV("late-absentee-report.csv", currentReportRows().map((r) => ({
        Employee: empById(r.empId)?.name, Department: empById(r.empId)?.department,
        Date: r.date, Status: r.status, LateByMinutes: r.lateBy,
      })));
      Utils.toast("Report exported.");
    });
    generateReport();
  }
  function generateReport() {
    const from = document.getElementById("repFrom").value;
    const to = document.getElementById("repTo").value;
    const dept = document.getElementById("repDept").value;
    const rows = allRecords.filter((r) => {
      if (r.status === "Weekend") return false;
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      if (dept && empById(r.empId)?.department !== dept) return false;
      return true;
    });
    const present = rows.filter((r) => r.status === "Present").length;
    const late = rows.filter((r) => r.status === "Late").length;
    const absent = rows.filter((r) => r.status === "Absent").length;
    const avgHours = rows.filter(r=>r.workingHours).length ? sum(rows.map(r=>r.workingHours||0)) / rows.filter(r=>r.workingHours).length : 0;

    document.getElementById("repSummaryRow").innerHTML = [
      statCardSm("Present records", present, "ok"),
      statCardSm("Late records", late, "warn"),
      statCardSm("Absent records", absent, "danger"),
      statCardSm("Avg. working hrs", avgHours.toFixed(1) + "h", "info"),
    ].join("");
    document.querySelectorAll("#repSummaryRow .val[data-count]").forEach((el) => Utils.countUp(el, +el.dataset.count));

    const flagged = rows.filter((r) => r.status === "Late" || r.status === "Absent").sort((a, b) => b.date.localeCompare(a.date));
    currentReportRows = () => flagged;
    drawReportTable(flagged);
  }
  function drawReportTable(rows) {
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    repPage = Math.min(repPage, totalPages);
    const pageRows = rows.slice((repPage - 1) * PAGE_SIZE, repPage * PAGE_SIZE);
    document.getElementById("repTableBody").innerHTML = pageRows.map((r) => {
      const e = empById(r.empId);
      return `<tr>
        <td data-label="Employee"><div class="row-name">
          <div class="avatar" style="width:28px;height:28px;font-size:10.5px;background:hsl(${e?.hue||0},60%,45%)">${e?.initials||"??"}</div>
          <div class="meta"><b>${e?.name||"Unknown"}</b></div>
        </div></td>
        <td data-label="Department">${e?.department||"—"}</td>
        <td data-label="Date">${Utils.fmtShortDate(r.date)}</td>
        <td data-label="Status"><span class="badge badge-${r.status.toLowerCase()}">${r.status}</span></td>
        <td data-label="Late by" class="mono">${r.lateBy ? r.lateBy + " min" : "—"}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="5">${emptyRow("No late or absent records in this range.")}</td></tr>`;

    document.getElementById("repPagination").innerHTML = `
      <span>${rows.length} record${rows.length===1?"":"s"} · page ${repPage} of ${totalPages}</span>
      <div class="pg-btns">
        <button class="pg-btn" id="rpPrev" ${repPage===1?"disabled":""}>‹</button>
        <button class="pg-btn" id="rpNext" ${repPage===totalPages?"disabled":""}>›</button>
      </div>`;
    const p = document.getElementById("rpPrev"), n = document.getElementById("rpNext");
    if (p) p.addEventListener("click", () => { repPage--; drawReportTable(rows); });
    if (n) n.addEventListener("click", () => { repPage++; drawReportTable(rows); });
  }

  /* ------------------------------ machine sync ------------------------------ */
  async function renderSync() {
    const status = await DataService.fetchSyncStatus();
    drawSync(status);
    document.getElementById("syncNowBtn").addEventListener("click", async () => {
      const btn = document.getElementById("syncNowBtn");
      btn.classList.add("loading"); btn.disabled = true;
      try {
        await DataService.pushManualSync();
        const fresh = await DataService.fetchSyncStatus();
        drawSync(fresh);
        Utils.toast("Manual sync complete — all online terminals refreshed.");
      } catch (err) {
        Utils.toast("Sync failed: " + err.message, "error");
      } finally {
        btn.classList.remove("loading"); btn.disabled = false;
      }
    });
    setInterval(async () => {
      if (document.getElementById("view-sync").classList.contains("active")) {
        drawSync(await DataService.fetchSyncStatus());
      }
    }, APP_CONFIG.SYNC_POLL_INTERVAL_MS);
  }
  function drawSync(status) {
    document.getElementById("deviceList").innerHTML = status.devices.map((d) => `
      <div class="device-row">
        <div class="device-icon">${iconDevice()}</div>
        <div class="device-info"><b>${d.name}</b><span>${d.location} · ${d.id}</span></div>
        <div class="status-side">
          <span class="badge badge-${d.status.toLowerCase()}">${d.status}</span>
          <div class="synced-at">Synced ${relTime(d.lastSync)}</div>
        </div>
      </div>`).join("");
    document.getElementById("syncLog").innerHTML = status.log.map((l) => `
      <div class="log-item log-${l.level}">
        <span class="log-dot"></span>
        <div><div>${l.message}</div><div class="log-time">${relTime(l.time)}</div></div>
      </div>`).join("");
    const onlineCount = status.devices.filter((d) => d.status === "Online").length;
    document.getElementById("liveSyncBadge").innerHTML = `● ${onlineCount}/${status.devices.length} terminals online`;
    document.getElementById("liveSyncBadge").className = `badge ${onlineCount === status.devices.length ? "badge-online" : "badge-offline"}`;
  }
  function relTime(iso) {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins === 1) return "1 min ago";
    if (mins < 60) return `${mins} min ago`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
  }

  /* ------------------------------ requests ------------------------------ */
  async function renderRequests() {
    document.querySelectorAll("#reqTabs .request-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll("#reqTabs .request-tab").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        currentAdminReqFilter = tab.dataset.status;
        drawRequestsTable();
      });
    });
    drawRequestsTable();
  }
  async function drawRequestsTable() {
    const rows = await DataService.fetchRequests({ status: currentAdminReqFilter || undefined });
    document.getElementById("reqTableBody").innerHTML = rows.map((r) => {
      const e = empById(r.empId);
      return `<tr>
        <td data-label="Employee"><div class="row-name">
          <div class="avatar" style="width:28px;height:28px;font-size:10.5px;background:hsl(${e?.hue||0},60%,45%)">${e?.initials||"??"}</div>
          <div class="meta"><b>${e?.name||"Unknown"}</b><span>${e?.department||""}</span></div>
        </div></td>
        <td data-label="Type">${r.type}</td>
        <td data-label="Details" class="mono" style="font-size:12.5px;">${r.type === "Leave" ? `${r.leaveType} · ${Utils.fmtShortDate(r.from)} → ${Utils.fmtShortDate(r.to)}` : `${Utils.fmtShortDate(r.date)} · ${r.requestedPunchIn}–${r.requestedPunchOut}`}</td>
        <td data-label="Reason" style="max-width:200px;white-space:normal;">${r.reason}</td>
        <td data-label="Submitted">${Utils.relTime(r.createdAt)}</td>
        <td data-label="Status"><span class="badge badge-${r.status.toLowerCase()}">${r.status}</span></td>
        <td data-label="">${r.status === "Pending" ? `
          <div style="display:flex;gap:6px;">
            <button class="btn-icon req-approve" data-id="${r.id}" title="Approve" style="color:var(--ok);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg></button>
            <button class="btn-icon req-reject" data-id="${r.id}" title="Reject" style="color:var(--danger);"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
          </div>` : ""}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="7">${emptyRow("No requests in this filter.")}</td></tr>`;

    document.querySelectorAll(".req-approve").forEach((b) => b.addEventListener("click", () => decideRequest(b.dataset.id, "Approved", b)));
    document.querySelectorAll(".req-reject").forEach((b) => b.addEventListener("click", () => decideRequest(b.dataset.id, "Rejected", b)));
  }
  async function decideRequest(id, decision, sourceBtn) {
    let note = "";
    if (decision === "Rejected") {
      const overlay = Utils.openModal("Reject request", `
        <div class="field"><label>Reason for rejection (visible to the employee)</label>
        <textarea class="field-textarea" id="rejectNote" placeholder="e.g. insufficient balance, needs manager sign-off…"></textarea></div>`, {
        footHtml: `<button class="btn btn-ghost btn-sm" id="rjCancel">Cancel</button><button class="btn btn-sm" id="rjConfirm" style="background:var(--danger);color:#fff;width:auto;">Reject request</button>`,
      });
      const proceed = await new Promise((resolve) => {
        overlay.querySelector("#rjCancel").addEventListener("click", () => { Utils.closeModal(); resolve(false); });
        overlay.querySelector("#rjConfirm").addEventListener("click", () => {
          note = document.getElementById("rejectNote").value.trim();
          Utils.closeModal(); resolve(true);
        });
      });
      if (!proceed) return;
    } else {
      const ok = await Utils.confirmDialog("Approve this request? This will update the employee's leave balance or attendance record.", { confirmLabel: "Approve", tone: "ok" });
      if (!ok) return;
    }
    // Disable both buttons in this row immediately so a slow response can't
    // be double-clicked into two concurrent Accept/Reject calls for the
    // same request (which was making things feel even slower/stuck).
    const row = sourceBtn ? sourceBtn.closest("tr") : null;
    if (row) row.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      await DataService.reviewRequest(id, decision, note);
      Utils.toast(`Request ${decision.toLowerCase()}.`);
      drawRequestsTable();
      refreshNotifDot();
    } catch (err) {
      Utils.toast("Could not update request. " + err.message, "error", 5000);
      if (row) row.querySelectorAll("button").forEach((b) => (b.disabled = false));
    }
  }

  /* ------------------------------ payroll ------------------------------ */
  async function renderPayroll() {
    const sel = document.getElementById("payrollMonthSelect");
    const months = [...new Set(allRecords.map((r) => r.date.slice(0, 7)))].sort().reverse();
    months.forEach((ym) => {
      const [y, m] = ym.split("-");
      const opt = document.createElement("option");
      opt.value = ym; opt.textContent = `${Utils.MONTHS[+m - 1]} ${y}`;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", () => drawPayroll(sel.value));
    document.getElementById("payrollSearch").addEventListener("input", Utils.debounce(() => drawPayroll(sel.value), 200));
    document.getElementById("exportPayrollBtn").addEventListener("click", async () => {
      const ym = sel.value;
      const slips = await Promise.all(employees.filter((e) => e.status === "Active").map((e) => DataService.fetchPayslip(e.id, ym)));
      Utils.downloadCSV(`payroll-${ym}.csv`, slips.map((s) => ({
        Employee: s.empName, Code: s.empCode, Department: s.department, Present: s.present, Absent: s.absent,
        BaseSalary: s.baseSalary, Allowances: s.allowances, Deduction: s.deduction, Gross: s.gross, Net: s.net,
      })));
      Utils.toast("Payroll exported.");
    });
    document.getElementById("generatePayrollBtn").addEventListener("click", async () => {
      const ym = sel.value;
      const [y, mo] = ym.split("-");
      const ok = await Utils.confirmDialog(`Generate and lock payroll for ${Utils.MONTHS[+mo - 1]} ${y}? This computes final numbers for every active employee — including late/absence deductions and overtime — and saves them as that month's official payslips. Running it again for the same month overwrites the previous numbers.`, { confirmLabel: "Generate payroll", tone: "ok" });
      if (!ok) return;
      const btn = document.getElementById("generatePayrollBtn");
      btn.classList.add("loading"); btn.disabled = true;
      try {
        const result = await DataService.generatePayroll(ym);
        Utils.toast(`Payroll finalized for ${result.count} employees.`);
        drawPayroll(ym);
      } catch (err) {
        Utils.toast("Couldn't generate payroll: " + err.message, "error");
      } finally {
        btn.classList.remove("loading"); btn.disabled = false;
      }
    });
    drawPayroll(months[0]);
  }
  async function drawPayroll(ym) {
    if (!ym) return;
    const summary = await DataService.fetchPayrollSummary(ym);
    document.getElementById("payrollSummaryRow").innerHTML = [
      statCardSm("Employees paid", summary.headcount, "info"),
      statCardSm("Total gross", Utils.fmtCurrency(summary.totalGross), "ok"),
      statCardSm("Total deductions", Utils.fmtCurrency(summary.totalDeductions), "danger"),
      statCardSm("Total net payout", Utils.fmtCurrency(summary.totalNet), "warn"),
    ].join("");
    document.querySelectorAll("#payrollSummaryRow .val[data-count]").forEach((el) => Utils.countUp(el, +el.dataset.count));

    const q = document.getElementById("payrollSearch").value.trim().toLowerCase();
    const active = employees.filter((e) => e.status === "Active" && (!q || e.name.toLowerCase().includes(q) || e.empCode.toLowerCase().includes(q)));
    const slips = await Promise.all(active.slice(0, 60).map((e) => DataService.fetchPayslip(e.id, ym)));
    document.getElementById("payrollTableBody").innerHTML = slips.map((s) => {
      const e = empById(s.empId ?? active.find((a) => a.empCode === s.empCode)?.id);
      return `<tr>
        <td data-label="Employee"><div class="row-name">
          <div class="avatar" style="width:28px;height:28px;font-size:10.5px;background:hsl(${e?.hue||0},60%,45%)">${e?.initials||"??"}</div>
          <div class="meta"><b>${s.empName}</b><span>${s.empCode}</span></div>
        </div></td>
        <td data-label="Department">${s.department}</td>
        <td data-label="Present" class="mono">${s.present}</td>
        <td data-label="Absent" class="mono">${s.absent}</td>
        <td data-label="Gross" class="mono">${Utils.fmtCurrency(s.gross)}</td>
        <td data-label="Deductions" class="mono">-${Utils.fmtCurrency(s.deduction)}</td>
        <td data-label="Net pay" class="mono" style="font-weight:700;">${Utils.fmtCurrency(s.net)}</td>
        <td data-label="Status"><span class="badge badge-${s.status === "Finalized" ? "approved" : "pending"}">${s.status === "Finalized" ? "Finalized" : "Live"}</span></td>
        <td data-label=""><button class="btn-icon view-payslip-btn" data-emp="${e?.id}" data-ym="${ym}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg></button></td>
      </tr>`;
    }).join("") || `<tr><td colspan="9">${emptyRow("No employees match your search.")}</td></tr>`;

    document.querySelectorAll(".view-payslip-btn").forEach((b) => b.addEventListener("click", () => showPayslipModal(b.dataset.emp, b.dataset.ym)));
  }
  async function showPayslipModal(empId, ym) {
    const s = await DataService.fetchPayslip(empId, ym);
    const [y, m] = ym.split("-");
    Utils.openModal(`Payslip — ${s.empName}`, `
      <div class="payslip-card" style="border:none;">
        <div class="payslip-head" style="border-radius:var(--radius-md);">
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="logo-chip" style="padding:5px 8px;"><img src="assets/logo.png" alt="Simply Connect" style="height:15px;width:auto;display:block;"></div>
            <div>
              <div style="font-size:12px;color:#B9C0DA;margin-bottom:4px;">${Utils.MONTHS[+m-1]} ${y} ${s.status === "Finalized" ? "· Finalized" : "· Live preview"}</div>
              <h3 style="font-size:17px;">${s.empName}</h3>
              <div style="font-size:12px;color:#B9C0DA;margin-top:4px;">${s.empCode} · ${s.department}</div>
            </div>
          </div>
          <div class="ps-net"><span>Net pay</span><b>${Utils.fmtCurrency(s.net)}</b></div>
        </div>
        <div class="payslip-body" style="padding:18px 0 0;">
          <div class="ps-line"><span>Base salary</span><b>${Utils.fmtCurrency(s.baseSalary)}</b></div>
          <div class="ps-line"><span>Allowances</span><b>${Utils.fmtCurrency(s.allowances)}</b></div>
          ${s.overtimeHours ? `<div class="ps-line"><span>Overtime (${s.overtimeHours}h)</span><b>${Utils.fmtCurrency(s.overtimeAmount)}</b></div>` : ""}
          <div class="ps-line"><span>Deductions (${s.absent} absent, ${s.late} late${s.lateDeductionDays ? ` → ${s.lateDeductionDays}d` : ""}, ${s.halfDays} half-day)</span><b>-${Utils.fmtCurrency(s.deduction)}</b></div>
          <div class="ps-line total"><span>Net pay</span><b>${Utils.fmtCurrency(s.net)}</b></div>
        </div>
      </div>`, { wide: true, footHtml: `<button class="btn btn-primary btn-sm" id="psClose" style="width:auto;">Close</button>` });
    document.getElementById("psClose").addEventListener("click", Utils.closeModal);
  }

  /* ------------------------------ settings ------------------------------ */
  function renderSettings() {
    document.getElementById("setCompanyName").value = APP_CONFIG.COMPANY_NAME;
    document.getElementById("setShiftStart").value = APP_CONFIG.SHIFT_START;
    document.getElementById("setShiftEnd").value = APP_CONFIG.SHIFT_END;
    document.getElementById("setGrace").value = APP_CONFIG.LATE_GRACE_MINUTES;
    document.getElementById("adminSettingsForm").addEventListener("submit", (e) => {
      e.preventDefault();
      APP_CONFIG.COMPANY_NAME = document.getElementById("setCompanyName").value.trim() || APP_CONFIG.COMPANY_NAME;
      APP_CONFIG.SHIFT_START = document.getElementById("setShiftStart").value || APP_CONFIG.SHIFT_START;
      APP_CONFIG.SHIFT_END = document.getElementById("setShiftEnd").value || APP_CONFIG.SHIFT_END;
      APP_CONFIG.LATE_GRACE_MINUTES = Number(document.getElementById("setGrace").value) || APP_CONFIG.LATE_GRACE_MINUTES;
      document.querySelectorAll(".tb-company-pill").forEach((el) => { el.firstChild.textContent = APP_CONFIG.COMPANY_NAME + " "; });
      Utils.toast("Settings saved. New shift defaults apply to future attendance calculations.");
    });
    document.getElementById("resetDemoBtn").addEventListener("click", async () => {
      const ok = await Utils.confirmDialog("This clears all demo data on this device — every added or edited employee, request, and approval — and reloads with the original 152-employee sample dataset. This can't be undone.", { confirmLabel: "Reset everything", tone: "danger" });
      if (!ok) return;
      await DataService.resetDemoData();
      Session.clear();
      window.location.href = "index.html";
    });
  }

  /* ------------------------------ shared helpers ------------------------------ */
  function cssv(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function sum(arr) { return arr.reduce((a, b) => a + b, 0); }
  function pct(part, total) { return total ? Math.round((part / total) * 100) + "% of total" : ""; }
  function emptyRow(msg) { return `<div class="empty-state">${msg}</div>`; }
  function kpi(label, value, tone, icon, sub) {
    return `<div class="card stat-card">
      <div class="icon-badge" style="background:var(--${tone}-bg);color:var(--${tone});">${icon}</div>
      <div class="val mono" data-count="${value}">0</div>
      <div class="lbl">${label}</div>
      ${sub ? `<span class="delta delta-up" style="width:fit-content;">${sub}</span>` : ""}
    </div>`;
  }
  function statCardSm(label, value, tone) {
    const isNum = typeof value === "number";
    return `<div class="card stat-card">
      <div class="val mono" ${isNum ? `data-count="${value}"` : ""}>${isNum ? 0 : value}</div>
      <div class="lbl">${label}</div>
    </div>`;
  }
  function iconUsers() { return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>`; }
  function iconCheck() { return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>`; }
  function iconClock() { return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`; }
  function iconX() { return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>`; }
  function iconDevice() { return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 18h.01"/></svg>`; }
})();
