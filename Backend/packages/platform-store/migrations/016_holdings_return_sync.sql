CREATE TABLE case_holdings_return_parses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  channel_id BIGINT UNSIGNED NOT NULL,
  content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  parsed_json JSON NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  applied_at DATETIME(3) NULL,
  applied_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_holdings_parse_scope (workspace_id,chat_id,case_id,id),
  UNIQUE KEY uq_holdings_parse_hash (workspace_id,chat_id,case_id,channel_id,content_sha256),
  CONSTRAINT fk_holdings_parse_case FOREIGN KEY (workspace_id,chat_id,case_id) REFERENCES cases(workspace_id,chat_id,id),
  CONSTRAINT fk_holdings_parse_channel FOREIGN KEY (workspace_id,channel_id) REFERENCES exchange_channels(workspace_id,id),
  CONSTRAINT fk_holdings_parse_actor FOREIGN KEY (workspace_id,actor_user_id) REFERENCES workspaces(id,owner_user_id)
) ENGINE=InnoDB;
CREATE TABLE case_holdings_return_files (
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  parse_id BIGINT UNSIGNED NOT NULL,
  file_name VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  raw_bytes MEDIUMBLOB NOT NULL,
  PRIMARY KEY (workspace_id,chat_id,case_id,parse_id,file_name),
  CONSTRAINT fk_holdings_file_parse FOREIGN KEY (workspace_id,chat_id,case_id,parse_id) REFERENCES case_holdings_return_parses(workspace_id,chat_id,case_id,id)
) ENGINE=InnoDB;
CREATE TABLE case_holdings_plan_receipts (
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  plan_version INT UNSIGNED NOT NULL,
  step_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  parse_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (workspace_id,chat_id,case_id,plan_version,step_id,parse_id),
  CONSTRAINT fk_holdings_receipt_parse FOREIGN KEY (workspace_id,chat_id,case_id,parse_id) REFERENCES case_holdings_return_parses(workspace_id,chat_id,case_id,id),
  CONSTRAINT fk_holdings_receipt_plan FOREIGN KEY (workspace_id,chat_id,case_id,plan_version) REFERENCES case_sop_versions(workspace_id,chat_id,case_id,version_number)
) ENGINE=InnoDB;
ALTER TABLE sales_confirmed_holdings
  ADD COLUMN snapshot_date DATE NULL,
  ADD COLUMN snapshot_total DECIMAL(16,2) NULL,
  ADD COLUMN snapshot_available DECIMAL(16,2) NULL,
  ADD COLUMN snapshot_frozen DECIMAL(16,2) NULL,
  ADD COLUMN snapshot_parse_id BIGINT UNSIGNED NULL,
  ADD COLUMN available_volume DECIMAL(16,2) NULL,
  ADD COLUMN frozen_volume DECIMAL(16,2) NULL;
