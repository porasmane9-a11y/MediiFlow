const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, "database.json");

// Ensure database file exists with clean schema (no default dummy patients)
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
  // Enable CORS for all requests (supports Live Server access)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

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

  // --- API ROUTES ---

  // Health / Status
  if (pathname === "/api/status" && req.method === "GET") {
    const db = readDB();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "connected",
      database: "mediflow_json_db",
      totalPrescriptions: db.prescriptions.length,
      updatedAt: db.updatedAt
    }));
    return;
  }

  // GET All Prescriptions
  if (pathname === "/api/prescriptions" && req.method === "GET") {
    const db = readDB();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ prescriptions: db.prescriptions }));
    return;
  }

  // POST Add New Prescription (from Doctor Workspace)
  if (pathname === "/api/prescriptions" && req.method === "POST") {
    getRequestBody((err, body) => {
      if (err || !body || !body.prescriptionId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid prescription payload" }));
        return;
      }
      const db = readDB();
      const existingIndex = db.prescriptions.findIndex((p) => p.prescriptionId === body.prescriptionId);
      if (existingIndex >= 0) {
        db.prescriptions[existingIndex] = { ...db.prescriptions[existingIndex], ...body };
      } else {
        db.prescriptions.push(body);
      }
      writeDB(db);
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Prescription stored successfully in database", prescription: body }));
    });
    return;
  }

  // PUT Update Prescription (Status, Billing, Counter, etc.)
  if (pathname.startsWith("/api/prescriptions/") && req.method === "PUT") {
    const id = decodeURIComponent(pathname.replace("/api/prescriptions/", ""));
    getRequestBody((err, body) => {
      if (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }
      const db = readDB();
      const index = db.prescriptions.findIndex((p) => p.prescriptionId === id);
      if (index === -1) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Prescription not found" }));
        return;
      }
      db.prescriptions[index] = { ...db.prescriptions[index], ...body };
      writeDB(db);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Prescription updated in database", prescription: db.prescriptions[index] }));
    });
    return;
  }

  // DELETE Remove Prescription
  if (pathname.startsWith("/api/prescriptions/") && req.method === "DELETE") {
    const id = decodeURIComponent(pathname.replace("/api/prescriptions/", ""));
    const db = readDB();
    const before = db.prescriptions.length;
    db.prescriptions = db.prescriptions.filter((p) => p.prescriptionId !== id);
    if (db.prescriptions.length === before) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Prescription not found" }));
      return;
    }
    writeDB(db);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Prescription deleted from database" }));
    return;
  }

  // POST Clear / Reset Database
  if (pathname === "/api/reset" && req.method === "POST") {
    const db = {
      version: 3,
      updatedAt: new Date().toISOString(),
      prescriptions: [],
      notifications: []
    };
    writeDB(db);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Database reset successfully. All default & demo data cleared." }));
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
      // Try adding .html
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
