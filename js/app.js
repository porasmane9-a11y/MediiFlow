(() => {
  "use strict";

  const STORAGE_KEY = "mediflow_data_v3";
  const LEGACY_STORAGE_KEY = "mediflow_data_v2";
  const SESSION_KEY = "mediflow_session";
  const DB_NAME = "mediflow_db";
  const DB_VERSION = 1;
  const PAGE = document.body.dataset.page;
  const STATUSES = ["RECEIVED", "CHECKING", "CONFIRMED", "BILLED", "PREPARING", "READY", "COLLECTED"];
  const STATUS_LABELS = {
    RECEIVED: "Prescription Received",
    CHECKING: "Checking Availability",
    CONFIRMED: "Availability Confirmed",
    BILLED: "Billing Complete",
    PREPARING: "Medicine Preparation",
    READY: "Medicine Ready",
    COLLECTED: "Collected"
  };
  const DEPARTMENTS = {
    "Cardiology": ["Amlodipine", "Atorvastatin", "Aspirin", "Clopidogrel", "Metoprolol"],
    "Neurology": ["Levetiracetam", "Gabapentin", "Pregabalin", "Vitamin B Complex", "Neurological Support Medicine"],
    "Oncology": ["Supportive Care Medicine", "Anti-nausea Medicine", "Oral Care Medicine", "Vitamin Supplement", "Sterile Dressing"],
    "Nephrology / Dialysis": ["Calcium Supplement", "Iron Supplement", "Vitamin D Supplement", "Erythropoietin Support Item", "Dialysis Dressing"],
    "Orthopedics": ["Calcium Supplement", "Vitamin D", "Pain Relief Medicine", "Elastic Bandage", "Sterile Bandage"],
    "General Medicine": ["Paracetamol", "Antibiotic", "Vitamin B Complex", "ORS", "Cough Medicine"],
    "General Surgery": ["Antibiotic", "Pain Relief Medicine", "Antiseptic Solution", "Sterile Gauze", "Surgical Dressing"],
    "Pediatrics": ["Pediatric Paracetamol", "Pediatric ORS", "Vitamin Drops", "Pediatric Antibiotic", "Pediatric Syrup"],
    "Gynecology & Obstetrics": ["Iron Supplement", "Folic Acid", "Calcium Supplement", "Vitamin Supplement", "Maternity Support Items"],
    "Pulmonology": ["Inhaler", "Respiratory Medicine", "Cough Medicine", "Nebulization Solution", "Allergy Medicine"],
    "Gastroenterology": ["Antacid", "Acid Reduction Medicine", "Digestive Medicine", "ORS", "Probiotic"],
    "Urology": ["Urinary Care Medicine", "Antibiotic", "Pain Relief Medicine", "Electrolyte Solution", "Supportive Medicine"],
    "Endocrinology": ["Diabetes Medicine", "Thyroid Medicine", "Calcium Supplement", "Vitamin D", "Glucose Monitoring Strips"],
    "ENT": ["Ear Drops", "Nasal Spray", "Throat Medicine", "Antibiotic", "Allergy Medicine"],
    "Ophthalmology": ["Eye Drops", "Lubricating Eye Drops", "Eye Antibiotic", "Eye Dressing", "Eye Care Medicine"],
    "Dermatology": ["Skin Cream", "Antifungal Cream", "Antibiotic Cream", "Skin Lotion", "Dressing Material"],
    "Psychiatry": ["Prescribed Mental Health Medicine", "Sleep Support Medicine", "Vitamin Supplement", "General Supportive Medicine"],
    "Emergency & Trauma": ["Emergency Medicine", "IV Fluid", "Sterile Bandage", "Gauze", "Antiseptic", "Emergency Dressing Kit"],
    "ICU": ["Critical Care Medicine", "IV Fluid", "Sterile Dressing", "Syringes", "Gloves", "ICU Support Items"],
    "Infectious Disease": ["Antibiotic", "Antiviral Support Medicine", "ORS", "Fever Medicine", "Vitamin Supplement"]
  };
  const PRICE_OVERRIDES = {
    "Aspirin": 90, "Atorvastatin": 180, "Metoprolol": 145, "Calcium Supplement": 250,
    "Vitamin B Complex": 180, "Sterile Bandage": 120, "Bandage": 120,
    "Amlodipine": 110, "Clopidogrel": 210, "Paracetamol": 45, "ORS": 35,
    "Iron Supplement": 160, "Folic Acid": 85, "Vitamin D": 130, "Vitamin D Supplement": 150
  };

  // Known legacy demo patient identifiers to purge completely
  const DEMO_PATIENT_IDS = ["MF-P-24018", "MF-P-24019", "MF-P-24020", "MF-P-24021", "MF-P-24022", "MF-P-24023"];
  const DEMO_PATIENT_NAMES = ["Rahul Patil", "Sneha Kulkarni", "Amit Jadhav", "Priya Deshmukh", "Rohit Shinde", "Meera Joshi"];

  function isDemoPatient(req) {
    if (!req) return false;
    return (
      req.isDemo === true ||
      DEMO_PATIENT_IDS.includes(req.patientId) ||
      DEMO_PATIENT_NAMES.includes(req.patientName)
    );
  }

  const STEPS = ["Prescription Received", "Availability Checking", "Availability Confirmed", "Billing", "Medicine Preparation", "Medicine Ready", "Collected"];
  let currentSession = null;
  let selectedRelativeId = "";
  let staffSearch = "";
  let staffFilter = "ALL";
  let inventorySearch = "";
  let inventoryDept = "ALL";
  let inventoryStock = "ALL";
  let idbDatabase = null;

  const escapeHtml = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const money = (value) => `₹${Number(value || 0).toLocaleString("en-IN")}`;
  const initials = (name) => String(name || "MF").split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase();
  const byId = (id) => document.getElementById(id);
  const nowTime = (timestamp) => new Date(timestamp || Date.now()).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const timeAgo = (timestamp) => {
    const minutes = Math.max(0, Math.floor((Date.now() - Number(timestamp || Date.now())) / 60000));
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? `${hours} hr ago` : `${Math.floor(hours / 24)} d ago`;
  };

  // --- IndexedDB BROWSER DATABASE ENGINE ---
  function initIndexedDB() {
    if (!window.indexedDB) {
      console.warn("MEDIFLOW: IndexedDB not supported; using LocalStorage as primary database.");
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains("prescriptions")) {
          const store = db.createObjectStore("prescriptions", { keyPath: "prescriptionId" });
          store.createIndex("patientId", "patientId", { unique: false });
          store.createIndex("doctor", "doctor", { unique: false });
          store.createIndex("department", "department", { unique: false });
          store.createIndex("status", "status", { unique: false });
          store.createIndex("createdAt", "createdAt", { unique: false });
        }
        if (!db.objectStoreNames.contains("inventory")) {
          db.createObjectStore("inventory", { keyPath: "name" });
        }
        if (!db.objectStoreNames.contains("notifications")) {
          db.createObjectStore("notifications", { keyPath: "id" });
        }
      };
      request.onsuccess = (event) => {
        idbDatabase = event.target.result;
        syncStateToIndexedDB(loadState());
        resolve(idbDatabase);
      };
      request.onerror = (err) => {
        console.warn("MEDIFLOW: IndexedDB open failed, using LocalStorage:", err);
        resolve(null);
      };
    });
  }

  function syncStateToIndexedDB(state) {
    if (!idbDatabase) return;
    try {
      const tx = idbDatabase.transaction(["prescriptions", "inventory", "notifications"], "readwrite");
      const pStore = tx.objectStore("prescriptions");
      const iStore = tx.objectStore("inventory");
      const nStore = tx.objectStore("notifications");

      pStore.clear();
      (state.requests || []).forEach((req) => {
        if (!isDemoPatient(req)) pStore.put(req);
      });

      iStore.clear();
      Object.values(state.inventory || {}).forEach((item) => iStore.put(item));

      nStore.clear();
      (state.notifications || []).forEach((item) => nStore.put(item));
    } catch (e) {
      console.warn("MEDIFLOW: Could not sync to IndexedDB:", e);
    }
  }

  function dbSavePrescription(prescription) {
    if (!idbDatabase) return;
    try {
      const tx = idbDatabase.transaction(["prescriptions"], "readwrite");
      tx.objectStore("prescriptions").put(prescription);
    } catch (e) {
      console.warn("MEDIFLOW: IndexedDB save error:", e);
    }
  }

  function dbDeletePrescription(prescriptionId) {
    if (!idbDatabase) return;
    try {
      const tx = idbDatabase.transaction(["prescriptions"], "readwrite");
      tx.objectStore("prescriptions").delete(prescriptionId);
    } catch (e) {
      console.warn("MEDIFLOW: IndexedDB delete error:", e);
    }
  }

  // Graceful sync with backend server (if node server.js is running)
  function postPrescriptionToServer(prescription) {
    try {
      fetch("/api/prescriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prescription)
      }).catch(() => {});
    } catch (e) {}
  }

  function updatePrescriptionOnServer(prescription) {
    try {
      fetch(`/api/prescriptions/${encodeURIComponent(prescription.prescriptionId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prescription)
      }).catch(() => {});
    } catch (e) {}
  }

  function deletePrescriptionOnServer(id) {
    try {
      fetch(`/api/prescriptions/${encodeURIComponent(id)}`, {
        method: "DELETE"
      }).catch(() => {});
    } catch (e) {}
  }

  function catalog() {
    const items = new Map();
    Object.entries(DEPARTMENTS).forEach(([department, medicines]) => medicines.forEach((name) => {
      if (!items.has(name)) items.set(name, { name, departments: [] });
      items.get(name).departments.push(department);
    }));
    return [...items.values()];
  }

  function getPrice(name, index) {
    if (PRICE_OVERRIDES[name]) return PRICE_OVERRIDES[name];
    return 75 + ((name.length * 29 + index * 17) % 195);
  }

  function makeInitialState() {
    const inventory = {};
    catalog().forEach((item, index) => {
      inventory[item.name] = {
        name: item.name,
        departments: item.departments,
        quantity: 8 + ((index * 7 + item.name.length * 3) % 35),
        price: getPrice(item.name, index)
      };
    });
    // Start with completely clean database state - NO DEFAULT DUMMY PATIENT DATA!
    return {
      version: 3,
      nextId: 1001,
      requests: [],
      inventory,
      notifications: []
    };
  }

  function loadState() {
    let saved;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      console.error("MEDIFLOW could not read browser storage.", error);
      return makeInitialState();
    }

    // Clean up any legacy storage and migrate user records (excluding demo patients)
    try {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy && !saved) {
        const parsedLegacy = JSON.parse(legacy);
        const cleanedRequests = (parsedLegacy.requests || []).filter((r) => !isDemoPatient(r));
        const cleanedNotifications = (parsedLegacy.notifications || []).filter((n) => !n.id.startsWith("demo-"));
        const migrated = {
          version: 3,
          nextId: Math.max(1001, Number(parsedLegacy.nextId) || 1001),
          requests: cleanedRequests,
          inventory: parsedLegacy.inventory || makeInitialState().inventory,
          notifications: cleanedNotifications
        };
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        saveState(migrated, false);
        return migrated;
      }
      if (legacy) {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      }
    } catch (legacyErr) {
      // Ignore legacy parsing errors
    }

    if (!saved) {
      const fresh = makeInitialState();
      saveState(fresh, false);
      return fresh;
    }

    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed.requests) && parsed.inventory && Array.isArray(parsed.notifications)) {
        // Enforce removal of default dummy data
        const cleanedRequests = parsed.requests.filter((r) => !isDemoPatient(r));
        const cleanedNotifications = parsed.notifications.filter((n) => !n.id.startsWith("demo-"));
        if (cleanedRequests.length !== parsed.requests.length || cleanedNotifications.length !== parsed.notifications.length) {
          parsed.requests = cleanedRequests;
          parsed.notifications = cleanedNotifications;
          parsed.version = 3;
          saveState(parsed, false);
        }
        return parsed;
      }
    } catch (error) {
      console.error("MEDIFLOW found unreadable saved data; initializing clean state.", error);
    }
    const fresh = makeInitialState();
    saveState(fresh, false);
    return fresh;
  }

  function saveState(state, broadcast = true) {
    try {
      // Guarantee no demo patients remain in storage
      if (Array.isArray(state.requests)) {
        state.requests = state.requests.filter((r) => !isDemoPatient(r));
      }
      if (Array.isArray(state.notifications)) {
        state.notifications = state.notifications.filter((n) => !n.id.startsWith("demo-"));
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("MEDIFLOW could not save data to browser storage.", error);
      window.alert("Your browser could not save this update. Check that local storage is enabled and try again.");
      throw error;
    }
    syncStateToIndexedDB(state);
    if (broadcast) window.dispatchEvent(new CustomEvent("mediflow:update"));
  }


  function readSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    } catch (error) {
      console.error("MEDIFLOW could not read the demo login session.", error);
      return null;
    }
  }

  function setSession(role, name) {
    const session = { role, name, signedInAt: Date.now() };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  function mutate(updater) {
    const state = loadState();
    updater(state);
    saveState(state);
  }

  function addNotification(state, title, message, prescriptionId) {
    state.notifications.unshift({
      id: `N-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title, message, prescriptionId, createdAt: Date.now(), read: false
    });
    state.notifications = state.notifications.slice(0, 80);
  }

  function notify(title, message, prescriptionId) {
    const state = loadState();
    addNotification(state, title, message, prescriptionId);
    saveState(state);
  }

  function showToast(message) {
    let region = document.querySelector(".toast-region");
    if (!region) {
      region = document.createElement("div");
      region.className = "toast-region";
      region.setAttribute("aria-live", "polite");
      document.body.appendChild(region);
    }
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    region.appendChild(toast);
    window.setTimeout(() => toast.remove(), 3400);
  }

  function getRequest(state, id) {
    return state.requests.find((request) => request.prescriptionId === id);
  }

  function totalFor(request) {
    return request.medicines.reduce((sum, medicine) => sum + Number(medicine.qty) * Number(medicine.price), 0);
  }

  function statusBadge(status) {
    const styles = {
      RECEIVED: "badge-blue", CHECKING: "badge-amber", CONFIRMED: "badge-teal",
      BILLED: "badge-blue", PREPARING: "badge-amber", READY: "badge-green", COLLECTED: "badge-gray"
    };
    return `<span class="badge ${styles[status] || "badge-gray"}">${escapeHtml(STATUS_LABELS[status] || status)}</span>`;
  }

  function roleLabel(role) {
    return { doctor: "Doctor", staff: "Medical Staff", relative: "Patient Relative" }[role] || role;
  }

  function navEntries(role) {
    if (role === "doctor") return [{ href: "doctor.html", page: "doctor", icon: "▦", label: "Doctor workspace" }];
    if (role === "staff") return [
      { href: "staff.html", page: "staff", icon: "▦", label: "Live queue" },
      { href: "inventory.html", page: "inventory", icon: "▤", label: "Medicine inventory" },
      { href: "billing.html", page: "billing", icon: "₹", label: "Billing & claims" }
    ];
    return [{ href: "relative.html", page: "relative", icon: "◎", label: "Track prescription" }];
  }

  function shell(title, content, role, options = {}) {
    const nav = navEntries(role);
    const state = loadState();
    const unread = state.notifications.filter((item) => !item.read).length;
    const active = PAGE;
    return `
      <div class="app-shell">
        <aside class="sidebar" id="sidebar">
          <a class="brand" href="index.html" aria-label="MEDIFLOW home">
            <span class="brand-mark">M</span><span><span class="brand-name">MEDIFLOW</span><span class="brand-caption">SMART PHARMACY WORKFLOW</span></span>
          </a>
          <div class="nav-label">Workspace</div>
          <nav class="nav-list" aria-label="Main navigation">${nav.map((item) => `<a class="nav-link ${active === item.page ? "active" : ""}" href="${item.href}"><span class="nav-icon">${item.icon}</span>${item.label}</a>`).join("")}</nav>
          <div class="sidebar-bottom">
            <div class="demo-note"><strong>DEMO ENVIRONMENT</strong><p>Sample data only. Medicines shown are for this software prototype, not medical advice.</p></div>
            <div class="sidebar-user"><span class="avatar">${escapeHtml(initials(currentSession.name))}</span><span><strong>${escapeHtml(currentSession.name)}</strong><small>${escapeHtml(roleLabel(role))} · City Hospital</small></span></div>
          </div>
        </aside>
        <div class="mobile-overlay" id="mobileOverlay"></div>
        <div class="main-area">
          <header class="topbar">
            <div class="topbar-left"><button class="icon-button hamburger" id="menuToggle" aria-label="Open navigation">☰</button><div class="breadcrumb">MEDIFLOW <span aria-hidden="true">/</span> <strong>${escapeHtml(title)}</strong></div></div>
            <div class="topbar-actions"><span class="secure-label"><i class="secure-dot"></i>Demo data saved on this device</span><button class="icon-button" id="notificationButton" aria-label="Notifications">🔔${unread ? `<span class="notification-count">${unread > 9 ? "9+" : unread}</span>` : ""}</button><button class="btn btn-sm" id="logoutButton">Sign out</button></div>
          </header>
          <main class="page-content">${content}</main>
        </div>
      </div>`;
  }

  function pageHeading(eyebrow, title, description, right = "") {
    return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div>${right}</div>`;
  }

  function statCard(label, value, icon, color, foot = "") {
    return `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon ${color}">${icon}</span></div><div class="stat-value" data-count="${Number(value) || 0}">${value}</div><div class="stat-foot">${foot}</div></article>`;
  }

  function impactCard(state) {
    const completed = state.requests.filter((request) => request.status === "COLLECTED").length;
    const total = state.requests.length;
    const efficiency = total ? Math.round((completed / total) * 100) : 0;
    const traditional = 45;
    const mediflow = 15;
    return `<section class="card impact-card"><div class="card-header"><div><h2>MEDIFLOW IMPACT</h2><p>A more predictable pharmacy journey, at a glance</p></div><span class="badge badge-teal">DEMO ESTIMATE</span></div><div class="impact-grid">
      <div class="impact-stat"><strong data-count="${traditional}">45</strong><span>Traditional waiting time · min</span></div>
      <div class="impact-stat"><strong data-count="${mediflow}">15</strong><span>Estimated MEDIFLOW time · min</span></div>
      <div class="impact-stat"><strong data-count="${traditional - mediflow}">30</strong><span>Estimated time saved · min</span></div>
      </div><div class="impact-foot">Queue reduction 67% &nbsp;·&nbsp; Processing efficiency ${efficiency}% &nbsp;·&nbsp; ${completed} prescriptions processed in this workspace</div></section>`;
  }

  function notificationPanel(state) {
    const recent = state.notifications.slice(0, 5);
    return `<section class="card"><div class="card-header"><div><h2>Recent notifications</h2><p>Workflow activity across MEDIFLOW</p></div><button class="btn btn-sm" data-action="read-notifications">Mark all read</button></div><div class="card-body"><div class="notification-list">${recent.length ? recent.map((item) => `<article class="notification-item ${item.read ? "" : "unread"}"><span class="notification-mark">🔔</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.message)}</p><time>${timeAgo(item.createdAt)}</time></div></article>`).join("") : `<div class="empty-state">No notifications yet.</div>`}</div></div></section>`;
  }

  function renderHome() {
    document.title = "MEDIFLOW | Less Waiting. Faster Medicine.";
    byId("app").innerHTML = `<div class="home-page">
      <header class="home-nav"><a class="home-brand" href="index.html"><span class="brand-mark">M</span><span><span class="brand-name">MEDIFLOW</span><span class="brand-caption">CITY HOSPITAL · SMART PHARMACY</span></span></a><div class="home-nav-right"><span class="secure-label"><i class="secure-dot"></i>College CEP prototype</span><a href="#roles" class="btn btn-sm">Demo sign in</a></div></header>
      <section class="hero"><div class="hero-copy"><div class="hero-badge"><span class="secure-dot"></span>CONNECTED CARE, COORDINATED</div><h1>MEDI<span>FLOW</span></h1><p class="hero-subtitle">Smart Hospital Medicine Queue &amp; Preparation System</p><p class="hero-tagline">Less Waiting. Faster Medicine. Smarter Healthcare. Digitally connecting doctors, medical staff and patient relatives—so everyone knows what happens next.</p><div class="hero-buttons"><a class="btn btn-primary" href="#roles">Get started <span aria-hidden="true">→</span></a><a class="btn" href="#how-it-works">Explore the workflow</a></div></div>
      <div class="hero-visual" id="how-it-works"><div class="workflow-visual"><div class="visual-top"><strong>Prescription journey</strong><span>LIVE WORKFLOW</span></div><div class="visual-flow"><div class="visual-step"><span class="visual-step-icon">▤</span><span><strong>Digital prescription</strong><small>Sent securely to the pharmacy queue</small></span><span class="visual-time">Instant</span></div><div class="visual-step"><span class="visual-step-icon">✓</span><span><strong>Availability &amp; billing</strong><small>Checked before medicines are prepared</small></span><span class="visual-time">In progress</span></div><div class="visual-step"><span class="visual-step-icon">🔔</span><span><strong>Ready to collect</strong><small>Relative sees status and counter details</small></span><span class="visual-time">Notified</span></div></div></div></div></section>
      <section class="benefits" aria-label="MEDIFLOW benefits"><article class="benefit"><span class="benefit-icon">↯</span><div><strong>Faster processing</strong><p>Organized priority queue helps staff focus on the next right task.</p></div></article><article class="benefit"><span class="benefit-icon">▤</span><div><strong>Digital prescription</strong><p>One shared prescription record follows every step to collection.</p></div></article><article class="benefit"><span class="benefit-icon">🔔</span><div><strong>Instant ready notification</strong><p>Relatives can check progress and pickup counter without waiting in line.</p></div></article></section>
      <section class="role-section" id="roles"><div class="section-heading"><div class="eyebrow">DEMO ACCESS</div><h2>Choose your workspace</h2><p>Role-based demo access · no password or backend required</p></div><div class="role-grid">
        ${roleCard("doctor", "✚", "Doctor", "Create and send department-based prescriptions to the pharmacy queue.", "Dr. Kavita Rao")}
        ${roleCard("staff", "▦", "Medical Staff", "Prioritize the live queue, confirm stock, generate bills and prepare orders.", "Anita Mehta")}
        ${roleCard("relative", "◎", "Patient Relative", "Track an order using a patient ID or prescription ID and see pickup details.", "Patient Relative")}
      </div></section><footer class="home-footer"><span>MEDIFLOW · Smart Hospital Medicine Queue &amp; Preparation System</span><span>Demo medicines are illustrative software data, not medical advice.</span></footer></div>`;
    document.querySelectorAll("[data-login-role]").forEach((button) => button.addEventListener("click", () => {
      const role = button.dataset.loginRole;
      const name = button.dataset.loginName;
      try {
        currentSession = setSession(role, name);
        window.location.href = role === "staff" ? "staff.html" : `${role}.html`;
      } catch (error) {
        window.alert("Unable to start the demo session. Please enable browser storage.");
      }
    }));
  }

  function roleCard(role, icon, title, description, name) {
    return `<article class="role-card"><div class="role-card-top"><span class="stat-icon ${role === "staff" ? "teal" : role === "relative" ? "green" : ""}">${icon}</span><span class="badge badge-gray">DEMO LOGIN</span></div><h3>${title}</h3><p>${description}</p><button class="btn ${role === "staff" ? "btn-teal" : "btn-primary"}" data-login-role="${role}" data-login-name="${name}">Continue as ${title} <span aria-hidden="true">→</span></button></article>`;
  }

  function renderDoctor() {
    const state = loadState();
    const currentDoc = currentSession ? currentSession.name : "Dr. Kavita Rao";
    const mine = state.requests.filter((request) => !request.doctor || request.doctor === currentDoc || !currentSession);
    const emergency = mine.filter((request) => request.priority === "HIGH").length;
    const regular = mine.length - emergency;
    const completed = mine.filter((request) => request.status === "COLLECTED").length;
    const departmentOptions = Object.keys(DEPARTMENTS).map((department) => `<option value="${escapeHtml(department)}">${escapeHtml(department)}</option>`).join("");
    const html = `${pageHeading("DOCTOR WORKSPACE", "Prescription desk", "Create a digital prescription and save patient details into the database.", `<div style="display:flex;align-items:center;gap:10px"><span class="db-badge"><i class="secure-dot"></i> Database: Active (IndexedDB: mediflow_db)</span><span class="date-chip">${new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span></div>`)}
      <div class="stats-grid">${statCard("Stored in database", mine.length, "▤", "", "Patient records in DB")}${statCard("Emergency cases", emergency, "!", "red", "Prioritized in the queue")}${statCard("Regular cases", regular, "•", "green", "Standard workflow")}${statCard("Completed prescriptions", completed, "✓", "teal", "Collected by relatives")}</div>
      <div class="layout-two"><section class="card"><div class="card-header"><div><h2>Create prescription</h2><p>Complete patient details and choose medicines from the selected department.</p></div><span class="badge badge-blue">NEW PATIENT RECORD</span></div><div class="card-body"><form id="prescriptionForm">
        <div class="field-grid">
          <div class="field"><label for="doctorName">Doctor name <span class="required">*</span></label><input id="doctorName" name="doctorName" value="${escapeHtml(currentDoc)}" required maxlength="80"></div>
          <div class="field"><label for="patientName">Patient name <span class="required">*</span></label><input id="patientName" name="patientName" placeholder="e.g. Ramesh Kumar" required maxlength="80"></div>
          <div class="field"><label for="patientId">Patient ID <span class="required">*</span></label><input id="patientId" name="patientId" placeholder="e.g. MF-P-25001" required maxlength="40"></div>
          <div class="field"><label for="patientAge">Age &amp; Gender</label><input id="patientAge" name="patientAge" placeholder="e.g. 42 / Male" maxlength="40"></div>
          <div class="field"><label for="relativeName">Relative name <span class="required">*</span></label><input id="relativeName" name="relativeName" placeholder="Patient's relative" required maxlength="80"></div>
          <div class="field"><label for="relativeMobile">Relative mobile number <span class="required">*</span></label><input id="relativeMobile" name="relativeMobile" inputmode="numeric" pattern="[0-9]{10}" maxlength="10" placeholder="10-digit mobile number" required></div>
          <div class="field"><label for="department">Hospital department <span class="required">*</span></label><select id="department" name="department" required><option value="">Select department</option>${departmentOptions}</select></div>
          <div class="field"><label for="priority">Priority <span class="required">*</span></label><select id="priority" name="priority"><option value="REGULAR">🟢 Regular</option><option value="HIGH">🚨 High priority / Emergency</option></select></div>
          <div class="field full"><label>Government scheme</label><div class="scheme-toggle"><label class="radio-option"><input type="radio" name="scheme" value="no" checked> No — standard billing</label><label class="radio-option"><input type="radio" name="scheme" value="yes"> Yes — covered claim</label></div></div>
          <div class="field full"><label for="medicineSearch">Prescription medicines <span class="required">*</span></label><input id="medicineSearch" placeholder="Search medicines in the selected department" disabled><div class="field-hint" id="medicineSearchHint">Select a department to see its demo medicine list.</div><div class="medicine-picker" id="medicinePicker"></div><button class="btn btn-sm" type="button" id="addMedicine" disabled>＋ Add another medicine</button></div>
          <div class="field full" id="emergencyNotice" hidden><div class="priority-banner"><span>🚨</span><span><strong>Emergency prescription</strong>High-priority prescriptions are automatically placed above regular cases in the queue.</span></div></div>
        </div>
        <div class="form-actions"><span class="field-hint">✓ Patient records are stored in browser IndexedDB database &amp; synced across workspaces.</span><button class="btn btn-primary" type="submit">Save to database &amp; Send prescription <span aria-hidden="true">→</span></button></div>
      </form></div></section>
      <aside class="stack"><section class="card"><div class="card-header"><div><h2>How it works</h2><p>One connected journey from clinic to counter</p></div></div><div class="card-body"><div class="notification-list"><div class="notification-item"><span class="notification-mark">1</span><div><strong>Send &amp; Store</strong><p>Saved in database; medical staff receives order in live queue.</p></div></div><div class="notification-item"><span class="notification-mark">2</span><div><strong>Availability &amp; billing</strong><p>Stock is verified and billing/scheme amount is recorded.</p></div></div><div class="notification-item"><span class="notification-mark">3</span><div><strong>Prepare &amp; notify</strong><p>The relative tracks status and collection counter in real time.</p></div></div></div></div></section>${impactCard(state)}</aside></div>
      <section class="card" style="margin-top:18px"><div class="card-header"><div><h2>Prescriptions sent &amp; stored in database</h2><p>Patient records created by your doctor account and stored in database</p></div><div style="display:flex;align-items:center;gap:8px"><span class="badge badge-teal" id="dbRecordCount">${mine.length} IN DATABASE</span><button class="btn btn-sm btn-outline" id="exportDbBtn" type="button">⬇ Export database</button>${mine.length > 0 ? '<button class="btn btn-sm btn-danger" id="clearDbBtn" type="button">Clear all</button>' : ''}</div></div><div id="doctorRequests"></div></section>`;
    document.title = "Doctor workspace | MEDIFLOW";
    byId("app").innerHTML = shell("Doctor workspace", html, "doctor");
    setupShell();
    setupDoctorForm();
    renderDoctorRequests();
    animateCounts();

    const exportBtn = byId("exportDbBtn");
    if (exportBtn) exportBtn.addEventListener("click", exportDatabase);
    const clearBtn = byId("clearDbBtn");
    if (clearBtn) clearBtn.addEventListener("click", clearAllDatabaseData);
  }

  function setupDoctorForm() {
    const form = byId("prescriptionForm");
    const dept = byId("department");
    const picker = byId("medicinePicker");
    const addButton = byId("addMedicine");
    const priority = byId("priority");
    const search = byId("medicineSearch");
    const searchHint = byId("medicineSearchHint");
    let searchTerm = "";

    function matchingMedicines() {
      return (DEPARTMENTS[dept.value] || []).filter((name) => name.toLowerCase().includes(searchTerm.toLowerCase()));
    }

    function refreshMedicineSearch() {
      picker.querySelectorAll(".medicine-row select").forEach((select) => {
        const selected = select.value;
        const matches = matchingMedicines();
        const options = selected && !matches.includes(selected) ? [selected, ...matches] : matches;
        select.innerHTML = options.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)} · ${money((loadState().inventory[name] || {}).price || 100)}</option>`).join("");
        if (selected && options.includes(selected)) select.value = selected;
      });
      const hasMatches = matchingMedicines().length > 0;
      searchHint.textContent = hasMatches ? "Search narrows medicine list for this department." : "No medicine names match this search in the selected department.";
      searchHint.hidden = !dept.value;
      addButton.disabled = !dept.value || !hasMatches;
    }

    function addMedicineRow() {
      const names = matchingMedicines();
      if (!names.length) return;
      const row = document.createElement("div");
      row.className = "medicine-row";
      row.innerHTML = `<select aria-label="Medicine" required>${names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)} · ${money((loadState().inventory[name] || {}).price || 100)}</option>`).join("")}</select><input aria-label="Quantity" type="number" min="1" max="500" value="1" required><button type="button" class="remove-medicine" aria-label="Remove medicine">×</button>`;
      picker.appendChild(row);
    }

    function updateMedicines() {
      picker.innerHTML = "";
      if (!dept.value) {
        search.disabled = true;
        searchHint.textContent = "Select a department to see its medicine list.";
        searchHint.hidden = false;
        addButton.disabled = true;
        return;
      }
      search.disabled = false;
      search.value = "";
      searchTerm = "";
      addMedicineRow();
      refreshMedicineSearch();
    }

    dept.addEventListener("change", updateMedicines);
    search.addEventListener("input", () => {
      searchTerm = search.value.trim();
      refreshMedicineSearch();
    });
    addButton.addEventListener("click", addMedicineRow);
    picker.addEventListener("click", (event) => {
      if (event.target.closest(".remove-medicine")) {
        event.target.closest(".medicine-row").remove();
      }
    });
    priority.addEventListener("change", () => {
      byId("emergencyNotice").hidden = priority.value !== "HIGH";
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const doctorName = String(data.get("doctorName") || (currentSession ? currentSession.name : "Dr. Kavita Rao")).trim();
      const patientName = String(data.get("patientName") || "").trim();
      const patientId = String(data.get("patientId") || "").trim();
      const patientAge = String(data.get("patientAge") || "").trim();
      const relativeName = String(data.get("relativeName") || "").trim();
      const relativeMobile = String(data.get("relativeMobile") || "").trim();
      const department = String(data.get("department") || "");
      const medicineRows = [...picker.querySelectorAll(".medicine-row")];

      if (!patientName || !patientId || !relativeName || !relativeMobile || !department) {
        window.alert("Please fill in all required patient fields.");
        return;
      }
      if (!medicineRows.length) {
        window.alert("Add at least one medicine for the selected department.");
        return;
      }
      if (!/^\d{10}$/.test(relativeMobile)) {
        window.alert("Enter a valid 10-digit relative mobile number.");
        return;
      }
      const state = loadState();
      const medicines = medicineRows.map((row) => {
        const name = row.querySelector("select").value;
        const qty = Number(row.querySelector('input[type="number"]').value);
        return { name, qty, price: (state.inventory[name] || {}).price || 100 };
      });
      if (!medicines.every((medicine) => medicine.qty >= 1 && Number.isInteger(medicine.qty))) {
        window.alert("Medicine quantities must be whole numbers greater than zero.");
        return;
      }
      if (state.requests.some((request) => request.patientId.toLowerCase() === patientId.toLowerCase() && request.status !== "COLLECTED")) {
        if (!window.confirm("An active prescription already exists for this patient ID. Send another prescription anyway?")) return;
      }

      // Purge any remaining default demo data to ensure only real user data is stored
      state.requests = state.requests.filter((r) => !isDemoPatient(r));
      state.notifications = state.notifications.filter((n) => !n.id.startsWith("demo-"));

      const prescriptionId = `MF-2026-${state.nextId}`;
      const request = {
        prescriptionId,
        patientName,
        patientId,
        ageGender: patientAge,
        relativeName,
        mobile: relativeMobile,
        department,
        priority: data.get("priority"),
        scheme: data.get("scheme") === "yes",
        doctor: doctorName,
        medicines,
        status: "RECEIVED",
        createdAt: Date.now(),
        availability: null,
        total: null,
        patientPayable: null,
        claimAmount: null,
        counter: null,
        stockDeducted: false,
        isDemo: false
      };
      state.nextId += 1;
      state.requests.push(request);
      addNotification(state, "New prescription received", `${prescriptionId} · ${patientName} · ${department}`, prescriptionId);

      // Save to database (IndexedDB & LocalStorage)
      saveState(state);
      dbSavePrescription(request);
      postPrescriptionToServer(request);

      showToast(`✓ Patient details stored in database successfully (ID: ${prescriptionId})`);
      form.reset();
      picker.innerHTML = `<div class="field-hint" id="medicineHint">Select a department to see its medicine list.</div>`;
      search.disabled = true;
      search.value = "";
      searchTerm = "";
      searchHint.textContent = "Select a department to see its medicine list.";
      searchHint.hidden = false;
      addButton.disabled = true;
      byId("emergencyNotice").hidden = true;
      renderDoctor();
    });
  }

  function renderDoctorRequests() {
    const state = loadState();
    const currentDoc = currentSession ? currentSession.name : "Dr. Kavita Rao";
    const mine = state.requests.filter((request) => !request.doctor || request.doctor === currentDoc || !currentSession).sort((a, b) => b.createdAt - a.createdAt);
    const container = byId("doctorRequests");
    if (!mine.length) {
      container.innerHTML = `<div class="empty-state"><span class="empty-icon">▤</span><strong>No prescriptions in database yet</strong>Fill out the form above to add patient details. New records will be stored in the database immediately.</div>`;
      return;
    }
    container.innerHTML = `<div class="table-scroll"><table class="data-table"><thead><tr><th>Prescription</th><th>Patient</th><th>Relative</th><th>Department</th><th>Priority</th><th>Medicines</th><th>Status</th><th>Database</th><th>Actions</th></tr></thead><tbody>${mine.map((request) => `<tr>
      <td><span class="id-text">${escapeHtml(request.prescriptionId)}</span><div class="table-secondary">${timeAgo(request.createdAt)}</div></td>
      <td><span class="table-primary">${escapeHtml(request.patientName)}</span><div class="table-secondary">${escapeHtml(request.patientId)}${request.ageGender ? ` · ${escapeHtml(request.ageGender)}` : ""}</div></td>
      <td><span class="table-primary">${escapeHtml(request.relativeName)}</span><div class="table-secondary">${escapeHtml(request.mobile)}</div></td>
      <td>${escapeHtml(request.department)}</td>
      <td>${request.priority === "HIGH" ? `<span class="badge badge-red">🚨 HIGH PRIORITY</span>` : `<span class="badge badge-green">REGULAR</span>`}</td>
      <td>${request.medicines.length} item${request.medicines.length === 1 ? "" : "s"}</td>
      <td>${statusBadge(request.status)}</td>
      <td><span class="db-badge">💾 Stored</span></td>
      <td><div style="display:flex;gap:6px"><button class="btn btn-sm" data-action="view-prescription" data-id="${escapeHtml(request.prescriptionId)}" type="button">View</button><button class="btn btn-sm btn-danger" data-action="delete-prescription" data-id="${escapeHtml(request.prescriptionId)}" type="button" title="Delete from database">✕</button></div></td>
    </tr>`).join("")}</tbody></table></div>`;
  }

  function exportDatabase() {
    const state = loadState();
    const dataToExport = {
      database: DB_NAME,
      version: DB_VERSION,
      exportedAt: new Date().toISOString(),
      prescriptions: state.requests,
      inventory: state.inventory,
      notifications: state.notifications
    };
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mediflow_database_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("Database exported successfully as JSON file.");
  }

  function clearAllDatabaseData() {
    if (!window.confirm("Are you sure you want to clear all stored patient records from the database? This cannot be undone.")) return;
    const state = loadState();
    state.requests = [];
    state.notifications = [];
    saveState(state);
    if (idbDatabase) {
      try {
        const tx = idbDatabase.transaction(["prescriptions", "notifications"], "readwrite");
        tx.objectStore("prescriptions").clear();
        tx.objectStore("notifications").clear();
      } catch (err) {
        console.warn("IDB clear error:", err);
      }
    }
    try {
      fetch("/api/reset", { method: "POST" }).catch(() => {});
    } catch (e) {}
    showToast("All patient records removed from database.");
    renderDoctor();
  }

  function showPrescriptionDetailsModal(request) {
    const total = request.total == null ? totalFor(request) : request.total;
    const dialog = document.createElement("dialog");
    dialog.style.cssText = "width:min(600px,calc(100% - 30px));max-height:88vh;overflow:auto;border:1px solid #e6edf4;border-radius:14px;padding:0;box-shadow:0 25px 90px rgba(15,40,65,.24)";
    dialog.innerHTML = `<div class="card-header"><div><h2>Prescription &amp; Patient details</h2><p>${escapeHtml(request.prescriptionId)} · Stored in database</p></div><button class="btn btn-sm" data-close-dialog type="button">Close</button></div>
    <div class="card-body">
      <div class="field-grid" style="margin-bottom:15px">
        <div class="field"><label>Patient name</label><strong>${escapeHtml(request.patientName)}</strong></div>
        <div class="field"><label>Patient ID</label><strong>${escapeHtml(request.patientId)}</strong></div>
        ${request.ageGender ? `<div class="field"><label>Age &amp; Gender</label><strong>${escapeHtml(request.ageGender)}</strong></div>` : ""}
        <div class="field"><label>Doctor name</label><strong>${escapeHtml(request.doctor || "Dr. Kavita Rao")}</strong></div>
        <div class="field"><label>Relative name</label><strong>${escapeHtml(request.relativeName)}</strong></div>
        <div class="field"><label>Relative mobile</label><strong>${escapeHtml(request.mobile)}</strong></div>
        <div class="field"><label>Department</label><strong>${escapeHtml(request.department)}</strong></div>
        <div class="field"><label>Priority</label><div>${request.priority === "HIGH" ? '<span class="badge badge-red">🚨 HIGH PRIORITY</span>' : '<span class="badge badge-green">REGULAR</span>'}</div></div>
        <div class="field"><label>Government scheme</label><strong>${request.scheme ? "Yes — covered claim" : "No — standard billing"}</strong></div>
        <div class="field"><label>Workflow status</label><div>${statusBadge(request.status)}</div></div>
      </div>
      <div style="margin: 15px 0">
        <label style="font-weight:700;font-size:11px;color:#40546a;display:block;margin-bottom:8px">Prescribed medicines</label>
        <table class="medicine-table" style="width:100%">
          <tbody>
            ${request.medicines.map((m) => `<tr><td>${escapeHtml(m.name)} <span class="table-secondary">× ${m.qty}</span></td><td style="text-align:right"><strong>${money(m.qty * m.price)}</strong></td></tr>`).join("")}
          </tbody>
        </table>
        <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid #edf1f5;margin-top:8px">
          <strong>Estimated / Total Bill</strong>
          <strong style="color:var(--navy);font-size:15px">${money(total)}</strong>
        </div>
        ${request.counter ? `<div class="store-note" style="margin-top:10px">Pickup counter: <strong>${escapeHtml(request.counter)}</strong></div>` : ""}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:15px;padding-top:12px;border-top:1px solid #edf1f5">
        <span class="db-badge">💾 Stored in Database (IndexedDB)</span>
        <button class="btn btn-sm" data-close-dialog type="button">Close</button>
      </div>
    </div>`;
    document.body.appendChild(dialog);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog || event.target.closest("[data-close-dialog]")) dialog.close();
    });
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
  }


  function sortedRequests(requests) {
    return [...requests].sort((a, b) => (a.priority === b.priority ? a.createdAt - b.createdAt : a.priority === "HIGH" ? -1 : 1));
  }

  function staffCounts(requests) {
    return {
      total: requests.length,
      emergency: requests.filter((request) => request.priority === "HIGH").length,
      regular: requests.filter((request) => request.priority !== "HIGH").length,
      pending: requests.filter((request) => ["RECEIVED", "CHECKING"].includes(request.status)).length,
      preparing: requests.filter((request) => ["BILLED", "PREPARING"].includes(request.status)).length,
      ready: requests.filter((request) => request.status === "READY").length,
      completed: requests.filter((request) => request.status === "COLLECTED").length,
      scheme: requests.filter((request) => request.scheme).length
    };
  }

  function renderStaff() {
    const state = loadState();
    const counts = staffCounts(state.requests);
    const ordered = sortedRequests(state.requests);
    const visible = ordered.filter((request) => matchesStaffFilters(request));
    const html = `${pageHeading("MEDICAL STAFF", "Live medicine queue", "Prioritized prescriptions move from availability check to a ready-to-collect notification.", `<span class="badge badge-teal"><i class="secure-dot"></i> LIVE QUEUE</span>`)}
      <div class="stats-grid">${statCard("Total prescriptions", counts.total, "▤", "", "All cases in this demo")}${statCard("Emergency cases", counts.emergency, "!", "red", "Automatically move to top")}${statCard("Regular cases", counts.regular, "•", "green", "Standard priority")}${statCard("Pending availability", counts.pending, "⌕", "amber", "Received or stock check")}${statCard("Preparing", counts.preparing, "↻", "teal", "Billing complete or in prep")}${statCard("Medicines ready", counts.ready, "✓", "green", "Awaiting collection")}${statCard("Completed", counts.completed, "✓", "", "Collected by relative")}${statCard("Government scheme", counts.scheme, "₹", "teal", "Covered claims tracked")}</div>
      <section class="card"><div class="card-header"><div><h2>Prescription work queue</h2><p>Emergency cases are automatically shown before regular prescriptions.</p></div><span class="badge badge-red">🚨 PRIORITY SORTED</span></div>
        <div class="toolbar"><div class="search-wrap"><input class="search-control" id="staffSearch" placeholder="Search patient, patient ID, prescription ID or department" value="${escapeHtml(staffSearch)}" aria-label="Search prescriptions"></div><select class="filter-control" id="staffFilter" aria-label="Filter prescriptions"><option value="ALL">All prescriptions</option><option value="EMERGENCY">Emergency</option><option value="REGULAR">Regular</option><option value="SCHEME">Government scheme</option><option value="PENDING">Pending availability</option><option value="PREPARING">Preparing</option><option value="READY">Ready</option><option value="COMPLETED">Completed</option></select><span class="badge badge-gray" id="queueCount">${visible.length} CASES</span></div>
        <div id="queueList">${visible.length ? visible.map(queueCard).join("") : `<div class="empty-state"><span class="empty-icon">⌕</span><strong>No matching prescriptions</strong>Try another search term or filter.</div>`}</div>
      </section><div class="layout-two" style="margin-top:18px"><div>${impactCard(state)}</div><div>${notificationPanel(state)}</div></div>`;
    document.title = "Medical staff queue | MEDIFLOW";
    byId("app").innerHTML = shell("Live queue", html, "staff");
    setupShell();
    byId("staffSearch").addEventListener("input", (event) => {
      staffSearch = event.target.value;
      updateQueueOnly();
    });
    byId("staffFilter").value = staffFilter;
    byId("staffFilter").addEventListener("change", (event) => {
      staffFilter = event.target.value;
      updateQueueOnly();
    });
    animateCounts();
  }

  function matchesStaffFilters(request) {
    const term = staffSearch.toLowerCase().trim();
    const text = [request.patientName, request.patientId, request.prescriptionId, request.department].join(" ").toLowerCase();
    if (term && !text.includes(term)) return false;
    if (staffFilter === "EMERGENCY" && request.priority !== "HIGH") return false;
    if (staffFilter === "REGULAR" && request.priority === "HIGH") return false;
    if (staffFilter === "SCHEME" && !request.scheme) return false;
    if (staffFilter === "PENDING" && !["RECEIVED", "CHECKING"].includes(request.status)) return false;
    if (staffFilter === "PREPARING" && !["BILLED", "PREPARING"].includes(request.status)) return false;
    if (staffFilter === "READY" && request.status !== "READY") return false;
    if (staffFilter === "COMPLETED" && request.status !== "COLLECTED") return false;
    return true;
  }

  function updateQueueOnly() {
    const state = loadState();
    const visible = sortedRequests(state.requests).filter(matchesStaffFilters);
    const list = byId("queueList");
    if (!list) return;
    list.innerHTML = visible.length ? visible.map(queueCard).join("") : `<div class="empty-state"><span class="empty-icon">⌕</span><strong>No matching prescriptions</strong>Try another search term or filter.</div>`;
    byId("queueCount").textContent = `${visible.length} CASES`;
  }

  function queueCard(request) {
    const scheme = request.scheme;
    const medicines = request.medicines.map((medicine) => `${escapeHtml(medicine.name)} × ${medicine.qty}`).join(" · ");
    const total = request.total == null ? totalFor(request) : request.total;
    const availability = request.availability
      ? `<div class="availability-list">${request.availability.map((item) => `<div class="availability-row"><span>${escapeHtml(item.name)} × ${item.qty}</span><span class="${item.available ? "availability-ok" : "availability-no"}">${item.available ? `✓ Available · ${item.stock} in stock` : `✕ Short · ${item.stock} in stock`}</span></div>`).join("")}</div>`
      : "";
    const action = request.status === "RECEIVED" || request.status === "CHECKING"
      ? `<button class="btn btn-primary btn-sm" data-action="check" data-id="${escapeHtml(request.prescriptionId)}">${request.status === "CHECKING" ? "Recheck availability" : "Check availability"}</button>`
      : request.status === "CONFIRMED" ? `<button class="btn btn-primary btn-sm" data-action="bill" data-id="${escapeHtml(request.prescriptionId)}">Generate bill</button>`
      : request.status === "BILLED" ? `<button class="btn btn-primary btn-sm" data-action="prepare" data-id="${escapeHtml(request.prescriptionId)}">Start preparation</button>`
      : request.status === "PREPARING" ? `<button class="btn btn-teal btn-sm" data-action="ready" data-id="${escapeHtml(request.prescriptionId)}">Mark medicine ready</button>`
      : request.status === "READY" ? `<button class="btn btn-sm" data-action="collect" data-id="${escapeHtml(request.prescriptionId)}">Mark collected</button>`
      : `<span class="field-hint">This prescription is complete.</span>`;
    return `<article class="queue-card ${request.priority === "HIGH" ? "urgent" : ""}">
      <div class="queue-card-head"><div class="queue-person"><span class="mini-avatar">${escapeHtml(initials(request.patientName))}</span><div><h3>${escapeHtml(request.patientName)}</h3><p>${escapeHtml(request.patientId)} · ${escapeHtml(request.relativeName)}</p></div></div><div>${request.priority === "HIGH" ? `<span class="badge badge-red">🚨 HIGH PRIORITY</span>` : `<span class="badge badge-green">🟢 REGULAR</span>`}<div style="margin-top:6px">${statusBadge(request.status)}</div></div></div>
      <div class="queue-meta"><span class="id-text">${escapeHtml(request.prescriptionId)}</span><span class="badge badge-blue">${escapeHtml(request.department)}</span>${scheme ? `<span class="badge badge-teal">GOVERNMENT SCHEME</span>` : ""}</div>
      <div class="queue-details"><div class="queue-detail"><span>MEDICINES</span><strong>${request.medicines.length} items</strong></div><div class="queue-detail"><span>${request.status === "BILLED" || request.status === "PREPARING" || request.status === "READY" || request.status === "COLLECTED" ? "TOTAL BILL" : "EST. TOTAL"}</span><strong>${money(total)}</strong></div><div class="queue-detail"><span>RELATIVE MOBILE</span><strong>${escapeHtml(request.mobile)}</strong></div><div class="queue-detail"><span>RECEIVED</span><strong>${timeAgo(request.createdAt)}</strong></div></div>
      <div class="queue-medicines"><strong>Items:</strong> ${medicines}</div>${availability}
      ${request.priority === "HIGH" ? `<div class="priority-banner" style="margin-top:10px"><span>🚨</span><span><strong>Emergency prescription should be processed first.</strong>High-priority case · verify and prepare promptly.</span></div>` : ""}
      ${request.status === "READY" ? `<div class="store-note">🔔 Relative notified · Collection at <strong>${escapeHtml(request.counter || "assigned counter")}</strong></div>` : ""}
      <div class="queue-actions">${action}${request.status === "BILLED" || request.status === "PREPARING" || request.status === "READY" || request.status === "COLLECTED" ? `<a class="btn btn-sm" href="billing.html">View billing</a>` : ""}</div>
    </article>`;
  }

  function checkAvailability(id) {
    const state = loadState();
    const request = getRequest(state, id);
    if (!request || !["RECEIVED", "CHECKING"].includes(request.status)) return;
    const availability = request.medicines.map((medicine) => {
      const stock = state.inventory[medicine.name] ? state.inventory[medicine.name].quantity : 0;
      return { name: medicine.name, qty: medicine.qty, stock, available: stock >= medicine.qty };
    });
    request.availability = availability;
    request.status = availability.every((item) => item.available) ? "CONFIRMED" : "CHECKING";
    if (request.status === "CONFIRMED") {
      addNotification(state, "Medicine availability confirmed", `${request.prescriptionId} · All ${request.medicines.length} items are available.`, id);
    }
    saveState(state);
    updatePrescriptionOnServer(request);
    showToast(request.status === "CONFIRMED" ? "All medicines available." : "Some items are short on stock. Adjust inventory and recheck.");
    renderStaff();
  }

  function generateBill(id) {
    const state = loadState();
    const request = getRequest(state, id);
    if (!request || request.status !== "CONFIRMED") return;
    const total = totalFor(request);
    request.total = total;
    request.patientPayable = request.scheme ? 0 : total;
    request.claimAmount = request.scheme ? total : 0;
    request.status = "BILLED";
    addNotification(state, "Billing completed", `${request.prescriptionId} · ${request.scheme ? `Scheme claim ${money(total)}` : `Patient payable ${money(total)}`}`, id);
    saveState(state);
    updatePrescriptionOnServer(request);
    showToast("Bill generated and saved to billing.");
    renderStaff();
  }

  function startPreparation(id) {
    const state = loadState();
    const request = getRequest(state, id);
    if (!request || request.status !== "BILLED") return;
    if (!request.stockDeducted) {
      const insufficient = request.medicines.filter((medicine) => !state.inventory[medicine.name] || state.inventory[medicine.name].quantity < medicine.qty);
      if (insufficient.length) {
        request.status = "CHECKING";
        request.availability = request.medicines.map((medicine) => {
          const stock = state.inventory[medicine.name] ? state.inventory[medicine.name].quantity : 0;
          return { name: medicine.name, qty: medicine.qty, stock, available: stock >= medicine.qty };
        });
        addNotification(state, "Stock needs rechecking", `${id} · Inventory changed before preparation.`, id);
        saveState(state);
        updatePrescriptionOnServer(request);
        window.alert(`Not enough stock to prepare: ${insufficient.map((medicine) => medicine.name).join(", ")}. The prescription was returned to availability checking.`);
        renderStaff();
        return;
      }
      request.medicines.forEach((medicine) => {
        state.inventory[medicine.name].quantity -= medicine.qty;
      });
      request.stockDeducted = true;
    }
    request.status = "PREPARING";
    request.preparationStartedAt = Date.now();
    addNotification(state, "Medicine preparation started", `${id} · ${request.patientName}'s order is being prepared.`, id);
    saveState(state);
    updatePrescriptionOnServer(request);
    showToast("Preparation started. Inventory has been updated.");
    renderStaff();
  }

  function markReady(id) {
    const state = loadState();
    const request = getRequest(state, id);
    if (!request || request.status !== "PREPARING") return;
    const standardCounters = ["Counter 1", "Counter 2", "Counter 3"];
    request.counter = request.priority === "HIGH" ? "Emergency Counter" : standardCounters[(Number(id.split("-").pop()) - 1) % standardCounters.length];
    request.readyAt = Date.now();
    request.status = "READY";
    addNotification(state, "Medicine ready", `${request.patientName}'s medicines are ready. Please collect from ${request.counter}.`, id);
    saveState(state);
    updatePrescriptionOnServer(request);
    showToast("Medicine ready. The patient relative can now see the collection counter.");
    renderStaff();
  }

  function markCollected(id) {
    const state = loadState();
    const request = getRequest(state, id);
    if (!request || request.status !== "READY") return;
    request.status = "COLLECTED";
    request.collectedAt = Date.now();
    addNotification(state, "Prescription collected", `${request.prescriptionId} · Collected from ${request.counter}.`, id);
    saveState(state);
    updatePrescriptionOnServer(request);
    showToast("Prescription marked collected.");
    renderStaff();
  }

  function renderInventory() {
    const state = loadState();
    const items = Object.values(state.inventory).sort((a, b) => a.name.localeCompare(b.name)).filter((item) => {
      const search = inventorySearch.toLowerCase().trim();
      const matchSearch = !search || item.name.toLowerCase().includes(search) || item.departments.some((department) => department.toLowerCase().includes(search));
      const matchDept = inventoryDept === "ALL" || item.departments.includes(inventoryDept);
      const matchStock = inventoryStock === "ALL" || (inventoryStock === "OUT" ? item.quantity === 0 : inventoryStock === "LOW" ? item.quantity > 0 && item.quantity <= 10 : item.quantity > 10);
      return matchSearch && matchDept && matchStock;
    });
    const rows = items.map((item) => {
      const stockClass = item.quantity === 0 ? ["Out of stock", "badge-red"] : item.quantity <= 10 ? ["Low stock", "badge-amber"] : ["In stock", "badge-green"];
      return `<tr><td><span class="table-primary">${escapeHtml(item.name)}</span><div class="table-secondary">${item.departments.length} department${item.departments.length === 1 ? "" : "s"}</div></td><td>${escapeHtml(item.departments.join(", "))}</td><td><strong>${item.quantity}</strong> units</td><td>${money(item.price)}</td><td><span class="badge ${stockClass[1]}">${stockClass[0]}</span></td><td><div style="display:flex;gap:5px"><button class="btn btn-sm" data-action="stock-down" data-name="${escapeHtml(item.name)}" aria-label="Decrease ${escapeHtml(item.name)} stock">−</button><button class="btn btn-sm" data-action="stock-up" data-name="${escapeHtml(item.name)}" aria-label="Increase ${escapeHtml(item.name)} stock">＋</button></div></td></tr>`;
    }).join("");
    const outOfStock = Object.values(state.inventory).filter((item) => item.quantity === 0).length;
    const lowStock = Object.values(state.inventory).filter((item) => item.quantity > 0 && item.quantity <= 10).length;
    const html = `${pageHeading("PHARMACY OPERATIONS", "Medicine inventory", "Monitor department stock, adjust demonstration quantities and see availability update across the queue.", `<span class="badge badge-blue">${Object.keys(state.inventory).length} CATALOG ITEMS</span>`)}
      <div class="stats-grid">${statCard("Catalog medicines", Object.keys(state.inventory).length, "▤", "", "Department-linked demo items")}${statCard("In stock", Object.values(state.inventory).filter((item) => item.quantity > 10).length, "✓", "green", "More than 10 units")}${statCard("Low stock", lowStock, "!", "amber", "10 units or fewer")}${statCard("Out of stock", outOfStock, "×", "red", "Unavailable for new orders")}</div>
      <section class="card"><div class="card-header"><div><h2>Inventory register</h2><p>Adjust quantities for the prototype; preparation deducts ordered quantities automatically.</p></div><span class="badge badge-teal">LIVE STOCK</span></div>
        <div class="toolbar"><div class="search-wrap"><input class="search-control" id="inventorySearch" placeholder="Search medicine or department" value="${escapeHtml(inventorySearch)}" aria-label="Search inventory"></div><select class="filter-control" id="inventoryDept" aria-label="Filter by department"><option value="ALL">All departments</option>${Object.keys(DEPARTMENTS).map((department) => `<option value="${escapeHtml(department)}">${escapeHtml(department)}</option>`).join("")}</select><select class="filter-control" id="inventoryStock" aria-label="Filter by stock status"><option value="ALL">All stock status</option><option value="IN">In stock</option><option value="LOW">Low stock</option><option value="OUT">Out of stock</option></select><span class="badge badge-gray" id="inventoryCount">${items.length} ITEMS</span></div>
        <div class="table-scroll"><table class="data-table"><thead><tr><th>Medicine</th><th>Department</th><th>Available quantity</th><th>Unit price</th><th>Stock status</th><th>Adjust stock</th></tr></thead><tbody id="inventoryRows">${rows || `<tr><td colspan="6"><div class="empty-state">No inventory items match the selected filters.</div></td></tr>`}</tbody></table></div>
      </section><div style="margin-top:18px">${notificationPanel(state)}</div>`;
    document.title = "Medicine inventory | MEDIFLOW";
    byId("app").innerHTML = shell("Medicine inventory", html, "staff");
    setupShell();
    byId("inventoryDept").value = inventoryDept;
    byId("inventoryStock").value = inventoryStock;
    byId("inventorySearch").addEventListener("input", (event) => { inventorySearch = event.target.value; updateInventoryTable(); });
    byId("inventoryDept").addEventListener("change", (event) => { inventoryDept = event.target.value; updateInventoryTable(); });
    byId("inventoryStock").addEventListener("change", (event) => { inventoryStock = event.target.value; updateInventoryTable(); });
    animateCounts();
  }

  function updateInventoryTable() {
    const state = loadState();
    const items = Object.values(state.inventory).sort((a, b) => a.name.localeCompare(b.name)).filter((item) => {
      const search = inventorySearch.toLowerCase().trim();
      return (!search || item.name.toLowerCase().includes(search) || item.departments.some((department) => department.toLowerCase().includes(search)))
        && (inventoryDept === "ALL" || item.departments.includes(inventoryDept))
        && (inventoryStock === "ALL" || (inventoryStock === "OUT" ? item.quantity === 0 : inventoryStock === "LOW" ? item.quantity > 0 && item.quantity <= 10 : item.quantity > 10));
    });
    byId("inventoryCount").textContent = `${items.length} ITEMS`;
    byId("inventoryRows").innerHTML = items.length ? items.map((item) => {
      const stockClass = item.quantity === 0 ? ["Out of stock", "badge-red"] : item.quantity <= 10 ? ["Low stock", "badge-amber"] : ["In stock", "badge-green"];
      return `<tr><td><span class="table-primary">${escapeHtml(item.name)}</span><div class="table-secondary">${item.departments.length} department${item.departments.length === 1 ? "" : "s"}</div></td><td>${escapeHtml(item.departments.join(", "))}</td><td><strong>${item.quantity}</strong> units</td><td>${money(item.price)}</td><td><span class="badge ${stockClass[1]}">${stockClass[0]}</span></td><td><div style="display:flex;gap:5px"><button class="btn btn-sm" data-action="stock-down" data-name="${escapeHtml(item.name)}" aria-label="Decrease ${escapeHtml(item.name)} stock">−</button><button class="btn btn-sm" data-action="stock-up" data-name="${escapeHtml(item.name)}" aria-label="Increase ${escapeHtml(item.name)} stock">＋</button></div></td></tr>`;
    }).join("") : `<tr><td colspan="6"><div class="empty-state">No inventory items match the selected filters.</div></td></tr>`;
  }

  function adjustStock(name, amount) {
    const state = loadState();
    const item = state.inventory[name];
    if (!item) return;
    item.quantity = Math.max(0, item.quantity + amount);
    saveState(state);
    showToast(`${name} stock ${amount > 0 ? "increased" : item.quantity === 0 ? "is already zero" : "decreased"}${amount > 0 || item.quantity > 0 ? ` · ${item.quantity} units` : ""}.`);
    renderInventory();
  }

  function renderBilling() {
    const state = loadState();
    const billed = state.requests.filter((request) => request.total != null).sort((a, b) => b.createdAt - a.createdAt);
    const totalSales = billed.reduce((sum, request) => sum + request.patientPayable, 0);
    const totalClaims = billed.reduce((sum, request) => sum + request.claimAmount, 0);
    const html = `${pageHeading("PHARMACY OPERATIONS", "Billing & scheme claims", "Digital bills are generated after stock confirmation. Scheme claims are recorded separately from patient payment.", `<span class="badge badge-blue">${billed.length} BILLS</span>`)}
      <div class="stats-grid">${statCard("Bills generated", billed.length, "▤", "", "Availability confirmed")}${statCard("Patient payments", money(totalSales), "₹", "green", "Standard patients only")}${statCard("Government claims", money(totalClaims), "◆", "teal", "Tracked separately")}${statCard("Scheme cases", billed.filter((request) => request.scheme).length, "✓", "blue", "Patient amount payable ₹0")}</div>
      <section class="card"><div class="card-header"><div><h2>Digital bills</h2><p>Itemized amounts, patient payable and government claim values.</p></div><span class="badge badge-teal">INTERNAL BILLING</span></div>
        ${billed.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>Prescription / patient</th><th>Department</th><th>Medicine total</th><th>Patient payable</th><th>Scheme claim</th><th>Status</th><th>Bill details</th></tr></thead><tbody>${billed.map((request) => `<tr><td><span class="id-text">${escapeHtml(request.prescriptionId)}</span><div class="table-secondary">${escapeHtml(request.patientName)} · ${escapeHtml(request.patientId)}</div></td><td>${escapeHtml(request.department)}</td><td><span class="table-primary">${money(request.total)}</span></td><td>${money(request.patientPayable)}</td><td>${money(request.claimAmount)}</td><td>${request.scheme ? `<span class="badge badge-teal">GOVERNMENT SCHEME</span>` : `<span class="badge badge-gray">STANDARD</span>`}<div style="margin-top:5px">${statusBadge(request.status)}</div></td><td><button class="btn btn-sm" data-action="show-bill" data-id="${escapeHtml(request.prescriptionId)}">View bill</button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><span class="empty-icon">₹</span><strong>No bills generated yet</strong>Confirm medicine availability in the live queue to generate a bill.</div>`}
      </section><div class="layout-two" style="margin-top:18px">${impactCard(state)}${notificationPanel(state)}</div>`;
    document.title = "Billing & claims | MEDIFLOW";
    byId("app").innerHTML = shell("Billing & claims", html, "staff");
    setupShell();
  }

  function billDetails(request) {
    const total = request.total == null ? totalFor(request) : request.total;
    return `<div class="bill-summary">${request.medicines.map((medicine) => `<div class="bill-line"><span>${escapeHtml(medicine.name)} × ${medicine.qty} <span class="table-secondary">at ${money(medicine.price)}</span></span><strong>${money(medicine.qty * medicine.price)}</strong></div>`).join("")}<div class="bill-line total"><span>Medicine total</span><strong>${money(total)}</strong></div><div class="bill-line"><span>Amount payable by patient</span><strong>${money(request.scheme ? 0 : total)}</strong></div><div class="bill-line"><span>Government scheme claim</span><strong>${money(request.scheme ? total : 0)}</strong></div>${request.scheme ? `<div class="scheme-callout"><strong>Government Scheme Covered</strong>Availability and internal billing remain unchanged. Patient payable is ₹0; the medicine total is recorded as the scheme claim.</div>` : ""}</div>`;
  }

  function renderRelative() {
    const state = loadState();
    const found = selectedRelativeId
      ? state.requests.find((request) => request.prescriptionId.toLowerCase() === selectedRelativeId.toLowerCase())
        || state.requests.filter((request) => request.patientId.toLowerCase() === selectedRelativeId.toLowerCase())
          .sort((a, b) => b.createdAt - a.createdAt)[0]
      : null;
    const active = state.requests.filter((request) => request.status !== "COLLECTED");
    const ready = state.requests.filter((request) => request.status === "READY");
    const html = `${pageHeading("PATIENT RELATIVE", "Track a prescription", "Check preparation progress, billing and collection instructions using a patient ID or prescription ID.", `<span class="badge badge-green">SELF-SERVICE TRACKING</span>`)}
      <div class="stats-grid">${statCard("Active prescriptions", active.length, "◎", "", "Demo hospital queue")}${statCard("Medicines ready", ready.length, "✓", "green", "Awaiting relative collection")}${statCard("Traditional wait", "45 min", "◷", "amber", "Illustrative estimate")}${statCard("MEDIFLOW estimate", "15 min", "↯", "teal", "Illustrative estimate")}</div>
      <section class="card"><div class="card-header"><div><h2>Find your prescription</h2><p>Enter the patient's hospital ID or the MEDIFLOW prescription ID.</p></div><span class="badge badge-blue">PRIVATE LOOKUP</span></div><div class="card-body"><form id="relativeSearchForm" class="relative-search"><input id="relativeQuery" value="${escapeHtml(selectedRelativeId)}" placeholder="Enter Patient ID or Prescription ID" aria-label="Patient ID or prescription ID" required><button class="btn btn-primary" type="submit">Track prescription →</button></form>${state.requests.length ? `<div class="recent-chips"><span style="color:#647990;font-size:11px">Recently stored in database:</span>${state.requests.slice(0, 5).map((r) => `<button type="button" class="recent-chip" data-quick-track="${escapeHtml(r.patientId)}"><strong>${escapeHtml(r.patientId)}</strong> · ${escapeHtml(r.patientName)}</button>`).join("")}</div>` : ""}<p class="footer-hint">Enter the Patient ID or Prescription ID assigned by your doctor to track medicine preparation progress.</p></div></section>
      ${selectedRelativeId ? found ? relativeDetails(found) : `<section class="card" style="margin-top:18px"><div class="empty-state"><span class="empty-icon">⌕</span><strong>No prescription found</strong>Check the ID and try again.</div></section>` : `<section class="card" style="margin-top:18px"><div class="empty-state"><span class="empty-icon">◎</span><strong>Enter an ID to begin tracking</strong>Use your patient ID or prescription ID to view a prescription status.</div></section>`}
      <div class="layout-two" style="margin-top:18px">${impactCard(state)}${notificationPanel(state)}</div>`;
    document.title = "Patient relative | MEDIFLOW";
    byId("app").innerHTML = shell("Track prescription", html, "relative");
    setupShell();
    byId("relativeSearchForm").addEventListener("submit", (event) => {
      event.preventDefault();
      selectedRelativeId = byId("relativeQuery").value.trim();
      renderRelative();
    });
    animateCounts();
  }

  function relativeDetails(request) {
    const total = request.total == null ? totalFor(request) : request.total;
    const statusIndex = STATUSES.indexOf(request.status);
    const tracker = `<div class="status-progress" aria-label="Prescription progress">${STEPS.map((step, index) => `<div class="progress-step ${index < statusIndex ? "done" : ""} ${index === statusIndex ? "current" : ""}"><span class="step-dot">${index < statusIndex ? "✓" : index + 1}</span><span class="step-label">${step}</span></div>`).join("")}</div>`;
    const readyNotice = request.status === "READY" ? `<div class="ready-hero"><h2>🔔 YOUR MEDICINE IS READY</h2><p>Your medicines are ready for collection. ${request.scheme ? "Your medicines are covered under the Government Scheme." : "Please visit the Medical Store and collect your medicines."}</p></div>` : "";
    const schemeMessage = request.scheme ? `<div class="scheme-callout"><strong>Government Scheme Covered</strong>Amount payable: ${money(0)}<br>Government scheme claim: ${money(total)}</div>` : `<div class="scheme-callout" style="background:#f3f7fc;color:#536b82"><strong>Amount payable: ${money(request.patientPayable == null ? total : request.patientPayable)}</strong>Medicine bill for this prescription.</div>`;
    return `<section class="card" style="margin-top:18px"><div class="card-header"><div><h2>Prescription details</h2><p>${escapeHtml(request.prescriptionId)} · submitted ${timeAgo(request.createdAt)}</p></div>${request.priority === "HIGH" ? `<span class="badge badge-red">🚨 HIGH PRIORITY</span>` : `<span class="badge badge-green">REGULAR</span>`}</div><div class="card-body">
      ${readyNotice}
      <div class="field-grid" style="margin-bottom:18px"><div class="field"><label>Patient name</label><div class="table-primary">${escapeHtml(request.patientName)}</div></div><div class="field"><label>Patient ID</label><div class="table-primary">${escapeHtml(request.patientId)}</div></div><div class="field"><label>Department</label><div class="table-primary">${escapeHtml(request.department)}</div></div><div class="field"><label>Prescription status</label><div>${statusBadge(request.status)}</div></div></div>
      ${tracker}
      <div class="layout-two"><div><div class="card-header" style="padding:10px 0"><div><h3>Medicine list</h3><p>Items and quantities on this prescription</p></div></div><table class="medicine-table"><tbody>${request.medicines.map((medicine) => `<tr><td>${escapeHtml(medicine.name)} <span class="table-secondary">× ${medicine.qty}</span></td><td>${money(medicine.qty * medicine.price)}</td></tr>`).join("")}</tbody></table></div>
      <div class="stack"><div class="card-header" style="padding:10px 0"><div><h3>Billing information</h3><p>${request.scheme ? "Government scheme case" : "Standard patient bill"}</p></div></div>${request.total == null ? `<div class="bill-summary"><div class="bill-line"><span>Estimated medicine total</span><strong>${money(total)}</strong></div><div class="field-hint">Final billing is generated after staff confirms medicine availability.</div></div>` : billDetails(request)}${request.status === "READY" || request.status === "COLLECTED" ? `<div class="counter-box"><span>Medical store pickup</span><strong>${escapeHtml(request.counter || "Counter to be assigned")}</strong></div><div class="store-note">${request.status === "COLLECTED" ? "This prescription has been collected. Thank you." : `Please collect your medicines from <strong>${escapeHtml(request.counter)}</strong>.`}</div>` : ""}</div></div>
    </div></section>`;
  }

  function setupShell() {
    const toggle = byId("menuToggle");
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
    byId("logoutButton").addEventListener("click", () => {
      localStorage.removeItem(SESSION_KEY);
      window.location.href = "index.html";
    });
    byId("notificationButton").addEventListener("click", showNotificationCenter);
  }

  function showNotificationCenter() {
    const state = loadState();
    const dialog = document.createElement("dialog");
    dialog.style.cssText = "width:min(560px,calc(100% - 30px));max-height:85vh;overflow:auto;border:1px solid #e6edf4;border-radius:14px;padding:0;box-shadow:0 25px 90px rgba(15,40,65,.24)";
    const notifications = state.notifications;
    const notificationMarkup = notifications.length ? notifications.map((item) => `<article class="notification-item ${item.read ? "" : "unread"}"><span class="notification-mark">🔔</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.message)}</p><time>${timeAgo(item.createdAt)}${item.prescriptionId ? ` · ${escapeHtml(item.prescriptionId)}` : ""}</time></div></article>`).join("") : `<div class="empty-state"><strong>You're all caught up</strong>Workflow notifications will appear here.</div>`;
    dialog.innerHTML = `<div class="card-header"><div><h2>Notification centre</h2><p>${notifications.filter((item) => !item.read).length} unread · Live prescription workflow</p></div><button class="btn btn-sm" data-close-dialog>Close</button></div><div class="card-body"><div class="notification-list">${notificationMarkup}</div><div class="form-actions"><span class="field-hint">Notifications are stored on this device.</span><button class="btn btn-primary btn-sm" data-mark-read>Mark all read</button></div></div>`;
    document.body.appendChild(dialog);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog || event.target.closest("[data-close-dialog]")) dialog.close();
      if (event.target.closest("[data-mark-read]")) {
        const next = loadState();
        next.notifications.forEach((notification) => { notification.read = true; });
        saveState(next);
        dialog.querySelectorAll(".notification-item.unread").forEach((item) => item.classList.remove("unread"));
        dialog.querySelector(".card-header p").textContent = "0 unread · Live prescription workflow";
        dialog.querySelector("[data-mark-read]").disabled = true;
        const count = document.querySelector(".notification-count");
        if (count) count.remove();
      }
    });
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
  }

  function animateCounts() {
    document.querySelectorAll("[data-count]").forEach((element) => {
      const target = Number(element.dataset.count);
      if (!Number.isFinite(target) || target <= 0 || target > 100000) return;
      const start = performance.now();
      const duration = 500;
      const prefix = element.textContent.match(/^[^\d]*/)[0];
      const suffix = element.textContent.match(/[^\d]*$/)[0];
      function frame(now) {
        const progress = Math.min(1, (now - start) / duration);
        element.textContent = `${prefix}${Math.round(target * (1 - Math.pow(1 - progress, 3))).toLocaleString("en-IN")}${suffix}`;
        if (progress < 1) window.requestAnimationFrame(frame);
      }
      window.requestAnimationFrame(frame);
    });
  }

  function renderCurrentPage() {
    if (PAGE === "doctor") renderDoctor();
    else if (PAGE === "staff") renderStaff();
    else if (PAGE === "inventory") renderInventory();
    else if (PAGE === "billing") renderBilling();
    else if (PAGE === "relative") renderRelative();
  }

  document.addEventListener("click", (event) => {
    const quickBtn = event.target.closest("[data-quick-track]");
    if (quickBtn) {
      selectedRelativeId = quickBtn.dataset.quickTrack;
      const input = byId("relativeQuery");
      if (input) input.value = selectedRelativeId;
      renderRelative();
      return;
    }

    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const id = button.dataset.id;
    if (action === "check") checkAvailability(id);
    else if (action === "bill") generateBill(id);
    else if (action === "prepare") startPreparation(id);
    else if (action === "ready") markReady(id);
    else if (action === "collect") markCollected(id);
    else if (action === "stock-up") adjustStock(button.dataset.name, 1);
    else if (action === "stock-down") adjustStock(button.dataset.name, -1);
    else if (action === "view-prescription") {
      const request = getRequest(loadState(), id);
      if (request) showPrescriptionDetailsModal(request);
    } else if (action === "delete-prescription") {
      if (!window.confirm(`Are you sure you want to delete prescription ${id} from the database?`)) return;
      const state = loadState();
      state.requests = state.requests.filter((r) => r.prescriptionId !== id);
      saveState(state);
      dbDeletePrescription(id);
      deletePrescriptionOnServer(id);
      showToast(`Prescription ${id} removed from database.`);
      renderCurrentPage();
    } else if (action === "read-notifications") {
      const state = loadState();
      state.notifications.forEach((notification) => { notification.read = true; });
      saveState(state);
      renderCurrentPage();
    } else if (action === "show-bill") {
      const request = getRequest(loadState(), id);
      if (request) showBillDialog(request);
    }
  });

  function showBillDialog(request) {
    const dialog = document.createElement("dialog");
    dialog.style.cssText = "width:min(560px,calc(100% - 30px));max-height:85vh;overflow:auto;border:1px solid #e6edf4;border-radius:14px;padding:0;box-shadow:0 25px 90px rgba(15,40,65,.24)";
    dialog.innerHTML = `<div class="card-header"><div><h2>Digital medicine bill</h2><p>${escapeHtml(request.prescriptionId)} · ${escapeHtml(request.patientName)}</p></div><button class="btn btn-sm" data-close-dialog>Close</button></div><div class="card-body"><div class="field-grid" style="margin-bottom:15px"><div class="field"><label>Patient ID</label><strong>${escapeHtml(request.patientId)}</strong></div><div class="field"><label>Department</label><strong>${escapeHtml(request.department)}</strong></div><div class="field"><label>Government scheme</label><strong>${request.scheme ? "Yes — covered" : "No"}</strong></div><div class="field"><label>Status</label>${statusBadge(request.status)}</div></div>${billDetails(request)}<p class="footer-hint">MEDIFLOW demonstration bill · Not a real invoice or medical advice.</p></div>`;
    document.body.appendChild(dialog);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog || event.target.closest("[data-close-dialog]")) dialog.close();
    });
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
  }

  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) renderCurrentPage();
  });
  window.addEventListener("mediflow:update", () => {
    if (PAGE === "relative" && selectedRelativeId) renderRelative();
  });

  loadState();
  if (PAGE === "home") {
    renderHome();
    return;
  }
  currentSession = readSession();
  const permitted = PAGE === "doctor" ? "doctor" : ["staff", "inventory", "billing"].includes(PAGE) ? "staff" : "relative";
  if (!currentSession || (permitted && currentSession.role !== permitted)) {
    const defaultNames = {
      doctor: "Dr. Kavita Rao",
      staff: "Medical Staff",
      relative: "Patient Relative"
    };
    currentSession = setSession(permitted, defaultNames[permitted] || "User");
  }
  initIndexedDB().finally(() => {
    renderCurrentPage();
  });
})();

