CREATE TABLE model_budget_buckets (
  bucket_key VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  budget_day DATE NOT NULL,
  booked_tokens BIGINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key,budget_day)
) ENGINE=InnoDB;

CREATE TABLE model_consumption (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  budget_day DATE NOT NULL,
  model VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  purpose VARCHAR(40) NOT NULL,
  reserved_tokens BIGINT UNSIGNED NOT NULL,
  charged_tokens BIGINT UNSIGNED NULL,
  input_tokens BIGINT UNSIGNED NULL,
  output_tokens BIGINT UNSIGNED NULL,
  usage_json JSON NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'RESERVED',
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  settled_at DATETIME(3) NULL,
  KEY ix_model_user_activity (user_id,status,expires_at),
  KEY ix_model_workspace_activity (workspace_id,status,expires_at),
  KEY ix_model_rate (created_at),
  CONSTRAINT fk_model_actor FOREIGN KEY (workspace_id,user_id) REFERENCES workspaces(id,owner_user_id),
  CONSTRAINT ck_model_status CHECK (status IN ('RESERVED','SETTLED','UNCERTAIN'))
) ENGINE=InnoDB;
