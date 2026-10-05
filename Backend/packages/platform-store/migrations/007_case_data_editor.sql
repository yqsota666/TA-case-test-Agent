CREATE TABLE case_generated_holdings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  fund_code CHAR(6) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  share_class CHAR(1) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  total_volume DECIMAL(18,8) NOT NULL,
  UNIQUE KEY uq_generated_holding (workspace_id,chat_id,case_id,account_id,fund_code,share_class),
  CONSTRAINT fk_generated_holding_account FOREIGN KEY (workspace_id,chat_id,case_id,account_id)
    REFERENCES case_generated_accounts(workspace_id,chat_id,case_id,id),
  CONSTRAINT fk_generated_holding_fund FOREIGN KEY (workspace_id,chat_id,case_id,fund_code,share_class)
    REFERENCES case_generated_funds(workspace_id,chat_id,case_id,fund_code,share_class),
  CONSTRAINT ck_generated_holding_volume CHECK (total_volume>=0)
) ENGINE=InnoDB;

CREATE TABLE case_data_edit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  revision INT UNSIGNED NOT NULL,
  edit_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_case_data_revision (workspace_id,chat_id,case_id,revision),
  CONSTRAINT fk_case_data_edit_execution FOREIGN KEY (workspace_id,chat_id,case_id)
    REFERENCES case_data_executions(workspace_id,chat_id,case_id)
) ENGINE=InnoDB;
