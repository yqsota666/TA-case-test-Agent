CREATE TABLE case_exchange_plan_bindings (
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  plan_version INT UNSIGNED NOT NULL,
  step_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  batch_id BIGINT UNSIGNED NOT NULL,
  file_type CHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (workspace_id,chat_id,case_id,plan_version,step_id),
  UNIQUE KEY uq_exchange_binding_round (workspace_id,chat_id,case_id,plan_version,batch_id,file_type),
  CONSTRAINT fk_exchange_binding_plan FOREIGN KEY (workspace_id,chat_id,case_id,plan_version) REFERENCES case_sop_versions(workspace_id,chat_id,case_id,version_number),
  CONSTRAINT fk_exchange_binding_batch FOREIGN KEY (workspace_id,chat_id,batch_id) REFERENCES exchange_batches(workspace_id,chat_id,id)
) ENGINE=InnoDB;

CREATE TABLE case_exchange_plan_receipts (
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  plan_version INT UNSIGNED NOT NULL,
  step_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  parse_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (workspace_id,chat_id,case_id,plan_version,step_id,parse_id),
  CONSTRAINT fk_exchange_receipt_step FOREIGN KEY (workspace_id,chat_id,case_id,plan_version,step_id) REFERENCES case_exchange_plan_bindings(workspace_id,chat_id,case_id,plan_version,step_id),
  CONSTRAINT fk_exchange_receipt_parse FOREIGN KEY (workspace_id,chat_id,case_id,parse_id) REFERENCES case_return_parses(workspace_id,chat_id,case_id,id)
) ENGINE=InnoDB;

CREATE TABLE case_exchange_plan_supplements (
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  plan_version INT UNSIGNED NOT NULL,
  base_version INT UNSIGNED NOT NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  mappings_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (workspace_id,chat_id,case_id,plan_version),
  CONSTRAINT fk_exchange_supplement_plan FOREIGN KEY (workspace_id,chat_id,case_id,plan_version) REFERENCES case_sop_versions(workspace_id,chat_id,case_id,version_number),
  CONSTRAINT fk_exchange_supplement_base FOREIGN KEY (workspace_id,chat_id,case_id,base_version) REFERENCES case_sop_versions(workspace_id,chat_id,case_id,version_number),
  CONSTRAINT fk_exchange_supplement_actor FOREIGN KEY (workspace_id,actor_user_id) REFERENCES workspaces(id,owner_user_id)
) ENGINE=InnoDB;
