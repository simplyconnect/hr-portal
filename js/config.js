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

  GOOGLE_SHEETS_API_URL: "https://script.google.com/macros/s/AKfycbwaowph3AwSKiDV_qL8Hkv2QYjMiygSNWYTIAKUs13K_Q53aV6olBW5JAu4HwQiXP_rxQ/exec",
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
async function sheetsGet(action, params = {}) {
  const qs = new URLSearchParams({ action, ...params });
  const res = await fetch(`${APP_CONFIG.GOOGLE_SHEETS_API_URL}?${qs}`);
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `Request failed: ${action}`);
  return data.result;
}
async function sheetsPost(action, payload = {}) {
  const res = await fetch(APP_CONFIG.GOOGLE_SHEETS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // see CORS note above — do not use application/json
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `Request failed: ${action}`);
  return data.result;
}

const DataService = {
  /* ------------------------------ employees ------------------------------ */
  async fetchEmployees() {
    if (APP_CONFIG.USE_MOCK_DATA) return MockData.getEmployees();
    return sheetsGet("getEmployees");
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
    return sheetsGet("getAttendance", params);
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
    return sheetsPost("login", { role, identifier, password });
  },

  /* ------------------------------ demo data ------------------------------ */
  resetDemoData() {
    if (APP_CONFIG.USE_MOCK_DATA) return MockData.resetDemoData();
  },
};
