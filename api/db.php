<?php
// ========================================================
// MEDIFLOW - Database Connection Handler (PDO MySQL / SQLite Fallback)
// ========================================================

header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type, Authorization");
header("Content-Type: application/json; charset=UTF-8");

$request_method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($request_method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$db_host = '127.0.0.1';
$db_port = 3306;
$db_user = 'root';
$db_pass = '';
$db_name = 'mediflow';

$pdo = null;
$db_engine = 'mysql';

try {
    // 1. Try connecting to MySQL server directly
    $dsn_no_db = "mysql:host={$db_host};port={$db_port};charset=utf8mb4";
    $raw_pdo = new PDO($dsn_no_db, $db_user, $db_pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_TIMEOUT => 2
    ]);

    // Ensure database exists
    $raw_pdo->exec("CREATE DATABASE IF NOT EXISTS `{$db_name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");

    // Connect to mediflow database
    $dsn = "mysql:host={$db_host};port={$db_port};dbname={$db_name};charset=utf8mb4";
    $pdo = new PDO($dsn, $db_user, $db_pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
    ]);

    // Ensure required tables exist
    ensureTablesExist($pdo, 'mysql');
} catch (Exception $e) {
    // Fallback: If MySQL is not running yet in XAMPP, fallback to SQLite file so website never breaks
    $db_engine = 'sqlite';
    $sqlite_file = __DIR__ . '/../mediflow_db.sqlite';
    try {
        $pdo = new PDO("sqlite:" . $sqlite_file);
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        ensureTablesExist($pdo, 'sqlite');
    } catch (Exception $sqliteErr) {
        http_response_code(500);
        echo json_encode([
            "error" => "Database connection error",
            "mysql_error" => $e->getMessage(),
            "sqlite_error" => $sqliteErr->getMessage()
        ]);
        exit;
    }
}

function ensureTablesExist($pdo, $engine = 'mysql') {
    if ($engine === 'mysql') {
        $pdo->exec("CREATE TABLE IF NOT EXISTS `prescriptions` (
            `id` INT AUTO_INCREMENT PRIMARY KEY,
            `prescription_id` VARCHAR(50) UNIQUE NOT NULL,
            `doctor_name` VARCHAR(100) NOT NULL,
            `patient_name` VARCHAR(100) NOT NULL,
            `patient_id` VARCHAR(50) NOT NULL,
            `age_gender` VARCHAR(50) DEFAULT NULL,
            `relative_name` VARCHAR(100) NOT NULL,
            `relative_mobile` VARCHAR(20) NOT NULL,
            `department` VARCHAR(100) NOT NULL,
            `priority` VARCHAR(20) DEFAULT 'REGULAR',
            `scheme` TINYINT(1) DEFAULT 0,
            `medicines` LONGTEXT NOT NULL,
            `availability` LONGTEXT DEFAULT NULL,
            `total` DECIMAL(10,2) DEFAULT 0.00,
            `patient_payable` DECIMAL(10,2) DEFAULT 0.00,
            `claim_amount` DECIMAL(10,2) DEFAULT 0.00,
            `counter` VARCHAR(50) DEFAULT NULL,
            `status` VARCHAR(30) DEFAULT 'RECEIVED',
            `stock_deducted` TINYINT(1) DEFAULT 0,
            `created_at` BIGINT NOT NULL,
            `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX `idx_patient_id` (`patient_id`),
            INDEX `idx_status` (`status`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

        $pdo->exec("CREATE TABLE IF NOT EXISTS `notifications` (
            `id` INT AUTO_INCREMENT PRIMARY KEY,
            `notification_uid` VARCHAR(60) UNIQUE NOT NULL,
            `recipient_role` VARCHAR(50) NOT NULL DEFAULT 'staff',
            `prescription_id` VARCHAR(50) DEFAULT NULL,
            `title` VARCHAR(150) NOT NULL,
            `message` TEXT NOT NULL,
            `is_read` TINYINT(1) DEFAULT 0,
            `created_at` BIGINT NOT NULL,
            INDEX `idx_recipient_role` (`recipient_role`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");

        $pdo->exec("CREATE TABLE IF NOT EXISTS `users` (
            `id` INT AUTO_INCREMENT PRIMARY KEY,
            `name` VARCHAR(100) NOT NULL,
            `email` VARCHAR(100) UNIQUE NOT NULL,
            `phone` VARCHAR(20) NOT NULL,
            `password` VARCHAR(255) NOT NULL,
            `role` ENUM('doctor', 'staff', 'relative', 'admin') NOT NULL DEFAULT 'staff',
            `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    } else {
        // SQLite syntax
        $pdo->exec("CREATE TABLE IF NOT EXISTS `prescriptions` (
            `id` INTEGER PRIMARY KEY AUTOINCREMENT,
            `prescription_id` TEXT UNIQUE NOT NULL,
            `doctor_name` TEXT NOT NULL,
            `patient_name` TEXT NOT NULL,
            `patient_id` TEXT NOT NULL,
            `age_gender` TEXT,
            `relative_name` TEXT NOT NULL,
            `relative_mobile` TEXT NOT NULL,
            `department` TEXT NOT NULL,
            `priority` TEXT DEFAULT 'REGULAR',
            `scheme` INTEGER DEFAULT 0,
            `medicines` TEXT NOT NULL,
            `availability` TEXT,
            `total` REAL DEFAULT 0,
            `patient_payable` REAL DEFAULT 0,
            `claim_amount` REAL DEFAULT 0,
            `counter` TEXT,
            `status` TEXT DEFAULT 'RECEIVED',
            `stock_deducted` INTEGER DEFAULT 0,
            `created_at` INTEGER NOT NULL,
            `updated_at` TEXT DEFAULT CURRENT_TIMESTAMP
        )");

        $pdo->exec("CREATE TABLE IF NOT EXISTS `notifications` (
            `id` INTEGER PRIMARY KEY AUTOINCREMENT,
            `notification_uid` TEXT UNIQUE NOT NULL,
            `recipient_role` TEXT NOT NULL DEFAULT 'staff',
            `prescription_id` TEXT,
            `title` TEXT NOT NULL,
            `message` TEXT NOT NULL,
            `is_read` INTEGER DEFAULT 0,
            `created_at` INTEGER NOT NULL
        )");
    }
}

// Clean helper to decode request JSON body
function getJsonInput() {
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

// Ready hook function for external SMS / WhatsApp API integration (e.g. Twilio, Gupshup, Fast2SMS)
function sendSmsOrWhatsAppNotification($phone, $message) {
    // Clean, structured hook ready for integration
    // In demo / internal mode, it logs the event safely without failing
    $log_entry = date('Y-m-d H:i:s') . " | Phone: {$phone} | Message: {$message}\n";
    @file_put_contents(__DIR__ . '/notifications_sms_log.txt', $log_entry, FILE_APPEND);
    return true;
}
