const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

// Load Email Notification Service
const emailService = require("./emailService");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, "database.json");
const PAYMENTS_FILE = path.join(__dirname, "payments.json");

// Payment provider config (Razorpay-compatible — set in .env for production)
const PAYMENT_KEY_ID     = process.env.RAZORPAY_KEY_ID     || "";
const PAYMENT_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const UPI_VPA            = process.env.UPI_VPA             || "mediflow@upi"; // Merchant UPI VPA
const APP_URL            = process.env.APP_URL             || `http://localhost:${process.env.PORT || 3000}`;

const isPaymentConfigured = Boolean(PAYMENT_KEY_ID && PAYMENT_KEY_SECRET &&
  !PAYMENT_KEY_ID.includes("your_") && !PAYMENT_KEY_SECRET.includes("your_"));

// ── Payment DB ────────────────────────────────────────────────
function readPayments() {
  try {
    if (!fs.existsSync(PAYMENTS_FILE)) {
      const initial = { version: 1, payments: [] };
      fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(initial, null, 2), "utf8");
      return initial;
    }
    const data = JSON.parse(fs.readFileSync(PAYMENTS_FILE, "utf8"));
    if (!Array.isArray(data.payments)) data.payments = [];
    return data;
  } catch (e) {
    return { version: 1, payments: [] };
  }
}

function writePayments(data) {
  try {
    fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (e) {
    console.error("Error writing payments:", e);
    return false;
  }
}

// Ensure database file exists with clean schema
function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initial = {
        version: 3,
        updatedAt: new Date().toISOString(),
        prescriptions: [],
        notifications: []
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), "utf8");
      return initial;
    }
    const data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    if (!Array.isArray(data.prescriptions)) data.prescriptions = [];
    if (!Array.isArray(data.notifications)) data.notifications = [];
    return data;
  } catch (err) {
    console.error("Error reading database:", err);
    return { version: 3, prescriptions: [], notifications: [] };
  }
}

