<?php
// ========================================================
// MEDIFLOW - Notifications API Endpoint (PHP + MySQL)
// ========================================================

require_once __DIR__ . '/db.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

if ($method === 'GET') {
    $role = isset($_GET['role']) ? trim($_GET['role']) : null;
    if ($role) {
        $stmt = $pdo->prepare("SELECT * FROM notifications WHERE recipient_role = ? OR recipient_role = 'all' ORDER BY created_at DESC LIMIT 50");
        $stmt->execute([$role]);
    } else {
        $stmt = $pdo->query("SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50");
    }
    
    $rows = $stmt->fetchAll();
    $notifications = array_map(function($row) {
        return [
            'id' => $row['notification_uid'],
            'recipientRole' => $row['recipient_role'],
            'prescriptionId' => $row['prescription_id'],
            'title' => $row['title'],
            'message' => $row['message'],
            'read' => (bool)$row['is_read'],
            'createdAt' => (int)$row['created_at']
        ];
    }, $rows);

    echo json_encode(['notifications' => $notifications]);
    exit;
}

if ($method === 'POST') {
    $input = getJsonInput();
    $action = $input['action'] ?? 'mark_read';

    if ($action === 'mark_all_read') {
        $pdo->exec("UPDATE notifications SET is_read = 1");
        echo json_encode(['message' => 'All notifications marked as read']);
        exit;
    }

    $id = $input['id'] ?? null;
    if ($id) {
        $stmt = $pdo->prepare("UPDATE notifications SET is_read = 1 WHERE notification_uid = ?");
        $stmt->execute([$id]);
        echo json_encode(['message' => 'Notification marked as read']);
        exit;
    }

    echo json_encode(['message' => 'No action taken']);
    exit;
}
