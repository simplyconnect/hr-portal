/* =========================================================================
   mockData.js
   Generates a realistic 150+ employee dataset with ~90 days of attendance,
   leave balances, sample requests, and notifications, so the whole product
   can be demoed without live connections. Swap USE_MOCK_DATA to false in
   config.js once real endpoints (Sheets + middleware + your HR backend)
   are ready.

   NOTE ON STATE: employee edits, new leave requests, approvals, payroll,
   etc. all work and reflect instantly across the UI, and now persist to
   this browser's localStorage (key "pp_demo_data_v2") so they survive a
   page reload — this is still a single-device, no-real-backend demo, not
   multi-user sync. Use Settings > Reset demo data (or clear that
   localStorage key) to wipe it and regenerate the original sample set.
   DataService is the seam where a real backend would take over instead.
   ========================================================================= */

const MockData = (() => {
  const FIRST_NAMES = [
    "Ahmed","Sara","Bilal","Ayesha","Hassan","Zainab","Usman","Mahnoor","Omar","Hira",
    "Ali","Fatima","Danish","Sana","Faisal","Amna","Tariq","Nida","Kashif","Rabia",
    "Adeel","Iqra","Salman","Mariam","Waqas","Sadia","Imran","Noor","Zeeshan","Alina",
    "James","Olivia","Daniel","Sophia","Ethan","Emma","Liam","Ava","Noah","Mia",
    "Lucas","Grace","Henry","Chloe","Jack","Lily","Ryan","Zara","Adam","Nadia",
  ];
  const LAST_NAMES = [
    "Khan","Malik","Siddiqui","Raza","Farooq","Sheikh","Qureshi","Iqbal","Baig","Hashmi",
    "Chaudhry","Abbasi","Rehman","Aslam","Javed","Nawaz","Butt","Anwar","Saeed","Younus",
    "Carter","Bennett","Foster","Hughes","Reid","Morgan","Cole","Powell","Reyes","Sanders",
  ];
  const DEPARTMENTS = [
    { name: "Engineering", designations: ["Software Engineer","Senior Engineer","QA Engineer","DevOps Engineer","Engineering Manager"] },
    { name: "Sales", designations: ["Sales Executive","Account Manager","Sales Lead","Business Development Exec"] },
    { name: "Marketing", designations: ["Marketing Executive","Content Strategist","SEO Specialist","Marketing Manager"] },
    { name: "Human Resources", designations: ["HR Executive","Talent Acquisition","HR Business Partner","HR Manager"] },
    { name: "Finance", designations: ["Accountant","Financial Analyst","Payroll Specialist","Finance Manager"] },
    { name: "Operations", designations: ["Operations Executive","Process Analyst","Operations Manager"] },
    { name: "Customer Support", designations: ["Support Associate","Support Team Lead","Customer Success Manager"] },
    { name: "Design", designations: ["UI/UX Designer","Product Designer","Design Lead"] },
    { name: "IT & Infrastructure", designations: ["System Administrator","Network Engineer","IT Support"] },
  ];
  const LEAVE_TYPES = Object.keys(APP_CONFIG.LEAVE_ALLOCATIONS); // ["Casual", "Sick"]
  const LEAVE_ALLOCATIONS = APP_CONFIG.LEAVE_ALLOCATIONS;

  let employees = null;
  let attendanceByEmp = null;
  let leaveBalances = null;   // empId -> { Casual: {total,used}, Sick: {...} }
  let requests = null;        // [{id, empId, type, ...}]
  let notifications = null;   // [{id, forRole, forEmpId, title, body, time, read, tone}]
  let payrollLedger = null;   // `${empId}|${ym}` -> finalized payslip snapshot
  let syncState = null;
  let nextEmpNum = 153;
  let nextReqId = 1;
  let nextNotifId = 1;

  function seededRandom(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }
  const rand = seededRandom(42);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const pad = (n) => String(n).padStart(2, "0");

  function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function isWeekend(d) { const day = d.getDay(); return day === 0 || day === 6; }
  // mins can exceed 1440 (an overnight shift's punch-out minute-of-day
  // computed as punchIn + duration) — wrap to a real wall-clock time here,
  // while callers keep using the un-wrapped value for duration math.
  function minutesToTime(mins) {
    const wrapped = ((mins % 1440) + 1440) % 1440;
    const h = Math.floor(wrapped / 60), m = Math.round(wrapped % 60);
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${pad(h12)}:${pad(m)} ${ampm}`;
  }
  function uid(prefix) { return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random()*9999)}`; }

  function buildEmployees() {
    const list = [];
    for (let i = 1; i <= 152; i++) {
      const first = pick(FIRST_NAMES), last = pick(LAST_NAMES);
      const dept = pick(DEPARTMENTS);
      const desig = pick(dept.designations);
      const empCode = `EMP${String(i).padStart(3, "0")}`;
      const joinYear = 2019 + Math.floor(rand() * 7);
      const joinMonth = 1 + Math.floor(rand() * 12);
      const joinDay = 1 + Math.floor(rand() * 27);
      list.push({
        id: empCode,
        empCode,
        name: `${first} ${last}`,
        email: `${first}.${last}${i}`.toLowerCase() + "@simplyconnect.com",
        phone: `+92 3${Math.floor(rand()*10)}${Math.floor(1000000+rand()*8999999)}`,
        department: dept.name,
        designation: desig,
        dateOfJoining: `${joinYear}-${pad(joinMonth)}-${pad(joinDay)}`,
        shiftStart: APP_CONFIG.SHIFT_START,
        shiftEnd: APP_CONFIG.SHIFT_END,
        manager: "Reporting to Dept. Lead",
        status: rand() > 0.04 ? "Active" : "Inactive",
        baseSalary: Math.round((38000 + rand() * 55000) / 500) * 500,
        initials: (first[0] + last[0]).toUpperCase(),
        hue: Math.floor(rand() * 360),
      });
    }
    return list;
  }

  function buildAttendanceForEmployee(emp, days = 95) {
    const records = [];
    const today = new Date();
    const absentBias = rand() * 0.04;
    const lateBias = 0.08 + rand() * 0.12;

    for (let i = days; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      if (d > today) continue;
      const dateStr = fmtDate(d);

      if (isWeekend(d)) {
        records.push({ empId: emp.id, date: dateStr, status: "Weekend", punchIn: null, punchOut: null, workingHours: 0, lateBy: 0 });
        continue;
      }

      const roll = rand();
      if (roll < absentBias) {
        records.push({ empId: emp.id, date: dateStr, status: "Absent", punchIn: null, punchOut: null, workingHours: 0, lateBy: 0 });
        continue;
      }
      if (roll < absentBias + 0.015) {
        records.push({ empId: emp.id, date: dateStr, status: "On Leave", punchIn: null, punchOut: null, workingHours: 0, lateBy: 0 });
        continue;
      }

      const [sh, sm] = emp.shiftStart.split(":").map(Number);
      const shiftStartMin = sh * 60 + sm;
      const isLate = roll < absentBias + 0.015 + lateBias;
      const punchInMin = isLate
        ? shiftStartMin + APP_CONFIG.LATE_GRACE_MINUTES + Math.floor(rand() * 75)
        : shiftStartMin - 20 + Math.floor(rand() * (APP_CONFIG.LATE_GRACE_MINUTES + 15));

      const isHalfDay = !isLate && rand() < 0.02;
      const workMins = isHalfDay ? 220 + rand() * 40 : 470 + rand() * 90;
      const punchOutMin = punchInMin + workMins;

      records.push({
        empId: emp.id,
        date: dateStr,
        status: isHalfDay ? "Half Day" : isLate ? "Late" : "Present",
        punchIn: minutesToTime(punchInMin),
        punchOut: i === 0 && rand() < 0.35 ? null : minutesToTime(punchOutMin),
        workingHours: i === 0 && rand() < 0.35 ? null : +(workMins / 60).toFixed(2),
        lateBy: isLate ? Math.round(punchInMin - shiftStartMin) : 0,
      });
    }
    return records;
  }

  function buildLeaveBalances() {
    const map = {};
    employees.forEach((e) => {
      map[e.id] = {};
      LEAVE_TYPES.forEach((t) => {
        const total = LEAVE_ALLOCATIONS[t];
        map[e.id][t] = { total, used: Math.min(total, Math.floor(rand() * (total * 0.6))) };
      });
    });
    return map;
  }

  function buildSeedRequests() {
    const list = [];
    const sample = employees.slice(0, 14);
    sample.forEach((e, idx) => {
      const today = new Date();
      const start = new Date(today); start.setDate(start.getDate() + 3 + idx);
      const end = new Date(start); end.setDate(end.getDate() + (idx % 3));
      const statusRoll = idx % 4;
      const status = statusRoll === 0 ? "Pending" : statusRoll === 1 ? "Approved" : statusRoll === 2 ? "Pending" : "Rejected";
      const createdAt = new Date(today); createdAt.setDate(createdAt.getDate() - (idx % 5));
      if (idx % 2 === 0) {
        list.push({
          id: uid("REQ"), type: "Leave", empId: e.id,
          leaveType: pick(LEAVE_TYPES),
          from: fmtDate(start), to: fmtDate(end),
          reason: pick(["Family function", "Medical appointment", "Personal errand", "Travelling out of city", "Not feeling well"]),
          status, createdAt: createdAt.toISOString(),
          reviewedAt: status === "Pending" ? null : new Date().toISOString(),
          reviewerNote: status === "Rejected" ? "Team is short-staffed that week — please re-apply for another date." : "",
        });
      } else {
        const dd = new Date(today); dd.setDate(dd.getDate() - (idx % 6) - 1);
        list.push({
          id: uid("REQ"), type: "Regularization", empId: e.id,
          date: fmtDate(dd),
          requestedPunchIn: "09:15 AM", requestedPunchOut: "06:20 PM",
          reason: pick(["Biometric device misread my fingerprint", "Forgot to punch in, was on-site with a client", "Network issue at the gate terminal"]),
          status, createdAt: createdAt.toISOString(),
          reviewedAt: status === "Pending" ? null : new Date().toISOString(),
          reviewerNote: status === "Rejected" ? "No supporting record found for this date." : "",
        });
      }
    });
    return list;
  }

  function buildSeedNotifications() {
    const list = [];
    const now = Date.now();
    list.push({ id: uid("NTF"), forRole: "admin", forEmpId: null, title: "Warehouse Gate terminal offline", body: "DEV-04 has been unreachable for over an hour. Punches from that gate are not syncing.", time: new Date(now - 62*60000).toISOString(), read: false, tone: "danger" });
    list.push({ id: uid("NTF"), forRole: "admin", forEmpId: null, title: "3 new leave requests pending", body: "Review and action the latest requests from the team.", time: new Date(now - 20*60000).toISOString(), read: false, tone: "warn" });
    list.push({ id: uid("NTF"), forRole: "admin", forEmpId: null, title: "Late arrivals up in Sales", body: "Sales department logged 18% more late arrivals this week vs. last.", time: new Date(now - 3*3600000).toISOString(), read: true, tone: "info" });
    employees.slice(0, 6).forEach((e, i) => {
      list.push({ id: uid("NTF"), forRole: "employee", forEmpId: e.id, title: "Attendance synced", body: "Your punches for today have synced from the Main Gate Terminal.", time: new Date(now - (i+1)*40*60000).toISOString(), read: i > 1, tone: "ok" });
    });
    return list;
  }

  const STORAGE_KEY = "pp_demo_data_v3";

  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        employees, attendanceByEmp, leaveBalances, requests, notifications, syncState, payrollLedger, nextEmpNum,
      }));
    } catch { /* storage unavailable (private mode, quota) — demo still works, just won't persist */ }
  }
  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      if (!saved.employees || !saved.attendanceByEmp) return false;
      employees = saved.employees;
      attendanceByEmp = saved.attendanceByEmp;
      leaveBalances = saved.leaveBalances;
      requests = saved.requests;
      notifications = saved.notifications;
      syncState = saved.syncState;
      payrollLedger = saved.payrollLedger || {};
      nextEmpNum = saved.nextEmpNum || 153;
      return true;
    } catch { return false; }
  }
  function resetDemoData() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    employees = null; attendanceByEmp = null; leaveBalances = null; requests = null; notifications = null; syncState = null;
    payrollLedger = null; nextEmpNum = 153;
  }

  function ensureBuilt() {
    if (!employees) {
      if (loadFromStorage()) return;
      employees = buildEmployees();
      attendanceByEmp = {};
      employees.forEach((e) => (attendanceByEmp[e.id] = buildAttendanceForEmployee(e)));
      leaveBalances = buildLeaveBalances();
      requests = buildSeedRequests();
      notifications = buildSeedNotifications();
      payrollLedger = {};
      syncState = {
        devices: [
          { id: "DEV-01", name: "Main Gate Terminal", location: "Ground Floor Lobby", status: "Online", lastSync: new Date().toISOString(), firmwareOk: true },
          { id: "DEV-02", name: "Floor 2 Terminal", location: "Engineering Wing", status: "Online", lastSync: new Date().toISOString(), firmwareOk: true },
          { id: "DEV-03", name: "Floor 3 Terminal", location: "Sales & Marketing", status: "Online", lastSync: new Date(Date.now() - 4 * 60000).toISOString(), firmwareOk: true },
          { id: "DEV-04", name: "Warehouse Gate", location: "Annex Building", status: "Offline", lastSync: new Date(Date.now() - 62 * 60000).toISOString(), firmwareOk: false },
        ],
        log: [
          { time: new Date(Date.now() - 2 * 60000).toISOString(), message: "Synced 148 punch records from Main Gate Terminal", level: "ok" },
          { time: new Date(Date.now() - 6 * 60000).toISOString(), message: "Synced 52 punch records from Floor 2 Terminal", level: "ok" },
          { time: new Date(Date.now() - 22 * 60000).toISOString(), message: "Retrying connection to Warehouse Gate (timeout)", level: "warn" },
          { time: new Date(Date.now() - 62 * 60000).toISOString(), message: "Lost connection to Warehouse Gate", level: "error" },
        ],
      };
      saveToStorage();
    }
  }

  function workingDaysInMonth(ym) {
    const [y, m] = ym.split("-").map(Number);
    const days = new Date(y, m, 0).getDate();
    let count = 0;
    for (let d = 1; d <= days; d++) { const dt = new Date(y, m - 1, d); if (!isWeekend(dt)) count++; }
    return count;
  }
  // Handles an overnight shift (e.g. 17:00 -> 02:00 = 9 hours), not just same-day ones.
  function shiftDurationHours(shiftStart, shiftEnd) {
    const [sh, sm] = shiftStart.split(":").map(Number);
    const [eh, em] = shiftEnd.split(":").map(Number);
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins <= 0) mins += 1440;
    return mins / 60;
  }
  function computeLivePayslip(empId, ym) {
    const emp = employees.find((e) => e.id === empId);
    if (!emp) throw new Error("Employee not found");
    const rows = (attendanceByEmp[empId] || []).filter((r) => r.date.startsWith(ym) && r.status !== "Weekend");
    const workDays = workingDaysInMonth(ym) || 22;
    const present = rows.filter((r) => r.status === "Present" || r.status === "Late").length;
    const absent = rows.filter((r) => r.status === "Absent").length;
    const late = rows.filter((r) => r.status === "Late").length;
    const halfDays = rows.filter((r) => r.status === "Half Day").length;
    const onLeave = rows.filter((r) => r.status === "On Leave").length;

    const perDay = emp.baseSalary / workDays;
    const shiftHours = shiftDurationHours(emp.shiftStart, emp.shiftEnd);
    const hourlyRate = perDay / shiftHours;

    const lateDeductionDays = Math.floor(late / APP_CONFIG.LATE_STRIKES_PER_DEDUCTION);
    const deductionDays = absent + lateDeductionDays + halfDays * 0.5;
    const deduction = Math.round(perDay * deductionDays);

    const overtimeHours = +rows.reduce((sum, r) => {
      const extra = (r.workingHours || 0) - shiftHours;
      return sum + (extra > 0.1 ? extra : 0);
    }, 0).toFixed(2);
    const overtimeRate = +(hourlyRate * APP_CONFIG.OVERTIME_MULTIPLIER).toFixed(2);
    const overtimeAmount = Math.round(overtimeHours * overtimeRate);

    const allowances = Math.round(emp.baseSalary * 0.08);
    const gross = emp.baseSalary + allowances + overtimeAmount;
    const net = Math.max(0, gross - deduction);

    return {
      empId, ym, empName: emp.name, empCode: emp.empCode, department: emp.department, designation: emp.designation,
      baseSalary: emp.baseSalary, allowances, overtimeHours, overtimeRate, overtimeAmount,
      deduction, gross, net, present, absent, late, lateDeductionDays, halfDays, onLeave, workDays,
      status: "Live",
    };
  }

  return {
    /* ---------------------------- employees ---------------------------- */
    getEmployees() { ensureBuilt(); return JSON.parse(JSON.stringify(employees)); },
    addEmployee(data) {
      ensureBuilt();
      const empCode = `EMP${String(nextEmpNum++).padStart(3, "0")}`;
      const emp = {
        id: empCode, empCode,
        name: data.name.trim(),
        email: data.email.trim(),
        phone: data.phone.trim(),
        department: data.department,
        designation: data.designation.trim(),
        dateOfJoining: data.dateOfJoining || fmtDate(new Date()),
        shiftStart: APP_CONFIG.SHIFT_START,
        shiftEnd: APP_CONFIG.SHIFT_END,
        manager: "Reporting to Dept. Lead",
        status: "Active",
        baseSalary: Number(data.baseSalary) || 45000,
        initials: data.name.trim().split(" ").filter(Boolean).slice(0,2).map(s=>s[0]).join("").toUpperCase(),
        hue: Math.floor(Math.random() * 360),
      };
      employees.push(emp);
      attendanceByEmp[emp.id] = [];
      leaveBalances[emp.id] = {};
      LEAVE_TYPES.forEach((t) => (leaveBalances[emp.id][t] = { total: LEAVE_ALLOCATIONS[t], used: 0 }));
      saveToStorage();
      return JSON.parse(JSON.stringify(emp));
    },
    updateEmployee(empId, patch) {
      ensureBuilt();
      const emp = employees.find((e) => e.id === empId);
      if (!emp) throw new Error("Employee not found");
      Object.assign(emp, patch);
      if (patch.name) emp.initials = patch.name.trim().split(" ").filter(Boolean).slice(0,2).map(s=>s[0]).join("").toUpperCase();
      saveToStorage();
      return JSON.parse(JSON.stringify(emp));
    },
    setEmployeeStatus(empId, status) {
      ensureBuilt();
      const emp = employees.find((e) => e.id === empId);
      if (!emp) throw new Error("Employee not found");
      emp.status = status;
      saveToStorage();
      return JSON.parse(JSON.stringify(emp));
    },
    resetDemoData() { resetDemoData(); },

    /* --------------------------- attendance ---------------------------- */
    getAttendance({ empId, from, to } = {}) {
      ensureBuilt();
      let rows = empId ? (attendanceByEmp[empId] || []) : Object.values(attendanceByEmp).flat();
      if (from) rows = rows.filter((r) => r.date >= from);
      if (to) rows = rows.filter((r) => r.date <= to);
      return JSON.parse(JSON.stringify(rows));
    },

    /* ------------------------------ leave ------------------------------- */
    getLeaveBalances(empId) {
      ensureBuilt();
      return JSON.parse(JSON.stringify(leaveBalances[empId] || {}));
    },
    getRequests({ empId, status, type } = {}) {
      ensureBuilt();
      let rows = [...requests];
      if (empId) rows = rows.filter((r) => r.empId === empId);
      if (status) rows = rows.filter((r) => r.status === status);
      if (type) rows = rows.filter((r) => r.type === type);
      return JSON.parse(JSON.stringify(rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))));
    },
    submitLeaveRequest({ empId, leaveType, from, to, reason }) {
      ensureBuilt();
      const emp = employees.find((e) => e.id === empId);
      const req = {
        id: uid("REQ"), type: "Leave", empId, leaveType, from, to, reason,
        status: "Pending", createdAt: new Date().toISOString(), reviewedAt: null, reviewerNote: "",
      };
      requests.unshift(req);
      notifications.unshift({
        id: uid("NTF"), forRole: "admin", forEmpId: null,
        title: "New leave request", body: `${emp?.name || empId} requested ${leaveType} leave from ${from} to ${to}.`,
        time: new Date().toISOString(), read: false, tone: "warn",
      });
      saveToStorage();
      return JSON.parse(JSON.stringify(req));
    },
    submitRegularizationRequest({ empId, date, requestedPunchIn, requestedPunchOut, reason }) {
      ensureBuilt();
      const emp = employees.find((e) => e.id === empId);
      const req = {
        id: uid("REQ"), type: "Regularization", empId, date, requestedPunchIn, requestedPunchOut, reason,
        status: "Pending", createdAt: new Date().toISOString(), reviewedAt: null, reviewerNote: "",
      };
      requests.unshift(req);
      notifications.unshift({
        id: uid("NTF"), forRole: "admin", forEmpId: null,
        title: "New regularization request", body: `${emp?.name || empId} requested a punch correction for ${date}.`,
        time: new Date().toISOString(), read: false, tone: "warn",
      });
      saveToStorage();
      return JSON.parse(JSON.stringify(req));
    },
    reviewRequest(requestId, decision, reviewerNote = "") {
      ensureBuilt();
      const req = requests.find((r) => r.id === requestId);
      if (!req) throw new Error("Request not found");
      req.status = decision;
      req.reviewedAt = new Date().toISOString();
      req.reviewerNote = reviewerNote;

      if (decision === "Approved" && req.type === "Leave") {
        const days = Math.max(1, Math.round((new Date(req.to) - new Date(req.from)) / 86400000) + 1);
        const bal = leaveBalances[req.empId]?.[req.leaveType];
        if (bal) bal.used = Math.min(bal.total, bal.used + days);
      }
      if (decision === "Approved" && req.type === "Regularization") {
        const rows = attendanceByEmp[req.empId] || [];
        const rec = rows.find((r) => r.date === req.date);
        if (rec) {
          rec.punchIn = req.requestedPunchIn;
          rec.punchOut = req.requestedPunchOut;
          rec.status = "Present";
          rec.lateBy = 0;
        }
      }
      const emp = employees.find((e) => e.id === req.empId);
      notifications.unshift({
        id: uid("NTF"), forRole: "employee", forEmpId: req.empId,
        title: `Your ${req.type.toLowerCase()} request was ${decision.toLowerCase()}`,
        body: reviewerNote || (decision === "Approved" ? "Approved by admin." : "Please contact HR for details."),
        time: new Date().toISOString(), read: false, tone: decision === "Approved" ? "ok" : "danger",
      });
      saveToStorage();
      return JSON.parse(JSON.stringify(req));
    },

    /* -------------------------- notifications --------------------------- */
    getNotifications(role, empId) {
      ensureBuilt();
      const rows = notifications.filter((n) => role === "admin" ? n.forRole === "admin" : n.forRole === "employee" && n.forEmpId === empId);
      return JSON.parse(JSON.stringify(rows.sort((a, b) => b.time.localeCompare(a.time))));
    },
    markNotificationsRead(role, empId, ids = null) {
      ensureBuilt();
      notifications.forEach((n) => {
        const matches = role === "admin" ? n.forRole === "admin" : n.forRole === "employee" && n.forEmpId === empId;
        if (matches && (!ids || ids.includes(n.id))) n.read = true;
      });
      saveToStorage();
      return true;
    },

    /* ------------------------------ payroll ------------------------------ */
    getPayslip(empId, ym) {
      ensureBuilt();
      const locked = payrollLedger[`${empId}|${ym}`];
      if (locked) return JSON.parse(JSON.stringify(locked));
      return computeLivePayslip(empId, ym);
    },
    getPayrollSummary(ym) {
      ensureBuilt();
      const slips = employees.filter((e) => e.status === "Active").map((e) => this.getPayslip(e.id, ym));
      return {
        headcount: slips.length,
        totalGross: slips.reduce((s, p) => s + p.gross, 0),
        totalDeductions: slips.reduce((s, p) => s + p.deduction, 0),
        totalNet: slips.reduce((s, p) => s + p.net, 0),
      };
    },
    generatePayroll(ym) {
      ensureBuilt();
      const active = employees.filter((e) => e.status === "Active");
      active.forEach((e) => {
        const slip = computeLivePayslip(e.id, ym);
        slip.status = "Finalized";
        slip.generatedAt = new Date().toISOString();
        payrollLedger[`${e.id}|${ym}`] = slip;
      });
      saveToStorage();
      return { ok: true, count: active.length, ym };
    },

    /* --------------------------- machine sync ---------------------------- */
    getSyncStatus() { ensureBuilt(); return JSON.parse(JSON.stringify(syncState)); },
    simulateSync() {
      ensureBuilt();
      syncState.devices.forEach((d) => { if (d.status === "Online") d.lastSync = new Date().toISOString(); });
      syncState.log.unshift({ time: new Date().toISOString(), message: "Manual sync triggered — pulled latest punches from all online terminals", level: "ok" });
      saveToStorage();
      return { ok: true, syncedAt: new Date().toISOString() };
    },

    /* ------------------------------- auth --------------------------------- */
    authenticate(role, identifier, password) {
      ensureBuilt();
      if (role === "admin") {
        if (identifier === "admin" && password === "admin123") return { ok: true, user: { name: "Admin User", role: "admin", id: "admin" } };
        return { ok: false, message: "Invalid admin username or password." };
      }
      const emp = employees.find((e) => e.empCode.toLowerCase() === identifier.trim().toLowerCase() || e.email.toLowerCase() === identifier.trim().toLowerCase());
      if (!emp) return { ok: , message: "No employee found with that ID or email." };
      if (emp.status === "Inactive") return { ok: false, message: "This account has been deactivated. Contact HR." };
      if (password !== "employee123") return { ok: false, message: "Incorrect password." };
      return { ok: true, user: { name: emp.name, role: "employee", id: emp.id } };
    },
  };
})();
