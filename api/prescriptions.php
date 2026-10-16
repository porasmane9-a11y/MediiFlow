<?php
// ========================================================
// MEDIFLOW - Prescriptions API Endpoint (PHP + MySQL)
// ========================================================

require_once __DIR__ . '/db.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Helper to format DB row to frontend JSON schema
function formatPrescription($row) {
    return [
        'prescriptionId' => $row['prescription_id'],
        'doctor' => $row['doctor_name'],
        'patientName' => $row['patient_name'],
        'patientId' => $row['patient_id'],
        'ageGender' => $row['age_gender'],
        'relativeName' => $row['relative_name'],
        'mobile' => $row['relative_mobile'],
        'department' => $row['department'],
        'priority' => $row['priority'],
        'scheme' => (bool)$row['scheme'],
        'medicines' => json_decode($row['medicines'], true) ?: [],
        'availability' => $row['availability'] ? json_decode($row['availability'], true) : null,
        'total' => $row['total'] !== null ? (float)$row['total'] : null,
        'patientPayable' => $row['patient_payable'] !== null ? (float)$row['patient_payable'] : null,
        'claimAmount' => $row['claim_amount'] !== null ? (float)$row['claim_amount'] : null,
        'counter' => $row['counter'],
        'status' => $row['status'],
        'stockDeducted' => (bool)$row['stock_deducted'],
        'createdAt' => (int)$row['created_at'],
        'isDemo' => false
    ];
}

// ----------------------------------------------------
// 1. GET: Fetch Prescriptions
// ----------------------------------------------------
if ($method === 'GET') {
    $id = isset($_GET['id']) ? trim($_GET['id']) : (isset($_GET['prescriptionId']) ? trim($_GET['prescriptionId']) : null);
    $patient_id = isset($_GET['patient_id']) ? trim($_GET['patient_id']) : null;

    if ($id) {
        $stmt = $pdo->prepare("SELECT * FROM prescriptions WHERE prescription_id = ? LIMIT 1");
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if ($row) {
            echo json_encode(['prescription' => formatPrescription($row)]);
        } else {
            http_response_code(404);
            echo json_encode(['error' => 'Prescription not found']);
        }
        exit;
    }

    if ($patient_id) {
        $stmt = $pdo->prepare("SELECT * FROM prescriptions WHERE LOWER(patient_id) = LOWER(?) ORDER BY created_at DESC");
        $stmt->execute([$patient_id]);
        $rows = $stmt->fetchAll();
        $prescriptions = array_map('formatPrescription', $rows);
        echo json_encode(['prescriptions' => $prescriptions]);
        exit;
    }

    $stmt = $pdo->query("SELECT * FROM prescriptions ORDER BY created_at DESC");
    $rows = $stmt->fetchAll();
    $prescriptions = array_map('formatPrescription', $rows);
    echo json_encode(['prescriptions' => $prescriptions]);
    exit;
}

