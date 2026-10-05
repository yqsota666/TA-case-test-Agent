-- Workspace customer data can be maintained before any chat exists.
-- TA identities, applications and confirmed assets remain owned by a chat/run.
CREATE TABLE IF NOT EXISTS catalog_customers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspace_id BIGINT UNSIGNED NOT NULL,
  investor_name VARCHAR(200) NOT NULL,
  investor_type CHAR(1) CHARACTER SET ascii NOT NULL DEFAULT '1',
  certificate_type VARCHAR(3) CHARACTER SET ascii NOT NULL DEFAULT '0',
  certificate_no VARCHAR(40) CHARACTER SET ascii NOT NULL,
  branch_code VARCHAR(9) CHARACTER SET ascii NOT NULL,
  simulated_balance DECIMAL(16,2) NOT NULL DEFAULT 0,
  profile_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_catalog_customer_public (public_id),
  UNIQUE KEY uq_catalog_customer_scope (workspace_id,id),
  KEY ix_catalog_customer_list (workspace_id,id),
  CONSTRAINT fk_catalog_customer_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT ck_catalog_customer_type CHECK (investor_type IN ('0','1')),
  CONSTRAINT ck_catalog_customer_balance CHECK (simulated_balance>=0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS catalog_funds (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL,
  fund_code VARCHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  share_class CHAR(1) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  fund_name VARCHAR(200) NOT NULL,
  nav DECIMAL(16,8) NULL,
  UNIQUE KEY uq_catalog_fund_scope (workspace_id,id),
  UNIQUE KEY uq_catalog_fund_code (workspace_id,fund_code,share_class),
  CONSTRAINT fk_catalog_fund_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
  CONSTRAINT ck_catalog_fund_nav CHECK (nav IS NULL OR nav>=0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS catalog_positions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL, customer_id BIGINT UNSIGNED NOT NULL, fund_id BIGINT UNSIGNED NOT NULL,
  total_volume DECIMAL(16,2) NOT NULL,
  available_volume DECIMAL(16,2) NOT NULL,
  frozen_volume DECIMAL(16,2) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_catalog_position (workspace_id,customer_id,fund_id),
  KEY ix_catalog_position_fund (workspace_id,fund_id),
  CONSTRAINT fk_catalog_position_customer FOREIGN KEY (workspace_id,customer_id) REFERENCES catalog_customers(workspace_id,id),
  CONSTRAINT fk_catalog_position_fund FOREIGN KEY (workspace_id,fund_id) REFERENCES catalog_funds(workspace_id,id),
  CONSTRAINT ck_catalog_position_volume CHECK (total_volume>=0 AND available_volume>=0 AND frozen_volume>=0 AND available_volume+frozen_volume<=total_volume)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS catalog_run_customers (
  workspace_id BIGINT UNSIGNED NOT NULL,chat_id BIGINT UNSIGNED NOT NULL,run_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL,source_customer_id BIGINT UNSIGNED NOT NULL,
  snapshot_json JSON NOT NULL,
  PRIMARY KEY (workspace_id,chat_id,run_id,source_customer_id),
  UNIQUE KEY uq_catalog_run_customer (workspace_id,chat_id,run_id,customer_id),
  KEY ix_catalog_run_source (workspace_id,source_customer_id),
  CONSTRAINT fk_catalog_run_customer FOREIGN KEY (workspace_id,chat_id,run_id,customer_id) REFERENCES test_customers(workspace_id,chat_id,run_id,id),
  CONSTRAINT fk_catalog_run_source FOREIGN KEY (workspace_id,source_customer_id) REFERENCES catalog_customers(workspace_id,id)
) ENGINE=InnoDB;
