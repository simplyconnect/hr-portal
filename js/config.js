/* =========================================================================
   config.js
   -------------------------------------------------------------------------
   The ONLY file you need to touch to connect this frontend to real data.
   Every screen calls functions on `DataService` — nothing else in the app
   cares whether data came from the mock generator or your live Google
   Sheet.

   HOW THE REAL INTEGRATION WORKS
   -------------------------------------------------------------------------
   1) Create a Google Sheet and set up its tabs exactly as described in
      /google-apps-script/SETUP.md (Employees, Attendance, LeaveBalances,
      Requests, Notifications, Devices, SyncLog).
   2) Open Extensions > Apps Script in that Sheet, paste in the contents of
      /google-apps-script/Code.gs, and deploy it as a Web App
      (Deploy > New deployment > Web app; execute as "Me"; access
      "Anyone" — see SETUP.md for why, and how to restrict it further).
   3) Copy the resulting /exec URL into GOOGLE_SHEETS_API_URL below.
   4) Your biometric machine's local middleware should POST each punch to
      the SAME Web App URL with { action: "recordPunch", empCode, type,
      time }, which appends/updates the Attendance tab. That's the bridge
      from "physical device" to "Google Sheet" the original spec asked for.
   5) Flip USE_MOCK_DATA to false. Every screen — employees, attendance,
      leave, requests, notifications, payroll — now reads and writes the
      live Sheet through DataService, with no other code changes needed.

   IMPORTANT CORS NOTE: Google Apps Script Web Apps don't handle the
   CORS "preflight" (OPTIONS) request browsers send before a POST with a
   JSON content-type — the request just fails. The standard workaround
   (used below) is to send POST bodies as "text/plain" instead, which
   browsers treat as a "simple request" needing no preflight, and have
   Code.gs read + JSON.parse() the raw body regardless of that header.
   Don't change the POST Content-Type below unless you also update
   Code.gs to match.

   AUTH: real mode now checks the Users tab in your Sheet (Username +
   PasswordHash, compared as plain text — Code.gs does not hash anything,
   despite the column name) and routes to admin/employee based on that
   row's Role column. This is still not secure for real production data:
   the password is sent over the network to a public Apps Script URL and
   compared in plain text. Fine for an internal tool behind trusted access;
   replace with real auth (Google Sign-In, or a backend issuing session
   tokens) before this holds anything sensitive.
   ========================================================================= */

const APP_CONFIG = {
  USE_MOCK_DATA: false,

  GOOGLE_SHEETS_API_URL: "https://script.google.com/macros/s/AKfycbyRHl7TTc6POOJqVbqWsY8PAXI5KCpSJ5L8vomFsewuzLGxFbfdQuv9yxMlO40q9_-6bA/exec",
  BIOMETRIC_MIDDLEWARE_URL: "https://REPLACE_WITH_YOUR_LOCAL_MIDDLEWARE/api",

  COMPANY_NAME: "Simply Connect",
  // Default shift, used as a fallback in mock mode and for any employee
  // whose real Sheet "Timings" text can't be parsed. Individual employees'
  // real shifts come from their own Timings column in Code.gs (see SETUP.md).
  SHIFT_START: "17:00",   // 5:00 PM
  SHIFT_END: "02:00",     // 2:00 AM next day — an overnight shift
  LATE_GRACE_MINUTES: 10, // arrive by shift-start + this many minutes = On Time
  LATE_STRIKES_PER_DEDUCTION: 3, // this many Late days in a month = 1 day's salary deducted
  OVERTIME_MULTIPLIER: 1.5,      // overtime hourly rate = normal hourly rate × this
  LEAVE_ALLOCATIONS: { Casual: 15, Sick: 10 }, // 25-day annual entitlement, split as requested
  SYNC_POLL_INTERVAL_MS: 15000,
  NOTIF_POLL_INTERVAL_MS: 20000,
};

