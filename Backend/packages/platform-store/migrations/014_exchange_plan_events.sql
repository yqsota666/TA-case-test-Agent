CREATE TABLE case_exchange_plan_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL,
  chat_id BIGINT UNSIGNED NOT NULL,
  case_id BIGINT UNSIGNED NOT NULL,
  plan_version INT UNSIGNED NOT NULL,
  step_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  condition_name VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  batch_id BIGINT UNSIGNED NOT NULL,
  parse_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_exchange_step (workspace_id,chat_id,case_id,plan_version,step_id,condition_name),
  CONSTRAINT fk_exchange_event_case FOREIGN KEY (workspace_id,chat_id,case_id) REFERENCES cases(workspace_id,chat_id,id),
  CONSTRAINT fk_exchange_event_plan FOREIGN KEY (workspace_id,chat_id,case_id,plan_version) REFERENCES case_sop_versions(workspace_id,chat_id,case_id,version_number),
  CONSTRAINT fk_exchange_event_batch FOREIGN KEY (workspace_id,chat_id,batch_id) REFERENCES exchange_batches(workspace_id,chat_id,id),
  CONSTRAINT fk_exchange_event_parse FOREIGN KEY (workspace_id,chat_id,case_id,parse_id) REFERENCES case_return_parses(workspace_id,chat_id,case_id,id),
  CONSTRAINT ck_exchange_event_condition CHECK (condition_name IN ('SENT','PARSED','CONFIRMED'))
) ENGINE=InnoDB;
