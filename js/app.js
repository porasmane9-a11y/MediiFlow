(() => {
  "use strict";

  /* ── Constants ──────────────────────────────────────────── */
  const STORAGE_KEY  = "mediflow_data_v3";
  const SESSION_KEY  = "mediflow_session";
  const DB_NAME      = "mediflow_db";
  const DB_VERSION   = 1;
  const PAGE         = document.body.dataset.page;

  const STATUSES = ["New", "Received", "Preparing", "Packed", "Collected"];

  const STATUS_LABELS = {
    "New":                  "New Prescription",
    "Received":             "Received & Verified",
    "Preparing":            "Preparing Medicines",
    "Packed":               "Packed (Ready for Pickup)",
    "Ready for Collection": "Packed (Ready for Pickup)",
    "Collected":            "Collected & Completed",
    "Completed":            "Collected & Completed",
    "RECEIVED":  "Received & Verified",
    "CHECKING":  "Checking",
    "CONFIRMED": "Confirmed",
    "BILLED":    "Billed",
    "PREPARING": "Preparing Medicines",
    "READY":     "Packed (Ready for Pickup)",
    "PACKED":    "Packed (Ready for Pickup)",
    "COLLECTED": "Collected & Completed"
  };

  function normalizeStatus(s) {
    if (!s) return "New";
    const str = String(s).trim();
    if (str === "PACKED" || str.toLowerCase() === "packed" || str === "READY" || str.toLowerCase() === "ready" || str.toLowerCase() === "ready for collection") {
      return "Packed";
    }
    if (str === "RECEIVED" || str.toLowerCase() === "received" || str.toLowerCase() === "prescription received") {
      return "Received";
    }
    if (str === "CHECKING" || str === "CONFIRMED" || str === "BILLED") return "Received";
    if (str === "PREPARING" || str.toLowerCase() === "preparing") return "Preparing";
    if (str === "COLLECTED" || str.toLowerCase() === "collected" || str.toLowerCase() === "completed" || str.toLowerCase() === "complete") {
      return "Collected";
    }
    if (str.toLowerCase() === "new") return "New";
    return str;
  }

  const STEPS = [
    "Digital Prescription",
    "Received & Verified",
    "Preparing Medicines",
    "Packed (Ready for Pickup)",
    "Collected & Completed"
  ];

  const DEPARTMENTS = {
    "Cardiology":           ["Amlodipine", "Atorvastatin", "Aspirin", "Clopidogrel", "Metoprolol"],
    "Neurology":            ["Levetiracetam", "Gabapentin", "Pregabalin", "Vitamin B Complex", "Neurological Support Medicine"],
    "Oncology":             ["Supportive Care Medicine", "Anti-nausea Medicine", "Oral Care Medicine", "Vitamin Supplement", "Sterile Dressing"],
    "Nephrology / Dialysis":["Calcium Supplement", "Iron Supplement", "Vitamin D Supplement", "Erythropoietin Support Item", "Dialysis Dressing"],
    "Orthopedics":          ["Calcium Supplement", "Vitamin D", "Pain Relief Medicine", "Elastic Bandage", "Sterile Bandage"],
    "Pediatrics":           ["Paracetamol", "ORS", "Amoxicillin", "Cough Syrup", "Zinc Supplement"],
    "ENT":                  ["Ear Drops", "Nasal Spray", "Antiallergic Medicine", "Throat Lozenges", "Antibiotic"],
    "General Medicine":     ["Paracetamol", "Antacid", "Multivitamin", "ORS", "Cough Lozenges"],
    "Infectious Disease":   ["Antibiotic", "Antiviral Support Medicine", "ORS", "Fever Medicine", "Vitamin Supplement"]
  };

  const PRICE_OVERRIDES = {
    "Aspirin": 90, "Atorvastatin": 180, "Metoprolol": 145, "Calcium Supplement": 250,
    "Vitamin B Complex": 180, "Sterile Bandage": 120, "Bandage": 120,
    "Amlodipine": 110, "Clopidogrel": 210, "Paracetamol": 45, "ORS": 35,
    "Iron Supplement": 160, "Folic Acid": 85, "Vitamin D": 130, "Vitamin D Supplement": 150
  };

  function isDemoPatient(req) {
    if (!req) return false;
    return req.isDemo === true;
  }

  /* ── State ──────────────────────────────────────────────── */
  let currentSession  = null;
  let selectedRelativeId = "";
  let staffSearch     = "";
  let staffFilter     = "ALL";
  let inventorySearch = "";
  let inventoryDept   = "ALL";
  let inventoryStock  = "ALL";
  let idbDatabase     = null;

  /* ── Utils ──────────────────────────────────────────────── */
  const escapeHtml = (v) =>
    String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    })[c]);

  const money    = (v) => `₹${Number(v || 0).toLocaleString("en-IN")}`;
  const initials = (n) => String(n || "MF").split(/\s+/).slice(0,2).map((p) => p.charAt(0)).join("").toUpperCase();
  const byId     = (id) => document.getElementById(id);
  const timeAgo  = (ts) => {
    const m = Math.max(0, Math.floor((Date.now() - Number(ts || Date.now())) / 60000));
    if (m < 1)  return "Just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h} hr ago` : `${Math.floor(h / 24)} d ago`;
  };
  const fmtDate  = (ts) => ts
    ? new Date(ts).toLocaleDateString("en-IN", { day:"numeric", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" })
    : "—";

  /* ── IndexedDB ──────────────────────────────────────────── */
  function initIndexedDB() {
    if (!window.indexedDB) return Promise.resolve(null);
    return new Promise((resolve) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("prescriptions")) {
          const s = db.createObjectStore("prescriptions", { keyPath: "prescriptionId" });
          ["patientId","doctor","department","status","createdAt"].forEach((idx) => s.createIndex(idx, idx, { unique: false }));
        }
        if (!db.objectStoreNames.contains("inventory"))     db.createObjectStore("inventory",     { keyPath: "name" });
        if (!db.objectStoreNames.contains("notifications")) db.createObjectStore("notifications", { keyPath: "id" });
      };
      req.onsuccess = (e) => {
        idbDatabase = e.target.result;
        syncStateToIndexedDB(loadState());
        resolve(idbDatabase);
      };
      req.onerror = () => resolve(null);
    });
  }

  function syncStateToIndexedDB(state) {
    if (!idbDatabase) return;
    try {
      const tx = idbDatabase.transaction(["prescriptions","inventory","notifications"], "readwrite");
      const ps = tx.objectStore("prescriptions");
      const is = tx.objectStore("inventory");
      const ns = tx.objectStore("notifications");
      ps.clear(); (state.requests  || []).filter((r) => !isDemoPatient(r)).forEach((r) => ps.put(r));
      is.clear(); Object.values(state.inventory || {}).forEach((i) => is.put(i));
      ns.clear(); (state.notifications || []).forEach((n) => ns.put(n));
    } catch (e) {}
  }

  function dbSavePrescription(p) {
    if (!idbDatabase) return;
    try { idbDatabase.transaction(["prescriptions"],"readwrite").objectStore("prescriptions").put(p); } catch (e) {}
  }

  function dbDeletePrescription(id) {
    if (!idbDatabase) return;
    try { idbDatabase.transaction(["prescriptions"],"readwrite").objectStore("prescriptions").delete(id); } catch (e) {}
  }

  /* ── API helpers ────────────────────────────────────────── */
  function getApiUrl(endpoint) {
    const clean = endpoint.replace(/\.php(\?.*)?$/, "$1").replace(/\.php$/, "");
    if (window.location.protocol.startsWith("http") &&
        (window.location.port === "3000" || window.location.port === "")) {
      return `/api/${clean}`;
    }
    return `http://localhost:3000/api/${clean}`;
  }

  function getAuthHeaders() {
    const role = currentSession
      ? currentSession.role
      : (PAGE === "doctor" ? "doctor" : PAGE === "staff" ? "staff" : "relative");
    return { "Content-Type": "application/json", "x-user-role": role };
  }

  async function postPrescriptionToServer(prescription) {
    try {
      const res = await fetch(getApiUrl("prescriptions.php"), {
        method: "POST", headers: getAuthHeaders(), body: JSON.stringify(prescription)
      });
      if (res.ok) return await res.json();
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${res.status}`);
    } catch (e) {
      console.warn("MEDIFLOW backend save failed:", e.message);
      return null;
    }
  }

  async function updatePrescriptionOnServer(prescription) {
    try {
      const res = await fetch(
        getApiUrl(`prescriptions.php?id=${encodeURIComponent(prescription.prescriptionId)}`),
        { method: "PUT", headers: getAuthHeaders(), body: JSON.stringify(prescription) }
      );
      if (res.ok) return await res.json();
    } catch (e) {}
  }

  async function deletePrescriptionOnServer(id) {
    try {
      await fetch(getApiUrl(`prescriptions.php?id=${encodeURIComponent(id)}`), {
        method: "DELETE", headers: getAuthHeaders()
      });
    } catch (e) {}
  }

  async function syncFromBackend() {
    const role = currentSession
      ? currentSession.role
      : (PAGE === "doctor" ? "doctor" : PAGE === "staff" ? "staff" : "relative");

    // 1. Prescriptions
    try {
      let url = getApiUrl("prescriptions.php");
      if (role === "relative") {
        if (selectedRelativeId) url += `?patientId=${encodeURIComponent(selectedRelativeId)}`;
        else url = null;
      }
      if (url) {
        const res = await fetch(url, { cache: "no-store", headers: { "x-user-role": role } });
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.prescriptions)) {
            const state  = loadState();
            const clean  = data.prescriptions.map((r) => ({ ...r, status: normalizeStatus(r.status) })).filter((r) => !isDemoPatient(r));
            const sigCur = (state.requests || []).map((r) => `${r.prescriptionId}:${r.status}`).join("|");
            const sigBak = clean.map((r) => `${r.prescriptionId}:${r.status}`).join("|");
            if (sigCur !== sigBak) {
              state.requests = clean;
              if (clean.length) {
                const maxId = clean.reduce((max, r) => {
                  const n = parseInt(String(r.prescriptionId).split("-").pop(), 10);
                  return !isNaN(n) && n > max ? n : max;
                }, 1000);
                state.nextId = Math.max(state.nextId, maxId + 1);
              }
              saveState(state, false);
              renderCurrentPage();
            }
          }
        }
      }
    } catch (e) {}

    // 2. Notifications
    try {
      const nRes = await fetch(`${getApiUrl("notifications.php")}?role=${encodeURIComponent(role)}`, {
        cache: "no-store", headers: { "x-user-role": role }
      });
      if (nRes.ok) {
        const nData = await nRes.json();
        if (nData && Array.isArray(nData.notifications)) {
          const state  = loadState();
          const sigCur = (state.notifications || []).map((n) => `${n.id}:${n.read}`).join("|");
          const sigBak = nData.notifications.map((n) => `${n.id}:${n.read}`).join("|");
          if (sigCur !== sigBak) {
            state.notifications = nData.notifications;
            saveState(state, false);
            const unread = state.notifications.filter((n) => !n.read).length;
            const btn    = byId("notificationButton");
            if (btn) btn.innerHTML = `🔔${unread ? `<span class="notification-count">${unread > 9 ? "9+" : unread}</span>` : ""}`;
          }
        }
      }
    } catch (e) {}
  }

  /* ── Local State ────────────────────────────────────────── */
  function catalog() {
    const items = new Map();
    Object.entries(DEPARTMENTS).forEach(([dept, meds]) => meds.forEach((name) => {
      if (!items.has(name)) items.set(name, { name, departments: [] });
      items.get(name).departments.push(dept);
    }));
    return items;
  }

  function makeInitialState() {
    const inventory = {};
    catalog().forEach((item, name) => {
      inventory[name] = {
        name,
        departments: item.departments,
        quantity: 25,
        price: PRICE_OVERRIDES[name] || 100,
        unit: "units"
      };
    });
    return { version: 3, nextId: 1001, requests: [], inventory, notifications: [] };
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) {
        const f = makeInitialState();
        saveState(f, false);
        return f;
      }
      const p = JSON.parse(saved);
      if (Array.isArray(p.requests) && p.inventory && Array.isArray(p.notifications)) {
        p.requests = p.requests.map((r) => ({ ...r, status: normalizeStatus(r.status) })).filter((r) => !isDemoPatient(r));
        return p;
      }
    } catch (e) {}
    const f = makeInitialState();
    saveState(f, false);
    return f;
  }

  function saveState(state, broadcast = true) {
    try {
      if (Array.isArray(state.requests)) state.requests = state.requests.filter((r) => !isDemoPatient(r));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error("MEDIFLOW: could not save state", e);
      throw e;
    }
    syncStateToIndexedDB(state);
    if (broadcast) window.dispatchEvent(new CustomEvent("mediflow:update"));
  }

  function mutate(updater) {
    const state = loadState();
    updater(state);
    saveState(state);
  }

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) { return null; }
  }

  function setSession(role, name) {
    const s = { role, name, signedInAt: Date.now() };
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    return s;
  }

  function addNotification(state, title, message, prescriptionId) {
    state.notifications.unshift({
      id: `N-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      title, message, prescriptionId, createdAt: Date.now(), read: false
    });
    state.notifications = state.notifications.slice(0, 80);
  }

  function getRequest(state, id) {
    return state.requests.find((r) => r.prescriptionId.toLowerCase() === id.toLowerCase());
  }

  function totalFor(req) {
    return (req.medicines || []).reduce((s, m) => s + Number(m.qty) * Number(m.price), 0);
  }

  /* ── UI Components ──────────────────────────────────────── */
  function showToast(message, type = "success") {
    let region = document.querySelector(".toast-region");
    if (!region) {
      region = document.createElement("div");
      region.className = "toast-region";
      region.setAttribute("aria-live", "polite");
      document.body.appendChild(region);
    }
    const toast = document.createElement("div");
    toast.className = `toast${type === "error" ? " toast-error" : ""}`;
    toast.textContent = message;
    region.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(12px)";
      toast.style.transition = "opacity .2s, transform .2s";
      setTimeout(() => toast.remove(), 220);
    }, 3600);
  }

  function statusBadge(status) {
    const norm = normalizeStatus(status);
    const cls  = {
      "New":                  "badge-blue",
      "Received":             "badge-amber",
      "Preparing":            "badge-teal",
      "Packed":               "badge-green",
      "Ready for Collection": "badge-green",
      "Collected":            "badge-gray"
    };
    return `<span class="badge ${cls[norm] || "badge-gray"}">${escapeHtml(STATUS_LABELS[norm] || norm)}</span>`;
  }

  function paymentBadge(status) {
    const map = {
      "Pending":      ["payment-status payment-pending",     "⏳ Pending"],
      "Paid Online":  ["payment-status payment-paid-online", "✅ Paid Online"],
      "Paid by Cash": ["payment-status payment-paid-cash",   "💵 Paid by Cash"],
      "Failed":       ["payment-status payment-failed",      "✗ Failed"],
      "Cancelled":    ["payment-status payment-cancelled",   "⊘ Cancelled"]
    };
    const [cls, label] = map[status] || map["Pending"];
    return `<span class="${escapeHtml(cls)}">${label}</span>`;
  }

  function roleLabel(role) {
    return { doctor: "Doctor", staff: "Medical Staff", relative: "Patient Relative" }[role] || role;
  }

  function navEntries(role) {
    if (role === "doctor") return [
      { href: "doctor.html",    page: "doctor",    icon: "✚", label: "Doctor workspace" }
    ];
    if (role === "staff") return [
      { href: "staff.html",     page: "staff",     icon: "▦", label: "Live queue" },
      { href: "inventory.html", page: "inventory", icon: "▤", label: "Medicine inventory" },
      { href: "billing.html",   page: "billing",   icon: "₹", label: "Billing & payments" }
    ];
    return [
      { href: "relative.html", page: "relative", icon: "◎", label: "Track prescription" }
    ];
  }

  function shell(title, content, role, options = {}) {
    const nav    = navEntries(role);
    const state  = loadState();
    const unread = state.notifications.filter((n) => !n.read).length;
    const active = PAGE;
    return `
      <div class="app-shell">
        <aside class="sidebar" id="sidebar">
          <a class="brand" href="index.html" aria-label="MEDIFLOW home">
            <span class="brand-mark">M</span>
            <span><span class="brand-name">MEDIFLOW</span><span class="brand-caption">SMART PHARMACY WORKFLOW</span></span>
          </a>
          <div class="nav-label">Workspace</div>
          <nav class="nav-list" aria-label="Main navigation">
            ${nav.map((item) => `
              <a class="nav-link ${active === item.page ? "active" : ""}" href="${item.href}">
                <span class="nav-icon">${item.icon}</span>${item.label}
              </a>`).join("")}
          </nav>
          <div class="sidebar-bottom">
            <div class="demo-note">
              <strong>CONNECTED CARE</strong>
              <p>Doctor · Staff · Relative — live sync with real-time email alerts.</p>
            </div>
            <div class="sidebar-user">
              <span class="avatar">${escapeHtml(initials(currentSession.name))}</span>
              <span>
                <strong>${escapeHtml(currentSession.name)}</strong>
                <small>${escapeHtml(roleLabel(role))} · City Hospital</small>
              </span>
            </div>
          </div>
        </aside>
        <div class="mobile-overlay" id="mobileOverlay"></div>
        <div class="main-area">
          <header class="topbar">
            <div class="topbar-left">
              <button class="icon-button hamburger" id="menuToggle" aria-label="Open navigation">☰</button>
              <div class="breadcrumb">MEDIFLOW <span aria-hidden="true">/</span> <strong>${escapeHtml(title)}</strong></div>
            </div>
            <div class="topbar-actions">
              <span class="secure-label" id="topbarEmailStatus" style="cursor:pointer;" title="Click to view Email Notification Diagnostics & Logs"><i class="secure-dot" style="background:#22c98b"></i>Email: Checking...</span>
              <span class="secure-label"><i class="secure-dot"></i>Database: Synced</span>
              <button class="icon-button" id="notificationButton" aria-label="Notifications">
                🔔${unread ? `<span class="notification-count">${unread > 9 ? "9+" : unread}</span>` : ""}
              </button>
              <button class="btn btn-sm" id="logoutButton">Sign out</button>
            </div>
          </header>
          <main class="page-content">${content}</main>
        </div>
      </div>`;
  }

  function pageHeading(eyebrow, title, description, right = "") {
    return `<div class="page-heading">
      <div>
        <div class="eyebrow">${eyebrow}</div>
        <h1>${title}</h1>
        <p>${description}</p>
      </div>
      ${right}
    </div>`;
  }

  function statCard(label, value, icon, color, foot = "") {
    return `<article class="stat-card">
      <div class="stat-top"><span>${label}</span><span class="stat-icon ${color}">${icon}</span></div>
      <div class="stat-value" data-count="${Number(value) || 0}">${value}</div>
      <div class="stat-foot">${foot}</div>
    </article>`;
  }

  function impactCard(state) {
    const completed  = state.requests.filter((r) => normalizeStatus(r.status) === "Collected").length;
    const total      = state.requests.length;
    const efficiency = total ? Math.round((completed / total) * 100) : 0;
    return `<section class="card impact-card">
      <div class="card-header">
        <div><h2>MEDIFLOW IMPACT</h2><p>A more predictable pharmacy journey, at a glance</p></div>
        <span class="badge badge-teal">LIVE METRICS</span>
      </div>
      <div class="impact-grid">
        <div class="impact-stat"><strong data-count="45">45</strong><span>Traditional wait · min</span></div>
        <div class="impact-stat"><strong data-count="15">15</strong><span>Estimated time · min</span></div>
        <div class="impact-stat"><strong data-count="30">30</strong><span>Time saved · min</span></div>
      </div>
      <div class="impact-foot">Reduction 67% · Efficiency ${efficiency}% · ${completed} prescriptions completed</div>
    </section>`;
  }

  function notificationPanel(state) {
    const recent = state.notifications.slice(0, 5);
    return `<section class="card">
      <div class="card-header">
        <div><h2>Recent notifications</h2><p>Workflow activity across MEDIFLOW</p></div>
        <button class="btn btn-sm" data-action="read-notifications">Mark all read</button>
      </div>
      <div class="card-body">
        <div class="notification-list">
          ${recent.length ? recent.map((n) => `
            <article class="notification-item ${n.read ? "" : "unread"}">
              <span class="notification-mark">🔔</span>
              <div>
                <strong>${escapeHtml(n.title)}</strong>
                <p>${escapeHtml(n.message)}</p>
                <time>${timeAgo(n.createdAt)}</time>
              </div>
            </article>`).join("")
          : `<div class="empty-state">No notifications yet.</div>`}
        </div>
      </div>
    </section>`;
  }

  /* ── Scroll-Reveal (home page) ──────────────────────────── */
  function initScrollReveal() {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("revealed");
          observer.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));
  }

  /* ── Count-up animation ─────────────────────────────────── */
  function animateCounts() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.querySelectorAll("[data-count]").forEach((el) => {
      const target = Number(el.dataset.count);
      if (!Number.isFinite(target) || target <= 0 || target > 100000) return;
      const start    = performance.now();
      const duration = 520;
      const prefix   = el.textContent.match(/^[^\d]*/)[0];
      const suffix   = el.textContent.match(/[^\d]*$/)[0];
      function frame(now) {
        const p = Math.min(1, (now - start) / duration);
        const v = Math.round(target * (1 - Math.pow(1 - p, 3)));
        el.textContent = `${prefix}${v.toLocaleString("en-IN")}${suffix}`;
        if (p < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }

  // Shared Email modals
  function openEmailLogsModal() {
    fetch(getApiUrl("email-logs"))
      .then((r) => r.json())
      .then((data) => {
        const logs = data.logs || [];
        const dlg  = document.createElement("dialog");
        dlg.style.cssText = "width:min(700px,calc(100vw - 30px));max-height:85vh;overflow:auto;border:1px solid #e1eaf2;border-radius:16px;padding:0;box-shadow:0 30px 90px rgba(15,46,76,.22)";
        dlg.innerHTML = `
          <div class="card-header">
            <div>
              <h2>📧 Email Notification Logs</h2>
              <p>Mode: <strong>${data.status ? (data.status.smtpConfigured ? "🟢 SMTP Active — " + escapeHtml(data.status.senderEmail || "") : "🟡 Development Simulation (not sent)") : "Unknown"}</strong></p>
            </div>
            <button class="btn btn-sm" data-close-dialog type="button">Close</button>
          </div>
          <div class="card-body">
            ${logs.length ? `<div style="display:grid;gap:10px;">
              ${logs.map((l) => `
                <div style="background:#f7fafc;padding:12px 14px;border-radius:10px;border:1px solid #e1eaf2;font-size:12px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                    <span class="badge ${l.status === "sent" ? "badge-green" : l.status === "simulated_development" ? "badge-amber" : "badge-red"}">
                      ${escapeHtml((l.status || "").toUpperCase().replace("_", " "))} · ${escapeHtml(l.mode || "")}
                    </span>
                    <span style="color:#8da3b6;font-size:10.5px;">${new Date(l.timestamp).toLocaleString("en-IN")}</span>
                  </div>
                  <strong style="color:#1e3a52">${escapeHtml(l.subject || "—")}</strong>
                  <div style="color:#5e7891;margin-top:4px;">
                    To: <strong>${escapeHtml(l.recipient || "—")}</strong> · Rx: <strong>${escapeHtml(l.prescriptionId || "—")}</strong>
                    ${l.messageId ? `<span style="color:#8da3b6"> · ID: ${escapeHtml(l.messageId)}</span>` : ""}
                  </div>
                  ${l.note ? `<div style="color:#d97706;font-size:10.5px;margin-top:4px;">${escapeHtml(l.note)}</div>` : ""}
                  ${l.error ? `<div style="color:#c0353e;font-size:10.5px;margin-top:4px;">Error: ${escapeHtml(l.error)}</div>` : ""}
                </div>`).join("")}
            </div>` : `<div class="empty-state">No email logs yet. Create a prescription or mark one ready to trigger notifications.</div>`}
          </div>`;
        document.body.appendChild(dlg);
        dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-close-dialog]")) dlg.close(); });
        dlg.addEventListener("close", () => dlg.remove());
        dlg.showModal();
      })
      .catch((e) => showToast("Failed to load email logs: " + e.message, "error"));
  }

  function openDiagnosticsModal() {
    const dlg = document.createElement("dialog");
    dlg.style.cssText = "width:min(680px,calc(100vw - 30px));border:1px solid #e1eaf2;border-radius:16px;padding:0;box-shadow:0 30px 90px rgba(15,46,76,.22)";
    dlg.innerHTML = `
      <div class="card-header">
        <div><h2>🔧 Email Service Diagnostics</h2><p>Run a test to verify SMTP configuration and delivery</p></div>
        <button class="btn btn-sm" data-close-dialog type="button">Close</button>
      </div>
      <div class="card-body">
        <div style="display:grid;gap:12px;margin-bottom:16px;">
          <div class="field">
            <label for="diagEmail">Test recipient email</label>
            <input id="diagEmail" type="email" placeholder="your-email@example.com" value="">
          </div>
        </div>
        <button class="btn btn-primary" id="runDiagBtn" type="button">Run diagnostics →</button>
        <div id="diagResults" style="margin-top:16px;"></div>
      </div>`;
    document.body.appendChild(dlg);

    dlg.querySelector("#runDiagBtn").addEventListener("click", async () => {
      const btn = dlg.querySelector("#runDiagBtn");
      const email = dlg.querySelector("#diagEmail").value.trim();
      btn.disabled = true;
      btn.textContent = "Running...";
      dlg.querySelector("#diagResults").innerHTML = `<div class="skeleton" style="height:40px;margin-bottom:8px;"></div><div class="skeleton" style="height:40px;margin-bottom:8px;"></div><div class="skeleton" style="height:40px;"></div>`;
      try {
        const res  = await fetch(getApiUrl("email-diagnostics"), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ testEmail: email })
        });
        const data = await res.json();
        const rows = (data.results || []).map((r) => `
          <div class="diag-row">
            <span class="diag-status ${r.status === "PASS" ? "diag-pass" : r.status === "FAIL" ? "diag-fail" : r.status === "NOT_VERIFIED" ? "diag-warn" : "diag-skip"}">${r.status}</span>
            <span class="diag-label">${escapeHtml(r.step)}</span>
            <span class="diag-detail">${escapeHtml(r.detail)}</span>
          </div>`).join("");
        dlg.querySelector("#diagResults").innerHTML = `<div style="border:1px solid #e1eaf2;border-radius:10px;overflow:hidden;">${rows}</div><p style="margin-top:12px;color:#8da3b6;font-size:11px;">Mode: ${escapeHtml(data.smtpMode || "unknown")} · Recipient: ${escapeHtml(data.testRecipient || "—")}</p>`;
      } catch (e) {
        dlg.querySelector("#diagResults").innerHTML = `<div style="color:#c0353e;font-size:12px;padding:12px;background:#fef1f1;border-radius:8px;">Failed to run diagnostics: ${escapeHtml(e.message)}</div>`;
      } finally {
        btn.disabled = false;
        btn.textContent = "Run diagnostics →";
      }
    });

    dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-close-dialog]")) dlg.close(); });
    dlg.addEventListener("close", () => dlg.remove());
    dlg.showModal();
  }

  /* ══════════════════════════════════════════════════════════
     HOME / LANDING PAGE
     ══════════════════════════════════════════════════════════ */
  function roleCard(role, icon, title, description, name) {
    return `<article class="role-card">
      <div class="role-icon">${icon}</div>
      <h3>${title}</h3>
      <p>${description}</p>
      <button class="btn btn-primary" data-login-role="${role}" data-login-name="${escapeHtml(name)}">Open ${title} →</button>
    </article>`;
  }

  function renderHome() {
    document.title = "MEDIFLOW | Smart Hospital Pharmacy Workflow";
    byId("app").innerHTML = `<div class="home-page">
      <header class="home-nav">
        <a class="home-brand" href="index.html">
          <span class="brand-mark">M</span>
          <span><span class="brand-name">MEDIFLOW</span><span class="brand-caption">CITY HOSPITAL · SMART PHARMACY</span></span>
        </a>
        <div class="home-nav-right">
          <span class="secure-label" id="homeSmtpStatus"><i class="secure-dot"></i>Email: Checking...</span>
          <button class="btn btn-sm btn-outline" id="viewEmailLogsBtn" type="button">📧 Email Logs</button>
          <button class="btn btn-sm btn-outline" id="runDiagnosticsBtn" type="button">🔧 Diagnostics</button>
          <a href="#roles" class="btn btn-primary btn-sm">Enter Workspace →</a>
        </div>
      </header>

      <!-- Hero -->
      <section class="hero">
        <div class="hero-copy">
          <div class="hero-badge">
            <i class="secure-dot"></i>
            CONNECTED CARE, COORDINATED
          </div>
          <h1>MEDI<span>FLOW</span></h1>
          <p class="hero-subtitle">Smart Hospital Medicine Queue &amp; Preparation System</p>
          <p class="hero-tagline">
            Digitally connecting doctors, pharmacy staff, and patient relatives — with real-time queue tracking, automatic email notifications, and integrated UPI payment.
          </p>
          <div class="hero-buttons">
            <a class="btn btn-primary" href="#roles">Launch workspaces <span aria-hidden="true">→</span></a>
            <a class="btn btn-outline" href="#workflow">Explore the workflow</a>
          </div>
        </div>
        <div class="hero-visual" id="workflow">
          <div class="workflow-visual">
            <div class="visual-top">
              <strong>Prescription journey</strong>
              <span>LIVE WORKFLOW</span>
            </div>
            <div class="visual-flow">
              <div class="visual-step">
                <span class="visual-step-icon">✚</span>
                <span>
                  <strong>1. Digital prescription</strong>
                  <small>Doctor issues order; staff receives email &amp; in-app alert instantly</small>
                </span>
                <span class="visual-time">Instant</span>
              </div>
              <div class="visual-step">
                <span class="visual-step-icon">▦</span>
                <span>
                  <strong>2. Preparation &amp; packing</strong>
                  <small>Pharmacy accepts, verifies stock and prepares medicine order</small>
                </span>
                <span class="visual-time">In progress</span>
              </div>
              <div class="visual-step">
                <span class="visual-step-icon">📦</span>
                <span>
                  <strong>3. Packed &amp; payment</strong>
                  <small>Relative receives pickup email with UPI QR + cash option</small>
                </span>
                <span class="visual-time">Notified</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ScrollTide Inspired Live Ticker -->
      <div class="workflow-ticker" aria-hidden="true">
        <div class="ticker-track">
          <span>✦ LIVE HOSPITAL QUEUE</span>
          <span>✦ DOCTOR DIGITAL PRESCRIPTIONS</span>
          <span>✦ AUTOMATIC STAFF NOTIFICATIONS</span>
          <span>✦ MEDICINE PREPARATION &amp; PACKING</span>
          <span>✦ RELATIVE PICKUP ALERTS</span>
          <span>✦ DYNAMIC UPI QR PAYMENTS</span>
          <span>✦ VERIFIED CASH CONFIRMATION</span>
          <span>✦ ZERO-WAIT MEDICINE PICKUP</span>
          <span>✦ LIVE HOSPITAL QUEUE</span>
          <span>✦ DOCTOR DIGITAL PRESCRIPTIONS</span>
          <span>✦ AUTOMATIC STAFF NOTIFICATIONS</span>
          <span>✦ MEDICINE PREPARATION &amp; PACKING</span>
          <span>✦ RELATIVE PICKUP ALERTS</span>
          <span>✦ DYNAMIC UPI QR PAYMENTS</span>
          <span>✦ VERIFIED CASH CONFIRMATION</span>
          <span>✦ ZERO-WAIT MEDICINE PICKUP</span>
        </div>
      </div>

      <!-- Benefits -->
      <section class="benefits" aria-label="MEDIFLOW benefits">
        <article class="benefit reveal">
          <span class="benefit-icon">✉</span>
          <div>
            <strong>Real email delivery</strong>
            <p>SMTP notifications sent to staff and relatives, with simulation mode for testing.</p>
          </div>
        </article>
        <article class="benefit reveal">
          <span class="benefit-icon">📲</span>
          <div>
            <strong>UPI + Cash payment</strong>
            <p>Dynamic UPI QR in pickup email. Cash confirmed by staff at counter. Both options tracked.</p>
          </div>
        </article>
        <article class="benefit reveal">
          <span class="benefit-icon">🔔</span>
          <div>
            <strong>Real-time queue tracking</strong>
            <p>5-stage workflow from prescription to collection — every step visible to all parties.</p>
          </div>
        </article>
      </section>

      <!-- How it works -->
      <section class="how-it-works-section" id="roles">
        <div class="section-heading reveal">
          <div class="eyebrow">END-TO-END WORKFLOW</div>
          <h2>From prescription to pickup in four steps</h2>
          <p>One connected system for doctor, pharmacy staff, and patient relative</p>
        </div>
        <div class="workflow-steps reveal">
          <div class="workflow-step">
            <div class="workflow-step-num">1</div>
            <h4>Doctor submits prescription</h4>
            <p>Digital order created, saved in database, staff receives email notification</p>
          </div>
          <div class="workflow-step">
            <div class="workflow-step-num">2</div>
            <h4>Staff prepares medicines</h4>
            <p>Staff accepts, checks stock, prepares and packs the medicine order</p>
          </div>
          <div class="workflow-step">
            <div class="workflow-step-num">3</div>
            <h4>Relative notified</h4>
            <p>Email with order details, payable amount, and UPI QR + cash options</p>
          </div>
          <div class="workflow-step">
            <div class="workflow-step-num">4</div>
            <h4>Collection &amp; payment</h4>
            <p>Relative collects medicines; cash confirmed by staff or UPI verified online</p>
          </div>
        </div>
      </section>

      <!-- Role cards -->
      <section class="role-section">
        <div class="section-heading reveal">
          <div class="eyebrow">UNIFIED SYSTEM ACCESS</div>
          <h2>All workspaces in one place</h2>
          <p>Click any workspace below to access its live dashboard</p>
        </div>
        <div class="role-grid">
          ${roleCard("doctor",   "✚", "Doctor Desk",              "Create digital prescriptions, add medicines, and dispatch to the pharmacy queue.",         "Dr. Kavita Rao")}
          ${roleCard("staff",    "▦", "Medical Staff Queue",      "Review new orders, prepare medicines, mark as packed, and confirm payments.",              "Anita Mehta")}
          ${roleCard("relative", "◎", "Patient Relative Tracking","Track a prescription, view payment options, and get pickup counter instructions.",          "Patient Relative")}
        </div>
        <div style="display:flex;justify-content:center;gap:12px;margin-top:22px;flex-wrap:wrap;">
          <a class="btn btn-outline btn-sm" href="inventory.html">📦 Medicine Inventory</a>
          <a class="btn btn-outline btn-sm" href="billing.html">₹ Billing &amp; Payments</a>
          <button class="btn btn-outline btn-sm" id="viewEmailLogsBtn2" type="button">📧 Email Audit Logs</button>
        </div>
      </section>

      <footer class="home-footer">
        <span>MEDIFLOW · Smart Hospital Medicine Queue &amp; Preparation System</span>
        <span>Node.js · Nodemailer · UPI Integration · Real-time Sync</span>
      </footer>
    </div>`;

    // Fetch live SMTP + payment status
    fetch(getApiUrl("status"))
      .then((r) => r.json())
      .then((data) => {
        const el = byId("homeSmtpStatus");
        if (el && data.emailService) {
          if (data.emailService.smtpConfigured) {
            el.innerHTML = `<i class="secure-dot" style="background:#22c98b"></i>Email: Active (${escapeHtml(data.emailService.senderEmail || "")})`;
          } else {
            el.innerHTML = `<i class="secure-dot" style="background:#f59e0b"></i>Email: Dev Mode (Simulated)`;
          }
        }
      })
      .catch(() => {});

    byId("viewEmailLogsBtn")?.addEventListener("click", openEmailLogsModal);
    byId("viewEmailLogsBtn2")?.addEventListener("click", openEmailLogsModal);
    byId("runDiagnosticsBtn")?.addEventListener("click", openDiagnosticsModal);

    document.querySelectorAll("[data-login-role]").forEach((btn) => btn.addEventListener("click", () => {
      currentSession = setSession(btn.dataset.loginRole, btn.dataset.loginName);
      window.location.href = btn.dataset.loginRole === "doctor" ? "doctor.html" : btn.dataset.loginRole === "staff" ? "staff.html" : "relative.html";
    }));

    initScrollReveal();
  }

  /* ══════════════════════════════════════════════════════════
     DOCTOR WORKSPACE
     ══════════════════════════════════════════════════════════ */
  function renderDoctor() {
    const state      = loadState();
    const currentDoc = currentSession ? currentSession.name : "Dr. Kavita Rao";
    const mine       = state.requests.filter((r) => !r.doctor || r.doctor === currentDoc || !currentSession);
    const emergency  = mine.filter((r) => r.priority === "HIGH").length;
    const regular    = mine.length - emergency;
    const completed  = mine.filter((r) => normalizeStatus(r.status) === "Collected").length;
    const deptOpts   = Object.keys(DEPARTMENTS).map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");

    const html = `
      ${pageHeading("DOCTOR WORKSPACE", "Prescription desk",
        "Create a digital prescription and dispatch it to the pharmacy queue.",
        `<div style="display:flex;align-items:center;gap:10px;">
           <span class="db-badge"><i class="secure-dot"></i>Database: Active</span>
           <span class="date-chip">${new Date().toLocaleDateString("en-IN", { weekday:"short", day:"numeric", month:"short", year:"numeric" })}</span>
         </div>`)}

      <div class="stats-grid">
        ${statCard("Stored in database", mine.length,  "▤", "",       "Patient records in DB")}
        ${statCard("Emergency cases",    emergency,    "!", "red",    "Prioritized in the queue")}
        ${statCard("Regular cases",      regular,      "•", "green",  "Standard workflow")}
        ${statCard("Completed",          completed,    "✓", "teal",   "Collected by relatives")}
      </div>

      <div class="layout-two">
        <section class="card">
          <div class="card-header">
            <div><h2>Create prescription</h2><p>Complete patient details, add medicines, and notify the pharmacy queue.</p></div>
            <span class="badge badge-blue">NEW PRESCRIPTION</span>
          </div>
          <div class="card-body">
            <form id="prescriptionForm">
              <div class="field-grid">
                <div class="field">
                  <label for="doctorName">Doctor name <span class="required">*</span></label>
                  <input id="doctorName" name="doctorName" value="${escapeHtml(currentDoc)}" required maxlength="80">
                </div>
                <div class="field">
                  <label for="patientName">Patient name <span class="required">*</span></label>
                  <input id="patientName" name="patientName" placeholder="e.g. Ramesh Kumar" required maxlength="80">
                </div>
                <div class="field">
                  <label for="patientId">Patient ID <span class="required">*</span></label>
                  <input id="patientId" name="patientId" placeholder="e.g. MF-P-25001" required maxlength="40">
                </div>
                <div class="field">
                  <label for="patientAge">Age &amp; Gender</label>
                  <input id="patientAge" name="patientAge" placeholder="e.g. 42 / Male" maxlength="40">
                </div>
                <div class="field">
                  <label for="relativeName">Relative name <span class="required">*</span></label>
                  <input id="relativeName" name="relativeName" placeholder="Patient's relative" required maxlength="80">
                </div>
                <div class="field">
                  <label for="relativeMobile">Relative mobile <span class="required">*</span></label>
                  <input id="relativeMobile" name="relativeMobile" inputmode="numeric" pattern="[0-9]{10}" maxlength="10" placeholder="10-digit number" required>
                </div>
                <div class="field full">
                  <label for="patientEmail">Patient / Relative email <span class="required">*</span></label>
                  <input id="patientEmail" name="patientEmail" type="email" placeholder="e.g. relative@gmail.com — receives pickup + payment email" required maxlength="100">
                </div>
                <div class="field">
                  <label for="department">Hospital department <span class="required">*</span></label>
                  <select id="department" name="department" required>
                    <option value="">Select department</option>${deptOpts}
                  </select>
                </div>
                <div class="field">
                  <label for="priority">Priority <span class="required">*</span></label>
                  <select id="priority" name="priority">
                    <option value="REGULAR">🟢 Regular</option>
                    <option value="HIGH">🚨 High priority / Emergency</option>
                  </select>
                </div>
                <div class="field full">
                  <label for="instructions">Prescription instructions / dosage advice</label>
                  <input id="instructions" name="instructions" placeholder="e.g. 1 tablet after food twice daily for 5 days" maxlength="250">
                </div>
                <div class="field full">
                  <label>Government scheme</label>
                  <div class="scheme-toggle">
                    <label class="radio-option"><input type="radio" name="scheme" value="no" checked> No — standard billing</label>
                    <label class="radio-option"><input type="radio" name="scheme" value="yes"> Yes — covered claim</label>
                  </div>
                </div>
                <div class="field full">
                  <label for="medicineSearch">Prescription medicines <span class="required">*</span></label>
                  <input id="medicineSearch" placeholder="Search medicines in the selected department" disabled>
                  <div class="field-hint" id="medicineSearchHint">Select a department to see its medicine list.</div>
                  <div class="medicine-picker" id="medicinePicker"></div>
                  <button class="btn btn-sm" type="button" id="addMedicine" disabled style="margin-top:6px">＋ Add another medicine</button>
                </div>
                <div class="field full" id="emergencyNotice" hidden>
                  <div class="priority-banner">
                    <span>🚨</span>
                    <span><strong>Emergency prescription</strong>High-priority prescriptions appear at the top of the pharmacy queue.</span>
                  </div>
                </div>
              </div>
              <div class="form-actions">
                <span class="field-hint">✓ Records are stored in database and synced with medical staff.</span>
                <button class="btn btn-primary" id="submitPrescriptionBtn" type="submit">Save to database &amp; Send prescription →</button>
              </div>
            </form>
          </div>
        </section>

        <aside class="stack">
          <section class="card">
            <div class="card-header"><div><h2>How it works</h2><p>One connected journey from clinic to counter</p></div></div>
            <div class="card-body">
              <div class="notification-list">
                <div class="notification-item">
                  <span class="notification-mark">1</span>
                  <div><strong>Send &amp; Store</strong><p>Saved in database; staff receives email notification and the order appears in the live queue as "New".</p></div>
                </div>
                <div class="notification-item">
                  <span class="notification-mark">2</span>
                  <div><strong>Accept &amp; Prepare</strong><p>Staff accepts, verifies stock, prepares, and packs the medicine order.</p></div>
                </div>
                <div class="notification-item">
                  <span class="notification-mark">3</span>
                  <div><strong>Ready &amp; Notify</strong><p>Relative receives email with pickup counter, amount, and both payment options (cash + UPI QR).</p></div>
                </div>
              </div>
            </div>
          </section>
          ${impactCard(state)}
        </aside>
      </div>

      <section class="card" style="margin-top:18px">
        <div class="card-header">
          <div><h2>Prescriptions sent &amp; stored in database</h2><p>Records created by your account</p></div>
          <span class="badge badge-teal" id="dbRecordCount">${mine.length} IN DATABASE</span>
        </div>
        <div id="doctorRequests"></div>
      </section>`;

    document.title = "Doctor workspace | MEDIFLOW";
    byId("app").innerHTML = shell("Doctor workspace", html, "doctor");
    setupShell();
    setupDoctorForm();
    renderDoctorRequests();
    animateCounts();
  }

  function setupDoctorForm() {
    const form      = byId("prescriptionForm");
    const dept      = byId("department");
    const picker    = byId("medicinePicker");
    const addBtn    = byId("addMedicine");
    const priority  = byId("priority");
    const search    = byId("medicineSearch");
    const hint      = byId("medicineSearchHint");
    const submitBtn = byId("submitPrescriptionBtn");
    let searchTerm  = "";
    let isSubmitting = false;

    function matchingMedicines() {
      return (DEPARTMENTS[dept.value] || []).filter((n) => n.toLowerCase().includes(searchTerm.toLowerCase()));
    }

    function refreshMedicineSearch() {
      picker.querySelectorAll(".medicine-row select").forEach((sel) => {
        const selected = sel.value;
        const matches  = matchingMedicines();
        const options  = selected && !matches.includes(selected) ? [selected, ...matches] : matches;
        sel.innerHTML  = options.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)} · ${money((loadState().inventory[n] || {}).price || 100)}</option>`).join("");
        if (selected && options.includes(selected)) sel.value = selected;
      });
      const hasMatches = matchingMedicines().length > 0;
      hint.textContent = hasMatches ? "Search narrows medicine list." : "No medicines match this search in the selected department.";
      hint.hidden      = !dept.value;
      addBtn.disabled  = !dept.value || !hasMatches;
    }

    function addMedicineRow() {
      const names = matchingMedicines();
      if (!names.length) return;
      const row = document.createElement("div");
      row.className = "medicine-row";
      row.innerHTML = `
        <select aria-label="Medicine" required>
          ${names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)} · ${money((loadState().inventory[n] || {}).price || 100)}</option>`).join("")}
        </select>
        <input aria-label="Quantity" type="number" min="1" max="500" value="1" required>
        <button type="button" class="remove-medicine" aria-label="Remove medicine">×</button>`;
      picker.appendChild(row);
    }

    function updateMedicines() {
      picker.innerHTML = "";
      if (!dept.value) {
        search.disabled = true;
        hint.textContent = "Select a department to see its medicine list.";
        hint.hidden = false;
        addBtn.disabled = true;
        return;
      }
      search.disabled = false;
      search.value = "";
      searchTerm = "";
      addMedicineRow();
      refreshMedicineSearch();
    }

    dept.addEventListener("change", updateMedicines);
    search.addEventListener("input", () => { searchTerm = search.value.trim(); refreshMedicineSearch(); });
    addBtn.addEventListener("click", addMedicineRow);
    picker.addEventListener("click", (e) => { if (e.target.closest(".remove-medicine")) e.target.closest(".medicine-row").remove(); });
    priority.addEventListener("change", () => { byId("emergencyNotice").hidden = priority.value !== "HIGH"; });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (isSubmitting) return;

      const data        = new FormData(form);
      const patientName = String(data.get("patientName") || "").trim();
      const patientId   = String(data.get("patientId")   || "").trim();
      const patientAge  = String(data.get("patientAge")  || "").trim();
      const relativeName= String(data.get("relativeName")|| "").trim();
      const mobile      = String(data.get("relativeMobile")||"").trim();
      const email       = String(data.get("patientEmail")|| "").trim();
      const department  = String(data.get("department")  || "");
      const instructions= String(data.get("instructions")|| "").trim();
      const medicineRows= [...picker.querySelectorAll(".medicine-row")];
      const doctorName  = String(data.get("doctorName")  || (currentSession ? currentSession.name : "Dr. Kavita Rao")).trim();

      if (!patientName || !patientId || !relativeName || !mobile || !department) {
        showToast("Please fill in all required patient fields.", "error"); return;
      }
      if (!medicineRows.length) {
        showToast("Add at least one medicine.", "error"); return;
      }
      if (!/^\d{10}$/.test(mobile)) {
        showToast("Enter a valid 10-digit relative mobile number.", "error"); return;
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showToast("Please enter a valid email for the relative/patient.", "error"); return;
      }
      if (!email) {
        if (!window.confirm("No email address provided. The relative will not receive pickup or payment notifications. Continue?")) return;
      }

      const state    = loadState();
      const medicines = medicineRows.map((row) => {
        const name = row.querySelector("select").value;
        const qty  = Number(row.querySelector('input[type="number"]').value);
        return { name, qty, price: (state.inventory[name] || {}).price || 100 };
      });
      if (!medicines.every((m) => m.qty >= 1 && Number.isInteger(m.qty))) {
        showToast("Medicine quantities must be whole numbers > 0.", "error"); return;
      }

      isSubmitting  = true;
      submitBtn.disabled = true;
      submitBtn.textContent = "Saving...";

      const prescriptionId = `MF-2026-${state.nextId}`;
      const request = {
        prescriptionId,
        patientName, patientId,
        ageGender: patientAge,
        relativeName,
        mobile,
        patientEmail:  email,
        relativeEmail: email,
        department,
        priority:  data.get("priority"),
        scheme:    data.get("scheme") === "yes",
        doctor:    doctorName,
        doctorId:  currentSession ? (currentSession.id || "DOC-101") : "DOC-101",
        medicines, instructions,
        status:    "New",
        createdAt: Date.now(),
        availability: null, total: null, patientPayable: null,
        claimAmount: null, counter: null, stockDeducted: false, isDemo: false
      };

      try {
        const serverRes  = await postPrescriptionToServer(request);
        const savedRecord = serverRes && serverRes.prescription ? serverRes.prescription : request;

        state.nextId += 1;
        state.requests.unshift(savedRecord);
        addNotification(state, "New prescription sent", `${savedRecord.prescriptionId} · ${patientName} · ${department}`, savedRecord.prescriptionId);
        saveState(state);
        dbSavePrescription(savedRecord);

        if (serverRes && serverRes.emailStatus) {
          if (serverRes.emailStatus.success && !serverRes.emailStatus.skipped) {
            showToast(`✓ Prescription ${savedRecord.prescriptionId} saved! Staff email sent to ${serverRes.emailStatus.recipient}.`);
          } else if (serverRes.emailStatus.skipped) {
            showToast(`✓ Prescription ${savedRecord.prescriptionId} saved in database. (Email skipped: ${serverRes.emailStatus.reason})`, "info");
          } else {
            showToast(`Prescription saved, but staff email delivery failed: ${serverRes.emailStatus.error || "Delivery error"}`, "error");
          }
        } else if (serverRes) {
          showToast(`✓ Prescription ${savedRecord.prescriptionId} saved in database.`);
        } else {
          showToast(`✓ Saved locally. (Run start-server.bat for real email delivery)`, "info");
        }
        form.reset();
        picker.innerHTML = "";
        search.disabled = true;
        search.value    = "";
        searchTerm      = "";
        hint.textContent = "Select a department to see its medicine list.";
        hint.hidden      = false;
        addBtn.disabled  = true;
        byId("emergencyNotice").hidden = true;
        renderDoctor();
      } catch (err) {
        showToast("Error saving prescription: " + err.message, "error");
      } finally {
        isSubmitting = false;
        submitBtn.disabled  = false;
        submitBtn.textContent = "Save to database & Send prescription →";
      }
    });
  }

  function renderDoctorRequests() {
    const state      = loadState();
    const currentDoc = currentSession ? currentSession.name : "Dr. Kavita Rao";
    const mine       = state.requests.filter((r) => !r.doctor || r.doctor === currentDoc || !currentSession).sort((a, b) => b.createdAt - a.createdAt);
    const container  = byId("doctorRequests");
    if (!mine.length) {
      container.innerHTML = `<div class="empty-state">
        <span class="empty-icon">▤</span>
        <strong>No prescriptions in database yet</strong>
        Fill out the form above to add patient records.
      </div>`;
      return;
    }
    container.innerHTML = `<div class="table-scroll"><table class="data-table">
      <thead><tr><th>Prescription</th><th>Patient</th><th>Relative</th><th>Department</th><th>Priority</th><th>Medicines</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${mine.map((r) => `<tr>
        <td><span class="id-text">${escapeHtml(r.prescriptionId)}</span><div class="table-secondary">${timeAgo(r.createdAt)}</div></td>
        <td><span class="table-primary">${escapeHtml(r.patientName)}</span><div class="table-secondary">${escapeHtml(r.patientId)}${r.ageGender ? ` · ${escapeHtml(r.ageGender)}` : ""}</div></td>
        <td>${escapeHtml(r.relativeName)}<div class="table-secondary">${escapeHtml(r.mobile)}</div></td>
        <td><span class="badge badge-blue">${escapeHtml(r.department)}</span></td>
        <td>${r.priority === "HIGH" ? '<span class="badge badge-red">🚨 HIGH</span>' : '<span class="badge badge-green">REGULAR</span>'}</td>
        <td><strong>${r.medicines.length}</strong> items</td>
        <td>${statusBadge(r.status)}</td>
        <td>
          <div style="display:flex;gap:5px;">
            <button class="btn btn-sm" data-action="view-prescription" data-id="${escapeHtml(r.prescriptionId)}">View</button>
            <button class="btn btn-sm btn-danger" data-action="delete-prescription" data-id="${escapeHtml(r.prescriptionId)}">Delete</button>
          </div>
        </td>
      </tr>`).join("")}</tbody>
    </table></div>`;
  }

  /* ══════════════════════════════════════════════════════════
     MEDICAL STAFF WORKSPACE
     ══════════════════════════════════════════════════════════ */
  function staffCounts(requests) {
    const list = requests.map((r) => ({ ...r, status: normalizeStatus(r.status) }));
    return {
      total:     list.length,
      newCases:  list.filter((r) => r.status === "New").length,
      received:  list.filter((r) => r.status === "Received").length,
      emergency: list.filter((r) => r.priority === "HIGH").length,
      preparing: list.filter((r) => r.status === "Preparing").length,
      ready:     list.filter((r) => r.status === "Ready for Collection").length,
      completed: list.filter((r) => r.status === "Collected").length,
      scheme:    list.filter((r) => r.scheme).length
    };
  }

  function sortedRequests(requests) {
    return [...requests].sort((a, b) =>
      a.priority === b.priority ? b.createdAt - a.createdAt : a.priority === "HIGH" ? -1 : 1
    );
  }

  function matchesStaffFilters(r) {
    const term = staffSearch.toLowerCase().trim();
    if (term && ![r.patientName, r.patientId, r.prescriptionId, r.department].join(" ").toLowerCase().includes(term)) return false;
    const status = normalizeStatus(r.status);
    if (staffFilter === "EMERGENCY"  && r.priority !== "HIGH")                   return false;
    if (staffFilter === "REGULAR"    && r.priority === "HIGH")                   return false;
    if (staffFilter === "SCHEME"     && !r.scheme)                               return false;
    if (staffFilter === "NEW"        && status !== "New")                        return false;
    if (staffFilter === "RECEIVED"   && status !== "Received")                   return false;
    if (staffFilter === "PREPARING"  && status !== "Preparing")                  return false;
    if (staffFilter === "READY"      && status !== "Ready for Collection")       return false;
    if (staffFilter === "COMPLETED"  && status !== "Collected")                  return false;
    return true;
  }

  function renderStaff() {
    const state   = loadState();
    const counts  = staffCounts(state.requests);
    const ordered = sortedRequests(state.requests);
    const newRx   = ordered.filter((r) => normalizeStatus(r.status) === "New");
    const queue   = ordered.filter((r) => matchesStaffFilters(r));

    const html = `
      ${pageHeading("MEDICAL STAFF", "Live medicine queue",
        "Prioritized prescriptions move from doctor order through preparation and pickup.",
        `<span class="badge badge-teal"><i class="secure-dot"></i> LIVE QUEUE</span>`)}

      <div class="stats-grid">
        ${statCard("Total queue", counts.total,     "▤", "",      "All active cases")}
        ${statCard("New arrivals",counts.newCases,  "★", "amber", "Awaiting acceptance")}
        ${statCard("Emergency",   counts.emergency, "!", "red",   "High priority")}
        ${statCard("Preparing",   counts.preparing, "↻", "teal",  "Being assembled")}
        ${statCard("Ready",       counts.ready,     "✓", "green", "Relatives notified")}
        ${statCard("Completed",   counts.completed, "✓", "",      "Collected")}
      </div>

      <!-- New Prescriptions -->
      <section class="card" style="border-left:4px solid var(--teal);margin-bottom:20px;">
        <div class="card-header">
          <div>
            <h2>🔔 New Prescriptions from Doctors</h2>
            <p>Incoming orders awaiting acceptance into the preparation queue</p>
          </div>
          <span class="badge ${newRx.length ? "badge-red" : "badge-green"}">${newRx.length} AWAITING</span>
        </div>
        <div class="card-body">
          ${newRx.length
            ? `<div style="display:grid;gap:12px;">${newRx.map(newPrescriptionCard).join("")}</div>`
            : `<div class="empty-state" style="padding:16px;">
                 <span class="empty-icon">✓</span>
                 <strong>All prescriptions accepted</strong>
                 No unaccepted orders from doctors right now.
               </div>`}
        </div>
      </section>

      <!-- Work Queue -->
      <section class="card">
        <div class="card-header">
          <div>
            <h2>Prescription work queue</h2>
            <p>Emergency cases appear before regular prescriptions. Manage preparation and pickup status.</p>
          </div>
          <span class="badge badge-red">🚨 PRIORITY SORTED</span>
        </div>
        <div class="toolbar">
          <div class="search-wrap">
            <input class="search-control" id="staffSearch" placeholder="Search patient, ID, prescription, or department" value="${escapeHtml(staffSearch)}" aria-label="Search prescriptions">
          </div>
          <select class="filter-control" id="staffFilter" aria-label="Filter by status">
            <option value="ALL">All prescriptions (${counts.total})</option>
            <option value="NEW">New (${counts.newCases})</option>
            <option value="RECEIVED">Received (${counts.received})</option>
            <option value="PREPARING">Preparing (${counts.preparing})</option>
            <option value="READY">Ready (${counts.ready})</option>
            <option value="COMPLETED">Completed (${counts.completed})</option>
            <option value="EMERGENCY">Emergency (${counts.emergency})</option>
          </select>
          <span class="badge badge-gray" id="queueCount">${queue.length} CASES</span>
        </div>
        <div id="queueList">
          ${queue.length
            ? queue.map(queueCard).join("")
            : `<div class="empty-state"><span class="empty-icon">▤</span><strong>No matching prescriptions</strong>Try a different filter or search term.</div>`}
        </div>
      </section>

      <div class="layout-two" style="margin-top:18px;">
        <div>${impactCard(state)}</div>
        <div>${notificationPanel(state)}</div>
      </div>`;

    document.title = "Medical staff queue | MEDIFLOW";
    byId("app").innerHTML = shell("Live queue", html, "staff");
    setupShell();

    byId("staffSearch").addEventListener("input", (e) => { staffSearch = e.target.value; updateQueueOnly(); });
    byId("staffFilter").value = staffFilter;
    byId("staffFilter").addEventListener("change", (e) => { staffFilter = e.target.value; updateQueueOnly(); });
    animateCounts();
  }

  function updateQueueOnly() {
    const state   = loadState();
    const visible = sortedRequests(state.requests).filter(matchesStaffFilters);
    const list    = byId("queueList");
    if (!list) return;
    list.innerHTML = visible.length
      ? visible.map(queueCard).join("")
      : `<div class="empty-state"><span class="empty-icon">▤</span><strong>No matching prescriptions</strong>Try a different search or filter.</div>`;
    byId("queueCount").textContent = `${visible.length} CASES`;
  }

  function newPrescriptionCard(r) {
    const meds = r.medicines.map((m) => `${escapeHtml(m.name)} × ${m.qty}`).join(" · ");
    return `<div class="queue-card ${r.priority === "HIGH" ? "urgent" : ""}" style="border-left:4px solid ${r.priority === "HIGH" ? "var(--red)" : "var(--blue-light)"};">
      <div class="queue-card-head">
        <div class="queue-person">
          <span class="mini-avatar">${escapeHtml(initials(r.patientName))}</span>
          <div>
            <h3>${escapeHtml(r.patientName)} <small style="font-weight:400;color:#6a84a0">(${escapeHtml(r.patientId)})</small></h3>
            <p>Doctor: <strong>${escapeHtml(r.doctor || "Dr. Kavita Rao")}</strong> · ${escapeHtml(r.department)}</p>
          </div>
        </div>
        <div style="text-align:right;">
          ${r.priority === "HIGH" ? `<span class="badge badge-red">🚨 EMERGENCY</span>` : `<span class="badge badge-green">🟢 REGULAR</span>`}
          <div style="margin-top:6px;">${statusBadge("New")}</div>
        </div>
      </div>
      <div class="queue-meta" style="margin:10px 0;">
        <span class="id-text">${escapeHtml(r.prescriptionId)}</span>
        <span class="badge badge-blue">${escapeHtml(r.department)}</span>
        <span class="badge badge-gray">Relative: ${escapeHtml(r.relativeName)} · ${escapeHtml(r.mobile || "N/A")}</span>
        ${r.relativeEmail ? `<span class="badge badge-teal">📧 Email on file</span>` : `<span class="badge badge-amber">⚠ No email</span>`}
        <span class="badge badge-gray">${timeAgo(r.createdAt)}</span>
      </div>
      <div class="queue-medicines"><strong>Medicines:</strong> ${meds}</div>
      ${r.instructions ? `<div style="margin-top:8px;font-size:11px;background:var(--amber-bg);padding:7px 10px;border-radius:7px;border-left:3px solid var(--amber-line)"><strong>Instructions:</strong> ${escapeHtml(r.instructions)}</div>` : ""}
      <div class="queue-actions" style="margin-top:12px;">
        <button class="btn btn-primary btn-sm" data-action="accept-prescription" data-id="${escapeHtml(r.prescriptionId)}">✓ Accept &amp; Mark Received</button>
        <button class="btn btn-sm" data-action="view-prescription" data-id="${escapeHtml(r.prescriptionId)}">Inspect details</button>
      </div>
    </div>`;
  }

  function queueCard(r) {
    const status = normalizeStatus(r.status);
    const meds   = r.medicines.map((m) => `${escapeHtml(m.name)} × ${m.qty}`).join(" · ");
    const total  = r.total == null ? totalFor(r) : r.total;

    let action = "";
    if      (status === "New")                  action = `<button class="btn btn-primary btn-sm" data-action="accept-prescription" data-id="${escapeHtml(r.prescriptionId)}">✓ Accept &amp; Mark Received</button>`;
    else if (status === "Received")             action = `<button class="btn btn-primary btn-sm" data-action="prepare" data-id="${escapeHtml(r.prescriptionId)}">Start Preparation →</button>`;
    else if (status === "Preparing")            action = `<button class="btn btn-teal btn-sm" data-action="ready" data-id="${escapeHtml(r.prescriptionId)}">📦 Mark Packed &amp; Notify Relative</button>`;
    else if (status === "Packed" || status === "Ready for Collection") action = `<div style="display:flex;gap:7px;flex-wrap:wrap;align-items:center"><button class="btn btn-sm" data-action="collect" data-id="${escapeHtml(r.prescriptionId)}">Mark Collected ✓</button><button class="btn btn-sm btn-green" data-action="confirm-cash" data-id="${escapeHtml(r.prescriptionId)}">💵 Confirm Cash Payment</button>${r.relativeEmail ? `<button class="btn btn-sm" data-action="resend-email" data-id="${escapeHtml(r.prescriptionId)}" title="Resend pickup email notification to relative">✉ Resend Email</button>` : ""}</div>`;
    else                                        action = `<span class="field-hint">✓ Prescription complete.</span>`;

    return `<article class="queue-card ${r.priority === "HIGH" ? "urgent" : ""}">
      <div class="queue-card-head">
        <div class="queue-person">
          <span class="mini-avatar">${escapeHtml(initials(r.patientName))}</span>
          <div>
            <h3>${escapeHtml(r.patientName)}</h3>
            <p>${escapeHtml(r.patientId)} · ${escapeHtml(r.relativeName)}</p>
          </div>
        </div>
        <div>
          ${r.priority === "HIGH" ? `<span class="badge badge-red">🚨 HIGH</span>` : `<span class="badge badge-green">REGULAR</span>`}
          <div style="margin-top:6px;">${statusBadge(status)}</div>
        </div>
      </div>
      <div class="queue-meta">
        <span class="id-text">${escapeHtml(r.prescriptionId)}</span>
        <span class="badge badge-blue">${escapeHtml(r.department)}</span>
        ${r.scheme ? `<span class="badge badge-teal">GOVT SCHEME</span>` : ""}
        ${r.relativeEmail ? (r.emailHistory && r.emailHistory.readyForCollectionSentAt ? `<span class="badge badge-teal">📧 Pickup Email Sent</span>` : `<span class="badge badge-teal">📧 Email on file</span>`) : `<span class="badge badge-amber">⚠ No email</span>`}
      </div>
      <div class="queue-details">
        <div class="queue-detail"><span>MEDICINES</span><strong>${r.medicines.length} items</strong></div>
        <div class="queue-detail"><span>TOTAL</span><strong>${money(total)}</strong></div>
        <div class="queue-detail"><span>CONTACT</span><strong>${escapeHtml(r.mobile || "N/A")}</strong></div>
        <div class="queue-detail"><span>RECEIVED</span><strong>${timeAgo(r.createdAt)}</strong></div>
      </div>
      <div class="queue-medicines"><strong>Items:</strong> ${meds}</div>
      ${r.instructions ? `<div style="margin-top:8px;font-size:11px;background:var(--amber-bg);padding:7px 10px;border-radius:7px;border-left:3px solid var(--amber-line)"><strong>Instructions:</strong> ${escapeHtml(r.instructions)}</div>` : ""}
      ${r.priority === "HIGH" ? `<div class="priority-banner" style="margin-top:10px"><span>🚨</span><span><strong>Emergency prescription.</strong> Verify and prepare promptly.</span></div>` : ""}
      ${status === "Packed" || status === "Ready for Collection" ? `<div class="store-note" style="margin-top:10px">📍 Assigned to <strong>${escapeHtml(r.counter || "Pharmacy Counter 1")}</strong> · ${r.relativeEmail ? (r.emailHistory && r.emailHistory.readyForCollectionSentAt ? `Pickup email sent to <strong>${escapeHtml(r.relativeEmail)}</strong>` : `Pickup email pending/unsent to <strong>${escapeHtml(r.relativeEmail)}</strong>`) : `No relative email on file`}</div>` : ""}
      <div class="queue-actions">
        ${action}
        <button class="btn btn-sm" data-action="view-prescription" data-id="${escapeHtml(r.prescriptionId)}">Inspect</button>
      </div>
    </article>`;
  }

  /* ── Prescription lifecycle ─────────────────────────────── */
  function acceptPrescription(id) {
    const state = loadState();
    const r = getRequest(state, id);
    if (!r) return;
    r.status = "Received";
    r.acceptedAt = Date.now();
    addNotification(state, "Prescription Accepted", `${r.prescriptionId} accepted into queue.`, id);
    saveState(state);
    updatePrescriptionOnServer(r);
    showToast(`✓ Prescription ${id} accepted.`);
    renderStaff();
  }

  function startPreparation(id) {
    const state = loadState();
    const r = getRequest(state, id);
    if (!r) return;
    if (!r.stockDeducted) {
      r.medicines.forEach((m) => {
        if (state.inventory[m.name]) {
          state.inventory[m.name].quantity = Math.max(0, state.inventory[m.name].quantity - m.qty);
        }
      });
      r.stockDeducted = true;
    }
    r.status = "Preparing";
    r.preparationStartedAt = Date.now();
    addNotification(state, "Preparation started", `${id} · ${r.patientName}'s order is being prepared.`, id);
    saveState(state);
    updatePrescriptionOnServer(r);
    showToast("Preparation started. Inventory updated.");
    renderStaff();
  }

  async function markReady(id) {
    const state = loadState();
    const r = getRequest(state, id);
    if (!r) return;
    const counters = ["Pharmacy Counter 1", "Pharmacy Counter 2", "Pharmacy Counter 3"];
    r.counter  = r.priority === "HIGH" ? "Emergency Counter" : counters[(Number(id.split("-").pop()) - 1) % counters.length];
    r.readyAt  = Date.now();
    r.status   = "Packed";
    // Compute payable
    r.patientPayable = r.scheme ? 0 : totalFor(r);
    addNotification(state, "🔔 Medicine Packed & Ready for Pickup", `Medicines for ${r.patientName} (${r.prescriptionId}) are packed. Collect from ${r.counter}.`, id);
    saveState(state);
    renderStaff();

    const serverRes = await updatePrescriptionOnServer(r);
    if (serverRes && serverRes.emailStatus) {
      if (serverRes.emailStatus.success && !serverRes.emailStatus.skipped) {
        showToast(`✓ Packed! Pickup email sent to ${serverRes.emailStatus.recipient} (Counter: ${r.counter})`);
      } else if (serverRes.emailStatus.skipped) {
        showToast(`✓ Packed at ${r.counter}. (${serverRes.emailStatus.reason})`, "info");
      } else {
        showToast(`Packed at ${r.counter}, but email failed: ${serverRes.emailStatus.error || "Delivery error"}`, "error");
      }
    } else if (serverRes) {
      showToast(`✓ Packed! Relative notified. Counter: ${r.counter}`);
    } else {
      showToast(`✓ Packed locally at ${r.counter}. (Run start-server.bat for real email delivery)`, "info");
    }
    renderStaff();
  }

  function markCollected(id) {
    const state = loadState();
    const r = getRequest(state, id);
    if (!r) return;
    r.status = "Collected";
    r.collectedAt = Date.now();
    addNotification(state, "Prescription Collected", `${r.prescriptionId} collected from ${r.counter}.`, id);
    saveState(state);
    updatePrescriptionOnServer(r);
    showToast("Prescription marked as collected.");
    renderStaff();
  }

  function checkAvailability(id) {
    const state = loadState();
    const r = getRequest(state, id);
    if (!r) return;
    r.availability = r.medicines.map((m) => {
      const stock = state.inventory[m.name] ? state.inventory[m.name].quantity : 0;
      return { name: m.name, qty: m.qty, stock, available: stock >= m.qty };
    });
    saveState(state);
    updatePrescriptionOnServer(r);
    showToast("Stock availability checked.");
    renderStaff();
  }

  async function confirmCashPayment(id) {
    const state = loadState();
    const r     = getRequest(state, id);
    if (!r) return;
    const staffName = currentSession ? currentSession.name : "Staff";
    try {
      const res = await fetch(getApiUrl("payments/confirm-cash"), {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ prescriptionId: id, staffName })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(`✓ Cash payment of ${money(data.payment.amount)} confirmed for ${id}.`);
      } else {
        showToast(data.error || "Failed to confirm cash payment.", "error");
      }
    } catch (e) {
      showToast("Network error: " + e.message, "error");
    }
  }

  /* ══════════════════════════════════════════════════════════
     PATIENT RELATIVE TRACKING
     ══════════════════════════════════════════════════════════ */
  function renderRelative() {
    const state  = loadState();
    const found  = selectedRelativeId
      ? state.requests.find((r) => r.prescriptionId.toLowerCase() === selectedRelativeId.toLowerCase())
        || state.requests.filter((r) => r.patientId.toLowerCase() === selectedRelativeId.toLowerCase()).sort((a, b) => b.createdAt - a.createdAt)[0]
      : null;

    const active = state.requests.filter((r) => normalizeStatus(r.status) !== "Collected");
    const ready  = state.requests.filter((r) => normalizeStatus(r.status) === "Ready for Collection");

    const html = `
      ${pageHeading("PATIENT RELATIVE", "Track a prescription",
        "Check preparation progress, billing and collection instructions using a patient ID or prescription ID.",
        `<span class="badge badge-green">SELF-SERVICE TRACKING</span>`)}

      <div class="stats-grid">
        ${statCard("Active in queue",  active.length, "◎", "",      "Prescriptions in progress")}
        ${statCard("Ready for pickup", ready.length,  "✓", "green", "Awaiting collection")}
        ${statCard("Traditional wait", "45 min",      "◷", "amber", "Hospital estimate")}
        ${statCard("MEDIFLOW time",    "15 min",      "↯", "teal",  "Tracked workflow")}
      </div>

      <section class="card">
        <div class="card-header">
          <div><h2>Find your prescription</h2><p>Enter your Hospital Patient ID or the MEDIFLOW Prescription ID to track progress and view payment options.</p></div>
          <span class="badge badge-navy">PRIVATE LOOKUP</span>
        </div>
        <div class="card-body">
          <form id="relativeSearchForm" class="relative-search">
            <input id="relativeQuery" value="${escapeHtml(selectedRelativeId)}" placeholder="Enter Patient ID or Prescription ID (e.g. MF-2026-1001)" aria-label="Patient or prescription ID" required>
            <button class="btn btn-primary" type="submit">Track →</button>
          </form>
          ${state.requests.length ? `
            <div class="recent-chips">
              <span style="color:var(--muted);font-size:11px;">Recent in queue:</span>
              ${state.requests.slice(0, 5).map((r) => `
                <button type="button" class="recent-chip" data-quick-track="${escapeHtml(r.patientId)}">
                  <strong>${escapeHtml(r.patientId)}</strong> · ${escapeHtml(r.patientName)}
                </button>`).join("")}
            </div>` : ""}
          <p class="footer-hint">Your information is only visible to you. Relatives must provide a specific Patient ID or Prescription ID to access records.</p>
        </div>
      </section>

      ${selectedRelativeId
        ? found
          ? relativeDetails(found)
          : `<section class="card" style="margin-top:18px"><div class="empty-state"><span class="empty-icon">⌕</span><strong>No prescription found</strong>Check the ID and try again. IDs are case-sensitive.</div></section>`
        : `<section class="card" style="margin-top:18px"><div class="empty-state"><span class="empty-icon">◎</span><strong>Enter an ID to begin tracking</strong>Use your patient ID or prescription ID to view real-time status and payment options.</div></section>`}

      <div class="layout-two" style="margin-top:18px;">
        ${impactCard(state)}
        ${notificationPanel(state)}
      </div>`;

    document.title = "Patient relative | MEDIFLOW";
    byId("app").innerHTML = shell("Track prescription", html, "relative");
    setupShell();

    byId("relativeSearchForm").addEventListener("submit", (e) => {
      e.preventDefault();
      selectedRelativeId = byId("relativeQuery").value.trim();
      renderRelative();
    });

    // Load payment info for found prescription (fires once after render)
    if (found) {
      const isReady = normalizeStatus(found.status) === "Ready for Collection";

      // Always load payment status
      const loadPaymentStatus = () => {
        fetch(`${getApiUrl("payments")}?prescriptionId=${encodeURIComponent(found.prescriptionId)}`, {
          headers: { "x-user-role": "relative" }
        }).then((r) => r.json()).then((data) => {
          const paymentEl = byId("paymentStatusContainer");
          if (!paymentEl) return;
          if (data.payment && data.payment.status && data.payment.status !== "Pending") {
            paymentEl.innerHTML = `
              <div style="margin-top:12px;padding:12px;background:#f7fafc;border:1px solid var(--line);border-radius:10px;">
                <strong style="display:block;margin-bottom:6px;font-size:12px;color:var(--ink-3);">Payment Status</strong>
                ${paymentBadge(data.payment.status)}
                ${data.payment.status === "Paid by Cash"
                  ? `<div style="margin-top:6px;font-size:11px;color:var(--muted);">Confirmed by: ${escapeHtml(data.payment.confirmedBy || "Staff")} · ${fmtDate(data.payment.confirmedAt)}</div>`
                  : ""}
                ${data.payment.status === "Paid Online"
                  ? `<div style="margin-top:6px;font-size:11px;color:var(--muted);">Online payment verified · ${fmtDate(data.payment.confirmedAt)}</div>`
                  : ""}
              </div>`;
          }
        }).catch(() => {});
      };

      // Load UPI QR only when Ready for Collection — uses GET first to avoid creating duplicate records
      const loadUpiPayment = () => {
        if (!isReady) return;
        const upiEl = byId("upiPaymentContainer");
        if (!upiEl) return;

        // First try GET to see if a payment record already exists
        fetch(`${getApiUrl("payments")}?prescriptionId=${encodeURIComponent(found.prescriptionId)}`, {
          headers: { "x-user-role": "relative" }
        }).then((r) => r.json()).then((data) => {
          if (data.payment && data.payment.qrUrl) {
            // Existing payment record found — use it
            renderUpiBox(upiEl, data.payment, data.payment.upiLink, data.payment.qrUrl);
          } else {
            // No record yet — initiate (creates exactly one pending record)
            return fetch(getApiUrl("payments/initiate"), {
              method: "POST",
              headers: getAuthHeaders(),
              body: JSON.stringify({ prescriptionId: found.prescriptionId })
            }).then((r) => r.json()).then((initData) => {
              if (initData.payment && initData.qrUrl) {
                renderUpiBox(upiEl, initData.payment, initData.upiLink, initData.qrUrl);
              } else if (initData.schemeOrder) {
                upiEl.innerHTML = `<div class="scheme-callout">✅ Covered under Government Scheme — no payment required.</div>`;
              }
            });
          }
        }).catch(() => {
          const el = byId("upiPaymentContainer");
          if (el) el.innerHTML = `<div style="font-size:11px;color:var(--muted);padding:10px;">Could not load payment info. Please refresh.</div>`;
        });
      };

      function renderUpiBox(container, payment, upiLink, qrUrl) {
        if (payment.status === "Paid Online" || payment.status === "Paid by Cash") {
          container.innerHTML = `
            <div style="padding:14px;background:var(--green-bg);border:1px solid var(--green-line);border-radius:10px;text-align:center;">
              ${paymentBadge(payment.status)}
              <p style="margin:8px 0 0;font-size:11.5px;color:var(--green);">Payment already confirmed — no action needed.</p>
            </div>`;
          return;
        }
        container.innerHTML = `
          <div class="qr-box">
            <img src="${escapeHtml(qrUrl)}" alt="UPI QR Code — scan to pay ${money(payment.amount)}" width="160" height="160" loading="lazy">
            <div class="qr-amount">${money(payment.amount)}</div>
            <div class="qr-ref">Order: ${escapeHtml(payment.prescriptionId)}</div>
            ${upiLink ? `<a href="${escapeHtml(upiLink)}" class="btn btn-green" style="margin-top:12px;display:inline-flex;">📲 Open UPI App</a>` : ""}
            <p style="margin:10px 0 0;font-size:10.5px;color:var(--muted);">Scan with Google Pay, PhonePe, Paytm, or BHIM UPI</p>
          </div>`;
      }

      loadPaymentStatus();
      loadUpiPayment();
    }
    animateCounts();
  }

  function relativeDetails(r) {
    const total       = r.total == null ? totalFor(r) : r.total;
    const payable     = r.patientPayable != null ? r.patientPayable : total;
    const norm        = normalizeStatus(r.status);
    const statusIndex = Math.max(0, STATUSES.indexOf(norm));
    const isReady     = norm === "Packed" || norm === "Ready for Collection";
    const isScheme    = r.scheme;

    const tracker = `<div class="status-progress" aria-label="Prescription progress">
      ${STEPS.map((step, i) => `
        <div class="progress-step ${i < statusIndex ? "done" : ""} ${i === statusIndex ? "current" : ""}">
          <span class="step-dot">${i < statusIndex ? "✓" : i + 1}</span>
          <span class="step-label">${step}</span>
        </div>`).join("")}
    </div>`;

    const readyBanner = isReady ? `
      <div style="background:linear-gradient(135deg, var(--teal-dark) 0%, var(--teal) 100%);color:white;padding:22px 24px;border-radius:14px;text-align:center;margin-bottom:20px;box-shadow:0 8px 24px rgba(14,148,136,0.2);">
        <span style="display:inline-block;background:rgba(255,255,255,0.2);padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.04em;margin-bottom:10px;">PICKUP READY</span>
        <h2 style="margin:0 0 8px;font-size:22px;font-weight:800;letter-spacing:-0.03em;">Your Medicine Order Is Ready for Pickup</h2>
        <p style="margin:0;font-size:14px;opacity:.94;">
          Please proceed to <strong>${escapeHtml(r.counter || "Pharmacy Counter 1")}</strong> at City Hospital Pharmacy (Ground Floor, OPD Wing).
        </p>
      </div>` : "";

    const paymentSection = isReady ? `
      <div style="margin-top:18px;">
        <div class="card-header" style="padding:12px 0 8px;"><div><h3>Payment options</h3><p>Two convenient payment methods available for this order</p></div></div>
        <div id="paymentStatusContainer"></div>
        <div class="payment-options">
          <!-- Option A: Cash on Pickup -->
          <div class="payment-option">
            <div class="payment-option-header">
              <span class="payment-option-icon cash">💵</span>
              <div>
                <h3>Option A: Cash on Pickup</h3>
                <span style="font-size:10.5px;color:var(--muted)">Pay at collection counter</span>
              </div>
            </div>
            <p style="margin-top:6px;font-size:12px;color:var(--ink-2);line-height:1.6;">
              Pay by cash when collecting your packed medicine order at the hospital pharmacy.
            </p>
            <div style="margin-top:10px;padding:10px;background:var(--amber-bg);border:1px solid var(--amber-line);border-radius:8px;font-size:11.5px;">
              <div>Order Reference: <strong style="font-family:monospace;">${escapeHtml(r.prescriptionId)}</strong></div>
              <div>Collection Counter: <strong>${escapeHtml(r.counter || "Pharmacy Counter 1")}</strong></div>
              <div style="margin-top:6px;font-weight:700;color:var(--amber);">Payable Amount: ${money(payable)}</div>
            </div>
            ${isScheme ? `<div class="scheme-callout" style="margin-top:8px;">✅ Covered under Government Scheme — no cash payment required</div>` : `<div class="bill-line total" style="margin-top:8px;"><strong>You pay:</strong><strong>${money(payable)}</strong></div>`}
            <p style="margin-top:8px;font-size:10.5px;color:var(--muted)">Payment status remains Pending until authorized pharmacy staff confirm receipt of cash.</p>
          </div>

          <!-- Option B: Online UPI Payment -->
          <div class="payment-option upi-option">
            <div class="payment-option-header">
              <span class="payment-option-icon upi">📲</span>
              <div>
                <h3>Option B: Online UPI Payment</h3>
                <span style="font-size:10.5px;color:var(--muted)">Instant contactless payment</span>
              </div>
            </div>
            <p style="margin-top:6px;font-size:12px;color:var(--ink-2);line-height:1.6;">
              Pay <strong>${money(payable)}</strong> securely via any UPI app — Google Pay, PhonePe, Paytm, BHIM.
            </p>
            <div id="upiPaymentContainer" style="margin-top:10px;">
              <div class="skeleton" style="height:220px;border-radius:10px;"></div>
            </div>
            <p style="margin-top:8px;font-size:10.5px;color:var(--muted)">Payment is verified automatically server-side before updating status.</p>
          </div>
        </div>
      </div>` : "";

    return `<section class="card" style="margin-top:18px;">
      <div class="card-header">
        <div>
          <h2>Prescription details</h2>
          <p>${escapeHtml(r.prescriptionId)} · submitted ${timeAgo(r.createdAt)}</p>
        </div>
        ${r.priority === "HIGH" ? `<span class="badge badge-red">🚨 HIGH PRIORITY</span>` : `<span class="badge badge-green">REGULAR</span>`}
      </div>
      <div class="card-body">
        ${readyBanner}
        <div class="field-grid" style="margin-bottom:18px;">
          <div class="field"><label>Patient name</label><div class="table-primary">${escapeHtml(r.patientName)}</div></div>
          <div class="field"><label>Patient ID</label><div class="table-primary">${escapeHtml(r.patientId)}</div></div>
          <div class="field"><label>Department</label><div class="table-primary">${escapeHtml(r.department)}</div></div>
          <div class="field"><label>Prescription status</label>${statusBadge(r.status)}</div>
        </div>
        ${tracker}
        <div class="layout-two">
          <div>
            <div class="card-header" style="padding:10px 0;">
              <div><h3>Medicine list</h3><p>Items and quantities prescribed</p></div>
            </div>
            <table class="medicine-table">
              <tbody>
                ${r.medicines.map((m) => `<tr><td>${escapeHtml(m.name)} <span class="table-secondary">× ${m.qty}</span></td><td>${money(m.qty * m.price)}</td></tr>`).join("")}
              </tbody>
            </table>
            ${r.instructions ? `<div style="margin-top:12px;font-size:12px;background:var(--amber-bg);padding:10px;border-radius:8px;border-left:3px solid var(--amber-line)"><strong>Doctor's Advice:</strong> ${escapeHtml(r.instructions)}</div>` : ""}
            <div class="bill-summary" style="margin-top:14px;">
              <div class="bill-line"><span>Subtotal</span><strong>${money(total)}</strong></div>
              ${isScheme ? `<div class="bill-line"><span>Government scheme</span><strong style="color:var(--green);">−${money(total)} (covered)</strong></div>` : ""}
              <div class="bill-line total"><strong>Total payable</strong><strong>${isScheme ? "₹0 (Scheme)" : money(payable)}</strong></div>
            </div>
          </div>
          <div class="stack">
            <div>
              <div class="card-header" style="padding:10px 0;"><div><h3>Collection</h3></div></div>
              <div class="counter-box">
                <span>Pharmacy Counter</span>
                <strong>${escapeHtml(r.counter || (isReady ? "Pharmacy Counter 1" : "To be assigned"))}</strong>
              </div>
              <div class="store-note">
                ${norm === "Collected" ? "This prescription has been collected. Thank you." :
                  isReady ? `Proceed to <strong>${escapeHtml(r.counter || "Pharmacy Counter 1")}</strong> to receive your medication.` :
                  "Your medication is being processed by the pharmacy team."}
              </div>
            </div>
          </div>
        </div>
        ${paymentSection}
      </div>
    </section>`;
  }

  /* ══════════════════════════════════════════════════════════
     INVENTORY WORKSPACE
     ══════════════════════════════════════════════════════════ */
  function renderInventory() {
    const state = loadState();
    const items = Object.values(state.inventory).sort((a, b) => a.name.localeCompare(b.name)).filter((item) => {
      const term = inventorySearch.toLowerCase().trim();
      const matchTerm = !term || item.name.toLowerCase().includes(term) || item.departments.some((d) => d.toLowerCase().includes(term));
      const matchDept = inventoryDept === "ALL" || item.departments.includes(inventoryDept);
      const matchStk  = inventoryStock === "ALL"
        || (inventoryStock === "OUT" ? item.quantity === 0
          : inventoryStock === "LOW" ? item.quantity > 0 && item.quantity <= 10
          : item.quantity > 10);
      return matchTerm && matchDept && matchStk;
    });

    const rows = items.map((item) => {
      const [stockLabel, stockCls] = item.quantity === 0 ? ["Out of stock", "badge-red"]
        : item.quantity <= 10 ? ["Low stock", "badge-amber"] : ["In stock", "badge-green"];
      return `<tr>
        <td><span class="table-primary">${escapeHtml(item.name)}</span><div class="table-secondary">${item.departments.length} dept${item.departments.length > 1 ? "s" : ""}</div></td>
        <td>${escapeHtml(item.departments.join(", "))}</td>
        <td><strong>${item.quantity}</strong> units</td>
        <td>${money(item.price)}</td>
        <td><span class="badge ${stockCls}">${stockLabel}</span></td>
        <td>
          <div style="display:flex;gap:5px;">
            <button class="btn btn-sm" data-action="stock-down" data-name="${escapeHtml(item.name)}" aria-label="Decrease stock">−</button>
            <button class="btn btn-sm" data-action="stock-up"   data-name="${escapeHtml(item.name)}" aria-label="Increase stock">＋</button>
          </div>
        </td>
      </tr>`;
    }).join("");

    const outOfStock = Object.values(state.inventory).filter((i) => i.quantity === 0).length;
    const lowStock   = Object.values(state.inventory).filter((i) => i.quantity > 0 && i.quantity <= 10).length;

    const html = `
      ${pageHeading("PHARMACY OPERATIONS", "Medicine inventory",
        "Monitor department stock, adjust quantities and see availability update across the queue.",
        `<span class="badge badge-blue">${Object.keys(state.inventory).length} CATALOG ITEMS</span>`)}

      <div class="stats-grid">
        ${statCard("Catalog medicines", Object.keys(state.inventory).length, "▤", "",      "Department-linked items")}
        ${statCard("In stock",          Object.values(state.inventory).filter((i) => i.quantity > 10).length, "✓", "green", "> 10 units available")}
        ${statCard("Low stock",         lowStock,   "!", "amber", "10 units or fewer")}
        ${statCard("Out of stock",      outOfStock, "×", "red",   "Unavailable")}
      </div>

      <section class="card">
        <div class="card-header">
          <div><h2>Inventory register</h2><p>Preparation deducts ordered quantities automatically.</p></div>
          <span class="badge badge-teal">LIVE STOCK</span>
        </div>
        <div class="toolbar">
          <div class="search-wrap">
            <input class="search-control" id="inventorySearch" placeholder="Search medicine or department" value="${escapeHtml(inventorySearch)}" aria-label="Search inventory">
          </div>
          <select class="filter-control" id="inventoryDept" aria-label="Filter by department">
            <option value="ALL">All departments</option>
            ${Object.keys(DEPARTMENTS).map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("")}
          </select>
          <select class="filter-control" id="inventoryStock" aria-label="Filter by stock">
            <option value="ALL">All stock status</option>
            <option value="IN">In stock</option>
            <option value="LOW">Low stock</option>
            <option value="OUT">Out of stock</option>
          </select>
          <span class="badge badge-gray" id="inventoryCount">${items.length} ITEMS</span>
        </div>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Medicine</th><th>Department</th><th>Available qty</th><th>Unit price</th><th>Status</th><th>Adjust</th></tr></thead>
            <tbody id="inventoryRows">
              ${rows || `<tr><td colspan="6"><div class="empty-state">No items match the selected filters.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
      <div style="margin-top:18px;">${notificationPanel(state)}</div>`;

    document.title = "Medicine inventory | MEDIFLOW";
    byId("app").innerHTML = shell("Medicine inventory", html, "staff");
    setupShell();

    byId("inventorySearch").addEventListener("input", (e) => { inventorySearch = e.target.value; renderInventory(); });
    byId("inventoryDept").value = inventoryDept;
    byId("inventoryDept").addEventListener("change", (e) => { inventoryDept = e.target.value; renderInventory(); });
    byId("inventoryStock").value = inventoryStock;
    byId("inventoryStock").addEventListener("change", (e) => { inventoryStock = e.target.value; renderInventory(); });
    animateCounts();
  }

  function adjustStock(name, amount) {
    mutate((state) => {
      if (state.inventory[name]) state.inventory[name].quantity = Math.max(0, state.inventory[name].quantity + amount);
    });
    renderInventory();
  }

  /* ══════════════════════════════════════════════════════════
     BILLING & PAYMENTS WORKSPACE
     ══════════════════════════════════════════════════════════ */
  function renderBilling() {
    const state   = loadState();
    const billed  = state.requests.filter((r) => normalizeStatus(r.status) !== "New");
    const totalBilled = billed.reduce((s, r) => s + totalFor(r), 0);
    const paidCash    = billed.filter((r) => r.paymentStatus === "Paid by Cash").length;
    const paidOnline  = billed.filter((r) => r.paymentStatus === "Paid Online").length;

    const html = `
      ${pageHeading("PHARMACY BILLING", "Bills &amp; Payments",
        "Track charges, payment status, government scheme claims, and cash confirmations.",
        `<span class="badge badge-teal">LIVE BILLING</span>`)}

      <div class="stats-grid">
        ${statCard("Total billed",    money(totalBilled), "₹", "teal", "Cumulative orders")}
        ${statCard("Processed cases", billed.length,      "▤", "",     "Active orders")}
        ${statCard("Cash paid",       paidCash,           "💵","green", "Confirmed by staff")}
        ${statCard("Online paid",     paidOnline,         "📲","teal",  "UPI confirmed")}
      </div>

      <section class="card">
        <div class="card-header">
          <div><h2>Prescription billing register</h2><p>Payment status and billing overview for all orders</p></div>
          <div style="display:flex;gap:8px;align-items:center;">
            <button class="btn btn-sm btn-outline" id="refreshPaymentsBtn" type="button">↻ Refresh payments</button>
          </div>
        </div>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Prescription</th><th>Patient</th><th>Department</th><th>Medicines</th><th>Total</th><th>Order Status</th><th>Payment</th><th>Actions</th></tr></thead>
            <tbody id="billingBody">
              ${billed.length ? billed.map((r) => `<tr>
                <td><span class="id-text">${escapeHtml(r.prescriptionId)}</span><div class="table-secondary">${timeAgo(r.createdAt)}</div></td>
                <td><span class="table-primary">${escapeHtml(r.patientName)}</span><div class="table-secondary">${escapeHtml(r.patientId)}</div></td>
                <td><span class="badge badge-blue">${escapeHtml(r.department)}</span></td>
                <td>${r.medicines.length} items</td>
                <td><strong>${money(totalFor(r))}</strong></td>
                <td>${statusBadge(r.status)}</td>
                <td><span class="payment-status payment-pending" id="pay-${escapeHtml(r.prescriptionId)}">⏳ Loading...</span></td>
                <td>
                  <div style="display:flex;gap:5px;flex-wrap:wrap;">
                    <button class="btn btn-sm" data-action="view-prescription" data-id="${escapeHtml(r.prescriptionId)}">Inspect</button>
                    ${normalizeStatus(r.status) === "Ready for Collection" ? `<button class="btn btn-sm btn-green" data-action="confirm-cash" data-id="${escapeHtml(r.prescriptionId)}">💵 Cash Paid</button>` : ""}
                  </div>
                </td>
              </tr>`).join("") : `<tr><td colspan="8"><div class="empty-state">No bills recorded yet.</div></td></tr>`}
            </tbody>
          </table>
        </div>
      </section>`;

    document.title = "Billing & payments | MEDIFLOW";
    byId("app").innerHTML = shell("Billing & payments", html, "staff");
    setupShell();
    animateCounts();

    // Load payment statuses asynchronously
    async function loadPaymentStatuses() {
      try {
        const res  = await fetch(getApiUrl("payments"), { headers: getAuthHeaders() });
        const data = await res.json();
        if (data.payments) {
          data.payments.forEach((p) => {
            const el = byId(`pay-${p.prescriptionId}`);
            if (el) el.outerHTML = paymentBadge(p.status);
          });
        }
        // Any remaining "Loading..." → Pending
        document.querySelectorAll('[id^="pay-"]').forEach((el) => {
          if (el.textContent.includes("Loading")) el.outerHTML = paymentBadge("Pending");
        });
      } catch (e) {}
    }
    loadPaymentStatuses();
    byId("refreshPaymentsBtn")?.addEventListener("click", loadPaymentStatuses);
  }

  /* ── Modals ─────────────────────────────────────────────── */
  function showPrescriptionDetailsModal(r) {
    const total = r.total == null ? totalFor(r) : r.total;
    const dlg   = document.createElement("dialog");
    dlg.style.cssText = "width:min(640px,calc(100vw - 30px));max-height:88vh;overflow:auto;border:1px solid #e1eaf2;border-radius:16px;padding:0;box-shadow:0 30px 90px rgba(15,46,76,.22)";
    dlg.innerHTML = `
      <div class="card-header">
        <div><h2>Prescription &amp; Patient details</h2><p>${escapeHtml(r.prescriptionId)} · Stored in database</p></div>
        <button class="btn btn-sm" data-close-dialog type="button">Close</button>
      </div>
      <div class="card-body">
        <div class="field-grid" style="margin-bottom:14px;">
          <div class="field"><label>Patient name</label><strong>${escapeHtml(r.patientName)}</strong></div>
          <div class="field"><label>Patient ID</label><strong>${escapeHtml(r.patientId)}</strong></div>
          ${r.ageGender ? `<div class="field"><label>Age &amp; Gender</label><strong>${escapeHtml(r.ageGender)}</strong></div>` : ""}
          <div class="field"><label>Doctor</label><strong>${escapeHtml(r.doctor || "Dr. Kavita Rao")}</strong></div>
          <div class="field"><label>Relative name</label><strong>${escapeHtml(r.relativeName)}</strong></div>
          <div class="field"><label>Mobile</label><strong>${escapeHtml(r.mobile)}</strong></div>
          ${r.relativeEmail ? `<div class="field"><label>Email</label><strong>${escapeHtml(r.relativeEmail)}</strong></div>` : ""}
          <div class="field"><label>Department</label><strong>${escapeHtml(r.department)}</strong></div>
          <div class="field"><label>Priority</label>${r.priority === "HIGH" ? `<span class="badge badge-red">🚨 HIGH PRIORITY</span>` : `<span class="badge badge-green">REGULAR</span>`}</div>
          <div class="field"><label>Status</label>${statusBadge(r.status)}</div>
        </div>
        ${r.instructions ? `<div style="margin:10px 0;background:var(--amber-bg);padding:10px;border-radius:8px;border-left:3px solid var(--amber-line);font-size:12px"><strong>Doctor's Advice:</strong> ${escapeHtml(r.instructions)}</div>` : ""}
        <div style="margin:14px 0;">
          <label style="font-weight:700;font-size:11px;color:#3d566d;display:block;margin-bottom:8px;">Prescribed medicines</label>
          <table class="medicine-table" style="width:100%">
            <tbody>
              ${r.medicines.map((m) => `<tr><td>${escapeHtml(m.name)} <span class="table-secondary">× ${m.qty}</span></td><td style="text-align:right"><strong>${money(m.qty * m.price)}</strong></td></tr>`).join("")}
            </tbody>
          </table>
          <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid var(--line);margin-top:8px;">
            <strong>Total / Payable</strong>
            <strong style="color:var(--navy);font-size:15px;">${money(r.patientPayable != null ? r.patientPayable : total)}</strong>
          </div>
          ${r.counter ? `<div class="store-note">Pickup counter: <strong>${escapeHtml(r.counter)}</strong></div>` : ""}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding-top:12px;border-top:1px solid var(--line);">
          <span class="db-badge">💾 Stored in Database</span>
          <button class="btn btn-sm" data-close-dialog type="button">Close</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("[data-close-dialog]")) dlg.close(); });
    dlg.addEventListener("close", () => dlg.remove());
    dlg.showModal();
  }

  function showNotificationCenter() {
    const state = loadState();
    const dlg   = document.createElement("dialog");
    dlg.style.cssText = "width:min(560px,calc(100vw - 30px));max-height:88vh;overflow:auto;border:1px solid #e1eaf2;border-radius:16px;padding:0;box-shadow:0 30px 90px rgba(15,46,76,.22)";
    const items = state.notifications;
    dlg.innerHTML = `
      <div class="card-header">
        <div><h2>Notification centre</h2><p>${items.filter((n) => !n.read).length} unread · Live workflow</p></div>
        <button class="btn btn-sm" data-close-dialog>Close</button>
      </div>
      <div class="card-body">
        <div class="notification-list">
          ${items.length ? items.map((n) => `
            <article class="notification-item ${n.read ? "" : "unread"}">
              <span class="notification-mark">🔔</span>
              <div>
                <strong>${escapeHtml(n.title)}</strong>
                <p>${escapeHtml(n.message)}</p>
                <time>${timeAgo(n.createdAt)}${n.prescriptionId ? ` · ${escapeHtml(n.prescriptionId)}` : ""}</time>
              </div>
            </article>`).join("")
          : `<div class="empty-state"><strong>You're all caught up</strong>Workflow notifications will appear here.</div>`}
        </div>
        <div class="form-actions">
          <span class="field-hint">Synced with database.</span>
          <button class="btn btn-primary btn-sm" data-mark-read>Mark all read</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg || e.target.closest("[data-close-dialog]")) dlg.close();
      if (e.target.closest("[data-mark-read]")) {
        const s = loadState();
        s.notifications.forEach((n) => { n.read = true; });
        saveState(s);
        fetch(getApiUrl("notifications.php"), {
          method: "POST", headers: getAuthHeaders(),
          body: JSON.stringify({ action: "mark_all_read", role: currentSession ? currentSession.role : "staff" })
        }).catch(() => {});
        dlg.querySelectorAll(".notification-item.unread").forEach((el) => el.classList.remove("unread"));
        dlg.querySelector(".card-header p").textContent = "0 unread · Live workflow";
        e.target.closest("[data-mark-read]").disabled = true;
        document.querySelector(".notification-count")?.remove();
      }
    });
    dlg.addEventListener("close", () => dlg.remove());
    dlg.showModal();
  }

  /* ── Shell setup ────────────────────────────────────────── */
  function setupShell() {
    const toggle  = byId("menuToggle");
    const sidebar = byId("sidebar");
    const overlay = byId("mobileOverlay");
    if (toggle) toggle.addEventListener("click", () => {
      sidebar.classList.toggle("open");
      overlay.classList.toggle("visible");
    });
    if (overlay) overlay.addEventListener("click", () => {
      sidebar.classList.remove("open");
      overlay.classList.remove("visible");
    });
    byId("logoutButton")?.addEventListener("click", () => {
      localStorage.removeItem(SESSION_KEY);
      window.location.href = "index.html";
    });
    byId("notificationButton")?.addEventListener("click", showNotificationCenter);

    const emailChip = byId("topbarEmailStatus");
    if (emailChip) {
      emailChip.addEventListener("click", openDiagnosticsModal);
      fetch(getApiUrl("status"))
        .then((r) => r.json())
        .then((data) => {
          if (data && data.emailService) {
            if (data.emailService.smtpConfigured) {
              const cleanUser = (data.emailService.senderEmail || "").replace(/.*<(.+)>/, "$1");
              emailChip.innerHTML = `<i class="secure-dot" style="background:#22c98b"></i>Email: Active (${escapeHtml(cleanUser)})`;
              emailChip.title = `SMTP Server: ${data.emailService.smtpHost}:${data.emailService.smtpPort} · Click to run email diagnostics`;
            } else {
              emailChip.innerHTML = `<i class="secure-dot" style="background:#f59e0b"></i>Email: Dev Mode`;
              emailChip.title = "Operating in safe simulation mode · Click to run diagnostics";
            }
          }
        })
        .catch(() => {
          emailChip.innerHTML = `<i class="secure-dot" style="background:#ef4444"></i>Server: Offline`;
          emailChip.title = "MEDIFLOW Node server is offline. Run 'start-server.bat' to enable real email delivery.";
        });
    }
  }

  async function resendEmailNotification(id) {
    const state = loadState();
    const r = getRequest(state, id);
    if (!r) return;
    showToast(`Dispatching email for ${id}...`);
    try {
      const res = await fetch(getApiUrl("prescriptions/resend-email"), {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ prescriptionId: id })
      });
      const data = await res.json();
      if (data && data.success) {
        showToast(`✓ Email notification delivered to ${data.emailStatus?.recipient || "recipient"}!`);
        if (!r.emailHistory) r.emailHistory = {};
        if (r.status === "Packed" || r.status === "Ready for Collection") {
          r.emailHistory.readyForCollectionSentAt = new Date().toISOString();
        } else {
          r.emailHistory.newPrescriptionSentAt = new Date().toISOString();
        }
        saveState(state);
        renderCurrentPage();
      } else {
        showToast(`Failed to dispatch email: ${data.emailStatus?.error || data.error || "Unknown error"}`, "error");
      }
    } catch (e) {
      showToast(`Network error resending email: ${e.message}`, "error");
    }
  }

  /* ── Global click handler ───────────────────────────────── */
  function renderCurrentPage() {
    if (!PAGE || PAGE === "home" || PAGE === "index") renderHome();
    else if (PAGE === "doctor")    renderDoctor();
    else if (PAGE === "staff")     renderStaff();
    else if (PAGE === "inventory") renderInventory();
    else if (PAGE === "billing")   renderBilling();
    else if (PAGE === "relative")  renderRelative();
  }

  document.addEventListener("click", (e) => {
    const quickBtn = e.target.closest("[data-quick-track]");
    if (quickBtn) {
      selectedRelativeId = quickBtn.dataset.quickTrack;
      const inp = byId("relativeQuery");
      if (inp) inp.value = selectedRelativeId;
      renderRelative();
      return;
    }

    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const id     = btn.dataset.id;

    if      (action === "accept-prescription") acceptPrescription(id);
    else if (action === "prepare")             startPreparation(id);
    else if (action === "ready")               markReady(id);
    else if (action === "resend-email")        resendEmailNotification(id);
    else if (action === "collect")             markCollected(id);
    else if (action === "check")               checkAvailability(id);
    else if (action === "confirm-cash")        confirmCashPayment(id);
    else if (action === "stock-up")            adjustStock(btn.dataset.name,  1);
    else if (action === "stock-down")          adjustStock(btn.dataset.name, -1);
    else if (action === "view-prescription") {
      const r = getRequest(loadState(), id);
      if (r) showPrescriptionDetailsModal(r);
    }
    else if (action === "delete-prescription") {
      if (!window.confirm(`Delete prescription ${id} from the database?`)) return;
      const state = loadState();
      state.requests = state.requests.filter((r) => r.prescriptionId.toLowerCase() !== id.toLowerCase());
      saveState(state);
      dbDeletePrescription(id);
      deletePrescriptionOnServer(id);
      showToast(`Prescription ${id} removed.`);
      renderCurrentPage();
    }
    else if (action === "read-notifications") {
      const state = loadState();
      state.notifications.forEach((n) => { n.read = true; });
      saveState(state);
      fetch(getApiUrl("notifications.php"), {
        method: "POST", headers: getAuthHeaders(),
        body: JSON.stringify({ action: "mark_all_read", role: currentSession ? currentSession.role : "staff" })
      }).catch(() => {});
      renderCurrentPage();
    }
  });

  /* ── Bootstrap ──────────────────────────────────────────── */
  if (!PAGE || PAGE === "home" || PAGE === "index") {
    renderHome();
  } else {
    currentSession = readSession();
    const permitted = PAGE === "doctor" ? "doctor"
      : ["staff", "inventory", "billing"].includes(PAGE) ? "staff" : "relative";
    if (!currentSession || currentSession.role !== permitted) {
      const defaults = { doctor: "Dr. Kavita Rao", staff: "Medical Staff", relative: "Patient Relative" };
      currentSession = setSession(permitted, defaults[permitted] || "User");
    }

    initIndexedDB().finally(() => {
      syncFromBackend().finally(() => {
        renderCurrentPage();
      });
    });

    setInterval(syncFromBackend, 3500);
  }
})();
