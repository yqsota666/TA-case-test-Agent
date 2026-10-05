CREATE TABLE case_data_executions (
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  sop_version_id BIGINT UNSIGNED NOT NULL,
  specification_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (workspace_id,chat_id,case_id),
  CONSTRAINT fk_data_execution_plan FOREIGN KEY (workspace_id,chat_id,case_id,sop_version_id)
    REFERENCES case_sop_versions(workspace_id,chat_id,case_id,id)
) ENGINE=InnoDB;

CREATE TABLE case_generated_customers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(180) NOT NULL,
  investor_type CHAR(1) NOT NULL,
  simulated_balance DECIMAL(16,2) NOT NULL,
  UNIQUE KEY uq_generated_customer_public (public_id),
  UNIQUE KEY uq_generated_customer_scope (workspace_id,chat_id,case_id,id),
  CONSTRAINT fk_generated_customer_execution FOREIGN KEY (workspace_id,chat_id,case_id)
    REFERENCES case_data_executions(workspace_id,chat_id,case_id),
  CONSTRAINT ck_generated_investor_type CHECK (investor_type IN ('0','1'))
) ENGINE=InnoDB;

CREATE TABLE case_generated_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL,
  account_no CHAR(17) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  branch_code VARCHAR(9) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  UNIQUE KEY uq_generated_account_scope (workspace_id,chat_id,case_id,id),
  UNIQUE KEY uq_generated_account_no (workspace_id,account_no),
  CONSTRAINT fk_generated_account_customer FOREIGN KEY (workspace_id,chat_id,case_id,customer_id)
    REFERENCES case_generated_customers(workspace_id,chat_id,case_id,id)
) ENGINE=InnoDB;

CREATE TABLE case_generated_funds (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  fund_code CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  fund_name VARCHAR(200) NOT NULL,
  share_class CHAR(1) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nav DECIMAL(16,8) NOT NULL,
  UNIQUE KEY uq_generated_fund_case (workspace_id,chat_id,case_id,fund_code,share_class),
  CONSTRAINT fk_generated_fund_execution FOREIGN KEY (workspace_id,chat_id,case_id)
    REFERENCES case_data_executions(workspace_id,chat_id,case_id)
) ENGINE=InnoDB;
