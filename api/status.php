<?php
// ========================================================
// MEDIFLOW - Health and Database Status Endpoint
// ========================================================

require_once __DIR__ . '/db.php';

try {
    $countStmt = $pdo->query("SELECT COUNT(*) AS total FROM prescriptions");
    $totalPrescriptions = (int)($countStmt->fetchColumn() ?: 0);

    $notifStmt = $pdo->query("SELECT COUNT(*) AS total FROM notifications WHERE is_read = 0");
    $unreadNotifications = (int)($notifStmt->fetchColumn() ?: 0);

    echo json_encode([
        'status' => 'connected',
        'backend' => 'PHP',
        'database' => $db_engine === 'mysql' ? 'MySQL (mediflow)' : 'SQLite (mediflow_db.sqlite)',
        'totalPrescriptions' => $totalPrescriptions,
        'unreadNotifications' => $unreadNotifications,
        'serverTime' => date('c')
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'status' => 'error',
        'message' => $e->getMessage()
    ]);
}