// ----------------------------------------------------
// 2. POST: Create New Prescription (Doctor -> Staff)
// ----------------------------------------------------
if ($method === 'POST') {
    $input = getJsonInput();

    $patientName = trim($input['patientName'] ?? '');
    $patientId = trim($input['patientId'] ?? '');
    $relativeName = trim($input['relativeName'] ?? '');
    $relativeMobile = trim($input['relativeMobile'] ?? ($input['mobile'] ?? ''));
    $department = trim($input['department'] ?? '');
    $doctorName = trim($input['doctor'] ?? ($input['doctorName'] ?? 'Dr. Kavita Rao'));
    $priority = trim($input['priority'] ?? 'REGULAR');
    $scheme = !empty($input['scheme']) ? 1 : 0;
    $medicines = $input['medicines'] ?? [];

    if (!$patientName || !$patientId || !$relativeName || !$department) {
        http_response_code(400);
        echo json_encode(['error' => 'Missing required patient fields']);
        exit;
    }

    // Prescription ID generation
    $prescriptionId = trim($input['prescriptionId'] ?? '');
    if (!$prescriptionId) {
        $prescriptionId = 'MF-2026-' . rand(1005, 9999);
    }

    $ageGender = trim($input['ageGender'] ?? ($input['patientAge'] ?? ''));
    $medicinesJson = json_encode($medicines);
    $availabilityJson = isset($input['availability']) ? json_encode($input['availability']) : null;
    $total = isset($input['total']) ? (float)$input['total'] : null;
    $patientPayable = isset($input['patientPayable']) ? (float)$input['patientPayable'] : null;
    $claimAmount = isset($input['claimAmount']) ? (float)$input['claimAmount'] : null;
    $counter = $input['counter'] ?? null;
    $status = $input['status'] ?? 'RECEIVED';
    $stockDeducted = !empty($input['stockDeducted']) ? 1 : 0;
    $createdAt = !empty($input['createdAt']) ? (int)$input['createdAt'] : (int)(microtime(true) * 1000);

    // Insert or update prescription in database
    $checkStmt = $pdo->prepare("SELECT id FROM prescriptions WHERE prescription_id = ?");
    $checkStmt->execute([$prescriptionId]);
    $existing = $checkStmt->fetch();

    if ($existing) {
        $sql = "UPDATE prescriptions SET
            doctor_name = ?, patient_name = ?, patient_id = ?, age_gender = ?,
            relative_name = ?, relative_mobile = ?, department = ?, priority = ?,
            scheme = ?, medicines = ?, availability = ?, total = ?,
            patient_payable = ?, claim_amount = ?, counter = ?, status = ?,
            stock_deducted = ? WHERE prescription_id = ?";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            $doctorName, $patientName, $patientId, $ageGender,
            $relativeName, $relativeMobile, $department, $priority,
            $scheme, $medicinesJson, $availabilityJson, $total,
            $patientPayable, $claimAmount, $counter, $status,
            $stockDeducted, $prescriptionId
        ]);
    } else {
        $sql = "INSERT INTO prescriptions (
            prescription_id, doctor_name, patient_name, patient_id, age_gender,
            relative_name, relative_mobile, department, priority, scheme,
            medicines, availability, total, patient_payable, claim_amount,
            counter, status, stock_deducted, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            $prescriptionId, $doctorName, $patientName, $patientId, $ageGender,
            $relativeName, $relativeMobile, $department, $priority, $scheme,
            $medicinesJson, $availabilityJson, $total, $patientPayable, $claimAmount,
            $counter, $status, $stockDeducted, $createdAt
        ]);
    }

    // 🔔 Feature 1: Automatically create notification for Medical Staff
    $notifUid = 'N-' . time() . '-' . substr(md5(uniqid()), 0, 4);
    $notifTitle = "🔔 New Prescription Received";
    $notifMessage = "Patient: {$patientName} | Doctor: {$doctorName} | Prescription ID: {$prescriptionId}";
    
    $notifStmt = $pdo->prepare("INSERT INTO notifications (notification_uid, recipient_role, prescription_id, title, message, is_read, created_at) VALUES (?, 'staff', ?, ?, ?, 0, ?)");
    $notifStmt->execute([$notifUid, $prescriptionId, $notifTitle, $notifMessage, $createdAt]);

    // Fetch and return fresh record
    $fetchStmt = $pdo->prepare("SELECT * FROM prescriptions WHERE prescription_id = ?");
    $fetchStmt->execute([$prescriptionId]);
    $created = $fetchStmt->fetch();

    http_response_code(201);
    echo json_encode([
        'message' => 'Prescription stored successfully in database',
        'prescription' => formatPrescription($created),
        'notification' => [
            'id' => $notifUid,
            'title' => $notifTitle,
            'message' => $notifMessage
        ]
    ]);
    exit;
}

