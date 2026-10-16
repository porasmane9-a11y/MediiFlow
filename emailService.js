// ==============================================================================
// MEDIFLOW - Email Notification Service (Nodemailer + SMTP)
// ==============================================================================

const path = require("node:path");
const fs = require("node:fs");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const nodemailer = require("nodemailer");

const LOG_FILE = path.join(__dirname, "email_logs.json");

const SMTP_HOST = process.env.SMTP_HOST ? process.env.SMTP_HOST.trim() : "";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587", 10);
const SMTP_SECURE = process.env.SMTP_SECURE === "true" || SMTP_PORT === 465;
const SMTP_USER = process.env.SMTP_USER ? process.env.SMTP_USER.trim() : "";
const SMTP_PASS = process.env.SMTP_PASS ? process.env.SMTP_PASS.trim() : "";
const EMAIL_FROM = process.env.EMAIL_FROM ? process.env.EMAIL_FROM.trim() : "MEDIFLOW Hospital <noreply@mediflow.local>";
const STAFF_NOTIFICATION_EMAIL = process.env.STAFF_NOTIFICATION_EMAIL ? process.env.STAFF_NOTIFICATION_EMAIL.trim() : "staff@mediflow.local";

// Check if actual valid SMTP credentials have been provided
const isSmtpConfigured = Boolean(
  SMTP_HOST &&
  SMTP_USER &&
  SMTP_PASS &&
  !SMTP_USER.includes("your-email") &&
  !SMTP_PASS.includes("your-app-password")
);

let transporter = null;

if (isSmtpConfigured) {
  try {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    console.log(`[EMAIL SERVICE] SMTP configured for ${SMTP_HOST}:${SMTP_PORT} as ${SMTP_USER}`);
    transporter.verify((err) => {
      if (err) {
        console.warn(`[EMAIL SERVICE] Warning: SMTP connection verification failed (${err.message}). Check your credentials in .env.`);
      } else {
        console.log(`[EMAIL SERVICE] SMTP server connection verified successfully.`);
      }
    });
  } catch (err) {
    console.error(`[EMAIL SERVICE] Error initializing SMTP transport:`, err.message);
  }
} else {
  console.log(`[EMAIL SERVICE] ====================================================================`);
  console.log(`[EMAIL SERVICE] NOTICE: SMTP credentials are not configured in .env.`);
  console.log(`[EMAIL SERVICE] Running in Safe Development / Simulation Mode.`);
  console.log(`[EMAIL SERVICE] All email notifications will be cleanly logged to console & email_logs.json.`);
  console.log(`[EMAIL SERVICE] Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in .env for real delivery.`);
  console.log(`[EMAIL SERVICE] ====================================================================`);
}

/**
 * Asynchronously test and verify live SMTP connection and credentials
 */
async function verifyConnection() {
  if (!isSmtpConfigured || !transporter) {
    return {
      success: false,
      configured: false,
      error: "SMTP credentials not configured in .env — operating in simulation mode"
    };
  }
  return new Promise((resolve) => {
    transporter.verify((err) => {
      if (err) {
        resolve({ success: false, configured: true, error: err.message });
      } else {
        resolve({ success: true, configured: true });
      }
    });
  });
}

// Ensure email logs file exists
function getEmailLogs() {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const content = fs.readFileSync(LOG_FILE, "utf8");
    return JSON.parse(content) || [];
  } catch (e) {
    return [];
  }
}

function appendEmailLog(entry) {
  try {
    const logs = getEmailLogs();
    logs.unshift({
      timestamp: new Date().toISOString(),
      ...entry
    });
    // Keep last 100 logs
    const trimmed = logs.slice(0, 100);
    fs.writeFileSync(LOG_FILE, JSON.stringify(trimmed, null, 2), "utf8");
  } catch (err) {
    console.error("[EMAIL SERVICE] Error writing email log:", err.message);
  }
}