function writeDB(data) {
  try {
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (err) {
    console.error("Error writing database:", err);
    return false;
  }
}

// In-memory debounce cache to prevent accidental duplicate prescription submissions
const recentSubmissions = new Map();

// ── Helper: Calculate patient payable amount server-side ──────
function calculatePatientPayable(prescription) {
  if (prescription.scheme) return 0; // Government scheme covers full cost
  if (prescription.patientPayable != null && prescription.patientPayable > 0) {
    return Number(prescription.patientPayable);
  }
  // Fall back to computing from medicine list
  const medicines = Array.isArray(prescription.medicines) ? prescription.medicines : [];
  return medicines.reduce((sum, m) => sum + (Number(m.qty) || 1) * (Number(m.price) || 100), 0);
}

// ── Helper: Build UPI deep-link ───────────────────────────────
function buildUpiLink({ vpa, name, amount, ref, note }) {
  const params = new URLSearchParams({
    pa: vpa,
    pn: name,
    am: amount.toFixed(2),
    cu: "INR",
    tn: note || `MediFlow order ${ref}`,
    tr: ref
  });
  return `upi://pay?${params.toString()}`;
}

// MIME types dictionary for static files
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const server = http.createServer((req, res) => {
  // Enable CORS for all requests (supports Live Server & cross-origin access)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-user-role");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = parsedUrl.pathname;

  // JSON Body parser helper
  function getRequestBody(callback) {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        callback(null, parsed);
      } catch (e) {
        callback(e, null);
      }
    });
  }

  // Normalize .php suffix for unified API support
  const apiPath = pathname.replace(/\.php$/, "");

  // Extract client role (from header or query parameter)
  const clientRole = (
    req.headers["x-user-role"] ||
    parsedUrl.searchParams.get("role") ||
    ""
  ).toLowerCase().trim();

  // 1. Health & Status endpoint
  if (apiPath === "/api/status" && req.method === "GET") {
    const db = readDB();
    const emailStatus = emailService.getEmailStatus();
    const pdb = readPayments();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "connected",
      database: "mediflow_json_db",
      totalPrescriptions: db.prescriptions.length,
      unreadNotifications: (db.notifications || []).filter((n) => !n.read).length,
      emailService: emailStatus,
      paymentService: {
        configured: isPaymentConfigured,
        mode: isPaymentConfigured ? "production" : "mock_upi",
        upiVpa: UPI_VPA,
        totalPayments: pdb.payments.length
      },
      updatedAt: db.updatedAt
    }));
    return;
  }

  // 2. Email Logs endpoint (Audit log for notifications)
  if (apiPath === "/api/email-logs" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      logs: emailService.getEmailLogs(),
      status: emailService.getEmailStatus()
    }));
    return;
  }

  // 2b. Email Diagnostics — Send test email (admin/dev only)
  if (apiPath === "/api/email-diagnostics" && req.method === "POST") {
    getRequestBody(async (err, body) => {
      const emailStatus = emailService.getEmailStatus();
      const testRecipient = (body && body.testEmail) || emailStatus.staffEmail;
      const results = [];

      // Step 1: Configuration Validation
      results.push({
        step: "Configuration Validation",
        status: emailStatus.smtpConfigured ? "PASS" : "FAIL",
        detail: emailStatus.smtpConfigured
          ? `SMTP credentials loaded: Host=${emailStatus.smtpHost}, Port=${emailStatus.smtpPort}, TLS=${emailStatus.secure ? "SSL" : "STARTTLS"}, From=${emailStatus.senderEmail}`
          : "SMTP credentials not configured in .env — system is running in safe development simulation mode."
      });

      // Step 2 & 3: Live Provider/SMTP Connection & Authentication Test
      let connCheck = null;
      if (emailStatus.smtpConfigured && typeof emailService.verifyConnection === "function") {
        try {
          connCheck = await emailService.verifyConnection();
          results.push({
            step: "Provider/SMTP Connection",
            status: connCheck.success ? "PASS" : "FAIL",
            detail: connCheck.success
              ? `Socket connection and TLS handshake with ${emailStatus.smtpHost}:${emailStatus.smtpPort} established successfully.`
              : `Connection to SMTP server failed: ${connCheck.error || "Network unreachable"}`
          });
          results.push({
            step: "SMTP Authentication",
            status: connCheck.success ? "PASS" : "FAIL",
            detail: connCheck.success
              ? `Authenticated successfully with SMTP provider as ${emailStatus.senderEmail}.`
              : `SMTP server rejected authentication: ${connCheck.error || "Invalid username or password"}`
          });
        } catch (connErr) {
          results.push({
            step: "Provider/SMTP Connection",
            status: "FAIL",
            detail: `Connection error: ${connErr.message}`
          });
          results.push({
            step: "SMTP Authentication",
            status: "FAIL",
            detail: "Skipped due to connection failure"
          });
        }
      } else {
        results.push({
          step: "Provider/SMTP Connection",
          status: "NOT_APPLICABLE",
          detail: "SMTP not configured — running in safe simulation mode"
        });
        results.push({
          step: "SMTP Authentication",
          status: "NOT_APPLICABLE",
          detail: "SMTP credentials not provided in .env"
        });
      }

      // Step 4: Test Recipient Validation
      const recipientOk = emailService.isValidEmail(testRecipient);
      results.push({
        step: "Recipient Address Validation",
        status: recipientOk ? "PASS" : "FAIL",
        detail: recipientOk
          ? `Recipient address '${testRecipient}' is a well-formed RFC 5322 email.`
          : `Invalid recipient address format: '${testRecipient}'`
      });

      // Step 5: Test Email Dispatch Request
      let sendResult = null;
      if (recipientOk) {
        try {
          sendResult = await emailService.sendDiagnosticsEmail(testRecipient, APP_URL);
          results.push({
            step: "Test Email Request",
            status: sendResult.success ? "PASS" : "FAIL",
            detail: sendResult.simulated
              ? "Dispatched to safe development simulation logger (not delivered to external inbox)."
              : `Dispatched diagnostic payload to SMTP server for ${testRecipient}.`
          });

          // Step 6: Provider Acceptance / Rejection
          results.push({
            step: "Provider Acceptance",
            status: sendResult.success ? (sendResult.simulated ? "NOT_APPLICABLE" : "PASS") : "FAIL",
            detail: sendResult.simulated
              ? "Simulation mode active — email logged locally to email_logs.json."
              : sendResult.success
                ? `Provider accepted message for delivery queue. MessageId: ${sendResult.messageId || "N/A"}`
                : `Provider rejected message: ${sendResult.error || "Unknown provider error"}`
          });
        } catch (e) {
          results.push({
            step: "Test Email Request",
            status: "FAIL",
            detail: `Unexpected error during send: ${e.message}`
          });
          results.push({
            step: "Provider Acceptance",
            status: "FAIL",
            detail: `Dispatch aborted: ${e.message}`
          });
        }
      } else {
        results.push({
          step: "Test Email Request",
          status: "NOT_APPLICABLE",
          detail: "Skipped — recipient address is invalid."
        });
        results.push({
          step: "Provider Acceptance",
          status: "NOT_APPLICABLE",
          detail: "Skipped — send was not attempted."
        });
      }

      // Step 7: Delivery Confirmation
      results.push({
        step: "Delivery Confirmation",
        status: "NOT_VERIFIED",
        detail: "Server cannot verify final inbox delivery without recipient bounce webhooks or delivery status notifications (DSN). Please verify message arrival in the recipient inbox."
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: true,
        results,
        smtpMode: emailStatus.smtpConfigured ? "production_smtp" : "development_simulation",
        testRecipient
      }));
    });
    return;
  }

  // 2c. Payment status endpoint
  if (apiPath === "/api/payments" && req.method === "GET") {
    const prescriptionId = parsedUrl.searchParams.get("prescriptionId");
    const pdb = readPayments();
    if (prescriptionId) {
      const payment = pdb.payments.find((p) => p.prescriptionId === prescriptionId);
      if (payment) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ payment }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ payment: null, status: "Pending" }));
      }
    } else {
      // Staff/admin can list all
      if (clientRole !== "staff" && clientRole !== "admin") {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Access denied" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ payments: pdb.payments }));
    }
    return;
  }

  // 2d. Initiate UPI payment
  if (apiPath === "/api/payments/initiate" && req.method === "POST") {
    getRequestBody(async (err, body) => {
      if (err || !body || !body.prescriptionId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "prescriptionId is required" }));
        return;
      }

      const db = readDB();
      const prescription = db.prescriptions.find((p) =>
        p.prescriptionId === body.prescriptionId
      );

      if (!prescription) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Prescription not found" }));
        return;
      }

      // Calculate amount server-side — never trust frontend amount
      const amount = calculatePatientPayable(prescription);

      // Government scheme: no payment needed
      if (prescription.scheme || amount <= 0) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          schemeOrder: true,
          message: "Covered under Government Healthcare Scheme — no payment required.",
          payment: { prescriptionId: body.prescriptionId, amount: 0, status: "Scheme Covered", method: "scheme" }
        }));
        return;
      }

      const pdb = readPayments();

      // Return existing payment record if one already exists (prevent duplicates)
      const existingRecord = pdb.payments.find((p) => p.prescriptionId === body.prescriptionId);
      if (existingRecord) {
        if (existingRecord.status === "Paid Online" || existingRecord.status === "Paid by Cash") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: true,
            payment: existingRecord,
            upiLink: existingRecord.upiLink || "",
            qrUrl: existingRecord.qrUrl || "",
            message: "Payment already completed for this prescription"
          }));
          return;
        }
        // Return existing pending record instead of creating a new one
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          payment: existingRecord,
          upiLink: existingRecord.upiLink || "",
          qrUrl: existingRecord.qrUrl || "",
          message: "Existing payment record returned"
        }));
        return;
      }

      // Generate payment reference
      const paymentRef = `MFP-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

      // Build UPI deep link
      const upiLink = buildUpiLink({
        vpa: UPI_VPA,
        name: "MediFlow Hospital",
        amount,
        ref: paymentRef,
        note: `Medicine order ${body.prescriptionId}`
      });

      // UPI QR as a URL (using QR API — safe, just encodes the UPI URI)
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(upiLink)}&size=180x180&margin=10&color=1a3a5c`;

      // Create a pending payment record
      const paymentRecord = {
        id: paymentRef,
        prescriptionId: body.prescriptionId,
        patientName: prescription.patientName,
        patientId: prescription.patientId,
        amount,
        amountPaise: Math.round(amount * 100),
        status: "Pending",
        method: null,
        upiLink,
        qrUrl,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        confirmedAt: null,
        confirmedBy: null,
        providerOrderId: null,
        providerPaymentId: null
      };

      pdb.payments.unshift(paymentRecord);
      writePayments(pdb);

      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: true,
        payment: paymentRecord,
        upiLink,
        qrUrl,
        message: isPaymentConfigured
          ? "Payment order created via gateway"
          : "Payment link generated (mock mode — configure RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET for production)"
      }));
    });
    return;
  }

  // 2e. Confirm Cash Payment (staff only)
  if (apiPath === "/api/payments/confirm-cash" && req.method === "POST") {
    if (clientRole !== "staff" && clientRole !== "admin") {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Only authorized staff can confirm cash payments" }));
      return;
    }

    getRequestBody((err, body) => {
      if (err || !body || !body.prescriptionId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "prescriptionId is required" }));
        return;
      }

      const db = readDB();
      const prescription = db.prescriptions.find((p) => p.prescriptionId === body.prescriptionId);

      if (!prescription) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Prescription not found" }));
        return;
      }

      const pdb = readPayments();
      let payment = pdb.payments.find((p) => p.prescriptionId === body.prescriptionId);

      if (!payment) {
        // Create payment record on cash confirmation
        const amount = calculatePatientPayable(prescription);
        payment = {
          id: `MFP-CASH-${Date.now()}`,
          prescriptionId: body.prescriptionId,
          patientName: prescription.patientName,
          patientId: prescription.patientId,
          amount,
          amountPaise: Math.round(amount * 100),
          status: "Paid by Cash",
          method: "cash",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          confirmedAt: Date.now(),
          confirmedBy: body.staffName || "Staff",
          providerOrderId: null,
          providerPaymentId: null
        };
        pdb.payments.unshift(payment);
      } else {
        if (payment.status === "Paid Online" || payment.status === "Paid by Cash") {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Payment already confirmed", payment }));
          return;
        }
        payment.status = "Paid by Cash";
        payment.method = "cash";
        payment.confirmedAt = Date.now();
        payment.confirmedBy = body.staffName || "Staff";
        payment.updatedAt = Date.now();
      }

      writePayments(pdb);

      // Add notification
      if (!Array.isArray(db.notifications)) db.notifications = [];
      db.notifications.unshift({
        id: `N-${Date.now()}-cash`,
        recipientRole: "staff",
        prescriptionId: body.prescriptionId,
        title: "💵 Cash Payment Confirmed",
        message: `Cash payment of ₹${payment.amount} confirmed for ${prescription.patientName} (${body.prescriptionId}) by ${payment.confirmedBy}`,
        read: false,
        createdAt: Date.now()
      });
      writeDB(db);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: true,
        payment,
        message: `Cash payment of ₹${payment.amount} confirmed for ${body.prescriptionId}`
      }));
    });
    return;
  }

  // 2f. UPI Payment webhook / verify (server-side only)
  if (apiPath === "/api/payments/verify" && req.method === "POST") {
    getRequestBody((err, body) => {
      if (err || !body) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid payload" }));
        return;
      }

      // In production with Razorpay: verify webhook signature
      if (isPaymentConfigured && body.razorpay_payment_id && body.razorpay_order_id && body.razorpay_signature) {
        const expectedSig = crypto
          .createHmac("sha256", PAYMENT_KEY_SECRET)
          .update(`${body.razorpay_order_id}|${body.razorpay_payment_id}`)
          .digest("hex");

        if (expectedSig !== body.razorpay_signature) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Payment signature verification failed — possible tampered request" }));
          return;
        }
      }

      // Find the payment record
      const pdb = readPayments();
      const payment = pdb.payments.find((p) =>
        p.id === body.paymentRef ||
        p.prescriptionId === body.prescriptionId
      );

      if (!payment) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Payment record not found" }));
        return;
      }

      if (payment.status === "Paid Online" || payment.status === "Paid by Cash") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, payment, message: "Already paid" }));
        return;
      }

      payment.status = "Paid Online";
      payment.method = "upi";
      payment.confirmedAt = Date.now();
      payment.updatedAt = Date.now();
      if (body.razorpay_payment_id) payment.providerPaymentId = body.razorpay_payment_id;
      if (body.razorpay_order_id) payment.providerOrderId = body.razorpay_order_id;
      writePayments(pdb);

      // Add notification
      const db = readDB();
      if (!Array.isArray(db.notifications)) db.notifications = [];
      db.notifications.unshift({
        id: `N-${Date.now()}-upi`,
        recipientRole: "staff",
        prescriptionId: payment.prescriptionId,
        title: "✅ UPI Payment Received",
        message: `Online payment of ₹${payment.amount} confirmed for ${payment.patientName} (${payment.prescriptionId})`,
        read: false,
        createdAt: Date.now()
      });
      writeDB(db);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, payment, message: "Payment verified and marked as Paid Online" }));
    });
    return;
  }

  // 3. GET Notifications (Filtered by role)
  if (apiPath === "/api/notifications" && req.method === "GET") {
    const db = readDB();
    const role = (parsedUrl.searchParams.get("role") || clientRole || "").toLowerCase();
    const patientId = (parsedUrl.searchParams.get("patientId") || "").toLowerCase();

    let items = db.notifications || [];
    if (role === "staff") {
      items = items.filter((n) => !n.recipientRole || n.recipientRole === "staff" || n.recipientRole === "all");
    } else if (role === "relative") {
      items = items.filter((n) => {
        if (n.recipientRole !== "relative" && n.recipientRole !== "all") return false;
        if (patientId && n.recipientPatientId) {
          return n.recipientPatientId.toLowerCase() === patientId;
        }
        return true;
      });
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ notifications: items }));
    return;
  }

  // 4. POST Mark Notifications Read
  if (apiPath === "/api/notifications" && req.method === "POST") {
    getRequestBody((err, body) => {
      const db = readDB();
      if (body && body.action === "mark_all_read") {
        const targetRole = body.role || clientRole;
        (db.notifications || []).forEach((n) => {
          if (!targetRole || n.recipientRole === targetRole || n.recipientRole === "all") {
            n.read = true;
          }
        });
      } else if (body && body.id) {
        const item = (db.notifications || []).find((n) => n.id === body.id);
        if (item) item.read = true;
      }
      writeDB(db);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Notifications updated", success: true }));
    });
    return;
  }

  // 5. GET Prescriptions (with Role-Based Access Control)
  if (apiPath === "/api/prescriptions" && req.method === "GET") {
    const db = readDB();
    const id = parsedUrl.searchParams.get("id") || parsedUrl.searchParams.get("prescriptionId");
    const patientId = parsedUrl.searchParams.get("patientId") || parsedUrl.searchParams.get("patient_id");
    const status = parsedUrl.searchParams.get("status");

    // Single item query
    if (id) {
      const found = db.prescriptions.find((p) => p.prescriptionId.toLowerCase() === id.toLowerCase());
      if (found) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ prescription: found }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Prescription not found" }));
      }
      return;
    }

    // Role-based protection: Patient Relative CANNOT dump all prescriptions
    if (clientRole === "relative" && !patientId) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: "Access denied. Patient relatives must specify a prescriptionId or patientId to track records."
      }));
      return;
    }

    let results = [...db.prescriptions];

    if (patientId) {
      results = results.filter((p) => (p.patientId || "").toLowerCase() === patientId.toLowerCase());
    }

    if (status) {
      results = results.filter((p) => (p.status || "").toLowerCase() === status.toLowerCase());
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ prescriptions: results }));
    return;
  }

  // 6. POST Add New Prescription (Doctor sends prescription)
  if (apiPath === "/api/prescriptions" && req.method === "POST") {
    getRequestBody(async (err, body) => {
      if (err || !body) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON payload" }));
        return;
      }

      // 1. Validation of required fields
      const patientName = String(body.patientName || "").trim();
      const patientId = String(body.patientId || "").trim();
      const relativeName = String(body.relativeName || "").trim();
      const relativeMobile = String(body.relativeMobile || body.mobile || "").trim();
      const department = String(body.department || "").trim();
      const doctorName = String(body.doctor || body.doctorName || "Dr. Kavita Rao").trim();
      const doctorId = String(body.doctorId || "DOC-101").trim();
      const patientEmail = String(body.patientEmail || body.relativeEmail || body.email || "").trim();
      const instructions = String(body.instructions || "").trim();
      const priority = body.priority === "HIGH" ? "HIGH" : "REGULAR";
      const medicines = Array.isArray(body.medicines) ? body.medicines : [];

      if (!patientName || !patientId || !relativeName || !department) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing required patient fields: patientName, patientId, relativeName, and department are mandatory." }));
        return;
      }

      if (medicines.length === 0) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Prescription must contain at least one medicine item." }));
        return;
      }

      // 2. Prevent accidental duplicate submissions (within 15 seconds)
      const debounceKey = `${patientId.toLowerCase()}_${medicines.map((m) => `${m.name}:${m.qty}`).join("_")}`;
      const now = Date.now();
      if (recentSubmissions.has(debounceKey) && now - recentSubmissions.get(debounceKey) < 15000) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Duplicate submission detected. Please wait a moment before sending another prescription for this patient." }));
        return;
      }
      recentSubmissions.set(debounceKey, now);

      // Clean old debounce keys
      for (const [key, timestamp] of recentSubmissions.entries()) {
        if (now - timestamp > 60000) recentSubmissions.delete(key);
      }

      const db = readDB();

      // 3. Generate unique Prescription ID if not supplied or ensure uniqueness
      let prescriptionId = String(body.prescriptionId || "").trim();
      if (!prescriptionId) {
        const nextNum = db.prescriptions.length + 1001;
        prescriptionId = `MF-2026-${nextNum}`;
      }

      // Check if prescription ID already exists
      const existingIndex = db.prescriptions.findIndex((p) => p.prescriptionId.toLowerCase() === prescriptionId.toLowerCase());
      if (existingIndex >= 0) {
        // If it already exists, generate a fresh non-colliding ID
        prescriptionId = `MF-2026-${Date.now().toString().slice(-4)}`;
      }

      // 4. Construct complete prescription record with initial status = 'New'
      const newPrescription = {
        prescriptionId,
        patientName,
        patientId,
        ageGender: String(body.ageGender || body.patientAge || "").trim(),
        relativeName,
        mobile: relativeMobile,
        patientEmail,
        relativeEmail: patientEmail,
        department,
        priority,
        scheme: Boolean(body.scheme),
        doctor: doctorName,
        doctorId,
        medicines: medicines.map((m) => ({
          name: String(m.name || "").trim(),
          qty: parseInt(m.qty || 1, 10),
          price: parseFloat(m.price || 100)
        })),
        instructions,
        status: "New", // Requirement 1: Initial status MUST be "New"
        createdAt: now,
        updatedAt: now,
        availability: null,
        total: null,
        patientPayable: null,
        claimAmount: null,
        counter: null,
        stockDeducted: false,
        isDemo: false,
        emailHistory: {
          newPrescriptionSentAt: null,
          readyForCollectionSentAt: null
        }
      };

      db.prescriptions.unshift(newPrescription);

      // 5. In-App Notification for Medical Staff
      const notif = {
        id: `N-${now}-${Math.random().toString(36).slice(2, 6)}`,
        recipientRole: "staff",
        prescriptionId,
        title: "🔔 New Prescription Received",
        message: `Patient: ${patientName} (ID: ${patientId}) | Doctor: ${doctorName} | Priority: ${priority}`,
        read: false,
        createdAt: now
      };
      if (!Array.isArray(db.notifications)) db.notifications = [];
      db.notifications.unshift(notif);

      writeDB(db);

      // 6. Deliver Real Email Notification to Medical Staff (Requirement 4)
      let emailResult = null;
      try {
        emailResult = await emailService.sendNewPrescriptionEmail(
          newPrescription,
          `http://${req.headers.host || "localhost:" + PORT}`
        );
        if (emailResult && emailResult.success && !emailResult.skipped) {
          newPrescription.emailHistory.newPrescriptionSentAt = new Date().toISOString();
          writeDB(db);
        }
      } catch (emailErr) {
        console.error("[SERVER] Error sending new prescription email:", emailErr);
      }

      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: true,
        message: "Prescription stored successfully in database with initial status 'New'",
        prescription: newPrescription,
        notification: notif,
        emailStatus: emailResult
      }));
    });
    return;
  }

  // 7. PUT Update Prescription Status & Details
  if (apiPath.startsWith("/api/prescriptions") && req.method === "PUT") {
    let id = parsedUrl.searchParams.get("id");
    if (!id && apiPath.startsWith("/api/prescriptions/")) {
      id = decodeURIComponent(apiPath.replace("/api/prescriptions/", ""));
    }

    // Role-based protection: Relative cannot update status
    if (clientRole === "relative") {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Access denied. Patient relatives are not authorized to update pharmacy processing statuses." }));
      return;
    }

    getRequestBody(async (err, body) => {
      if (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }

      const targetId = id || (body ? body.prescriptionId : null);
      if (!targetId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Prescription ID is required for update" }));
        return;
      }

      const db = readDB();
      const index = db.prescriptions.findIndex(
        (p) => (p.prescriptionId || "").toLowerCase() === String(targetId).toLowerCase()
      );

      if (index === -1) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Prescription not found in database" }));
        return;
      }

      const prevStatus = db.prescriptions[index].status;
      const updatedRecord = { ...db.prescriptions[index], ...body, updatedAt: Date.now() };

      // Normalization of status values
      const rawStatus = String(updatedRecord.status || "").trim();
      if (rawStatus === "PACKED" || rawStatus.toLowerCase() === "packed" || rawStatus === "READY" || rawStatus.toLowerCase() === "ready for collection") {
        updatedRecord.status = "Packed";
      } else if (rawStatus === "RECEIVED" || rawStatus.toLowerCase() === "received" || rawStatus.toLowerCase() === "prescription received") {
        updatedRecord.status = "Received";
      } else if (rawStatus === "PREPARING" || rawStatus.toLowerCase() === "preparing") {
        updatedRecord.status = "Preparing";
      } else if (rawStatus === "COLLECTED" || rawStatus.toLowerCase() === "collected" || rawStatus.toLowerCase() === "completed" || rawStatus.toLowerCase() === "complete") {
        updatedRecord.status = "Collected";
      }

      // Feature: When Medical Staff marks Medicine Packed / Ready for Collection
      let relativeNotif = null;
      let emailResult = null;

      const isNowPacked = updatedRecord.status === "Packed" || updatedRecord.status === "Ready for Collection";
      const wasPacked = prevStatus === "Packed" || prevStatus === "Ready for Collection" || prevStatus === "READY";
      const pickupEmailAlreadySent = Boolean(updatedRecord.emailHistory && updatedRecord.emailHistory.readyForCollectionSentAt);

      if (isNowPacked && (!wasPacked || !pickupEmailAlreadySent)) {
        if (!updatedRecord.counter) {
          updatedRecord.counter = updatedRecord.priority === "HIGH" ? "Emergency Counter" : "Pharmacy Counter 1";
        }

        // 1. In-App Notification for Patient / Relative
        relativeNotif = {
          id: `N-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          recipientRole: "relative",
          recipientPatientId: updatedRecord.patientId,
          prescriptionId: updatedRecord.prescriptionId,
          title: "🔔 Medicine Packed & Ready for Pickup",
          message: `The prescribed medicines for ${updatedRecord.patientName} (Prescription ID: ${updatedRecord.prescriptionId}) are packed. Please collect from ${updatedRecord.counter}.`,
          read: false,
          createdAt: Date.now()
        };
        if (!Array.isArray(db.notifications)) db.notifications = [];
        db.notifications.unshift(relativeNotif);

        // 2. Compute patient payable server-side
        const payableAmount = calculatePatientPayable(updatedRecord);
        updatedRecord.patientPayable = payableAmount;

        // 3. Create payment record (Pending)
        const pdb = readPayments();
        let existingPayment = pdb.payments.find((p) => p.prescriptionId === updatedRecord.prescriptionId);
        if (!existingPayment && payableAmount > 0) {
          const paymentRef = `MFP-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
          const upiLink = buildUpiLink({
            vpa: UPI_VPA,
            name: "MediFlow Hospital",
            amount: payableAmount,
            ref: paymentRef,
            note: `Medicine order ${updatedRecord.prescriptionId}`
          });
          const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(upiLink)}&size=180x180&margin=10&color=1a3a5c`;

          existingPayment = {
            id: paymentRef,
            prescriptionId: updatedRecord.prescriptionId,
            patientName: updatedRecord.patientName,
            patientId: updatedRecord.patientId,
            amount: payableAmount,
            amountPaise: Math.round(payableAmount * 100),
            status: "Pending",
            method: null,
            upiLink,
            qrUrl,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            confirmedAt: null,
            confirmedBy: null
          };
          pdb.payments.unshift(existingPayment);
          writePayments(pdb);
        }

        if (existingPayment) {
          updatedRecord._paymentRef = existingPayment.id;
          updatedRecord._upiLink = existingPayment.upiLink;
          updatedRecord._qrUrl = existingPayment.qrUrl;
        }

        // SAVE DB FIRST before delivering email
        db.prescriptions[index] = updatedRecord;
        writeDB(db);

        // 4. Deliver Real Email Notification to Patient/Relative (Requirement 4)
        try {
          const serverUrl = `http://${req.headers.host || `localhost:${PORT}`}`;
          emailResult = await emailService.sendReadyForCollectionEmail(updatedRecord, serverUrl);
          if (!updatedRecord.emailHistory) updatedRecord.emailHistory = {};
          if (emailResult && emailResult.success && !emailResult.skipped) {
            updatedRecord.emailHistory.readyForCollectionSentAt = new Date().toISOString();
            writeDB(db);
          }
        } catch (emailErr) {
          console.error("[SERVER] Error sending ready email to relative:", emailErr);
        }
      } else {
        db.prescriptions[index] = updatedRecord;
        writeDB(db);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: true,
        message: "Prescription updated successfully in database",
        prescription: updatedRecord,
        notification: relativeNotif,
        emailStatus: emailResult
      }));
    });
    return;
  }

  // 7b. Resend Email Notification (Staff or Doctor)
  if (apiPath === "/api/prescriptions/resend-email" && req.method === "POST") {
    getRequestBody(async (err, body) => {
      if (err || !body || !body.prescriptionId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "prescriptionId is required" }));
        return;
      }
      const db = readDB();
      const prescription = db.prescriptions.find(
        (p) => (p.prescriptionId || "").toLowerCase() === String(body.prescriptionId).toLowerCase()
      );
      if (!prescription) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Prescription not found" }));
        return;
      }

      const serverUrl = `http://${req.headers.host || `localhost:${PORT}`}`;
      const type = body.type || (prescription.status === "Packed" || prescription.status === "Ready for Collection" ? "ready_for_collection" : "new_prescription");

      let emailResult = null;
      if (type === "ready_for_collection") {
        const pdb = readPayments();
        const payment = pdb.payments.find((p) => p.prescriptionId === prescription.prescriptionId);
        if (payment) {
          prescription._paymentRef = payment.id;
          prescription._upiLink = payment.upiLink;
          prescription._qrUrl = payment.qrUrl;
        }
        emailResult = await emailService.sendReadyForCollectionEmail(prescription, serverUrl, { force: true });
        if (emailResult && emailResult.success && !emailResult.skipped) {
          if (!prescription.emailHistory) prescription.emailHistory = {};
          prescription.emailHistory.readyForCollectionSentAt = new Date().toISOString();
          writeDB(db);
        }
      } else {
        emailResult = await emailService.sendNewPrescriptionEmail(prescription, serverUrl, { force: true });
        if (emailResult && emailResult.success && !emailResult.skipped) {
          if (!prescription.emailHistory) prescription.emailHistory = {};
          prescription.emailHistory.newPrescriptionSentAt = new Date().toISOString();
          writeDB(db);
        }
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: Boolean(emailResult && emailResult.success),
        emailStatus: emailResult
      }));
    });
    return;
  }

  // 8. DELETE Remove Prescription
  if (apiPath.startsWith("/api/prescriptions") && req.method === "DELETE") {
    let id = parsedUrl.searchParams.get("id");
    if (!id && apiPath.startsWith("/api/prescriptions/")) {
      id = decodeURIComponent(apiPath.replace("/api/prescriptions/", ""));
    }
    const db = readDB();
    const before = db.prescriptions.length;
    db.prescriptions = db.prescriptions.filter((p) => p.prescriptionId.toLowerCase() !== String(id).toLowerCase());
    if (db.prescriptions.length === before) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Prescription not found" }));
      return;
    }
    writeDB(db);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Prescription deleted from database", success: true }));
    return;
  }

  // 9. Reset Endpoint
  if (apiPath === "/api/reset" && (req.method === "POST" || req.method === "GET")) {
    const db = {
      version: 3,
      updatedAt: new Date().toISOString(),
      prescriptions: [],
      notifications: []
    };
    writeDB(db);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Database reset successfully." }));
    return;
  }

  // --- STATIC FILE SERVING ---
  let filePath = path.join(__dirname, pathname === "/" ? "index.html" : pathname);

  // Security check to avoid directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      if (!path.extname(filePath)) {
        filePath += ".html";
      }
    }

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>404 Not Found</h1><p>The requested file was not found on MEDIFLOW server.</p>");
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === "IPv4" && !net.internal) {
        addresses.push(net.address);
      }
    }
  }

  console.log(`=======================================================`);
  console.log(`  MEDIFLOW Smart Hospital Queue & Database Server`);
  console.log(`=======================================================`);
  console.log(`  ➜ Local:           http://localhost:${PORT}`);
  addresses.forEach((addr) => {
    console.log(`  ➜ Network (Wi-Fi): http://${addr}:${PORT}`);
  });
  console.log(`  Database File:     ${DB_FILE}`);
  console.log(`  Status:            Online & Ready`);
  console.log(`=======================================================`);
});

module.exports = server;