/* Small fetch helpers so every DataService method doesn't repeat this. */
// Code.gs requires a "token" param on every action except health/login/the
// bridge endpoints — grab it from the saved session (auth.js) and attach it
// automatically. Also: Code.gs returns a FLAT object like
// { success, employees, rows, ... } — never { result: ... } — so these
// return the whole parsed object and each DataService method below picks
// out the field it needs.
function authToken() {
  try { return (typeof Session !== "undefined" && Session.get() && Session.get().token) || null; }
  catch { return null; }
}
async function sheetsGet(action, params = {}) {
  const token = authToken();
  const qs = new URLSearchParams({ action, ...(token ? { token } : {}), ...params });
  const res = await fetch(`${APP_CONFIG.GOOGLE_SHEETS_API_URL}?${qs}`);
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.error || `Request failed: ${action}`);
  return data;
}
async function sheetsPost(action, payload = {}) {
  const token = authToken();
  const res = await fetch(APP_CONFIG.GOOGLE_SHEETS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // see CORS note above — do not use application/json
    body: JSON.stringify({ action, ...(token ? { token } : {}), ...payload }),
  });
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.error || `Request failed: ${action}`);
  return data;
}
// Code.gs's Employee rows only expose "EMP ID"/"Name"/"Department" as real
// fields — every other column (Designation, Team, D.O.J, Timings, Salary)
// comes back inside an attributes:[{label,value}] list. Flatten that into
// the plain fields the rest of this app (employee.js/admin.js) expects.
function normalizeAttrKey(label) {
  return String(label || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}
function mapEmployee(e) {
  const attrs = {};
  (e.attributes || []).forEach((a) => { attrs[normalizeAttrKey(a.label)] = a.value; });
  return {
    id: e.employeeId,
    empCode: e.employeeId,
    name: e.name,
    department: e.department,
    designation: attrs.designation || "",
    team: attrs.team || "",
    doj: attrs.doj || "",
    timings: attrs.timings || "",
    salary: Number(attrs.salary) || 0,
    email: attrs.email || "",
    phone: attrs.phone || "",
    status: attrs.status || "Active",
  };
}

const DataService = {
  /* ------------------------------ employees ------------------------------ */
  async fetchEmployees() {
    if (APP_CONFIG.USE_MOCK_DATA) return MockData.getEmployees();
    const data = await sheetsGet("getEmployees");
    return (data.employees || []).map(mapEmployee);
  },
  async addEmployee(data) {
    if (APP_CONFIG.USE_MOCK_DATA) return MockData.addEmployee(data);
    return sheetsPost("addEmployee", { data });
  },
  async updateEmployee(empId, patch) {
    if (APP_CONFIG.USE_MOCK_DATA) return MockData.updateEmployee(empId, patch);
    return sheetsPost("updateEmployee", { empId, patch });
  },
  async setEmployeeStatus(empId, status) {
    if (APP_CONFIG.USE_MOCK_DATA) return MockData.setEmployeeStatus(empId, status);
    return sheetsPost("setEmployeeStatus", { empId, status });
  },

  /* ------------------------------ attendance ------------------------------ */
  async fetchAttendance({ empId = null, from = null, to = null } = {}) {
    if (APP_CONFIG.USE_MOCK_DATA) return MockData.getAttendance({ empId, from, to });
    const params = {};
    if (empId) params.empId = empId;
    if (from) params.from = from;
    if (to) params.to = to;
    // Note: Code.gs only allows admins to call "getAttendance" (even when
    // scoped to one empId) — an employee session will get "Admin access
    // required" here. Leaving as-is for now; attendance wiring is a
    // separate follow-up.
    const data = await sheetsGet("getAttendance", params);
    return data.rows || [];
  },
  // Called by your biometric middleware (not the browser) each time someone
  // punches in/out, so it can push straight into the Attendance tab. Shown
  // here for reference — the middleware hits this same Apps Script URL
  // directly, it doesn't go through the frontend.
  async recordPunch({ empCode, type, time }) {
    if (APP_CONFIG.USE_MOCK_DATA) return { ok: true, note: "Mock mode — punches are simulated in mockData.js" };
    return sheetsPost("recordPunch", { empCode, type, time });
  },
  async fetchSyncStatus() {
    if (APP_CONFIG.USE_MOCK_DATA) return MockData.getSyncStatus();
    const res = await fetch(`${APP_CONFIG.BIOMETRIC_MIDDLEWARE_URL}/sync-status`);
    if (!res.ok) throw new Error("Failed to load device sync status");
    return res.json();
  },
  async pushManualSync() {
    if (APP_CONFIG.USE_MOCK_DATA) return MockData.simulateSync();
    const res = await fetch(`${APP_CONFIG.BIOMETRIC_MIDDLEWARE_URL}/sync-now`, { method: "POST" });
    if (!res.ok) throw new Error("Manual sync failed");
    return res.json();
  },

  /* --------------------------- leave & regularization --------------------------- */
  async fetchLeaveBalances(empId) {
    if (APP_CONFIG.USE_MOCK_DATA) return MockData.getLeaveBalances(empId);
    return sheetsGet("getLeaveBalances", { empId });
  },
  async fetchRequests({ empId, status, type } = {}) {
    if (APP_CONFIG.USE_MOCK_DATA) return MockData.getRequests({ empId, status, type });
    const params = {};
    if (empId) params.empId = empId;
    if (status) params.status = status;
    if (type) params.type = type;
    return sheetsGet("getRequests", params);
  },
  async submitLeaveRequest(payload) {
    if (APP_CONFIG.USE_MOCK_DATA) return MockData.submitLeaveRequest(payload);
    return sheetsPost("submitLeaveRequest", payload);
  },
  async submitRegularizationRequest(payload) {
    if (APP_CONFIG.USE_MOCK_DATA) return MockData.submitRegularizationRequest(payload);
    return sheetsPost("submitRegularizationRequest", payload);
  },
  async reviewRequest(requestId, decision, reviewerNote = "") {
    if (APP_CONFIG.USE_MOCK_DATA) return MockData.reviewRequest(requestId, decision, reviewerNote);
    return sheetsPost("reviewRequest", { requestId, decision, reviewerNote });
  },

  /* ------------------------------ notifications ------------------------------ */
  async fetchNotifications(role, empId) {
    if (APP_CONFIG.USE_MOCK_DATA) return MockData.getNotifications(role, empId);
    return sheetsGet("getNotifications", { role, empId: empId || "" });
  },
  async markNotificationsRead(role, empId, ids = null) {
    if (APP_CONFIG.USE_MOCK_DATA) return MockData.markNotificationsRead(role, empId, ids);
    return sheetsPost("markNotificationsRead", { role, empId, ids });
  },

  /* ------------------------------ payroll ------------------------------ */
  async fetchPayslip(empId, ym) {
    if (APP_CONFIG.USE_MOCK_DATA) return MockData.getPayslip(empId, ym);
    return sheetsGet("getPayslip", { empId, ym });
  },
  async fetchPayrollSummary(ym) {
    if (APP_CONFIG.USE_MOCK_DATA) return MockData.getPayrollSummary(ym);
    return sheetsGet("getPayrollSummary", { ym });
  },
  // Admin action: computes final numbers for every active employee for the
  // given month and writes/updates one row per employee into the Payroll
  // tab (Status "Finalized"). fetchPayslip still computes live for months
  // that haven't been generated yet — this is what actually locks a month in.
  async generatePayroll(ym) {
    if (APP_CONFIG.USE_MOCK_DATA) return MockData.generatePayroll(ym);
    return sheetsPost("generatePayroll", { ym });
  },

  /* --------------------------------- auth --------------------------------- */
  async login(role, identifier, password) {
    if (APP_CONFIG.USE_MOCK_DATA) return MockData.authenticate(role, identifier, password);
    // Code.gs's login() takes { username, password } (not "identifier") and
    // returns a FLAT object { success, token, role, employee } — not the
    // { result: ... } envelope sheetsPost()/sheetsGet() expect elsewhere.
    // So this talks to the endpoint directly instead of going through
    // sheetsPost, and reshapes the reply into the { ok, user } / { ok:false,
    // message } shape the rest of this app (auth.js) already expects.
    try {
      const res = await fetch(APP_CONFIG.GOOGLE_SHEETS_API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "login", username: identifier, password }),
      });
      const data = await res.json();
      if (!data.success) return { ok: false, message: data.error || "Invalid username or password." };
      return { ok: true, user: { name: data.employee.name, role: data.role, id: data.employee.id, token: data.token } };
    } catch (err) {
      return { ok: false, message: "Could not reach the server. Please try again." };
    }
  },

  /* ------------------------------ demo data ------------------------------ */
  resetDemoData() {
    if (APP_CONFIG.USE_MOCK_DATA) return MockData.resetDemoData();
  },
};
