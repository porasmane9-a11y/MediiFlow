<?php
// ========================================================
// MEDIFLOW - Database Reset Endpoint (PHP + MySQL)
// ========================================================

require_once __DIR__ . '/db.php';

try {
    if ($db_engine === 'mysql') {
        $pdo->exec("TRUNCATE TABLE prescriptions");
        $pdo->exec("TRUNCATE TABLE notifications");
    } else {
        $pdo->exec("DELETE FROM prescriptions");
        $pdo->exec("DELETE FROM notifications");
    }

    echo json_encode([
        'status' => 'success',
        'message' => 'Database successfully reset. All default and test records cleared.'
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Failed to reset database: ' . $e->getMessage()]);
}
