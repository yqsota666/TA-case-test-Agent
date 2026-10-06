CREATE TABLE sales_return_confirmations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  application_id BIGINT UNSIGNED NOT NULL,
  parse_id BIGINT UNSIGNED NOT NULL,
  record_index INT UNSIGNED NOT NULL,
  record_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  return_code CHAR(4) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  outcome VARCHAR(16) NOT NULL,
  record_json JSON NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sales_confirmation_scope (workspace_id,id),
  UNIQUE KEY uq_sales_confirmation_application (workspace_id,application_id),
  CONSTRAINT fk_sales_confirmation_application FOREIGN KEY (workspace_id,chat_id,case_id,application_id) REFERENCES applications(workspace_id,chat_id,case_id,id),
  CONSTRAINT fk_sales_confirmation_parse FOREIGN KEY (workspace_id,chat_id,case_id,parse_id) REFERENCES case_return_parses(workspace_id,chat_id,case_id,id),
  CONSTRAINT fk_sales_confirmation_actor FOREIGN KEY (workspace_id,actor_user_id) REFERENCES workspaces(id,owner_user_id),
  CONSTRAINT ck_sales_confirmation_outcome CHECK (outcome IN ('CONFIRMED','FAILED'))
) ENGINE=InnoDB;

CREATE TABLE sales_confirmed_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workspace_id BIGINT UNSIGNED NOT NULL,
  channel_id BIGINT UNSIGNED NOT NULL,
  transaction_account_id VARCHAR(17) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ta_account_id VARCHAR(12) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  investor_name VARCHAR(180) NOT NULL,
  investor_type CHAR(1) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  certificate_type VARCHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  certificate_no VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  branch_code VARCHAR(9) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_confirmation_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sales_account_public (public_id),
  UNIQUE KEY uq_sales_account_scope (workspace_id,channel_id,id),
  UNIQUE KEY uq_sales_account_trading (workspace_id,channel_id,transaction_account_id),
  CONSTRAINT fk_sales_account_channel FOREIGN KEY (workspace_id,channel_id) REFERENCES exchange_channels(workspace_id,id),
  CONSTRAINT fk_sales_account_confirmation FOREIGN KEY (workspace_id,source_confirmation_id) REFERENCES sales_return_confirmations(workspace_id,id)
) ENGINE=InnoDB;

CREATE TABLE sales_confirmed_transactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL,
  channel_id BIGINT UNSIGNED NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  confirmation_id BIGINT UNSIGNED NOT NULL,
  business_code CHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  fund_code CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  share_class CHAR(1) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  confirmed_amount DECIMAL(16,2) NOT NULL,
  confirmed_volume DECIMAL(16,2) NOT NULL,
  nav DECIMAL(16,8) NOT NULL,
  confirmation_date DATE NOT NULL,
  UNIQUE KEY uq_sales_transaction_confirmation (workspace_id,confirmation_id),
  CONSTRAINT fk_sales_transaction_account FOREIGN KEY (workspace_id,channel_id,account_id) REFERENCES sales_confirmed_accounts(workspace_id,channel_id,id),
  CONSTRAINT fk_sales_transaction_confirmation FOREIGN KEY (workspace_id,confirmation_id) REFERENCES sales_return_confirmations(workspace_id,id),
  CONSTRAINT ck_sales_transaction_values CHECK (confirmed_amount>0 AND confirmed_volume>0 AND nav>0),
  CONSTRAINT ck_sales_transaction_business CHECK (business_code='022')
) ENGINE=InnoDB;

CREATE TABLE sales_confirmed_holdings (
  workspace_id BIGINT UNSIGNED NOT NULL,
  channel_id BIGINT UNSIGNED NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  fund_code CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  share_class CHAR(1) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  total_volume DECIMAL(16,2) NOT NULL,
  PRIMARY KEY (workspace_id,channel_id,account_id,fund_code,share_class),
  CONSTRAINT fk_sales_holding_account FOREIGN KEY (workspace_id,channel_id,account_id) REFERENCES sales_confirmed_accounts(workspace_id,channel_id,id),
  CONSTRAINT ck_sales_holding_volume CHECK (total_volume>=0)
) ENGINE=InnoDB;

CREATE TABLE case_sales_account_refs (
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  channel_id BIGINT UNSIGNED NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (workspace_id,chat_id,case_id,channel_id,account_id),
  CONSTRAINT fk_case_sales_ref_case FOREIGN KEY (workspace_id,chat_id,case_id) REFERENCES cases(workspace_id,chat_id,id),
  CONSTRAINT fk_case_sales_ref_account FOREIGN KEY (workspace_id,channel_id,account_id) REFERENCES sales_confirmed_accounts(workspace_id,channel_id,id)
) ENGINE=InnoDB;
