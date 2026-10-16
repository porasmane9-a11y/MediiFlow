-- ========================================================
-- MEDIFLOW Smart Hospital Queue & Prescription Database
-- MySQL Database Schema
-- ========================================================

CREATE DATABASE IF NOT EXISTS `mediflow` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `mediflow`;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(100) UNIQUE NOT NULL,
  `phone` VARCHAR(20) NOT NULL,
  `password` VARCHAR(255) NOT NULL,
  `role` ENUM('doctor', 'staff', 'relative', 'admin') NOT NULL DEFAULT 'staff',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Prescriptions Table
CREATE TABLE IF NOT EXISTS `prescriptions` (
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
  `status` ENUM('RECEIVED', 'CHECKING', 'CONFIRMED', 'BILLED', 'PREPARING', 'READY', 'COLLECTED') DEFAULT 'RECEIVED',
  `stock_deducted` TINYINT(1) DEFAULT 0,
  `created_at` BIGINT NOT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_patient_id` (`patient_id`),
  INDEX `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Notifications Table
CREATE TABLE IF NOT EXISTS `notifications` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `notification_uid` VARCHAR(60) UNIQUE NOT NULL,
  `recipient_role` VARCHAR(50) NOT NULL DEFAULT 'staff',
  `prescription_id` VARCHAR(50) DEFAULT NULL,
  `title` VARCHAR(150) NOT NULL,
  `message` TEXT NOT NULL,
  `is_read` TINYINT(1) DEFAULT 0,
  `created_at` BIGINT NOT NULL,
  INDEX `idx_recipient_role` (`recipient_role`),
  INDEX `idx_presc` (`prescription_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed default demo user accounts (passwords hashed with standard bcrypt)
-- 'password123' -> $2y$10$eA8mF4wFk4Nq/h1x7fA...
INSERT IGNORE INTO `users` (`id`, `name`, `email`, `phone`, `password`, `role`) VALUES
(1, 'Dr. Kavita Rao', 'doctor@mediflow.local', '9820012345', '$2y$10$Qj2z5v9m6uYvT4p5wK1y3eWq7z9m6uYvT4p5wK1y3eWq7z9m6uYvT', 'doctor'),
(2, 'Anita Mehta', 'staff@mediflow.local', '9820054321', '$2y$10$Qj2z5v9m6uYvT4p5wK1y3eWq7z9m6uYvT4p5wK1y3eWq7z9m6uYvT', 'staff'),
(3, 'Patient Relative', 'relative@mediflow.local', '9185476952', '$2y$10$Qj2z5v9m6uYvT4p5wK1y3eWq7z9m6uYvT4p5wK1y3eWq7z9m6uYvT', 'relative');
