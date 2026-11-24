CREATE DATABASE IF NOT EXISTS aquavisao CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE aquavisao;

CREATE TABLE IF NOT EXISTS system_state (
  id TINYINT PRIMARY KEY DEFAULT 1,
  operation_mode ENUM('stopped','simulation','production') NOT NULL DEFAULT 'stopped',
  simulation_status ENUM('idle','running','paused') NOT NULL DEFAULT 'idle',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS reservoirs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  location VARCHAR(150) NOT NULL,
  capacity_l DECIMAL(10,2) NOT NULL DEFAULT 500,
  useful_height_cm DECIMAL(10,2) NOT NULL DEFAULT 58,
  full_offset_cm DECIMAL(10,2) NOT NULL DEFAULT 5,
  base_diameter_cm DECIMAL(10,2) NOT NULL DEFAULT 95,
  top_diameter_cm DECIMAL(10,2) NOT NULL DEFAULT 122,
  current_level_pct DECIMAL(6,2) NOT NULL DEFAULT 0,
  data_source ENUM('simulation','usb','wifi') NOT NULL DEFAULT 'simulation',
  communication_status ENUM('online','stale','offline') NOT NULL DEFAULT 'offline',
  last_seen_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS devices (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  device_uid VARCHAR(80) NOT NULL UNIQUE,
  reservoir_id BIGINT UNSIGNED NULL,
  transport ENUM('wifi','usb') NOT NULL DEFAULT 'wifi',
  firmware_version VARCHAR(32) NULL,
  ip_address VARCHAR(45) NULL,
  rssi SMALLINT NULL,
  status ENUM('online','stale','offline','provisioning') NOT NULL DEFAULT 'offline',
  last_seen_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_device_reservoir FOREIGN KEY (reservoir_id) REFERENCES reservoirs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS readings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reservoir_id BIGINT UNSIGNED NOT NULL,
  device_id BIGINT UNSIGNED NULL,
  level_pct DECIMAL(6,2) NOT NULL,
  distance_cm DECIMAL(10,2) NULL,
  volume_l DECIMAL(10,2) NULL,
  source ENUM('simulation','usb','wifi') NOT NULL,
  quality DECIMAL(5,2) NULL,
  measured_at DATETIME(3) NOT NULL,
  received_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_readings_reservoir_time (reservoir_id, measured_at DESC),
  CONSTRAINT fk_reading_reservoir FOREIGN KEY (reservoir_id) REFERENCES reservoirs(id) ON DELETE CASCADE,
  CONSTRAINT fk_reading_device FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reservoir_id BIGINT UNSIGNED NOT NULL,
  alert_type ENUM('low','overflow','offline','sensor','wifi') NOT NULL,
  severity ENUM('info','warning','critical','emergency') NOT NULL,
  message VARCHAR(255) NOT NULL,
  status ENUM('open','acknowledged','resolved') NOT NULL DEFAULT 'open',
  acknowledged_by VARCHAR(100) NULL,
  acknowledged_at DATETIME NULL,
  resolved_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_alert_reservoir FOREIGN KEY (reservoir_id) REFERENCES reservoirs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS camera_measurements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reservoir_id BIGINT UNSIGNED NOT NULL,
  measurement_type ENUM('external','internal','bottom','level','label') NOT NULL,
  value_cm DECIMAL(10,2) NULL,
  confidence DECIMAL(5,2) NOT NULL,
  reference_cm DECIMAL(10,2) NULL,
  roi_json JSON NOT NULL,
  status ENUM('draft','confirmed','rejected') NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_camera_reservoir FOREIGN KEY (reservoir_id) REFERENCES reservoirs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor VARCHAR(100) NOT NULL DEFAULT 'operador-local',
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(80) NULL,
  details JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system_state (id) VALUES (1) ON DUPLICATE KEY UPDATE id=id;
