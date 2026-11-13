-- DEVELOPMENT DATABASE ONLY; creates/drops tables. DO NOT run on live database.
CREATE DATABASE IF NOT EXISTS e_gabay CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE e_gabay;

SET FOREIGN_KEY_CHECKS=0;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS user_notification_reads;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS announcements;
DROP TABLE IF EXISTS application_documents;
DROP TABLE IF EXISTS pwd_id_application_details;
DROP TABLE IF EXISTS assistance_request_details;
DROP TABLE IF EXISTS request_status_history;
DROP TABLE IF EXISTS service_requests;
DROP TABLE IF EXISTS caregiver_links;
DROP TABLE IF EXISTS pwd_profiles;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS municipalities;
SET FOREIGN_KEY_CHECKS=1;

CREATE TABLE municipalities (
  municipality_id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  municipality_name VARCHAR(60) NOT NULL UNIQUE,
  province VARCHAR(60) NOT NULL DEFAULT 'Marinduque',
  is_active TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB;
INSERT INTO municipalities (municipality_name) VALUES
('Boac'),('Mogpog'),('Gasan'),('Buenavista'),('Santa Cruz'),('Torrijos');

CREATE TABLE users (
  user_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(150) NOT NULL,
  username VARCHAR(80) NULL UNIQUE,
  email VARCHAR(150) NOT NULL UNIQUE,
  contact_number VARCHAR(30) NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('pwd','caregiver','staff','admin') NOT NULL,
  account_status ENUM('pending','active','inactive','blocked') NOT NULL DEFAULT 'active',
  last_login_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_role (role), INDEX idx_users_status (account_status)
) ENGINE=InnoDB;

CREATE TABLE pwd_profiles (
  pwd_profile_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL UNIQUE,
  pwd_id_number VARCHAR(80) NULL UNIQUE,
  municipality_id TINYINT UNSIGNED NULL,
  barangay VARCHAR(120) NULL,
  address_line VARCHAR(255) NULL,
  birth_date DATE NULL,
  sex VARCHAR(30) NULL,
  disability_type VARCHAR(150) NULL,
  qr_token VARCHAR(120) NULL UNIQUE,
  id_valid_from DATE NULL,
  id_valid_until DATE NULL,
  profile_picture VARCHAR(60) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (municipality_id) REFERENCES municipalities(municipality_id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE caregiver_links (
  caregiver_link_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  caregiver_user_id BIGINT UNSIGNED NOT NULL,
  pwd_user_id BIGINT UNSIGNED NULL,
  patient_name VARCHAR(150) NOT NULL,
  relationship_to_pwd VARCHAR(100) NULL,
  authorization_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (caregiver_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (pwd_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_caregiver_user (caregiver_user_id)
) ENGINE=InnoDB;

CREATE TABLE service_requests (
  request_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference_code VARCHAR(100) NOT NULL UNIQUE,
  request_category ENUM('assistance','pwd_id') NOT NULL,
  request_type VARCHAR(120) NOT NULL,
  applicant_name VARCHAR(150) NOT NULL,
  applicant_user_id BIGINT UNSIGNED NULL,
  submitted_by_user_id BIGINT UNSIGNED NULL,
  municipality_id TINYINT UNSIGNED NULL,
  barangay VARCHAR(120) NULL,
  location_text VARCHAR(255) NULL,
  status ENUM('Received','Under review','Update available','Approved','Rejected','Closed') NOT NULL DEFAULT 'Received',
  status_explanation VARCHAR(500) NULL,
  consent_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  closed_at DATETIME NULL,
  FOREIGN KEY (applicant_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  FOREIGN KEY (submitted_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  FOREIGN KEY (municipality_id) REFERENCES municipalities(municipality_id) ON DELETE SET NULL,
  INDEX idx_request_reference (reference_code), INDEX idx_request_status (status),
  INDEX idx_request_category (request_category), INDEX idx_request_submitted_at (submitted_at)
) ENGINE=InnoDB;

CREATE TABLE assistance_request_details (
  request_id BIGINT UNSIGNED PRIMARY KEY,
  assistance_type ENUM('Medicine support','Food assistance','Transportation','Other support') NOT NULL,
  details TEXT NOT NULL,
  delivery_required TINYINT(1) NOT NULL DEFAULT 0,
  delivery_address VARCHAR(255) NULL,
  delivery_schedule DATETIME NULL,
  delivery_status ENUM('Not applicable','Pending','Preparing','Out for delivery','Delivered','Cancelled') NOT NULL DEFAULT 'Not applicable',
  FOREIGN KEY (request_id) REFERENCES service_requests(request_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE pwd_id_application_details (
  request_id BIGINT UNSIGNED PRIMARY KEY,
  application_type ENUM('new','renewal','replacement') NOT NULL,
  old_pwd_id_lost TINYINT(1) NOT NULL DEFAULT 0,
  existing_pwd_id_number VARCHAR(80) NULL,
  review_notes TEXT NULL,
  verified_by_user_id BIGINT UNSIGNED NULL,
  verified_at DATETIME NULL,
  FOREIGN KEY (request_id) REFERENCES service_requests(request_id) ON DELETE CASCADE,
  FOREIGN KEY (verified_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE application_documents (
  document_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT UNSIGNED NOT NULL,
  document_type ENUM('application_form','medical_certificate','barangay_certificate','valid_id','birth_or_marriage_certificate','id_photo','whole_body_photo','old_pwd_id','affidavit_of_loss','assistance_pwd_id','assistance_disability_photo','assistance_medical_certificate') NOT NULL,
  original_file_name VARCHAR(255) NOT NULL,
  stored_file_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size_bytes BIGINT UNSIGNED NULL,
  verification_status ENUM('Pending','Accepted','Needs resubmission') NOT NULL DEFAULT 'Pending',
  verification_notes VARCHAR(500) NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES service_requests(request_id) ON DELETE CASCADE,
  INDEX idx_document_request (request_id), INDEX idx_document_type (document_type)
) ENGINE=InnoDB;

CREATE TABLE request_status_history (
  history_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT UNSIGNED NOT NULL,
  old_status VARCHAR(40) NULL,
  new_status VARCHAR(40) NOT NULL,
  note VARCHAR(500) NULL,
  changed_by_user_id BIGINT UNSIGNED NULL,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES service_requests(request_id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_history_request (request_id, changed_at)
) ENGINE=InnoDB;

CREATE TABLE announcements (
  announcement_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id VARCHAR(100) NOT NULL UNIQUE,
  title VARCHAR(100) NOT NULL,
  announcement_date DATE NOT NULL,
  location VARCHAR(150) NOT NULL,
  category ENUM('programs','assistance','general') NOT NULL,
  details VARCHAR(600) NOT NULL,
  published_by_user_id BIGINT UNSIGNED NULL,
  is_published TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (published_by_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_announcement_date (announcement_date), INDEX idx_announcement_category (category)
) ENGINE=InnoDB;

CREATE TABLE notifications (
  notification_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(180) NOT NULL,
  message VARCHAR(600) NULL,
  notification_type ENUM('request','announcement','delivery','system') NOT NULL DEFAULT 'system',
  recipient_user_id BIGINT UNSIGNED NULL,
  recipient_role ENUM('pwd','caregiver','staff','admin') NULL,
  related_request_id BIGINT UNSIGNED NULL,
  related_announcement_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NULL,
  FOREIGN KEY (recipient_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (related_request_id) REFERENCES service_requests(request_id) ON DELETE CASCADE,
  FOREIGN KEY (related_announcement_id) REFERENCES announcements(announcement_id) ON DELETE CASCADE,
  INDEX idx_notification_user (recipient_user_id), INDEX idx_notification_role (recipient_role)
) ENGINE=InnoDB;

CREATE TABLE user_notification_reads (
  notification_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  read_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (notification_id,user_id),
  FOREIGN KEY (notification_id) REFERENCES notifications(notification_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE audit_logs (
  audit_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id VARCHAR(100) NULL,
  details JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_audit_entity (entity_type,entity_id)
) ENGINE=InnoDB;

CREATE OR REPLACE VIEW v_request_dashboard AS
SELECT sr.request_id,sr.reference_code,sr.request_category,sr.request_type,sr.applicant_name,
       m.municipality_name AS municipality,sr.barangay,sr.location_text,sr.status,
       sr.status_explanation,sr.submitted_at,sr.updated_at
FROM service_requests sr LEFT JOIN municipalities m ON m.municipality_id=sr.municipality_id;

-- No administrator credentials are seeded. Provision securely after deployment.

INSERT INTO announcements (public_id,title,announcement_date,location,category,details) VALUES
('notice-free-supplies','Free basic supplies distribution','2026-11-10','Boac Municipal Covered Court','assistance','Free hygiene kits and basic household supplies for PWD residents, while supplies last.'),
('notice-accessible-activities','Inclusive community day','2026-11-18','Mogpog Municipal Gymnasium','programs','An accessible day featuring information booths, recreation, and service referrals for PWD residents and families.'),
('notice-caregiver-support','Caregiver information session','2026-11-25','Gasan Municipal Hall','general','A short session on caregiving resources, available referrals, and preparing for appointments.');
