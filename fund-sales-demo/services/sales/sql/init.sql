CREATE DATABASE IF NOT EXISTS sales CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE sales;

CREATE TABLE IF NOT EXISTS simulation_state (
  id INT PRIMARY KEY, scenario_id VARCHAR(32) NOT NULL, business_date CHAR(8) NOT NULL,
  previous_date CHAR(8), baseline_json JSON, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS customers (
  id VARCHAR(36) PRIMARY KEY, name VARCHAR(200) NOT NULL, certificate_no VARCHAR(40) NOT NULL,
  mobile VARCHAR(40), email VARCHAR(40), address VARCHAR(300), birthday CHAR(8), sex CHAR(1),
  cert_valid_date CHAR(8), nationality CHAR(3) DEFAULT '156', vocation_code VARCHAR(5) DEFAULT '99999',
  annual_income DECIMAL(16,2) DEFAULT 100000, risk_level CHAR(1) DEFAULT '3', region_code CHAR(4) DEFAULT '4401',
  bank_name VARCHAR(200), bank_no VARCHAR(40), bank_code VARCHAR(20) DEFAULT '102',
  transaction_account_id CHAR(17), ta_account_id CHAR(12), open_app_no VARCHAR(24), open_status VARCHAR(24) DEFAULT 'NOT_OPENED',
  account_status VARCHAR(16) DEFAULT 'NOT_OPENED',
  open_return_code CHAR(4), open_error VARCHAR(200), balance DECIMAL(16,2) DEFAULT 100000,
  frozen_balance DECIMAL(16,2) DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_customer_cert (certificate_no)
);
CREATE TABLE IF NOT EXISTS funds (
  fund_code CHAR(6) PRIMARY KEY, fund_name VARCHAR(200) NOT NULL, fund_status CHAR(1), nav DECIMAL(16,8),
  nav_date CHAR(8), accumulated_nav DECIMAL(16,8), min_first DECIMAL(16,2), min_additional DECIMAL(16,2),
  max_purchase DECIMAL(16,2), daily_max DECIMAL(16,2), fund_type CHAR(2), fund_type_name VARCHAR(30),
  manager_name VARCHAR(100), total_volume DECIMAL(16,2), fund_size DECIMAL(16,2), updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(36) PRIMARY KEY, customer_id VARCHAR(36) NOT NULL, app_no VARCHAR(24) NOT NULL,
  fund_code CHAR(6) NOT NULL, amount DECIMAL(16,2) NOT NULL, status VARCHAR(24) NOT NULL,
  return_code CHAR(4), error_detail VARCHAR(200), confirmed_amount DECIMAL(16,2), confirmed_volume DECIMAL(16,2),
  fee DECIMAL(16,2), nav DECIMAL(16,8), ta_serial_no VARCHAR(20), business_date CHAR(8) NOT NULL,
  business_code CHAR(3) DEFAULT '022', application_vol DECIMAL(16,2) DEFAULT 0,
  transaction_account_id CHAR(17), payload JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uk_order_app (app_no)
);
CREATE TABLE IF NOT EXISTS account_applications (
  id VARCHAR(36) PRIMARY KEY, customer_id VARCHAR(36) NOT NULL, app_no VARCHAR(24) NOT NULL,
  business_code CHAR(3) NOT NULL, status VARCHAR(24) NOT NULL, business_date CHAR(8) NOT NULL,
  transaction_account_id CHAR(17), payload JSON, return_code CHAR(4), error_detail VARCHAR(200), ta_serial_no VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uk_account_application_app (app_no),
  KEY idx_account_application_customer (customer_id, status)
);
CREATE TABLE IF NOT EXISTS transaction_accounts (
  id VARCHAR(36) PRIMARY KEY, customer_id VARCHAR(36) NOT NULL, transaction_account_id CHAR(17) NOT NULL,
  status VARCHAR(16) DEFAULT 'ACTIVE', card_status VARCHAR(16) DEFAULT 'NORMAL', is_primary TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uk_sales_transaction_account (transaction_account_id),
  KEY idx_sales_transaction_customer (customer_id, status)
);
CREATE TABLE IF NOT EXISTS sales_distributors (
  distributor_code VARCHAR(9) PRIMARY KEY, distributor_name VARCHAR(100) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ENABLED', is_local TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS custody_transfers (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, app_no VARCHAR(24) NOT NULL, customer_id VARCHAR(36) NOT NULL,
  fund_code CHAR(6) NOT NULL, volume DECIMAL(16,2) NOT NULL,
  source_distributor_code VARCHAR(9) NOT NULL, source_transaction_account_id CHAR(17) NOT NULL,
  target_distributor_code VARCHAR(9) NOT NULL, target_transaction_account_id CHAR(17) NOT NULL,
  status VARCHAR(24) NOT NULL, ta_serial_no VARCHAR(20), confirmation_date CHAR(8),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uk_custody_transfer_app (app_no)
);
CREATE TABLE IF NOT EXISTS holdings (
  customer_id VARCHAR(36) NOT NULL, fund_code CHAR(6) NOT NULL, volume DECIMAL(16,2) DEFAULT 0,
  frozen_volume DECIMAL(16,2) DEFAULT 0, dividend_method CHAR(1) DEFAULT '1',
  ta_volume DECIMAL(16,2), recon_status VARCHAR(24), recon_date CHAR(8), PRIMARY KEY(customer_id, fund_code)
);
CREATE TABLE IF NOT EXISTS batches (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, scenario_id VARCHAR(32), batch_id VARCHAR(16), direction VARCHAR(24),
  file_type CHAR(2), business_date CHAR(8), relative_path VARCHAR(300), status VARCHAR(24),
  record_count INT, error_detail VARCHAR(500), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_batch (scenario_id, direction, relative_path, file_type)
);
CREATE TABLE IF NOT EXISTS batch_records (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, batch_db_id BIGINT NOT NULL, file_type CHAR(2) NOT NULL,
  business_type VARCHAR(16) NOT NULL, business_id VARCHAR(36) NOT NULL, app_no VARCHAR(24),
  record_index INT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_batch_record (batch_db_id, business_type, business_id),
  KEY idx_business_record (business_type, business_id, file_type)
);
CREATE TABLE IF NOT EXISTS reconciliations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, customer_id VARCHAR(36), fund_code CHAR(6), sales_volume DECIMAL(16,2),
  ta_volume DECIMAL(16,2), difference DECIMAL(16,2), status VARCHAR(24), business_date CHAR(8),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS automation_runs (
  id VARCHAR(36) PRIMARY KEY, scenario_id VARCHAR(32) NOT NULL, business_date CHAR(8) NOT NULL,
  status VARCHAR(16) NOT NULL, steps_json JSON NOT NULL, result_json JSON, error_detail VARCHAR(500),
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, finished_at TIMESTAMP NULL,
  KEY idx_automation_runs (scenario_id, started_at)
);

INSERT INTO simulation_state(id, scenario_id, business_date) VALUES (1, 'RUN001', '20260916')
ON DUPLICATE KEY UPDATE id=id;
INSERT INTO sales_distributors(distributor_code,distributor_name,status,is_local) VALUES
  ('305','蚂蚁基金','ENABLED',1),
  ('306','天天基金','ENABLED',0)
ON DUPLICATE KEY UPDATE distributor_name=VALUES(distributor_name),status=VALUES(status),is_local=VALUES(is_local);