// Email format validator
function isValidEmail(email) {
  if (!email || typeof email !== "string") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * 1. Send notification to Medical Staff when a doctor issues a new prescription
 */
async function sendNewPrescriptionEmail(prescription, serverUrl = "http://localhost:3000", options = {}) {
  const recipient = STAFF_NOTIFICATION_EMAIL;
  const prescriptionId = prescription.prescriptionId;
  const staffDashboardUrl = `${serverUrl}/staff.html`;

  // Prevent duplicate email dispatch
  if (prescription.emailHistory && prescription.emailHistory.newPrescriptionSentAt && !options.force) {
    console.log(`[EMAIL SERVICE] ℹ Notification already sent for new prescription ${prescriptionId}. Skipping duplicate.`);
    return { success: true, skipped: true, reason: "New prescription notification already sent" };
  }

  // Clear subject protecting patient privacy while identifying the order
  const subject = `New Prescription Received — MediFlow [Ref: ${prescriptionId}]`;

  const medicinesList = Array.isArray(prescription.medicines)
    ? prescription.medicines.map((m) => `<li><strong>${escapeHtml(m.name)}</strong> × ${m.qty}</li>`).join("")
    : "<li>No medicine items listed</li>";

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f7fa; margin: 0; padding: 20px; color: #2d3748; }
        .card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
        .header { background: #123b67; color: #ffffff; padding: 24px; }
        .header h1 { margin: 0 0 6px 0; font-size: 20px; font-weight: 700; }
        .header p { margin: 0; opacity: 0.85; font-size: 13px; }
        .badge { display: inline-block; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 700; margin-top: 10px; }
        .badge-emergency { background: #fed7d7; color: #9b2c2c; }
        .badge-regular { background: #c6f6d5; color: #22543d; }
        .content { padding: 24px; }
        .details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; background: #f8fafc; padding: 14px; border-radius: 8px; border: 1px solid #edf2f7; }
        .detail-item { font-size: 13px; }
        .detail-item strong { display: block; color: #718096; font-size: 11px; text-transform: uppercase; margin-bottom: 2px; }
        .instructions { background: #fffaf0; border-left: 4px solid #dd6b20; padding: 12px; margin: 16px 0; border-radius: 4px; font-size: 13px; }
        .btn { display: inline-block; background: #1a6296; color: #ffffff !important; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px; margin-top: 16px; }
        .footer { padding: 16px 24px; background: #edf2f7; font-size: 12px; color: #718096; text-align: center; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>MEDIFLOW Hospital Management</h1>
          <p>Smart Hospital Medicine Queue & Preparation System</p>
          <span class="badge ${prescription.priority === "HIGH" ? "badge-emergency" : "badge-regular"}">
            ${prescription.priority === "HIGH" ? "🚨 HIGH PRIORITY / EMERGENCY CASE" : "🟢 REGULAR CASE"}
          </span>
        </div>
        <div class="content">
          <p style="font-size: 15px; margin-top: 0;">A new digital prescription has been submitted by doctor and added to the medical staff queue.</p>
          <div class="details-grid">
            <div class="detail-item"><strong>Prescription ID</strong><span>${escapeHtml(prescriptionId)}</span></div>
            <div class="detail-item"><strong>Doctor</strong><span>${escapeHtml(prescription.doctor || prescription.doctorName || "Dr. Kavita Rao")}</span></div>
            <div class="detail-item"><strong>Patient Name</strong><span>${escapeHtml(prescription.patientName)}</span></div>
            <div class="detail-item"><strong>Patient ID</strong><span>${escapeHtml(prescription.patientId)}</span></div>
            <div class="detail-item"><strong>Department</strong><span>${escapeHtml(prescription.department)}</span></div>
            <div class="detail-item"><strong>Relative Contact</strong><span>${escapeHtml(prescription.relativeName)} (${escapeHtml(prescription.mobile || "N/A")})</span></div>
          </div>
          ${prescription.instructions ? `<div class="instructions"><strong>Doctor's Instructions:</strong><br>${escapeHtml(prescription.instructions)}</div>` : ""}
          <h3 style="font-size: 14px; margin-bottom: 8px; color: #2d3748;">Prescribed Medicines:</h3>
          <ul style="padding-left: 20px; margin-top: 0; font-size: 13px;">${medicinesList}</ul>
          <div style="text-align: center; margin: 24px 0 10px 0;">
            <a class="btn" href="${staffDashboardUrl}" target="_blank">Open Medical Staff Queue →</a>
          </div>
        </div>
        <div class="footer">
          MEDIFLOW Hospital System · This is an automated notification.
        </div>
      </div>
    </body>
    </html>
  `;

  const textContent = `
[MEDIFLOW] New Prescription Received
----------------------------------------
Prescription ID: ${prescriptionId}
Priority:        ${prescription.priority}
Doctor:          ${prescription.doctor || prescription.doctorName || "Dr. Kavita Rao"}
Patient:         ${prescription.patientName} (ID: ${prescription.patientId})
Department:      ${prescription.department}
Relative:        ${prescription.relativeName} (${prescription.mobile || "N/A"})
${prescription.instructions ? `Instructions:    ${prescription.instructions}` : ""}

Please open the Medical Staff dashboard to review and accept this order:
${staffDashboardUrl}
  `.trim();

  // If real SMTP is configured, attempt real delivery
  if (isSmtpConfigured && transporter) {
    try {
      const info = await transporter.sendMail({
        from: EMAIL_FROM,
        to: recipient,
        subject,
        text: textContent,
        html: htmlContent
      });

      appendEmailLog({
        type: "new_prescription",
        prescriptionId,
        recipient,
        subject,
        status: "sent",
        messageId: info.messageId,
        mode: "smtp"
      });

      console.log(`[EMAIL SERVICE] ✓ Email successfully sent to staff (${recipient}) for prescription ${prescriptionId}`);
      return { success: true, mode: "smtp", messageId: info.messageId, recipient };
    } catch (err) {
      console.error(`[EMAIL SERVICE] Failed to deliver email via SMTP:`, err.message);
      appendEmailLog({
        type: "new_prescription",
        prescriptionId,
        recipient,
        subject,
        status: "failed",
        error: err.message,
        mode: "smtp"
      });
      return { success: false, mode: "smtp", error: err.message, recipient };
    }
  }

  // Safe Development Simulation Mode
  appendEmailLog({
    type: "new_prescription",
    prescriptionId,
    recipient,
    subject,
    status: "simulated_development",
    mode: "development_simulation",
    note: "SMTP not configured in .env. Email content generated and logged safely."
  });

  console.log(`[EMAIL SERVICE - DEV MODE] 📧 [Simulated Email to Staff: ${recipient}] ${subject}`);
  return { success: true, mode: "development_simulation", recipient, simulated: true };
}

/**
 * 2. Send notification to Patient / Relative when medicine is Ready for Collection
 * Enhanced: includes Cash + UPI payment options, amount, QR code
 */
async function sendReadyForCollectionEmail(prescription, serverUrl = "http://localhost:3000", options = {}) {
  const recipient = (prescription.patientEmail || prescription.relativeEmail || "").trim();
  const prescriptionId = prescription.prescriptionId;
  const counter = prescription.counter || (prescription.priority === "HIGH" ? "Emergency Counter" : "Pharmacy Counter 1");

  // Prevent duplicate pickup emails
  if (prescription.emailHistory && prescription.emailHistory.readyForCollectionSentAt && !options.force) {
    console.log(`[EMAIL SERVICE] ℹ Pickup email already sent for ${prescriptionId}. Skipping duplicate.`);
    return { success: true, skipped: true, reason: "Pickup email already sent" };
  }

  if (!recipient || !isValidEmail(recipient)) {
    const reason = !recipient ? "No email address provided for patient/relative" : "Invalid email address format";
    console.log(`[EMAIL SERVICE] ℹ Skipped ready email for ${prescriptionId}: ${reason} (${recipient || "none"})`);
    appendEmailLog({
      type: "ready_for_collection",
      prescriptionId,
      recipient: recipient || "none",
      status: "skipped",
      reason
    });
    return { success: false, reason, skipped: true };
  }

  // Calculate amount server-side
  const medicines = Array.isArray(prescription.medicines) ? prescription.medicines : [];
  const total = prescription.patientPayable != null
    ? Number(prescription.patientPayable)
    : medicines.reduce((s, m) => s + (Number(m.qty) || 1) * (Number(m.price) || 100), 0);
  const isScheme = Boolean(prescription.scheme);
  const payableStr = isScheme ? "₹0 (Government Scheme)" : `₹${total.toLocaleString("en-IN")}`;

  const orderPageUrl = `${serverUrl}/relative.html`;
  const upiLink = prescription._upiLink || "";
  const qrUrl = prescription._qrUrl || "";

  const subject = `Your Medicine Order is Ready for Pickup — MediFlow`;

  const paymentOptionsHtml = isScheme
    ? `<div style="background:#e8f7f1;border:1px solid #a7dfca;border-radius:10px;padding:16px 20px;margin:18px 0;">
        <strong style="color:#0a7048;font-size:13px;">✅ Government Scheme — No Payment Required</strong>
        <p style="margin:6px 0 0;color:#207058;font-size:12px;">Your prescription is covered under the Government Healthcare Scheme. Simply collect your medicines from the counter with your prescription ID.</p>
      </div>`
    : `<div style="margin:20px 0;">
        <p style="font-weight:700;color:#0f2e4c;font-size:13px;margin:0 0 14px;">Choose a payment method:</p>

        <!-- OPTION A: Cash on Pickup -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
          <tr>
            <td style="background:#fdf5e5;border:1px solid #f0d08a;border-radius:10px;padding:16px 18px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="40">
                    <div style="width:38px;height:38px;background:#fff3cd;border-radius:9px;text-align:center;line-height:38px;font-size:20px;">💵</div>
                  </td>
                  <td style="padding-left:12px;">
                    <strong style="display:block;color:#6b4a0e;font-size:13px;">Option A — Cash on Pickup</strong>
                    <span style="color:#8c6218;font-size:11.5px;">Pay by cash when collecting your packed medicine order at the hospital pharmacy.</span>
                  </td>
                </tr>
              </table>
              <p style="margin:10px 0 0;color:#7a5014;font-size:11px;border-top:1px solid #e8c87a;padding-top:8px;">
                Payable amount: <strong>${payableStr}</strong> · Order Reference: <strong>${escapeHtml(prescriptionId)}</strong><br>
                Show this email or Prescription ID <strong>${escapeHtml(prescriptionId)}</strong> at <strong>${escapeHtml(counter)}</strong>. Payment is confirmed by pharmacy staff after cash receipt.
              </p>
            </td>
          </tr>
        </table>

        <!-- OPTION B: UPI Online -->
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background:#e9f8ee;border:1px solid #a3ddb5;border-radius:10px;padding:16px 18px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="40">
                    <div style="width:38px;height:38px;background:#c8f0d4;border-radius:9px;text-align:center;line-height:38px;font-size:20px;">📲</div>
                  </td>
                  <td style="padding-left:12px;">
                    <strong style="display:block;color:#0a5c2a;font-size:13px;">Option B — Online UPI Payment</strong>
                    <span style="color:#166838;font-size:11.5px;">Pay ₹${total.toLocaleString("en-IN")} securely via any UPI app — Google Pay, PhonePe, Paytm, BHIM.</span>
                  </td>
                </tr>
              </table>
              ${qrUrl ? `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">
                <tr>
                  <td width="200" style="text-align:center;">
                    <img src="${escapeHtml(qrUrl)}" width="160" height="160" alt="UPI QR Code" style="border-radius:8px;border:1px solid #c8e8cf;display:block;margin:0 auto;" />
                    <p style="margin:8px 0 0;color:#1a7040;font-size:10px;font-weight:700;">Scan with any UPI app</p>
                  </td>
                  <td style="padding-left:16px;vertical-align:top;">
                    <p style="margin:0 0 10px;color:#1a6836;font-size:11px;font-weight:700;">Amount: ₹${total.toLocaleString("en-IN")}</p>
                    <p style="margin:0 0 8px;color:#4a7a58;font-size:10.5px;">Order ref: <strong>${escapeHtml(prescriptionId)}</strong></p>
                    ${upiLink ? `<a href="${escapeHtml(upiLink)}" style="display:inline-block;background:#2ba04a;color:#fff;padding:9px 16px;border-radius:8px;font-size:11px;font-weight:700;text-decoration:none;margin-top:4px;">Open UPI App →</a>` : ""}
                    <p style="margin:10px 0 0;color:#5a7a65;font-size:9.5px;">If you are reading this on a phone, tap the button above to open your UPI app directly.</p>
                  </td>
                </tr>
              </table>
              ` : `
              ${upiLink ? `<div style="margin-top:12px;text-align:center;">
                <a href="${escapeHtml(upiLink)}" style="display:inline-block;background:#2ba04a;color:#fff;padding:10px 20px;border-radius:8px;font-size:12px;font-weight:700;text-decoration:none;">Pay ₹${total.toLocaleString("en-IN")} via UPI →</a>
              </div>` : ""}
              `}
              <p style="margin:10px 0 0;color:#2a7048;font-size:10.5px;border-top:1px solid #b0dfc0;padding-top:8px;">
                ⚠ UPI payment confirmation is recorded automatically. Do not pay twice. Bring your payment confirmation or show this email at the counter.
              </p>
            </td>
          </tr>
        </table>
      </div>`;

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Medicine Ready — MediFlow</title>
</head>
<body style="margin:0;padding:0;background:#f2f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e3a52;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f6fa;padding:24px 16px;">
    <tr><td align="center">

      <!-- Card -->
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;border:1px solid #e1eaf2;overflow:hidden;box-shadow:0 8px 28px rgba(15,46,76,.10);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#0f2e4c 0%,#123b67 55%,#0a5060 100%);padding:28px 28px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <div style="background:linear-gradient(145deg,#2dcabc,#0a8f85);width:42px;height:42px;border-radius:12px;text-align:center;line-height:42px;font-size:18px;font-weight:900;color:white;display:inline-block;margin-bottom:12px;">M</div>
                  <h1 style="margin:0 0 6px;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-.04em;">Your Medicine Order is Ready</h1>
                  <p style="margin:0;color:rgba(200,220,235,.85);font-size:12px;">MediFlow Hospital Pharmacy System</p>
                </td>
                <td style="text-align:right;vertical-align:top;">
                  <span style="background:rgba(14,148,136,.22);color:#7de8df;padding:5px 12px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:.04em;white-space:nowrap;">READY FOR PICKUP</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Green status bar -->
        <tr>
          <td style="background:#0e9488;padding:11px 28px;">
            <p style="margin:0;color:white;font-size:12px;font-weight:600;">📦 Medicines packed and ready · Proceed to <strong>${escapeHtml(counter)}</strong></p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:28px;">

            <p style="margin:0 0 18px;font-size:14px;color:#1e3a52;">
              Dear <strong>${escapeHtml(prescription.relativeName || prescription.patientName)}</strong>,
            </p>

            <p style="margin:0 0 18px;font-size:13.5px;color:#2e4a62;line-height:1.7;">
              The prescribed medicines for patient <strong>${escapeHtml(prescription.patientName)}</strong>
              (Patient ID: <strong>${escapeHtml(prescription.patientId)}</strong>) have been checked, prepared, and packed by our pharmacy team. Your order is now ready for collection.
            </p>

            <!-- Order summary box -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7fafd;border:1px solid #dce9f0;border-radius:12px;margin-bottom:20px;">
              <tr>
                <td style="padding:18px 20px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding:6px 0;border-bottom:1px solid #eff4f8;font-size:12px;">
                        <span style="color:#5e7891;">Prescription ID</span>
                        <strong style="float:right;color:#0f2e4c;font-family:monospace;">${escapeHtml(prescriptionId)}</strong>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;border-bottom:1px solid #eff4f8;font-size:12px;">
                        <span style="color:#5e7891;">Department</span>
                        <strong style="float:right;color:#1e3a52;">${escapeHtml(prescription.department)}</strong>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;border-bottom:1px solid #eff4f8;font-size:12px;">
                        <span style="color:#5e7891;">Collection Counter</span>
                        <strong style="float:right;color:#0e9488;">${escapeHtml(counter)}</strong>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:6px 0;font-size:13px;">
                        <strong style="color:#5e7891;">Total Payable</strong>
                        <strong style="float:right;color:#0f2e4c;font-size:16px;">${payableStr}</strong>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            ${paymentOptionsHtml}

            <!-- Collection Instructions & Hospital Contact -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0faf8;border:1px solid #a0ddd8;border-radius:10px;margin-top:20px;">
              <tr>
                <td style="padding:16px 18px;">
                  <strong style="display:block;color:#0a6e68;font-size:12.5px;margin-bottom:8px;">📋 Pickup Instructions &amp; Hospital Details</strong>
                  <ul style="margin:0 0 10px;padding-left:18px;color:#1f6a64;font-size:11.5px;line-height:1.8;">
                    <li>Collection Counter: <strong>${escapeHtml(counter)}</strong> at City Hospital Pharmacy (Ground Floor, OPD Wing)</li>
                    <li>Present your Prescription Reference: <strong>${escapeHtml(prescriptionId)}</strong></li>
                    <li>Carry a valid photo ID for verification</li>
                    <li>Have your payment ready (cash or show verified UPI payment)</li>
                  </ul>
                  <div style="border-top:1px dashed #a0ddd8;padding-top:8px;font-size:11px;color:#0a6e68;">
                    <strong>Need assistance?</strong> Contact the Pharmacy Helpdesk: <strong>+91 (0) 22 2555 0199</strong> or email <strong>pharmacy@mediflow.local</strong> (Open 24/7 for Inpatient/Emergency, 8:00 AM – 10:00 PM for OPD).
                  </div>
                </td>
              </tr>
            </table>

            <!-- View Order button -->
            <div style="text-align:center;margin-top:24px;">
              <a href="${escapeHtml(orderPageUrl)}" style="display:inline-block;background:#0f2e4c;color:#ffffff;padding:13px 28px;border-radius:10px;font-size:13px;font-weight:700;text-decoration:none;">View Order &amp; Payment Status →</a>
            </div>

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:16px 28px;background:#f7fafc;border-top:1px solid #e8f0f5;">
            <p style="margin:0;color:#8da3b6;font-size:10.5px;line-height:1.6;text-align:center;">
              This is an automated notification from <strong>MediFlow Hospital Pharmacy System</strong>.<br>
              Do not reply to this email. For assistance, contact the hospital pharmacy helpdesk at +91 (0) 22 2555 0199.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const textContent = `
MediFlow — Medicine Ready for Pickup
========================================
Dear ${prescription.relativeName || prescription.patientName},

The prescribed medicines for patient ${prescription.patientName}
(Patient ID: ${prescription.patientId}) are packed and ready for collection.

PRESCRIPTION ID: ${prescriptionId}
COLLECTION COUNTER: ${counter}
DEPARTMENT: ${prescription.department}
TOTAL PAYABLE: ${payableStr}

PAYMENT OPTIONS:

Option A — Cash on Pickup:
  Pay by cash when collecting your packed medicine order at the hospital pharmacy.
  Amount: ${payableStr}
  Order Reference: ${prescriptionId}
  Counter: ${counter}
  Show this email or Prescription ID at the counter. Payment is confirmed by staff upon receipt.

Option B — Online UPI Payment:
${upiLink ? `  UPI Link: ${upiLink}` : "  Contact pharmacy for UPI payment details."}
  Pay the exact amount ${payableStr} and mention order reference ${prescriptionId}.

COLLECTION INSTRUCTIONS:
  1. Visit ${counter} at City Hospital Pharmacy (Ground Floor, OPD Wing)
  2. Present Prescription Reference: ${prescriptionId}
  3. Carry a valid photo ID for verification
  4. Have your payment ready (cash or show UPI confirmation)

HOSPITAL CONTACT:
  Pharmacy Helpdesk: +91 (0) 22 2555 0199 | pharmacy@mediflow.local
  Hours: 24/7 Emergency & Inpatient | 8:00 AM – 10:00 PM OPD

View order & payment status: ${orderPageUrl}

This is an automated message from MediFlow Hospital Pharmacy System. Do not reply.
  `.trim();

  // If real SMTP is configured, attempt real delivery
  if (isSmtpConfigured && transporter) {
    try {
      const info = await transporter.sendMail({
        from: EMAIL_FROM,
        to: recipient,
        subject,
        text: textContent,
        html: htmlContent
      });

      appendEmailLog({
        type: "ready_for_collection",
        prescriptionId,
        recipient,
        subject,
        status: "sent",
        messageId: info.messageId,
        mode: "smtp"
      });

      console.log(`[EMAIL SERVICE] ✓ Pickup email sent to relative (${recipient}) for ${prescriptionId}`);
      return { success: true, mode: "smtp", messageId: info.messageId, recipient };
    } catch (err) {
      console.error(`[EMAIL SERVICE] Failed to deliver pickup email via SMTP:`, err.message);
      appendEmailLog({
        type: "ready_for_collection",
        prescriptionId,
        recipient,
        subject,
        status: "failed",
        error: err.message,
        mode: "smtp"
      });
      return { success: false, mode: "smtp", error: err.message, recipient };
    }
  }

  // Safe Development Simulation Mode
  appendEmailLog({
    type: "ready_for_collection",
    prescriptionId,
    recipient,
    subject,
    status: "simulated_development",
    mode: "development_simulation",
    note: "SMTP not configured — pickup email simulated and logged."
  });

  console.log(`[EMAIL SERVICE - DEV MODE] 📧 [Simulated Pickup Email to: ${recipient}] ${subject}`);
  return { success: true, mode: "development_simulation", recipient, simulated: true };
}

function getEmailStatus() {
  return {
    smtpConfigured: isSmtpConfigured,
    smtpHost: SMTP_HOST || "(not set)",
    smtpPort: SMTP_PORT,
    secure: SMTP_SECURE,
    senderEmail: EMAIL_FROM,
    staffEmail: STAFF_NOTIFICATION_EMAIL,
    mode: isSmtpConfigured ? "production_smtp" : "development_simulation",
    totalLogs: getEmailLogs().length
  };
}

/**
 * 3. Diagnostics test email
 */
async function sendDiagnosticsEmail(testRecipient, serverUrl = "http://localhost:3000") {
  const subject = `[MEDIFLOW] Email Diagnostics Test — ${new Date().toLocaleString("en-IN")}`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><style>
      body { font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:#f2f6fa; margin:0; padding:20px; }
      .card { max-width:580px; margin:0 auto; background:#fff; border-radius:14px; border:1px solid #e1eaf2; overflow:hidden; box-shadow:0 8px 28px rgba(15,46,76,.08); }
      .header { background:#0f2e4c; color:#fff; padding:24px; }
      .header h1 { margin:0 0 6px; font-size:18px; }
      .header p { margin:0; opacity:.8; font-size:12px; }
      .content { padding:24px; }
      .row { display:flex; gap:12px; padding:10px 0; border-bottom:1px solid #eff4f8; font-size:12px; }
      .row:last-child { border-bottom:0; }
      .label { flex:0 0 130px; color:#5e7891; font-weight:600; }
      .value { color:#1e3a52; }
      .pass { background:#e8f7f1; color:#0a7048; padding:3px 9px; border-radius:20px; font-size:10px; font-weight:700; }
      .footer { padding:16px 24px; background:#f7fafc; font-size:11px; color:#7a93a8; text-align:center; }
    </style></head>
    <body>
      <div class="card">
        <div class="header">
          <h1>MEDIFLOW — Email Service Diagnostics</h1>
          <p>This is a test message from the MEDIFLOW email notification system.</p>
        </div>
        <div class="content">
          <p style="font-size:14px;color:#1e3a52;font-weight:600;">✅ Email delivery is working correctly.</p>
          <div class="row"><span class="label">Test sent at</span><span class="value">${new Date().toLocaleString("en-IN")}</span></div>
          <div class="row"><span class="label">From</span><span class="value">${escapeHtml(EMAIL_FROM)}</span></div>
          <div class="row"><span class="label">To (recipient)</span><span class="value">${escapeHtml(testRecipient)}</span></div>
          <div class="row"><span class="label">SMTP server</span><span class="value">${escapeHtml(SMTP_HOST)}:${SMTP_PORT}</span></div>
          <div class="row"><span class="label">TLS mode</span><span class="value">${SMTP_SECURE ? "SSL (port 465)" : "STARTTLS (port 587)"}</span></div>
          <div class="row"><span class="label">Status</span><span class="pass">DELIVERED</span></div>
        </div>
        <div class="footer">MEDIFLOW Hospital System · Email Diagnostics · ${new Date().toISOString()}</div>
      </div>
    </body>
    </html>
  `;

  const textContent = `[MEDIFLOW] Email Diagnostics Test\n\nIf you received this message, email delivery is working correctly.\nTime: ${new Date().toISOString()}\nServer: ${serverUrl}`;

  if (isSmtpConfigured && transporter) {
    try {
      const info = await transporter.sendMail({
        from: EMAIL_FROM,
        to: testRecipient,
        subject,
        text: textContent,
        html: htmlContent
      });
      appendEmailLog({
        type: "diagnostics",
        recipient: testRecipient,
        subject,
        status: "sent",
        messageId: info.messageId,
        mode: "smtp"
      });
      return { success: true, mode: "smtp", messageId: info.messageId, recipient: testRecipient };
    } catch (err) {
      appendEmailLog({
        type: "diagnostics",
        recipient: testRecipient,
        subject,
        status: "failed",
        error: err.message,
        mode: "smtp"
      });
      return { success: false, mode: "smtp", error: err.message, recipient: testRecipient };
    }
  }

  appendEmailLog({
    type: "diagnostics",
    recipient: testRecipient,
    subject,
    status: "simulated_development",
    mode: "development_simulation",
    note: "SMTP not configured — diagnostics test simulated"
  });
  console.log(`[EMAIL SERVICE - DEV MODE] 🔧 [Diagnostics Test to: ${testRecipient}] ${subject}`);
  return { success: true, mode: "development_simulation", recipient: testRecipient, simulated: true };
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

module.exports = {
  isSmtpConfigured,
  verifyConnection,
  sendNewPrescriptionEmail,
  sendReadyForCollectionEmail,
  sendDiagnosticsEmail,
  getEmailLogs,
  getEmailStatus,
  isValidEmail
};