// ----------------------------------------------------
// 3. PUT: Update Prescription Status (Staff -> Relative)
// ----------------------------------------------------
if ($method === 'PUT') {
    $input = getJsonInput();
    $id = isset($_GET['id']) ? trim($_GET['id']) : trim($input['prescriptionId'] ?? '');

    if (!$id) {
        // Try parsing from REQUEST_URI if formatted like /api/prescriptions/{id}
        $parts = explode('/', trim(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/'));
        $last = end($parts);
        if ($last && $last !== 'prescriptions.php' && $last !== 'prescriptions') {
            $id = urldecode($last);
        }
    }

    if (!$id) {
        http_response_code(400);
        echo json_encode(['error' => 'Prescription ID required for update']);
        exit;
    }

    $stmt = $pdo->prepare("SELECT * FROM prescriptions WHERE prescription_id = ?");
    $stmt->execute([$id]);
    $current = $stmt->fetch();
    if (!$current) {
        http_response_code(404);
        echo json_encode(['error' => 'Prescription not found']);
        exit;
    }

    $status = $input['status'] ?? $current['status'];
    $counter = $input['counter'] ?? $current['counter'];
    $total = isset($input['total']) ? (float)$input['total'] : $current['total'];
    $patientPayable = isset($input['patientPayable']) ? (float)$input['patientPayable'] : $current['patientPayable'];
    $claimAmount = isset($input['claimAmount']) ? (float)$input['claimAmount'] : $current['claimAmount'];
    $availability = isset($input['availability']) ? json_encode($input['availability']) : $current['availability'];
    $stockDeducted = isset($input['stockDeducted']) ? ($input['stockDeducted'] ? 1 : 0) : $current['stock_deducted'];

    // 🔔 Feature 2: When Medical Staff marks Medicine Packed / Ready
    if ($status === 'READY') {
        if (!$counter) {
            $counter = ($current['priority'] === 'HIGH') ? 'Emergency Counter' : 'Counter 1';
        }
        
        $notifUid = 'N-' . time() . '-' . substr(md5(uniqid()), 0, 4);
        $notifTitle = "🔔 Medicine Packed & Ready";
        $notifMsg = "Your patient's prescribed medicines have been packed and are ready. Prescription ID: {$id}. Please collect from {$counter}.";
        
        $notifStmt = $pdo->prepare("INSERT INTO notifications (notification_uid, recipient_role, prescription_id, title, message, is_read, created_at) VALUES (?, 'relative', ?, ?, ?, 0, ?)");
        $notifStmt->execute([$notifUid, $id, $notifTitle, $notifMsg, (int)(microtime(true) * 1000)]);

        // Trigger SMS / WhatsApp notification hook function
        sendSmsOrWhatsAppNotification($current['relative_mobile'], $notifMsg);
    }

    $updateSql = "UPDATE prescriptions SET
        status = ?, counter = ?, total = ?, patient_payable = ?, claim_amount = ?,
        availability = ?, stock_deducted = ? WHERE prescription_id = ?";
    $updateStmt = $pdo->prepare($updateSql);
    $updateStmt->execute([
        $status, $counter, $total, $patientPayable, $claimAmount,
        $availability, $stockDeducted, $id
    ]);

    $fetchStmt = $pdo->prepare("SELECT * FROM prescriptions WHERE prescription_id = ?");
    $fetchStmt->execute([$id]);
    $updated = $fetchStmt->fetch();

    echo json_encode([
        'message' => 'Prescription updated in database',
        'prescription' => formatPrescription($updated)
    ]);
    exit;
}

// ----------------------------------------------------
// 4. DELETE: Delete Prescription
// ----------------------------------------------------
if ($method === 'DELETE') {
    $id = isset($_GET['id']) ? trim($_GET['id']) : '';
    if (!$id) {
        $parts = explode('/', trim(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/'));
        $last = end($parts);
        if ($last && $last !== 'prescriptions.php' && $last !== 'prescriptions') {
            $id = urldecode($last);
        }
    }

    if (!$id) {
        http_response_code(400);
        echo json_encode(['error' => 'Prescription ID required']);
        exit;
    }

    $delStmt = $pdo->prepare("DELETE FROM prescriptions WHERE prescription_id = ?");
    $delStmt->execute([$id]);

    echo json_encode(['message' => 'Prescription deleted from database']);
    exit;
}
